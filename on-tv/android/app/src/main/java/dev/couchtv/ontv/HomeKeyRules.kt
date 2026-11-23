package dev.couchtv.ontv

/**
 * The plain rules behind "Make Home open Couch TV" (HomeKey.kt), with no Android in them, so
 * HomeKeyRulesTest checks them on a computer.
 *
 * On Google TV, and on TVs that open Google's home by name (a TCL with Android TV Home did, 19 Nov 2026),
 * the Home button only comes back to Couch TV through the Home button watch, an accessibility service
 * that only couch-tv-ontv-watch.apk has (Google Play Protect blocks it in the phone only download). Until
 * now that took a computer: adb install of the watch APK, then Settings, Accessibility, then Use as home
 * screen. Once the app's own ADB link is connected (the link Update to ... uses), one press does it all:
 *  1. GitHub's latest release, couch-tv-ontv-watch.apk, with Update's checks: https on GitHub's hosts
 *     only, the size and SHA-256 GitHub lists, this app's package, the same signer, and not older than
 *     this app (the same version is fine: it only adds the watch).
 *  2. Copied to the TV and installed over this app as ADB's shell user (`pm install -r`: settings stay).
 *  3. The watch switched on in Android's own list, added to whatever else is there, never replacing it,
 *     and accessibility switched on; Couch TV made the home again (installing anything made a TCL drop
 *     it as the preferred home); on a TCL its AUTO_START app op allowed first (TCL resets it, and its
 *     boot manager then blocks binding the watch).
 *  4. Checked: the watch must actually be connected. On a second TCL writing the list at once did not
 *     bind it; writing it without the watch and then with it again did (AGENTS.md, TCL), so that is the
 *     second try.
 * Without the link (never connected, or Fire OS blocking an app's own ADB) the screens give the computer
 * steps and a QR code for the help page instead.
 */
object HomeKeyRules {
    const val HELP_URL = "https://couchtv.joshuaseage.com/help/home-button/"
    /** Where the checked file goes for ADB's shell user to install it, and what the install said. Not Update's. */
    const val TMP_APK = "/data/local/tmp/couch-tv-homekey.apk"
    const val TMP_LOG = "/data/local/tmp/couch-tv-homekey.txt"
    /** The watch, as Android lists it in enabled_accessibility_services. */
    fun service(pkg: String) = "$pkg/$pkg.WatchService"
    private val SAFE = Regex("[A-Za-z0-9_.$/]+")
    private val PKG = Regex("[A-Za-z0-9_.]+")

    // ------------------------------------------------------------ Android's accessibility list

    private fun entries(current: String?) = (current ?: "").split(':').map { it.trim() }.filter { it.isNotEmpty() }

    /** Whether an entry names this app's watch, in either way Android writes it (pkg/.WatchService or the full name). */
    fun isMe(entry: String, pkg: String) = entry == service(pkg) || entry == "$pkg/.WatchService"

    /** The list with the watch added at the end. Every other service stays as it was, in its order. */
    fun withWatch(current: String?, pkg: String): String {
        val list = entries(current)
        return if (list.any { isMe(it, pkg) }) list.joinToString(":") else (list + service(pkg)).joinToString(":")
    }

    /** The list without the watch (the first half of the rebind a TCL needed). Every other service stays. */
    fun withoutWatch(current: String?, pkg: String): String = entries(current).filterNot { isMe(it, pkg) }.joinToString(":")

    fun listed(current: String?, pkg: String) = entries(current).any { isMe(it, pkg) }

    /** Safe to put inside single quotes in a shell line: component names only, nothing else. */
    fun shellSafe(value: String) = value.isEmpty() || value.split(':').all { SAFE.matches(it) }

    /** TCL resets its AUTO_START app op and then blocks the watch (AGENTS.md, TCL). Only there. */
    fun isTcl(manufacturer: String?, brand: String?) =
        listOf(manufacturer, brand).any { it != null && it.trim().uppercase().let { u -> u == "TCL" || u.startsWith("TCL ") } }

    // ------------------------------------------------------------ the shell lines

    /** The shell lines that switch the watch on (used after the install, and on their own for the watch APK). */
    fun switchOnLines(pkg: String, services: String?, tcl: Boolean, homeOn: Boolean): List<String> {
        require(PKG.matches(pkg))
        val out = ArrayList<String>()
        if (tcl) out += "appops set $pkg AUTO_START allow"
        if (services != null && shellSafe(services)) out += "settings put secure enabled_accessibility_services '$services'"
        out += "settings put secure accessibility_enabled 1"
        if (homeOn) out += "cmd package set-home-activity $pkg/.HomeAlias"
        return out
    }

