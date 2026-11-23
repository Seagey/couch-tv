package dev.couchtv.ontv

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * "Update couch-tv" for the on-TV app (Home settings, About, and Updates), the page side shared with the
 * launcher's Updater.kt (window.TVUP), and the phone's TV setup page (/api/update). One request to
 * GitHub's API, no account, no key, nothing about the TV sent. Once a week while the home is on screen,
 * only after the household said yes to "Tell me about new versions" (asked once on the home); "Check for
 * updates now" looks straight away either way.
 *
 * "Update to ..." installs it, when the app's own ADB link to the TV is connected (Adb.kt): download from
 * GitHub, the launcher's checks, then ADB's shell user installs it (UpdateRules.installScript) and opens
 * Couch TV again. Nothing that fails a check is ever copied to the TV. Without the link, or after a try
 * that failed, the page shows the steps (UpdateRules.steps) and a QR code for them instead.
 */
object Update {
    private const val TAG = "couchtv.update"
    private const val STORE = "update"
    private const val WEEK_MS = 7 * 24 * 60 * 60 * 1000L
    private const val RETRY_MS = 60 * 60 * 1000L

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    // What is happening now (not kept): "" (nothing), "checking", "downloading", "installing".
    @Volatile private var busy = ""
    /** Something is downloading or installing (HomeKey waits for it, and Update waits for HomeKey). */
    val working: Boolean get() = busy.isNotEmpty()
    @Volatile private var progress = 0
    // Why the last try stopped: "" (it did not), "net", "bad", "other_key", "space", "adb", "failed".
    @Volatile private var error = ""
    // an install try failed: show the steps until the next check
    @Volatile private var failed = false
    @Volatile var listener: ((String) -> Unit)? = null

    private fun watch() = BuildConfig.BUILD_TYPE == "watch"
    private fun store(c: Context) = c.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** Can "Update to ..." install the release this TV knows about, here and now? */
    private fun canInstall(c: Context, available: Boolean): Boolean {
        if (!available) return false
        if (busy == "downloading" || busy == "installing") return true
        val s = store(c)
        if (failed || s.getString("other_key", "") == s.getString("latest", "")) return false
        val f = UpdateRules.Found("", "", true, s.getString("url", "") ?: "", s.getString("digest", "") ?: "", s.getLong("size", 0L))
        return f.installable && Adb.connected
    }

    fun state(c: Context): String {
        // Play: Google Play updates it. supported false: the home and the phone page show no update rows.
        if (!PlayRules.gitHubDownloads(BuildConfig.FLAVOR)) return JSONObject().put("supported", false)
            .put("current", BuildConfig.VERSION_NAME).put("available", false).put("can_install", false)
            .put("self", false).put("manual", false).put("how", PlayRules.UPDATES).put("steps", JSONArray()).toString()
        val s = store(c)
        val latest = s.getString("latest", "") ?: ""
        val w = watch()
        val available = UpdateRules.offered(latest, BuildConfig.VERSION_NAME, s.getBoolean("has_asset", false))
        val can = canInstall(c, available)
        return JSONObject()
            .put("supported", true)
            .put("current", BuildConfig.VERSION_NAME)
            .put("channel", "stable")
            .put("latest", latest)
            .put("title", s.getString("title", "") ?: "")
            .put("available", available)
            .put("refused", false)
            .put("checked", s.getLong("checked", 0L))
            .put("auto", s.getBoolean("auto", false))
            .put("answered", s.contains("auto"))
            .put("busy", busy)
            .put("progress", progress)
            .put("error", error)
            // it installs by itself, over its own ADB link (no Android "update this app?" screen)
            .put("can_install", can)
            .put("self", true)
            // the version an update put on, once it is running: the page says "Updated to ..." once
            .put("updated", if (s.getString("pending", "") == BuildConfig.VERSION_NAME) BuildConfig.VERSION_NAME else "")
            // it cannot install now: the page shows these steps, and the QR code for them, instead of "Update to ..."
            .put("manual", !can)
            .put("help_url", UpdateRules.HELP_URL)
            .put("code", if (w) "" else UpdateRules.CODE)
            .put("how", UpdateRules.how(w))
            .put("steps", JSONArray(UpdateRules.steps(w)))
            .toString()
    }

