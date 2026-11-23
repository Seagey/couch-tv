package app.couchtv.launcher

import app.couchtv.ha.HaPhone
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * The phone's Home settings page for the Couch TV home app with no computer at home (option A). The
 * on-TV app serves this page from the TV (its Server.kt, /setup), and the home computer serves it for the
 * TVs it runs (bridge/phonepage.py). With neither, this small server on the home Wi-Fi serves the same
 * page (on-tv/web/setup.html, bundled as assets/www/ontv) and the endpoints it needs, with the same
 * pairing as the on-TV app (PhoneAuth: a 6 digit code shown on the TV, then a token).
 *
 *  - Every /api call needs the token, except /api/health (says only whether you are paired), /api/pair and
 *    /api/pair/start. The token is checked before any body is read; a refused upload closes the connection.
 *  - Sizes: 4 KB to pair, 64 KB for any other call, 25 MB for a photo.
 *  - Home settings, At home and a design's widget settings stay in the home page's own store on this TV:
 *    each call is handed to the page (Host.page, app.js tv.phonePage, tv.atHomeRead, tv.atHomeEdit), the
 *    way the on-TV app hands them in. Nothing is sent anywhere else, and no token or code is ever echoed.
 *  - Only while this app is the home with no computer set (MainActivity starts it, alone()).
 *
 * Plain NanoHTTPD and org.json: the Android parts are behind Host, so this is unit tested off a TV.
 */
class PhoneServer(private val host: Host, val auth: PhoneAuth, port: Int) : NanoHTTPD(port) {
    interface Host {
        /** A file bundled in the app (www/ontv/setup.html, www/ontv/shim.js), or null. */
        fun asset(path: String): InputStream?
        /** Runs code in the home page and returns its answer (an object), or null: no page to ask now. */
        fun page(code: String): JSONObject?
        /** Copies a picture into the home's photos (turned, screen size): its file name, or null if it is not one. */
        fun addPhoto(file: File): String?
        fun photo(name: String): File?
        fun deletePhoto(name: String)
        /** Use as home screen: {on, held}. */
        fun homeState(): JSONObject
        /** The pairing code changed (a phone used it, 5 wrong tries threw it away, a new one): the home draws its QR again. */
        fun codeChanged() {}
        /** Shows a code on the home ("Show a code on the TV"); "" takes it off. */
        fun showCode(code: String)
        fun tmpDir(): File
        /**
         * Smart home set up from a phone (/ha, app.couchtv.ha.HaPhone): one request and its reply, or null
         * when it is not one. This server answers it while it runs, so the launcher has one server, not two
         * (HaServer.kt only starts when this one is not running). The Host check and the /ha/done rules are
         * HaPhone's own, the same on every server.
         */
        fun ha(method: String, path: String, query: Map<String, String>, body: String, hostHeader: String?, port: Int): HaPhone.Reply? = null
        /** An installed app's icon as a PNG, for the phone page's apps card (Widgets on your screen), or null. */
        fun appIcon(pkg: String): ByteArray? = null
    }

    class Refused(val status: Int, message: String) : Exception(message)

    @Volatile private var lastPinStart = 0L

    override fun serve(s: IHTTPSession): Response = try {
        val uri = s.uri
        when {
            uri.startsWith("/api/") -> api(s, uri.removeSuffix("/"))
            uri == "/" -> newFixedLengthResponse(Response.Status.REDIRECT, "text/plain", "").apply { addHeader("Location", "/setup") }
            // the page's words in the phone's language, from the home's own files (bundled at www/tv), when this build has them
            WORDS.matches(uri) -> asset("www" + uri, "application/javascript")
            // Widgets on your screen draws each widget with the home's own widget files (and the catalogue's app icons)
            KIT.matches(uri) -> asset("www" + uri, if (uri.endsWith(".css")) "text/css" else if (uri.endsWith(".png")) "image/png" else "application/javascript")
            uri == "/setup" || uri == "/setup/" -> asset("www/ontv/setup.html", "text/html; charset=utf-8")
            uri == "/ontv/shim.js" -> asset("www/ontv/shim.js", "application/javascript")
            uri == "/ha" || uri.startsWith("/ha/") -> ha(s)
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        }
    } catch (e: Refused) {
        json(e.status, err(e.message ?: "error")).also { if (e.status == 401 || e.status == 413) it.closeConnection(true) }
    } catch (e: Exception) {
        json(500, err("That did not work. Try again."))
    }

