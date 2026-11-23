package dev.couchtv.ontv

/**
 * The words on the Couch TV setup screen (SetupActivity), as plain functions so SetupWordsTest checks
 * them on a computer. Plain words for someone who has never set up a TV app: no "ADB", no
 * "accessibility", no "debugging" on the first screen. Those live in Settings, still in plain words. The step screens (SetupSteps) have the shortest words of all.
 */
object SetupWords {
    /** The big line: the code to type on the phone, or that a phone is paired. */
    fun pairLine(pin: String?, phones: Int, pairedAgoMs: Long?, lockedSecs: Int = 0): String = when {
        lockedSecs > 0 -> "Too many wrong codes. Pairing opens again in ${(lockedSecs + 59) / 60} min"
        pin != null -> "Phone code  ${pin.take(3)} ${pin.drop(3)}"
        pairedAgoMs != null && pairedAgoMs in 0..10 * 60_000L -> "Your phone is paired"
        phones > 0 -> if (phones == 1) "1 phone is paired" else "$phones phones are paired"
        else -> "No phone yet: press New phone code"
    }

    /**
     * What the QR holds: the phone address, plus the live code after a # so one scan pairs the phone.
     * A fragment is never sent in a request, so the code is never in a request line or a log.
     * [path] is the page on the TV: "/" for the phone remote, "/setup" for Home settings on the phone
     * (Server.kt, /api/phone-link). The six digit check lives only here.
     */
    fun qrLink(phoneUrl: String?, pin: String?, path: String = "/"): String? = when {
        phoneUrl == null -> null
        pin != null && pin.length == 6 && pin.all { it.isDigit() } -> "$phoneUrl$path#pin=$pin"
        path == "/" -> phoneUrl
        else -> "$phoneUrl$path"
    }

    /** The line under it: what to do next. */
    fun nextLine(pin: String?, phones: Int, homeOpensUs: Boolean, lockedSecs: Int = 0): String = when {
        lockedSecs > 0 -> "Someone typed too many wrong codes. To pair your phone now, press New phone code."
        pin != null -> "On your phone, scan the code on the left. That pairs it, no typing. Or type the address under it, then this code."
        phones > 0 && homeOpensUs -> "Next: press Home on the TV remote. Your Couch TV home is there."
        phones > 0 -> "Next: press Open the home. From now on, open your home from Couch TV in the TV's apps row."
        else -> "Press New phone code, then scan the code on the left with your phone's camera."
    }

    /** The whole "Allow debugging?" wait ran out with no answer (Adb.unanswered): nobody pressed, or the TV never asked. */
    const val NOT_ASKED = "No answer. If the TV never asked \"Allow USB debugging?\", restart it and retry."

    /** Connect is waiting and the setup screen kept its focus: the TV's box is likely hidden behind it (AllowWait). */
    const val ALLOW_HIDDEN = "The TV's Allow box may be hidden. Press Back once to see it, or switch USB debugging off and on."

