package app.couchtv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * The Home button watch. The TV's own home stays installed and switched on (switching it off can
 * leave a Google TV in a boot loop, see README "If your TV loops after a restart"), so on many TVs
 * the Home key, and the TV at power on, still open that home. This watcher sees the TV's own home
 * come on screen and puts couch-tv back on top. The TV's home flashes up for a moment; without
 * root that is as good as Android allows.
 *
 * - Fire TV: Amazon's TVs start Amazon's launcher from the Home key by name.
 * - Google TV and Android TV: the Google home outranks the default-home setting.
 *
 * Off until a computer switches it on over ADB (tv-home/tools/apply.sh, or guest-tv's
 * `tools/tv_app.py home`). They also grant WRITE_SECURE_SETTINGS, because Android drops the
 * watcher whenever the app is stopped or updated: with that grant the app puts it back by itself
 * (at start, after an update, after a reboot). The undo takes both away. It only sees which window
 * came forward and reads no screen content.
 *
 * If couch-tv itself keeps crashing (CrashGuard), the watch stands aside and leaves the TV's own
 * home on screen, so a broken couch-tv can never hold the TV in a loop.
 */
class FireWatch : AccessibilityService() {
    private var last = 0L
    private val handler = Handler(Looper.getMainLooper())
    /** True while the latest window change this service saw was the TV's own home (events only, no screen reading). */
    private var stockInFront = false
    private var recheckPending = false
    private val recheck = Runnable {
        recheckPending = false
        if (stockInFront && !CrashGuard.standingAside(this)) bringBack()
    }

    override fun onInterrupt() {}

