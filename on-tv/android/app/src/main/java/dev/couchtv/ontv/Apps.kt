package dev.couchtv.ontv

/**
 * The same app table as the computer bridge (bridge/apps.py), so both modes open shows the same way.
 * deeplink: "jw" = the JustWatch Android TV link works, "search" = open the app and search,
 * "app" = only the app opens. useWeb: open the JustWatch web link cut to the show page instead.
 * cold: restart the app first ("background" = only when it is not on screen). verify: wait until
 * the app reports it is really playing. See bridge/DEEPLINKS.md for how each was tested.
 * alt: other packages of the same app (Fire TV has Amazon's own YouTube); pkg is whichever is
 * installed, main first.
 */
data class TvApp(
    val id: String, val name: String, val main: String, val colour: String,
    val jw: List<String> = emptyList(), val deeplink: String = "app",
    val useWeb: Regex? = null, val cold: String? = null, val verify: Boolean = false,
    val alt: List<String> = emptyList(),
) {
    val pkgs get() = listOf(main) + alt
    val pkg: String get() = if (alt.isEmpty() || Tv.hasPackage(main)) main else alt.firstOrNull { Tv.hasPackage(it) } ?: main
}

object Apps {
    val ALL = listOf(
        TvApp("netflix", "Netflix", "com.netflix.ninja", "#E50914", listOf("netflix", "netflixbasicwithads", "netflixkids"), "jw", cold = "background", verify = true),
        // Amazon's YouTube (Fire TV) takes the same youtube.com links as Google's.
        TvApp("youtube", "YouTube", "com.google.android.youtube.tv", "#FF0000", listOf("youtubered", "youtube"), "jw",
            alt = listOf("com.amazon.firetv.youtube")),
        TvApp("stan", "Stan", "au.com.stan.and", "#0072F5", listOf("stan"), "jw"),
        TvApp("binge", "Binge", "au.com.streamotion.ares.tv", "#1E1EFF", listOf("binge"), "search"),
        TvApp("abc-iview", "ABC iview", "au.net.abc.iview", "#00C3A5", listOf("iview"), "jw"),
        TvApp("sbs-on-demand", "SBS On Demand", "com.sbs.ondemand.tv", "#FFCC00", listOf("sbsondemand"), "jw",
            useWeb = Regex("(https://www\\.sbs\\.com\\.au/ondemand/[^/]+/[^/?#]+)"), cold = "always"),
        TvApp("disney-plus", "Disney+", "com.disney.disneyplus", "#113CCF", listOf("disneyplus"), "jw"),
        TvApp("prime-video", "Prime Video", "com.amazon.amazonvideo.livingroom", "#00A8E1", listOf("amazonprimevideo", "amazon"), "jw"),
        TvApp("apple-tv", "Apple TV", "com.apple.atve.androidtv.appletv", "#111111", listOf("appletvplus", "itunes"), "jw"),
        TvApp("paramount-plus", "Paramount+", "com.cbs.ca", "#0064FF", listOf("paramountplus", "paramountpluspremium", "paramountplusbasicwithads"), "jw"),
        TvApp("kayo", "Kayo", "au.com.kayosports.tv", "#00E676"),
        TvApp("foxtel-go", "Foxtel Go", "au.com.foxtel.atv", "#F05A28"),
        TvApp("9now", "9Now", "au.com.ninenow.ctv", "#00A9E0", listOf("ninenow"), "jw"),
        TvApp("7plus", "7plus", "com.swm.live", "#E4002B", listOf("sevenplus"), "jw"),
        TvApp("10play", "10play", "au.com.tenplay", "#0B0B0B", listOf("tenplay"), "jw"),
        TvApp("hbo-max", "HBO Max", "com.wbd.stream", "#002BE7", listOf("max", "hbomax"), "search"),
        TvApp("google-tv", "Google TV", "com.google.android.videos", "#4285F4", listOf("play", "googleplaymovies")),
        TvApp("twitch", "Twitch", "tv.twitch.android.app", "#9146FF"),
        TvApp("spotify", "Spotify", "com.spotify.tv.android", "#1DB954"),
        TvApp("plex", "Plex", "com.plexapp.android", "#E5A00D"),
        TvApp("moonlight", "Moonlight", "com.limelight", "#2A2A2A"),
        TvApp("settings", "Settings", "com.android.tv.settings", "#5F6368"),
        TvApp("home", "Home", BuildConfig.APPLICATION_ID, "#000000"),
    )
    val BY_ID = ALL.associateBy { it.id }
    val BY_PACKAGE = ALL.flatMap { a -> a.pkgs.map { it to a } }.toMap()
    val BY_JW = ALL.flatMap { a -> a.jw.map { it to a } }.toMap()

    /** Packages that mean "a home screen is in front". */
    val HOME_PACKAGES = setOf(
        BuildConfig.APPLICATION_ID, "app.couchtv.launcher",
        "com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.android.tv.launcher",
    )

