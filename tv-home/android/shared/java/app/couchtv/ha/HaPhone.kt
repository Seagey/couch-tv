package app.couchtv.ha

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.security.MessageDigest

/**
 * Smart home set up from a phone. The TV's Smart home screen shows a QR code for
 * http://<tv-ip>:<port>/ha/?k=<key>; the phone page served here (tv-home/web/ha-phone.html) picks
 * the Home Assistant found on the Wi-Fi (HaFind.kt) or a typed address, sends the phone to Home
 * Assistant's own sign in page, and comes back to /ha/done, where the TV swaps the one time code
 * for its tokens (HaAuth.kt). Then the phone ticks what shows and saves; the TV redraws.
 *
 * Server agnostic: the on-TV app's server (Server.kt) and the launcher's small server (HaServer.kt)
 * both pass requests under /ha here. Every /ha/api call needs the key from the QR code, which is
 * 128 random bits, made fresh each time the screen opens on the TV and good for 30 minutes. The
 * phone only ever gets names and entity ids: never a token, never the TV's store.
 */
object HaPhone {
    class Reply(val status: Int, val type: String, val body: ByteArray, val location: String? = null)

    private class Pending(val state: String, val verifier: String, val base: String, val client: String, val at: Long)
    private class Session(val key: String, val port: Int, val tvIp: String?, val until: Long) {
        @Volatile var found: List<HaFind.Found> = emptyList()
        @Volatile var scanning = true
        @Volatile var seen = false      // a phone opened the page
        @Volatile var pending: Pending? = null
    }

    private const val LIFE_MS = 30 * 60_000L
    private const val SIGN_IN_MS = 10 * 60_000L
    @Volatile private var cur: Session? = null

    /** Called when a phone signed in, saved or disconnected, so the TV can redraw at once. */
    @Volatile var onChange: (() -> Unit)? = null

    // tests swap these
    internal var scanner: (Context) -> List<HaFind.Found> = { HaFind.scan(it) }
    internal var now: () -> Long = { System.currentTimeMillis() }
    internal var ownAddresses: () -> Set<String> = { own() }
    internal var keepSignIn: (Context?, String, HaAuth.Tokens, String) -> Boolean = { c, b, t, cl -> c != null && HomeAssistant.keepSignIn(c, b, t, cl) }

    /** Tests: a set up session as start() makes it, with no Wi-Fi look; its key. */
    internal fun startForTest(tvIp: String?, port: Int): String {
        val s = Session(HaAuth.randomKey(16), port, tvIp, now() + LIFE_MS).apply { scanning = false }
        cur = s
        return s.key
    }

