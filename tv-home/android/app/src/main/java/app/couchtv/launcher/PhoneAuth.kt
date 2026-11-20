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
    /** Where tokens are kept (the app: its own preferences file "phonepage", left out of backups: res/xml backup_rules, data_extraction_rules). */
    interface Store { fun get(key: String): String?; fun put(key: String, value: String?) }

    private val rnd = SecureRandom()
    @Volatile private var pin: String? = null
    @Volatile private var pinUntil = 0L
    @Volatile private var wrong = 0
    /** 15 wrong tries in 10 minutes, across every code, lock pairing for 10 minutes (PairLock.kt). */
    val lock = PairLock()

    fun lockedFor(): Int = lock.lockedFor(clock())

    @Synchronized fun newPin(): String {
        val p = String.format("%06d", rnd.nextInt(1_000_000))
        pin = p; pinUntil = clock() + PIN_MS; wrong = 0
        return p
    }

    fun currentPin(): String? = if (pin != null && clock() < pinUntil) pin else null

    fun pinSecondsLeft(): Int = if (currentPin() == null) 0 else ((pinUntil - clock()) / 1000).toInt().coerceAtLeast(0)

    /**
     * The live code if it has more than [minLeft] seconds left (so a code someone is typing is not swapped), else a new
     * one. The QR keeps one with more than 30 s left; Show a code on the TV one with more than 90 s (someone is about
     * to type it), so asking again and again never kills the QR's code.
     */
    @Synchronized fun pinForQr(minLeft: Int = 30): String = currentPin()?.takeIf { pinSecondsLeft() > minLeft } ?: newPin()

    // Wrong codes per phone address: [time, the guess] within the lock's window
    private val byAddress = LinkedHashMap<String, ArrayDeque<Pair<Long, String>>>()

    /** 5 different wrong codes from one address within 10 minutes: that address waits (429), nobody else does
     *  (about 720 guesses a day at most, instead of 7,200). */
    @Synchronized fun addressLimited(addr: String?): Boolean {
        val now = clock()
        return (byAddress[addr ?: ""]?.count { now - it.first < LOCK_WINDOW_MS } ?: 0) >= ADDRESS_MAX
    }

    /**
     * A new token for the right code, null for a wrong one. Only a guess at a live code counts towards the lock (with
     * no code there is nothing to guess, so nobody can keep pairing locked that way); the same wrong code again from one
     * address is not a new guess; and one address adds at most 5 to the lock in its window, so one phone or script
     * alone can never lock pairing for everyone (the on-TV app's rule, and the home computer's, phonepage.py).
     */
    @Synchronized fun pair(code: String?, name: String?, addr: String? = null): String? {
        if (lockedFor() > 0) return null
        val given = code?.filter { it.isDigit() }.orEmpty()
        val live = currentPin() ?: return null
        if (!MessageDigest.isEqual(given.toByteArray(), live.toByteArray())) {
            val now = clock()
            byAddress.values.forEach { q -> while (q.isNotEmpty() && now - q.first().first >= LOCK_WINDOW_MS) q.removeFirst() }
            byAddress.entries.removeAll { it.value.isEmpty() }
            val mine = byAddress.getOrPut(addr ?: "") { ArrayDeque() }
            if (mine.none { it.second == given.take(12) }) {
                val counts = mine.size < LOCK_PER_ADDRESS
                mine.addLast(now to given.take(12))
                while (byAddress.size > 1000) byAddress.remove(byAddress.keys.first())
                if (counts && lock.wrong(now)) { pin = null; return null }
                // only a new guess counts against this code: one phone sending the same wrong code again and
                // again never throws the QR's code away
                wrong += 1
                if (wrong >= WRONG_MAX) pin = null
            }
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
        const val ADDRESS_MAX = 5                 // different wrong codes from one address in 10 minutes, then 429 there
        const val LOCK_PER_ADDRESS = 5            // the most one address adds to the lock (PairLock) in its window
        const val LOCK_WINDOW_MS = 10 * 60_000L
        private const val KEY = "tokens"
    }
}