    // ---------------------------------------------------------------- auth

    // only the header: the page fetches its pictures with it too (setup.html), so the token is never in a cookie,
    // which would go to every other web service on this TV
    @Suppress("UNUSED_PARAMETER")
    private fun tokenOf(s: IHTTPSession, cookieToo: Boolean): String? {
        s.headers["authorization"]?.let { if (it.startsWith("Bearer ", true)) return it.substring(7).trim() }
        return null
    }

    // ---------------------------------------------------------------- API

    private fun api(s: IHTTPSession, path: String): Response {
        val m = s.method
        // open: whether this phone is paired, the code, and asking the TV to show one
        when ("$m $path") {
            "GET /api/health" -> return json(200, ok().put("mode", "launcher").put("auth", if (auth.valid(tokenOf(s, false))) "ok" else "required"))
            "POST /api/pair/start" -> {
                sameSiteOnly(s)
                checkLock()
                val now = System.currentTimeMillis()
                if (now - lastPinStart < 5_000) throw Refused(429, "A code is on the TV already. Wait a moment, then ask again.")
                lastPinStart = now
                // the QR's own code when it has more than 90 s left: asking again and again never kills it
                val before = auth.currentPin()
                val code = auth.pinForQr(90)
                host.showCode(code)
                if (code != before) host.codeChanged()
                return json(200, ok().put("digits", 6).put("expires_in", auth.pinSecondsLeft()).put("note", "The code is on the TV now."))
            }
            "POST /api/pair" -> {
                sameSiteOnly(s)
                // a JSON body only (a plain form from another web page cannot send one), to this TV by its address
                if (s.headers["content-type"]?.substringBefore(';')?.trim()?.lowercase() != "application/json") throw Refused(415, "body must be JSON")
                ownHost(s)
                val b = readJson(s, 4 * 1024)
                checkLock()
                val addr = s.headers["remote-addr"]
                if (auth.addressLimited(addr)) throw Refused(429, "Too many wrong codes from this phone. Wait 10 min, then try again.")
                Thread.sleep(400)   // slows guessing a little more
                val before = auth.currentPin()
                val token = auth.pair(b.optString("pin"), b.optString("name").ifEmpty { null }, addr)
                if (auth.currentPin() != before) host.codeChanged()   // used, or thrown away: the QR never keeps a dead code
                if (token == null) {
                    checkLock()   // this wrong try was the one that locked it
                    throw Refused(401, if (auth.currentPin() == null) "That code has expired. Ask the TV for a new one." else "That code is not right. Check the TV.")
                }
                host.showCode("")
                return json(200, ok().put("token", token))
            }
        }
        // everything else: the token first, before any body is read
        val photoGet = m == Method.GET && path.startsWith("/api/photo/")
        if (!auth.valid(tokenOf(s, photoGet))) throw Refused(401, "pair this phone first: open this page on your phone and type the code from the TV")
        if (m == Method.POST && path == "/api/photos") return addPhoto(s)
        if (m == Method.GET && path.startsWith("/api/appicon/")) {
            val pkg = path.removePrefix("/api/appicon/")
            if (!PKG.matches(pkg)) throw Refused(400, "no such app")
            val png = host.appIcon(pkg) ?: throw Refused(404, "no such app")
            return newFixedLengthResponse(Response.Status.OK, "image/png", java.io.ByteArrayInputStream(png), png.size.toLong()).apply { addHeader("Cache-Control", "private, max-age=86400") }
        }
        if (photoGet) {
            val f = host.photo(path.removePrefix("/api/photo/")) ?: throw Refused(404, "no such photo")
            return newFixedLengthResponse(Response.Status.OK, "image/jpeg", f.inputStream(), f.length()).apply { addHeader("Cache-Control", "no-store") }
        }
        val b = if (m == Method.POST) readJson(s, 64 * 1024) else JSONObject()
        return when ("$m $path") {
            "GET /api/settings" -> json(200, settings(pageOr503("read", null)))
            "POST /api/settings" -> {
                val p = b.optJSONObject("settings_patch")
                b.keys().forEach { k -> if (k != "settings_patch" && k != "tv") throw Refused(400, "$k is not changed from the phone") }
                p ?: throw Refused(400, "settings_patch must be an object")
                checkPatch(p)
                val r = pageOr503("patch", p)
                if (!r.optBoolean("ok")) throw Refused(400, r.optString("error", "That did not save."))
                json(200, settings(pageOr503("read", null)))
            }
            "GET /api/athome" -> {
                val r = host.page("window.tv && tv.atHomeRead ? tv.atHomeRead() : null")
                json(200, if (r == null) ok().put("live", false) else ok().put("live", true).put("athome", r))
            }
            "POST /api/athome" -> {
                val e = b.optJSONObject("edit") ?: throw Refused(400, "edit is required")
                e.keys().forEach { k -> if (k !in EDIT_KEYS) throw Refused(400, "$k is not changed from the phone") }
                val r = host.page("window.tv && tv.atHomeEdit ? tv.atHomeEdit(" + e.toString() + ") : null")
                    ?: throw Refused(409, "Open the Couch TV home on the TV first, then save again.")
                if (!r.optBoolean("ok")) throw Refused(400, r.optString("error", "That did not save."))
                json(200, ok().put("live", true).put("athome", r.optJSONObject("athome") ?: JSONObject()))
            }
            "POST /api/guest" -> {
                if (!b.has("name")) throw Refused(400, "name is required (an empty name clears it)")
                val r = pageOr503("guest", JSONObject.quote(b.optString("name").take(200)), raw = true)
                json(200, ok().put("guest", r.optJSONObject("guest") ?: JSONObject()))
            }
            "POST /api/photos/remove" -> {
                val r = pageOr503("unphoto", JSONObject.quote(b.optString("id").take(64)), raw = true)
                if (!r.optBoolean("ok")) throw Refused(404, "That photo is not on the TV any more.")
                r.optString("file").takeIf { it.isNotEmpty() }?.let { host.deletePhoto(it) }
                json(200, ok().put("count", r.optInt("count")))
            }
            "GET /api/home" -> json(200, ok(host.homeState()).put("fire_tv", false).put("watch", false))
            // the phones paired with this TV, and forgetting them all (each then needs the code from the TV again)
            "GET /api/phones" -> json(200, ok().put("phones", auth.phoneCount()))
            "POST /api/phones/forget" -> { auth.forgetAll(); json(200, ok().put("phones", 0)) }
            else -> json(404, err("no such endpoint: $m $path"))
        }
    }

