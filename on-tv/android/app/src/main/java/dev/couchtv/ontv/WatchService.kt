package dev.couchtv.ontv

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Sees Amazon's home come on screen, event for event, on Fire OS builds that give third-party
 * apps neither their own ADB nor usage events (both seen blocked on Fire OS 8.1.8.5 / RS8185).
 * FireHome switches this service on with the secure-settings grant, and Android keeps it bound
 * across reboots, so the Home key keeps landing on this app's home with no computer involved.
 */
class WatchService : AccessibilityService() {
    override fun onServiceConnected() { connected = true; FireHome.readHomes() }
    override fun onDestroy() { connected = false; super.onDestroy() }
    override fun onInterrupt() {}

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString(); val cls = e.className?.toString()
        if (FireHome.isAmazonHome(pkg, cls)) FireHome.onAmazonHome() else FireHome.onOtherHome(pkg, cls)
    }

    companion object { @Volatile var connected = false }
}
