package app.couchtv.launcher

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.View
import android.view.WindowManager
import android.view.WindowManager.LayoutParams as Window

internal const val WAKE_SETTLE_MS = 1_500L
internal const val WAKE_TIMEOUT_MS = 6_000L

internal enum class WakePhase { IDLE, ARMED, AWAKE, FADING }
internal enum class WakeEvent { SCREEN_OFF, SCREEN_ON, CHECK, DOORBELL, FADE_ENDED }

internal fun isOtherWakeApp(pkg: String?, homePackage: String): Boolean =
    pkg != null && pkg != homePackage && pkg != FireWatch.GOOGLE_TV_HOME && pkg != "com.android.systemui"

/** Arm only over couch-tv or the Google TV home, so a TV that sleeps on HDMI or live TV wakes back to it uncovered. */
internal fun shouldArmWakeMask(lastFront: String?, homePackage: String): Boolean =
    lastFront == homePackage || lastFront == FireWatch.GOOGLE_TV_HOME

internal fun decideWakeMask(
    phase: WakePhase,
    event: WakeEvent,
    sinceWake: Long = 0L,
    ready: Boolean = false
): WakePhase = when (event) {
    WakeEvent.SCREEN_OFF -> WakePhase.ARMED
    WakeEvent.SCREEN_ON -> if (phase == WakePhase.ARMED) WakePhase.AWAKE else phase
    WakeEvent.DOORBELL -> if (phase == WakePhase.AWAKE || phase == WakePhase.FADING) WakePhase.IDLE else phase
    WakeEvent.FADE_ENDED -> if (phase == WakePhase.FADING) WakePhase.IDLE else phase
    WakeEvent.CHECK -> when {
        phase != WakePhase.AWAKE && phase != WakePhase.FADING -> phase
        sinceWake >= WAKE_TIMEOUT_MS -> WakePhase.IDLE
        phase == WakePhase.AWAKE && sinceWake >= WAKE_SETTLE_MS && ready -> WakePhase.FADING
        else -> phase
    }
}

