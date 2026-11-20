package dev.couchtv.ontv

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/**
 * "Make Home open Couch TV": one press on the setup screen, the phone page (/api/homekey) or Home settings
 * (window.TVHK) does what used to take a computer (HomeKeyRules.kt has the why). Over the app's own ADB
 * link: GitHub's couch-tv-ontv-watch.apk with Update's checks, `pm install -r` over this app (settings
 * stay), then the Home button watch switched on, Couch TV made the home again, and checked connected.
 *
 * Android stops this app while it replaces it. The shell line on the TV switches the watch on after a
 * Success, and Android restarts the app (MY_PACKAGE_REPLACED, and binding the watch): App.onCreate calls
 * resume(), which sees the "installing" it left and finishes the job as the watch APK (the check, and the
 * TCL rebind if the watch did not connect).
 */
object HomeKey {
    private const val TAG = "couchtv.homekey"
    private const val STORE = "homekey"
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    // "" (nothing), "checking" (GitHub), "downloading", "installing", "switching" (the watch going on)
    @Volatile private var phase = ""
    @Volatile private var progress = 0
    @Volatile private var error = ""
    @Volatile var listener: ((String) -> Unit)? = null

    val working: Boolean get() = phase.isNotEmpty()
    private fun watchApk() = BuildConfig.BUILD_TYPE == "watch"
    private fun store(c: Context) = c.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun tcl() = HomeKeyRules.isTcl(Build.MANUFACTURER, Build.BRAND)
    private fun canWriteSecure(c: Context) = c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED
    private fun link() = Adb.connected || Adb.everAllowed || Adb.paired
    private fun needed(c: Context) = HomeKeyRules.needed(HomeRole.googleHome(c), FireHome.isFireTv)

    fun state(c: Context): String {
        val app = c.applicationContext
        val v = HomeKeyRules.view(needed(app), watchApk(), WatchService.connected, App.homeEnabled(app), working,
            link(), canWriteSecure(app))
        val fireBlocked = FireHome.isFireTv && (Adb.lastError ?: "").contains(Adb.FIRE_BLOCKED)
        val words = when (v) {
            "busy" -> HomeKeyRules.busyWords(phase, progress)
            "done" -> HomeKeyRules.DONE
            "ready" -> if (watchApk()) HomeKeyRules.READY_WATCH else HomeKeyRules.READY
            "steps" -> if (FireHome.isFireTv) HomeKeyRules.STEPS_FIRE else HomeKeyRules.STEPS
            else -> ""
        }
        return JSONObject()
            .put("view", v)
            .put("phase", phase).put("progress", progress)
            .put("error", error).put("error_words", HomeKeyRules.errorWords(error))
            .put("button", HomeKeyRules.BUTTON)
            .put("words", words)
            .put("watch_apk", watchApk()).put("watch", WatchService.connected).put("home_on", App.homeEnabled(app))
            .put("fire_tv", FireHome.isFireTv).put("fire_blocked", fireBlocked)
            .put("help_url", HomeKeyRules.HELP_URL)
            .put("steps", JSONArray(stepsList()))
            .toString()
    }

    /** The computer steps, one per row (the setup screen's More has them in full: SetupWords.watchSteps). */
    private fun stepsList() = listOf(
        "On a computer, download couch-tv-ontv-watch.apk from github.com/${UpdateRules.REPO}/releases/latest.",
        "Install it over this app with Google's adb tool: adb connect, then adb install -r couch-tv-ontv-watch.apk. Your settings stay.",
        "On the TV: Settings, Accessibility, Couch TV home watch, On.",
        "Open Couch TV and press Use as home screen.")

    private fun changed(c: Context) {
        val json = state(c)
        main.post { listener?.let { runCatching { it(json) } } }
    }