    /**
     * The shell line that installs the copied watch APK. Like Update's (UpdateRules.installScript) it runs
     * on the TV apart from this app (setsid, nohup), because Android stops this app while it replaces it.
     * Only on Success: the watch is switched on (services: the new list, worked out before; null leaves
     * it to the app once it is running again), the home made Couch TV again, and the setup screen opened
     * again if Couch TV was on screen (reopen). Android also restarts the app itself (MY_PACKAGE_REPLACED),
     * which then checks the watch connected and tries the TCL rebind if not (HomeKey.resume).
     */
    fun installScript(pkg: String, services: String?, tcl: Boolean, homeOn: Boolean, reopen: Boolean): String {
        val after = switchOnLines(pkg, services, tcl, homeOn).toMutableList()
        if (reopen) after += "am start -n $pkg/.SetupActivity"
        val tail = after.joinToString("; ") { "$it > /dev/null 2>&1" }
        val body = "pm install -r $TMP_APK > $TMP_LOG 2>&1; rm -f $TMP_APK; grep -qx Success $TMP_LOG && { $tail; }"
        // the body is in double quotes for the outer sh: it holds single quotes of its own
        require(!body.contains('"') && !body.contains('`') && !body.contains("\\"))
        // and the outer sh would expand a $ inside those double quotes: an inner class in another service's
        // name (com.a/com.a.Outer$Inner) would arrive as com.a/com.a.Outer and switch that service off
        val quoted = body.replace("$", "\\$")
        return "rm -f $TMP_LOG; \$(command -v setsid) nohup sh -c \"$quoted\" > /dev/null 2>&1 < /dev/null & sleep 2"
    }

    /** The downloaded watch APK may go on: this app, and not older than it (the same version only adds the watch). */
    fun versionOk(theirs: Long, mine: Long) = theirs >= mine

    // ------------------------------------------------------------ what the screens show

    /**
     * What the screens show for the Home button, one of:
     *  "hidden"   this TV's Home button already opens the default home (plain Android TV): nothing to do
     *  "done"     the watch APK is on, its watch is connected and Use as home screen is on
     *  "busy"     downloading, installing or switching the watch on
     *  "ready"    one press can do it (the app's own ADB link, or the watch APK with the secure settings grant)
     *  "steps"    no link: the computer steps and the QR code for them
     */
    fun view(needed: Boolean, watchApk: Boolean, bound: Boolean, homeOn: Boolean, busy: Boolean,
             link: Boolean, canWriteSecure: Boolean): String = when {
        busy -> "busy"
        watchApk && bound && homeOn -> "done"
        !needed && !watchApk -> "hidden"
        link || (watchApk && canWriteSecure) -> "ready"
        else -> "steps"
    }

    /**
     * Whether the watch is doing its job. Fire OS 6 (Android 7.1, SDK 25) runs Amazon's own accessibility
     * manager and never binds it (FireHome.kt, #50): there usage access does the watching instead.
     */
    fun watching(connected: Boolean, fireTv: Boolean, sdk: Int, usageAllowed: Boolean) = connected || (fireTv && sdk <= 25 && usageAllowed)

    /** How long an install may take before a restart of the phone version counts it as over (pm install waits up to 5 minutes). */
    const val INSTALL_WINDOW = 10 * 60_000L

    /**
     * What HomeKey.resume does when the app starts. The try's marks survive a restart in the "homekey" store:
     * installingAt (0: none) and turnedOn (this try switched Use as home screen on).
     *  "finish"  the watch APK is on after an install: switch the watch on (Home stays on)
     *  "clear"   the watch APK, no install going: only forget turnedOn (Home stays on)
     *  "wait"    the phone version, the install may still be going: look again when the window ends
     *  "undo"    the phone version, the install is over or never started: forget it, and Home off again when turnedOn
     *  ""        nothing to do
     */
    fun resumeStep(watchApk: Boolean, installingAt: Long, now: Long, turnedOn: Boolean): String = when {
        watchApk && installingAt != 0L -> "finish"
        watchApk -> if (turnedOn) "clear" else ""
        installingAt == 0L -> if (turnedOn) "undo" else ""
        // the TV clock went backwards after the mark was written: the window cannot be judged, so it is over
        now < installingAt -> "undo"
        now - installingAt > INSTALL_WINDOW -> "undo"
        else -> "wait"
    }

    /** After resumeStep: switch Use as home screen off again (only what this try switched on, only when it did not finish). */
    /** How long to wait before resume() looks again: never longer than the window (a clock that jumped cannot make it days). */
    fun waitMs(installingAt: Long, now: Long): Long = (installingAt + INSTALL_WINDOW - now).coerceIn(0L, INSTALL_WINDOW) + 1000