/** A main-thread overlay owned by the watch. Only window-event metadata is used. */
internal class WakeMask private constructor(
    private val service: AccessibilityService,
    private val handler: Handler
) {
    private val windows = service.getSystemService(WindowManager::class.java)
    private val displays = service.getSystemService(DisplayManager::class.java)
    private var displayState = displays?.getDisplay(Display.DEFAULT_DISPLAY)?.state
    private var view: View? = null
    private var phase = WakePhase.IDLE
    private var wokeAt = 0L
    private var token: Any? = null
    private var latestPackage: String? = null
    private var lastFront: String? = null
    private var ownDialog = false
    private val check = Runnable { checkContent() }
    private val settle = Runnable { checkContent() }
    private val timeout = Runnable { transition(WakeEvent.CHECK, sinceWake = WAKE_TIMEOUT_MS) }

    private val screenChanged = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> screenOff()
                Intent.ACTION_SCREEN_ON -> screenOn()
            }
        }
    }

    private val displayChanged = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = Unit
        override fun onDisplayRemoved(displayId: Int) = Unit

        override fun onDisplayChanged(displayId: Int) {
            if (displayId != Display.DEFAULT_DISPLAY) return
            val previous = displayState
            displayState = displays?.getDisplay(displayId)?.state
            if (previous != Display.STATE_ON && displayState == Display.STATE_ON) screenOn()
        }
    }

    private fun screenOff() {
        if (phase == WakePhase.ARMED) return
        // A late SCREEN_OFF after the screen already came back on must not cover it.
        if (interactive()) return
        if (phase == WakePhase.IDLE && !shouldArmWakeMask(lastFront, service.packageName)) return
        if (phase == WakePhase.IDLE && !runCatching {
                HomeRole.googleTv(service) && HomeRole.held(service) && !CrashGuard.standingAside(service)
            }.getOrDefault(false)) return
        transition(WakeEvent.SCREEN_OFF)
    }

    private fun screenOn() {
        transition(WakeEvent.SCREEN_ON)
    }

    private fun interactive(): Boolean =
        runCatching { service.getSystemService(PowerManager::class.java)?.isInteractive == true }.getOrDefault(false)

    fun windowChanged(pkg: String?, cls: String?) {
        if (pkg != null && pkg != "com.android.systemui") lastFront = pkg
        // Backstop: a window event on a lit screen means the wake happened even if neither
        // SCREEN_ON nor the display callback reached us, so the 6 s timeout starts here at the latest.
        if (phase == WakePhase.ARMED && interactive()) screenOn()
        if (phase != WakePhase.ARMED && phase != WakePhase.AWAKE) return
        latestPackage = pkg
        // An app-owned native dialog has its own window while MainActivity stays resumed.
        ownDialog = pkg == service.packageName && cls?.endsWith("Dialog") == true
        queueCheck()
    }

    private fun queueCheck() {
        if (phase != WakePhase.AWAKE) return
        handler.removeCallbacks(check)
        handler.post(check)
    }

    private fun checkContent() {
        if (phase != WakePhase.AWAKE) return
        val cycle = token ?: return
        val ready = isOtherWakeApp(latestPackage, service.packageName) ||
            MainActivity.wakeContentReady(cycle, ownDialog)
        transition(WakeEvent.CHECK, SystemClock.uptimeMillis() - wokeAt, ready)
    }

    private fun transition(event: WakeEvent, sinceWake: Long = 0L, ready: Boolean = false) {
        val next = decideWakeMask(phase, event, sinceWake, ready)
        if (next == phase) return
        phase = next
        when (next) {
            WakePhase.IDLE -> remove()
            WakePhase.ARMED -> {
                cancelWake()
                latestPackage = null
                ownDialog = false
                show()
                view?.let {
                    it.animate().cancel()
                    it.alpha = 1f
                }
            }
            WakePhase.AWAKE -> {
                wokeAt = SystemClock.uptimeMillis()
                token = Any()
                handler.postDelayed(timeout, WAKE_TIMEOUT_MS)
                handler.postDelayed(settle, WAKE_SETTLE_MS)
                // A doorbell card created while the screen was off is already up: don't hide it.
                if (Doorbell.showing()) { transition(WakeEvent.DOORBELL); return }
                queueCheck()
            }
            WakePhase.FADING -> view?.animate()?.alpha(0f)?.setDuration(150L)
                ?.withEndAction { transition(WakeEvent.FADE_ENDED) }?.start()
        }
    }

    private fun show() {
        if (view != null) return
        val manager = windows ?: return
        val mask = View(service).apply {
            setBackgroundColor(Color.BLACK)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val params = Window(Window.MATCH_PARENT, Window.MATCH_PARENT, Window.TYPE_ACCESSIBILITY_OVERLAY,
            Window.FLAG_NOT_FOCUSABLE or Window.FLAG_NOT_TOUCHABLE or Window.FLAG_LAYOUT_IN_SCREEN or
                Window.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT)
        if (Build.VERSION.SDK_INT >= 30) params.setFitInsetsTypes(0)
        runCatching { manager.addView(mask, params) }
            .onSuccess { view = mask }
            .onFailure { Log.w("couchtv.firewatch", "could not show the wake mask", it) }
    }

    private fun cancelWake() {
        handler.removeCallbacks(check)
        handler.removeCallbacks(settle)
        handler.removeCallbacks(timeout)
        token = null
    }

    private fun remove() {
        cancelWake()
        val mask = view ?: return
        view = null
        mask.animate().cancel()
        runCatching { windows?.removeViewImmediate(mask) }
    }

    fun close() {
        if (active === this) active = null
        runCatching { service.unregisterReceiver(screenChanged) }
        runCatching { displays?.unregisterDisplayListener(displayChanged) }
        phase = WakePhase.IDLE
        remove()
    }

    companion object {
        private var active: WakeMask? = null

        fun start(service: AccessibilityService, handler: Handler): WakeMask? {
            if (!TclPlaceholderInput.isTcl()) return null
            val mask = runCatching {
                WakeMask(service, handler).also {
                    service.registerReceiver(it.screenChanged, IntentFilter().apply {
                        addAction(Intent.ACTION_SCREEN_OFF)
                        addAction(Intent.ACTION_SCREEN_ON)
                    })
                }
            }.getOrElse {
                Log.w("couchtv.firewatch", "could not watch screen broadcasts for the wake mask", it)
                return null
            }
            runCatching { mask.displays?.registerDisplayListener(mask.displayChanged, handler) }
                .onFailure { Log.w("couchtv.firewatch", "could not watch display changes for the wake mask", it) }
            active = mask
            return mask
        }

        fun homeChanged() {
            active?.queueCheck()
        }

        fun doorbellShown(isInteractive: () -> Boolean) {
            val mask = active ?: return
            if (mask.phase != WakePhase.AWAKE && mask.phase != WakePhase.FADING) return
            // A pending HA reply can show a card before the SCREEN_OFF broadcast reaches us.
            if (isInteractive()) mask.transition(WakeEvent.DOORBELL)
        }
    }
}
