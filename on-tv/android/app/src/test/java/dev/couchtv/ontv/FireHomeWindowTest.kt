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
}