    /** What the phone remote can do now, without the word ADB. */
    fun keysLine(connected: Boolean, waiting: Boolean, needsPairing: Boolean, notAsked: Boolean = false): String = when {
        connected -> "The phone remote can press every key and type on the TV."
        waiting -> "On the TV's \"Allow USB debugging?\", tick Always allow, then Down, Left, press Allow."
        notAsked -> NOT_ASKED
        needsPairing -> "The phone remote opens apps and changes the volume. For the arrow keys and typing, see Settings."
        else -> "The phone remote opens apps and changes the volume. For the arrow keys and typing, see Settings."
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
                 asking: Boolean = false, declined: Boolean = false, opensUs: Boolean = held, noAsk: String? = null): String = when {
        asking -> "Asking the TV to make Couch TV its home. If the screen goes black, press Back once and the question comes up."
        // this TV cannot be asked from here (HomeAsk.plan EXPLAIN): say so instead of promising "No computer needed"
        noAsk != null && !useAsHome -> noAskNote(noAsk)
        // the watch only acts while Use as home screen is on (FireHome.onOtherHome), so it is always one of the steps
        googleTv && watchApk && !useAsHome -> "On Google TV the Home button opens Google TV first. To bring your Couch TV home straight back on top: " +
            "press Use as home screen, then switch on Couch TV home watch in the TV's Settings, Accessibility (on some TVs inside System or Device Preferences)."
        googleTv && watchApk -> "On Google TV the Home button always opens Google TV first. With Couch TV home watch switched on in the TV's Settings, Accessibility (on some TVs inside System or Device Preferences), your Couch TV home comes straight back on top."
        googleTv -> "On Google TV the Home button always opens Google TV first, with the version you put on from your phone. That is normal. " +
            "To make Home open Couch TV, press Make Home open Couch TV once Couch TV can press keys on this TV. Or put the Home button version on from a computer (see Settings, Home button from a computer), then press Use as home screen. " +
            "Until then, open your Couch TV home from Couch TV in the apps row."
        declined -> "Couch TV is not your home screen: the TV's list was closed without choosing it. Press Use as home screen to ask again."
        !useAsHome -> "Use as home screen asks the TV to make Couch TV its home. No computer needed."
        // 0.13.3 said "Couch TV is your home screen" from a saved switch while Google's home was still the
        // default (TCL beginner test, 19 Nov 2026). Now only what Android reports right now decides the words.
        !held && !opensUs -> "Couch TV is not your home screen yet: the TV's own home still opens on Home. Press Use as home screen to ask the TV again."
        held && googleHome && !watchApk -> "Android lists Couch TV as the home app, but on some TVs (a TCL among them) Home still opens Google's home " +
            "with the version you put on from your phone. That is normal: see Settings, Home button from a computer, or press Make Home open Couch TV. Until then, open your Couch TV home from Couch TV in the apps row."
        !opensUs -> "Android lists Couch TV as the home app, but Home still opens the TV's own home. Open your Couch TV home from Couch TV in the apps row."
        else -> "Couch TV is your home screen. Press Home on the remote to see it."
    }

    /**
     * Use as home screen on a TV that cannot be asked from here (HomeAsk.noAskReason): the setup screen stays
     * in front and says what this TV allows. "google": Google's Android TV Home (a TCL on Android TV 11 put it
     * in front and kept the Home button, 19 and 23 Nov 2026). LEFT: asking sent the person to the TV's own home
     * once already. NO_QUESTION: Android had no question to show.
     */
    fun noAskNote(reason: String): String {
        val stays = "Couch TV stays one press away: open it from the apps row."
        return when (reason) {
            "google" -> "This TV keeps Google's home on the Home button, and it does not let Couch TV ask for it from here. $stays " +
                "To make Home open Couch TV, first let Couch TV press keys on this TV (Settings, Let the phone press keys), then press Make Home open Couch TV. " +
                "Or do it once from a computer: Settings, Home button from a computer."
            HomeAsk.NO_QUESTION -> "This TV has no question for choosing a home screen, so the Home button keeps opening the TV's own home. $stays " +
                "To change the Home button, do it once from a computer: Settings, Home button from a computer."
            else -> "This TV went to its own home instead of asking, so the Home button still opens the TV's own home. $stays " +
                "To try again, first let Couch TV press keys on this TV (Settings, Let the phone press keys), then press Use as home screen. " +
                "Or do it once from a computer: Settings, Home button from a computer."
        }
    }

    /**
     * In Settings, for the phone only download: the exact way to get the Home button watch, which only
     * couch-tv-ontv-watch.apk has and which is put on from a computer. tvAddress: this TV's address.
     */
    fun watchSteps(tvAddress: String?): String {
        val at = tvAddress ?: "the TV's address"
        return "Home button from a computer, for someone comfortable with a computer. This app came from your phone (couch-tv-ontv.apk), and Google Play Protect blocks the part " +
            "that keeps the Home button in an app installed that way. So on Google TV, and on TVs that open Google's home by name, " +
            "Home keeps opening Google's home. To change that, once: " +
            "1. On a computer, download couch-tv-ontv-watch.apk from github.com/Seagey/couch-tv/releases/latest. " +
            "2. Switch on USB debugging on this TV (the steps above). " +
            "3. On the computer, with Google's adb tool (Android's free computer tool, part of Platform Tools): adb connect $at:5555, then adb install -r couch-tv-ontv-watch.apk " +
            "(press Allow on the TV if it asks). With Wireless debugging instead: first Pair device with pairing code on the TV, " +
            "and run adb pair with the address, port and code that screen shows; then adb connect with the address and port on the " +
            "Wireless debugging screen itself, then the same adb install -r. It goes over this app and keeps your settings. " +
            "4. On the TV: Settings, Accessibility (on some TVs inside System or Device Preferences), Couch TV home watch, On. " +
            "5. Back here, press Use as home screen (if the button says Stop being the home screen, it is already on). " +
            "Couch TV home watch only brings Couch TV back while that is on."
    }

