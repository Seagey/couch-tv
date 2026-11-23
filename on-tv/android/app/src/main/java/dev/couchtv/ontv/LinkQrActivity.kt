package dev.couchtv.ontv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.FrameLayout

/**
 * The Play build's web link card (PlayRules.opensBrowser): Android TV's quality rules say a TV app must not
 * open a web browser (TV-WB), so a custom card with a url shows this QR code for the phone instead, in the
 * setup screen's look. OK or Back goes back to the home. Declared in src/play/AndroidManifest.xml only.
 */
class LinkQrActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val url = intent?.getStringExtra(URL).orEmpty()
        val look = SetupLook(this)
        val screens = SetupScreens(look)
        val frame = FrameLayout(this).apply { setBackgroundColor(SetupLook.WALL) }
        setContentView(frame)
        val side = SetupScreens.qrBitmap(url)?.let { screens.qrBox(it, 200) }
        val step = screens.step(0, PlayRules.LINK_ON_PHONE, url, "OK", { finish() }, side = side)
        frame.addView(step.root)
        step.primary.requestFocus()
    }

    companion object {
        private const val URL = "url"
        /** HomeActivity's openUrl in the Play build: true when the QR screen opened. */
        fun show(c: Context, url: String): Boolean = runCatching {
            c.startActivity(Intent(c, LinkQrActivity::class.java).putExtra(URL, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.isSuccess
    }
}
