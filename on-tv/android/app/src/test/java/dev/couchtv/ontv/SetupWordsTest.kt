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

    @Test fun phoneOnlyDownloadSaysHomeStaysGooglesAndWhereTheWatchIs() {
        // TCL beginner test, 0.13.3: Home kept opening Google's home with no warning on the TV
        val gtv = SetupWords.homeNote(true, false, true, watchApk = false)
        assertTrue(gtv.contains("That is expected"))
        assertTrue(gtv.contains("see More, Home button from a computer"))
        // Google's Android TV Home (a TCL): Couch TV held the home role, Home still opened Google's
        val tcl = SetupWords.homeNote(true, true, false, watchApk = false, googleHome = true)
        // 0.13.6: never "Couch TV is your home screen" there, since Home still opens Google's home
        assertTrue(tcl.startsWith("Android lists Couch TV as the home app"))
        assertFalse(tcl.contains("is your home screen"))
        assertTrue(tcl.contains("That is expected: see More, Home button from a computer"))
        // a TV with no Google home, or the watch APK: no warning
        assertEquals("Couch TV is your home screen. Press Home on the remote to see it.", SetupWords.homeNote(true, true, false))
        assertEquals("Couch TV is your home screen. Press Home on the remote to see it.",
            SetupWords.homeNote(true, true, false, watchApk = true, googleHome = true))
        assertTrue(SetupWords.homeNote(true, false, true, watchApk = true).contains("Couch TV home watch"))
    }

    @Test fun saysTheTruthFromAndroidNotASavedSwitch() {
        // TCL beginner test of 0.13.3: the switch was on, Google's home was still the default, and the screen
        // said Couch TV is your home screen
        val stale = SetupWords.homeNote(true, held = false, googleTv = false, opensUs = false)
        assertTrue(stale.startsWith("Couch TV is not your home screen yet"))
        assertTrue(stale.contains("Press Use as home screen to ask the TV again"))
        // Android holds the role but Home resolves to the TV's own home
        val byName = SetupWords.homeNote(true, held = true, googleTv = false, opensUs = false)
        assertFalse(byName.contains("is your home screen"))
        assertTrue(byName.contains("Home still opens the TV's own home"))
        assertEquals("Couch TV is your home screen. Press Home on the remote to see it.", SetupWords.homeNote(true, held = true, googleTv = false, opensUs = true))
    }

    @Test fun theWatchStepsAreExact() {
        val s = SetupWords.watchSteps("192.0.2.24")
        assertTrue(s.contains("couch-tv-ontv-watch.apk from github.com/Seagey/couch-tv/releases/latest"))
        assertTrue(s.contains("adb connect 192.0.2.24:5555"))
        assertTrue(s.contains("adb install -r couch-tv-ontv-watch.apk"))
        assertTrue(s.contains("keeps your settings"))
        assertTrue(s.contains("Couch TV home watch, On"))
        assertTrue(SetupWords.watchSteps(null).contains("adb connect the TV's address:5555"))
        // Wireless debugging pairs first (Fable review of 0.13.5)
        assertTrue(s.indexOf("adb pair") in 0 until s.indexOf("adb connect with the address and port"))
        // the watch only acts while Use as home screen is on, so that is a step, after the watch is switched on
        assertTrue(s.indexOf("press Use as home screen") > s.indexOf("Couch TV home watch, On"))
    }

    @Test fun googleTvWordsNameUseAsHomeScreen() {
        assertTrue(SetupWords.homeNote(false, false, true, watchApk = true).contains("press Use as home screen, then switch on Couch TV home watch"))
        assertTrue(SetupWords.homeNote(true, false, true, watchApk = false).contains("then press Use as home screen"))
    }

    @Test fun askingAndCancelSayWhatHappened() {
        assertTrue(SetupWords.homeNote(true, false, false, asking = true).contains("press Back once"))
        assertTrue(SetupWords.homeNote(false, false, false, declined = true).startsWith("Couch TV is not your home screen"))
    }

    @Test fun noLongDashesOrHedges() {
        val all = listOf(SetupWords.watchSteps("192.0.2.24"), SetupWords.homeNote(true, false, true), SetupWords.homeNote(true, true, false, googleHome = true),
            SetupWords.homeNote(true, false, false, asking = true), SetupWords.homeNote(false, false, false, declined = true),
            SetupWords.homeNote(true, false, true, watchApk = true))
        all.forEach { assertFalse(it, Regex("[–—]|\\bBeta\\b|coming soon", RegexOption.IGNORE_CASE).containsMatchIn(it)) }
    }
}
