package app.couchtv.launcher

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Pairing for the phone's Home settings page (PhoneServer.kt), the same rules as the on-TV app's
 * (on-tv Auth.kt): the TV shows a 6 digit code (inside its Home settings QR, or as a line on the home);
 * a phone that sends it gets a long random token, and every call must carry that token. Only a SHA-256 of
 * each token is kept. A code lasts 3 minutes, is used once, and 5 wrong tries throw it away.
 *
 * Plain Kotlin, no Android: the store and the clock are handed in, so the rules are unit tested.
 */
class PhoneAuth(private val store: Store, private val clock: () -> Long = System::currentTimeMillis) {
    /** Where tokens are kept (the app: its own preferences file "phonepage", left out of backups). */
    interface Store { fun get(key: String): String?; fun put(key: String, value: String?) }

    private val rnd = SecureRandom()
    @Volatile private var pin: String? = null
    @Volatile private var pinUntil = 0L
    @Volatile private var wrong = 0

    @Synchronized fun newPin(): String {
        val p = String.format("%06d", rnd.nextInt(1_000_000))
        pin = p; pinUntil = clock() + PIN_MS; wrong = 0
        return p
    }

    fun currentPin(): String? = if (pin != null && clock() < pinUntil) pin else null

    fun pinSecondsLeft(): Int = if (currentPin() == null) 0 else ((pinUntil - clock()) / 1000).toInt().coerceAtLeast(0)

    /** The live code if it has more than 30 seconds left (so a code someone is typing is not swapped), else a new one. */
    @Synchronized fun pinForQr(): String = currentPin()?.takeIf { pinSecondsLeft() > 30 } ?: newPin()

    /** A new token for the right code, null for a wrong one. */
    @Synchronized fun pair(code: String?, name: String?): String? {
        val live = currentPin() ?: return null
        val given = code?.filter { it.isDigit() }.orEmpty()
        if (!MessageDigest.isEqual(given.toByteArray(), live.toByteArray())) {
            wrong += 1
            if (wrong >= WRONG_MAX) pin = null
            return null
        }
        pin = null
        val token = hex(32)
        val list = tokens()
        // at most 20 phones: the oldest goes first
        while (list.length() >= 20) list.remove(0)
        list.put(JSONObject().put("hash", sha(token)).put("name", (name ?: "Phone").take(40)).put("at", clock()))
        store.put(KEY, list.toString())
        return token
    }

    fun valid(token: String?): Boolean {
        if (token.isNullOrEmpty() || token.length > 200) return false
        val h = sha(token).toByteArray()
        val list = tokens()
        for (i in 0 until list.length()) if (MessageDigest.isEqual(list.optJSONObject(i)?.optString("hash")?.toByteArray() ?: ByteArray(0), h)) return true
        return false
    }

    fun phoneCount() = tokens().length()

    fun forgetAll() = store.put(KEY, null)

    private fun tokens(): JSONArray = store.get(KEY)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    private fun hex(n: Int) = ByteArray(n).also { rnd.nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    companion object {
        const val PIN_MS = 3 * 60_000L
        const val WRONG_MAX = 5
        private const val KEY = "tokens"
    }
}
