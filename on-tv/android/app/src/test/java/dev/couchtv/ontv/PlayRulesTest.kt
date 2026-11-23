package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Google Play build's rules (PlayRules.kt): no GitHub downloads, and the disclosure before Accessibility. */
class PlayRulesTest {
    @Test fun onlyThePlayFlavourIsPlay() {
        assertTrue(PlayRules.play("play"))
        assertFalse(PlayRules.play("github"))
        assertFalse(PlayRules.play(""))
    }

    @Test fun playHasNoGitHubDownloadPath() {
        assertFalse(PlayRules.gitHubDownloads("play"))
        assertTrue(PlayRules.gitHubDownloads("github"))
    }

    @Test fun theWatchIsInTheGitHubWatchBuildAndInPlay() {
        assertTrue(PlayRules.hasWatch("github", "watch"))
        assertFalse(PlayRules.hasWatch("github", "release"))
        assertFalse(PlayRules.hasWatch("github", "debug"))
        assertTrue(PlayRules.hasWatch("play", "release"))
        assertTrue(PlayRules.hasWatch("play", "debug"))
    }

    @Test fun playChangesNoTvRulesAndTakesNoPictures() {
        assertFalse(PlayRules.switchesWatchOnItself("play"))
        assertFalse(PlayRules.changesTvRules("play"))
        assertFalse(PlayRules.screenshots("play"))
        assertFalse(PlayRules.opensBrowser("play"))
        assertFalse(PlayRules.askAi("play"))
        assertFalse(PlayRules.tvListings("play"))
        // the GitHub builds keep all of it
        assertTrue(PlayRules.switchesWatchOnItself("github"))
        assertTrue(PlayRules.changesTvRules("github"))
        assertTrue(PlayRules.screenshots("github"))
        assertTrue(PlayRules.opensBrowser("github"))
        assertTrue(PlayRules.askAi("github"))
        assertTrue(PlayRules.tvListings("github"))
    }

    @Test fun theDisclosureComesBeforeAccessibility() {
        // not agreed: always the disclosure, whatever else is true
        assertEquals("disclose", PlayRules.press(agreed = false, watchOn = false, homeOn = false))
        assertEquals("disclose", PlayRules.press(agreed = false, watchOn = false, homeOn = true))
        assertEquals("disclose", PlayRules.press(agreed = false, watchOn = true, homeOn = false))
        // agreed: Android's Accessibility settings
        assertEquals("settings", PlayRules.press(agreed = true, watchOn = false, homeOn = false))
        assertEquals("settings", PlayRules.press(agreed = true, watchOn = false, homeOn = true))
        // already done: nothing
        assertEquals("done", PlayRules.press(agreed = true, watchOn = true, homeOn = true))
    }

    @Test fun theWatchWaitsForAgreeInPlayOnly() {
        assertFalse(PlayRules.watchMayAct("play", agreed = false))
        assertTrue(PlayRules.watchMayAct("play", agreed = true))
        assertTrue(PlayRules.watchMayAct("github", agreed = false))
        assertFalse(PlayRules.mayRebind("play", agreed = false))
        assertTrue(PlayRules.mayRebind("play", agreed = true))
        assertTrue(PlayRules.mayRebind("github", agreed = false))
    }

    @Test fun playViewIsNeverTheComputerSteps() {
        assertEquals("ready", PlayRules.view(watchOn = false, homeOn = false))
        assertEquals("ready", PlayRules.view(watchOn = true, homeOn = false))
        assertEquals("done", PlayRules.view(watchOn = true, homeOn = true))
    }

    @Test fun playVersionCodeIsAboveEveryGitHubBuild() {
        assertEquals(1_002_300, PlayRules.versionCode(23))
        assertEquals(1_002_301, PlayRules.versionCode(23, 1))
        assertEquals(1_002_200, PlayRules.versionCode(22))
        // above any GitHub code below a million, and it keeps rising with GitHub
        assertTrue(PlayRules.versionCode(0) > 999_999)
        assertTrue(PlayRules.versionCode(24) > PlayRules.versionCode(23, 99))
        // Play's ceiling
        assertTrue(PlayRules.versionCode(20_989_999, 99) <= 2_100_000_000)
    }

    @Test fun theDisclosureSaysWhatItReadsAndWhy() {
        val l = PlayRules.DISCLOSE_LINE
        assertTrue(l.contains("It only learns which app's screen just opened"))
        assertTrue(l.contains("does not read what is on the screen"))
        assertTrue(l.contains("accessibility service"))
        assertTrue(l.contains("brings your Couch TV home back"))
        assertTrue(l.contains("It stays off unless you agree"))
        assertTrue(l.contains("switch it off at any time"))
        assertEquals("Agree and open Settings", PlayRules.AGREE)
        assertEquals("Not now", PlayRules.NOT_NOW)
    }

    @Test fun playWordsNameNoGitHubOrApkAndHaveNoDashes() {
        listOf(PlayRules.DISCLOSE_TITLE, PlayRules.DISCLOSE_LINE, PlayRules.READY, PlayRules.READY_PHONE, PlayRules.UPDATES,
            PlayRules.LINK_ON_PHONE, PlayRules.ASK_OFF).forEach {
            assertFalse(it, it.contains("GitHub", ignoreCase = true))
            assertFalse(it, it.contains("apk", ignoreCase = true))
            assertFalse(it, it.contains("download", ignoreCase = true))
            assertFalse(it, it.contains('—') || it.contains('–') || it.contains("-"))
        }
    }
}