    override fun onServiceConnected() {
        connected = true
        homeClasses = homeActivitiesOf(this)
        Log.i("couchtv.firewatch", "the Home button watch is connected")
        // The TV's own home can come up before this service is bound, and then its window event is
        // never seen (issue #44: Amazon's home sat on screen about 30 s at boot). The service has no
        // permission to read windows (that would be reading the screen), so it goes by the clock
        // instead: bound in the first minutes after a restart, nothing but the TV's own home can be
        // in front, so couch-tv goes on top once. Fire OS only: a Google TV can start on an HDMI
        // input or live TV, and that must never be covered.
        if (android.os.Build.MANUFACTURER.equals("Amazon", ignoreCase = true) &&
            SystemClock.elapsedRealtime() < BOOT_WINDOW_MS && !CrashGuard.standingAside(this)) {
            Log.i("couchtv.firewatch", "bound just after a restart: putting couch-tv in front")
            runCatching { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        connected = false
        handler.removeCallbacks(recheck)
        recheckPending = false
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        stockInFront = isStockHome(e.packageName?.toString(), e.className?.toString())
        if (!stockInFront) return
        if (CrashGuard.standingAside(this)) return
        val wait = DEBOUNCE_MS - (System.currentTimeMillis() - last)
        if (wait > 0) {
            // Skipped as a repeat press. Some Google TVs (seen on a Xiaomi) keep the Google home as the
            // resolved home, so quick Home presses can leave it in front with no further window event
            // (issue #54): look once more when the debounce ends. One re-check at most, never a loop.
            if (!recheckPending) {
                recheckPending = true
                handler.postDelayed(recheck, wait + 50)
            }
            return
        }
        bringBack()
    }

    private fun bringBack() {
        last = System.currentTimeMillis()
        runCatching { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** After an update or a reboot: put the watcher back if it was switched on. */
    class Restore : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action == Intent.ACTION_MY_PACKAGE_REPLACED) CrashGuard.reset(c)   // a new version gets a fresh try
            runCatching { ensure(c) }
        }
    }

    companion object {
        /** Set while Android has this service bound. */
        @Volatile var connected = false
        private const val DEBOUNCE_MS = 1200L   // one jump per press, not one per event
        private const val BOOT_WINDOW_MS = 2 * 60_000L

        /**
         * The watch listed as on in Settings but not bound (what a force-stop leaves behind, the same
         * blind spot as issue #37): take it out of the list and put it back so Android binds it.
         * Call a few seconds after the app starts, once Android has had its chance to bind it itself.
         */
        fun rebindIfUnbound(c: Context) {
            if (connected) return
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            Thread {
                runCatching {
                    val cr = c.contentResolver
                    val me = "${c.packageName}/${FireWatch::class.java.name}"
                    val list = (Settings.Secure.getString(cr, "enabled_accessibility_services") ?: "").split(':').filter { it.isNotEmpty() && it != "null" }
                    if (list.none { it == me || it == "${c.packageName}/.FireWatch" } || connected) return@runCatching
                    Log.i("couchtv.firewatch", "listed but not bound: rebinding the Home button watch")
                    val rest = list.filter { it != me && it != "${c.packageName}/.FireWatch" }
                    Settings.Secure.putString(cr, "enabled_accessibility_services", rest.joinToString(":"))
                    Thread.sleep(2000)
                    Settings.Secure.putString(cr, "enabled_accessibility_services", (rest + me).joinToString(":"))
                }
            }.start()
        }

        const val AMAZON_HOME = "com.amazon.tv.launcher"
        const val GOOGLE_TV_HOME = "com.google.android.apps.tv.launcherx"
        const val ANDROID_TV_HOME = "com.google.android.tvlauncher"
        /** Fire OS's own Settings screen, opened by name (see [amazonSettings]). */
        const val AMAZON_SETTINGS = "$AMAZON_HOME.ui.MainSettingsActivity"
        private val STOCK_HOMES = listOf(AMAZON_HOME, GOOGLE_TV_HOME, ANDROID_TV_HOME)

        /** The activities of the Google homes that the TV itself lists as a HOME screen (read when the service binds). */
        @Volatile var homeClasses: Set<String> = emptySet()

        /**
         * Google TV's home is not always `.home.HomeActivity`: a TCL on Android TV 11 starts
         * `.home.VanillaModeHomeActivity` (issue #51). Whatever the package declares as a HOME
         * activity is the home; its profile, account and setup screens are not HOME activities.
         */
        fun homeActivitiesOf(c: Context): Set<String> = runCatching {
            val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            c.packageManager.queryIntentActivities(q, 0)
                .filter { it.activityInfo.packageName == GOOGLE_TV_HOME || it.activityInfo.packageName == ANDROID_TV_HOME }
                .map { it.activityInfo.name }.toSet()
        }.getOrDefault(emptySet())

        /**
         * The TV's own home screen, not its other screens. Amazon's launcher package also holds
         * Fire OS's Settings screens, and the Google TV home package holds profile, account and
         * setup screens: only the home itself is replaced.
         */
        fun isStockHome(pkg: String?, cls: String?, homes: Set<String> = homeClasses): Boolean = when (pkg) {
            AMAZON_HOME -> cls?.contains("Settings") != true
            GOOGLE_TV_HOME -> cls == "$GOOGLE_TV_HOME.home.HomeActivity" || cls == "$GOOGLE_TV_HOME.home.VanillaModeHomeActivity" || (cls != null && cls in homes)
            ANDROID_TV_HOME -> cls == "$ANDROID_TV_HOME.MainActivity" || (cls != null && cls in homes)
            else -> false
        }

        /**
         * The TV's Settings, as an intent that does not go through Amazon's home. On Fire OS the plain
         * Settings action goes through Amazon's home on its way there (`HomeActivity_vNext` draws the
         * Settings panel inside itself), so [isStockHome] cannot tell it from a Home press and the
         * Home button watch puts couch-tv straight back (issue #75, the same as #5 in the on-TV app).
         * Fire OS's own Settings screen, started by name, stays on screen. Null on any other TV,
         * which keeps the plain Settings action.
         */
        fun amazonSettings(pm: PackageManager): Intent? {
            val i = Intent().setComponent(ComponentName(AMAZON_HOME, AMAZON_SETTINGS))
            return if (runCatching { pm.getPackageInfo(AMAZON_HOME, 0) }.isSuccess && pm.resolveActivity(i, 0) != null) i else null
        }

        /** Puts the watcher back on, only where a computer granted secure settings and the TV has a stock home. */
        fun ensure(c: Context) {
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            if (STOCK_HOMES.none { p -> runCatching { c.packageManager.getPackageInfo(p, 0) }.isSuccess }) return
            runCatching {
                val cr = c.contentResolver
                val me = "${c.packageName}/${FireWatch::class.java.name}"
                val list = (Settings.Secure.getString(cr, "enabled_accessibility_services") ?: "").split(':').filter { it.isNotEmpty() && it != "null" }
                if (list.none { it == me || it == "${c.packageName}/.FireWatch" }) {
                    Settings.Secure.putString(cr, "enabled_accessibility_services", (list + me).joinToString(":"))
                    Log.i("couchtv.firewatch", "switched the Home button watch back on")
                }
                Settings.Secure.putInt(cr, "accessibility_enabled", 1)
            }.onFailure { Log.w("couchtv.firewatch", "could not switch the watch on: ${it.message}") }
        }
    }
}
