package app.couchtv.launcher

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URL
import java.nio.file.Files

/**
 * The phone's Home settings page on the Couch TV home app with no computer (PhoneServer.kt), over a real
 * socket: pairing with the code, the token checked before any body, the size limits, what the phone may
 * change, and that each change is handed to the home page (a stand-in here) and never echoes a secret.
 */
class PhoneServerTest {
    private class FakeHost : PhoneServer.Host {
        val codes = mutableListOf<String>()
        val shown = mutableListOf<String>()
        val photos = mutableMapOf<String, File>()
        val deleted = mutableListOf<String>()
        var answer: (String) -> JSONObject? = { null }
        val dir: File = Files.createTempDirectory("phonepage").toFile()
        override fun asset(path: String) = when (path) {
            "www/ontv/setup.html" -> ByteArrayInputStream("<title>Home settings</title><script src=\"/ontv/shim.js\"></script>".toByteArray())
            "www/ontv/shim.js" -> ByteArrayInputStream("// shim".toByteArray())
            else -> null
        }
        override fun page(code: String): JSONObject? { codes += code; return answer(code) }
        override fun addPhoto(file: File): String? {
            val b = file.readBytes()
            if (b.size < 3 || b[0] != 0xFF.toByte() || b[1] != 0xD8.toByte()) return null   // a JPEG's first bytes
            val f = File(dir, "p1.jpg").also { it.writeBytes(b) }
            photos[f.name] = f
            return f.name
        }
        override fun photo(name: String) = photos[name]
        override fun deletePhoto(name: String) { deleted += name; photos.remove(name)?.delete() }
        override fun homeState(): JSONObject = JSONObject().put("on", true).put("held", false)
        override fun showCode(code: String) { shown += code }
        override fun tmpDir() = dir
        // smart home set up from a phone on this same server: HaPhone's own rules, with no Android context
        override fun ha(method: String, path: String, query: Map<String, String>, body: String, hostHeader: String?, port: Int) =
            app.couchtv.ha.HaPhone.handleFor(null, method, path, query, body, hostHeader, port) { name ->
                if (name == "ha-phone.html") "<title>Smart home</title>".toByteArray() else null
            }
    }

    private class MapStore : PhoneAuth.Store {
        val m = HashMap<String, String>()
        override fun get(key: String) = m[key]
        override fun put(key: String, value: String?) { if (value == null) m.remove(key) else m[key] = value }
    }

    private lateinit var host: FakeHost
    private lateinit var store: MapStore
    private lateinit var srv: PhoneServer
    private var port = 0

    @Before fun up() {
        host = FakeHost(); store = MapStore()
        srv = PhoneServer(host, PhoneAuth(store), 0)
        srv.start(5000, true)
        port = srv.listeningPort
    }

    @After fun down() { srv.stop(); app.couchtv.ha.HaPhone.stop() }

    private class Answer(val status: Int, val body: String) { val json get() = JSONObject(body) }

    private fun call(method: String, path: String, body: String? = null, token: String? = null, type: String = "application/json",
                     cookie: String? = null, raw: ByteArray? = null): Answer {
        val c = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        c.requestMethod = method
        token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
        cookie?.let { c.setRequestProperty("Cookie", it) }
        val bytes = raw ?: body?.toByteArray()
        if (bytes != null) { c.doOutput = true; c.setRequestProperty("Content-Type", type); c.outputStream.use { it.write(bytes) } }
        val status = c.responseCode
        val text = (if (status >= 400) c.errorStream else c.inputStream)?.bufferedReader()?.readText() ?: ""
        return Answer(status, text)
    }

    private fun paired(): String {
        val pin = srv.auth.pinForQr()
        val a = call("POST", "/api/pair", "{\"pin\":\"$pin\",\"name\":\"iPhone\"}")
        assertEquals(200, a.status)
        return a.json.getString("token")
    }

    // ---- pairing