    private fun changed(c: Context) {
        val json = state(c)
        main.post { listener?.invoke(json) }
    }

    fun setAuto(c: Context, on: Boolean) {
        store(c).edit().putBoolean("auto", on).apply()
        changed(c)
        if (on) checkIfDue(c.applicationContext)
    }

    /** From HomeActivity.onResume: the weekly look, only when it is switched on and due. */
    fun resumed(c: Context) = checkIfDue(c.applicationContext)

    private fun checkIfDue(c: Context) {
        val s = store(c)
        val now = System.currentTimeMillis()
        if (!s.getBoolean("auto", false) || busy.isNotEmpty()) return
        if (now - s.getLong("checked", 0L) < WEEK_MS || now - s.getLong("tried", 0L) < RETRY_MS) return
        check(c, false)
    }

    @Synchronized fun check(c: Context, manual: Boolean) {
        val app = c.applicationContext
        if (busy.isNotEmpty() || !PlayRules.gitHubDownloads(BuildConfig.FLAVOR)) return
        busy = "checking"
        if (manual) { error = ""; failed = false }
        changed(app)
        io.execute {
            val s = store(app)
            s.edit().putLong("tried", System.currentTimeMillis()).apply()
            try {
                val f = UpdateRules.read(fetch("https://api.github.com/repos/${UpdateRules.REPO}/releases/latest"), watch())
                val e = s.edit().putLong("checked", System.currentTimeMillis())
                if (f != null) {
                    if (f.version != s.getString("latest", "")) { e.remove("other_key"); failed = false }
                    e.putString("latest", f.version).putString("title", f.title).putBoolean("has_asset", f.hasAsset)
                        .putString("url", f.url).putString("digest", f.digest).putLong("size", f.size)
                }
                e.apply()
                error = ""
            } catch (x: Exception) {
                if (manual) error = "net"
            }
            busy = ""
            changed(app)
            // a copy an earlier try left on the TV goes, whenever nothing is installing (review, L3)
            if (Adb.connected && busy.isEmpty()) {
                runCatching { Adb.shell("rm -f ${UpdateRules.TMP_APK} ${UpdateRules.TMP_LOG}", 8000) }
            }
            File(app.cacheDir, "update").deleteRecursively()
        }
    }

    /**
     * "Update to ...": download, check, copy to the TV, install over the app's own ADB link. Android stops
     * this app while it replaces it; the shell line on the TV opens Couch TV again (only if it is on
     * screen when the install starts).
     */
    @Synchronized fun install(c: Context) {
        val app = c.applicationContext
        val s = store(app)
        val latest = s.getString("latest", "") ?: ""
        val available = UpdateRules.offered(latest, BuildConfig.VERSION_NAME, s.getBoolean("has_asset", false))
        if (busy.isNotEmpty() || HomeKey.working || !canInstall(app, available) || !PlayRules.gitHubDownloads(BuildConfig.FLAVOR)) return
        val url = s.getString("url", "") ?: ""
        val digest = s.getString("digest", "") ?: ""
        val size = s.getLong("size", 0L)
        busy = "downloading"
        progress = 0
        error = ""
        changed(app)
        io.execute {
            val dir = File(app.cacheDir, "update").apply { mkdirs() }
            val file = File(dir, UpdateRules.asset(watch()))
            // room for the download, the copy on the TV, Android's own staged copy and the native libraries
            // it unpacks (UpdateRules.spaceNeeded), or a full TV is told plainly instead of "Can't reach
            // GitHub" (review, F1)
            val needed = UpdateRules.spaceNeeded(size, Build.SUPPORTED_ABIS.firstOrNull())
            var why = if (dir.usableSpace < needed) "space" else try {
                download(url, file, size) { p -> progress = p; changed(app) }
                verify(app, file, digest, size)
            } catch (x: Exception) {
                Log.w(TAG, "download: ${x.message}")
                if (UpdateRules.failure(x.message ?: "") == "space") "space" else "net"
            }
            if (why.isEmpty()) {
                busy = "installing"
                progress = 100
                changed(app)
                why = try { put(app, file, latest) } catch (x: Exception) {
                    Log.w(TAG, "install: ${x.message}")
                    if (x.message?.startsWith("push failed") == true) UpdateRules.failure(x.message ?: "") else "adb"
                }
            }
            // another key, from the file's own signer or from what pm said (review, L4)
            if (why == "other_key") s.edit().putString("other_key", latest).apply()
            file.delete()
            if (why.isNotEmpty()) {
                s.edit().remove("pending").apply()
                if (why != "net") failed = true   // the steps instead, until the next check
            }
            busy = ""
            progress = 0
            error = if (why == "not_newer") "" else why
            changed(app)
        }
    }

