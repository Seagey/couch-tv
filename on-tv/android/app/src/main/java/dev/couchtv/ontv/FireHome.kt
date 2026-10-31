package dev.couchtv.ontv

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.os.PowerManager
import android.os.Process
import android.util.Log

/**
 * Fire OS and the home button. Amazon's TVs start Amazon's launcher from the Home key by explicit
 * component: the default-home setting is ignored, and the launcher is a protected package that can
 * be neither disabled nor suspended. This watches for Amazon's home coming on screen and puts this
 * app's home back on top. Amazon's home still flashes up for a moment; without root that is as
 * good as Fire OS allows.
 *
 * Some Fire OS builds also block the TV's own ADB (adbd drops any connection made from the TV
 * itself), so there are three ways to watch, tried in this order:
 *
 *  1. The accessibility watcher (WatchService), event-driven. Needs two one-off grants over ADB
 *     from a computer, kept across reboots:
 *       adb shell pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS
 *       adb shell appops set dev.couchtv.ontv SYSTEM_ALERT_WINDOW allow
 *  2. App-usage events, polled while the screen is on. Needs usage access instead of the first
 *     grant:
 *       adb shell appops set dev.couchtv.ontv GET_USAGE_STATS allow
 *  3. The activity log over the TV's own ADB, where that still works (no polling).
 *
 * Runs only on a Fire TV (Amazon's launcher is installed) with "Use as home screen" on, so it does
 * nothing on Google TV or any other Android TV. Poked at boot, on every ADB connect and from the
 * home-screen switch; looks after its own reconnects, so no computer has to stay on.
 */
object FireHome {
    private const val TAG = "couchtv.firehome"
    const val AMAZON_HOME = "com.amazon.tv.launcher"
    // The Home key shows up as ActivityTaskManager starting Amazon's launcher with CATEGORY_HOME.
    // -T1 skips everything already logged, so an old line never causes a jump at start.
    private const val WATCH = "shell:logcat -T1 -v brief ActivityTaskManager:I '*:S'"
    private val lock = Any()
    @Volatile private var running = false
    @Volatile private var lastJump = 0L

    val isFireTv: Boolean get() = Tv.hasPackage(AMAZON_HOME)

