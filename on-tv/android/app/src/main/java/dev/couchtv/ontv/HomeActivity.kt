package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * The TV home screen: the same page as the computer-bridge mode (tv-home/web), served by this
 * app's own server at 127.0.0.1. It is the home screen only when "Use as home screen" is switched
 * on in setup (the HOME filter is on an alias that is off by default).
 */
class HomeActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var ready = false
    private val banners = ConcurrentHashMap<String, ByteArray>()
    private val icons = ConcurrentHashMap<String, ByteArray>()
    private val base get() = "http://127.0.0.1:${Store.port}"

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        App.startService(this)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setCookie(base, "couchtv_token=${Auth.internalToken}; path=/")
        val w = makeWeb()
        web = w
        shown = java.lang.ref.WeakReference(this)
        setContentView(w)
        hideBars()
        load()
    }

    /**
     * Low-memory TVs (1 GB): BridgeService keeps this process important, so Android never reclaims
     * the home page while another app is in front. Only when Android says memory is critical, and
     * the page is out of sight, drop the WebView; onStart builds it again. No timer, so normal use
     * never pays for a rebuild. The activity stays, so Back still lands here.
     */
    private fun release() {
        val w = web ?: return
        if (front || isFinishing || isDestroyed) return
        web = null; ready = false
        banners.clear(); icons.clear()
        setContentView(View(this).apply { setBackgroundColor(GROUND) })
        w.stopLoading(); w.removeAllViews(); w.destroy()
        android.util.Log.i("couchtv.home", "home page released (memory critical)")
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        // Only the most severe states: RUNNING_CRITICAL (this process runs a service) or COMPLETE (cached).
        // On a 1 GB TV, RUNNING_LOW arrives every time YouTube or Netflix starts; releasing then made every
        // return take 3 to 7 seconds, so it is left alone, as are UI_HIDDEN and RUNNING_MODERATE.
        if (level == TRIM_MEMORY_RUNNING_CRITICAL || level >= TRIM_MEMORY_COMPLETE) release()
    }

    override fun onStart() { super.onStart(); rebuildIfReleased() }

    /** Also called from onResume: the page can be released while this activity is paused but not stopped
     *  (partly covered), and then onStart never runs again, so it would stay blank. */
    private fun rebuildIfReleased() {
        if (web != null || isFinishing || isDestroyed) return
        val w = makeWeb()
        web = w
        setContentView(w)
        hideBars()
        load()
    }

    private fun makeWeb(): WebView = WebView(this).apply {
            setBackgroundColor(GROUND)
            isFocusable = true; isFocusableInTouchMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100
            addJavascriptInterface(Native(), "TVOS")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) { ready = true; view.requestFocus() }
                override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                    // The server may still be starting: try again shortly.
                    if (req.isForMainFrame) { ready = false; main.postDelayed({ load() }, 700) }
                }
                // Only the home page itself may load here: its restart() (a new look, scenes, timer)
                // reloads it with location.replace, which was cancelled along with everything else.
                override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest) = !req.url.toString().startsWith("$base/tv/")
                override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                    val u = req.url
                    if (u.host != "tvos.invalid") return null
                    // a Watch Next card's picture the page cannot load itself (WatchNext.art, #122)
                    if (u.pathSegments.firstOrNull() == "art") {
                        val b = WatchNext.art(u.lastPathSegment ?: "") ?: return null
                        return WebResourceResponse("image/jpeg", null, ByteArrayInputStream(b))
                    }
                    val pkg = u.lastPathSegment ?: return null
                    val isIcon = u.pathSegments.firstOrNull() == "icon"
                    val img = (if (isIcon) iconImage(pkg) else bannerImage(pkg)) ?: return null
                    return WebResourceResponse(if (isIcon) "image/png" else "image/jpeg", null, ByteArrayInputStream(img))
                }
            }
        }

    private fun load() { web?.loadUrl("$base/tv/") }

    override fun onResume() { super.onResume(); front = true; rebuildIfReleased(); hideBars(); if (ready) js("window.tv && tv.resume()") }
    // the video background stops while an app is in front
    override fun onPause() { super.onPause(); front = false; js("window.tv && tv.pause && tv.pause()") }
    @Volatile private var front = false
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); js("window.tv && tv.home()") }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        if (e.keyCode == KeyEvent.KEYCODE_BACK) { if (e.action == KeyEvent.ACTION_UP && ready) js("window.tv && tv.back()"); return true }
        // Long press MENU opens setup, so the home screen can always reach it. Android marks a long
        // press on the repeated key down while the button is held (repeat 1, FLAG_LONG_PRESS), never
        // on the key up, so the old check on the key up never matched. The page opens a card's menu
        // on a short MENU press, so the press is held back until it is known: held, setup opens and
        // the page sees nothing; let go before that, the page gets the whole press then.
        if (e.keyCode == KeyEvent.KEYCODE_MENU) {
            when {
                e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0 -> menuHeld = false
                e.action == KeyEvent.ACTION_DOWN -> if (!menuHeld) {
                    menuHeld = true
                    // Kids mode: a kids profile cannot reach setup; a parent switches profile with the PIN first
                    if (!Kids.isKid(Now.who)) startActivity(Intent(this, SetupActivity::class.java))
                }
                e.action == KeyEvent.ACTION_UP && !menuHeld -> {
                    super.dispatchKeyEvent(KeyEvent.changeAction(e, KeyEvent.ACTION_DOWN))
                    return super.dispatchKeyEvent(e)
                }
            }
            return true
        }
        return super.dispatchKeyEvent(e)
    }
    private var menuHeld = false

    private fun js(code: String) { web?.takeIf { ready }?.evaluateJavascript(code, null) }

    private fun hideBars() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.decorView.windowInsetsController?.let {
                it.hide(WindowInsets.Type.systemBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            // Android 9 and 10 (many Fire TV sticks and older Android TVs) only have the old flags
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    // ---------------------------------------------------------------- what the page can ask for (window.TVOS)

    inner class Native {
        @JavascriptInterface fun apps(): String {
            val out = JSONArray()
            for (ri in tvApps()) {
                val ai = ri.activityInfo
                out.put(JSONObject().put("package", ai.packageName).put("label", ri.loadLabel(packageManager).toString())
                    .put("hasBanner", ai.banner != 0 || ai.applicationInfo.banner != 0))
            }
            return out.toString()
        }
        @JavascriptInterface fun launch(pkg: String): Boolean {
            val i = Tv.launchIntent(pkg) ?: return false
            main.post { runCatching { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            return true
        }
        @JavascriptInterface fun openSettings(): Boolean = runCatching { Tv.openSettings() }.isSuccess
        /** A Keep watching card from Android's Watch Next rows (#122): the page opens it here, as the TV home app does. */
        @JavascriptInterface fun openWatchNext(id: String): Boolean = runCatching { WatchNext.open(id) }.getOrDefault(false)
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME
        @JavascriptInterface fun keep(key: String, value: String) { getSharedPreferences("page", MODE_PRIVATE).edit().putString(key, value).apply() }
        @JavascriptInterface fun kept(key: String): String? = getSharedPreferences("page", MODE_PRIVATE).getString(key, null)
        @JavascriptInterface fun setScreenOff(off: Boolean): Boolean {
            main.post {
                runCatching {
                    val lp = window.attributes
                    lp.screenBrightness = if (off) 0.0f else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    window.attributes = lp
                }
            }
            return true
        }
        @JavascriptInterface fun powerOff(): Boolean {
            Thread { runCatching { Tv.powerOff() } }.start()
            return true
        }
    }

    private fun tvApps(): List<ResolveInfo> = Tv.tvLaunchables().filter { it.activityInfo.packageName != packageName }
        .sortedBy { it.loadLabel(packageManager).toString().lowercase() }

    // ---------------------------------------------------------------- app tiles (same drawing as the computer-bridge launcher)

    private fun bannerImage(pkg: String): ByteArray? {
        banners[pkg]?.let { return it }
        val ri = tvApps().firstOrNull { it.activityInfo.packageName == pkg } ?: return null
        val bmp = Bitmap.createBitmap(640, 360, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(FLAP)
        val banner = sharp(ri.activityInfo.packageName, ri.activityInfo.bannerResource) ?: ri.activityInfo.loadBanner(packageManager)
            ?: ri.activityInfo.applicationInfo.loadBanner(packageManager)
        if (banner != null) { banner.setBounds(0, 0, 640, 360); banner.draw(c) }
        else iconTile(sharp(ri.activityInfo.packageName, ri.activityInfo.iconResource) ?: ri.loadIcon(packageManager), c)
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it); bmp.recycle() }.toByteArray()
        banners[pkg] = bytes
        return bytes
    }

    private fun iconTile(icon: Drawable, c: Canvas) {
        val n = 432
        val sq = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val sc = Canvas(sq)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && icon is AdaptiveIconDrawable) {
            icon.background?.apply { setBounds(0, 0, n, n); draw(sc) }; icon.foreground?.apply { setBounds(0, 0, n, n); draw(sc) }
        } else { icon.setBounds(0, 0, n, n); icon.draw(sc) }
        val edge = sq.getPixel(2, n / 2)
        c.drawColor(edge)
        val size = 220
        c.drawBitmap(sq, null, android.graphics.Rect(320 - size / 2, 180 - size / 2, 320 + size / 2, 180 + size / 2), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        sq.recycle()
    }

    // The dock's app icons. Drawn at 256 px from the app's sharpest icon (xxxhdpi where it has one),
    // not the TV's own density: a TV runs at xhdpi, where most icons are 96 px, and those looked soft
    // stretched over a dock tile on a big 4K screen (issue #17).
    private fun iconImage(pkg: String): ByteArray? {
        icons[pkg]?.let { return it }
        val ri = tvApps().firstOrNull { it.activityInfo.packageName == pkg }
        val d = ri?.let { sharp(pkg, it.activityInfo.iconResource) }
            ?: try { sharp(pkg, packageManager.getApplicationInfo(pkg, 0).icon) ?: packageManager.getApplicationIcon(pkg) } catch (e: Exception) { return null }
        val n = 256
        val bmp = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        d.setBounds(0, 0, n, n); d.draw(Canvas(bmp))
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it); bmp.recycle() }.toByteArray()
        icons[pkg] = bytes
        return bytes
    }

    /** An app's drawable at the highest density it ships (null if it has none we can read). */
    private fun sharp(pkg: String, res: Int): Drawable? {
        if (res == 0) return null
        return try {
            packageManager.getResourcesForApplication(pkg).getDrawableForDensity(res, DisplayMetrics.DENSITY_XXXHIGH, null)
        } catch (e: Exception) { null }
    }

    override fun onDestroy() {
        if (shown?.get() === this) shown = null
        web?.let { web = null; it.stopLoading(); it.destroy() }
        super.onDestroy()
    }

    companion object {
        @Volatile private var shown: java.lang.ref.WeakReference<HomeActivity>? = null

        /**
         * Shows settings saved by a phone or a setup tool straight away (#96). The home page reads
         * them again only in tv.resume(), when it comes back on screen, so after a save from
         * another device the dock and weather stayed as they were until Home was pressed.
         * Only while the home is on screen: behind another app, tv.resume() would start the
         * background video under it, and onResume reads everything again anyway. Saves that come
         * close together (a phone saving several things) make one refresh, not one each.
         */
        fun refresh() {
            refresher.removeCallbacks(refreshNow)
            refresher.postDelayed(refreshNow, 400)
        }

        /** What onNewIntent does, for when the home came back without a new intent (FireHome.bringForward). */
        fun home() {
            refresher.post { shown?.get()?.takeIf { !it.isFinishing && !it.isDestroyed }?.js("window.tv && tv.home()") }
        }

        private val refresher = Handler(Looper.getMainLooper())
        private val refreshNow = Runnable {
            val a = shown?.get()
            if (a != null && a.front && !a.isFinishing && !a.isDestroyed) a.js("window.tv && tv.resume()")
        }

        private val GROUND = Color.parseColor("#0D1E19")
        private val FLAP = Color.parseColor("#131614")
    }
}
