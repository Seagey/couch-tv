package app.couchtv.launcher

import app.couchtv.launcher.ReleaseChannel.Release
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which release a TV may update to: a beta never reaches a stable TV, and beta TVs move on. */
class ReleaseChannelTest {
    private fun rel(tag: String, pre: Boolean = false, draft: Boolean = false, asset: Boolean = true) = Release(tag, pre, draft, asset)

    @Test fun versionsCompareAsPeopleReadThem() {
        assertTrue(ReleaseChannel.newer("v0.4", "0.3"))
        assertTrue(ReleaseChannel.newer("0.10", "0.9"))
        assertFalse(ReleaseChannel.newer("0.12", "0.12"))
        assertFalse(ReleaseChannel.newer("0.12", "0.13"))
    }

    @Test fun aBetaComesBeforeItsOwnRelease() {
        assertTrue(ReleaseChannel.newer("0.13", "0.13-beta.1"))
        assertFalse(ReleaseChannel.newer("0.13-beta.1", "0.13"))
        assertTrue(ReleaseChannel.newer("0.13-beta.1", "0.12"))
        assertTrue(ReleaseChannel.newer("0.13-beta.2", "0.13-beta.1"))
        assertTrue(ReleaseChannel.newer("0.13-beta.10", "0.13-beta.9"))
        assertTrue(ReleaseChannel.newer("0.13-rc.1", "0.13-beta.3"))
        assertTrue(ReleaseChannel.newer("0.14", "0.13-beta.1"))
    }

