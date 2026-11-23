package dev.couchtv.ontv

/**
 * The Google Play build (product flavour "play", bundlePlayRelease; coord/GOOGLE-PLAY-PLAN.md section 4 and
 * coord/GOOGLE-PLAY-BUILD.md): the plain rules, with no Android in them, so PlayRulesTest checks them on a
 * computer. `store` is BuildConfig.FLAVOR: "play", or "github" for the two GitHub APKs (couch-tv-ontv.apk from
 * the release build type, couch-tv-ontv-watch.apk from the watch build type), which these rules leave as they were.
 *
 * In the Play build:
 *  - Google Play updates it. It never asks GitHub for a new version, never downloads an APK and never
 *    installs one over its own ADB link (Update.kt, HomeKey.kt).
 *  - The Home button watch (WatchService) is in the app, off until the person switches it on themselves in
 *    Android's Accessibility settings, after the disclosure (DisclosureActivity) and Agree. The app never
 *    writes Android's accessibility list. Switched on without Agree, it reads nothing and asks first.
 *  - No self grants over ADB (draw over apps, usage access, secure settings, TV listings), no wireless
 *    debugging switched back on after a restart, no Hisense launch list and no TCL AUTO_START, no
 *    /api/screenshot, and web link cards show a QR code instead of opening a browser.
 *  - No Ask AI (askAi), and no READ_TV_LISTINGS (tvListings): Keep watching uses what the app sees itself.
 */
object PlayRules {
    const val PLAY = "play"
    /** Store key: the person pressed Agree on the Home button watch disclosure. */
    const val AGREED_KEY = "play_watch_agreed"

    fun play(store: String) = store == PLAY
    /** The builds that declare the Home button watch: the GitHub watch build, and the Play build. */
    fun hasWatch(store: String, buildType: String) = play(store) || buildType == "watch"
    /** Asks GitHub for new versions and can download and install them over the app's own ADB link. */
    fun gitHubDownloads(store: String) = !play(store)
    /** Writes the watch into Android's accessibility list by itself (secure settings grant or ADB). Never in Play. */
    fun switchesWatchOnItself(store: String) = !play(store)
    /**
     * Uses the app's own ADB link to change the TV's own rules: grants for itself (appops, pm grant), wireless
     * debugging back on after a restart, the Hisense launch list, TCL's AUTO_START. Never in Play: key presses,
     * typing, opening apps and what is playing stay.
     */
    fun changesTvRules(store: String) = !play(store)
    /** A picture of whatever is on screen (/api/screenshot). Not in Play. */
    fun screenshots(store: String) = !play(store)
    /** Web link cards open the TV's browser (TV quality TV-WB says a TV app must not). Play: a QR code for the phone. */
    fun opensBrowser(store: String) = !play(store)
    /**
     * Ask AI (Ask.kt, POST /api/ask, the TV home's Ask sheet and widget, the phone remote's Ask button). Not in the
     * first Play build (the owner's choice, 23 Nov 2026), so Play's AI generated content rules do not apply to it.
     */
    fun askAi(store: String) = !play(store)
    /**
     * Keep watching reads Android's Watch Next rows (WatchNext.kt), which needs READ_TV_LISTINGS. Android only
     * ever gave it to this app over its own ADB link, which the Play build never uses for grants, so the Play
     * manifest leaves the permission out and Keep watching uses what the app sees itself.
     */
    fun tvListings(store: String) = !play(store)
    /**
     * The Hisense rebind (App.rebindWatch) writes the list without the watch, then with it again, only when it is
     * already listed, and needs the secure settings grant, which the Play build never has. In Play only after Agree.
     */
    fun mayRebind(store: String, agreed: Boolean) = !play(store) || agreed
    /** The watch acts on what it sees. In Play only once the person has agreed. */
    fun watchMayAct(store: String, agreed: Boolean) = !play(store) || agreed

    /**
     * A press of Make Home open Couch TV, or of the Accessibility button in Settings, in the Play build:
     *  "done"      the watch is on and Use as home screen is on: nothing to do
     *  "disclose"  not agreed yet: the disclosure screen first, never Android's settings
     *  "settings"  agreed: Use as home screen on, then Android's Accessibility settings for the person to switch it on
     */
    fun press(agreed: Boolean, watchOn: Boolean, homeOn: Boolean): String = when {
        watchOn && homeOn -> "done"
        !agreed -> "disclose"
        else -> "settings"
    }

    /** HomeKey's view in Play: never the computer or GitHub steps, always one press (it needs no ADB link). */
    fun view(watchOn: Boolean, homeOn: Boolean) = if (watchOn && homeOn) "done" else "ready"

    /** play versionCode: 1,000,000 + 100 x the GitHub versionCode of the same source + n (0 to 99, Play only rebuilds). */
    fun versionCode(gitHubCode: Int, rebuild: Int = 0): Int {
        require(gitHubCode in 0..20_989_999 && rebuild in 0..99)
        return 1_000_000 + 100 * gitHubCode + rebuild
    }

    // ------------------------------------------------------------------------------------------- words

    /** The disclosure (GOOGLE-PLAY-PLAN.md section 6.5), in the setup screen's look. */
    const val DISCLOSE_TITLE = "Bring Couch TV back when you press Home"
    /** The three short paragraphs, so the whole screen and both buttons fit a TV without scrolling. */
    val DISCLOSE_PARTS = listOf(
        "Google TV keeps its own home on the Home button. Couch TV home watch, an Android accessibility service, " +
            "notices when the TV's own home opens and brings your Couch TV home back.",
        "It only learns which app's screen just opened. It does not read what is on the screen, what you type, " +
            "or anything inside other apps, and it sends nothing anywhere.",
        "It stays off unless you agree. Agree opens Android's Accessibility settings: switch on Couch TV home watch there. " +
            "You can switch it off at any time in Settings, Accessibility, or with Undo Couch TV.")
    val DISCLOSE_LINE = DISCLOSE_PARTS.joinToString("\n\n")
    const val AGREE = "Agree and open Settings"
    const val NOT_NOW = "Not now"

    /** HomeKey's words in Play, on the TV and on the phone page. */
    const val READY = "Press it to see what the Home button watch reads and why. If you agree, Android's Accessibility settings " +
        "open: switch on Couch TV home watch there. It stays off until you do."
    const val READY_PHONE = "Press it, then look at the TV: it says what the Home button watch reads and why, with Agree and Not now. " +
        "If you agree there, switch on Couch TV home watch in the TV's Accessibility settings."
    /** Update's line in Play. */
    const val UPDATES = "Couch TV updates through Google Play."
    /** A web link card in Play: the phone opens it. */
    const val LINK_ON_PHONE = "Scan to open this on your phone"
    /** Ask AI in Play: not in this build. */
    const val ASK_OFF = "Ask AI is not in this version of Couch TV."
}

/** This build's answers to PlayRules, from BuildConfig. */
object Variant {
    val store: String get() = BuildConfig.FLAVOR
    val play: Boolean get() = PlayRules.play(BuildConfig.FLAVOR)
    val hasWatch: Boolean get() = PlayRules.hasWatch(BuildConfig.FLAVOR, BuildConfig.BUILD_TYPE)
    fun agreed(): Boolean = runCatching { Store.bool(PlayRules.AGREED_KEY) }.getOrDefault(false)
}
