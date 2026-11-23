package dev.couchtv.ontv

import dev.couchtv.ontv.SetupSteps.HomeStep
import dev.couchtv.ontv.SetupSteps.Screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupStepsTest {
    @Test fun aNewTvStartsAtStepOne() {
        assertEquals(Screen.HOME_STEP, SetupSteps.firstScreen(done = false, phones = 0, homeOn = false))
    }

    @Test fun aTvSetUpBeforeGoesStraightToReady() {
        assertEquals(Screen.READY, SetupSteps.firstScreen(done = true, phones = 0, homeOn = false))
        // an update from 0.13.9: a paired phone or Couch TV already the home means it was set up
        assertEquals(Screen.READY, SetupSteps.firstScreen(done = false, phones = 1, homeOn = false))
        assertEquals(Screen.READY, SetupSteps.firstScreen(done = false, phones = 0, homeOn = true))
    }

    @Test fun plainAndroidTvAsks() {
        assertEquals(HomeStep.ASK, SetupSteps.homeStep(HomeAsk.Plan.ASK, googleTv = false, watchApk = false, keyView = "hidden", asking = false))
        assertEquals(HomeStep.ASKING, SetupSteps.homeStep(HomeAsk.Plan.ASK, googleTv = false, watchApk = false, keyView = "hidden", asking = true))
    }

    @Test fun theTclExplainsInsteadOfAsking() {
        // TCL, Android TV 11, Google's Android TV Home, from Downloader (23 Nov 2026): HomeAsk.plan says EXPLAIN
        val plan = HomeAsk.plan(googleTv = false, googleHome = true, watchApk = false, canComeBack = false, blocked = null)
        assertEquals(HomeAsk.Plan.EXPLAIN, plan)
        assertEquals(HomeStep.EXPLAIN, SetupSteps.homeStep(plan, googleTv = false, watchApk = false, keyView = "steps", asking = false))
        assertEquals("google", SetupSteps.explainReason(plan, googleHome = true, blocked = null))
    }

    @Test fun onePressWhenTheKeyLinkIsThere() {
        assertEquals(HomeStep.KEY, SetupSteps.homeStep(HomeAsk.Plan.EXPLAIN, googleTv = false, watchApk = false, keyView = "ready", asking = false))
        assertEquals(HomeStep.BUSY, SetupSteps.homeStep(HomeAsk.Plan.EXPLAIN, googleTv = false, watchApk = false, keyView = "busy", asking = false))
        // Google TV with the phone download: the switch alone changes nothing, so it is the key press or the explanation
        assertEquals(HomeStep.KEY, SetupSteps.homeStep(HomeAsk.Plan.SWITCH_ONLY, googleTv = true, watchApk = false, keyView = "ready", asking = false))
        assertEquals(HomeStep.EXPLAIN, SetupSteps.homeStep(HomeAsk.Plan.SWITCH_ONLY, googleTv = true, watchApk = false, keyView = "steps", asking = false))
        assertEquals("google", SetupSteps.explainReason(HomeAsk.Plan.SWITCH_ONLY, googleHome = true, blocked = null))
    }

    @Test fun googleTvWithTheWatchSwitches() {
        assertEquals(HomeStep.SWITCH, SetupSteps.homeStep(HomeAsk.Plan.SWITCH_ONLY, googleTv = true, watchApk = true, keyView = "ready", asking = false))
    }

    @Test fun aTvThatLeftOrHadNoQuestionExplainsWhy() {
        val left = HomeAsk.plan(false, false, false, false, HomeAsk.LEFT)
        assertEquals(HomeStep.EXPLAIN, SetupSteps.homeStep(left, false, false, "hidden", false))
        assertEquals(HomeAsk.LEFT, SetupSteps.explainReason(left, googleHome = false, blocked = HomeAsk.LEFT))
        val none = HomeAsk.plan(false, false, false, true, HomeAsk.NO_QUESTION)
        assertEquals(HomeAsk.NO_QUESTION, SetupSteps.explainReason(none, googleHome = false, blocked = HomeAsk.NO_QUESTION))
    }

    @Test fun backFromPhoneRemoteOpenedFromTheHomeGoesBackToTheHome() {
        // Couch TV from the apps row, Open the home, gear, Phone remote: the setup screen is the task root and the
        // home was cleared above it, so Back opens the home again (not a bare finish onto Google's home)
        assertEquals(SetupSteps.SettingsBack.REOPEN_HOME, SetupSteps.settingsBack(fromHome = true, taskRoot = true))
        // Couch TV is the Home app: the home is under the setup screen, so finishing goes back to it
        assertEquals(SetupSteps.SettingsBack.FINISH, SetupSteps.settingsBack(fromHome = true, taskRoot = false))
        // Settings opened from the setup screen itself: Back goes to the setup screen, whatever the task
        assertEquals(SetupSteps.SettingsBack.BACK_TO, SetupSteps.settingsBack(fromHome = false, taskRoot = true))
        assertEquals(SetupSteps.SettingsBack.BACK_TO, SetupSteps.settingsBack(fromHome = false, taskRoot = false))
    }

    @Test fun stepOneIsDoneOnlyWhenCouchTvIsTheHome() {
        assertTrue(SetupSteps.stepOneDone(true))
        assertFalse(SetupSteps.stepOneDone(false))
    }
}
