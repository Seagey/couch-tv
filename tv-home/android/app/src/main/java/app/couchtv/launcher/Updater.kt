package app.couchtv.launcher

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Updates from couch-tv's own GitHub releases (Home settings, Updates). Once a day, while the home
 * is on screen, the app asks GitHub which release is the latest (one request, no account, no key);
 * "Check now" in Home settings asks straight away. A release newer than this app puts a dot on the
 * gear tile and offers "Update to ...". Nothing is installed without the person at the TV: OK
 * downloads couch-tv-home.apk from that release, checks it, and hands it to Android's own
 * installer, which asks "Do you want to update this app?" first. The daily check can be switched
 * off there too.
 *
 * Before Android's installer ever sees the file:
 *   - it came over https from github.com and GitHub's own download hosts, and nowhere else;
 *   - its size and SHA-256 are the ones GitHub lists for that release's asset;
 *   - it is this app (app.couchtv.launcher), newer than this one (a higher versionCode), and signed
 *     with the same key.
 * Android refuses an update signed with another key anyway; checking first means a copy built on
 * another computer (your own scenes, a test build) is told so plainly instead of failing in the
 * installer. Same app and same key, so everything the app keeps (Home settings, people, photos,
 * the smart home section) stays.
 *
 * Which releases: BuildConfig.UPDATE_REPO (-PupdateRepo=owner/name at build time, Seagey/couch-tv
 * by default). An empty value switches updates off for that build.
 */
object Updater {
    private const val STORE = "update"
    private const val ASSET = "couch-tv-home.apk"
    private const val DAY_MS = 24 * 60 * 60 * 1000L
    private const val RETRY_MS = 60 * 60 * 1000L   // a daily check that failed (no Wi-Fi yet) tries again an hour later
    private const val RESULT = "app.couchtv.launcher.UPDATE_RESULT"
    private const val OFFLINE_HOST = "home.tvos.invalid"   // the launcher's own copy of the page
    private val REPO = Regex("[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")
    private val SHA256 = Regex("[0-9a-f]{64}")

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    // What is happening now (not kept): "" (nothing), "checking", "downloading", "installing".
    @Volatile private var busy = ""
    @Volatile private var progress = 0
    // Why the last try stopped: "" (it did not), "net", "bad", "other_key", "allow", "cancelled", "failed".
    @Volatile private var error = ""
    // Android's "update this app?" screen was shown and has not answered yet
    @Volatile private var asking = false

    /** Called on the main thread with the new state (JSON) whenever it changes. Set by Page. */
    @Volatile var listener: ((String) -> Unit)? = null

    private fun store(ctx: Context) = ctx.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun repo(): String? = BuildConfig.UPDATE_REPO.takeIf { REPO.matches(it) }
    private fun current(): String = BuildConfig.VERSION_NAME

    /** True when version a is newer than b ("v0.4" > "0.3", "0.10" > "0.9"). */
    fun newer(a: String, b: String): Boolean {
        val x = parts(a)
        val y = parts(b)
        for (i in 0 until maxOf(x.size, y.size)) {
            val p = x.getOrElse(i) { 0 }
            val q = y.getOrElse(i) { 0 }
            if (p != q) return p > q
        }
        return false
    }

    private fun parts(v: String) = v.trim().removePrefix("v").split('.', '-', '+')
        .map { s -> s.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }

    /** Everything the page shows in Home settings, Updates. */
    fun state(ctx: Context): String {
        val s = store(ctx)
        val latest = s.getString("latest", "") ?: ""
        val refused = latest.isNotEmpty() && s.getString("other_key", "") == latest
        // a release whose app turned out to be no newer than this one (its versionCode not raised)
        val stale = latest.isNotEmpty() && s.getString("not_newer", "") == latest
        val offered = latest.isNotEmpty() && newer(latest, current()) && !s.getString("url", "").isNullOrEmpty() && !refused && !stale
        return JSONObject()
            .put("supported", repo() != null)
            .put("current", current())
            .put("latest", latest)
            .put("title", s.getString("title", "") ?: "")
            .put("available", offered)
            .put("refused", refused && newer(latest, current()))   // that release is signed with another key
            .put("checked", s.getLong("checked", 0L))
            .put("auto", s.getBoolean("auto", true))
            .put("busy", busy)
            .put("progress", progress)
            .put("error", error)
            .toString()
    }

    private fun changed(ctx: Context) {
        val json = state(ctx)
        main.post { listener?.invoke(json) }
    }

    fun setAuto(ctx: Context, on: Boolean) {
        store(ctx).edit().putBoolean("auto", on).apply()
        changed(ctx)
    }

    /**
     * From MainActivity.onResume. The home is back in front: if Android's "update this app?" screen
     * closed without a word (some TVs say nothing when Back is pressed there), the update counts as
     * cancelled after a moment; back from Android's "install unknown apps" switch with it on, the
     * note asking for it goes. Then the daily check, only when it is due and switched on.
     */
    fun resumed(ctx: Context) {
        val app = ctx.applicationContext
        if (busy == "installing" && asking) main.postDelayed({ if (busy == "installing" && asking) finish(app, "cancelled") }, 4000)
        if (error == "allow" && app.packageManager.canRequestPackageInstalls()) { error = ""; changed(app) }
        checkIfDue(app)
    }