    /** One photo: the picture itself is the body (up to 25 MB), read as a stream into a file, never into memory. */
    private fun addPhoto(s: IHTTPSession): Response {
        val len = s.headers["content-length"]?.toLongOrNull() ?: 0L
        if (len <= 0) throw Refused(400, "No photo came through. Try again.")
        if (len > MAX_UPLOAD) throw Refused(413, "That photo is too big. Pick one under 25 MB.")
        val tmp = File.createTempFile("phone-upload", ".tmp", host.tmpDir())   // its own file: two uploads at once never share one
        try {
            tmp.outputStream().use { out ->
                val buf = ByteArray(64 * 1024); var left = len
                while (left > 0) {
                    val n = s.inputStream.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) break
                    out.write(buf, 0, n); left -= n
                }
            }
            val name = host.addPhoto(tmp) ?: throw Refused(415, "That is not a photo the TV can read. Send a JPEG or PNG.")
            val r = host.page("window.tv && tv.phonePage ? tv.phonePage('photo', " + JSONObject.quote(name) + ") : null")
            if (r == null || !r.optBoolean("ok")) {
                host.deletePhoto(name)
                throw Refused(if (r == null) 503 else 409, r?.optString("error") ?: "Open the Couch TV home on the TV first, then send the photo again.")
            }
            return json(200, ok().put("photo", r.optJSONObject("photo") ?: JSONObject()).put("count", r.optInt("count")))
        } finally { tmp.delete() }
    }

    /** 15 wrong codes in 10 minutes: every way to pair answers 429 for 10 minutes (the on-TV app's rule). */
    private fun checkLock() {
        val left = auth.lockedFor()
        if (left > 0) throw Refused(429, "Too many wrong codes. Wait ${maxOf(1, (left + 59) / 60)} min, then try again.")
    }

    /** The code calls answer the page itself (its own http address) or a client with no Origin, never Origin null or
     *  file:, which any web page can send from a sandboxed frame (nothing on a TV pairs here by code). */
    /** The Host the request names is an IP address (the TV's, from its QR) or the TV's own address, never a name: a
     *  web page that points a name of its own at the TV (DNS rebinding) cannot reach pairing. */
    private fun ownHost(s: IHTTPSession) {
        val h = s.headers["host"]?.trim()?.lowercase() ?: throw Refused(403, "forbidden host")
        val name = if (h.startsWith("[")) h.substringAfter('[').substringBefore(']') else h.substringBeforeLast(':').takeIf { h.count { it == ':' } == 1 } ?: h
        val ip4 = Regex("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})").matchEntire(name)?.groupValues?.drop(1)?.all { it.toInt() <= 255 } == true
        val ip6 = h.startsWith("[") && name.isNotEmpty() && name.all { it.isDigit() || it in 'a'..'f' || it == ':' || it == '.' }
        if (!ip4 && !ip6 && name != lanAddress()) throw Refused(403, "forbidden host")
    }

    private fun sameSiteOnly(s: IHTTPSession) {
        val o = s.headers["origin"]?.trim()?.lowercase() ?: return
        if (o.isNotEmpty() && !o.startsWith("http://") && !o.startsWith("https://")) throw Refused(403, "forbidden origin")
    }

    /** The phone may change only the town (Server.kt PATCH_KEYS), checked the same way. */
    private fun checkPatch(p: JSONObject) {
        val keys = p.keys().asSequence().toList()
        if (keys.isEmpty()) throw Refused(400, "settings_patch must name a setting")
        keys.forEach { k -> if (k !in PATCH_KEYS) throw Refused(400, "$k is not changed from the phone") }
        if (!p.isNull("place")) {
            val pl = p.opt("place") as? JSONObject ?: throw Refused(400, "place must be an object or null")
            val lat = pl.optDouble("lat", Double.NaN); val lon = pl.optDouble("lon", Double.NaN)
            if (lat.isNaN() || lon.isNaN() || lat !in -90.0..90.0 || lon !in -180.0..180.0 || pl.optString("name").isBlank())
                throw Refused(400, "place needs a name, and lat and lon as numbers")
        }
    }

    private fun settings(r: JSONObject): JSONObject = ok().put("mode", "launcher")
        .put("settings", r.optJSONObject("settings") ?: JSONObject()).put("people", r.optJSONArray("people") ?: org.json.JSONArray())
        .put("weather", r.optJSONObject("weather") ?: JSONObject.NULL)

    /** Asks the page's tv.phonePage(op, arg): arg is JSON (an object), or already a JS string when raw. */
    private fun pageOr503(op: String, arg: Any?, raw: Boolean = false): JSONObject {
        val a = when { arg == null -> "null"; raw -> arg.toString(); else -> arg.toString() }
        return host.page("window.tv && tv.phonePage ? tv.phonePage('" + op + "', " + a + ") : null")
            ?: throw Refused(503, "Open the Couch TV home on the TV first, then try again.")
    }

    // ---------------------------------------------------------------- smart home from a phone

    /** /ha: open like /api/pair (the key from the TV's Smart home QR code is the pass), at most 64 KB a body. */
    private fun ha(s: IHTTPSession): Response {
        val len = s.headers["content-length"]?.toIntOrNull() ?: 0
        if (len > 64 * 1024) throw Refused(413, "request too large")
        val buf = ByteArray(maxOf(0, len))
        var read = 0
        while (read < len) { val n = s.inputStream.read(buf, read, len - read); if (n < 0) break; read += n }
        val q = s.parameters.mapValues { it.value.firstOrNull() ?: "" }
        val r = host.ha(s.method.name, s.uri, q, String(buf, 0, read, Charsets.UTF_8), s.headers["host"], listeningPort)
            ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        return newFixedLengthResponse(Code(r.status), r.type, r.body.inputStream(), r.body.size.toLong()).apply {
            r.location?.let { addHeader("Location", it) }
            addHeader("Cache-Control", "no-store")
            addHeader("Referrer-Policy", "no-referrer")
            addHeader("X-Content-Type-Options", "nosniff")
        }
    }

    // ---------------------------------------------------------------- helpers

    private fun readJson(s: IHTTPSession, max: Int): JSONObject {
        val len = s.headers["content-length"]?.toIntOrNull() ?: 0
        if (len <= 0) return JSONObject()
        if (len > max) throw Refused(413, "request too large")
        val buf = ByteArray(len)
        var read = 0
        while (read < len) { val n = s.inputStream.read(buf, read, len - read); if (n < 0) break; read += n }
        val text = String(buf, 0, read, Charsets.UTF_8).trim()
        if (text.isEmpty()) return JSONObject()
        return try { JSONObject(text) } catch (e: Exception) { throw Refused(400, "body must be JSON") }
    }

    private fun asset(path: String, type: String): Response {
        val i = host.asset(path) ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        return newChunkedResponse(Response.Status.OK, type, i).apply { addHeader("Cache-Control", "no-cache") }
    }

    private fun ok(from: JSONObject? = null): JSONObject = (from ?: JSONObject()).put("ok", true)
    private fun err(msg: String) = JSONObject().put("ok", false).put("error", msg)

    private fun json(status: Int, o: JSONObject): Response =
        newFixedLengthResponse(Code(status), "application/json", o.toString()).apply { addHeader("Cache-Control", "no-store") }

    private class Code(private val code: Int) : Response.IStatus {
        override fun getRequestStatus() = code
        override fun getDescription() = "$code " + when (code) { 200 -> "OK"; 302 -> "Found"; 403 -> "Forbidden"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"
            409 -> "Conflict"; 413 -> "Payload Too Large"; 415 -> "Unsupported Media Type"; 429 -> "Too Many Requests"; 503 -> "Service Unavailable"; else -> "Status" }
    }

    /** For the home's Home settings QR and Hold OK, Edit on your phone (MainActivity's TV.phoneLink). */
    fun link(address: String?): JSONObject? {
        if (address == null || !wasStarted() || auth.lockedFor() > 0) return null   // locked: no QR with a dead code
        return JSONObject().put("url", "http://$address:$listeningPort/setup#pin=" + auth.pinForQr()).put("pin_expires_in", auth.pinSecondsLeft())
    }

    companion object {
        const val PORT = 5400
        const val MAX_UPLOAD = 25L * 1024 * 1024
        private val PATCH_KEYS = setOf("place")
        private val WORDS = Regex("/tv/(phone-words|caps-words)\\.js")
        private val KIT = Regex("/tv/((icon-sets|app-catalogue|widget-words|widget-lines|widgets|widget-caps|qr)\\.js|widgets\\.css|app-icons/[a-z0-9_.-]{1,40}\\.png)")
        private val PKG = Regex("[A-Za-z0-9_.]{3,120}")
        private val EDIT_KEYS = setOf("note", "lists", "wifi", "guide", "cal_url", "stay_url", "checkin", "checkout", "widget_set", "design_apps")

        /** This TV's address on the home network (IPv4, not the TV itself), or null when it has none. */
        fun lanAddress(): String? = runCatching {
            NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>()
                .firstOrNull { it.isSiteLocalAddress }?.hostAddress
        }.getOrNull()
    }
}
