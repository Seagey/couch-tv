package dev.couchtv.ontv

/**
 * The wait for the TV's own "Allow USB debugging?" box after Connect (the key walk-through's last step).
 *
 * Seen on a TCL (Android TV 11, 23 Nov 2026): an earlier 120 s wait had run out while the box was up, the TV went
 * to its screensaver, and the old box (UsbDebuggingActivity) stayed open but hidden behind Couch TV's setup screen.
 * adbd then logged "prompt currently pending, skipping" for every new try, so no new box came and Connect seemed
 * to do nothing. A real box takes the window focus from the setup screen as soon as it shows, so a wait where the
 * setup screen keeps its focus for several seconds means the box is hidden (or the TV never asked).
 *
 * Then: one plain line on the key step (SetupWords.ALLOW_HIDDEN), and the app steps aside once (its task to the
 * back), so a box left behind it can show. Nothing in the box is ever pressed by the app. Back on the key step
 * does the same while the line is up. Once the link is up, the setup screen comes back to the front.
 */
object AllowWait {
    /** A box that is there takes the focus within a second or two; this leaves room for a slow TV. */
    const val HIDDEN_AFTER_MS = 8_000L

    data class Hint(val sayHidden: Boolean, val stepAside: Boolean)
    private val NONE = Hint(false, false)

    /**
     * waitingMs: how long since Connect was pressed. waiting: Adb is still waiting for Allow (or connecting).
     * focused: the setup screen has the window focus now. lostFocus: it lost the focus at some point in this wait
     * (the box came up over it: the person is reading it, so say nothing). inFront: the setup screen is resumed.
     * steppedAside: the app already moved itself back once in this wait.
     */
    fun hint(waitingMs: Long, waiting: Boolean, focused: Boolean, lostFocus: Boolean, inFront: Boolean, steppedAside: Boolean): Hint = when {
        !waiting -> NONE
        lostFocus -> NONE
        waitingMs < HIDDEN_AFTER_MS -> NONE
        // stepped aside and back again (the person pressed Back or opened Couch TV): the line stays, no second step aside
        steppedAside -> Hint(sayHidden = true, stepAside = false)
        !inFront || !focused -> NONE
        else -> Hint(sayHidden = true, stepAside = true)
    }

    /** Back on the key step while the hidden line is up and the wait goes on: step aside (the line says Back shows it). */
    fun backStepsAside(hiddenShown: Boolean, waiting: Boolean): Boolean = hiddenShown && waiting

    /** The link came up while the app was stepped aside: bring the setup screen back, so the person sees it worked. */
    fun comeBack(steppedAside: Boolean, connected: Boolean, inFront: Boolean): Boolean = steppedAside && connected && !inFront

    /** Keep the screen on (no screensaver) while a wait for Allow runs: the TCL's screensaver hid the box last time. */
    fun keepScreenOn(waiting: Boolean): Boolean = waiting
}
