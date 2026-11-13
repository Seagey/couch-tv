package app.couchtv.launcher

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The re-check after a quick second Home press (#175). Times are in ms; 0 means never. */
class FireWatchTest {
    private fun again(stockInFront: Boolean, stockAt: Long, ownAt: Long, otherAt: Long) =
        FireWatch.shouldRecheckBringBack(stockInFront, stockAt, ownAt, otherAt)

    @Test fun homeStillTheLatestWindowBringsCouchTvBack() {
        assertTrue(again(true, 1000, 0, 0))
    }

    // The Chromecast log: the Google home came forward, then Jellyfin (closing) sent its window event.
    @Test fun closingAppAfterTheHomeStillBringsCouchTvBack() {
        assertTrue(again(false, 46_670, 0, 47_890))
    }

    @Test fun closingAppBeforeTheHomeBringsCouchTvBack() {
        assertTrue(again(false, 46_670, 0, 46_100))
    }

    @Test fun couchTvCameBackAfterTheHomeLeavesItAlone() {
        assertFalse(again(false, 46_670, 47_000, 47_100))
    }

    // An app the user really opened from the home takes longer than the closing app does.
    @Test fun anotherAppOpenedLongAfterTheHomeIsLeftAlone() {
        assertFalse(again(false, 46_670, 0, 50_000))
    }

    @Test fun neverSawTheHomeLeavesItAlone() {
        assertFalse(again(false, 0, 0, 5_000))
    }
}
