package dev.couchtv.ontv

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.ContextThemeWrapper
import android.view.View
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Draws the approved setup screens on a computer, at a 1080p TV (960 x 540 dp at xhdpi) and a 720p TV
 * (960 x 540 dp at tvdpi), with the remote's focus on the big button, and saves PNGs for the owner to check.
 * Only with -PsetupShots=<folder> (a normal test run skips it). Software drawing: the cards' soft shadow
 * shows on a TV but not here.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class)
class SetupShotsTest {
    private val out = System.getProperty("setupShots").orEmpty()

    private fun shoot(name: String, w: Int, h: Int, build: (SetupScreens) -> SetupScreens.Step) {
        val c = ContextThemeWrapper(RuntimeEnvironment.getApplication(), android.R.style.Theme_DeviceDefault_NoActionBar)
        val s = build(SetupScreens(SetupLook(c)))
        // the remote's focus on the big button, as the TV shows it once the grow has finished
        s.primary.onFocusChangeListener.onFocusChange(s.primary, true)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        s.primary.scaleX = 1.06f; s.primary.scaleY = 1.06f
        val v: View = s.root
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        // nothing may run off a TV screen: every button inside it
        var x = 0; var y = 0; var p: View? = s.primary
        while (p != null && p !== v) { x += p.left; y += p.top; p = p.parent as? View }
        assertTrue("$name: the big button is on screen ($x, $y)", x >= 0 && y >= 0 && x + s.primary.width <= w && y + s.primary.height <= h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
        File(out).mkdirs()
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun all(suffix: String, w: Int, h: Int) {
        val qr = SetupScreens.qrBitmap(HomeKeyRules.HELP_URL)
        shoot("step1$suffix", w, h) { it.step(1, SetupWords.HOME_TITLE, SetupWords.homeStepLine(SetupSteps.HomeStep.ASK),
            SetupWords.homeStepButton(SetupSteps.HomeStep.ASK), {}, second = SetupWords.SKIP, settings = {}) }
        shoot("step1-tcl$suffix", w, h) { it.step(1, SetupWords.HOME_TITLE, SetupWords.homeStepLine(SetupSteps.HomeStep.EXPLAIN, reason = "google"),
            SetupWords.homeStepButton(SetupSteps.HomeStep.EXPLAIN), {}, second = SetupWords.MORE_HELP, secondKind = SetupLook.Kind.LINK, settings = {}) }
        shoot("step2$suffix", w, h) { it.step(2, SetupWords.OPEN_TITLE, SetupWords.OPEN_LINE, SetupWords.OPEN_BUTTON, {},
            chip = SetupWords.HOME_DONE, settings = {}) }
        shoot("ready$suffix", w, h) { it.step(0, SetupWords.READY_TITLE, SetupWords.readyLine(true), SetupWords.OPEN_BUTTON, {},
            second = SetupWords.SETTINGS, note = SetupWords.READY_NOTE_START to SetupWords.SETTINGS) }
        shoot("help$suffix", w, h) { it.help("google", qr, {}, {}) }
    }

    @Test @Config(qualifiers = "w960dp-h540dp-land-xhdpi")
    fun tv1080() { assumeTrue(out.isNotEmpty()); all("-1080", 1920, 1080) }

    @Test @Config(qualifiers = "w960dp-h540dp-land-tvdpi")
    fun tv720() { assumeTrue(out.isNotEmpty()); all("-720", 1280, 720) }
}
