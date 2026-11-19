package dev.couchtv.ontv

import org.json.JSONObject

/**
 * The plain rules behind "Update couch-tv" (Update.kt), with no Android in them, so UpdateRulesTest
 * checks them on a computer.
 *
 * Android's own installer needs REQUEST_INSTALL_PACKAGES, which the phone only APK leaves out on purpose
 * (only the permissions it needs, so nothing new for Google Play Protect to stop at in a sideloaded app).
 * It looks at GitHub's latest release, once a week when the household said yes, or on "Check for updates
 * now". A newer one shows under Home settings, About, Update couch-tv.
 *
 * With the app's own ADB link to its TV connected (Adb.kt, what the phone remote's keys use), "Update to
 * ..." installs it through that link: Update.kt downloads it, checks it (the launcher's checks: GitHub
 * only, size and SHA-256 as GitHub lists them, this app, a higher versionCode, the same signer), copies it
 * to /data/local/tmp and runs `pm install -r` there as ADB's shell user. Without the link (never
 * connected, Fire OS blocking an app's own ADB, or a try that failed) the page gives the exact steps
 * instead: Downloader and its code for couch-tv-ontv.apk, a computer for couch-tv-ontv-watch.apk, and a
 * QR code for the same steps on a phone.
 */
object UpdateRules {
    const val REPO = "Seagey/couch-tv"
    /** Downloader's short code for couch-tv-ontv.apk (the same code the Setup app and couch-tv Studio give). */
    const val CODE = "8180170"
    const val ASSET = "couch-tv-ontv.apk"
    const val WATCH_ASSET = "couch-tv-ontv-watch.apk"

    /** The same steps on a phone (the QR code under them). */
    const val HELP_URL = "https://couchtv.joshuaseage.com/help/update-couch-tv/"
    /** Where the checked file goes for ADB's shell user to install it, and what the install said. */
    const val TMP_APK = "/data/local/tmp/couch-tv-update.apk"
    const val TMP_LOG = "/data/local/tmp/couch-tv-update.txt"
    private val SHA256 = Regex("[0-9a-f]{64}")

    fun asset(watch: Boolean) = if (watch) WATCH_ASSET else ASSET

    /**
     * What GitHub's latest release says, for this app. url, digest and size are this app's file: only a
     * file on this repo's own release download address, with the SHA-256 GitHub lists for it, else "".
     */
    data class Found(val version: String, val title: String, val hasAsset: Boolean,
                     val url: String = "", val digest: String = "", val size: Long = 0L) {
        /** Everything the install needs to check the file: the address, the SHA-256 and the size. */
        val installable: Boolean get() = hasAsset && url.isNotEmpty() && digest.isNotEmpty() && size > 0
    }

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
        var url = ""
        var digest = ""
        var size = 0L
        for (i in 0 until (a?.length() ?: 0)) {
            val x = a!!.getJSONObject(i)
            if (x.optString("name") != want) continue
            has = true
            // only a file of this release, on this repo's own release download address (the launcher's rule)
            url = x.optString("browser_download_url").takeIf { it.startsWith("https://github.com/$REPO/releases/download/") && !it.contains("..") } ?: ""
            digest = x.optString("digest").removePrefix("sha256:").lowercase().takeIf { SHA256.matches(it) } ?: ""
            size = x.optLong("size", 0L).coerceAtLeast(0L)
        }
        return Found(tag.removePrefix("v"), j.optString("name").trim().take(120), has, url, digest, size)
    }

    /** GitHub's download hosts and nowhere else, for every hop of a download (the launcher's rule). */
    fun gitHubHost(host: String) = host == "github.com" || host == "api.github.com" || host.endsWith(".githubusercontent.com")

    /**
     * What `pm install -r` wrote so far: null while it has not finished, "" for Success, else why not:
     * "space" (Android's "App not installed" on a TV short of space), "other_key" (signed with another
     * key), "not_newer" (no newer inside), "failed" (anything else).
     */
    fun installResult(out: String): String? {
        val o = out.trim()
        if (o.isEmpty()) return null
        if (o.lines().any { it.trim() == "Success" }) return ""
        if (!o.contains("Failure") && !o.contains("Error") && !o.contains("Exception")) return null
        return failure(o)
    }

    /** Why an install or a copy to the TV failed, from what Android said. */
    fun failure(msg: String): String = when {
        msg.contains("INSUFFICIENT_STORAGE") || msg.contains("No space left", ignoreCase = true) || msg.contains("ENOSPC") -> "space"
        msg.contains("UPDATE_INCOMPATIBLE") || msg.contains("INCONSISTENT_CERTIFICATES") || msg.contains("NO_CERTIFICATES") || msg.contains("SIGNATURE") -> "other_key"
        msg.contains("VERSION_DOWNGRADE") -> "not_newer"
        else -> "failed"
    }

    /**
     * The shell line that installs the copied file. It runs on the TV apart from this app (setsid,
     * nohup, nothing left open), because Android stops this app while it replaces it, and that closes
     * the app's ADB link. Then it deletes the copy, and on Success opens the app again (reopen: only
     * when Couch TV was on screen, so an update started from a phone never takes over a show).
     */
    fun installScript(pkg: String, reopen: Boolean): String {
        require(Regex("[A-Za-z0-9_.]+").matches(pkg))
        val back = if (reopen) "; grep -q Success $TMP_LOG && am start -n $pkg/.SetupActivity --ez updated true" else ""
        val body = "pm install -r $TMP_APK > $TMP_LOG 2>&1; rm -f $TMP_APK$back"
        return "rm -f $TMP_LOG; \$(command -v setsid) nohup sh -c '$body' > /dev/null 2>&1 < /dev/null &"
    }

    /** Offered: newer than this app, and the release has this app's file. */
    fun offered(latest: String, current: String, hasAsset: Boolean): Boolean = latest.isNotEmpty() && hasAsset && newer(latest, current)

    /** The line above the steps. */
    fun how(watch: Boolean): String =
        if (watch) "This copy of Couch TV has the Home button watch, so it was put on from a computer, and it updates from a computer the same way. Your settings stay."
        else "Couch TV cannot install an update by itself on this TV right now. Put the new version on the same way as before, over this one. Your settings stay."

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