    @Test fun pairWithTheCodeOnce() {
        val pin = srv.auth.pinForQr()
        val wrong = if (pin == "000000") "111111" else "000000"
        val bad = call("POST", "/api/pair", "{\"pin\":\"$wrong\"}")
        assertEquals(401, bad.status)
        assertFalse(bad.json.has("token"))
        assertTrue(bad.json.getString("error").contains("not right"))
        val good = call("POST", "/api/pair", "{\"pin\":\"$pin\"}")
        assertEquals(200, good.status)
        assertEquals(64, good.json.getString("token").length)
        assertFalse(store.m.values.joinToString().contains(good.json.getString("token")))   // only its hash is kept
        val again = call("POST", "/api/pair", "{\"pin\":\"$pin\"}")
        assertEquals(401, again.status)
        assertTrue(again.json.getString("error").contains("expired"))
        assertEquals(listOf(""), host.shown)   // the code line comes off the home once used
    }

    @Test fun fiveWrongThrowTheCodeAway() {
        var now = 1_000L
        val a = PhoneAuth(MapStore()) { now }
        val pin = a.newPin()
        val wrong = if (pin == "000000") "111111" else "000000"
        repeat(5) { assertNull(a.pair(wrong, null)) }
        assertNull(a.currentPin())
        assertNull(a.pair(pin, null))
        val p2 = a.newPin(); now += PhoneAuth.PIN_MS + 1
        assertNull(a.pair(p2, null))   // run out after 3 minutes
    }

    @Test fun fifteenWrongLockPairing() {
        repeat(14) { srv.auth.newPin(); assertEquals(401, call("POST", "/api/pair", "{\"pin\":\"abc\"}").status) }
        assertEquals(429, call("POST", "/api/pair", "{\"pin\":\"abc\"}").status)   // the 15th locks it
        val pin = srv.auth.newPin()
        val a = call("POST", "/api/pair", "{\"pin\":\"$pin\"}")
        assertEquals(429, a.status)
        assertFalse(a.json.has("token"))
        assertEquals(429, call("POST", "/api/pair/start").status)
        assertNull(srv.link("192.0.2.7"))   // no QR with a code that cannot work
        srv.auth.lock.reset()
        assertEquals(200, call("POST", "/api/pair", "{\"pin\":\"$pin\"}").status)
    }

    @Test fun qrReusesALiveCode() {
        var now = 1_000L
        val a = PhoneAuth(MapStore()) { now }
        val p = a.pinForQr()
        now += 60_000; assertEquals(p, a.pinForQr())
        now += 100_000; assertFalse(p == a.pinForQr())   // 20 s left: a new one
    }

    @Test fun showACodeOnTheTv() {
        val a = call("POST", "/api/pair/start")
        assertEquals(200, a.status)
        assertFalse(Regex("\\d{6}").containsMatchIn(a.body))   // the code only ever shows on the TV
        assertEquals(listOf(srv.auth.currentPin()), host.shown)
        assertEquals(429, call("POST", "/api/pair/start").status)
    }

    @Test fun healthSaysOnlyWhetherPaired() {
        assertEquals("required", call("GET", "/api/health").json.getString("auth"))
        val t = paired()
        val h = call("GET", "/api/health", token = t)
        assertEquals("ok", h.json.getString("auth"))
        assertEquals("launcher", h.json.getString("mode"))
        assertFalse(h.body.contains(t))
    }

    @Test fun linkForTheQr() {
        val j = srv.link("192.0.2.7")!!
        assertTrue(j.getString("url").matches(Regex("http://192\\.0\\.2\\.7:$port/setup#pin=\\d{6}")))
        assertEquals(srv.auth.currentPin(), j.getString("url").takeLast(6))
        assertNull(srv.link(null))
    }

    // ---- the token before any body, sizes