    /**
     * Copies the checked file to the TV and installs it there as ADB's shell user. "" once it says
     * Success (Android is about to stop this app), else why not.
     */
    private fun put(app: Context, file: File, latest: String): String {
        if (!Adb.connected && !Adb.ensure()) return "adb"
        // first: wakes a stale link (Adb reconnects once), and clears what an earlier try left (review, L2)
        Adb.shell("rm -f ${UpdateRules.TMP_APK} ${UpdateRules.TMP_LOG}", 8000)
        Adb.push(file, UpdateRules.TMP_APK)
        file.delete()   // the app's copy goes as soon as the TV has its own, so pm's staging has the room
        store(app).edit().putString("pending", latest).commit()
        // read now, not when Update was pressed: someone may have gone back to a show meanwhile (review, L1)
        Adb.shell(UpdateRules.installScript(app.packageName, App.inForeground), 15_000)
        val until = System.currentTimeMillis() + 5 * 60_000L
        while (System.currentTimeMillis() < until) {
            Thread.sleep(1000)
            val out = runCatching { Adb.shell("cat ${UpdateRules.TMP_LOG} 2>/dev/null", 8000) }.getOrDefault("")
            val r = UpdateRules.installResult(out) ?: continue
            if (r.isNotEmpty()) Log.w(TAG, "pm install: ${out.trim().take(300)}")
            return r
        }
        runCatching { Adb.shell("rm -f ${UpdateRules.TMP_APK}", 8000) }
        return "failed"
    }

    // ---------------------------------------------------------------- GitHub (the launcher's rules)

    internal fun fetch(url: String): String {
        val con = connect(url, true)
        try {
            return con.inputStream.bufferedReader().use { it.readText().take(2_000_000) }
        } finally { con.disconnect() }
    }

    /** https on github.com, api.github.com and GitHub's download hosts only, each redirect checked by hand. */
    private fun connect(start: String, json: Boolean): HttpURLConnection {
        var u = URL(start)
        for (hop in 0 until 6) {
            if (u.protocol != "https" || !UpdateRules.gitHubHost(u.host)) throw IOException("not GitHub")
            val con = u.openConnection() as HttpURLConnection
            con.instanceFollowRedirects = false
            con.connectTimeout = 10_000; con.readTimeout = 20_000
            con.setRequestProperty("User-Agent", "couch-tv-ontv")
            if (json) con.setRequestProperty("Accept", "application/vnd.github+json")
            val code = con.responseCode
            if (code in 300..399) {
                val next = con.getHeaderField("Location")
                con.disconnect()
                u = URL(u, next ?: throw IOException("redirect without an address"))
                continue
            }
            if (code !in 200..299) { con.disconnect(); throw IOException("HTTP $code") }
            return con
        }
        throw IOException("too many redirects")
    }