    // ---------------------------------------------------------------------------------------------
    // The step screens (SetupSteps), approved by the owner from the mockups of 23 Nov 2026: one heading,
    // one short line, one or two big buttons. Everything longer lives in Settings or behind More help.

    const val SETTINGS = "Settings"
    const val SKIP = "Skip"
    const val NEXT = "Next"
    const val MORE_HELP = "More help"
    const val BACK = "Back"
    fun stepOf(n: Int, of: Int = 2) = "Step $n of $of"

    const val HOME_TITLE = "Make Couch TV your home"
    /** Step 1's one line. reason: SetupSteps.explainReason; busy: HomeKey's own words while it works. */
    fun homeStepLine(step: SetupSteps.HomeStep, declined: Boolean = false, reason: String = "google", busy: String = ""): String {
        val stays = "Couch TV stays one press away in your apps row."
        return when (step) {
            SetupSteps.HomeStep.ASK, SetupSteps.HomeStep.SWITCH ->
                if (declined) "Couch TV is not your home yet. Press again and choose Couch TV."
                else "Then the Home button on your remote opens Couch TV."
            SetupSteps.HomeStep.ASKING -> "Asking the TV. If the screen goes black, press Back once."
            SetupSteps.HomeStep.KEY -> "This TV keeps Google's home on the Home button. One press can change that."
            SetupSteps.HomeStep.BUSY -> busy.ifEmpty { "Working on it. Couch TV may close and open again by itself." }
            SetupSteps.HomeStep.EXPLAIN -> when (reason) {
                HomeAsk.NO_QUESTION -> "This TV has no way to pick a home screen from here. $stays"
                HomeAsk.LEFT -> "This TV went to its own home instead of asking. $stays"
                else -> "This TV keeps Google's home on the Home button. $stays"
            }
        }
    }
    /** Step 1's big button. */
    fun homeStepButton(step: SetupSteps.HomeStep): String = when (step) {
        SetupSteps.HomeStep.ASK, SetupSteps.HomeStep.SWITCH -> "Make it my home"
        SetupSteps.HomeStep.ASKING -> "Asking the TV..."
        SetupSteps.HomeStep.KEY -> HomeKeyRules.BUTTON
        SetupSteps.HomeStep.BUSY -> "Working..."
        SetupSteps.HomeStep.EXPLAIN -> NEXT
    }
    /** Step 1's second, quieter button: Skip where there is something to press, More help where there is not. */
    fun homeStepSecond(step: SetupSteps.HomeStep): String = if (step == SetupSteps.HomeStep.EXPLAIN) MORE_HELP else SKIP

    const val OPEN_TITLE = "Open your new home"
    const val OPEN_LINE = "Pick a design or start with Couch Original. You can change it any time from your phone or computer."
    const val OPEN_BUTTON = "Open the home"
    /** The green note on step 2, only when step 1 really made Couch TV the home. */
    const val HOME_DONE = "Couch TV is your home"

    const val READY_TITLE = "Couch TV is ready"
    fun readyLine(homeOpensUs: Boolean) =
        if (homeOpensUs) "Press Home on your remote, or open your home from here."
        else "Open your home from here any time."
    /** The one place the phone remote is offered after setup. */
    const val READY_NOTE_START = "Want a phone remote? It's in "

    /** More help behind step 1 (SetupSteps.Screen.HOME_HELP). */
    const val HELP_TITLE = "Why the Home button stays"
    fun helpLine(reason: String): String = when (reason) {
        HomeAsk.NO_QUESTION -> "This TV has no question for picking a home screen. Two ways to change the Home button:"
        HomeAsk.LEFT -> "Asking sent this TV to its own home. Two ways to change the Home button:"
        else -> "Some TVs keep Google's home on the Home button. Two ways to change that:"
    }
    val HELP_WAYS = listOf(
        "Let Couch TV press keys, then press ${HomeKeyRules.BUTTON}.",
        "Or do it once from a computer. Scan the code for the steps.")
    const val HELP_KEYS_BUTTON = "Let the phone press keys"

