package dev.couchtv.ontv

import dev.couchtv.ontv.SetupSettings.Action
import dev.couchtv.ontv.SetupSettings.Menus
import dev.couchtv.ontv.SetupSettings.Strip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Settings on the TV (owner approved round 2, 23 Nov 2026): the key strip, the walk-through, Undo and the words. */
class SetupSettingsTest {
    @Test fun theKeyStepShowsOnlyWhereItIsNeeded() {
        assertEquals(Strip.NONE, SetupSettings.keyStrip(connected = true, fireBlocked = false))
        assertEquals(Strip.STEPS, SetupSettings.keyStrip(connected = false, fireBlocked = false))
        // current Fire OS refuses the app's own link: say so, no button that can never work
        assertEquals(Strip.FIRE, SetupSettings.keyStrip(connected = false, fireBlocked = true))
        assertEquals(Strip.NONE, SetupSettings.keyStrip(connected = true, fireBlocked = true))
    }

    @Test fun theMenusAreTheTvsOwn() {
        assertEquals(Menus.FIRE_TV, SetupSettings.menus(googleTv = false, fireTv = true))
        assertEquals(Menus.GOOGLE_TV, SetupSettings.menus(googleTv = true, fireTv = false))
        assertEquals(Menus.ANDROID_TV, SetupSettings.menus(googleTv = false, fireTv = false))
        assertTrue(SetupSettings.keySteps(Menus.GOOGLE_TV, false)[0].line.contains("Settings, then System, then About. Press OK on Android TV OS build seven times."))
        // the TCL (Android TV 11, 23 Nov 2026): About's last row is Android TV OS Build, not Build
        assertTrue(SetupSettings.keySteps(Menus.ANDROID_TV, false)[0].line.contains("Settings, then Device Preferences, then About. At the bottom, press OK on Android TV OS build seven times."))
        assertTrue(SetupSettings.keySteps(Menus.FIRE_TV, false)[0].line.contains("My Fire TV"))
        // the menu path keeps the menu's own name, but no line is labelled with the TV's type (owner's rule)
        for (m in Menus.values()) for (p in listOf(false, true)) SetupSettings.keySteps(m, p).forEach {
            assertFalse(it.line, Regex("\\b(On|on) (the|this|your) (Fire TV|Google TV|Android TV)\\b|your Fire TV").containsMatchIn(it.line))
        }
        for (m in Menus.values()) assertTrue(SetupSettings.keySteps(m, false)[0].line.startsWith("On the TV, open Settings, then "))
        assertFalse(SetupWords.KEYS_STRIP_FIRE.contains("Fire TV"))
        assertTrue(SetupSettings.keySteps(Menus.FIRE_TV, false)[1].title.contains("ADB debugging"))
    }

    @Test fun androidThirteenPairsWithACode() {
        assertTrue(SetupSettings.needsPairing(33, "off", fireTv = false))
        assertTrue(SetupSettings.needsPairing(30, "needs_pairing", fireTv = false))
        assertFalse(SetupSettings.needsPairing(30, "failed", fireTv = false))
        assertFalse(SetupSettings.needsPairing(34, "off", fireTv = true))   // Fire OS has no Wireless debugging
        val steps = SetupSettings.keySteps(Menus.GOOGLE_TV, pairing = true)
        assertEquals("Switch on Wireless debugging", steps[1].title)
        assertEquals("Pair with a code", steps[2].title)
        assertTrue(steps[2].phoneQr)
        assertTrue(steps[2].line.contains("Pair device with pairing code"))
        assertEquals("Switch on USB debugging", SetupSettings.keySteps(Menus.ANDROID_TV, false)[1].title)
    }

    @Test fun theWalkThroughIsThreeScreensEndingInConnect() {
        for (m in Menus.values()) for (p in listOf(false, true)) {
            val s = SetupSettings.keySteps(m, p)
            assertEquals(3, s.size)
            assertEquals(Action.OPEN_ABOUT, s[0].action); assertEquals(Action.NEXT, s[0].secondAction)
            assertEquals(Action.OPEN_DEVELOPER, s[1].action); assertEquals(Action.NEXT, s[1].secondAction)
            assertEquals(Action.CONNECT, s[2].action); assertEquals(Action.BACK, s[2].secondAction)
            s.forEach { k ->
                assertTrue("short: ${k.line}", k.line.split(' ').size <= 30)
                assertFalse(k.line, Regex("[–—]|\\s-\\s|\\bBeta\\b|coming soon", RegexOption.IGNORE_CASE).containsMatchIn(k.line + k.title))
            }
        }
    }

