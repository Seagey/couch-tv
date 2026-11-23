package dev.couchtv.ontv

/**
 * When Couch TV may knock on the TV's own ADB, and how long it waits for "Allow USB debugging?". Pure, so it is tested
 * without a TV (AdbPolicyTest).
 *
 * Launch audit, 24 Nov 2026: after Update to, the restarted app's background check opened a connection, waited 8 s and
 * dropped it, then tried the TV's network address too, so the TV showed its box for a connection already gone. Allow
 * then did nothing ("authorization received for deleted transport") and the next background check raised the box again.
 * Now a background check waits long enough for someone to answer, tries no second address after a box went
 * unanswered, and after one unanswered box leaves plain 5555 alone until someone presses Connect.
 */
object AdbPolicy {
    /** A background check's wait for Allow: long enough to see the box, tick Always allow and reach Allow. */
    const val BACKGROUND_ALLOW_SECONDS = 60L

    /** Store flag: a background check raised the box and nobody answered. Cleared by Connect or any connection. */
    const val BG_UNANSWERED = "adb_bg_unanswered"

    fun allowSeconds(interactive: Boolean, sdk: Int, okTcp: Boolean): Long =
        if (!interactive) BACKGROUND_ALLOW_SECONDS
        // Some Android 13+ Google TVs never show the box for a new key on 5555: do not make people wait 2 minutes there
        else if (sdk >= 33 && !okTcp) 45L else 120L

    /**
     * Plain 5555 may be tried: always when someone pressed Connect; in the background only once it was allowed before
     * (so a background retry never pops the box over a show), and never again after a background box went unanswered.
     */
    fun mayTryTcp(interactive: Boolean, okTcp: Boolean, bgUnanswered: Boolean): Boolean = interactive || (okTcp && !bgUnanswered)

    /** The wait ran (nearly) its whole length: the box stood there and nobody answered it. */
    fun ranOut(elapsedMs: Long, allowSeconds: Long): Boolean = elapsedMs >= allowSeconds * 1000 - 2000
}
