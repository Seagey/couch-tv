package dev.couchtv.ontv

/**
 * What "Use as home screen" on the setup screen does, as plain decisions so HomeAskTest checks them on
 * a computer. From the real TCL beginner test (Android TV 11, Google's Android TV Home, 19 Nov 2026):
 *  1. The first press showed a black screen and no chooser. The home alias had only just been switched
 *     on, and Android was still taking in the new home (Google's home put an empty screen on top) when
 *     the request went out. Now the request waits until Android lists the alias as a home, plus a
 *     moment, and only goes out while the setup screen is in front; if something came on top, it goes
 *     out when the setup screen is back.
 *  2. After Cancel on Android's chooser the button still said "Stop being the home screen". Now the
 *     answer decides: not the home, so the alias goes off again and the button says Use as home screen.
 */
object HomeAsk {
    /** After switching the alias on: wait at least this long before asking. */
    const val SETTLE_MS = 800L
    /** Ask anyway after this long, even if Android never listed the alias (some TVs answer slowly). */
    const val MAX_WAIT_MS = 4_000L

    /** Whether to send Android's request now. */
    fun readyToAsk(aliasListed: Boolean, msSinceOn: Long, inFront: Boolean): Boolean =
        inFront && ((aliasListed && msSinceOn >= SETTLE_MS) || msSinceOn >= MAX_WAIT_MS)

    /** After Android answered (or the person came back from its Home screen): keep the alias on only if couch-tv is now the home. */
    fun keepAliasOn(heldNow: Boolean): Boolean = heldNow

    /**
     * Whether the setup screen shows the button. On Google TV with the phone only download the Home button
     * stays Google's, so the button would only confuse unless it is on (so it can be switched off). With the
     * watch APK it is always shown: the Home button watch only brings couch-tv back while it is on.
     */
    fun showButton(googleTv: Boolean, watchApk: Boolean, aliasOn: Boolean): Boolean = !googleTv || watchApk || aliasOn

    /**
     * Whether couch-tv counts as the home now, from what Android reports, not the saved switch alone: the
     * alias on and Android holding it as the home (the role) or the Home intent resolving to it. On Google
     * TV the switch is the truth (the watch brings couch-tv back only while it is on). 0.13.3 showed "Stop
     * being the home screen" while Google's home was the default (TCL beginner test, 19 Nov 2026).
     */
    fun isOn(aliasOn: Boolean, held: Boolean, opensUs: Boolean, googleTv: Boolean): Boolean = aliasOn && (googleTv || held || opensUs)

    /** The button's words: what pressing it does now (aliasOn: isOn above). */
    fun buttonLabel(aliasOn: Boolean, asking: Boolean): String = when {
        asking -> "Asking the TV..."
        aliasOn -> "Stop being the home screen"
        else -> "Use as home screen"
    }
}
