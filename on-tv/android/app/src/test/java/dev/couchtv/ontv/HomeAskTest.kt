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
