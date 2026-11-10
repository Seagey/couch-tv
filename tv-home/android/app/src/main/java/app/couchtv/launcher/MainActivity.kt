package app.couchtv.launcher

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * The TV home screen. Shows the page the bridge serves at /tv/ full screen. If the bridge cannot be
 * reached, shows the saved copy of that page (scenes, clock, weather, apps), or the copy built
 * into the app, and keeps trying the bridge. With no bridge at all (option A) the built-in copy is
 * the home. A plain grid of the TV's apps is the last resort, so the TV is never stuck.
 */
class MainActivity : Activity() {

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val banners = ConcurrentHashMap<String, ByteArray>()
    private val icons = ConcurrentHashMap<String, ByteArray>()

    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private var fallback: View? = null
    private var pageReady = false
    private var loadFailed = false
    private var probing = false
    private var offline = false   // showing the saved copy because the computer is off
    private var resumed = false
    private val retry = Runnable { if (!pageReady || offline) connect() }

    private val prefs by lazy { getSharedPreferences("home", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashGuard.install(this)
        restoreTimeout()   // a press left the screen timeout short: put it back
        // apply.sh starting the home on purpose (new settings) is always a fresh try.
        if (intent?.hasExtra("bridge") == true || intent?.hasExtra("config_b64") == true) CrashGuard.reset(this)
        // Crashed twice in the last few minutes: stand aside for the TV's own home rather than
        // crash again, so the TV is never stuck going round (CrashGuard.kt). It tries again later.
        if (CrashGuard.standingAside(this) && CrashGuard.openStockHome(this)) {
            finish()
            return
        }
        CrashGuard.started(this)
        main.postDelayed({ CrashGuard.settled(this) }, CrashGuard.SETTLE_MS)
        // Lets a computer inspect the page over ADB (chrome://inspect). Only reachable with ADB access.
        // Right after power on the TV's WebView can still be getting ready: never crash over it.
        runCatching { WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG) }
        CrashGuard.install(this)   // the WebView puts its own crash handler in front: ours goes first again
        root = FrameLayout(this).apply { setBackgroundColor(GROUND) }
        setContentView(root)
        hideSystemBars()
        intent?.let { readExtras(it) }
        io.execute { warmApps() }
        askWatchNextPermission()
        Doorbell.start(this)   // smart home (optional): nothing happens unless a doorbell is set up
        FireWatch.ensure(this)   // Fire TV only, and only once a computer has switched it on
        main.postDelayed({ FireWatch.rebindIfUnbound(applicationContext) }, 10_000L)   // listed but not bound after a force-stop
        // At power-on the page is often asked for before Wi-Fi is up: try again the moment it is.
        val netBack = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                main.post { if (loadFailed || offline) connect() }
            }
        }
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        if (Build.VERSION.SDK_INT >= 24) cm?.registerDefaultNetworkCallback(netBack)
        else cm?.registerNetworkCallback(   // Android 6: no "default network" call, ask for any network with internet
            android.net.NetworkRequest.Builder().addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), netBack)
        // Load the last bridge that worked straight away; only probe the others if it fails.
        val saved = prefs.getString("bridge", null)
        if (saved != null) showWeb(saved) else connect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasExtra("bridge") || intent.hasExtra("config_b64")) {
            readExtras(intent)
            pageReady = false
            offline = false
            connect()
            return
        }
        // The remote's gear button, caught by KeyWatch: open the gear menu (a moment's wait in case
        // we were just brought forward from another app and the page is still settling).
        if (intent.getBooleanExtra("gear", false)) {
            main.postDelayed({ js("window.tv && tv.settingsKey && tv.settingsKey()") }, 250)
            return
        }
        // HOME pressed while we are already in front: back to the first tile.
        js("window.tv && tv.home()")
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        restoreTimeout()   // back in front: the normal screen timeout goes back
        hideSystemBars()
        if (pageReady && offline && alone()) {
            js("window.tv && tv.resume()")   // option A: the built-in copy is the home, keep it fresh
        } else if (pageReady && !offline) {
            js("window.tv && tv.resume()")
            // the computer may have gone off while the page was open: then the saved copy takes over
            val base = prefs.getString("bridge", null)
            if (base != null && hasOffline()) io.execute {
                if (!reachable(base)) main.post { if (resumed && !offline) { showOffline(); later(OFFLINE_RETRY_MS) } }
            }
        } else if (offline || fallback != null) connect()
        io.execute { warmApps() }
        Updater.resumed(this)   // the daily look for a new release (Home settings, Updates)
    }

    override fun onPause() {
        super.onPause()
        resumed = false
        restoreTimeout(dream = true)   // the screensaver covered the home: timeout goes back
        js("window.tv && tv.pause && tv.pause()")   // the video background stops while an app is in front
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Every kind of remote: game controller A, Select and the number pad's Enter count as OK,
        // controller B and Escape as BACK. The page then only has to know OK and BACK.
        val same = when (event.keyCode) {
            KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_SELECT, KeyEvent.KEYCODE_NUMPAD_ENTER -> KeyEvent.KEYCODE_DPAD_CENTER
            KeyEvent.KEYCODE_BUTTON_B, KeyEvent.KEYCODE_ESCAPE -> KeyEvent.KEYCODE_BACK
            else -> null
        }
        if (same != null) {
            return dispatchKeyEvent(KeyEvent(event.downTime, event.eventTime, event.action, same, event.repeatCount,
                event.metaState, event.deviceId, event.scanCode, event.flags, event.source))
        }
        // The remote's Settings/gear key: couch-tv's own gear menu (Home settings or TV settings).
        // The WebView does not pass KEYCODE_SETTINGS on to the page, so it is caught here.
        if (event.keyCode == KeyEvent.KEYCODE_SETTINGS) {
            if (event.action == KeyEvent.ACTION_UP && event.repeatCount == 0 && pageReady) js("window.tv && tv.settingsKey && tv.settingsKey()")
            return true
        }
        // The home screen never exits on BACK; the page decides what BACK means.
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && pageReady) js("window.tv && tv.back()")
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    /**
     * What apply.sh tells the app: "bridge" (the bridge's address, or "none" for option A, no
     * computer), "config_b64" (the home's settings from config.json, base64 JSON, for the built-in
     * copy) and "tv" (which TV this is, for a house with more than one; none = the default TV).
     */
    private fun readExtras(i: Intent) {
        val e = prefs.edit()
        i.getStringExtra("bridge")?.trim()?.let {
            if (it.isEmpty() || it == "none") e.remove("bridge") else e.putString("bridge", it.trimEnd('/'))
        }
        i.getStringExtra("config_b64")?.let {
            try {
                val json = String(android.util.Base64.decode(it, android.util.Base64.DEFAULT), Charsets.UTF_8)
                // only keep it if it is real JSON, and keep org.json's own rewrite of it rather than
                // the text as sent, so nothing its lenient parser lets through reaches the page script
                e.putString("config", JSONObject(json).toString())
            } catch (x: Exception) {
                // a broken value keeps the settings the app already had
            }
        }
        i.getStringExtra("tv")?.trim()?.let {
            if (it.isEmpty()) e.remove("tv") else if (TV_NAME.matches(it)) e.putString("tv", it)
        }
        i.getStringExtra("key")?.trim()?.let {
            if (it.isEmpty()) e.remove("pairing_key") else e.putString("pairing_key", it)
        }
        e.apply()
        HomeAssistant.readExtras(this, i)   // smart home ("ha_b64"), kept apart from the page's settings
    }

    // ---------------------------------------------------------------- finding the bridge

    /** No bridge anywhere (option A): the built-in copy is the home, and nothing to look for. */
    private fun alone() = prefs.getString("bridge", null) == null && BuildConfig.BRIDGES.isEmpty()

    private fun connect() {
        if (probing) return
        if (alone()) {
            if (!offline || web == null) showOffline()
            return
        }
        probing = true
        val saved = prefs.getString("bridge", null)
        val candidates = (listOfNotNull(saved) + BuildConfig.BRIDGES).distinct()
        io.execute {
            val found = candidates.firstOrNull { reachable(it) }
            main.post {
                probing = false
                if (found != null) {
                    prefs.edit().putString("bridge", found).apply()
                    // back from the saved copy only while the home is on screen, never during a show
                    if (offline && !resumed) return@post
                    showWeb(found)
                } else if (hasOffline()) {
                    if (!offline) showOffline()
                    later(OFFLINE_RETRY_MS)
                } else {
                    showFallback()
                    later(RETRY_MS)
                }
            }
        }
    }

    private fun later(ms: Long) {
        main.removeCallbacks(retry)
        main.postDelayed(retry, ms)
    }

    private fun reachable(base: String): Boolean = try {
        val c = URL("$base/api/health").openConnection() as HttpURLConnection
        c.connectTimeout = 1200
        c.readTimeout = 1500
        val ok = c.responseCode in 200..299
        c.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    // ---------------------------------------------------------------- the page

    /** The page's WebView, or null while the TV's WebView cannot start (then the app grid shows). */
    private fun webView(): WebView? = web ?: try {
        makeWebView().also { web = it; root.addView(it, 0, MATCH); CrashGuard.install(this) }
    } catch (e: Throwable) {
        android.util.Log.w("couchtv", "WebView not ready, showing the app grid: ${e.message}")
        showFallback()
        later(RETRY_MS)
        null
    }

    private fun showWeb(base: String) {
        val w = webView() ?: return
        loadFailed = false
        offline = false
        pageReady = false
        val tv = prefs.getString("tv", null)
        val key = prefs.getString("pairing_key", null)
        val q = mutableListOf<String>()
        if (!tv.isNullOrEmpty()) q.add("tv=$tv")
        if (!key.isNullOrEmpty()) q.add("key=$key")
        val qs = if (q.isEmpty()) "" else "?" + q.joinToString("&")
        w.loadUrl("$base/tv/$qs")
        // Never a blank screen: if the page is slow, show the app grid until it arrives.
        main.postDelayed({ if (!pageReady) showFallback() }, SLOW_MS)
    }

    private fun makeWebView(): WebView = WebView(this).apply {
        setBackgroundColor(GROUND)
        isFocusable = true
        isFocusableInTouchMode = true
        overScrollMode = View.OVER_SCROLL_NEVER
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.textZoom = 100
        addJavascriptInterface(Native(), "TVOS")
        addJavascriptInterface(HomeAssistant.Page(this@MainActivity, this), "TVHA")   // smart home, see HomeAssistant.kt
        addJavascriptInterface(Updater.Page(this@MainActivity, this), "TVUP")   // updates from GitHub releases, see Updater.kt
        webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (!loadFailed && url.startsWith("http")) {
                    pageReady = true
                    removeFallback()
                    view.visibility = View.VISIBLE
                    view.requestFocus()
                    // the live page is up: bring the saved copy up to date if the page changed
                    if (!offline) prefs.getString("bridge", null)?.let { b -> io.execute { syncOffline(b) } }
                }
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) pageFailed()
            }

            override fun onReceivedHttpError(view: WebView, req: WebResourceRequest, res: WebResourceResponse) {
                if (req.isForMainFrame && res.statusCode >= 500) pageFailed()
            }

            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = true

            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                val u = req.url
                if (u.host == OFFLINE_HOST) return offlineFile(u.path ?: "")
                if (u.host != "tvos.invalid") return null
                if (u.pathSegments.firstOrNull() == "photo") {
                    // the household's own photos (Home settings), copied in by the file picker
                    val f = photoFile(u.lastPathSegment ?: "") ?: return null
                    return WebResourceResponse("image/jpeg", null, f.inputStream()).apply {
                        responseHeaders = mapOf("Cache-Control" to "max-age=86400")
                    }
                }
                if (u.pathSegments.firstOrNull() == "art") {
                    val b = watchNextArt(u.lastPathSegment ?: "") ?: return null
                    return WebResourceResponse("image/jpeg", null, ByteArrayInputStream(b)).apply {
                        responseHeaders = mapOf("Cache-Control" to "max-age=86400")
                    }
                }
                val pkg = u.lastPathSegment ?: return null
                val isIcon = u.pathSegments.firstOrNull() == "icon"
                val img = (if (isIcon) iconImage(pkg) else bannerImage(pkg)) ?: return null
                return WebResourceResponse(if (isIcon) "image/png" else "image/jpeg", null, ByteArrayInputStream(img)).apply {
                    // CORS: the page cuts each icon's glyph out on a canvas for Glass app icons
                    // (clearicon.js), and the page is served from another host
                    responseHeaders = mapOf("Cache-Control" to "max-age=86400", "Access-Control-Allow-Origin" to "*")
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The page crashed or was killed for memory. Drop it and start again.
                root.removeView(view)
                view.destroy()
                web = null
                pageReady = false
                connect()
                return true
            }
        }
    }

    private fun pageFailed() {
        if (loadFailed) return
        loadFailed = true
        pageReady = false
        web?.visibility = View.INVISIBLE
        web?.stopLoading()
        if (!offline && hasOffline()) main.post { showOffline() } else showFallback()
        later(3000)
    }

    // ---------------------------------------------------------------- the saved copy 

    private val offlineDir get() = java.io.File(filesDir, "offline/web")

    private fun hasSynced() = java.io.File(offlineDir, "index.html").isFile

    /** The copy of the home built into the app (assets/www/tv, from tv-home/web at build time). */
    private val hasBundled by lazy {
        try { assets.list(BUNDLED)?.contains("index.html") == true } catch (e: Exception) { false }
    }

    private fun hasOffline() = hasSynced() || hasBundled

    /** The bridge's latest copy when there is a bridge, else the one built into the app. */
    private fun useSynced() = !alone() && hasSynced()

    /**
     * The home page with no computer: the copy last taken from the bridge (option B with the
     * computer off), or the copy built into the app (option A, or B before the bridge first answered).
     */
    private fun showOffline() {
        if (!hasOffline()) { showFallback(); return }
        val w = webView() ?: return
        loadFailed = false
        offline = true
        val tv = prefs.getString("tv", null)
        w.loadUrl("http://$OFFLINE_HOST/tv/index.html?offline=1" + (if (alone()) "&alone=1" else "") +
            if (tv.isNullOrEmpty()) "" else "&tv=$tv")
    }

    /** Copies the bridge's home page files when they changed (the bridge's fingerprint says so). */
    private fun syncOffline(base: String) {
        try {
            val m = JSONObject(fetchText("$base/tv/manifest.json"))
            val version = m.getString("version")
            if (version == prefs.getString("offline_version", null) && hasSynced()) return
            val tmp = java.io.File(filesDir, "offline/new").apply { deleteRecursively(); mkdirs() }
            val files = m.getJSONArray("files")
            for (i in 0 until files.length()) {
                val rel = files.getJSONObject(i).getString("path")
                if (rel.contains("..")) continue
                val out = java.io.File(tmp, rel).apply { parentFile?.mkdirs() }
                val c = URL("$base/tv/$rel").openConnection() as HttpURLConnection
                c.connectTimeout = 3000
                c.readTimeout = 15000
                try {
                    if (c.responseCode !in 200..299) return   // half a copy is no copy: keep the old one
                    c.inputStream.use { inp -> out.outputStream().use { inp.copyTo(it) } }
                } finally {
                    c.disconnect()
                }
            }
            offlineDir.deleteRecursively()
            if (tmp.renameTo(offlineDir)) prefs.edit().putString("offline_version", version).apply()
        } catch (e: Exception) {
            // try again the next time the live page loads
        }
    }

    private fun fetchText(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 3000
        c.readTimeout = 8000
        try {
            return c.inputStream.bufferedReader().readText()
        } finally {
            c.disconnect()
        }
    }

    private fun offlineFile(path: String): WebResourceResponse {
        val rel = path.removePrefix("/tv/").ifEmpty { "index.html" }
        val notFound = { WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0))) }
        if (rel.contains("..")) return notFound()
        val synced = useSynced()
        // The settings: the bridge's (in its copy) when there is a bridge, else what apply.sh
        // passed from config.json, else the defaults built into the app.
        val given = prefs.getString("config", null)
        if (rel == "config.js" && given != null && (!synced || !java.io.File(offlineDir, rel).isFile)) {
            val js = "window.COUCH_CONFIG = $given;\n".toByteArray()
            return WebResourceResponse("application/javascript", "utf-8", ByteArrayInputStream(js))
        }
        val type = mimeFor(rel.substringAfterLast('.', ""))
        val text = type.startsWith("text/") || type.endsWith("javascript") || type.endsWith("json")
        if (!synced) {
            return try {
                WebResourceResponse(type, if (text) "utf-8" else null, assets.open("$BUNDLED/$rel"))
            } catch (e: Exception) {
                notFound()
            }
        }
        val f = java.io.File(offlineDir, rel)
        if (!f.isFile) return notFound()
        return WebResourceResponse(type, if (text) "utf-8" else null, f.inputStream())
    }

    private fun mimeFor(ext: String): String {
        val type = when (ext.lowercase()) {
            "html" -> "text/html"
            "js" -> "application/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "svg" -> "image/svg+xml"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
        return type
    }

    private fun js(code: String) {
        web?.takeIf { pageReady }?.evaluateJavascript(code, null)
    }

    // ---------------------------------------------------------------- what the page can ask for

    inner class Native {
        @JavascriptInterface
        fun apps(): String {
            val out = JSONArray()
            for ((ri, label) in appList()) {
                val ai = ri.activityInfo
                out.put(JSONObject().apply {
                    put("package", ai.packageName)
                    put("label", label)
                    put("hasBanner", ai.banner != 0 || ai.applicationInfo.banner != 0)
                })
            }
            return out.toString()
        }

        @JavascriptInterface
        fun launch(pkg: String): Boolean = launchPackage(pkg)

        /** Android's Watch Next list (what each app says you are in the middle of), as JSON. */
        @JavascriptInterface
        fun watchNext(): String = readWatchNext().toString()

        /** Opens one Watch Next item (its row id) in the app that owns it. */
        @JavascriptInterface
        fun openWatchNext(id: String): Boolean = openWatchNextItem(id)

        /** Hide a Watch Next card on this TV only: its id and package|title are remembered, the app's own row is never touched. */
        @JavascriptInterface
        fun dismissWatchNext(id: String, pkg: String, title: String): Boolean =
            dismissWatchNextItem(id, pkg, title)

        @JavascriptInterface
        fun canSleep(): Boolean = true

        @JavascriptInterface
        fun setSleepTimer(minutes: Int): Boolean = setNativeSleepTimer(minutes)

        @JavascriptInterface
        fun getSleepRemainingMinutes(): Int = getNativeSleepMinutes()

        @JavascriptInterface
        fun openSettings(): Boolean = start(tvSettingsIntent())

        /** Holding OK on an app, "Uninstall": Android's own remove dialog. Never ourselves.
         *  On TVs with no remove dialog, falls back to the app's details screen (it has Uninstall).
         *  startActivity runs here with its own try/catch (start() posts async and can't report a
         *  miss), so a missing remove dialog falls back cleanly instead of throwing on the main thread. */
        @JavascriptInterface
        fun uninstall(pkg: String): Boolean {
            if (pkg.isBlank() || pkg == packageName) return false
            main.post {
                val del = Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    startActivity(del)
                } catch (e: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    } catch (e2: Exception) {}
                }
            }
            return true
        }

        /** The navigation "tick": Android's own system sound effect, the same call other TV
         *  launchers make (AudioManager.playSoundEffect, Effect_Tick.ogg on most TVs).
         *  It follows the TV's "system sounds" switch. dir: 1 up, 2 down, 3 left, 4 right, 0 OK. */
        @JavascriptInterface
        fun tick(dir: Int): Boolean = try {
            val am = getSystemService(AUDIO_SERVICE) as android.media.AudioManager
            am.playSoundEffect(when (dir) {
                1 -> android.media.AudioManager.FX_FOCUS_NAVIGATION_UP
                2 -> android.media.AudioManager.FX_FOCUS_NAVIGATION_DOWN
                3 -> android.media.AudioManager.FX_FOCUS_NAVIGATION_LEFT
                4 -> android.media.AudioManager.FX_FOCUS_NAVIGATION_RIGHT
                else -> android.media.AudioManager.FX_KEY_CLICK
            })
            true
        } catch (e: Exception) {
            false
        }

        /** Holding OK on an app, "App info": Android's app details screen for that package. */
        @JavascriptInterface
        fun appInfo(pkg: String): Boolean {
            if (pkg.isBlank()) return false
            return start(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        // The TV's own input list (HDMI and the rest), for the Input quick button when there is no
        // bridge to press the TV_INPUT key. Only where the TV has a screen for it.
        @JavascriptInterface
        fun canOpenInputs(): Boolean = inputsIntent() != null || passthroughInputs().isNotEmpty()

        @JavascriptInterface
        fun openInputs(): Boolean = inputsIntent()?.let { start(it) } ?: false

        // The TV's screensaver: Google TV's Ambient mode, where the source and the Google Photos
        // albums are chosen. The dream service only lets the system start a dream, so the TV is
        // asked to nap in a few seconds instead and brings its own screensaver up.
        @JavascriptInterface
        fun canStartScreensaver(): Boolean = screensaverReady()

        @JavascriptInterface
        fun startScreensaver(): Boolean = startAmbientNow() || openAmbientSettings()

        /** Google TV's Ambient mode settings: the source, and the Google Photos albums. */
        @JavascriptInterface
        fun openAmbientSettings(): Boolean {
            val i = Intent(AMBIENT_SETTINGS)
            if (packageManager.resolveActivity(i, 0) == null) return false
            return start(i)
        }

        /**
         * The TV's own inputs for couch-tv's Input menu (#30): every HDMI port and other passthrough
         * input Android lists, with the TV's own name for it (a renamed port, or "HDMI 3 (eARC)" where
         * the maker labels it so) and, behind it, the devices HDMI-CEC found (a console's name). Android
         * has no public way to read ARC or eARC, so that shows only where the TV's own label says it.
         * JSON: [{id, label, type, devices: [..]}]. An empty list means the TV lists none.
         */
        @JavascriptInterface
        fun tvInputs(): String {
            val out = JSONArray()
            val all = passthroughInputs()
            val ports = all.filter { it.parentId == null }
            for (p in ports) {
                val devices = JSONArray()
                all.filter { it.parentId == p.id }.forEach { c -> inputLabel(c)?.let { devices.put(it) } }
                out.put(JSONObject().apply {
                    put("id", p.id)
                    put("label", inputLabel(p) ?: "")
                    put("type", when (p.type) {
                        TvInputInfo.TYPE_HDMI -> "hdmi"
                        TvInputInfo.TYPE_COMPONENT -> "component"
                        TvInputInfo.TYPE_COMPOSITE -> "composite"
                        TvInputInfo.TYPE_DISPLAY_PORT -> "displayport"
                        TvInputInfo.TYPE_VGA -> "vga"
                        TvInputInfo.TYPE_SVIDEO -> "svideo"
                        TvInputInfo.TYPE_SCART -> "scart"
                        TvInputInfo.TYPE_DVI -> "dvi"
                        else -> "other"
                    })
                    put("devices", devices)
                })
            }
            return out.toString()
        }

        /**
         * Switch the TV to one input: Android's passthrough channel for it, which the TV's own input
         * app plays. If nothing on this TV takes that, its input list screen instead (false: neither).
         */
        @JavascriptInterface
        fun openInput(id: String): Boolean {
            if (id.isBlank()) return false
            val view = Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(id))
            if (packageManager.resolveActivity(view, 0) != null) return start(view)
            return inputsIntent()?.let { start(it) } ?: false
        }

        /** The TV's Bluetooth or network settings, for the Input menu (falls back to all Settings). */
        @JavascriptInterface
        fun openSettingsScreen(which: String): Boolean {
            val actions = when (which) {
                "bluetooth" -> listOf(Settings.ACTION_BLUETOOTH_SETTINGS)
                "network" -> listOf(Settings.ACTION_WIFI_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS)
                else -> emptyList()
            } + Settings.ACTION_SETTINGS
            // Fire OS: every Settings action goes through Amazon's home, which the Home button watch puts
            // couch-tv back over (#75). With the watch on, open Fire OS's own Settings screen by name.
            val fire = if (FireWatch.connected) FireWatch.amazonSettings(packageManager) else null
            val i = fire ?: actions.asSequence().map { Intent(it) }.firstOrNull { packageManager.resolveActivity(it, 0) != null }
            return i?.let { start(it) } ?: false
        }

        // The saved copy has its own web storage, so the page keeps what it needs offline here.
        @JavascriptInterface
        fun keep(key: String, value: String) {
            getSharedPreferences("page", MODE_PRIVATE).edit().putString(key, value).apply()
        }

        @JavascriptInterface
        fun kept(key: String): String? = getSharedPreferences("page", MODE_PRIVATE).getString(key, null)

        // Home settings, "Your photos": the TV's own file picker, where it has one. Many Android TV
        // and Google TV builds ship without one, and then the page offers a web address instead.
        @JavascriptInterface
        fun canPickPhotos(): Boolean = pickIntent() != null

        @JavascriptInterface
        fun pickPhotos(): Boolean {
            val i = pickIntent() ?: return false
            main.post {
                try {
                    startActivityForResult(i, PICK_PHOTOS)
                } catch (e: Exception) {
                    js("window.tv && tv.photosAdded('[]')")
                }
            }
            return true
        }

        @JavascriptInterface
        fun removePhoto(name: String) {
            photoFile(name)?.delete()
        }
    }

    // ---------------------------------------------------------------- the household's own photos

    /** Android's "open a document" screen, else any app that hands out pictures. Null: none. */
    private fun pickIntent(): Intent? {
        val open = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp"))
        if (packageManager.resolveActivity(open, 0) != null) return open
        val get = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        return if (packageManager.resolveActivity(get, 0) != null) get else null
    }

    private val photoDir get() = java.io.File(filesDir, "photos").apply { mkdirs() }

    /** Only names this app made (letters, numbers, dashes, .jpg), so a page cannot reach other files. */
    private fun photoFile(name: String): java.io.File? {
        if (!Regex("[A-Za-z0-9_-]{1,64}\\.jpg").matches(name)) return null
        return java.io.File(photoDir, name).takeIf { it.isFile }
    }

    // The framework's own result callback (this app has no AndroidX, so no result API).
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_PHOTOS) return
        val uris = mutableListOf<android.net.Uri>()
        if (resultCode == RESULT_OK && data != null) {
            data.clipData?.let { c -> for (k in 0 until c.itemCount) uris.add(c.getItemAt(k).uri) }
            if (uris.isEmpty()) data.data?.let { uris.add(it) }
        }
        io.execute {
            val names = JSONArray()
            for (u in uris.take(20)) copyPhoto(u)?.let { names.put(it) }
            main.post { js("window.tv && tv.photosAdded(" + JSONObject.quote(names.toString()) + ")") }
        }
    }

    /**
     * One chosen photo, copied into the app: turned the right way up (the camera's EXIF note) and made
     * no bigger than it needs to be to fill a 1920x1080 screen, as a JPEG. Returns its file name.
     */
    private fun copyPhoto(uri: android.net.Uri): String? {
        try {
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= 1920 && bounds.outHeight / (sample * 2) >= 1080) sample *= 2
            val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
            val raw = contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, opts) } ?: return null
            val turn = try {
                contentResolver.openInputStream(uri)?.use {
                    val exif = if (Build.VERSION.SDK_INT >= 24) android.media.ExifInterface(it) else {
                        // Android 6: ExifInterface only reads a file path, so use a short lived copy
                        val tmp = java.io.File.createTempFile("exif", ".jpg", cacheDir)
                        try { tmp.outputStream().use { o -> it.copyTo(o) }; android.media.ExifInterface(tmp.path) } finally { tmp.delete() }
                    }
                    when (exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
                        6 -> 90f; 3 -> 180f; 8 -> 270f; else -> 0f
                    }
                } ?: 0f
            } catch (e: Exception) { 0f }
            val w = if (turn == 90f || turn == 270f) raw.height else raw.width
            val h = if (turn == 90f || turn == 270f) raw.width else raw.height
            val scale = minOf(1f, maxOf(1920f / w, 1080f / h))
            val m = android.graphics.Matrix().apply { postRotate(turn); postScale(scale, scale) }
            val bmp = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
            val name = "p" + System.currentTimeMillis().toString(36) + "-" + (1000 + (Math.random() * 9000).toInt()) + ".jpg"
            java.io.File(photoDir, name).outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            if (bmp !== raw) bmp.recycle()
            raw.recycle()
            return name
        } catch (e: Exception) {
            return null   // not a picture, or the drive went away: skipped
        }
    }

    /**
     * An input list screen, if this TV has one. Makers name it differently, so each guess is checked
     * with resolveActivity: a wrong guess is skipped and, with none left, the Input button is hidden.
     */
    private fun inputsIntent(): Intent? = INPUT_ACTIONS.asSequence()
        .map { Intent(it) }
        .firstOrNull { packageManager.resolveActivity(it, 0) != null }

    /** HDMI and the other passthrough inputs Android lists, minus any the TV's owner hid. */
    private fun passthroughInputs(): List<TvInputInfo> = try {
        val tim = getSystemService(TV_INPUT_SERVICE) as? TvInputManager
        tim?.tvInputList.orEmpty().filter { it.isPassthroughInput && (Build.VERSION.SDK_INT < 24 || !it.isHidden(this)) }
    } catch (e: Exception) {
        emptyList()
    }

    /** The name the TV gives an input: the one its owner set, else the TV's own. */
    private fun inputLabel(i: TvInputInfo): String? = try {
        ((if (Build.VERSION.SDK_INT >= 24) i.loadCustomLabel(this) else null) ?: i.loadLabel(this))?.toString()?.trim()?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
        null
    }


    /**
     * Resets the TV's idle timer, so the short screen timeout just set is the one that counts: the
     * power manager only re-reads it when user activity comes in. userActivity() is hidden from
     * the SDK, so it is called by reflection.
     */
    private fun resetIdleTimer() {
        val pm = getSystemService(android.os.PowerManager::class.java) ?: return
        try {
            pm.javaClass.getMethod("userActivity", java.lang.Long.TYPE, java.lang.Boolean.TYPE)
                .invoke(pm, android.os.SystemClock.uptimeMillis(), false)
        } catch (e: Exception) {
            android.util.Log.w("couch-tv", "userActivity refused: " + e)
        }
    }

    /**
     * Whether the button can work here: apply.sh granted "modify system settings", and the TV has a
     * screensaver switched on whose app is installed and enabled. Without one, a short timeout
     * only puts the TV to sleep (apply.sh switches Google TV's ambient mode off unless KEEP_AMBIENT=1).
     */
    private fun screensaverReady(): Boolean {
        if (!Settings.System.canWrite(this)) return false
        val cr = contentResolver
        if (Settings.Secure.getInt(cr, "screensaver_enabled", 1) == 0) return false
        val dream = Settings.Secure.getString(cr, "screensaver_components")
            ?.split(",")?.firstOrNull()?.let { android.content.ComponentName.unflattenFromString(it) }
            ?: return false
        return try {
            packageManager.getApplicationInfo(dream.packageName, 0).enabled
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Asks the TV to start its own screensaver. Only the system may start a dream on this build
     * (WRITE_DREAM_STATE is signature only, and even `cmd dreams` wants root), so the screen
     * timeout is cut to a few seconds for a moment and the idle timer reset again and again: the
     * TV then naps by itself and Ambient mode (the Google Photos albums) comes up. The timeout goes
     * back the moment this activity pauses, which is what the screensaver covering it does.
     *
     * The timeout kept to put back is the one the TV had before the first press: a second press
     * while the TV is already napping must never save the five seconds it is set to, or the TV
     * would keep five seconds for good (seen on a Thomson).
     */
    private fun startAmbientNow(): Boolean {
        val now = try {
            Settings.System.getInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT)
        } catch (e: Exception) {
            return false
        }
        pressPending = true
        if (prefs.getInt("timeout_saved", -1) <= 0) {
            prefs.edit().putInt("timeout_saved", if (now > SHORT_MS) now else AMBIENT_RESTORE_MS).apply()
        }
        return try {
            Settings.System.putInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, AMBIENT_DELAY_MS)
            android.util.Log.i("couch-tv", "screensaver: timeout " + now + " -> " + AMBIENT_DELAY_MS)
            main.removeCallbacks(idleTick)
            idleShots = 0
            main.postDelayed(idleTick, 700)
            main.postDelayed({ restoreTimeout() }, AMBIENT_WINDOW_MS)
            true
        } catch (e: Exception) {
            android.util.Log.w("couch-tv", "screensaver refused: " + e)
            restoreTimeout()
            false
        }
    }

    /** Puts back the screen timeout the TV had before the screensaver button shortened it. */
    private fun restoreTimeout(dream: Boolean = false) {
        val saved = prefs.getInt("timeout_saved", -1)
        if (saved <= 0) return
        val pressed = pressPending
        pressPending = false
        prefs.edit().remove("timeout_saved").apply()
        main.removeCallbacks(idleTick)
        val back = if (saved > SHORT_MS) saved else AMBIENT_RESTORE_MS
        android.util.Log.i("couch-tv", "screensaver: timeout back to " + back + (if (dream) " (dream up)" else " (deadline)"))
        if (pressed && !dream) js("window.tv && window.tv.noDream && window.tv.noDream()")   // the TV refused
        try { Settings.System.putInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, back) } catch (e: Exception) {}
    }

    // Holds the short timeout in place and nudges the idle timer until the TV naps by itself: the
    // power manager may keep the old value for a moment, and it only re-reads it on user activity.
    private var pressPending = false
    private var idleShots = 0
    private val idleTick = object : Runnable {
        override fun run() {
            if (prefs.getInt("timeout_saved", -1) <= 0) return
            try {
                if (Settings.System.getInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT) != AMBIENT_DELAY_MS) {
                    Settings.System.putInt(contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, AMBIENT_DELAY_MS)
                }
            } catch (e: Exception) {}
            resetIdleTimer()
            if (++idleShots < 40) main.postDelayed(this, 600)
        }
    }

    @Volatile private var appCache: List<Pair<ResolveInfo, String>>? = null

    /** The TV's apps with their labels. Cached: reading labels for 30 apps is slow on this TV. */
    private fun tvApps(): List<ResolveInfo> = appList().map { it.first }

    private fun appList(): List<Pair<ResolveInfo, String>> = appCache ?: synchronized(this) {
        appCache ?: run {
            val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
            packageManager.queryIntentActivities(q, 0)
                .filter { it.activityInfo.packageName != packageName }
                .distinctBy { it.activityInfo.packageName }
                .map { it to it.loadLabel(packageManager).toString() }
                .sortedBy { it.second.lowercase() }
                .also { appCache = it }
        }
    }

    /** Builds the app list and every banner ahead of time, so the page never waits for them. */
    private fun warmApps() {
        appCache = null
        appList().forEach { bannerImage(it.first.activityInfo.packageName) }
    }

    /** The app's TV banner as a JPEG: memory, then disk, then drawn fresh. */
    private fun bannerImage(pkg: String): ByteArray? {
        banners[pkg]?.let { return it }
        val ri = tvApps().firstOrNull { it.activityInfo.packageName == pkg } ?: return null
        val version = try { packageManager.getPackageInfo(pkg, 0).lastUpdateTime } catch (e: Exception) { 0L }
        val file = java.io.File(java.io.File(filesDir, "banners").apply { mkdirs() }, "$pkg-$version-v3.jpg")
        val bytes = if (file.exists()) file.readBytes() else bannerBytes(ri)?.also { file.writeBytes(it) }
        if (bytes != null) banners[pkg] = bytes
        return bytes
    }

    // ------------------------------------------------------------ Watch Next (keep watching with no computer)

    private val WATCH_NEXT = android.net.Uri.parse("content://android.media.tv/watch_next_program")
    private val READ_TV = "android.permission.READ_TV_LISTINGS"
    /** The picture addresses the Watch Next list gave us: the only ones the art route will fetch. */
    private val watchNextArtSeen = java.util.Collections.synchronizedSet(HashSet<String>())

    /** Asks once. Without it Android answers the Watch Next query with nothing. */
    private fun askWatchNextPermission() {
        if (checkSelfPermission(READ_TV) == PackageManager.PERMISSION_GRANTED) return
        if (prefs.getBoolean("askedWatchNext", false)) return
        prefs.edit().putBoolean("askedWatchNext", true).apply()
        try { requestPermissions(arrayOf(READ_TV), 77) } catch (e: Exception) {}
    }

    private fun readWatchNext(): JSONArray {
        val out = JSONArray()
        if (checkSelfPermission(READ_TV) != PackageManager.PERMISSION_GRANTED) return out
        try {
            val homeCfg = try {
                val raw = prefs.getString("config", null)
                if (raw != null) JSONObject(raw).optJSONObject("home") else null
            } catch (e: Exception) {
                null
            }
            val skipSet = HashSet<String>().apply {
                homeCfg?.optJSONArray("skip_watch_next")?.let { arr ->
                    for (i in 0 until arr.length()) {
                        val p = arr.optString(i)?.trim()
                        if (!p.isNullOrEmpty()) add(p)
                    }
                }
            }
            val perAppLimit = (homeCfg?.optInt("watch_next_per_app", 5) ?: 5).coerceIn(1, 20)
            val hiddenIds = prefs.getStringSet("hidden_watch_next_ids", emptySet()) ?: emptySet()

            val cols = arrayOf("_id", "package_name", "title", "episode_title", "season_display_number",
                "episode_display_number", "poster_art_uri", "thumbnail_uri", "last_playback_position_millis",
                "duration_millis", "last_engagement_time_utc_millis")
            contentResolver.query(WATCH_NEXT, cols, null, null, "last_engagement_time_utc_millis DESC")?.use { c ->
                val perApp = HashMap<String, Int>()
                while (c.moveToNext() && out.length() < 20) {
                    val rowId = c.getLong(0).toString()
                    val pkg = c.getString(1) ?: continue
                    val label = try {
                        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
                    } catch (e: Exception) { pkg }
                    val rawTitle = c.getString(2) ?: ""
                    val effectiveTitle = if (rawTitle.isNotBlank()) rawTitle else label
                    if (rowId in hiddenIds || "$pkg|$effectiveTitle" in hiddenIds || (rawTitle.isNotBlank() && "$pkg|$rawTitle" in hiddenIds)) continue
                    if (pkg == packageName || pkg in skipSet) continue
                    val n = (perApp[pkg] ?: 0) + 1
                    if (n > perAppLimit) continue
                    perApp[pkg] = n
                    val art = c.getString(7)?.takeIf { it.isNotBlank() } ?: c.getString(6)?.takeIf { it.isNotBlank() }
                    if (art != null) watchNextArtSeen.add(art)
                    val pos = c.getLong(8)
                    val dur = c.getLong(9)
                    out.put(JSONObject().apply {
                        put("id", c.getLong(0).toString())
                        put("wn", true)
                        put("title", c.getString(2) ?: label)
                        put("episode_title", c.getString(3) ?: "")
                        put("season", c.getString(4) ?: "")
                        put("episode", c.getString(5) ?: "")
                        if (art != null) put("backdrop", "http://tvos.invalid/art/" + android.util.Base64.encodeToString(
                            art.toByteArray(), android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING))
                        if (dur > 0 && pos > 0) put("progress", (pos.toDouble() / dur).coerceIn(0.0, 1.0))
                        put("app", JSONObject().put("package", pkg).put("name", label))
                        // for the bridge (POST /api/watch-next): which app, and when it was last watched,
                        // to name a play the app itself gave no title for (Netflix, issue #23)
                        put("package", pkg)
                        put("engaged", c.getLong(10))
                    })
                }
            }
        } catch (e: Exception) {
            // no provider or no permission: an empty row, never a crash
        }
        return out
    }

    private fun openWatchNextItem(id: String): Boolean {
        if (!Regex("[0-9]{1,18}").matches(id)) return false
        try {
            val cols = arrayOf("package_name", "intent_uri")
            val uri = android.content.ContentUris.withAppendedId(WATCH_NEXT, id.toLong())
            contentResolver.query(uri, cols, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return false
                val pkg = c.getString(0) ?: return false
                val raw = c.getString(1)
                if (raw != null) {
                    try {
                        val i = Intent.parseUri(raw, Intent.URI_INTENT_SCHEME)
                        // only ever open something in the app that owns the item
                        if (i.component != null && i.component!!.packageName != pkg) i.component = null
                        i.`package` = pkg
                        i.selector = null
                        if (i.resolveActivity(packageManager) != null && start(i)) return true
                    } catch (e: Exception) {}
                }
                return launchPackage(pkg)
            }
        } catch (e: Exception) {}
        return false
    }

    private var nativeSleepTimer: Runnable? = null
    private var nativeSleepEndMs: Long = 0L

    private fun dismissWatchNextItem(id: String, pkg: String, title: String): Boolean {
        if (id.isBlank() && pkg.isBlank()) return false
        return try {
            val hidden = prefs.getStringSet("hidden_watch_next_ids", emptySet())?.toMutableSet() ?: mutableSetOf()
            if (id.isNotBlank()) hidden.add(id)
            if (pkg.isNotBlank() && title.isNotBlank()) hidden.add("$pkg|$title")
            prefs.edit().putStringSet("hidden_watch_next_ids", hidden).apply()
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun setNativeSleepTimer(minutes: Int): Boolean {
        nativeSleepTimer?.let { main.removeCallbacks(it) }
        nativeSleepTimer = null
        if (minutes <= 0) {
            nativeSleepEndMs = 0L
            return true
        }
        nativeSleepEndMs = System.currentTimeMillis() + (minutes * 60 * 1000L)
        val runnable = Runnable {
            nativeSleepEndMs = 0L
            main.post {
                if (!startAmbientNow()) {
                    val i = Intent(AMBIENT_SETTINGS)
                    if (packageManager.resolveActivity(i, 0) != null) start(i)
                }
            }
        }
        nativeSleepTimer = runnable
        main.postDelayed(runnable, minutes * 60 * 1000L)
        return true
    }

    private fun getNativeSleepMinutes(): Int {
        if (nativeSleepEndMs <= 0L) return 0
        val diff = nativeSleepEndMs - System.currentTimeMillis()
        if (diff <= 0L) return 0
        return ((diff + 59999L) / 60000L).toInt()
    }

    /** The picture behind a Watch Next card: a web address or a content address the page cannot read itself. */
    private fun watchNextArt(token: String): ByteArray? {
        return try {
            val raw = String(android.util.Base64.decode(token, android.util.Base64.URL_SAFE))
            if (raw !in watchNextArtSeen) return null
            val u = android.net.Uri.parse(raw)
            when (u.scheme) {
                "http", "https" -> {
                    val c = URL(raw).openConnection() as HttpURLConnection
                    c.connectTimeout = 6000; c.readTimeout = 8000
                    c.inputStream.use { it.readBytes() }
                }
                "content", "android.resource" -> contentResolver.openInputStream(u)?.use { it.readBytes() }
                else -> null
            }
        } catch (e: Exception) { null }
    }

    private fun launchPackage(pkg: String): Boolean {
        val i = packageManager.getLeanbackLaunchIntentForPackage(pkg)
            ?: packageManager.getLaunchIntentForPackage(pkg)
            ?: return false
        return start(i)
    }

    /** The TV's Settings: Fire OS's own screen by name on a Fire TV (it stays open under the Home button watch, #75), else Android's Settings action. */
    private fun tvSettingsIntent(): Intent = FireWatch.amazonSettings(packageManager) ?: Intent(Settings.ACTION_SETTINGS)

    private fun start(i: Intent): Boolean = try {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        main.post { startActivity(i) }
        true
    } catch (e: Exception) {
        false
    }

    /** An app's drawable at the highest density it ships (null if it has none we can read). */
    private fun sharp(pkg: String, res: Int): android.graphics.drawable.Drawable? {
        if (res == 0) return null
        return try {
            packageManager.getResourcesForApplication(pkg).getDrawableForDensity(res, DisplayMetrics.DENSITY_XXXHIGH, null)
        } catch (e: Exception) { null }
    }

    private fun bannerBytes(ri: ResolveInfo): ByteArray? {
        val banner = sharp(ri.activityInfo.packageName, ri.activityInfo.bannerResource)
            ?: ri.activityInfo.loadBanner(packageManager)
            ?: ri.activityInfo.applicationInfo.loadBanner(packageManager)
        val bmp = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(FLAP)
        if (banner != null) {
            banner.setBounds(0, 0, 640, 360)
            banner.draw(c)
        } else {
            iconTile(sharp(ri.activityInfo.packageName, ri.activityInfo.iconResource) ?: ri.loadIcon(packageManager), c)
        }
        return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it); bmp.recycle() }.toByteArray()
    }

    /**
     * Apps with no TV banner still get a full-bleed tile, so the grid reads as one design: the
     * icon's own background fills the tile and its logo sits in the middle.
     */
    private fun iconTile(icon: Drawable, c: Canvas) {
        // the icon as a plain square, without the launcher's round mask
        val n = 432
        val sq = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val sc = Canvas(sq)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && icon is android.graphics.drawable.AdaptiveIconDrawable) {
            icon.background?.apply { setBounds(0, 0, n, n); draw(sc) }
            icon.foreground?.apply { setBounds(0, 0, n, n); draw(sc) }
        } else {
            icon.setBounds(0, 0, n, n)
            icon.draw(sc)
        }
        // find the logo: everything that differs from the icon's edge colour
        val edge = sq.getPixel(2, n / 2)
        var l = n; var t = n; var r = 0; var b = 0
        for (y in 0 until n step 2) for (x in 0 until n step 2) {
            val px = sq.getPixel(x, y)
            val d = Math.abs(Color.red(px) - Color.red(edge)) + Math.abs(Color.green(px) - Color.green(edge)) +
                Math.abs(Color.blue(px) - Color.blue(edge))
            if (d > 60 && Color.alpha(px) > 128) { l = minOf(l, x); t = minOf(t, y); r = maxOf(r, x); b = maxOf(b, y) }
        }
        if (r <= l || b <= t) { l = n / 4; t = n / 4; r = n * 3 / 4; b = n * 3 / 4 }
        // every logo about the same size: 150 px tall at most, 440 px wide at most
        val s = minOf(150f / (b - t), 440f / (r - l)).coerceIn(0.5f, 3f)
        val size = (n * s).toInt()
        val left = (320 - (l + r) / 2f * s).toInt()
        val top = (180 - (t + b) / 2f * s).toInt()
        // fill any gap with the icon's own edge colour, stretched, so the tile has no join
        c.drawColor(edge)
        val p = android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG)
        val rect = { a: Int, bb: Int, cc: Int, dd: Int -> android.graphics.Rect(a, bb, cc, dd) }
        if (left > 0) c.drawBitmap(sq, rect(1, 0, 2, n), rect(0, top, left, top + size), p)
        if (left + size < 640) c.drawBitmap(sq, rect(n - 2, 0, n - 1, n), rect(left + size, top, 640, top + size), p)
        if (top > 0) c.drawBitmap(sq, rect(0, 1, n, 2), rect(left, 0, left + size, top), p)
        if (top + size < 360) c.drawBitmap(sq, rect(0, n - 2, n, n - 1), rect(left, top + size, left + size, 360), p)
        c.drawBitmap(sq, null, rect(left, top, left + size, top + size), p)
        sq.recycle()
    }

    /** The app's square icon as a PNG, for the small badge on Keep watching tiles. */
    private fun iconImage(pkg: String): ByteArray? {
        icons[pkg]?.let { return it }
        val ri = tvApps().firstOrNull { it.activityInfo.packageName == pkg }
        // At 256 px from the sharpest icon the app ships: at the TV's own xhdpi most icons are 96 px
        // and looked soft on a big 4K screen (issue #17).
        val d = ri?.let { sharp(pkg, it.activityInfo.iconResource) } ?: ri?.loadIcon(packageManager)
            ?: try { packageManager.getApplicationIcon(pkg) } catch (e: Exception) { return null }
        val bmp = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, 256, 256)
        d.draw(Canvas(bmp))
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it); bmp.recycle() }.toByteArray()
        icons[pkg] = bytes
        return bytes
    }

    // ---------------------------------------------------------------- never stuck: the native grid

    private fun showFallback() {
        if (fallback != null) return
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(48), px(28), px(48), px(28))
        }
        column.addView(TextView(this).apply {
            text = "Home"
            setTextColor(CREAM)
            textSize = 34f
            typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        })
        column.addView(TextView(this).apply {
            text = "The bridge isn't answering, so shows and picks are hidden. Your apps still work."
            setTextColor(CREAM_2)
            textSize = 17f
            setPadding(0, px(4), 0, px(18))
        })
        val grid = GridLayout(this).apply { columnCount = 5 }
        val tiles = tvApps().map { ri -> ri.activityInfo.packageName to ri } + listOf("settings" to null)
        for ((pkg, ri) in tiles) {
            val tile = FrameLayout(this).apply {
                isFocusable = true
                isClickable = true
                background = GradientDrawable().apply { setColor(FLAP); cornerRadius = px(4).toFloat() }
                foreground = GradientDrawable().apply { cornerRadius = px(6).toFloat() }
                setOnFocusChangeListener { v, has ->
                    v.animate().scaleX(if (has) 1.08f else 1f).scaleY(if (has) 1.08f else 1f).setDuration(150).start()
                    (v.foreground as GradientDrawable).setStroke(if (has) px(3) else 0, AMBER)
                    v.elevation = if (has) px(8).toFloat() else 0f
                }
                setOnClickListener { if (ri == null) start(tvSettingsIntent()) else launchPackage(pkg) }
            }
            if (ri != null) {
                tile.addView(ImageView(this).apply {
                    val ai = ri.activityInfo
                    val b = ai.loadBanner(packageManager) ?: ai.applicationInfo.loadBanner(packageManager)
                    if (b != null) {
                        setImageDrawable(b); scaleType = ImageView.ScaleType.CENTER_CROP
                    } else {
                        setImageDrawable(ri.loadIcon(packageManager)); scaleType = ImageView.ScaleType.CENTER_INSIDE
                        setPadding(px(30), px(18), px(30), px(30))
                    }
                }, MATCH)
                if (ri.activityInfo.loadBanner(packageManager) == null && ri.activityInfo.applicationInfo.loadBanner(packageManager) == null) {
                    tile.addView(label(ri.loadLabel(packageManager).toString(), px(8)))
                }
            } else {
                tile.addView(label("Settings", px(8)))
            }
            grid.addView(tile, GridLayout.LayoutParams().apply {
                width = px(160); height = px(90)
                setMargins(px(9), px(9), px(9), px(9))
            })
        }
        column.addView(grid)
        val scroll = ScrollView(this).apply { isFillViewport = true; addView(column) }
        fallback = scroll
        root.addView(scroll, MATCH)
        grid.getChildAt(0)?.requestFocus()
    }

    private fun label(text: String, pad: Int) = TextView(this).apply {
        this.text = text
        setTextColor(CREAM)
        textSize = 15f
        gravity = Gravity.BOTTOM or Gravity.START
        setPadding(pad, pad, pad, pad)
        layoutParams = FrameLayout.LayoutParams(MATCH_W, MATCH_W)
    }

    private fun removeFallback() {
        fallback?.let { root.removeView(it) }
        fallback = null
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.decorView.windowInsetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
        }
    }

    companion object {
        /** A TV's name, as apply.sh passes it: small letters, digits and dashes. */
        private val TV_NAME = Regex("[a-z0-9-]{1,32}")

        private val INPUT_ACTIONS = listOf(
            "android.settings.TV_INPUT_SETTINGS",           // some Android TV builds
            "com.android.tv.action.VIEW_INPUTS",            // the Live Channels input picker
            "com.google.android.tv.action.VIEW_INPUTS",
            "android.media.tv.action.SETUP_INPUTS"          // the system list of TV inputs
        )
        private const val RETRY_MS = 15_000L
        private const val OFFLINE_RETRY_MS = 60_000L   // looking for the bridge while the saved copy shows
        private const val OFFLINE_HOST = "home.tvos.invalid"
        private const val BUNDLED = "www/tv"   // the built-in copy, in the app's assets
        private const val SLOW_MS = 2_500L
        private const val PICK_PHOTOS = 41
        // The screensaver: Google TV's Ambient mode settings (source and the Google Photos albums),
        // the short screen timeout the home sets for a moment, and what to put back afterwards.
        private const val AMBIENT_SETTINGS = "dreamx.two.panel.SETTINGS"
        private const val AMBIENT_DELAY_MS = 5000
        private const val SHORT_MS = 15_000
        private const val AMBIENT_RESTORE_MS = 600_000
        private const val AMBIENT_WINDOW_MS = 25_000L
        private const val MATCH_W = ViewGroup.LayoutParams.MATCH_PARENT
        private val MATCH = FrameLayout.LayoutParams(MATCH_W, MATCH_W)
        private val GROUND = Color.parseColor("#0D1E19")
        private val FLAP = Color.parseColor("#131614")
        private val CREAM = Color.parseColor("#F2EAD8")
        private val CREAM_2 = Color.parseColor("#BDB6A7")
        private val AMBER = Color.parseColor("#FFB52E")
    }
}