    @Test fun threePartVersionsMeetTwoPartOnes() {
        // the 0.13.0 release (tag v0.13.0) reaches 0.12 TVs and the 0.13-beta.1 TVs, and is not newer than itself
        assertTrue(ReleaseChannel.newer("v0.13.0", "0.12"))
        assertTrue(ReleaseChannel.newer("v0.13.0", "0.13-beta.1"))
        assertFalse(ReleaseChannel.newer("v0.13.0", "0.13.0"))
        assertFalse(ReleaseChannel.newer("v0.13.0", "0.13"))
        // 0.13.1 (tag v0.13.1) reaches 0.13.0, 0.13 and 0.12 TVs, and is not newer than itself
        assertTrue(ReleaseChannel.newer("v0.13.1", "0.13.0"))
        assertTrue(ReleaseChannel.newer("v0.13.1", "0.13"))
        assertTrue(ReleaseChannel.newer("v0.13.1", "0.12"))
        assertFalse(ReleaseChannel.newer("v0.13.1", "0.13.1"))
        // 0.13.2 (tag v0.13.2) reaches 0.13.1, 0.13.0, 0.13 and 0.12 TVs, and is not newer than itself
        assertTrue(ReleaseChannel.newer("v0.13.2", "0.13.1"))
        assertTrue(ReleaseChannel.newer("v0.13.2", "0.13.0"))
        assertTrue(ReleaseChannel.newer("v0.13.2", "0.13"))
        assertTrue(ReleaseChannel.newer("v0.13.2", "0.12"))
        assertFalse(ReleaseChannel.newer("v0.13.2", "0.13.2"))
        assertFalse(ReleaseChannel.newer("v0.13.1", "0.13.2"))
        // 0.13.3 reaches 0.13.2 and older TVs, and is not newer than itself
        assertTrue(ReleaseChannel.newer("v0.13.3", "0.13.2"))
        assertTrue(ReleaseChannel.newer("v0.13.3", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.3", "0.13.3"))
        assertFalse(ReleaseChannel.newer("v0.13.2", "0.13.3"))
        // 0.13.4 (Samsung) reaches 0.13.3 and older TVs, and is not newer than itself
        assertTrue(ReleaseChannel.newer("v0.13.4", "0.13.3"))
        assertTrue(ReleaseChannel.newer("v0.13.4", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.4", "0.13.4"))
        assertFalse(ReleaseChannel.newer("v0.13.3", "0.13.4"))
        // 0.13.5 (the TCL beginner fixes) reaches 0.13.4 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.5", "0.13.4"))
        assertTrue(ReleaseChannel.newer("v0.13.5", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.5", "0.13.5"))
        assertFalse(ReleaseChannel.newer("v0.13.4", "0.13.5"))
        // 0.13.6 (Update couch-tv on the TV, the gear clear of widgets) reaches 0.13.5 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.6", "0.13.5"))
        assertTrue(ReleaseChannel.newer("v0.13.6", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.6", "0.13.6"))
        assertFalse(ReleaseChannel.newer("v0.13.5", "0.13.6"))
        // 0.13.7 (Hold OK on a TCL, the gear by arrow, Samsung About) reaches 0.13.6 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.7", "0.13.6"))
        assertTrue(ReleaseChannel.newer("v0.13.7", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.7", "0.13.7"))
        assertFalse(ReleaseChannel.newer("v0.13.6", "0.13.7"))
        // 0.13.8 (Home settings pages open at the top, Up reaches the lines above) reaches 0.13.7 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.8", "0.13.7"))
        assertTrue(ReleaseChannel.newer("v0.13.8", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.8", "0.13.8"))
        assertFalse(ReleaseChannel.newer("v0.13.7", "0.13.8"))
        // 0.13.9 (Update now on the on-TV app, Home settings from a phone, Send a design) reaches 0.13.8 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.9", "0.13.8"))
        assertTrue(ReleaseChannel.newer("v0.13.9", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.9", "0.13.9"))
        // 0.13.10 (setup in two steps, the first-run welcome, widgets set up on the phone): two digits after the
        // last dot still count as a number, so it reaches 0.13.9 and older TVs, and is never older than 0.13.9
        assertTrue(ReleaseChannel.newer("v0.13.10", "0.13.9"))
        assertTrue(ReleaseChannel.newer("v0.13.10", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.10", "0.13.10"))
        assertFalse(ReleaseChannel.newer("v0.13.9", "0.13.10"))
        // 0.13.11 (Add apps in one sheet, Jost and Cormorant on the TV, the on-TV app's own key) reaches 0.13.10
        // and older TVs, and is never older than 0.13.10
        assertTrue(ReleaseChannel.newer("v0.13.11", "0.13.10"))
        assertTrue(ReleaseChannel.newer("v0.13.11", "0.13.9"))
        assertTrue(ReleaseChannel.newer("v0.13.11", "0.13"))
        assertFalse(ReleaseChannel.newer("v0.13.11", "0.13.11"))
        // 0.13.12 (the TV reports its version and memory with a design fetch, Spotify tidy-ups) reaches 0.13.11 and
        // older TVs, and is never older than 0.13.11
        assertTrue(ReleaseChannel.newer("v0.13.12", "0.13.11"))
        assertTrue(ReleaseChannel.newer("v0.13.12", "0.13.10"))
        assertFalse(ReleaseChannel.newer("v0.13.12", "0.13.12"))
        assertFalse(ReleaseChannel.newer("v0.13.11", "0.13.12"))
        // 0.13.13 (Your home from the account, Setup's account link and inbox, Glass text) reaches 0.13.12 and older TVs
        assertTrue(ReleaseChannel.newer("v0.13.13", "0.13.12"))
        assertTrue(ReleaseChannel.newer("v0.13.13", "0.13.11"))
        assertFalse(ReleaseChannel.newer("v0.13.13", "0.13.13"))
        assertFalse(ReleaseChannel.newer("v0.13.12", "0.13.13"))
        // 0.13.14 (Couch TV Helper, apps on your TV in Studio) reaches 0.13.13 and 0.13.12 TVs
        assertTrue(ReleaseChannel.newer("v0.13.14", "0.13.13"))
        assertTrue(ReleaseChannel.newer("v0.13.14", "0.13.12"))
        assertFalse(ReleaseChannel.newer("v0.13.14", "0.13.14"))
        assertFalse(ReleaseChannel.newer("v0.13.13", "0.13.14"))
        // 0.13.15 (redesigned Setup, account linking, Tidy up, Make it yours) reaches 0.13.14 and 0.13.13 TVs
        assertTrue(ReleaseChannel.newer("v0.13.15", "0.13.14"))
        assertTrue(ReleaseChannel.newer("v0.13.15", "0.13.13"))
        assertFalse(ReleaseChannel.newer("v0.13.15", "0.13.15"))
        assertFalse(ReleaseChannel.newer("v0.13.14", "0.13.15"))
        assertFalse(ReleaseChannel.newer("v0.13.10", "0.13.11"))
        assertFalse(ReleaseChannel.newer("v0.13.8", "0.13.9"))
    }

    @Test fun theOldRulesStillHoldForEveryReleaseSoFar() {
        val tags = listOf("0.3", "0.4", "0.5", "0.8", "0.9", "0.10", "0.11", "0.12")
        for (i in 1 until tags.size) assertTrue(tags[i], ReleaseChannel.newer(tags[i], tags[i - 1]))
    }

    @Test fun aStableTvNeverTakesABeta() {
        assertTrue(ReleaseChannel.stableOk(rel("v0.13")))
        assertFalse(ReleaseChannel.stableOk(rel("v0.13-beta.1", pre = true)))
        assertFalse("published without the pre-release tick", ReleaseChannel.stableOk(rel("v0.13-beta.1")))
        assertFalse(ReleaseChannel.stableOk(rel("v0.13", pre = true)))
        assertFalse(ReleaseChannel.stableOk(rel("v0.13", draft = true)))
        assertFalse(ReleaseChannel.stableOk(rel("v0.13-rc1")))
        assertTrue("build metadata is not a pre-release", ReleaseChannel.stableOk(rel("v0.13+tv")))
    }

    @Test fun aBetaTvTakesTheNewestOfEither() {
        val list = listOf(rel("v0.12"), rel("v0.13-beta.1", pre = true), rel("v0.13-beta.2", pre = true, draft = true), rel("v0.11"))
        assertEquals("v0.13-beta.1", ReleaseChannel.pickBeta(list)!!.tag)
        val later = list + rel("v0.13")
        assertEquals("the real release wins over its beta", "v0.13", ReleaseChannel.pickBeta(later)!!.tag)
        assertEquals("a release without the app is skipped", "v0.12", ReleaseChannel.pickBeta(listOf(rel("v0.12"), rel("v0.14", asset = false)))!!.tag)
        assertNull(ReleaseChannel.pickBeta(emptyList()))
    }
}
