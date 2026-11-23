package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Use as home screen (HomeAsk.kt), from the real TCL beginner test of 0.13.3 (19 Nov 2026): the first
 * press gave a black screen and no question, and after Cancel the button said "Stop being the home screen".
 */
class HomeAskTest {
    @Test fun waitsForAndroidToTakeInTheNewHomeBeforeAsking() {
        // the black screen: the request went out the instant the alias was switched on
        assertFalse(HomeAsk.readyToAsk(aliasListed = false, msSinceOn = 0, inFront = true))
        assertFalse(HomeAsk.readyToAsk(aliasListed = true, msSinceOn = 100, inFront = true))
        assertTrue(HomeAsk.readyToAsk(aliasListed = true, msSinceOn = HomeAsk.SETTLE_MS, inFront = true))
        // a TV that never lists it in time is asked anyway, a little later
        assertFalse(HomeAsk.readyToAsk(aliasListed = false, msSinceOn = HomeAsk.MAX_WAIT_MS - 1, inFront = true))
        assertTrue(HomeAsk.readyToAsk(aliasListed = false, msSinceOn = HomeAsk.MAX_WAIT_MS, inFront = true))
    }

    @Test fun onlyAsksWhileTheSetupScreenIsInFront() {
        // Google's empty screen on top: the question would be lost behind it, so it waits for this screen
        assertFalse(HomeAsk.readyToAsk(aliasListed = true, msSinceOn = 10_000, inFront = false))
    }

    @Test fun theAnswerDecidesNotThePress() {
        assertFalse("Cancel: the alias goes off again", HomeAsk.keepAliasOn(heldNow = false))
        assertTrue("Set as default: it stays on", HomeAsk.keepAliasOn(heldNow = true))
        assertEquals("Use as home screen", HomeAsk.buttonLabel(aliasOn = false, asking = false))
        assertEquals("Stop being the home screen", HomeAsk.buttonLabel(aliasOn = true, asking = false))
        assertEquals("Asking the TV...", HomeAsk.buttonLabel(aliasOn = true, asking = true))
    }

    @Test fun theButtonFollowsWhatAndroidSays() {
        // 0.13.3 on a TCL: the switch was on, Google's home was the default, and the button said Stop
        assertFalse(HomeAsk.isOn(aliasOn = true, held = false, opensUs = false, googleTv = false))
        assertEquals("Use as home screen", HomeAsk.buttonLabel(HomeAsk.isOn(true, false, false, false), asking = false))
        assertTrue(HomeAsk.isOn(aliasOn = true, held = true, opensUs = false, googleTv = false))
        assertTrue(HomeAsk.isOn(aliasOn = true, held = false, opensUs = true, googleTv = false))
        assertFalse(HomeAsk.isOn(aliasOn = false, held = true, opensUs = true, googleTv = false))
        // Google TV: the switch is the truth (the watch only acts while it is on)
        assertTrue(HomeAsk.isOn(aliasOn = true, held = false, opensUs = false, googleTv = true))
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        // step 1 moves on only when Android reports Couch TV is the home (HomeAsk.isOn), never from a saved switch
        assertTrue(src.contains("private fun homeIsOn(): Boolean = HomeAsk.isOn(App.homeEnabled(this), HomeRole.held(this), homeOpensUs(), HomeRole.googleTv(this))"))
        assertTrue(src.contains("if (SetupSteps.stepOneDone(homeIsOn()))"))
    }

