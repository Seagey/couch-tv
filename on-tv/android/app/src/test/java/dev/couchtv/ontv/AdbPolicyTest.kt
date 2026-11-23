package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Launch audit, 24 Nov 2026: the "Allow USB debugging?" box that came back after Update to (AdbPolicy). */
class AdbPolicyTest {
    @Test fun aBackgroundCheckWaitsLongEnoughToAnswer() {
        // it was 8 s: the connection was gone before anyone reached Allow, so Allow was ignored
        assertEquals(60L, AdbPolicy.allowSeconds(interactive = false, sdk = 31, okTcp = true))
        assertEquals(60L, AdbPolicy.allowSeconds(interactive = false, sdk = 34, okTcp = false))
        assertTrue(AdbPolicy.BACKGROUND_ALLOW_SECONDS >= 30)
    }

    @Test fun connectKeepsItsOwnWaits() {
        assertEquals(120L, AdbPolicy.allowSeconds(interactive = true, sdk = 31, okTcp = false))
        assertEquals(120L, AdbPolicy.allowSeconds(interactive = true, sdk = 34, okTcp = true))
        assertEquals(45L, AdbPolicy.allowSeconds(interactive = true, sdk = 33, okTcp = false))
    }

    @Test fun noBoxLoopFromTheBackground() {
        // never allowed: the background never knocks on 5555
        assertFalse(AdbPolicy.mayTryTcp(interactive = false, okTcp = false, bgUnanswered = false))
        // allowed before: it may reconnect quietly
        assertTrue(AdbPolicy.mayTryTcp(interactive = false, okTcp = true, bgUnanswered = false))
        // a background box went unanswered: no more boxes from the background
        assertFalse(AdbPolicy.mayTryTcp(interactive = false, okTcp = true, bgUnanswered = true))
        // Connect always may, and clears the flag (Adb.ensure)
        assertTrue(AdbPolicy.mayTryTcp(interactive = true, okTcp = true, bgUnanswered = true))
        assertTrue(AdbPolicy.mayTryTcp(interactive = true, okTcp = false, bgUnanswered = false))
    }

    @Test fun anUnansweredBoxIsTheWholeWait() {
        assertTrue(AdbPolicy.ranOut(60_000, 60))
        assertTrue(AdbPolicy.ranOut(58_500, 60))
        assertFalse(AdbPolicy.ranOut(3_000, 60))   // a refusal or a closed port comes back fast
    }
}
