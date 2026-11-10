package app.couchtv.launcher

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.media.tv.TvInputService
import android.os.Build
import android.util.Log

/**
 * A TV input that does nothing, for TCL TVs only (issue #94).
 *
 * TCL's boot manager (`TclAppBoot`) refuses, on every boot, to bind FireWatch and KeyWatch and to
 * deliver BOOT_COMPLETED to FireWatch.Restore, because the app lacks TCL's AUTO_START app-op, which
 * TCL resets to "ignore" on every boot. So Home falls back to Google TV after each restart. The
 * reporter says TCL's list always lets an app through that provides a TV input, which is what the
 * Haven launcher is said to rely on (its source was not found, so this was written from the
 * Android TvInputService docs, nothing copied).
 *
 * It must not show up as an input on other TVs (Sony, Philips, Google TV Streamer), so the service
 * is declared `android:enabled="false"` in the manifest and [enableIfTcl] switches it on, once, only
 * when the maker or brand is TCL. Android remembers the switch across reboots, so it is the first
 * start of the app (after an install, over ADB or the in app update) that counts: TCL blocks the
 * boot time start, so the app has to be opened once after installing. Unverified on a real TCL: if
 * TCL only whitelists a component that is enabled at boot, this is exactly that; if it reads declared
 * inputs only, the disabled state would not matter but enabled is the safe side.
 */
class TclPlaceholderInput : TvInputService() {
    /** No session: nothing ever plays, there is nothing to tune. */
    override fun onCreateSession(inputId: String): Session? = null

    companion object {
        fun isTcl(): Boolean = Build.MANUFACTURER.equals("TCL", ignoreCase = true) ||
            Build.BRAND.equals("TCL", ignoreCase = true)

        /** Switch the placeholder input on, on a TCL TV only. Safe to call on every start. */
        fun enableIfTcl(c: Context) {
            if (!isTcl()) return
            runCatching {
                val me = ComponentName(c, TclPlaceholderInput::class.java)
                if (c.packageManager.getComponentEnabledSetting(me) != PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                    c.packageManager.setComponentEnabledSetting(me, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
                    Log.i("couchtv.tcl", "TCL TV: placeholder TV input switched on (issue #94)")
                }
            }
        }
    }
}