    @Test fun googleTvWithTheWatchApkShowsTheButton() {
        // Fable review of 0.13.5: the watch only acts while Use as home screen is on, and the button was
        // hidden on Google TV while off, so the watch APK steps were a dead end
        assertTrue(HomeAsk.showButton(googleTv = true, watchApk = true, aliasOn = false))
        assertFalse(HomeAsk.showButton(googleTv = true, watchApk = false, aliasOn = false))
        assertTrue(HomeAsk.showButton(googleTv = true, watchApk = false, aliasOn = true))
        assertTrue(HomeAsk.showButton(googleTv = false, watchApk = false, aliasOn = false))
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        // what step 1 offers depends on Google TV and the watch version (SetupSteps.homeStep, SetupStepsTest)
        assertTrue(src.contains("SetupSteps.homeStep(plan(), HomeRole.googleTv(this), BuildConfig.BUILD_TYPE == \"watch\""))
        // and nothing reopens the setup screen once it is gone
        val destroy = src.substringAfter("override fun onDestroy()").substringBefore("override fun ")
        assertTrue(destroy.contains("main.removeCallbacks(bringBack)") && destroy.contains("main.removeCallbacks(ask)"))
    }

    // The from scratch TCL test of 0.13.9 (Android TV 11, Google's Android TV Home, 23 Nov 2026): no key link, so no
    // "draw over apps"; Use as home screen put Google's home in front and the setup screen never came back.
    @Test fun theTclFromScratchStaysOnTheSetupScreen() {
        val p = HomeAsk.plan(googleTv = false, googleHome = true, watchApk = false, canComeBack = false, blocked = null)
        assertEquals(HomeAsk.Plan.EXPLAIN, p)
        assertEquals("google", HomeAsk.noAskReason(p, googleHome = true, blocked = null))
        // once Couch TV can press keys on the TV it may bring this screen back, so Android's question is used
        assertEquals(HomeAsk.Plan.ASK, HomeAsk.plan(false, true, watchApk = false, canComeBack = true, blocked = null))
        // the watch version brings Couch TV back by itself while the home is on
        assertEquals(HomeAsk.Plan.ASK, HomeAsk.plan(false, true, watchApk = true, canComeBack = false, blocked = null))
    }

    @Test fun plainAndroidTvStillGetsAndroidsQuestion() {
        // a maker's own home (no Google home): Android's own question, as the docs promise
        val p = HomeAsk.plan(googleTv = false, googleHome = false, watchApk = false, canComeBack = false, blocked = null)
        assertEquals(HomeAsk.Plan.ASK, p)
        assertEquals(null, HomeAsk.noAskReason(p, googleHome = false, blocked = null))
        // Google TV is unchanged: switch on, no question
        assertEquals(HomeAsk.Plan.SWITCH_ONLY, HomeAsk.plan(true, true, watchApk = false, canComeBack = false, blocked = null))
        assertEquals(HomeAsk.Plan.SWITCH_ONLY, HomeAsk.plan(true, true, watchApk = true, canComeBack = true, blocked = HomeAsk.NO_QUESTION))
    }

    @Test fun aTvThatFailedOnceIsNotAskedTheSameWayAgain() {
        // sent away to the TV's home once: explain, until Couch TV can bring this screen back
        assertEquals(HomeAsk.Plan.EXPLAIN, HomeAsk.plan(false, false, false, canComeBack = false, blocked = HomeAsk.LEFT))
        assertEquals(HomeAsk.LEFT, HomeAsk.noAskReason(HomeAsk.Plan.EXPLAIN, googleHome = false, blocked = HomeAsk.LEFT))
        assertEquals(HomeAsk.Plan.ASK, HomeAsk.plan(false, false, false, canComeBack = true, blocked = HomeAsk.LEFT))
        // no question at all: draw over apps does not help, the watch version just switches on
        assertEquals(HomeAsk.Plan.EXPLAIN, HomeAsk.plan(false, false, false, canComeBack = true, blocked = HomeAsk.NO_QUESTION))
        assertEquals(HomeAsk.Plan.SWITCH_ONLY, HomeAsk.plan(false, true, watchApk = true, canComeBack = false, blocked = HomeAsk.NO_QUESTION))
        assertEquals(HomeAsk.NO_QUESTION, HomeAsk.noAskReason(HomeAsk.Plan.EXPLAIN, googleHome = true, blocked = HomeAsk.NO_QUESTION))
    }

