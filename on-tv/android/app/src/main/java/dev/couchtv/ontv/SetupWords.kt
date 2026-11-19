package dev.couchtv.ontv

/**
 * The words on the Couch TV setup screen (SetupActivity), as plain functions so SetupWordsTest checks
 * them on a computer. Plain words for someone who has never set up a TV app: no "ADB", no
 * "accessibility", no "debugging" on the first screen. Those live behind More, still in plain words.
 */
object SetupWords {
    /** The big line: the code to type on the phone, or that a phone is paired. */
    fun pairLine(pin: String?, phones: Int, pairedAgoMs: Long?): String = when {
        pin != null -> "Phone code  ${pin.take(3)} ${pin.drop(3)}"
        pairedAgoMs != null && pairedAgoMs in 0..10 * 60_000L -> "Your phone is paired"
        phones > 0 -> if (phones == 1) "1 phone is paired" else "$phones phones are paired"
        else -> "No phone yet: press New phone code"
    }

    /** The line under it: what to do next. */
    fun nextLine(pin: String?, phones: Int, homeOpensUs: Boolean): String = when {
        pin != null -> "On your phone, scan the code on the left (or type the address under it), then type this code."
        phones > 0 && homeOpensUs -> "Next: press Home on the TV remote. Your couch-tv home is there."
        phones > 0 -> "Next: press Open the home. From now on, open your home from Couch TV in the TV's apps row."
        else -> "Press New phone code, then scan the code on the left with your phone's camera."
    }

    /** What the phone remote can do now, without the word ADB. */
    fun keysLine(connected: Boolean, waiting: Boolean, needsPairing: Boolean): String = when {
        connected -> "The phone remote can press every key and type on the TV."
        waiting -> "Look at the TV: if it asks \"Allow debugging?\", tick Always allow and press OK."
        needsPairing -> "The phone remote opens apps and changes the volume. For the arrow keys and typing, see More."
        else -> "The phone remote opens apps and changes the volume. For the arrow keys and typing, see More."
    }

    /** The note about the Home button, for this TV. */
    fun homeNote(useAsHome: Boolean, held: Boolean, googleTv: Boolean): String = when {
        googleTv -> "On Google TV the Home button always opens Google TV. Open your couch-tv home from Couch TV in the apps row."
        !useAsHome -> "Use as home screen asks the TV to make Couch TV its home. No computer needed."
        held -> "Couch TV is your home screen. Press Home on the remote to see it."
        else -> "If the TV showed a list, choose Couch TV and press Always (or Set as default)."
    }
}
