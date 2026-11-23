package app.couchtv.launcher

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The mic/search/Assistant keys go to the TV's own assistant, never to the home page. */
class VoiceKeysTest {
    @Test fun searchAssistAndVoiceAssistAreLeftToAndroid() {
        assertTrue(VoiceKeys.forSystem(84))    // KEYCODE_SEARCH: the one Android hands to the app first
        assertTrue(VoiceKeys.forSystem(219))   // KEYCODE_ASSIST
        assertTrue(VoiceKeys.forSystem(231))   // KEYCODE_VOICE_ASSIST
    }

    @Test fun theHomesOwnKeysStayWithTheHome() {
        // OK, Back, Menu, the arrows, Settings (gear) and the media keys are the page's
        for (k in listOf(4, 19, 20, 21, 22, 23, 66, 82, 85, 176)) assertFalse("key $k", VoiceKeys.forSystem(k))
    }

    @Test fun theAssistantOpensOnceOnTheReleaseOfSearch() {
        assertTrue(VoiceKeys.opensOnRelease(84, 1, 0, false))    // ACTION_UP
        assertFalse(VoiceKeys.opensOnRelease(84, 0, 0, false))   // the press itself: Android tracks it
        assertFalse(VoiceKeys.opensOnRelease(84, 1, 0, true))    // a cancelled press
        assertFalse(VoiceKeys.opensOnRelease(84, 1, 3, false))   // a held key's repeats
        assertFalse(VoiceKeys.opensOnRelease(219, 1, 0, false))  // Android opens these by itself
        assertFalse(VoiceKeys.opensOnRelease(231, 1, 0, false))
    }
}
