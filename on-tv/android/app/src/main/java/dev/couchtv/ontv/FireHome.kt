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
 *     Fire OS 6 runs Amazon's own accessibility manager and never binds it (issue #50), so the
 *     setting reads as on while nothing listens: the app then falls through to the next way.
 *  2. App-usage events, polled while the screen is on. Needs usage access, the third grant (give it
 *     on every Fire TV: it is only used where the watcher is not connected):
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
     * Amazon's launcher package also holds Fire OS's Settings screens (`.ui.MainSettingsActivity`)
     * and search screens. Only an actual HOME activity counts, never the whole package.
     */
    fun isAmazonHome(pkg: String?, cls: String?) = FireHomeWindow.isHome(pkg, cls, homeClasses)

    /** The WatchService saw Amazon's home come on screen. */
    fun onAmazonHome() {
        if (wanted) jump()
    }

    /**
     * Any other TV (a Haier, a TCL, Google TV, issue #98): the Home key can open the maker's own
     * home by name and ignore the default home, so a home screen that is not this app coming
     * forward gets this one put back on top. Only the activities the TV lists as a HOME screen
     * count (never its Settings or setup screens), only with "Use as home screen" on, and only
     * while the person has switched the Home watch on in Accessibility (or a computer did).
     */
    @Volatile private var homeClasses: Set<String> = emptySet()
    fun readHomes() {
        val c = App.instance
        homeClasses = runCatching {
            c.packageManager.queryIntentActivities(
                android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_HOME), 0)
                .filter { it.activityInfo.packageName != c.packageName }
                .map { it.activityInfo.name }.toSet()
        }.getOrDefault(emptySet())
    }
    /**
     * Xiaomi (opt-in, "patchwall_replace" on the setup page): Couch TV takes PatchWall's place.
     * On Xiaomi's Android TV builds PatchWall (com.mitv.tvhome.atv) is a launcher app, not the HOME:
     * the TV's partnercustomizer opens it by name from the remote's PatchWall button (KEYCODE_BUTTON_5,
     * see WatchService.onKeyEvent) and when the screen comes on, so no intent filter can claim it.
     * With the switch on, PatchWall coming forward (its tile, the button, power-on) opens Couch TV
     * instead (its own Settings screens are left alone), and at power-on Couch TV opens unless the TV
     * is going back to an HDMI or TV input. Tested on a Redmi MiTV-AXFR0 (Android 11).
     */
    const val PATCHWALL = "com.mitv.tvhome.atv"
    private const val TV_APP = "com.android.tv"
    val isXiaomi: Boolean = android.os.Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true)
    val replacePatchWall: Boolean get() = isXiaomi && Store.bool("patchwall_replace")

    fun isPatchWall(pkg: String?, cls: String?) =
        pkg == PATCHWALL && cls != null && cls.startsWith("com.mitv.") && !cls.contains("Settings", ignoreCase = true)
    /**
     * PatchWall coming forward. Not in the first moments after the screen came on (or the TV booted): the TV
     * opens PatchWall itself then, even when it is about to go back to an HDMI or TV input, and opening Couch
     * TV here would cover the input. onScreenOn decides for that window, after the input has had its say.
     */
    fun onPatchWall() {
        if (!replacePatchWall) return
        if (wakeAt > 0 && android.os.SystemClock.elapsedRealtime() - wakeAt < WAKE_WINDOW_MS) {
            Log.i(TAG, "PatchWall during a wake: left to the screen-on check")
            return
        }
        jump(force = true)
    }
    @Volatile private var wakeAt = 0L
    private const val WAKE_WINDOW_MS = 6_000L

    // The last real screen that came forward (the watch sees them all), so power-on needs no extra calls.
    private val notScreens = setOf("android", "com.android.systemui", "com.google.android.inputmethod.latin")
    @Volatile private var lastPkg: String? = null
    @Volatile private var amazonHomeInFront = false
    private val later = android.os.Handler(android.os.Looper.getMainLooper())
    fun seen(pkg: String?, cls: String?) {
        if (pkg == null || pkg in notScreens) return
        lastPkg = pkg
        amazonHomeInFront = isAmazonHome(pkg, cls)
    }

    /** Screen on or boot. The 2 s wait lets the TV bring its input back first (1.1 s after screen-on on the MiTV-AXFR0). */
    fun onScreenOn() {
        if (!replacePatchWall) return
        wakeAt = android.os.SystemClock.elapsedRealtime()
        later.removeCallbacksAndMessages(null)
        later.postDelayed({
            if (lastPkg == TV_APP) Log.i(TAG, "screen on: the TV is going back to an input, Couch TV stays back")
            else App.openHome()
        }, 2_000)
    }

    fun onOtherHome(pkg: String?, cls: String?) {
        if (pkg == null || cls == null || pkg == BuildConfig.APPLICATION_ID) return
        if (App.homeEnabled(App.instance) && cls in homeClasses) jump(force = true)
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

    private fun jump(force: Boolean = false) {
        if (!force && !wanted) return
        val now = System.currentTimeMillis()
        if (now - lastJump < JUMP_GAP_MS) {
            // One jump per press, not one per event. A second press inside the gap brings Amazon's home
            // back with no later window event to react to, so look again once the gap is over.
            recheck.removeCallbacks(again)
            recheck.postDelayed(again, lastJump + JUMP_GAP_MS - now)
            return
        }
        lastJump = now
        bringForward()
    }
    private const val JUMP_GAP_MS = 1200L
    private val recheck = android.os.Handler(android.os.Looper.getMainLooper())
    private val again = Runnable { if (amazonHomeInFront) { Log.i(TAG, "Amazon's home still in front after the gap"); jump() } }

    /**
     * Fire TV on Android 9 and older: Android holds an app's activity starts for 5 s after a Home press
     * (the app-switch delay). Seen on a Fire TV Cube (3rd gen, Fire OS 7.7.1.7): Amazon's home stayed up
     * for 5 s, and another press in that time buried the held start under Amazon's home for good.
     * Moving this app's own task to the front is not an activity start and was not held there. Only
     * when the home is the top of that task (setup shares it). Before the home has ever opened, on
     * Android 10 and newer (background start limits) and on other TVs: a normal start, as before.
     */
    private fun bringForward() {
        if (android.os.Build.VERSION.SDK_INT >= 29 || !isFireTv) { App.openHome(); return }
        val task = runCatching {
            App.instance.getSystemService(android.app.ActivityManager::class.java).appTasks.firstOrNull {
                it.taskInfo.topActivity?.className == HomeActivity::class.java.name
            }
        }.getOrNull()
        if (task != null && runCatching { task.moveToFront() }.isSuccess) {
            Log.i(TAG, "Amazon's home came forward: moved the home's task to the front")
            HomeActivity.home()
        } else {
            Log.i(TAG, "Amazon's home came forward: starting the home")
            App.openHome()
        }
    }

    /** The home the system falls back to for everything that is not the Home key itself. Best-effort. */
    private fun guard() {
        runCatching { Adb.shell("cmd package set-home-activity ${BuildConfig.APPLICATION_ID}/.HomeAlias", 8_000) }
    }
}
