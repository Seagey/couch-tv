package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The wait for "Allow USB debugging?" when the TV's box is hidden behind the setup screen (TCL, 23 Nov 2026). */
class AllowWaitTest {
    private val late = AllowWait.HIDDEN_AFTER_MS + 500

    @Test fun aBoxThatShowsIsLeftAlone() {
        // the box came over the setup screen: the person is reading it, so no line and no stepping aside, however long
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(60_000, waiting = true, focused = true, lostFocus = true, inFront = true, steppedAside = false))
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(late, waiting = true, focused = false, lostFocus = true, inFront = false, steppedAside = false))
    }

    @Test fun theFirstSecondsAreQuiet() {
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(0, true, true, false, true, false))
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(AllowWait.HIDDEN_AFTER_MS - 1, true, true, false, true, false))
        assertTrue(AllowWait.HIDDEN_AFTER_MS in 5_000L..15_000L)
    }

    @Test fun noBoxOverTheScreenMeansItIsHidden() {
        // the TCL: the old box stayed behind SetupActivity, adbd said "prompt currently pending, skipping"
        assertEquals(AllowWait.Hint(sayHidden = true, stepAside = true), AllowWait.hint(late, waiting = true, focused = true, lostFocus = false, inFront = true, steppedAside = false))
    }

    @Test fun itStepsAsideOnlyOnce() {
        // back in front after stepping aside (Back from the TV's home, or Couch TV opened again): the line stays, no second move
        assertEquals(AllowWait.Hint(sayHidden = true, stepAside = false), AllowWait.hint(late * 3, true, true, false, true, steppedAside = true))
    }

    @Test fun nothingWhenNotWaitingOrNotInFront() {
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(late, waiting = false, focused = true, lostFocus = false, inFront = true, steppedAside = false))
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(late, waiting = true, focused = true, lostFocus = false, inFront = false, steppedAside = false))
        assertEquals(AllowWait.Hint(false, false), AllowWait.hint(late, waiting = true, focused = false, lostFocus = false, inFront = true, steppedAside = false))
    }

    @Test fun backStepsAsideOnlyWhileTheLineIsUp() {
        assertTrue(AllowWait.backStepsAside(hiddenShown = true, waiting = true))
        assertFalse(AllowWait.backStepsAside(hiddenShown = false, waiting = true))   // Back goes to the step before, as always
        assertFalse(AllowWait.backStepsAside(hiddenShown = true, waiting = false))
    }

    @Test fun theSetupScreenComesBackOnceItWorked() {
        assertTrue(AllowWait.comeBack(steppedAside = true, connected = true, inFront = false))
        assertFalse(AllowWait.comeBack(steppedAside = true, connected = false, inFront = false))   // no answer: left where the person is
        assertFalse(AllowWait.comeBack(steppedAside = false, connected = true, inFront = false))
        assertFalse(AllowWait.comeBack(steppedAside = true, connected = true, inFront = true))
    }

    @Test fun theScreenStaysOnWhileWaiting() {
        assertTrue(AllowWait.keepScreenOn(true))
        assertFalse(AllowWait.keepScreenOn(false))
    }

    @Test fun theLineIsPlain() {
        val s = SetupWords.ALLOW_HIDDEN
        assertEquals("The TV's Allow box may be hidden. Press Back once to see it, or switch USB debugging off and on.", s)
        assertFalse(s.contains("ADB") || s.contains('–') || s.contains('—') || s.contains(" - "))
    }
}