    // ---------------------------------------------------------------------------------------------
    // Settings (owner approved round 2, 23 Nov 2026): Edit your home, Phone remote, Undo Couch TV, Help.

    const val EDIT_ITEM = "Edit your home"
    const val EDIT_SUB = "On your phone"
    const val EDIT_LINE = "Change widgets, your town, calendar and photos on your phone."
    const val SCAN = "Scan with your phone camera."
    fun editType(setupUrl: String?, pin: String?): String = when {
        setupUrl == null -> NO_NETWORK
        pin != null -> "Or type ${setupUrl.removePrefix("http://")} on a phone or computer on this WiFi, then the code ${pin.take(3)} ${pin.drop(3)}."
        else -> "Or type ${setupUrl.removePrefix("http://")} on a phone or computer on this WiFi."
    }
    const val NO_NETWORK = "This TV is not on a network yet. Connect it to WiFi first."

    const val PHONE_ITEM = "Phone remote"
    fun phoneSub(phones: Int) = when (phones) { 0 -> "No phone yet"; 1 -> "1 phone paired"; else -> "$phones phones paired" }
    const val PHONE_TITLE = "Use your phone as a TV remote?"
    const val PHONE_LINE = "Scan the code and your phone is the remote. No app to install."
    const val PHONE_REMOTE_PAGE = "Remote"
    const val PHONE_WATCH_PAGE = "Watch"
    /** Under the QR: the live code, or why there is none. */
    fun phoneCode(pin: String?, lockedSecs: Int): String = when {
        lockedSecs > 0 -> "Locked for ${(lockedSecs + 59) / 60} min"
        pin != null -> "${pin.take(3)} ${pin.drop(3)}"
        else -> ""
    }
    fun phoneType(phoneUrl: String?) = if (phoneUrl == null) NO_NETWORK else "Or type ${phoneUrl.removePrefix("http://")}"
    const val NEW_CODE = "New code"
    const val FORGET_PHONES = "Forget phones"
    /** The yellow strip, only on a TV where the phone cannot press keys yet (SetupSettings.keyStrip). */
    const val KEYS_STRIP = "For the arrow keys and typing, this TV needs one more step."
    const val KEYS_STRIP_BUTTON = "Set it up"
    const val KEYS_STRIP_FIRE = "On this TV the phone remote opens apps and changes the volume. Arrow keys and typing need a home computer."

    const val UNDO_ITEM = "Undo Couch TV"
    const val UNDO_SUB = "Back to normal"
    const val UNDO_TITLE = "Put this TV back to normal"
    const val UNDO_LINE = "Couch TV stops being your home and its Home button watch turns off. Then you can remove the app."
    const val UNDO_NOTE = "Your shows, apps and the TV's own settings are not touched."
    const val UNDO_CONFIRM_TITLE = "Undo Couch TV?"
    const val UNDO_CONFIRM_LINE = "Your TV's own home comes back on the Home button. You can set Couch TV up again any time."
    const val UNDO_KEEP = "Keep Couch TV"
    const val UNDO_DONE_TITLE = "Your TV is back to normal"
    const val UNDO_DONE_LINE = "Press Home to see your TV's own home. Want to remove the Couch TV app too?"
    const val UNDO_REMOVE = "Remove Couch TV"
    const val NOT_NOW = "Not now"

    const val HELP_ITEM = "Help"
    const val HELP_LINE = "Scan for help with Couch TV, step by step."
    const val HELP_SITE = "couchtv.joshuaseage.com/help"
    const val HELP_URL = "https://couchtv.joshuaseage.com/help/"
    /** Only the Home button version, while its watch is not on: where to switch it on. */
    const val WATCH_LINE = "The Couch TV home watch is off. Switch it on in the TV's Accessibility settings."
    const val WATCH_BUTTON = "Open Accessibility"

    // the key walk-through (SetupSettings.keySteps)
    fun keysOf(n: Int, of: Int) = "Arrow keys and typing, $n of $of"
    const val DONE_NEXT = "Done, next"
    const val CONNECT = "Connect"
    const val KEYS_DONE_TITLE = "Your phone can press every key"
    const val KEYS_DONE_LINE = "Arrow keys, OK and typing now work from the phone remote."
    const val DONE = "Done"
    const val KEYS_DONE_HOME = "This TV keeps Google's home on the Home button. One press can change that too."
}