    @Test fun everyCallNeedsTheToken() {
        for (p in listOf("/api/settings", "/api/athome", "/api/home", "/api/photo/p1.jpg")) assertEquals(p, 401, call("GET", p).status)
        assertEquals(401, call("POST", "/api/athome", "{\"edit\":{\"note\":{\"text\":\"hi\"}}}").status)
        assertEquals(401, call("GET", "/api/settings", token = "not-a-token").status)
        assertTrue(host.codes.isEmpty())   // the home page was never asked
    }

    @Test fun photoWithoutTokenRefusedUnread() {
        // the headers say 20 MB is coming; only a little is sent, and the answer comes at once
        Socket("127.0.0.1", port).use { s ->
            s.soTimeout = 5000
            s.getOutputStream().write(("POST /api/photos HTTP/1.1\r\nHost: tv\r\nContent-Type: image/jpeg\r\nContent-Length: 20000000\r\n\r\n").toByteArray() + ByteArray(1000))
            val head = s.getInputStream().bufferedReader().readLine()
            assertTrue(head, head.contains("401"))
        }
        assertTrue(host.photos.isEmpty())
        assertFalse(File(host.dir, "phone-upload.tmp").exists())
    }

    @Test fun photoTooBigRefusedBeforeReading() {
        val t = paired()
        Socket("127.0.0.1", port).use { s ->
            s.soTimeout = 5000
            s.getOutputStream().write(("POST /api/photos HTTP/1.1\r\nHost: tv\r\nAuthorization: Bearer $t\r\nContent-Type: image/jpeg\r\nContent-Length: ${26L * 1024 * 1024}\r\n\r\n").toByteArray())
            assertTrue(s.getInputStream().bufferedReader().readLine().contains("413"))
        }
    }

    @Test fun bigJsonRefused() {
        val t = paired()
        val a = call("POST", "/api/athome", "{\"edit\":{\"note\":{\"text\":\"" + "x".repeat(70_000) + "\"}}}", token = t)
        assertEquals(413, a.status)
        assertTrue(host.codes.isEmpty())
    }

    // ---- settings: the town only, handed to the page

    @Test fun settingsPatchChecked() {
        val t = paired()
        host.answer = { c -> if (c.contains("'read'")) JSONObject().put("ok", true).put("settings", JSONObject()) else JSONObject().put("ok", true) }
        for (b in listOf("{\"settings_patch\":{\"look\":\"night\"}}", "{\"settings_patch\":{\"place\":\"Hobart\"}}",
            "{\"settings_patch\":{\"place\":{\"name\":\"x\",\"lat\":95,\"lon\":0}}}", "{\"settings_patch\":{\"place\":{\"name\":\"\",\"lat\":1,\"lon\":1}}}",
            "{\"settings_patch\":{}}", "{\"tv_name\":\"Lounge\"}", "{\"settings\":{\"look\":\"night\"}}", "{\"ask_key\":\"sk-secret\"}")) {
            val a = call("POST", "/api/settings", b, token = t)
            assertEquals(b, 400, a.status)
            assertFalse(a.body.contains("sk-secret"))
        }
        assertTrue(host.codes.isEmpty())
        val a = call("POST", "/api/settings", "{\"settings_patch\":{\"place\":{\"name\":\"Hobart\",\"area\":\"Tasmania, Australia\",\"lat\":-42.88,\"lon\":147.33,\"timezone\":\"Australia/Hobart\"}}}", token = t)
        assertEquals(200, a.status)
        assertEquals("launcher", a.json.getString("mode"))
        assertTrue(host.codes[0], host.codes[0].startsWith("window.tv && tv.phonePage ? tv.phonePage('patch', {") && host.codes[0].contains("\"Hobart\""))
    }

    @Test fun settingsWithNoPage() {
        val t = paired()
        assertEquals(503, call("GET", "/api/settings", token = t).status)
    }

    // ---- At home and widget settings: the page's own tv.atHomeRead and tv.atHomeEdit

