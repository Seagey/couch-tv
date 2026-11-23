package dev.couchtv.ontv

/**
 * The home page's own files (www/tv) only change when the app does, so each answer carries a tag for the
 * installed version (its version code and when it was installed or updated). The WebView then asks "still
 * the same?" with If-None-Match and gets a 304 with no body, and keeps the scripts it already compiled.
 *
 * Why (0.13.10): on the owner's 1 GB TCL the home looked nearly blank, only "Keep watching" from the page's
 * own HTML, for about 5 s on open, until its 3 MB of scripts had come through this server again and been
 * compiled from scratch: every file went out as no-cache with no tag, so nothing could be kept. The answers
 * stay no-cache, so an updated app is never served from an old copy: its tag differs.
 */
object StaticTag {
    fun of(versionCode: Long, updatedAt: Long): String = "\"tv-$versionCode-$updatedAt\""

    /** If-None-Match names this tag (alone, in a list, or weak): answer 304. A "*" is not trusted. */
    fun unchanged(ifNoneMatch: String?, tag: String): Boolean {
        if (ifNoneMatch.isNullOrBlank()) return false
        return ifNoneMatch.split(',').map { it.trim().removePrefix("W/") }.any { it == tag }
    }
}
