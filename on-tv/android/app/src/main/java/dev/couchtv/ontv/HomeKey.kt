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
    private fun watchApk() = Variant.hasWatch
    private fun store(c: Context) = c.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun tcl() = HomeKeyRules.isTcl(Build.MANUFACTURER, Build.BRAND)
    private fun canWriteSecure(c: Context) = c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED
    private fun link() = Adb.connected || Adb.everAllowed || Adb.paired
    private fun needed(c: Context) = HomeKeyRules.needed(HomeRole.googleHome(c), FireHome.isFireTv)
    /** Fire OS blocks an app's own ADB (Adb.FIRE_BLOCKED): then the one press cannot work there. */
    private fun fireBlocked() = FireHome.isFireTv && (Adb.lastError ?: "").contains(Adb.FIRE_BLOCKED)
    /**
     * The watch is doing its job. Fire OS 6 (Android 7.1) runs Amazon's own accessibility manager and never
     * binds it (FireHome.kt, #50): there usage access does the watching instead.
     */
    private fun watchOn() = HomeKeyRules.watching(WatchService.connected, FireHome.isFireTv, Build.VERSION.SDK_INT, FireHome.usageAllowed)
    private fun viewNow(app: Context, busy: Boolean) = HomeKeyRules.view(needed(app), watchApk(), watchOn(), App.homeEnabled(app), busy,
        link() && !fireBlocked(), canWriteSecure(app))

    fun state(c: Context): String {
        val app = c.applicationContext
        // the update that was in the way is over: its words go
        if (error == "update_busy" && !Update.working) error = ""
        // Play: never the GitHub or computer steps, one press that shows the disclosure first (PlayRules)
        val v = if (Variant.play) PlayRules.view(watchOn(), App.homeEnabled(app)) else viewNow(app, working)
        val fire = fireBlocked()
        val words = when (v) {
            "busy" -> HomeKeyRules.busyWords(phase, progress)
            "done" -> HomeKeyRules.DONE
            "ready" -> if (Variant.play) PlayRules.READY else if (watchApk()) HomeKeyRules.READY_WATCH else HomeKeyRules.READY
            "steps" -> if (fire) HomeKeyRules.STEPS_FIRE else HomeKeyRules.STEPS
            else -> ""
        }
        // the phone page has no More button and no code to scan: its own section and the steps under it
        val phoneWords = if (v == "steps") (if (fire) HomeKeyRules.STEPS_FIRE_PHONE else HomeKeyRules.STEPS_PHONE)
            else if (Variant.play && v == "ready") PlayRules.READY_PHONE else words
        return JSONObject()
            .put("view", v)
            .put("phase", phase).put("progress", progress)
            .put("error", error).put("error_words", HomeKeyRules.errorWords(error, FireHome.isFireTv))
            .put("words_phone", phoneWords)
            .put("button", HomeKeyRules.BUTTON)
            .put("words", words)
            .put("watch_apk", watchApk()).put("watch", watchOn()).put("home_on", App.homeEnabled(app))
            .put("fire_tv", FireHome.isFireTv).put("fire_blocked", fire)
            .put("help_url", HomeKeyRules.HELP_URL)
            .put("steps", JSONArray(HomeKeyRules.steps(FireHome.isFireTv)))
            .toString()
    }

    private fun changed(c: Context) {
        val json = state(c)
        main.post { listener?.let { runCatching { it(json) } } }
    }

    /**
     * The press. Does nothing while something is already happening, or when there is nothing to do. The
     * check and the start happen under Update's own lock (Update.install and Update.check are synchronized
     * on it), so an update and this never start together; an update in the way (checking, downloading or installing) is said on screen.
     */
    fun start(c: Context) {
        val app = c.applicationContext
        // Play: no download, no ADB, no writing Android's list. The disclosure, then Android's own settings.
        if (Variant.play) { DisclosureActivity.openAccessibility(app); changed(app); return }
        synchronized(Update) {
            if (working) return
            if (Update.working) { error = "update_busy"; changed(app); return }
            // a slow install may still finish: no second one on top of it until resume() has decided
            if (HomeKeyRules.resumeStep(watchApk(), store(app).getLong("installing", 0L), System.currentTimeMillis(), false) == "wait") {
                error = "slow"; changed(app); return
            }
            if (viewNow(app, false) != "ready") return
            error = ""
            if (watchApk()) {
                // the watch only acts while Use as home screen is on (FireHome.onOtherHome)
                if (!App.homeEnabled(app)) App.setHomeEnabled(app, true)
                phase = "switching"; changed(app)
                io.execute { finish(app) }
                return
            }
            phase = "checking"; progress = 0
        }
        changed(app)
        io.execute { fetchAndInstall(app) }
    }

    /**
     * Use as home screen, switched on by this try just before the install: off again if the install fails, so
     * "nothing changed" is true. Kept in the store, so a restart in the middle does not lose it (resume()).
     */
    private const val TURNED_ON = "home_turned_on"
    private fun turnedOn(app: Context) = store(app).getBoolean(TURNED_ON, false)
    private fun undoHome(app: Context) {
        if (turnedOn(app)) { runCatching { App.setHomeEnabled(app, false) }; Log.i(TAG, "home off again") }
        store(app).edit().remove(TURNED_ON).commit()
    }

    private fun fail(app: Context, why: String) {
        Log.w(TAG, "stopped: $why")
        undoHome(app)
        // Fire OS blocks the app's own link: the Fire TV steps already say so, a second "could not connect" only mixes the message
        error = if (why == "adb" && fireBlocked()) "" else why
        phase = ""; progress = 0
        store(app).edit().remove("installing").apply()
        changed(app)
    }

    private fun fetchAndInstall(app: Context) {
        if (!PlayRules.gitHubDownloads(BuildConfig.FLAVOR)) return fail(app, "")   // Play: Google Play installs it
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
            // the watch only acts while Use as home screen is on: switched on now, once everything has checked out
            if (!App.homeEnabled(app)) { store(app).edit().putBoolean(TURNED_ON, true).commit(); App.setHomeEnabled(app, true); Log.i(TAG, "home on for the install") }
            val r = try { put(app, file) } catch (x: Exception) {
                Log.w(TAG, "install: ${x.message}")
                if (x.message?.startsWith("push failed") == true) UpdateRules.failure(x.message ?: "") else "adb"
            }
            when (HomeKeyRules.afterInstall(r)) {
                // Android said Success: it is about to stop this app, and resume() carries on
                "done" -> store(app).edit().remove(TURNED_ON).commit()
                // pm install has not answered in 5 minutes but may still finish: keep the marks, resume() decides
                "wait" -> slow(app)
                else -> fail(app, r)
            }
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
        // no answer yet: the install may still be going, so the copy stays (the shell line removes it after pm install)
        return "slow"
    }

    /**
     * The install is slow: "installing" and the turned on flag stay, the screen says to leave the TV on. If it
     * finishes, Android restarts the app as the watch APK and resume() finishes the job; if not, resume() runs
     * again when the window is over and switches Home off again.
     */
    private fun slow(app: Context) {
        Log.w(TAG, "pm install has not answered yet: waiting")
        error = "slow"; phase = ""; progress = 0
        changed(app)
        val at = store(app).getLong("installing", System.currentTimeMillis())
        main.postDelayed({ resume(app) }, HomeKeyRules.waitMs(at, System.currentTimeMillis()))
    }

    /** App.onCreate: carry on after the install restarted the app as the watch APK. */
    fun resume(c: Context) {
        val app = c.applicationContext
        if (working) return   // a new press in this process already owns the marks
        val st = store(app)
        val at = st.getLong("installing", 0L)
        val now = System.currentTimeMillis()
        when (val step = HomeKeyRules.resumeStep(watchApk(), at, now, turnedOn(app))) {
            "finish" -> {
                st.edit().remove("installing").remove(TURNED_ON).apply()
                phase = "switching"; changed(app)
                io.execute { finish(app) }
            }
            "clear" -> st.edit().remove(TURNED_ON).apply()
            // still the phone version: the install may still be going (this process is new, so nothing is watching it)
            "wait" -> main.postDelayed({ resume(app) }, HomeKeyRules.waitMs(at, now))
            "undo" -> {
                // the install never finished: forget it, and Home off again if that try switched it on
                if (HomeKeyRules.homeOffOnResume(step, turnedOn(app))) Log.w(TAG, "an unfinished try: Use as home screen off again")
                undoHome(app)
                st.edit().remove("installing").apply()
                // a slow install this process was waiting for never finished: now nothing changed is true
                if (error == "slow") error = "failed"
                changed(app)
            }
        }
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
            fail(app, if (watchOn()) "" else "not_bound")
        }
    }

    private fun switchOn(app: Context, rebind: Boolean): Boolean {
        if (!PlayRules.switchesWatchOnItself(BuildConfig.FLAVOR)) return watchOn()   // Play: the person switches it on
        if (watchOn() && !rebind) { reassertHome(app); return true }
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
            if (watchOn()) return true
            Thread.sleep(500)
        }
        return watchOn()
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