    /** This device's own IPv4 addresses, on every interface that is up. */
    private fun own(): Set<String> = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp }
            .flatMap { it.inetAddresses.toList() }.filterIsInstance<java.net.Inet4Address>().mapNotNull { it.hostAddress }.toSet()
    } catch (e: Exception) { emptySet() }

    /**
     * Opens (or keeps) the set up for a phone: { ok, url, seen } plus what is kept now (status).
     * Repeating it while the screen is open keeps the same key, so the QR code does not change.
     */
    fun start(ctx: Context, tvIp: String?, port: Int): JSONObject {
        val app = ctx.applicationContext
        var s = cur
        if (s == null || s.until < now() + 60_000 || s.port != port || (tvIp != null && s.tvIp != tvIp)) {
            s = Session(HaAuth.randomKey(16), port, tvIp, now() + LIFE_MS)
            cur = s
            val mine = s
            Thread {
                val f = try { scanner(app) } catch (e: Exception) { emptyList() }
                mine.found = f; mine.scanning = false
            }.apply { isDaemon = true }.start()
        }
        val out = HomeAssistant.status(app).put("ok", tvIp != null).put("seen", s.seen)
        if (tvIp != null) out.put("url", "http://$tvIp:$port/ha/?k=${s.key}") else out.put("error", "network")
        return out
    }

    /** The TV left the screen for good (Disconnect, or the app stops): the key stops working. */
    fun stop() { cur = null }

    private fun live(k: String?): Session? {
        val s = cur ?: return null
        if (k == null || s.until < now()) return null
        return if (MessageDigest.isEqual(k.toByteArray(), s.key.toByteArray())) s else null
    }

    private val PRIVATE = Regex("(10\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}")
    private val HOST = Regex("(\\d{1,3}(\\.\\d{1,3}){3}):(\\d{1,5})")
    // a Host header this server answers: a number address or a .local name, with the port
    private val HOST_OK = Regex("(\\d{1,3}(\\.\\d{1,3}){3}|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.local):(\\d{1,5})", RegexOption.IGNORE_CASE)

    /**
     * Only a request made to this TV by its number address or a .local name, on this server's port, is
     * answered (a web page elsewhere cannot point a name of its own at the TV and use the set up).
     */
    internal fun hostOk(host: String?, port: Int?): Boolean {
        val m = HOST_OK.matchEntire(host?.trim() ?: "") ?: return false
        return port == null || m.groupValues.last().toIntOrNull() == port
    }

    /**
     * The client id: the TV's own address as the phone reached it (the Host header), only when that is
     * one of this device's own home network addresses on this server's port; else the TV's address.
     * Pure but for [own], for tests.
     */
    internal fun clientFor(host: String?, tvIp: String?, port: Int, own: Set<String> = ownAddresses()): String? {
        HOST.matchEntire(host?.trim() ?: "")?.let { m ->
            val ip = m.groupValues[1]
            if (PRIVATE.matches(ip) && ip in own && m.groupValues[3].toIntOrNull() == port) return "http://$ip:$port/"
        }
        return tvIp?.takeIf { PRIVATE.matches(it) }?.let { "http://$it:$port/" }
    }

    private fun json(o: JSONObject, status: Int = 200) = Reply(status, "application/json", o.toString().toByteArray())
    private fun fail(error: String, status: Int = 200) = json(JSONObject().put("ok", false).put("error", error), status)
    private fun go(to: String) = Reply(302, "text/plain", ByteArray(0), to)
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /**
     * One request under /ha. [query] is the decoded query string, [body] the raw request body (JSON),
     * [host] the Host header, [file] reads a file of tv-home/web from the app (ha-phone.html, ha-picks.js). Null: not ours.
     */
    fun handle(ctx: Context, method: String, path: String, query: Map<String, String>, body: String, host: String?, port: Int?, file: (String) -> ByteArray?): Reply? =
        handleFor(ctx.applicationContext, method, path, query, body, host, port, file)

    /** handle() with the app's context, null in tests (then only what needs no store is asked). */
    internal fun handleFor(app: Context?, method: String, path: String, query: Map<String, String>, body: String, host: String?, port: Int?, file: (String) -> ByteArray?): Reply? {
        val p = path.trimEnd('/').ifEmpty { "/" }
        if (p != "/ha" && !p.startsWith("/ha/")) return null
        if (!hostOk(host, port)) return Reply(403, "text/plain", "Forbidden".toByteArray())
        val b = try { if (body.isBlank()) JSONObject() else JSONObject(body) } catch (e: Exception) { JSONObject() }
        val k = query["k"] ?: b.optString("k").ifEmpty { null }
        when ("$method $p") {
            "GET /ha" -> {
                val html = file("ha-phone.html") ?: return Reply(404, "text/plain", "Not found".toByteArray())
                return Reply(200, "text/html; charset=utf-8", html)
            }
            "GET /ha/ha-picks.js" -> {
                val js = file("ha-picks.js") ?: return Reply(404, "text/plain", "Not found".toByteArray())
                return Reply(200, "application/javascript", js)
            }
            // the page's words in the TV's language (phone-words.js) and the widget settings words it shares
            "GET /ha/phone-words.js", "GET /ha/caps-words.js" -> {
                val js = file(p.removePrefix("/ha/")) ?: return Reply(404, "text/plain", "Not found".toByteArray())
                return Reply(200, "application/javascript", js)
            }
            "GET /ha/done" -> return done(app, query)
        }
        val s = live(k) ?: return fail("expired", 403)
        if (app == null && "$method $p" != "POST /ha/api/signin") return fail("unknown", 404)
        return when ("$method $p") {
            "GET /ha/api/state" -> {
                if (!s.seen) { s.seen = true; onChange?.invoke() }
                val st = HomeAssistant.status(app!!)
                json(JSONObject().put("ok", true).put("signed_in", st.optBoolean("set")).put("host", st.optString("host")).put("signin_again", st.optBoolean("signin_again"))
                    .put("scanning", s.scanning).put("found", JSONArray(s.found.map { JSONObject().put("name", it.name).put("url", it.url) })))
            }
            "POST /ha/api/signin" -> {
                val base = HomeAssistant.cleanBase(b.optString("url").let { if (it.isNotBlank() && !it.contains("://")) "http://$it" else it })
                    ?: return fail("address")
                val client = clientFor(host, s.tvIp, s.port) ?: return fail("network")
                when (val ok = HaAuth.probe(base)) { "ok" -> {}; else -> return fail(ok) }
                // PKCE S256 always: a Home Assistant too old to say it takes it ignores it, so it is never dropped
                val verifier = HaAuth.verifier()
                val state = HaAuth.randomKey(16)
                s.pending = Pending(state, verifier, base, client, now())
                json(JSONObject().put("ok", true).put("go", HaAuth.authorizeUrl(base, client, client + "ha/done", state, HaAuth.challenge(verifier))))
            }
            "GET /ha/api/devices" -> {
                val set = HomeAssistant.settings(app!!) ?: return fail("signin")
                val r = HomeAssistant.listFor(set)
                // a key Home Assistant no longer takes: the phone signs in again
                if (!r.optBoolean("ok")) return if (r.optString("error") == "token") fail("signin") else json(r)
                json(r.put("picked", HomeAssistant.status(app!!)))
            }
            "POST /ha/api/save" -> {
                val picks = b.optJSONObject("picks") ?: return fail("picks")
                if (!HomeAssistant.keepPicks(app!!, picks)) return fail(if (HomeAssistant.settings(app) == null) "signin" else "picks")
                onChange?.invoke()
                json(JSONObject().put("ok", true).put("count", HomeAssistant.status(app).optInt("count")))
            }
            "POST /ha/api/forget" -> {
                HomeAssistant.disconnect(app!!)
                onChange?.invoke()
                json(JSONObject().put("ok", true))
            }
            else -> fail("unknown", 404)
        }
    }

    /** Home Assistant sent the phone back here with a one time code: swap it for the tokens, here on the TV. */
    // Every failure before the state checks out goes to /ha/?e=expired with no key: only the phone that
    // asked for this sign in (it holds the state) is sent back with the set up key.
    private fun done(app: Context?, q: Map<String, String>): Reply {
        val s = cur ?: return go("/ha/?e=expired")
        val pend = s.pending ?: return go("/ha/?e=expired")
        val state = q["state"] ?: ""
        if (!MessageDigest.isEqual(state.toByteArray(), pend.state.toByteArray())) return go("/ha/?e=expired")
        if (s.until < now() || now() - pend.at > SIGN_IN_MS) { s.pending = null; return go("/ha/?e=expired") }
        val back = "/ha/?k=" + enc(s.key)
        s.pending = null   // a code is used once
        val code = q["code"]?.takeIf { it.isNotEmpty() && it.length < 512 } ?: return go("$back&e=denied")
        val (status, t) = HaAuth.exchange(pend.base, code, pend.client, pend.verifier)
        if (t == null) return go("$back&e=" + if (status == -1) "unreachable" else "signin")
        if (!keepSignIn(app, pend.base, t, pend.client)) return go("$back&e=signin")
        onChange?.invoke()
        return go("$back#devices")
    }

    /** The TV's address on the home network (Wi-Fi or Ethernet), for the QR code. */
    fun lanAddress(ctx: Context): String? = try {
        val cm = ctx.applicationContext.getSystemService(android.net.ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.linkAddresses?.map { it.address }
            ?.firstOrNull { it is java.net.Inet4Address && !it.isLoopbackAddress }?.hostAddress
    } catch (e: Exception) { null } ?: try {
        java.net.NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }.firstOrNull { it is java.net.Inet4Address && it.isSiteLocalAddress }?.hostAddress
    } catch (e: Exception) { null }
}
