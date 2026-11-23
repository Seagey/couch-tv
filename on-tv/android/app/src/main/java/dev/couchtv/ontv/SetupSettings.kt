package dev.couchtv.ontv

/**
 * The plain decisions behind Settings on the TV (owner approved round 2, 23 Nov 2026), so SetupSettingsTest
 * checks them on a computer. Settings is a list on the left (Edit your home, Phone remote, Undo Couch TV,
 * a small Help) and the focused item's panel on the right. The phone remote's "press keys" link is a step
 * inside Phone remote, shown only on a TV that still needs it.
 */
object SetupSettings {
    enum class Item { EDIT, PHONE, UNDO, HELP }

    /** The yellow strip under the phone remote: none (keys work), steps (the walk-through) or fire (Amazon blocks it). */
    enum class Strip { NONE, STEPS, FIRE }

    /**
     * connected: the app's own link to the TV is up (Adb.connected). fireBlocked: a Fire TV whose Fire OS
     * refused that link (Adb.FIRE_BLOCKED, current Fire OS 6.7.1.1, 7.6.6.9, 8.1.0.3 and newer).
     */
    fun keyStrip(connected: Boolean, fireBlocked: Boolean): Strip = when {
        connected -> Strip.NONE
        fireBlocked -> Strip.FIRE
        else -> Strip.STEPS
    }

    /** What a walk-through button does. */
    enum class Action { OPEN_ABOUT, OPEN_DEVELOPER, NEXT, CONNECT, BACK }

    /** One screen of the walk-through: its words, its big button, its second button, and whether it shows the phone page's QR. */
    data class KeyStep(val title: String, val line: String, val button: String, val action: Action,
                       val second: String, val secondAction: Action, val phoneQr: Boolean = false)

    /** The TV's menus, in its own words. */
    enum class Menus { GOOGLE_TV, ANDROID_TV, FIRE_TV }
    fun menus(googleTv: Boolean, fireTv: Boolean): Menus = when {
        fireTv -> Menus.FIRE_TV
        googleTv -> Menus.GOOGLE_TV
        else -> Menus.ANDROID_TV
    }

    /**
     * Pairing with a code (Wireless debugging): Android 13 and newer always (Network debugging is gone), and an
     * Android 11 or 12 TV whose port 5555 is closed (Adb state needs_pairing). Fire OS has no Wireless debugging.
     */
    fun needsPairing(sdk: Int, adbState: String, fireTv: Boolean): Boolean = !fireTv && (sdk >= 33 || adbState == "needs_pairing")

    /** The walk-through, three screens on every TV: Developer options, the debugging switch, then letting Couch TV in. */
    fun keySteps(menus: Menus, pairing: Boolean): List<KeyStep> {
        val about = when (menus) {
            Menus.GOOGLE_TV -> "On the TV, open Settings, then System, then About. Press OK on Android TV OS build seven times."
            Menus.ANDROID_TV -> "On the TV, open Settings, then Device Preferences, then About. At the bottom, press OK on Android TV OS build seven times."
            Menus.FIRE_TV -> "On the TV, open Settings, then My Fire TV, then About. Press OK on the TV's own name, at the top, seven times."
        }
        val first = KeyStep("Turn on Developer options", about, "Open Settings", Action.OPEN_ABOUT, SetupWords.DONE_NEXT, Action.NEXT)
        val second = when {
            menus == Menus.FIRE_TV -> KeyStep("Switch on ADB debugging",
                "In My Fire TV, open Developer options and switch on ADB debugging. It lets Couch TV press keys on this TV, and nothing else.",
                "Open Developer options", Action.OPEN_DEVELOPER, SetupWords.DONE_NEXT, Action.NEXT)
            pairing -> KeyStep("Switch on Wireless debugging",
                "In Developer options, switch on Wireless debugging. It lets Couch TV press keys on this TV, and nothing else.",
                "Open Developer options", Action.OPEN_DEVELOPER, SetupWords.DONE_NEXT, Action.NEXT)
            else -> KeyStep("Switch on USB debugging",
                "In Developer options, switch on USB debugging, and Network debugging if there is one. It lets Couch TV press keys on this TV, and nothing else.",
                "Open Developer options", Action.OPEN_DEVELOPER, SetupWords.DONE_NEXT, Action.NEXT)
        }
        val third = if (pairing) KeyStep("Pair with a code",
            "In Wireless debugging, choose Pair device with pairing code. Scan this with your phone and type that code there.",
            SetupWords.CONNECT, Action.CONNECT, SetupWords.BACK, Action.BACK, phoneQr = true)
        else KeyStep("Let Couch TV in", "Press Connect. On \"Allow USB debugging?\", tick Always allow, then Down, Left, Allow.",
            SetupWords.CONNECT, Action.CONNECT, SetupWords.BACK, Action.BACK)
        return listOf(first, second, third)
    }

    /**
     * Where the walk-through starts: a TV that already has Developer options on skips the first screen, and one with
     * its debugging switch on (USB debugging, or Wireless debugging where it pairs) goes straight to Connect.
     * (The owner's TCL, 23 Nov 2026, had both on already: the About screen's last row is Android TV OS build.)
     */
    fun firstKeyStep(developerOn: Boolean, debuggingOn: Boolean): Int = when {
        debuggingOn -> 2
        developerOn -> 1
        else -> 0
    }

    /** After the walk-through: offer Make Home open Couch TV where the Home button needs it and one press can do it now. */
    fun offerHomeKey(keyView: String, needed: Boolean): Boolean = needed && keyView == "ready"

    /** The Home button version's watch is off: Help says where to switch it on (only that version has a watch). */
    fun showWatchLine(watchApk: Boolean, watching: Boolean): Boolean = watchApk && !watching

    /**
     * Undo Couch TV: what it changes on this TV with no computer. The home goes off (always), the watch goes off
     * (only the Home button version has one: the running watch switches itself off, or the app takes it out of
     * Android's list when it holds the secure settings grant), and nothing else, because the on-TV app changes
     * nothing outside itself. Removing the app is Android's own question afterwards.
     */
    fun undoWatch(watchApk: Boolean, watchRunning: Boolean, canWriteSecure: Boolean): String = when {
        !watchApk -> "none"
        watchRunning -> "self"
        canWriteSecure -> "settings"
        else -> "none"
    }
}
