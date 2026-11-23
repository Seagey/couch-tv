package dev.couchtv.ontv

import java.io.ByteArrayOutputStream
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
 *    redirect (at most three), so a paired phone cannot use the TV to look around the home network.
 *    The connection goes to the address that was checked, never a second lookup (DNS rebinding);
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

    /** The host's addresses when every one is out on the internet (not private, this TV, or a local name), else null. */
    fun publicAddresses(host: String, resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }): List<InetAddress>? {
        val all = try { resolve(host) } catch (e: Exception) { return null }
        if (all.isEmpty()) return null
        val inHouse = all.any { a ->
            a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress ||
                // IPv6 unique local (fc00::/7) and IPv4 shared (100.64/10) and reserved (240/4) ranges
                (a.address.size == 16 && (a.address[0].toInt() and 0xfe) == 0xfc) ||
                (a.address.size == 4 && ((a.address[0].toInt() and 0xff) == 100 && (a.address[1].toInt() and 0xc0) == 64)) ||
                (a.address.size == 4 && (a.address[0].toInt() and 0xff) >= 240) ||
                (a.address.size == 4 && (a.address[0].toInt() and 0xff) == 0)
        }
        return if (inHouse) null else all
    }

    /** True when every address of the host is out on the internet (not private, this TV, or a local name). */
    fun publicHost(host: String, resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }): Boolean =
        publicAddresses(host, resolve) != null

    /** True when the words are a calendar (BEGIN:VCALENDAR near the start). */
    fun isCalendar(text: String) = text.take(2000).contains("BEGIN:VCALENDAR", ignoreCase = true)

    /** One answer: the status, the Location header, the body (null when it was over MAX_BYTES). */
    class Answer(val code: Int, val location: String?, val body: ByteArray?)

    /**
     * Fetches one https link from the address that was checked. The name is looked up once, in read(),
     * and the connection goes to that address: looking it up again on connect would let a name that
     * answered with an internet address the first time answer with one in the house the second time.
     */
    fun interface Fetch { fun get(url: URL, at: InetAddress): Answer }

    /** Reads the calendar. (true, its words) or (false, a short reason that never holds the link). Blocking. */
    fun read(raw: String?, resolve: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() },
             fetch: Fetch = Fetch { u, at -> httpsGet(u, at) }): Pair<Boolean, String> {
        var at = checkUrl(raw) ?: return Pair(false, "not a calendar link")
        for (hop in 0..3) {
            val u = URL(at)
            val addresses = publicAddresses(u.host, resolve) ?: return Pair(false, "that address is not on the internet")
            // every address was checked: try them in order, so one that does not answer (an IPv6 address
            // on a TV with no IPv6, say) does not stop the calendar when the next one works
            var a: Answer? = null
            for (addr in addresses) {
                a = try { fetch.get(u, addr) } catch (e: Exception) { null }
                if (a != null) break
            }
            if (a == null) return Pair(false, "unreachable")
            if (a.code in 300..399) {
                val next = a.location ?: return Pair(false, "http ${a.code}")
                at = checkUrl(try { URL(URL(at), next).toString() } catch (e: Exception) { null }) ?: return Pair(false, "not a calendar link")
                continue
            }
            if (a.code !in 200..299) return Pair(false, "http ${a.code}")
            val body = a.body ?: return Pair(false, "too big")
            val text = String(body, Charsets.UTF_8)
            if (!isCalendar(text)) return Pair(false, "not a calendar")
            return Pair(true, text)
        }
        return Pair(false, "too many redirects")
    }

    /**
     * GET over TLS to the given address, with the link's own name for SNI and the certificate check, so
     * the certificate must still be for that name. HTTP/1.0 and Connection: close, so the answer is plain
     * bytes to the end (a chunked answer is read too, in case a server sends one anyway).
     */
    fun httpsGet(u: URL, at: InetAddress): Answer {
        val port = if (u.port > 0) u.port else 443
        val plain = java.net.Socket()
        try {
            plain.connect(java.net.InetSocketAddress(at, port), 10000)
            plain.soTimeout = 20000
        } catch (e: Exception) { plain.close(); throw e }
        val tls = (javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory)
            .createSocket(plain, u.host, port, true) as javax.net.ssl.SSLSocket
        tls.use { s ->
            s.startHandshake()
            if (!javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(u.host, s.session)) {
                throw java.io.IOException("certificate is not for this name")
            }
            val path = (u.path.ifEmpty { "/" }) + (u.query?.let { "?$it" } ?: "")
            val host = if (u.port > 0 && u.port != 443) "${u.host}:${u.port}" else u.host
            val req = "GET $path HTTP/1.0\r\nHost: $host\r\nAccept: text/calendar, text/plain;q=0.5\r\n" +
                "User-Agent: couch-tv\r\nConnection: close\r\n\r\n"
            s.outputStream.write(req.toByteArray(Charsets.ISO_8859_1))
            s.outputStream.flush()
            return parseAnswer(java.io.BufferedInputStream(s.inputStream))
        }
    }

    /** Reads an HTTP/1.x answer: status line, headers, then the body up to MAX_BYTES. */
    fun parseAnswer(inp: java.io.InputStream): Answer {
        fun line(): String? {
            val b = ByteArrayOutputStream()
            while (true) {
                val c = inp.read()
                if (c < 0) return if (b.size() == 0) null else b.toString("ISO-8859-1")
                if (c == '\n'.code) return b.toString("ISO-8859-1").trimEnd('\r')
                b.write(c)
                if (b.size() > 16384) throw java.io.IOException("header too long")
            }
        }
        val status = line() ?: throw java.io.IOException("no answer")
        val code = Regex("^HTTP/\\d(?:\\.\\d)? (\\d{3})").find(status)?.groupValues?.get(1)?.toInt()
            ?: throw java.io.IOException("not http")
        var location: String? = null
        var chunked = false
        var headers = 0
        while (true) {
            val h = line() ?: break
            if (h.isEmpty()) break
            if (++headers > 200) throw java.io.IOException("too many headers")
            val k = h.substringBefore(':').trim().lowercase()
            val v = h.substringAfter(':', "").trim()
            if (k == "location") location = v
            if (k == "transfer-encoding" && v.lowercase().contains("chunked")) chunked = true
        }
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16384)
        fun copy(limit: Long): Boolean {   // false when over MAX_BYTES
            var left = limit
            while (left > 0) {
                val n = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                if (n < 0) break
                out.write(buf, 0, n)
                left -= n
                if (out.size() > MAX_BYTES) return false
            }
            return true
        }
        if (chunked) {
            while (true) {
                val size = line()?.substringBefore(';')?.trim()?.toLongOrNull(16) ?: break
                if (size == 0L) break
                if (size > MAX_BYTES || !copy(size)) return Answer(code, location, null)
                line()   // the CRLF after each chunk
            }
        } else if (!copy(Long.MAX_VALUE)) return Answer(code, location, null)
        return Answer(code, location, out.toByteArray())
    }
}