    /** Usage access, the no-ADB way to see Amazon's home come forward. */
    val usageAllowed: Boolean
        get() = runCatching {
            App.instance.getSystemService(AppOpsManager::class.java)
                .checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), App.instance.packageName) == AppOpsManager.MODE_ALLOWED
        }.getOrDefault(false)

    private val wanted: Boolean
        get() = isFireTv && App.homeEnabled(App.instance)

    /**
     * Amazon's launcher package also holds Fire OS's Settings screens (`.ui.MainSettingsActivity`
     * and others), so only its other screens count as Amazon's home.
     */
    fun isAmazonHome(pkg: String?, cls: String?) = pkg == AMAZON_HOME && cls?.contains("Settings") != true

    /** The WatchService saw Amazon's home come on screen. */
    fun onAmazonHome() {
        if (wanted) jump()
    }

    /** Cheap to call often: starts the watcher once, only while it is wanted. */
    fun poke() {
        if (!wanted) return
        selfEnableWatch()
        if (WatchService.connected) return   // event-driven: nothing to poll
        if (!(usageAllowed || Adb.everAllowed || Adb.paired)) return
        synchronized(lock) {
            if (running) return
            running = true
        }
        Thread({ watch() }, "firehome").start()
    }

    /**
     * With the secure-settings grant (`pm grant ... WRITE_SECURE_SETTINGS`, once over ADB from a
     * computer), switch the accessibility watcher on, and back on when an update or a settings
     * reset switches it off.
     */
    private fun selfEnableWatch() {
        val c = App.instance
        if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != android.content.pm.PackageManager.PERMISSION_GRANTED) return
        runCatching {
            val cr = c.contentResolver
            val me = "${c.packageName}/${WatchService::class.java.name}"
            val cur = android.provider.Settings.Secure.getString(cr, "enabled_accessibility_services") ?: ""
            if (me !in cur.split(':')) {
                android.provider.Settings.Secure.putString(cr, "enabled_accessibility_services", if (cur.isEmpty()) me else "$cur:$me")
                Log.i(TAG, "switched the home watch service on")
            }
            android.provider.Settings.Secure.putInt(cr, "accessibility_enabled", 1)
        }.onFailure { Log.w(TAG, "could not switch the watch service on: ${it.message}") }
    }

    private fun watch() {
        try {
            while (wanted && !WatchService.connected) {
                if (usageAllowed) watchUsage() else watchAdb()
                Thread.sleep(3_000)
            }
        } catch (e: InterruptedException) {
        } finally {
            synchronized(lock) { running = false }
            Log.i(TAG, "watcher stopped")
            // "Use as home screen" may have come back on while the thread was winding down.
            if (wanted) poke()
        }
    }

    /** App-usage events, polled while the screen is on. No ADB involved. */
    private fun watchUsage() {
        Log.i(TAG, "watching for Amazon's home (usage events)")
        val usm = App.instance.getSystemService(UsageStatsManager::class.java)
        val power = App.instance.getSystemService(PowerManager::class.java)
        var since = System.currentTimeMillis()
        while (wanted && usageAllowed && !WatchService.connected) {
            Thread.sleep(if (power.isInteractive) 500 else 3_000)
            val now = System.currentTimeMillis()
            // A second of overlap, so an event on the boundary is never missed; the order check
            // below keeps a twice-seen event from causing a second jump.
            val events = runCatching { usm.queryEvents(since - 1_000, now) }.getOrNull() ?: continue
            since = now
            val e = UsageEvents.Event()
            var amazonInFront = false
            while (events.getNextEvent(e)) {
                if (e.eventType != UsageEvents.Event.MOVE_TO_FOREGROUND) continue
                Log.i(TAG, "front: ${e.packageName}")
                when {
                    isAmazonHome(e.packageName, e.className) -> amazonInFront = true
                    e.packageName == BuildConfig.APPLICATION_ID || e.packageName == AMAZON_HOME -> amazonInFront = false
                }
            }
            if (amazonInFront) { Log.i(TAG, "Amazon's home came forward, jumping"); jump() }
        }
    }

    /** The activity log over the TV's own ADB: event-driven, for Fire OS builds that still allow it. */
    private fun watchAdb() {
        Log.i(TAG, "watching for Amazon's home (ADB log)")
        var guarded = false
        while (wanted && !usageAllowed && !WatchService.connected) {
            if (!Adb.connected) {
                guarded = false
                // Silent reconnect (the TV slept, adbd restarted). Never pops "Allow debugging?".
                if (!runCatching { Adb.ensure() }.getOrDefault(false)) { Thread.sleep(15_000); continue }
            }
            if (!guarded) { guard(); guarded = true }
            try {
                val stream = Adb.stream(WATCH)
                stream.openInputStream().bufferedReader().use { r ->
                    while (wanted) {
                        val line = r.readLine() ?: break
                        if ("android.intent.category.HOME" in line && AMAZON_HOME in line) jump()
                    }
                }
            } catch (e: Exception) { Log.w(TAG, "watch: ${e.message}") }
            Thread.sleep(3_000)
        }
    }

    private fun jump() {
        if (!wanted) return
        val now = System.currentTimeMillis()
        if (now - lastJump < 1200) return   // one jump per press, not one per event
        lastJump = now
        App.openHome()
    }

    /** The home the system falls back to for everything that is not the Home key itself. Best-effort. */
    private fun guard() {
        runCatching { Adb.shell("cmd package set-home-activity ${BuildConfig.APPLICATION_ID}/.HomeAlias", 8_000) }
    }
}
