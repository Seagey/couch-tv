package app.couchtv.launcher

import android.app.Application

/** Starts the crash guard before anything else in the app runs (CrashGuard.kt). */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashGuard.install(this)
        TclPlaceholderInput.enableIfTcl(this)   // TCL only, issue #94
        // Matter: the resolver with the IPv6 fallback and the Thread route check (before the first Matter call)
        runCatching { dev.couchtv.ontv.matter.DiscoveryChipResolver.install(this) }
        // Matter devices added before: start their live state (nothing loads if there are none)
        runCatching { dev.couchtv.ontv.matter.Matter.init(this) }
        WatchRepair.schedule(this)   // puts the Home button watch back if the TV kills the app
    }
}