    @Test fun theWalkThroughSkipsWhatIsAlreadyOn() {
        assertEquals(0, SetupSettings.firstKeyStep(developerOn = false, debuggingOn = false))
        assertEquals(1, SetupSettings.firstKeyStep(developerOn = true, debuggingOn = false))
        assertEquals(2, SetupSettings.firstKeyStep(developerOn = true, debuggingOn = true))   // the owner's TCL: straight to Connect
    }

    @Test fun makeHomeOpenCouchTvIsOfferedWhereItHelps() {
        assertTrue(SetupSettings.offerHomeKey("ready", needed = true))
        assertFalse(SetupSettings.offerHomeKey("ready", needed = false))   // plain Android TV: Home already works
        assertFalse(SetupSettings.offerHomeKey("steps", needed = true))
        assertFalse(SetupSettings.offerHomeKey("done", needed = true))
    }

    @Test fun undoSwitchesOffOnlyAWatchThatExists() {
        assertEquals("none", SetupSettings.undoWatch(watchApk = false, watchRunning = false, canWriteSecure = true))
        assertEquals("self", SetupSettings.undoWatch(watchApk = true, watchRunning = true, canWriteSecure = false))
        assertEquals("settings", SetupSettings.undoWatch(watchApk = true, watchRunning = false, canWriteSecure = true))
        assertEquals("none", SetupSettings.undoWatch(watchApk = true, watchRunning = false, canWriteSecure = false))
        assertTrue(SetupSettings.showWatchLine(watchApk = true, watching = false))
        assertFalse(SetupSettings.showWatchLine(watchApk = false, watching = false))
    }

    @Test fun theSettingsWordsAreTheApprovedOnes() {
        assertEquals("Edit your home", SetupWords.EDIT_ITEM)
        assertEquals("Change widgets, your town, calendar and photos on your phone.", SetupWords.EDIT_LINE)
        assertEquals("Use your phone as a TV remote?", SetupWords.PHONE_TITLE)
        assertEquals("For the arrow keys and typing, this TV needs one more step.", SetupWords.KEYS_STRIP)
        assertEquals("Put this TV back to normal", SetupWords.UNDO_TITLE)
        assertEquals("Keep Couch TV", SetupWords.UNDO_KEEP)
        assertEquals("https://couchtv.joshuaseage.com/help/", SetupWords.HELP_URL)
        assertEquals("1 phone paired", SetupWords.phoneSub(1)); assertEquals("No phone yet", SetupWords.phoneSub(0))
        assertEquals("482 913", SetupWords.phoneCode("482913", 0))
        assertEquals("Locked for 2 min", SetupWords.phoneCode(null, 90))
        assertEquals("Or type 192.0.2.24:5400", SetupWords.phoneType("http://192.0.2.24:5400"))
        assertEquals("Or type 192.0.2.24:5400/setup on a phone or computer on this WiFi, then the code 482 913.",
            SetupWords.editType("http://192.0.2.24:5400/setup", "482913"))
        assertEquals(SetupWords.NO_NETWORK, SetupWords.editType(null, "482913"))
        // the Studio line is left out until the phone page can open this TV's design in Studio
        val all = listOf(SetupWords.EDIT_LINE, SetupWords.SCAN, SetupWords.editType("http://x:1/setup", null), SetupWords.PHONE_LINE,
            SetupWords.KEYS_STRIP_FIRE, SetupWords.UNDO_LINE, SetupWords.UNDO_NOTE, SetupWords.UNDO_CONFIRM_LINE, SetupWords.UNDO_DONE_LINE,
            SetupWords.HELP_LINE, SetupWords.WATCH_LINE, SetupWords.KEYS_DONE_LINE, SetupWords.KEYS_DONE_HOME)
        all.forEach {
            assertFalse(it, it.contains("Studio"))
            assertFalse(it, Regex("[–—]|\\s-\\s|\\bBeta\\b|Experimental|coming soon", RegexOption.IGNORE_CASE).containsMatchIn(it))
            assertFalse(it, Regex("couch-tv(?![-./])").containsMatchIn(it))
        }
    }
}