    /** The press. Does nothing while something is already happening, or when there is nothing to do. */
    @Synchronized fun start(c: Context) {
        val app = c.applicationContext
        if (working || Update.working) return
        val v = HomeKeyRules.view(needed(app), watchApk(), WatchService.connected, App.homeEnabled(app), false, link(), canWriteSecure(app))
        if (v != "ready") return
        error = ""
        // the watch only acts while Use as home screen is on (FireHome.onOtherHome)
        if (!App.homeEnabled(app)) App.setHomeEnabled(app, true)
        if (watchApk()) {
            phase = "switching"; changed(app)
            io.execute { finish(app) }
            return
        }
        phase = "checking"; progress = 0; changed(app)
        io.execute { fetchAndInstall(app) }
    }

    private fun fail(app: Context, why: String) {
        Log.w(TAG, "stopped: $why")
        error = why; phase = ""; progress = 0
        store(app).edit().remove("installing").apply()
        changed(app)
    }

    private fun fetchAndInstall(app: Context) {
        val f = try { UpdateRules.read(Update.fetch("https://api.github.com/repos/${UpdateRules.REPO}/releases/latest"), true) }
            catch (x: Exception) { return fail(app, "net") }
        if (f == null || !f.installable) return fail(app, "net")
        if (!Adb.connected && !runCatching { Adb.ensure() }.getOrDefault(false)) return fail(app, "adb")
        val dir = File(app.cacheDir, "homekey").apply { mkdirs() }
        val file = File(dir, UpdateRules.WATCH_ASSET)
        try {
            if (dir.usableSpace < f.size * 5 / 2) return fail(app, "space")
            phase = "downloading"; changed(app)
            val why = try {
                Update.download(f.url, file, f.size) { p -> progress = p; changed(app) }
                Update.verify(app, file, f.digest, f.size, sameOk = true)
            } catch (x: Exception) {
                Log.w(TAG, "download: ${x.message}")
                if (UpdateRules.failure(x.message ?: "") == "space") "space" else "net"
            }
            if (why.isNotEmpty()) return fail(app, why)
            phase = "installing"; progress = 100; changed(app)
            val r = try { put(app, file) } catch (x: Exception) {
                Log.w(TAG, "install: ${x.message}")
                if (x.message?.startsWith("push failed") == true) UpdateRules.failure(x.message ?: "") else "adb"
            }
            // "" means Android said Success: it is about to stop this app, and resume() carries on
            if (r.isNotEmpty()) fail(app, r)
        } finally { file.delete() }
    }

    /** Copies the checked watch APK to the TV and installs it there; "" on Success. */
    private fun put(app: Context, file: File): String {
        Adb.shell("rm -f ${HomeKeyRules.TMP_APK} ${HomeKeyRules.TMP_LOG}", 8000)
        Adb.push(file, HomeKeyRules.TMP_APK)
        file.delete()
        // worked out now, from what is there: every other service stays (null: the app does it after the restart)
        val now = Settings.Secure.getString(app.contentResolver, "enabled_accessibility_services")
        val services = HomeKeyRules.withWatch(now, app.packageName).takeIf { HomeKeyRules.shellSafe(it) }
        store(app).edit().putLong("installing", System.currentTimeMillis()).commit()
        Adb.shell(HomeKeyRules.installScript(app.packageName, services, tcl(), App.homeEnabled(app), App.inForeground), 15_000)
        val until = System.currentTimeMillis() + 5 * 60_000L
        while (System.currentTimeMillis() < until) {
            Thread.sleep(1000)
            val out = runCatching { Adb.shell("cat ${HomeKeyRules.TMP_LOG} 2>/dev/null", 8000) }.getOrDefault("")
            val r = UpdateRules.installResult(out) ?: continue
            if (r.isNotEmpty()) Log.w(TAG, "pm install: ${out.trim().take(300)}")
            return r
        }
        runCatching { Adb.shell("rm -f ${HomeKeyRules.TMP_APK}", 8000) }
        return "failed"
    }

