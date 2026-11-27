package app.couchtv.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Now playing with no computer (lane D, 28 Nov 2026): which app's song the home shows when Spotify has none. */
class NowPlayingPickTest {
    private fun s(pkg: String, state: Int) = SpotifyPlayer.Session(pkg, state)
    private val playing = 3   // PlaybackState.STATE_PLAYING
    private val paused = 2    // PlaybackState.STATE_PAUSED
    private val stopped = 1

    @Test fun playingBeatsPaused() {
        assertEquals("com.google.android.youtube.tvmusic",
            SpotifyPlayer.pick(listOf(s("au.com.abc.listen", paused), s("com.google.android.youtube.tvmusic", playing))))
    }

    @Test fun pausedWhenNothingPlays() {
        assertEquals("au.com.abc.listen", SpotifyPlayer.pick(listOf(s("x.stopped", stopped), s("au.com.abc.listen", paused))))
    }

    @Test fun neverCouchTvsOwnAndNothingWhenStopped() {
        assertNull(SpotifyPlayer.pick(listOf(s("app.couchtv.launcher", playing), s("dev.couchtv.ontv", playing), s("x.stopped", stopped))))
        assertNull(SpotifyPlayer.pick(emptyList()))
    }
}
