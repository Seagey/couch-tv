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

    /**
     * The note about the Home button, for this TV.
     *  googleTv: the Google TV home is installed. googleHome: a Google home (Google TV's, or Google's
     *  Android TV Home, which a TCL kept opening by name although Couch TV was the home app).
     *  watchApk: this is couch-tv-ontv-watch.apk, which has the Home button watch; the phone only
     *  download (couch-tv-ontv.apk) does not, because Google Play Protect blocks it there.
     *  asking: Android's request is on its way. declined: Android's list was closed without Couch TV.
     */
    fun homeNote(useAsHome: Boolean, held: Boolean, googleTv: Boolean, watchApk: Boolean = false, googleHome: Boolean = googleTv,
                 asking: Boolean = false, declined: Boolean = false, opensUs: Boolean = held): String = when {
        asking -> "Asking the TV to make Couch TV its home. If the screen goes black, press Back once and the question comes up."
        // the watch only acts while Use as home screen is on (FireHome.onOtherHome), so it is always one of the steps
        googleTv && watchApk && !useAsHome -> "On Google TV the Home button opens Google TV first. To bring your couch-tv home straight back on top: " +
            "press Use as home screen, then switch on Couch TV home watch in the TV's Settings, Accessibility."
        googleTv && watchApk -> "On Google TV the Home button always opens Google TV first. With Couch TV home watch switched on in the TV's Settings, Accessibility, your couch-tv home comes straight back on top."
        googleTv -> "On Google TV the Home button always opens Google TV with the phone only download. That is expected. " +
            "To make Home open couch-tv, put the home watch version on from a computer, then press Use as home screen: see More, Home button from a computer. " +
            "Until then, open your couch-tv home from Couch TV in the apps row."
        declined -> "Couch TV is not your home screen: the TV's list was closed without choosing it. Press Use as home screen to ask again."
        !useAsHome -> "Use as home screen asks the TV to make Couch TV its home. No computer needed."
        // 0.13.3 said "Couch TV is your home screen" from a saved switch while Google's home was still the
        // default (TCL beginner test, 19 Nov 2026). Now only what Android reports right now decides the words.
        !held && !opensUs -> "Couch TV is not your home screen yet: the TV's own home still opens on Home. Press Use as home screen to ask the TV again."
        held && googleHome && !watchApk -> "Android lists Couch TV as the home app, but on some TVs (a TCL among them) Home still opens Google's home " +
            "with the phone only download. That is expected: see More, Home button from a computer. Until then, open your couch-tv home from Couch TV in the apps row."
        !opensUs -> "Android lists Couch TV as the home app, but Home still opens the TV's own home. Open your couch-tv home from Couch TV in the apps row."
        else -> "Couch TV is your home screen. Press Home on the remote to see it."
    }

    /**
     * Behind More, for the phone only download: the exact way to get the Home button watch, which only
     * couch-tv-ontv-watch.apk has and which is put on from a computer. tvAddress: this TV's address.
     */
    fun watchSteps(tvAddress: String?): String {
        val at = tvAddress ?: "the TV's address"
        return "Home button from a computer. This app came from your phone (couch-tv-ontv.apk), and Google Play Protect blocks the part " +
            "that keeps the Home button in an app installed that way. So on Google TV, and on TVs that open Google's home by name, " +
            "Home keeps opening Google's home. To change that, once: " +
            "1. On a computer, download couch-tv-ontv-watch.apk from github.com/Seagey/couch-tv/releases/latest. " +
            "2. Switch on USB debugging on this TV (the steps above). " +
            "3. On the computer, with Google's adb tool: adb connect $at:5555, then adb install -r couch-tv-ontv-watch.apk " +
            "(press Allow on the TV if it asks). With Wireless debugging instead: first Pair device with pairing code on the TV, " +
            "and run adb pair with the address, port and code that screen shows; then adb connect with the address and port on the " +
            "Wireless debugging screen itself, then the same adb install -r. It goes over this app and keeps your settings. " +
            "4. On the TV: Settings, Accessibility (on some TVs inside System or Device Preferences), Couch TV home watch, On. " +
            "5. Back here, press Use as home screen (if the button says Stop being the home screen, it is already on). " +
            "The watch only brings couch-tv back while that is on."
    }
}
