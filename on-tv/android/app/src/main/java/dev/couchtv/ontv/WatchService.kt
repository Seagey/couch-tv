package dev.couchtv.ontv

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * Sees Amazon's home come on screen, event for event, on Fire OS builds that give third-party
 * apps neither their own ADB nor usage events (both seen blocked on Fire OS 8.1.8.5 / RS8185).
 * FireHome switches this service on with the secure-settings grant, and Android keeps it bound
 * across reboots, so the Home key keeps landing on this app's home with no computer involved.
 *
 * On Xiaomi with "Couch TV in PatchWall's place" on, it also filters keys, for one key only (see
 * onKeyEvent). Key filtering is requested at run time only then, so on every other TV, and on a
 * Xiaomi with the switch off, no key passes through this app.
 */
class WatchService : AccessibilityService() {
    override fun onServiceConnected() { connected = true; instance = this; FireHome.readHomes(); applyKeyFilter() }
    override fun onDestroy() { connected = false; if (instance === this) instance = null; super.onDestroy() }
    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString(); val cls = e.className?.toString()
        FireHome.seen(pkg, cls)
        when {
            FireHome.isAmazonHome(pkg, cls) -> FireHome.onAmazonHome()
            FireHome.isPatchWall(pkg, cls) -> FireHome.onPatchWall()
            else -> FireHome.onOtherHome(pkg, cls)
        }
    }

    /**
     * Xiaomi remotes: the PatchWall button arrives as KEYCODE_BUTTON_5 (scan code 580 on the
     * MiTV-AXFR0's remote, whose layout also maps 150 to it), and the TV's partnercustomizer turns
     * it into a start of PatchWall by name. Here it opens Couch TV instead and is swallowed (a long
     * press's repeats too: one open, on release). Every other key goes straight on; the check costs
     * about 2 to 4 ms per key press on that TV.
     */
    override fun onKeyEvent(e: KeyEvent): Boolean {
        if (e.keyCode != KeyEvent.KEYCODE_BUTTON_5 || !FireHome.replacePatchWall) return false
        if (e.action == KeyEvent.ACTION_UP && !e.isCanceled) App.openHome()
        return true
    }

    private fun applyKeyFilter() {
        val info = serviceInfo ?: return
        val want = FireHome.replacePatchWall
        val has = info.flags and AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS != 0
        if (want == has) return
        info.flags = if (want) info.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
            else info.flags and AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS.inv()
        serviceInfo = info
    }

    companion object {
        @Volatile var connected = false
        @Volatile private var instance: WatchService? = null
        /** After "patchwall_replace" changes: start or stop filtering keys straight away. */
        fun keyFilterChanged() {
            instance?.let { s -> android.os.Handler(android.os.Looper.getMainLooper()).post { s.applyKeyFilter() } }
        }
    }
}
