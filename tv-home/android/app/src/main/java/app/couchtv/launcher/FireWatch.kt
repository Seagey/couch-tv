package app.couchtv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        if (!isStockHome(e.packageName?.toString(), e.className?.toString())) return
        if (CrashGuard.standingAside(this)) return
        val now = System.currentTimeMillis()
        if (now - last < 1200) return   // one jump per press, not one per event
        last = now
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
        const val AMAZON_HOME = "com.amazon.tv.launcher"
        const val GOOGLE_TV_HOME = "com.google.android.apps.tv.launcherx"
        const val ANDROID_TV_HOME = "com.google.android.tvlauncher"
        private val STOCK_HOMES = listOf(AMAZON_HOME, GOOGLE_TV_HOME, ANDROID_TV_HOME)

        /**
         * The TV's own home screen, not its other screens. Amazon's launcher package also holds
         * Fire OS's Settings screens, and the Google TV home package holds profile, account and
         * setup screens: only the home itself is replaced.
         */
        fun isStockHome(pkg: String?, cls: String?): Boolean = when (pkg) {
            AMAZON_HOME -> cls?.contains("Settings") != true
            GOOGLE_TV_HOME -> cls == "$GOOGLE_TV_HOME.home.HomeActivity"
            ANDROID_TV_HOME -> cls == "$ANDROID_TV_HOME.MainActivity"
            else -> false
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