    @Test fun atHomeHandedToThePage() {
        val t = paired()
        assertEquals(false, call("GET", "/api/athome", token = t).json.getBoolean("live"))
        assertEquals(409, call("POST", "/api/athome", "{\"edit\":{\"note\":{\"text\":\"hi\"}}}", token = t).status)
        host.answer = { c -> if (c.contains("atHomeEdit")) JSONObject().put("ok", true).put("athome", JSONObject().put("note", JSONObject().put("text", "Dinner at 6")))
            else JSONObject().put("note", JSONObject.NULL) }
        val r = call("GET", "/api/athome", token = t)
        assertTrue(r.json.getBoolean("live"))
        val e = call("POST", "/api/athome", "{\"edit\":{\"widget_set\":{\"key\":\"w|surf\",\"values\":{\"units\":\"ft\"}}}}", token = t)
        assertEquals(200, e.status)
        assertTrue(host.codes.last().contains("tv.atHomeEdit({\"widget_set\":{"))
        host.answer = { JSONObject().put("ok", false).put("error", "That number is out of range.") }
        val bad = call("POST", "/api/athome", "{\"edit\":{\"design_apps\":{\"key\":\"a\",\"apps\":[]}}}", token = t)
        assertEquals(400, bad.status)
        assertEquals("That number is out of range.", bad.json.getString("error"))
        assertEquals(400, call("POST", "/api/athome", "{\"edit\":{\"ask_key\":\"sk-1\"}}", token = t).status)
    }

    @Test fun guestName() {
        val t = paired()
        host.answer = { JSONObject().put("ok", true).put("guest", JSONObject().put("name", "Sam")) }
        val a = call("POST", "/api/guest", "{\"name\":\"Sam\"}", token = t)
        assertEquals("Sam", a.json.getJSONObject("guest").getString("name"))
        assertTrue(host.codes.last().contains("tv.phonePage('guest', \"Sam\")"))
    }

    // ---- photos

