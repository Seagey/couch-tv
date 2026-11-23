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
 * Draws the approved setup screens and Settings on a computer, at a 1080p TV (960 x 540 dp at xhdpi) and a
 * 720p TV (960 x 540 dp at tvdpi), with the remote's focus where the TV puts it, and saves PNGs for the
 * owner to check. Only with -PsetupShots=<folder> (a normal test run skips it). Software drawing: the
 * cards' soft shadow shows on a TV but not here.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class)
class SetupShotsTest {
    private val out = System.getProperty("setupShots").orEmpty()
    private fun ctx() = ContextThemeWrapper(RuntimeEnvironment.getApplication(), android.R.style.Theme_DeviceDefault_NoActionBar)

    /** Lays the screen out at the TV's size, focuses one view as the remote would, checks it is on screen, saves it. */
    private fun save(name: String, w: Int, h: Int, root: View, focus: View) {
        focus.onFocusChangeListener?.onFocusChange(focus, true)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, w, h)
        // the grow the TV animates, finished
        focus.scaleX = if (focus is android.widget.LinearLayout) 1.03f else 1.06f; focus.scaleY = focus.scaleX
        var x = 0; var y = 0; var p: View? = focus
        while (p != null && p !== root) { x += p.left; y += p.top; p = p.parent as? View }
        assertTrue("$name: the focused button is on screen ($x, $y)", x >= 0 && y >= 0 && x + focus.width <= w && y + focus.height <= h)
        // never squashed: a pill keeps its full height (a card too full for the screen would squeeze it)
        if (focus is android.widget.TextView) assertTrue("$name: the focused button keeps its height", focus.height >= focus.minHeight)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        File(out).mkdirs()
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun shoot(name: String, w: Int, h: Int, build: (SetupScreens) -> SetupScreens.Step) {
        val s = build(SetupScreens(SetupLook(ctx())))
        save(name, w, h, s.root, s.primary)
    }

    private val none = object : SettingsScreen.Actions {
        override fun newCode() {}; override fun forgetPhones() {}; override fun keys() {}; override fun undo() {}; override fun accessibility() {}
    }
    /** Settings with pretend data: this TV at 192.0.2.24, one phone paired, a live code. */
    private fun settings(name: String, w: Int, h: Int, item: SetupSettings.Item, strip: SetupSettings.Strip = SetupSettings.Strip.STEPS,
                         focus: (SettingsScreen) -> View) {
        val s = SettingsScreen(SetupLook(ctx()), none)
        val url = "http://192.0.2.24:5400"; val pin = "482913"
        s.editQr.setImageBitmap(SetupScreens.qrBitmap(SetupWords.qrLink(url, pin, "/setup")!!))
        s.editType.text = SetupWords.editType("$url/setup", pin)
        s.phoneQr.setImageBitmap(SetupScreens.qrBitmap(SetupWords.qrLink(url, pin)!!))
        s.phoneCode.text = SetupWords.phoneCode(pin, 0)
        s.phoneType.text = SetupWords.phoneType(url)
        s.setPhones(1)
        s.setStrip(strip)
        s.helpQr.setImageBitmap(SettingsScreen.helpQr())
        s.select(item)
        save(name, w, h, s.root, focus(s))
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

        // Settings: each item with its row focused, and the phone remote's three kinds of TV
        settings("settings-edit$suffix", w, h, SetupSettings.Item.EDIT) { it.row(SetupSettings.Item.EDIT) }
        settings("settings-phone$suffix", w, h, SetupSettings.Item.PHONE) { it.stripButton }
        settings("settings-phone-ready$suffix", w, h, SetupSettings.Item.PHONE, SetupSettings.Strip.NONE) { it.newCode }
        settings("settings-phone-fire$suffix", w, h, SetupSettings.Item.PHONE, SetupSettings.Strip.FIRE) { it.row(SetupSettings.Item.PHONE) }
        settings("settings-undo$suffix", w, h, SetupSettings.Item.UNDO) { it.undoButton }
        settings("settings-help$suffix", w, h, SetupSettings.Item.HELP) { it.row(SetupSettings.Item.HELP) }

        // the key walk-through: an Android TV 11 (USB debugging), and a Google TV on Android 13 or newer (pairing with a code)
        listOf("tv" to SetupSettings.keySteps(SetupSettings.Menus.ANDROID_TV, false), "gtv13" to SetupSettings.keySteps(SetupSettings.Menus.GOOGLE_TV, true))
            .forEach { (kind, steps) ->
                steps.forEachIndexed { i, k ->
                    shoot("keys-$kind-${i + 1}$suffix", w, h) { sc ->
                        val side = if (k.phoneQr) sc.qrBox(SetupScreens.qrBitmap("http://192.0.2.24:5400/setup#pin=482913")!!, 104) else null
                        sc.step(i + 1, k.title, k.line, k.button, {}, of = steps.size, label = SetupWords.keysOf(i + 1, steps.size),
                            second = k.second, side = side)
                    }
                }
            }
        shoot("keys-done$suffix", w, h) { it.step(0, SetupWords.KEYS_DONE_TITLE, "", HomeKeyRules.BUTTON, {},
            chip = SetupWords.DONE, after = SetupWords.KEYS_DONE_HOME, second = SetupWords.NOT_NOW) }
        shoot("keys-done-plain$suffix", w, h) { it.step(0, SetupWords.KEYS_DONE_TITLE, SetupWords.KEYS_DONE_LINE, SetupWords.DONE, {}, chip = SetupWords.DONE) }
        shoot("undo-confirm$suffix", w, h) { it.step(0, SetupWords.UNDO_CONFIRM_TITLE, SetupWords.UNDO_CONFIRM_LINE, SetupWords.UNDO_KEEP, {},
            primaryKind = SetupLook.Kind.GHOST, second = SetupWords.UNDO_ITEM, secondKind = SetupLook.Kind.INK) }
        shoot("undo-done$suffix", w, h) { it.step(0, SetupWords.UNDO_DONE_TITLE, SetupWords.UNDO_DONE_LINE, SetupWords.NOT_NOW, {},
            primaryKind = SetupLook.Kind.GHOST, second = SetupWords.UNDO_REMOVE, secondKind = SetupLook.Kind.INK) }
    }

    @Test @Config(qualifiers = "w960dp-h540dp-land-xhdpi")
    fun tv1080() { assumeTrue(out.isNotEmpty()); all("-1080", 1920, 1080) }

    @Test @Config(qualifiers = "w960dp-h540dp-land-tvdpi")
    fun tv720() { assumeTrue(out.isNotEmpty()); all("-720", 1280, 720) }
}
