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

    // ---------------------------------------------------------------------------------------------
    // The from scratch TCL test of 0.13.9 (Android TV 11, Google's Android TV Home, low RAM, 23 Nov 2026):
    // installed from Downloader, no computer, debugging off. Use as home screen switched the home alias on,
    // Google's Android TV Home came to the front (the same thing as the black screen of 19 Nov), and the
    // setup screen never came back: bringing it back from behind needs "draw over apps", which this app only
    // gets over its own key link (Adb.kt), so Android 10 and newer silently refused. The person was left on
    // Google's home with no question and no word. And on that TCL a held home role still left Home opening
    // Google's home by name (19 Nov), so the question could not have given a working Home button anyway.

    /** What a press of Use as home screen (to switch it on) does on this TV. */
    enum class Plan {
        /** switch the home on and ask Android's own question */
        ASK,
        /** switch the home on without asking (Google TV; or the watch version where Android has no question) */
        SWITCH_ONLY,
        /** change nothing: stay on the setup screen and say what this TV allows (SetupWords.noAskNote) */
        EXPLAIN,
    }

    /** Remembered for this TV (Store HOME_ASK_BLOCKED): asking sent the person to another home and the setup screen could not come back. */
    const val LEFT = "left"
    /** Remembered for this TV: Android had no question to show (no request at all, or it closed at once with no answer). */
    const val NO_QUESTION = "no_question"
    /** The Store keys: what is remembered, and when the home went on to be asked (so a setup screen Android closed meanwhile is noticed). */
    const val BLOCKED_KEY = "home_ask_blocked"
    const val PENDING_KEY = "home_ask_pending"

    /** Back in front within this long (bringBack at 1.5 s, or Back pressed on a black screen): ask. Later: the person came back by themselves. */
    const val BACK_WINDOW_MS = 12_000L
    /** Android's request answered "no" quicker than anyone could read it: it showed nothing. */
    const val NO_UI_MS = 1_500L

    /**
     * googleHome: a Google home is installed (Google TV's, or Google's Android TV Home). canComeBack: this app
     * may bring its setup screen back from behind ("draw over apps", granted over its own key link), so a
     * home that comes to the front while asking does not leave the person there. blocked: LEFT, NO_QUESTION or null.
     */
    fun plan(googleTv: Boolean, googleHome: Boolean, watchApk: Boolean, canComeBack: Boolean, blocked: String?): Plan = when {
        googleTv -> Plan.SWITCH_ONLY
        // the watch brings Couch TV back while the home is on, whatever Android asks or not
        blocked == NO_QUESTION -> if (watchApk) Plan.SWITCH_ONLY else Plan.EXPLAIN
        watchApk -> Plan.ASK
        // Google's Android TV Home comes to the front when the home goes on (TCL, 19 and 23 Nov 2026), and so did
        // any home that did it once before: only ask where the setup screen can come back with the question
        (googleHome || blocked == LEFT) && !canComeBack -> Plan.EXPLAIN
        else -> Plan.ASK
    }

    /** The setup screen is in front again after being covered while waiting to ask: ask now, or give up (too long: the person found their own way back). */
    fun askAfterAway(msAway: Long): Boolean = msAway in 0..BACK_WINDOW_MS

    /** What Android's answer to the request means. */
    enum class Answer { HOME, DECLINED, NO_QUESTION }

    fun answer(heldNow: Boolean, msSinceAsked: Long): Answer = when {
        heldNow -> Answer.HOME
        msSinceAsked in 0 until NO_UI_MS -> Answer.NO_QUESTION
        else -> Answer.DECLINED
    }

    /** Why the note explains instead (for SetupWords.noAskNote): null when Use as home screen can ask or switch on here. */
    fun noAskReason(plan: Plan, googleHome: Boolean, blocked: String?): String? = when {
        plan != Plan.EXPLAIN -> null
        blocked == NO_QUESTION -> NO_QUESTION
        googleHome -> "google"
        else -> LEFT
    }
}