    private fun checkIfDue(ctx: Context) {
        val s = store(ctx)
        val now = System.currentTimeMillis()
        if (repo() == null || !s.getBoolean("auto", true) || busy.isNotEmpty()) return
        if (now - s.getLong("checked", 0L) < DAY_MS || now - s.getLong("tried", 0L) < RETRY_MS) return
        check(ctx, false)
    }

    /** Asks GitHub for the latest release. manual: "Check now", so a failure is shown. */
    fun check(ctx: Context, manual: Boolean) {
        val app = ctx.applicationContext
        val repo = repo() ?: return
        if (busy.isNotEmpty()) return
        busy = "checking"
        if (manual) error = ""
        changed(app)
        io.execute {
            val s = store(app)
            s.edit().putLong("tried", System.currentTimeMillis()).apply()
            try {
                val j = JSONObject(open("https://api.github.com/repos/$repo/releases/latest", json = true).use { it.readText() })
                val tag = j.getString("tag_name").trim()
                var url = ""
                var digest = ""
                var size = 0L
                val assets = j.optJSONArray("assets")
                for (i in 0 until (assets?.length() ?: 0)) {
                    val a = assets!!.getJSONObject(i)
                    if (a.optString("name") != ASSET) continue
                    // only a file of this release, on this repo's own release download address
                    url = a.optString("browser_download_url").takeIf { it.startsWith("https://github.com/$repo/releases/download/") } ?: ""
                    digest = a.optString("digest").removePrefix("sha256:").lowercase().takeIf { SHA256.matches(it) } ?: ""
                    size = a.optLong("size", 0L)
                }
                val latest = tag.removePrefix("v")
                val e = s.edit().putLong("checked", System.currentTimeMillis())
                    .putString("latest", latest).putString("title", j.optString("name").trim().take(120))
                    .putString("url", url).putString("digest", digest).putLong("size", size)
                // a release is no longer refused (another key, or no newer inside) once a newer one comes out
                if (s.getString("other_key", "") != latest) e.remove("other_key")
                if (s.getString("not_newer", "") != latest) e.remove("not_newer")
                e.apply()
                error = ""
            } catch (x: Exception) {
                if (manual) error = "net"
            }
            busy = ""
            changed(app)
            // an update installed earlier leaves its copy behind: tidy it away
            if (!newer(s.getString("latest", "") ?: "", current())) File(app.cacheDir, "update").deleteRecursively()
        }
    }