    @Test fun backSoonAsksBackMuchLaterGivesUp() {
        assertTrue("never away", HomeAsk.askAfterAway(0))
        assertTrue("brought back after 1.5 s", HomeAsk.askAfterAway(1_600))
        assertTrue(HomeAsk.askAfterAway(HomeAsk.BACK_WINDOW_MS))
        assertFalse("found their own way back from Google's home", HomeAsk.askAfterAway(HomeAsk.BACK_WINDOW_MS + 1))
        assertFalse(HomeAsk.askAfterAway(-5))
    }

    @Test fun anInstantNoMeansThereWasNoQuestion() {
        assertEquals(HomeAsk.Answer.HOME, HomeAsk.answer(heldNow = true, msSinceAsked = 50))
        assertEquals(HomeAsk.Answer.NO_QUESTION, HomeAsk.answer(heldNow = false, msSinceAsked = 200))
        assertEquals(HomeAsk.Answer.DECLINED, HomeAsk.answer(heldNow = false, msSinceAsked = HomeAsk.NO_UI_MS))
        assertEquals(HomeAsk.Answer.DECLINED, HomeAsk.answer(heldNow = false, msSinceAsked = 8_000))
    }

    @Test fun theSetupScreenNeverLeavesThePersonOnAnotherHome() {
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        // step 1's big button switches the home on through turnHomeOn
        val press = src.substringAfter("private fun turnHomeOn()").substringBefore("override fun onResume()")
        assertTrue(src.contains("HomeStep.ASK, SetupSteps.HomeStep.SWITCH -> turnHomeOn()"))
        // Settings has no Use as home screen switch any more: Undo Couch TV switches the home off
        assertTrue(src.substringAfter("private fun undoCouchTv()").substringBefore("private fun watchOutOfList()").contains("App.setHomeEnabled(this, false)"))
        // EXPLAIN returns before the home alias is switched on
        assertTrue(press.indexOf("plan == HomeAsk.Plan.EXPLAIN") in 0 until press.indexOf("App.setHomeEnabled(this, true)"))
        assertTrue(press.contains("Store.putStr(HomeAsk.PENDING_KEY"))
        val resume = src.substringAfter("override fun onResume()").substringBefore("override fun ")
        assertTrue(resume.contains("HomeAsk.askAfterAway(away)") && resume.contains("giveUp(HomeAsk.LEFT)"))
        assertTrue(resume.contains("Store.str(HomeAsk.PENDING_KEY) != null"))
        val result = src.substringAfter("override fun onActivityResult").substringBefore("override fun ")
        assertTrue(result.contains("HomeAsk.Answer.NO_QUESTION -> giveUp(HomeAsk.NO_QUESTION)"))
        assertTrue(src.contains("HomeRole.Asked.NONE -> giveUp(HomeAsk.NO_QUESTION)"))
        assertTrue(src.contains("SetupSteps.explainReason(plan(), HomeRole.googleHome(this), Store.str(HomeAsk.BLOCKED_KEY))"))
        // the Home intent in a chooser opened Google's home at once and never set a default: gone
        val role = File("src/main/java/dev/couchtv/ontv/HomeRole.kt").readText()
        assertFalse(role.contains("createChooser("))
    }

    @Test fun theSetupScreenUsesTheAnswer() {
        // SetupActivity is Android code, so read it: the result turns the alias off when couch-tv is not the
        // home, and the request is posted (waits), never sent straight from the button
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        val result = src.substringAfter("override fun onActivityResult").substringBefore("override fun ")
        assertTrue(result.contains("val held = HomeRole.held(this)") && result.contains("HomeAsk.keepAliasOn(held)"))
        assertTrue(result.contains("App.setHomeEnabled(this, false)"))
        val press = src.substringAfter("private fun turnHomeOn()").substringBefore("override fun onResume()")
        assertFalse("the button never asks Android straight away", press.contains("HomeRole.request("))
        assertTrue(press.contains("main.post(ask)"))
    }
}
