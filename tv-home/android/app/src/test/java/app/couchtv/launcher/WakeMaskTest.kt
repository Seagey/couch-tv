package app.couchtv.launcher

import app.couchtv.launcher.WakeEvent.*
import app.couchtv.launcher.WakePhase.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeMaskTest {
    private val home = "app.couchtv.launcher"

    @Test fun restartCoversOnlyFromIdle() {
        assertEquals(AWAKE, decideWakeMask(IDLE, BOOT))
        assertEquals(ARMED, decideWakeMask(ARMED, BOOT))
        assertEquals(AWAKE, decideWakeMask(AWAKE, BOOT))
        assertEquals(FADING, decideWakeMask(FADING, BOOT))
    }

    @Test fun restartCoverWaitsPastTheWakeTimeout() {
        val limit = BOOT_COVER_TIMEOUT_MS
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = WAKE_TIMEOUT_MS, limit = limit))
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = limit - 1, limit = limit))
        assertEquals(FADING, decideWakeMask(AWAKE, CHECK, sinceWake = 9_000, ready = true, limit = limit))
        assertEquals(IDLE, decideWakeMask(AWAKE, CHECK, sinceWake = limit, limit = limit))
    }

    @Test fun screenOffArmsAndIgnoresRevealRequests() {
        assertEquals(ARMED, decideWakeMask(IDLE, SCREEN_OFF))
        assertEquals(ARMED, decideWakeMask(ARMED, CHECK, sinceWake = 6_000, ready = true))
        assertEquals(ARMED, decideWakeMask(ARMED, DOORBELL))
    }

    @Test fun drawnHomeRevealsAtSettle() {
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = 1_499, ready = true))
        assertEquals(FADING, decideWakeMask(AWAKE, CHECK, sinceWake = 1_500, ready = true))
    }

    @Test fun homeStillWaitingCanRevealAfterSettle() {
        assertFalse(isOtherWakeApp(home, home))
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = 1_500))
        assertEquals(FADING, decideWakeMask(AWAKE, CHECK, sinceWake = 2_100, ready = true))
    }

    @Test fun liveTvQualifiesOnceSettled() {
        val liveTv = isOtherWakeApp("com.tcl.tv", home)
        assertTrue(liveTv)
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = 1_499, ready = liveTv))
        assertEquals(FADING, decideWakeMask(AWAKE, CHECK, sinceWake = 1_500, ready = liveTv))
    }

    @Test fun launcherAndSystemUiDoNotQualifyAndTimeoutClearsMask() {
        val launcher = isOtherWakeApp(FireWatch.GOOGLE_TV_HOME, home)
        assertFalse(launcher)
        assertFalse(isOtherWakeApp("com.android.systemui", home))
        assertFalse(isOtherWakeApp(null, home))
        assertEquals(AWAKE, decideWakeMask(AWAKE, CHECK, sinceWake = 5_999, ready = launcher))
        assertEquals(IDLE, decideWakeMask(AWAKE, CHECK, sinceWake = 6_000, ready = launcher))
        assertEquals(IDLE, decideWakeMask(FADING, CHECK, sinceWake = 6_000))
    }

    @Test fun doorbellRevealsImmediatelyWhenAwake() {
        assertEquals(IDLE, decideWakeMask(AWAKE, DOORBELL))
        assertEquals(IDLE, decideWakeMask(FADING, DOORBELL))
    }

    @Test fun secondWakeEventDoesNotStartAnotherWakeOrInterruptFade() {
        val wake = decideWakeMask(ARMED, SCREEN_ON)
        assertEquals(AWAKE, wake)
        assertEquals(wake, decideWakeMask(wake, SCREEN_ON))
        assertEquals(FADING, decideWakeMask(FADING, SCREEN_ON))
        assertEquals(IDLE, decideWakeMask(IDLE, SCREEN_ON))
    }

    @Test fun screenOffDuringFadeRearmsAndIgnoresTheOldFadeEnd() {
        assertEquals(IDLE, decideWakeMask(FADING, FADE_ENDED))
        val off = decideWakeMask(FADING, SCREEN_OFF)
        assertEquals(ARMED, off)
        assertEquals(ARMED, decideWakeMask(off, FADE_ENDED))
        assertEquals(AWAKE, decideWakeMask(off, SCREEN_ON))
    }

    @Test
    fun armsOnlyOverCouchTvOrGoogleTvHome() {
        val home = "app.couchtv.launcher"
        assertTrue(shouldArmWakeMask(home, home))
        assertTrue(shouldArmWakeMask(FireWatch.GOOGLE_TV_HOME, home))
        assertFalse(shouldArmWakeMask("com.tcl.tv", home))
        assertFalse(shouldArmWakeMask("com.google.android.youtube.tv", home))
        assertFalse(shouldArmWakeMask(null, home))
    }
}