    @Test fun photoAddedShownAndRemoved() {
        val t = paired()
        host.answer = { c -> when {
            c.contains("'photo'") -> JSONObject().put("ok", true).put("photo", JSONObject().put("id", "x1").put("file", "p1.jpg")).put("count", 1)
            c.contains("'unphoto'") -> JSONObject().put("ok", true).put("file", "p1.jpg").put("count", 0)
            else -> null
        } }
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 1, 2, 3)
        val a = call("POST", "/api/photos", token = t, type = "image/jpeg", raw = jpeg)
        assertEquals(a.body, 200, a.status)
        assertEquals("p1.jpg", a.json.getJSONObject("photo").getString("file"))
        assertFalse(File(host.dir, "phone-upload.tmp").exists())
        // shown with the page's cookie, and only pictures take the cookie
        assertEquals(200, call("GET", "/api/photo/p1.jpg", cookie = "couchtv_token=$t").status)
        assertEquals(401, call("GET", "/api/athome", cookie = "couchtv_token=$t").status)
        assertEquals(404, call("GET", "/api/photo/..%2Fsecret.jpg", token = t).status)
        val r = call("POST", "/api/photos/remove", "{\"id\":\"x1\"}", token = t)
        assertEquals(200, r.status)
        assertEquals(listOf("p1.jpg"), host.deleted)
    }

    @Test fun notAPhotoOrNoRoom() {
        val t = paired()
        assertEquals(415, call("POST", "/api/photos", token = t, type = "image/jpeg", raw = "hello".toByteArray()).status)
        host.answer = { JSONObject().put("ok", false).put("error", "The TV holds 50 photos. Remove one first.") }
        val a = call("POST", "/api/photos", token = t, type = "image/jpeg", raw = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 9))
        assertEquals(409, a.status)
        assertEquals(listOf("p1.jpg"), host.deleted)   // the copy is not left behind
    }

    // ---- the page itself

    @Test fun pageServed() {
        val a = call("GET", "/setup")
        assertEquals(200, a.status)
        assertTrue(a.body.contains("/ontv/shim.js"))
        assertEquals(200, call("GET", "/ontv/shim.js").status)
        assertEquals(404, call("GET", "/ontv/other.js").status)
        assertNotNull(call("GET", "/api/home", token = paired()).json.optBoolean("on"))
    }

    // ---- smart home set up from a phone (/ha) on this same server: one launcher server, not two

    /** One raw request with the Host header given (HttpURLConnection will not send another): status line and headers. */
    private fun rawGet(path: String, hostHeader: String?): Pair<Int, Map<String, String>> =
        Socket("127.0.0.1", port).use { s ->
            s.soTimeout = 5000
            s.getOutputStream().write(("GET $path HTTP/1.1\r\n" + (hostHeader?.let { "Host: $it\r\n" } ?: "") + "Connection: close\r\n\r\n").toByteArray())
            val lines = s.getInputStream().bufferedReader().readLines()
            val status = lines.first().split(' ')[1].toInt()
            status to lines.drop(1).takeWhile { it.isNotEmpty() }.associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
        }

    @Test fun smartHomeSetUpIsServedHereWithItsHostCheck() {
        val (ok, h) = rawGet("/ha/", "127.0.0.1:$port")
        assertEquals(200, ok)
        assertEquals("no-store", h["cache-control"]); assertEquals("no-referrer", h["referrer-policy"]); assertEquals("nosniff", h["x-content-type-options"])
        assertEquals("<title>Smart home</title>", call("GET", "/ha/").body)
        assertEquals(200, rawGet("/ha", "example.local:$port").first)
        assertEquals(403, rawGet("/ha/", "evil.example:$port").first)      // a name a web page points at the TV
        assertEquals(403, rawGet("/ha/", "127.0.0.1:" + (port + 1)).first)  // another port
        assertEquals(403, rawGet("/ha/", null).first)
        assertEquals(403, rawGet("/ha/api/state?k=x", "evil.example:$port").first)
        // the phone page's own pages are not touched by it
        assertEquals(200, call("GET", "/setup").status)
    }

    @Test fun itListensOnTheOneAddressItIsGivenOnly() {
        // the Couch TV home binds the home network address (MainActivity.startPhonePage); here loopback stands in
        val other = java.net.NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.filterIsInstance<java.net.Inet4Address>().firstOrNull()?.hostAddress
        val one = PhoneServer(host, PhoneAuth(store), 0, "127.0.0.1")
        one.start(5000, true)
        try {
            val p = one.listeningPort
            Socket("127.0.0.1", p).close()   // reached on the address it was given
            if (other != null) {
                val refused = runCatching { Socket().use { it.connect(java.net.InetSocketAddress(other, p), 1000) } }.isFailure
                assertTrue("not reachable on $other:$p", refused)
            }
        } finally { one.stop() }
    }

    @Test fun aFailedReturnFromHomeAssistantNeverCarriesTheKeyHereEither() {
        val key = app.couchtv.ha.HaPhone.startForTest("203.0.113.50", port)
        for (q in listOf("", "?code=x", "?code=x&state=forged", "?code=x&state=")) {
            val (status, h) = rawGet("/ha/done$q", "127.0.0.1:$port")
            assertEquals(302, status)
            assertEquals("/ha/?e=expired", h["location"])
            assertFalse(h.values.joinToString().contains(key))
        }
        assertEquals(403, call("GET", "/ha/api/state?k=wrong").status)
        assertTrue(call("GET", "/ha/api/devices?k=$key").status in 400..499)   // no Android here: refused, never served
    }

    @Test fun theSmallSetUpServerNeverTakesThePhonePagesPort() {
        assertFalse(PhoneServer.PORT in HaServer.PORTS)
        assertFalse(PhoneServer.PORT + 1 in HaServer.PORTS)
        assertEquals(8, HaServer.PORTS.count())
    }
}
