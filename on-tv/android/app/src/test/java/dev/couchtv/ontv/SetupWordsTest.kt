package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Couch TV setup screen's words (SetupWords.kt): plain, and right after pairing it says so. */
class SetupWordsTest {
    private val jargon = Regex("\\b(ADB|adb|accessibility|debugging|IP)\\b")

    @Test fun showsTheCodeWhileOneIsLive() {
        assertEquals("Phone code  123 456", SetupWords.pairLine("123456", 0, null))
    }

    @Test fun saysPairedRightAfterPairing() {
        // the report: after pairing the TV said "Phone code: press New phone code", which looks like it failed
        assertEquals("Your phone is paired", SetupWords.pairLine(null, 1, 5_000))
        assertTrue(SetupWords.nextLine(null, 1, false).startsWith("Next: press Open the home"))
    }

    @Test fun laterItCountsThePhones() {
        assertEquals("1 phone is paired", SetupWords.pairLine(null, 1, 60 * 60_000L))
        assertEquals("2 phones are paired", SetupWords.pairLine(null, 2, null))
        assertEquals("No phone yet: press New phone code", SetupWords.pairLine(null, 0, null))
    }

    @Test fun firstScreenHasNoJargon() {
        val all = listOf(SetupWords.pairLine(null, 0, null), SetupWords.nextLine("123456", 0, false), SetupWords.nextLine(null, 1, true),
            SetupWords.keysLine(false, false, false), SetupWords.keysLine(true, false, false), SetupWords.keysLine(false, false, true),
            SetupWords.homeNote(true, false, true), SetupWords.homeNote(false, false, false), SetupWords.homeNote(true, true, false))
        all.forEach { assertFalse(it, jargon.containsMatchIn(it)) }
    }

    @Test fun googleTvSaysHomeStaysGoogles() {
        assertTrue(SetupWords.homeNote(true, false, true).contains("Home button always opens Google TV"))
    }
}