    /** "Update to ...": download, check, then Android's installer asks the person at the TV. */
    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val s = store(app)
        val url = s.getString("url", "") ?: ""
        val latest = s.getString("latest", "") ?: ""
        if (busy.isNotEmpty() || repo() == null || url.isEmpty() || !newer(latest, current())) return
        val pm = app.packageManager
        if (!pm.canRequestPackageInstalls()) {
            // Android's "install unknown apps" switch for this app, where the TV has that screen.
            // Either way the page says where it is, and to press Update again afterwards.
            error = "allow"
            changed(app)
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (i.resolveActivity(pm) != null) main.post { try { app.startActivity(i) } catch (e: Exception) {} }
            return
        }
        busy = "downloading"
        progress = 0
        error = ""
        changed(app)
        io.execute {
            val file = File(File(app.cacheDir, "update").apply { mkdirs() }, ASSET)
            val why = try {
                download(app, url, file, s.getLong("size", 0L))
                verify(app, file, s.getString("digest", "") ?: "", s.getLong("size", 0L))
            } catch (x: Exception) {
                "net"
            }
            if (why.isNotEmpty()) {
                file.delete()
                if (why == "other_key") s.edit().putString("other_key", latest).apply()
                // the same app again: not offered any more, and nothing to say but "the latest"
                if (why == "not_newer") s.edit().putString("not_newer", latest).apply()
                finish(app, if (why == "not_newer") "" else why)
                return@execute
            }
            try {
                busy = "installing"
                changed(app)
                commit(app, file)
            } catch (x: Exception) {
                finish(app, "failed")
            }
        }
    }

    private fun finish(ctx: Context, why: String) {
        asking = false
        busy = ""
        progress = 0
        error = why
        changed(ctx)
    }

    // ---------------------------------------------------------------- GitHub

    /**
     * An https address on GitHub, following its redirects by hand so each hop is checked: only
     * github.com, api.github.com and GitHub's download hosts (*.githubusercontent.com).
     */
    private fun open(start: String, json: Boolean = false): java.io.BufferedReader = connect(start, json).let { c ->
        java.io.BufferedReader(java.io.InputStreamReader(c.inputStream, Charsets.UTF_8))
    }

    private fun connect(start: String, json: Boolean): HttpURLConnection {
        var u = URL(start)
        for (hop in 0 until 6) {
            if (u.protocol != "https" || !gitHub(u.host)) throw IOException("not GitHub")
            val c = u.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 8000
            c.readTimeout = 20000
            c.setRequestProperty("User-Agent", "couch-tv/" + current())
            if (json) c.setRequestProperty("Accept", "application/vnd.github+json")
            val code = c.responseCode
            if (code in 300..399) {
                val next = c.getHeaderField("Location")
                c.disconnect()
                u = URL(u, next ?: throw IOException("redirect without an address"))
                continue
            }
            if (code !in 200..299) {
                c.disconnect()
                throw IOException("HTTP $code")
            }
            return c
        }
        throw IOException("too many redirects")
    }

    private fun gitHub(host: String) = host == "github.com" || host == "api.github.com" || host.endsWith(".githubusercontent.com")

    private fun download(ctx: Context, url: String, file: File, size: Long) {
        val c = connect(url, false)
        try {
            val total = if (size > 0) size else c.contentLengthLong
            var done = 0L
            var shown = -1
            c.inputStream.use { inp ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (total > 0 && done > total) throw IOException("bigger than GitHub said")
                        val p = if (total > 0) (done * 100 / total).toInt() else 0
                        if (p >= shown + 5) { shown = p; progress = p; changed(ctx) }
                    }
                }
            }
        } finally {
            c.disconnect()
        }
    }

    // ---------------------------------------------------------------- the checks

    /** "" when the file may go to Android's installer, else why not ("bad", "other_key", "not_newer"). */
    private fun verify(ctx: Context, file: File, digest: String, size: Long): String {
        if (size > 0 && file.length() != size) return "bad"
        if (digest.isNotEmpty() && sha256(file) != digest) return "bad"
        val pm = ctx.packageManager
        val mine = pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val theirs = pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return "bad"
        if (theirs.packageName != ctx.packageName) return "bad"
        // strictly newer, or the same app would be installed again and offered again forever
        if (theirs.longVersionCode <= mine.longVersionCode) return "not_newer"
        val a = signers(mine) { pm.getPackageInfo(ctx.packageName, it) }
        val b = signers(theirs) { pm.getPackageArchiveInfo(file.path, it) }
        // Some Android 9 builds read no signer from a file that is not installed yet: then
        // Android's installer makes the same check and says no itself.
        if (a.isNotEmpty() && b.isNotEmpty() && a != b) return "other_key"
        return ""
    }

    /** The signing certificates, the newer way first; the older way when that one reads nothing. */
    private fun signers(p: PackageInfo, again: (Int) -> PackageInfo?): Set<String> {
        val list: Array<Signature>? = p.signingInfo?.apkContentsSigners
            ?: try { @Suppress("DEPRECATION") again(PackageManager.GET_SIGNATURES)?.signatures } catch (e: Exception) { null }
        return list?.map { it.toCharsString() }?.toSet() ?: emptySet()
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { inp ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = inp.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    // ---------------------------------------------------------------- Android's installer

    private fun commit(ctx: Context, file: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { inp ->
                session.openWrite(ASSET, 0, file.length()).use { out ->
                    inp.copyTo(out)
                    session.fsync(out)
                }
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val back = Intent(ctx, Result::class.java).setAction(RESULT)
            session.commit(PendingIntent.getBroadcast(ctx, id, back, flags).intentSender)
        }
    }

    /**
     * What Android's installer says. First: it needs the person at the TV, so its "update this
     * app?" screen is shown. Then: cancelled, refused, or (rarely seen, because Android stops this
     * app to replace it) done. Not exported: only the installer, through our own PendingIntent.
     */
    class Result : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action != RESULT) return
            when (i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                        else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_INTENT)
                    if (confirm == null) { finish(c, "failed"); return }
                    try {
                        c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        asking = true
                    } catch (e: Exception) {
                        finish(c, "failed")
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> finish(c, "")
                PackageInstaller.STATUS_FAILURE_ABORTED -> finish(c, "cancelled")
                PackageInstaller.STATUS_FAILURE_CONFLICT -> finish(c, "other_key")
                else -> finish(c, "failed")
            }
            File(c.cacheDir, "update").deleteRecursively()
        }
    }

    // ---------------------------------------------------------------- the page

    /**
     * window.TVUP: what the home page may ask. Only the page the launcher itself loaded (its own
     * copy, or the bridge it found) can start a check or an update.
     */
    class Page(ctx: Context, private val web: WebView) {
        private val app = ctx.applicationContext

        init {
            listener = { json -> try { web.evaluateJavascript("window.tv && tv.update && tv.update($json)", null) } catch (e: Exception) {} }
        }

        @JavascriptInterface
        fun state(): String = Updater.state(app)

        @JavascriptInterface
        fun check() { main.post { if (trusted(web.url)) Updater.check(app, true) } }

        @JavascriptInterface
        fun install() { main.post { if (trusted(web.url)) Updater.install(app) } }

        @JavascriptInterface
        fun auto(on: Boolean) { main.post { if (trusted(web.url)) setAuto(app, on) } }

        private fun trusted(url: String?): Boolean {
            if (url == null) return false
            if (url.startsWith("http://$OFFLINE_HOST/")) return true
            val bridge = app.getSharedPreferences("home", Context.MODE_PRIVATE).getString("bridge", null) ?: return false
            return url.startsWith("$bridge/")
        }
    }
}
