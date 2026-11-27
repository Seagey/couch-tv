package app.couchtv.launcher

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.UserManager

/** Starts the crash guard before anything else in the app runs (CrashGuard.kt). */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
        // FireWatch can start this process before the TV has unlocked its storage (it is directBootAware,
        // see there): then only the crash guard runs now, and the rest once the storage is unlocked.
        if (locked(this)) { whenUnlocked(this) { started() }; return }
        started()
    }

    private fun started() {
        TclPlaceholderInput.enableIfTcl(this)   // TCL only, issue #94
        // Matter: the resolver with the IPv6 fallback and the Thread route check (before the first Matter call)
        runCatching { dev.couchtv.ontv.matter.DiscoveryChipResolver.install(this) }
        // Matter devices added before: start their live state (nothing loads if there are none)
        runCatching { dev.couchtv.ontv.matter.Matter.init(this) }
        WatchRepair.schedule(this)   // puts the Home button watch back if the TV kills the app
    }

    companion object {
        private const val UNLOCK_LOOK_MS = 50L
        private const val UNLOCK_LOOKS = 1200   // a minute
        /** The TV has just started and its storage is not unlocked yet: no settings, files or other app's screens. */
        fun locked(c: Context): Boolean =
            Build.VERSION.SDK_INT >= 24 && c.getSystemService(UserManager::class.java)?.isUserUnlocked == false

        /**
         * Runs [then] once, on the main thread, as soon as the storage is unlocked (straight away if it
         * already is). The returned function cancels the wait.
         */
        fun whenUnlocked(c: Context, then: () -> Unit): () -> Unit {
            val app = c.applicationContext
            var done = false
            val main = Handler(Looper.getMainLooper())
            val once = { if (!done) { done = true; then() } }
            val r = object : BroadcastReceiver() {
                override fun onReceive(x: Context, i: Intent) { runCatching { app.unregisterReceiver(this) }; once() }
            }
            app.registerReceiver(r, IntentFilter(Intent.ACTION_USER_UNLOCKED), null, main)
            // TCL holds USER_UNLOCKED back about half a second ("VIP Env is not Ready"), and in that
            // half second its boot controller opens the Google home: look every 50 ms as well.
            var tries = 0
            val look = object : Runnable {
                override fun run() {
                    if (done) return
                    if (!locked(app)) { runCatching { app.unregisterReceiver(r) }; once() }
                    else if (++tries < UNLOCK_LOOKS) main.postDelayed(this, UNLOCK_LOOK_MS)
                }
            }
            main.post(look)
            return { main.post { if (!done) { done = true; main.removeCallbacks(look); runCatching { app.unregisterReceiver(r) } } } }
        }
    }
}