    /** App.onCreate: carry on after the install restarted the app as the watch APK. */
    fun resume(c: Context) {
        val app = c.applicationContext
        val at = store(app).getLong("installing", 0L)
        if (at == 0L) return
        if (!watchApk()) {
            // still the phone version: the install never finished (this process is new, so nothing is watching it)
            if (System.currentTimeMillis() - at > 10 * 60_000L) store(app).edit().remove("installing").apply()
            return
        }
        store(app).edit().remove("installing").apply()
        phase = "switching"; changed(app)
        io.execute { finish(app) }
    }

    /**
     * Switch the watch on and check it connected. First the plain way (the list with the watch added,
     * accessibility on, the home re-asserted, AUTO_START on a TCL); then, if it did not connect, the
     * rebind a second TCL needed: the list without the watch, then with it again.
     */
    private fun finish(app: Context) {
        try {
            if (!switchOn(app, rebind = false) && !switchOn(app, rebind = true)) return fail(app, "not_bound")
            error = ""; phase = ""; progress = 0
            Log.i(TAG, "the Home button watch is connected")
            changed(app)
        } catch (x: Exception) {
            Log.w(TAG, "switch on: ${x.message}")
            fail(app, if (WatchService.connected) "" else "not_bound")
        }
    }

    private fun switchOn(app: Context, rebind: Boolean): Boolean {
        if (WatchService.connected && !rebind) { reassertHome(app); return true }
        val pkg = app.packageName
        val cr = app.contentResolver
        val now = Settings.Secure.getString(cr, "enabled_accessibility_services")
        if (tcl()) shell("appops set $pkg AUTO_START allow")
        if (rebind) {
            write(app, HomeKeyRules.withoutWatch(now, pkg))
            Thread.sleep(1500)
        }
        write(app, HomeKeyRules.withWatch(if (rebind) HomeKeyRules.withoutWatch(now, pkg) else now, pkg))
        if (canWriteSecure(app)) runCatching { Settings.Secure.putInt(cr, "accessibility_enabled", 1) }
        else shell("settings put secure accessibility_enabled 1")
        reassertHome(app)
        val until = System.currentTimeMillis() + 10_000L
        while (System.currentTimeMillis() < until) {
            if (WatchService.connected) return true
            Thread.sleep(500)
        }
        return WatchService.connected
    }

    /** The list, written with the secure settings grant when the app has it, else over ADB. */
    private fun write(app: Context, value: String) {
        if (canWriteSecure(app) && runCatching { Settings.Secure.putString(app.contentResolver, "enabled_accessibility_services", value) }.getOrDefault(false)) return
        if (!HomeKeyRules.shellSafe(value)) throw IllegalStateException("an accessibility entry this app cannot write over ADB")
        shell("settings put secure enabled_accessibility_services '$value'")
    }

    /** Installing anything made a TCL drop Couch TV as the preferred home (AGENTS.md): set it again. */
    private fun reassertHome(app: Context) {
        if (App.homeEnabled(app)) shell("cmd package set-home-activity ${app.packageName}/.HomeAlias")
    }

    private fun shell(cmd: String) {
        if (!Adb.connected && !(link() && runCatching { Adb.ensure() }.getOrDefault(false))) return
        runCatching { Adb.shell(cmd, 8000) }.onFailure { Log.w(TAG, "$cmd: ${it.message}") }
    }

    /** window.TVHK for the home page's Home settings. Only the app's own page (base/tv/) may start it. */
    class Page(c: Context, private val web: WebView, private val base: String) {
        private val app = c.applicationContext
        init { listener = { json -> runCatching { web.evaluateJavascript("window.tv && tv.homekey && tv.homekey($json)", null) } } }
        @JavascriptInterface fun state(): String = HomeKey.state(app)
        @JavascriptInterface fun start() { main.post { if (web.url?.startsWith("$base/tv/") == true) HomeKey.start(app) } }
    }
}
