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
        assertTrue(src.contains("HomeAsk.buttonLabel(HomeAsk.isOn(App.homeEnabled(this), held, opensUs, google), asking)"))
        val press = src.substringAfter("homeBtn = button(\"\")").substringBefore("main1.addView(homeBtn)")
        assertTrue(press.contains("val on = !homeIsOn()"))
    }

    @Test fun googleTvWithTheWatchApkShowsTheButton() {
        // Fable review of 0.13.5: the watch only acts while Use as home screen is on, and the button was
        // hidden on Google TV while off, so the watch APK steps were a dead end
        assertTrue(HomeAsk.showButton(googleTv = true, watchApk = true, aliasOn = false))
        assertFalse(HomeAsk.showButton(googleTv = true, watchApk = false, aliasOn = false))
        assertTrue(HomeAsk.showButton(googleTv = true, watchApk = false, aliasOn = true))
        assertTrue(HomeAsk.showButton(googleTv = false, watchApk = false, aliasOn = false))
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        assertTrue(src.contains("HomeAsk.showButton(google, watchApk, App.homeEnabled(this))"))
        // and nothing reopens the setup screen once it is gone
        val destroy = src.substringAfter("override fun onDestroy()").substringBefore("override fun ")
        assertTrue(destroy.contains("main.removeCallbacks(bringBack)") && destroy.contains("main.removeCallbacks(ask)"))
    }

    @Test fun theSetupScreenUsesTheAnswer() {
        // SetupActivity is Android code, so read it: the result turns the alias off when couch-tv is not the
        // home, and the request is posted (waits), never sent straight from the button
        val src = File("src/main/java/dev/couchtv/ontv/SetupActivity.kt").readText()
        val result = src.substringAfter("override fun onActivityResult").substringBefore("override fun ")
        assertTrue(result.contains("HomeAsk.keepAliasOn(HomeRole.held(this))"))
        assertTrue(result.contains("App.setHomeEnabled(this, false)"))
        val press = src.substringAfter("homeBtn = button(\"\")").substringBefore("main1.addView(homeBtn)")
        assertFalse("the button never asks Android straight away", press.contains("HomeRole.request("))
        assertTrue(press.contains("main.post(ask)"))
        assertTrue(src.contains("HomeAsk.buttonLabel("))
    }
}
