package dev.couchtv.ontv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.widget.FrameLayout

/**
 * The Play build's prominent disclosure for the Home button watch (PlayRules.kt): what it reads, why, Agree
 * and Not now, in the setup screen's own look. It always comes before Android's Accessibility settings: the
 * app sends nobody there, and the watch does nothing, until Agree.
 *
 * Declared in the Play build's manifest only (src/play/AndroidManifest.xml). The GitHub builds never open it:
 * openAccessibility() goes straight to Android's settings there, as before.
 */
class DisclosureActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val frame = FrameLayout(this).apply { setBackgroundColor(SetupLook.WALL) }
        setContentView(frame)
        val (root, primary) = screen(SetupLook(this), { agree() }, { notNow() })
        frame.addView(root)
        primary.requestFocus()
    }

    private fun agree() {
        Store.putBool(PlayRules.AGREED_KEY, true)
        Log.i(TAG, "home watch disclosure: agreed")
        // the watch only acts while Use as home screen is on (FireHome.onOtherHome)
        if (!App.homeEnabled(this)) runCatching { App.setHomeEnabled(this, true) }
        // already switched on in Android's settings: it starts now; else Android's settings, for the person to switch it on
        if (WatchService.waiting) WatchService.agreedNow() else if (!WatchService.connected) settings(this)
        finish()
    }

    private fun notNow() {
        Log.i(TAG, "home watch disclosure: not now")
        // switched on in Android's settings without Agree: it switches itself off again, having read nothing
        if (WatchService.waiting) WatchService.switchOff()
        finish()
    }

    @Deprecated("Back on a TV remote")
    override fun onBackPressed() { notNow() }

    companion object {
        private const val TAG = "couchtv.play"

        /**
         * The screen: a wider card than a setup step, so the title, the three short paragraphs and both buttons fit a
         * 720p or 1080p TV with no scrolling. Returns the whole screen and the Agree button (focused first).
         */
        fun screen(look: SetupLook, onAgree: () -> Unit, onNotNow: () -> Unit): Pair<android.view.View, android.view.View> {
            val card = look.card(width = 820, padH = 48, padV = 34)
            card.addView(look.heading(PlayRules.DISCLOSE_TITLE, 34f))
            PlayRules.DISCLOSE_PARTS.forEach {
                card.addView(look.line(it, 16f), android.widget.LinearLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = look.px(12) })
            }
            val agree = look.pill(PlayRules.AGREE, SetupLook.Kind.INK, on = onAgree)
            card.addView(look.actions(agree, look.pill(PlayRules.NOT_NOW, SetupLook.Kind.GHOST, on = onNotNow)))
            return look.screen(card) to agree
        }

        /** The disclosure screen, from anywhere (a phone press reaches the TV through the app's service). */
        fun show(c: Context) {
            runCatching { c.startActivity(Intent(c, DisclosureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { Log.w(TAG, "disclosure: ${it.message}") }
        }

        private fun settings(c: Context) {
            runCatching { c.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { Log.w(TAG, "accessibility settings: ${it.message}") }
        }

        /**
         * Settings' Accessibility button and Make Home open Couch TV in the Play build: the disclosure first
         * unless the person already agreed. Every other build: Android's Accessibility settings, as before.
         */
        fun openAccessibility(c: Context) {
            if (!Variant.play) { settings(c); return }
            when (PlayRules.press(Variant.agreed(), WatchService.connected, App.homeEnabled(c))) {
                "disclose" -> show(c)
                "settings" -> {
                    if (!App.homeEnabled(c)) runCatching { App.setHomeEnabled(c, true) }
                    if (!WatchService.connected) settings(c)
                }
                else -> {}
            }
        }
    }
}
