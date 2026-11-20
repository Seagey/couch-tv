package app.couchtv.ha

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Signing in to Home Assistant from a phone, the way Home Assistant's own apps do (OAuth 2 with
 * IndieAuth client ids, https://developers.home-assistant.io/docs/auth_api/). The TV is the client:
 * its client id is its own address on the home network (http://<tv-ip>:<port>/), and Home
 * Assistant sends the phone back to http://<tv-ip>:<port>/ha/done with a one time code. The TV
 * swaps that code for an access token (30 minutes) and a refresh token, and keeps the refresh
 * token in its own private store. The phone never sees either token.
 *
 * PKCE S256 always (a Home Assistant too old to say it takes it ignores it, so it is never dropped).
 * Every call goes to the one address the person picked, never follows a redirect, and gives up after
 * a few seconds. No token is ever logged.
 */
object HaAuth {
    class Tokens(val access: String, val refresh: String?, val expiresIn: Long)

    /** Tests put a pretend Home Assistant here; the app never sets it. (method, url, form) -> (status, body) */
    @Volatile internal var fake: ((method: String, url: String, form: Map<String, String>?) -> Pair<Int, String?>)? = null

    private val random = SecureRandom()
    private val TOKEN = Regex("[A-Za-z0-9._-]{20,2048}")

    /** A random key in url safe letters: [bytes] random bytes, so 16 gives 128 bits. */
    fun randomKey(bytes: Int = 16): String = b64url(ByteArray(bytes).also { random.nextBytes(it) })

    /** RFC 7636: 43 to 128 unreserved characters. 32 random bytes give 43. */
    fun verifier(): String = randomKey(32)

    fun challenge(verifier: String): String =
        b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** Base64 with the url safe letters and no padding (java.util.Base64 is Android 8 and newer only). */
    internal fun b64url(b: ByteArray): String {
        val abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val out = StringBuilder()
        var i = 0
        while (i + 2 < b.size) {
            val n = (b[i].toInt() and 255 shl 16) or (b[i + 1].toInt() and 255 shl 8) or (b[i + 2].toInt() and 255)
            out.append(abc[n shr 18 and 63]).append(abc[n shr 12 and 63]).append(abc[n shr 6 and 63]).append(abc[n and 63])
            i += 3
        }
        val left = b.size - i
        if (left == 1) {
            val n = b[i].toInt() and 255 shl 16
            out.append(abc[n shr 18 and 63]).append(abc[n shr 12 and 63])
        } else if (left == 2) {
            val n = (b[i].toInt() and 255 shl 16) or (b[i + 1].toInt() and 255 shl 8)
            out.append(abc[n shr 18 and 63]).append(abc[n shr 12 and 63]).append(abc[n shr 6 and 63])
        }
        return out.toString()
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** Where the phone goes to sign in. */
    fun authorizeUrl(base: String, client: String, redirect: String, state: String, challenge: String): String {
        val q = StringBuilder("response_type=code&client_id=").append(enc(client)).append("&redirect_uri=").append(enc(redirect))
            .append("&state=").append(enc(state))
        q.append("&code_challenge=").append(enc(challenge)).append("&code_challenge_method=S256")
        return "$base/auth/authorize?$q"
    }

    // ---------------------------------------------------------------- the calls

    /** One call: GET when [form] is null, else a form POST. (status, body) or (-1, null) when it failed. */
    private fun http(method: String, url: String, form: Map<String, String>?, limit: Int = 256 * 1024): Pair<Int, String?> {
        fake?.let { return it(method, url, form) }
        var c: HttpURLConnection? = null
        return try {
            c = URL(url).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 3000
            c.readTimeout = 8000
            c.requestMethod = method
            c.setRequestProperty("Accept", "application/json")
            if (form != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                val body = form.entries.joinToString("&") { enc(it.key) + "=" + enc(it.value) }
                c.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val text = stream?.use { s ->
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192)
                while (true) {
                    val n = s.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) return -1 to null
                }
                String(out.toByteArray(), Charsets.UTF_8)
            }
            code to text
        } catch (e: Exception) {
            -1 to null
        } finally {
            c?.disconnect()
        }
    }

    /**
     * Is there a Home Assistant at [base] that someone can sign in to? "ok", "unreachable", "not_ha"
     * or "not_ready" (Home Assistant is still being set up: onboarding is not finished).
     */
    fun probe(base: String): String {
        val (code, body) = http("GET", "$base/auth/providers", null)
        return when {
            code == -1 -> "unreachable"
            code == 200 && body != null && body.contains("\"type\"") -> "ok"
            code == 400 && body != null && body.contains("onboarding", ignoreCase = true) -> "not_ready"
            else -> "not_ha"
        }
    }

    /** Does this Home Assistant say it takes PKCE (S256)? Only the tests ask (HaRealTest checks a real one does); the sign in always sends S256. */
    fun pkce(base: String): Boolean {
        val (code, body) = http("GET", "$base/.well-known/oauth-authorization-server", null)
        if (code != 200 || body == null) return false
        return try { JSONObject(body).optJSONArray("code_challenge_methods_supported")?.let { a -> (0 until a.length()).any { a.optString(it) == "S256" } } == true }
            catch (e: Exception) { false }
    }

    private fun tokens(code: Int, body: String?): Pair<Int, Tokens?> {
        if (code != 200 || body == null) return (if (code == -1) -1 else if (code in 400..403) 401 else code) to null
        return try {
            val o = JSONObject(body)
            val access = o.optString("access_token").takeIf { TOKEN.matches(it) } ?: return 502 to null
            val refresh = o.optString("refresh_token").takeIf { TOKEN.matches(it) }
            200 to Tokens(access, refresh, o.optLong("expires_in", 1800L).coerceIn(60L, 86_400L))
        } catch (e: Exception) { 502 to null }
    }

    /** The one time code from the phone, swapped for the tokens. 401: the code or the verifier was refused. */
    fun exchange(base: String, code: String, client: String, verifier: String): Pair<Int, Tokens?> {
        val form = linkedMapOf("grant_type" to "authorization_code", "code" to code, "client_id" to client)
        form["code_verifier"] = verifier
        val (c, b) = http("POST", "$base/auth/token", form)
        return tokens(c, b)
    }

    /** A new access token. 401: the refresh token is gone (revoked, or unused for too long): sign in again. */
    fun refresh(base: String, refresh: String, client: String): Pair<Int, Tokens?> {
        val (c, b) = http("POST", "$base/auth/token", linkedMapOf("grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to client))
        return tokens(c, b)
    }

    /** Disconnect: Home Assistant forgets the refresh token and every access token made from it. */
    fun revoke(base: String, refresh: String): Boolean = http("POST", "$base/auth/revoke", linkedMapOf("token" to refresh)).first == 200
}
