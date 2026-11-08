package app.couchtv.launcher

import android.app.Application

/** Starts the crash guard before anything else in the app runs (CrashGuard.kt). */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
    }
}
