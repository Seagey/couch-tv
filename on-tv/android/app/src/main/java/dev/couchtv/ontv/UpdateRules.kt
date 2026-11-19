package dev.couchtv.ontv

import org.json.JSONObject

/**
 * The plain rules behind "Update couch-tv" (Update.kt), with no Android in them, so UpdateRulesTest
 * checks them on a computer.
 *
 * The on-TV app cannot install an update itself: Android's installer needs REQUEST_INSTALL_PACKAGES,
 * which the phone only APK leaves out on purpose (only the permissions it needs, so nothing new for
 * Google Play Protect to stop at in a sideloaded app). So it only looks: GitHub's latest release, once a
 * week when the household said yes, or on "Check for updates now". A newer one shows under Home settings,
 * About, Update couch-tv, with the exact steps to put it on the way it came: Downloader and its code for
 * couch-tv-ontv.apk, a computer for couch-tv-ontv-watch.apk.
 */
object UpdateRules {
    const val REPO = "Seagey/couch-tv"
    /** Downloader's short code for couch-tv-ontv.apk (the same code the Setup app and couch-tv Studio give). */
    const val CODE = "8180170"
    const val ASSET = "couch-tv-ontv.apk"
    const val WATCH_ASSET = "couch-tv-ontv-watch.apk"

    fun asset(watch: Boolean) = if (watch) WATCH_ASSET else ASSET

    /** What GitHub's latest release says, for this app. */
    data class Found(val version: String, val title: String, val hasAsset: Boolean)

    /** True when version a is newer than b ("0.13.6" > "0.13.5", "0.10" > "0.9", "0.13" > "0.13-beta.1"). */
    fun newer(a: String, b: String): Boolean = compare(a, b) > 0

    fun compare(a: String, b: String): Int {
        val (ca, pa) = split(a)
        val (cb, pb) = split(b)
        for (i in 0 until maxOf(ca.size, cb.size)) {
            val p = ca.getOrElse(i) { 0 }
            val q = cb.getOrElse(i) { 0 }
            if (p != q) return p.compareTo(q)
        }
        if (pa.isEmpty() && pb.isEmpty()) return 0
        if (pa.isEmpty()) return 1
        if (pb.isEmpty()) return -1
        return pa.compareTo(pb)
    }

    private fun split(v: String): Pair<List<Int>, String> {
        val s = v.trim().removePrefix("v").substringBefore('+')
        val core = s.substringBefore('-')
        val pre = if (s.contains('-')) s.substringAfter('-') else ""
        return Pair(core.split('.').map { p -> p.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }, pre)
    }

    /**
     * GitHub's answer for /releases/latest, read: null when it is nothing a TV should be told about (a
     * draft, a pre-release, a tag that says it is a test build, no tag).
     */
    fun read(json: String, watch: Boolean): Found? {
        val j = JSONObject(json)
        val tag = j.optString("tag_name").trim()
        if (tag.isEmpty() || j.optBoolean("draft") || j.optBoolean("prerelease")) return null
        if (tag.removePrefix("v").substringBefore('+').contains('-')) return null
        val want = asset(watch)
        val a = j.optJSONArray("assets")
        var has = false
        for (i in 0 until (a?.length() ?: 0)) if (a!!.getJSONObject(i).optString("name") == want) has = true
        return Found(tag.removePrefix("v"), j.optString("name").trim().take(120), has)
    }

    /** Offered: newer than this app, and the release has this app's file. */
    fun offered(latest: String, current: String, hasAsset: Boolean): Boolean = latest.isNotEmpty() && hasAsset && newer(latest, current)

    /** The line above the steps. */
    fun how(watch: Boolean): String =
        if (watch) "This copy of Couch TV has the Home button watch, so it was put on from a computer, and it updates from a computer the same way. Your settings stay."
        else "This app came from your phone, so it cannot install an update by itself. Put the new version on the same way, over this one. Your settings stay."

    /** The exact steps, one per row on the TV. */
    fun steps(watch: Boolean): List<String> =
        if (watch) listOf(
            "On a computer, download $WATCH_ASSET from github.com/$REPO/releases/latest.",
            "Install it over this app with Google's adb tool: adb connect, then adb install -r $WATCH_ASSET (the Couch TV screen, More, Home button from a computer, has every step).",
            "Open Couch TV again from your apps.")
        else listOf(
            "Press Home, then open Downloader from your apps. Not there? Find Downloader by AFTVnews in the TV's Google Play Store and install it first.",
            "If Downloader opens on a web page, press Back until you see its Home screen with a box for a web address or code. Move to the box and press OK.",
            "Type $CODE and press Go. If the TV asks whether Downloader may install apps, allow it.",
            "Press Install, then Done. Your settings stay.",
            // a real TCL, 20 Nov 2026: Downloader kept five old copies, the TV ran short of space,
            // and Android said only "App not installed"
            "If it says App not installed, the TV is usually short of space. In Downloader, open Files, delete the old couch-tv-ontv files, then type $CODE again.",
            "Open Couch TV again from your apps.",
            "If the code gives the version you already have, type this address in the box instead: github.com/$REPO/releases/latest/download/$ASSET")
}