    fun homeOffOnResume(step: String, turnedOn: Boolean) = step == "undo" && turnedOn

    /**
     * What the press does with put()'s answer:
     *  "done"  "" (Android said Success): forget turnedOn, Android is about to restart the app as the watch APK
     *  "wait"  "slow" (no answer from pm install in 5 minutes, it may still finish): keep "installing" and turnedOn,
     *          resume() decides (finish if the watch APK starts, undo once INSTALL_WINDOW is over)
     *  "fail"  anything else: Home off again if this try switched it on, nothing changed
     */
    fun afterInstall(result: String): String = when (result) {
        "" -> "done"
        "slow" -> "wait"
        else -> "fail"
    }

    /** Whether this TV needs the watch for the Home button: Google TV, a Google home by name, or a Fire TV. */
    fun needed(googleHome: Boolean, fireTv: Boolean) = googleHome || fireTv

    /** The words for each state and error, English (the setup screen and the phone page; Home settings has them in every language). */
    const val BUTTON = "Make Home open Couch TV"
    const val READY = "One press: Couch TV gets the Home button version from GitHub, checks it and puts it on over this one, then switches its Home button watch on. Your settings stay."
    const val READY_WATCH = "One press switches on the Couch TV home watch, so the Home button brings Couch TV back."
    const val DONE = "The Home button watch is on, so Home should bring Couch TV back. Press Home on the remote to check."
    const val STEPS = "This needs Couch TV to press keys on this TV first: open Settings, Phone remote, then Set it up. Or do it once from a computer: scan the code on the right for the steps."
    const val STEPS_FIRE = "This Fire TV does not let Couch TV press keys by itself. Do it once from a computer: scan the code on the right for the steps."
    /** The phone page: it has its own Let the phone press keys section, and the steps are on the page. */
    const val STEPS_PHONE = "This needs Couch TV to press keys on this TV first: use Let the phone press keys on this page, then come back here. Or do it once from a computer: the steps below."
    const val STEPS_FIRE_PHONE = "This Fire TV does not let Couch TV press keys by itself. Do it once from a computer: the steps below."
    /** Where Accessibility is on most TVs (a Google TV has it under Settings, a TCL Android TV under Device Preferences). */
    const val ACCESSIBILITY = "Settings, Accessibility (on some TVs inside System or Device Preferences), Couch TV home watch"

    /** The computer steps, one per row. A Fire TV has no such menu for the watch: its part is on the help page. */
    fun steps(fireTv: Boolean): List<String> = listOf(
        "On a computer, download couch-tv-ontv-watch.apk from github.com/${UpdateRules.REPO}/releases/latest.",
        "Install it over this app with Google's adb tool: adb connect, then adb install -r couch-tv-ontv-watch.apk. Your settings stay.",
        if (fireTv) "On a Fire TV, switch the watch on with the steps on the help page." else "On the TV: $ACCESSIBILITY, On.",
        "Open Couch TV and press Use as home screen.")

    fun busyWords(phase: String, progress: Int): String = when (phase) {
        "checking" -> "Looking on GitHub…"
        "downloading" -> "Downloading… $progress%"
        "installing" -> "Installing. Couch TV closes and opens again by itself."
        else -> "Switching the Home button watch on…"
    }

    fun errorWords(error: String, fireTv: Boolean = false): String = when (error) {
        "" -> ""
        "net" -> "Can't reach GitHub. Check the TV's Wi-Fi and try again."
        "bad" -> "The download did not check out, so nothing was installed."
        "other_key" -> "This copy of Couch TV was built on another computer, so it cannot take GitHub's version. Use the computer steps."
        "not_newer" -> "This TV has a newer Couch TV than the one on GitHub, so nothing was installed. Try again after the next release."
        "space" -> "Not installed: the TV is short of space. Free some space, then try again."
        "adb" -> "Couch TV lost its link to the TV, so nothing changed. Press Let the phone press keys, then try again."
        "update_busy" -> "Couch TV is busy with an update right now. Press again in a moment."
        "slow" -> "The TV is still installing the Home button version. Leave it on: Couch TV finishes the job by itself when the TV is done."
        "not_bound" -> if (fireTv) "Couch TV is on, but the TV did not switch its Home button watch on. The help page has the steps for a Fire TV: couchtv.joshuaseage.com/help/home-button"
            else "Couch TV is on, but the TV did not switch its Home button watch on. Open the TV's $ACCESSIBILITY, and switch it on."
        else -> "That did not work, and nothing changed. Try again, or use the computer steps."
    }

}
