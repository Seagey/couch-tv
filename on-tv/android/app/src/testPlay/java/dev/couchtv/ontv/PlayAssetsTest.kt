package dev.couchtv.ontv

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Draft Google Play graphics (coord/play-assets/, GOOGLE-PLAY-LISTING.md "Graphics needed"), drawn with the app's own
 * logo, fonts and Studio colours, and the Play build's own screens: the app icon (512), the Android TV banner
 * (1280 x 720), the feature graphic (1024 x 500), and the Home watch disclosure and web link screens at 1920 x 1080.
 * Only with -PplayAssets=<folder>; a normal test run skips it. The banner and feature graphic are made opaque
 * (24 bit) afterwards (GOOGLE-PLAY-BUILD.md has the command).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "w960dp-h540dp-land-xhdpi")
class PlayAssetsTest {
    private val out = System.getProperty("playAssets").orEmpty()
    private fun ctx() = ContextThemeWrapper(RuntimeEnvironment.getApplication(), android.R.style.Theme_DeviceDefault_NoActionBar)

    private fun save(name: String, w: Int, h: Int, root: View) {
        root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        File(out).mkdirs()
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    /** The logo and the name, in the setup screen's look, on the Studio wall. */
    private fun lockup(look: SetupLook, logoDp: Int, nameSp: Float, line: String?): View = LinearLayout(look.c).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
        addView(ImageView(look.c).apply { setImageResource(R.drawable.logo_mark); scaleType = ImageView.ScaleType.FIT_CENTER },
            LinearLayout.LayoutParams(look.px(logoDp * 112 / 92), look.px(logoDp)).apply { bottomMargin = look.px(14) })
        addView(look.heading("Couch TV", nameSp).apply { gravity = Gravity.CENTER })
        if (line != null) addView(look.line(line, nameSp * 0.36f, SetupLook.INK).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(8) })
    }

    private fun wall(look: SetupLook, child: View) = FrameLayout(look.c).apply {
        setBackgroundColor(SetupLook.WALL)
        addView(child, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    }

    @Test fun graphics() {
        assumeTrue(out.isNotEmpty())
        val look = SetupLook(ctx())
        // the app icon: the couch on the red tile (res/drawable/icon.xml), at 512
        save("icon-512", 512, 512, ImageView(look.c).apply { setImageResource(R.drawable.icon); scaleType = ImageView.ScaleType.FIT_XY })
        // the Android TV banner: the name must show (TV-BN). 640 x 360 dp at xhdpi is 1280 x 720
        save("tv-banner-1280x720", 1280, 720, wall(look, lockup(look, 150, 72f, null)))
        // the feature graphic: light wall, mark, name and one line, nothing near the edges
        save("feature-graphic-1024x500", 1024, 500, wall(look, lockup(look, 92, 52f, "Your own home screen for the TV, with a phone remote")))
    }

    @Test fun playScreens() {
        assumeTrue(out.isNotEmpty())
        val look = SetupLook(ctx())
        val (root, agree) = DisclosureActivity.screen(look, {}, {})
        agree.onFocusChangeListener?.onFocusChange(agree, true)
        save("tv-6-home-watch-disclosure-1920x1080", 1920, 1080, root)
        // every button inside the screen (a card too full for a TV would push them off the bottom)
        var y = 0; var p: View? = agree
        while (p != null && p !== root) { y += p.top; p = p.parent as? View }
        org.junit.Assert.assertTrue("Agree on screen at $y", y + agree.height <= 1080)
    }

    /** A 720p TV (tvdpi): the same screen still fits, both buttons on it. Runs in every test run. */
    @Test @Config(qualifiers = "w960dp-h540dp-land-tvdpi")
    fun disclosureFitsA720pTv() {
        val look = SetupLook(ctx())
        val (root, agree) = DisclosureActivity.screen(look, {}, {})
        root.measure(View.MeasureSpec.makeMeasureSpec(1280, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1280, 720)
        var y = 0; var p: View? = agree
        while (p != null && p !== root) { y += p.top; p = p.parent as? View }
        org.junit.Assert.assertTrue("Agree on a 720p screen at $y", y >= 0 && y + agree.height <= 720)
    }
}
