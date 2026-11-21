package app.couchtv.launcher

import android.app.Application

/** Starts the crash guard before anything else in the app runs (CrashGuard.kt). */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
        TclPlaceholderInput.enableIfTcl(this)   // TCL only, issue #94
        WatchRepair.schedule(this)   // puts the Home button watch back if the TV kills the app
    }
}
