package dev.couchtv.ontv

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The mic/search/Assistant keys go to the TV's own assistant, never to the home page. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class VoiceKeysTest {
    @Test fun searchAssistAndVoiceAssistAreLeftToAndroid() {
        assertTrue(VoiceKeys.forSystem(KeyEvent.KEYCODE_SEARCH))         // 84: Android hands it to the app first
        assertTrue(VoiceKeys.forSystem(KeyEvent.KEYCODE_ASSIST))         // 219
        assertTrue(VoiceKeys.forSystem(KeyEvent.KEYCODE_VOICE_ASSIST))   // 231
    }

    @Test fun theHomesOwnKeysStayWithTheHome() {
        // OK, Back, Menu, the arrows, Settings and the media keys are the page's
        for (k in listOf(4, 19, 20, 21, 22, 23, 66, 82, 85, 176)) assertFalse("key $k", VoiceKeys.forSystem(k))
    }

    @Test fun theAssistantIsAskedFirstWithTheRemotesDevice() {
        val list = VoiceKeys.intents(7)
        assertEquals(Intent.ACTION_ASSIST, list[0].action)
        assertEquals(7, list[0].getIntExtra(Intent.EXTRA_ASSIST_INPUT_DEVICE_ID, -1))
        assertEquals("android.speech.action.WEB_SEARCH", list[1].action)
        assertTrue(list.all { it.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0 })
    }

    @Test fun searchOpensTheAssistantOnReleaseAndThePageNeverSeesIt() {
        val a = Robolectric.buildActivity(Activity::class.java).setup().get()
        val down = KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SEARCH, 0)
        val up = KeyEvent(0, 0, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SEARCH, 0)
        assertEquals(false, VoiceKeys.handle(a, down))   // the press: Android tracks it, nothing opens yet
        assertNull(shadowOf(a).nextStartedActivity)
        assertEquals(true, VoiceKeys.handle(a, up))      // the release: the assistant
        assertEquals(Intent.ACTION_ASSIST, shadowOf(a).nextStartedActivity.action)
    }

    @Test fun assistKeysAndOtherKeys() {
        val a = Robolectric.buildActivity(Activity::class.java).setup().get()
        // ASSIST and VOICE_ASSIST: Android opens the assistant itself; the home only stays out of the way
        assertEquals(false, VoiceKeys.handle(a, KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ASSIST)))
        assertEquals(false, VoiceKeys.handle(a, KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_VOICE_ASSIST)))
        assertNull(shadowOf(a).nextStartedActivity)
        assertNull(VoiceKeys.handle(a, KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER)))   // the page's
    }
}
