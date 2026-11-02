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
 * Fire TV and the Home key. Amazon's TVs start Amazon's launcher from the Home key by name and
 * ignore the default-home setting, so this home cannot simply be chosen. This watcher sees
 * Amazon's home come on screen and puts this home back on top. Amazon's home still flashes up for a
 * moment; without root that is as good as Fire OS allows.
 *
 * Off until a computer switches it on over ADB (tv-home/tools/apply.sh, or guest-tv's
 * `tools/tv_app.py home`, on a Fire TV only). They also grant WRITE_SECURE_SETTINGS, because Android
 * drops the watcher whenever the app is stopped or updated: with that grant the app puts it back by
 * itself (at start, after an update, after a reboot). The undo takes both away. It only sees which
 * window came forward and reads no screen content.
 */
class FireWatch : AccessibilityService() {
    private var last = 0L

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        // Amazon's launcher package also holds Fire OS's Settings screens; those are left alone.
        if (e.packageName?.toString() != AMAZON_HOME || e.className?.toString()?.contains("Settings") == true) return
        val now = System.currentTimeMillis()
        if (now - last < 1200) return   // one jump per press, not one per event
        last = now
        runCatching { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /** After an update or a reboot: put the watcher back if it was switched on. */
    class Restore : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { ensure(c) }
    }

    companion object {
        const val AMAZON_HOME = "com.amazon.tv.launcher"

        /** Puts the watcher back on, only on a Fire TV where a computer granted secure settings. */
        fun ensure(c: Context) {
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            if (runCatching { c.packageManager.getPackageInfo(AMAZON_HOME, 0) }.isFailure) return
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