    /** Which app takes an https link, for /api/launch with a bare URL (a TV often has no browser). */
    fun packageForLink(url: String): String? {
        val host = runCatching { android.net.Uri.parse(url).host }.getOrNull()?.lowercase()?.removePrefix("www.") ?: return null
        val id = when {
            host == "youtube.com" || host == "youtu.be" || host == "m.youtube.com" -> "youtube"
            host.endsWith("netflix.com") -> "netflix"
            host.endsWith("disneyplus.com") -> "disney-plus"
            host.endsWith("primevideo.com") -> "prime-video"
            host == "tv.apple.com" -> "apple-tv"
            host.endsWith("sbs.com.au") -> "sbs-on-demand"
            host.endsWith("stan.com.au") -> "stan"
            host.endsWith("paramountplus.com") -> "paramount-plus"
            else -> null
        }
        return id?.let { BY_ID[it]?.pkg }
    }

    /** App search pages that open by link (tested on a TV, bridge/DEEPLINKS.md). */
    val SEARCH_LINKS = mapOf(
        "netflix" to "https://www.netflix.com/search?q={q}",
        "youtube" to "https://www.youtube.com/results?search_query={q}",
    )

    fun describe(pkg: String?): Map<String, Any?>? {
        if (pkg.isNullOrEmpty()) return null
        if (pkg in HOME_PACKAGES) return mapOf("id" to "home", "name" to "Home", "package" to pkg)
        BY_PACKAGE[pkg]?.let { return mapOf("id" to it.id, "name" to it.name, "package" to pkg) }
        val name = pkg.substringAfterLast('.').replace('_', ' ').replaceFirstChar { it.uppercase() }
        return mapOf("id" to null, "name" to name, "package" to pkg)
    }
}

/** Friendly key names (same as the computer bridge) to Android key codes. */
object Keys {
    private val FRIENDLY = mapOf(
        "up" to "DPAD_UP", "down" to "DPAD_DOWN", "left" to "DPAD_LEFT", "right" to "DPAD_RIGHT",
        "ok" to "DPAD_CENTER", "select" to "DPAD_CENTER", "enter" to "DPAD_CENTER",
        "back" to "BACK", "home" to "HOME",
        "play_pause" to "MEDIA_PLAY_PAUSE", "play" to "MEDIA_PLAY", "pause" to "MEDIA_PAUSE",
        "stop" to "MEDIA_STOP", "next" to "MEDIA_NEXT", "previous" to "MEDIA_PREVIOUS",
        "rewind" to "MEDIA_REWIND", "fast_forward" to "MEDIA_FAST_FORWARD",
        "volume_up" to "VOLUME_UP", "volume_down" to "VOLUME_DOWN", "mute" to "VOLUME_MUTE",
        "power" to "POWER", "settings" to "SETTINGS", "menu" to "MENU", "info" to "INFO", "guide" to "GUIDE",
        "input" to "TV_INPUT", "search" to "SEARCH", "captions" to "CAPTIONS",
        "channel_up" to "CHANNEL_UP", "channel_down" to "CHANNEL_DOWN",
    ) + (0..9).associate { "$it" to "$it" }

    private val RAW_OK = FRIENDLY.values.toSet() + setOf(
        "DPAD_UP_LEFT", "DPAD_UP_RIGHT", "DPAD_DOWN_LEFT", "DPAD_DOWN_RIGHT", "ESCAPE", "MOVE_HOME", "MOVE_END",
        "PAGE_UP", "PAGE_DOWN", "DEL", "FORWARD_DEL", "SPACE", "TAB", "ENTER", "MEDIA_RECORD", "MEDIA_AUDIO_TRACK",
        "PROG_RED", "PROG_GREEN", "PROG_YELLOW", "PROG_BLUE", "SLEEP", "WAKEUP", "ASSIST", "BUTTON_A", "BUTTON_B",
        "BUTTON_X", "BUTTON_Y", "APP_SWITCH", "ALL_APPS", "BOOKMARK", "TV", "DVR", "LAST_CHANNEL",
        "MEDIA_SKIP_FORWARD", "MEDIA_SKIP_BACKWARD", "MEDIA_STEP_FORWARD", "MEDIA_STEP_BACKWARD",
    )

    /** "up" or "DPAD_UP" or "KEYCODE_DPAD_UP" to "KEYCODE_DPAD_UP". Null when unknown. */
    fun resolve(name: String?): String? {
        val k = name?.trim().orEmpty()
        if (k.isEmpty()) return null
        FRIENDLY[k.lowercase()]?.let { return "KEYCODE_$it" }
        val raw = k.uppercase().removePrefix("KEYCODE_")
        return if (Regex("[A-Z0-9_]+").matches(raw) && raw in RAW_OK) "KEYCODE_$raw" else null
    }
}
