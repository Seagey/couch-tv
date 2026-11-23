package dev.couchtv.ontv

import org.junit.Assert.*
import org.junit.Test

class FireHomeWindowTest {
    private val amazon = "com.amazon.tv.launcher"

    @Test fun actualHomeStillReturnsToCouchTv() {
        assertTrue(FireHomeWindow.isHome(amazon, "$amazon.ui.HomeActivity_vNext"))
        assertTrue(FireHomeWindow.isHome(amazon, "$amazon.ui.HomeActivity"))
        assertTrue(FireHomeWindow.isHome(amazon, "$amazon.FutureHome", setOf("$amazon.FutureHome")))
    }

    @Test fun searchSettingsAndWindowWidgetsStayOpen() {
        for (cls in listOf("$amazon.ui.SearchActivity", "$amazon.deeplink.activity.SearchResultsDeepLinkActivityDI",
            "$amazon.deeplink.activity.TextSearchDeepLinkActivityDI",
            "$amazon.ui.MainSettingsActivity", "android.widget.FrameLayout", null)) {
            assertFalse(FireHomeWindow.isHome(amazon, cls))
        }
        assertFalse(FireHomeWindow.isHome("com.amazon.venezia", "$amazon.ui.HomeActivity_vNext"))
        assertFalse(FireHomeWindow.isHome(null, null))
    }

    private val me = "dev.couchtv.ontv/dev.couchtv.ontv.WatchService"
    private val other = "com.example.reader/.Reader"

    @Test fun thePlainApkNeverWritesTheWatchItDoesNotHave() {
        // Fable review of 0.13.3: the plain build wrote its absent service into the settings
        assertNull(FireHomeWindow.watchServices("", me, declared = false))
        assertNull(FireHomeWindow.watchServices(null, me, declared = false))
        assertNull(FireHomeWindow.watchServices(other, me, declared = false))
        // and takes out the stale entry an earlier plain build left, keeping everyone else's
        assertEquals(other, FireHomeWindow.watchServices("$other:$me", me, declared = false))
        assertEquals("", FireHomeWindow.watchServices(me, me, declared = false))
    }

    @Test fun theWatchApkAddsItselfOnce() {
        assertEquals(me, FireHomeWindow.watchServices("", me, declared = true))
        assertEquals("$other:$me", FireHomeWindow.watchServices(other, me, declared = true))
        assertNull(FireHomeWindow.watchServices("$other:$me", me, declared = true))
    }
}
