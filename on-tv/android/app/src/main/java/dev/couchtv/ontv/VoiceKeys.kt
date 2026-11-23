package dev.couchtv.ontv

import android.app.Activity
import android.content.Intent
import android.util.Log
import android.view.KeyEvent

/**
 * The remote's mic, search and Assistant buttons belong to the TV's own voice assistant (Google
 * Assistant or Gemini on Google TV and Android TV, Alexa on Fire TV), never to the home page.
 *
 * ASSIST (219) and VOICE_ASSIST (231) are taken by Android before any app sees them, so the TV's
 * assistant opens over Couch TV as over any app. SEARCH (84) is handed to the app in front first,
 * and with Couch TV as home that was the WebView, which swallowed it: nothing happened (a TCL on
 * Android TV 11, 23 Nov 2026). Left unhandled, Android's own fallback did nothing on that TCL
 * either, so on the release of SEARCH the home opens the TV's assistant itself, as Google's home
 * does (ACTION_ASSIST with the remote's device, which katniss answers), and only when no assistant
 * answers is the key left to Android.
 */
object VoiceKeys {
    private val SYSTEM = setOf(KeyEvent.KEYCODE_SEARCH, KeyEvent.KEYCODE_ASSIST, KeyEvent.KEYCODE_VOICE_ASSIST)

    /** True for a key the home must never give its page: it belongs to the TV's voice assistant. */
    fun forSystem(keyCode: Int): Boolean = keyCode in SYSTEM

    /** True when the home itself opens the assistant: the release of a SEARCH press (not a held one). */
    fun opensOnRelease(keyCode: Int, action: Int, repeatCount: Int, canceled: Boolean): Boolean =
        keyCode == KeyEvent.KEYCODE_SEARCH && action == KeyEvent.ACTION_UP && repeatCount == 0 && !canceled

    /** The intents tried in turn: the assistant (Google Assistant/Gemini), then Android's voice search. */
    fun intents(deviceId: Int): List<Intent> = listOf(
        Intent(Intent.ACTION_ASSIST).putExtra(Intent.EXTRA_ASSIST_INPUT_DEVICE_ID, deviceId),
        Intent("android.speech.action.WEB_SEARCH"),
    ).map { it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }

    /** Opens the TV's assistant. False when none answered (Android then gets the key as usual). */
    fun open(a: Activity, deviceId: Int): Boolean {
        for (i in intents(deviceId)) {
            if (runCatching { a.startActivity(i) }.isSuccess) {
                Log.i("couchtv-voice", "search key: opened ${i.action}")
                return true
            }
        }
        Log.i("couchtv-voice", "search key: no assistant answered, left to Android")
        return false
    }

    /**
     * For dispatchKeyEvent, before the page sees the key. Null: not a voice key, the page has it.
     * Otherwise the answer to return: true when the home opened the assistant, false to let Android have it.
     */
    fun handle(a: Activity, e: KeyEvent): Boolean? {
        if (!forSystem(e.keyCode)) return null
        return opensOnRelease(e.keyCode, e.action, e.repeatCount, e.isCanceled) && open(a, e.deviceId)
    }
}