    /** Downloads a GitHub file, never more than size bytes; onProgress gets the percentage every 5 points. */
    internal fun download(url: String, file: File, size: Long, onProgress: (Int) -> Unit) {
        val con = connect(url, false)
        try {
            var done = 0L
            var shown = -1
            con.inputStream.use { inp ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (done > size) throw IOException("bigger than GitHub said")
                        val p = (done * 100 / size).toInt()
                        if (p >= shown + 5) { shown = p; onProgress(p) }
                    }
                }
            }
        } finally { con.disconnect() }
    }

    // ---------------------------------------------------------------- the checks (the launcher's)

    /**
     * "" when the file may be installed, else why not ("bad", "other_key", "not_newer"). sameOk: the same
     * version may go on too (HomeKey: the watch APK of this very version only adds the Home button watch).
     */
    internal fun verify(c: Context, file: File, digest: String, size: Long, sameOk: Boolean = false): String {
        if (size <= 0 || file.length() != size) return "bad"
        if (digest.isEmpty() || sha256(file) != digest) return "bad"
        val pm = c.packageManager
        @Suppress("DEPRECATION") val flag = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val mine = pm.getPackageInfo(c.packageName, flag)
        val theirs = pm.getPackageArchiveInfo(file.path, flag) ?: return "bad"
        if (theirs.packageName != c.packageName) return "bad"
        if (if (sameOk) !HomeKeyRules.versionOk(versionCode(theirs), versionCode(mine)) else versionCode(theirs) <= versionCode(mine)) return "not_newer"
        val a = signers(mine) { pm.getPackageInfo(c.packageName, it) }
        val b = signers(theirs) { pm.getPackageArchiveInfo(file.path, it) }
        // Some Android 9 builds read no signer from a file that is not installed yet: then Android's
        // installer makes the same check and says no itself (INSTALL_FAILED_UPDATE_INCOMPATIBLE).
        // A file that rotated from this app's key to a newer one (its history lists ours) is an update too.
        if (!UpdateRules.signerOk(a, b, history(theirs))) return "other_key"
        return ""
    }

    /** The file's signing certificate history (oldest first), Android 9 and newer; empty when there is none. */
    private fun history(p: PackageInfo): List<String> =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) emptyList()
        else runCatching {
            val s = p.signingInfo
            if (s == null || s.hasMultipleSigners()) emptyList() else s.signingCertificateHistory?.map { it.toCharsString() } ?: emptyList()
        }.getOrDefault(emptyList())

    private fun signers(p: PackageInfo, again: (Int) -> PackageInfo?): Set<String> {
        val list: Array<Signature>? = (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p.signingInfo?.apkContentsSigners else null)
            ?: try { @Suppress("DEPRECATION") again(PackageManager.GET_SIGNATURES)?.signatures } catch (e: Exception) { null }
        return list?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    private fun versionCode(p: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) p.longVersionCode else @Suppress("DEPRECATION") p.versionCode.toLong()

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { inp ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = inp.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** window.TVUP for the home page. Only the app's own page (base/tv/) may start a check or an update. */
    class Page(c: Context, private val web: WebView, private val base: String) {
        private val app = c.applicationContext
        init { listener = { json -> runCatching { web.evaluateJavascript("window.tv && tv.update && tv.update($json)", null) } } }
        @JavascriptInterface fun state(): String {
            val json = Update.state(app)
            // the page has had "Updated to ..." (it says it once): let it go a moment later (review, L3)
            if (JSONObject(json).optString("updated").isNotEmpty()) main.postDelayed({ store(app).edit().remove("pending").apply() }, 10_000)
            return json
        }
        @JavascriptInterface fun check() { main.post { if (trusted()) Update.check(app, true) } }
        @JavascriptInterface fun install() { main.post { if (trusted()) Update.install(app) } }
        @JavascriptInterface fun auto(on: Boolean) { main.post { if (trusted()) setAuto(app, on) } }
        private fun trusted(): Boolean = web.url?.startsWith("$base/tv/") == true
    }
}
