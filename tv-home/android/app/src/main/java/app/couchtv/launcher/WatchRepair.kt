package app.couchtv.launcher

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityManager

/**
 * Puts the Home button watch (FireWatch) back when the TV killed couch-tv and the watch with it.
 *
 * Seen on a Hisense Google TV (Android 11): something on the TV killed the app's process by signal
 * while the TV was in standby (not a crash, not a low memory kill). Android then listed FireWatch
 * under "crashed services", switched accessibility off and never bound it again, so the Home key
 * stayed on Google TV's home for days. The app's own repair (FireWatch.ensure, rebindIfUnbound)
 * only runs when couch-tv starts, and with the watch gone nothing started it.
 *
 * A periodic job does not need the app to be running: Android starts the process for it, about
 * every 15 minutes, and keeps it across restarts. It only acts where a computer granted
 * WRITE_SECURE_SETTINGS and FireWatch is still listed as on (so a watch someone switched off in
 * Settings stays off), and only when the watch is not actually running: then it switches
 * accessibility back on and takes the watch out of the list and back in, which makes Android bind
 * it afresh (the same as apply.sh does).
 */
class WatchRepair : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            runCatching { repair(applicationContext) }.onFailure { Log.w(TAG, "repair failed: ${it.message}") }
            jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true

    companion object {
        private const val TAG = "couchtv.watchrepair"
        private const val JOB_ID = 43017
        private const val EVERY_MS = 15 * 60_000L

        /** Schedules the check once; Android keeps it across restarts (setPersisted). */
        fun schedule(c: Context) {
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            runCatching {
                val js = c.getSystemService(JobScheduler::class.java) ?: return
                if (js.getPendingJob(JOB_ID) != null) return
                val job = JobInfo.Builder(JOB_ID, ComponentName(c, WatchRepair::class.java))
                    .setPeriodic(EVERY_MS)
                    .setPersisted(true)
                    .build()
                js.schedule(job)
                Log.i(TAG, "scheduled the Home button watch check")
            }.onFailure { Log.w(TAG, "could not schedule: ${it.message}") }
        }

        /** True when the watch is listed as on but Android is not running it. */
        fun needsRepair(c: Context): Boolean {
            val cr = c.contentResolver
            val me = "${c.packageName}/${FireWatch::class.java.name}"
            val short = "${c.packageName}/.FireWatch"
            val list = (Settings.Secure.getString(cr, "enabled_accessibility_services") ?: "")
                .split(':').filter { it.isNotEmpty() && it != "null" }
            if (list.none { it == me || it == short }) return false     // switched off on purpose, or never on
            val masterOn = Settings.Secure.getInt(cr, "accessibility_enabled", 0) == 1
            val am = c.getSystemService(AccessibilityManager::class.java) ?: return !masterOn
            val running = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK).any {
                val si = it.resolveInfo?.serviceInfo
                si != null && si.packageName == c.packageName && si.name == FireWatch::class.java.name
            }
            return !masterOn || !running
        }

        fun repair(c: Context) {
            if (c.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED) return
            if (!needsRepair(c)) return
            Log.i(TAG, "the Home button watch is not running: switching it back on")
            val cr = c.contentResolver
            val me = "${c.packageName}/${FireWatch::class.java.name}"
            val rest = (Settings.Secure.getString(cr, "enabled_accessibility_services") ?: "")
                .split(':').filter { it.isNotEmpty() && it != "null" && it != me && it != "${c.packageName}/.FireWatch" }
            Settings.Secure.putString(cr, "enabled_accessibility_services", rest.joinToString(":"))
            Thread.sleep(2000)
            Settings.Secure.putString(cr, "enabled_accessibility_services", (rest + me).joinToString(":"))
            Settings.Secure.putInt(cr, "accessibility_enabled", 1)
        }
    }
}
