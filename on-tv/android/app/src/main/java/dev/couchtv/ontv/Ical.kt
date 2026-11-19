package dev.couchtv.ontv

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL

/**
 * The bookings and Agenda calendars for the home on this TV (POST /api/calendar), so a phone only
 * install greets guests with no computer at home. The home page cannot read an Airbnb, Google or
 * Outlook calendar by itself (those sites let no other page read them), so it hands the private link
 * here and this reads it, the way the computer at home does (bridge/agenda.py) and the TV home app does
 * (AtHome.kt). Same rules as both:
 *  - only https, no name or password inside the link, no spaces, at most 2000 characters; a calendar
 *    app's own link (its scheme ends in "cal") is read as https;
 *  - only a host out on the internet: nothing in this house and not this TV, checked again on every
 *    redirect (at most three), so a paired phone cannot use the TV to look around the home network;
 *  - at most 4 MB, and only an answer that is a calendar.
 * The link is a password (it opens the calendar): it is never written down or logged here.
 */
object Ical {
    private const val MAX_BYTES = 4 * 1024 * 1024
    private const val URL_MAX = 2000

    /** The link to read (a calendar app's own link as https), or null when it may not be read. */
    fun checkUrl(raw: String?): String? {
        var u = raw?.trim() ?: return null
        Regex("^[a-z]+cals?://", RegexOption.IGNORE_CASE).find(u)?.let { u = "https://" + u.substring(it.range.last + 1) }
        if (u.length > URL_MAX || u.any { it.isWhitespace() }) return null
        val p = try { URL(u) } catch (e: Exception) { return null }
        if (!p.protocol.equals("https", true) || p.host.isNullOrEmpty() || p.userInfo != null) return null
        return u
    }

    /** True when every address of the host is out on the internet (not private, this TV, or a local name). */
    fun publicHost(host: String, resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }): Boolean {
        val all = try { resolve(host) } catch (e: Exception) { return false }
        if (all.isEmpty()) return false
        return all.none { a ->
            a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress ||
                // IPv6 unique local (fc00::/7) and IPv4 shared (100.64/10) and reserved (240/4) ranges
                (a.address.size == 16 && (a.address[0].toInt() and 0xfe) == 0xfc) ||
                (a.address.size == 4 && ((a.address[0].toInt() and 0xff) == 100 && (a.address[1].toInt() and 0xc0) == 64)) ||
                (a.address.size == 4 && (a.address[0].toInt() and 0xff) >= 240) ||
                (a.address.size == 4 && (a.address[0].toInt() and 0xff) == 0)
        }
    }

    /** True when the words are a calendar (BEGIN:VCALENDAR near the start). */
    fun isCalendar(text: String) = text.take(2000).contains("BEGIN:VCALENDAR", ignoreCase = true)

    /** Reads the calendar. (true, its words) or (false, a short reason that never holds the link). Blocking. */
    fun read(raw: String?, resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }): Pair<Boolean, String> {
        var at = checkUrl(raw) ?: return Pair(false, "not a calendar link")
        for (hop in 0..3) {
            val u = URL(at)
            if (!publicHost(u.host, resolve)) return Pair(false, "that address is not on the internet")
            val c = try { u.openConnection() as HttpURLConnection } catch (e: Exception) { return Pair(false, "unreachable") }
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = 10000; c.readTimeout = 20000; c.useCaches = false
                c.setRequestProperty("Accept", "text/calendar, text/plain;q=0.5")
                val code = c.responseCode
                if (code in 300..399) {
                    val next = c.getHeaderField("Location") ?: return Pair(false, "http $code")
                    at = checkUrl(URL(URL(at), next).toString()) ?: return Pair(false, "not a calendar link")
                    continue
                }
                if (code !in 200..299) return Pair(false, "http $code")
                val out = ByteArrayOutputStream()
                c.inputStream.use { inp ->
                    val buf = ByteArray(16384)
                    while (true) {
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > MAX_BYTES) return Pair(false, "too big")
                    }
                }
                val text = out.toString("UTF-8")
                if (!isCalendar(text)) return Pair(false, "not a calendar")
                return Pair(true, text)
            } catch (e: Exception) {
                return Pair(false, "unreachable")
            } finally { c.disconnect() }
        }
        return Pair(false, "too many redirects")
    }
}
