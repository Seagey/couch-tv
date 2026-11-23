package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Phone pairing. The TV shows a 6 digit code; a phone that types it gets a long random token, and
 * every API call must carry that token. The TV keeps only a SHA-256 of each token.
 *
 * Limits (the same rules as the home computer's phone page, phonepage.py, and the Couch TV home app's
 * PhoneAuth.kt): a code lasts 3 minutes, and 5 different wrong tries throw it away (a new one has to be
 * shown on the TV); the same wrong code again from the same address is refused without counting, so one
 * phone repeating a code can't kill the code on the TV. One address may make 5 different wrong tries in
 * 10 minutes, then it waits (429, Wait N min) and nobody else does. 15 wrong tries in 10 minutes across
 * every address (so 3 addresses or more) lock pairing for everyone for 10 minutes (PairLock). Guessing is
 * about 5 in a million per code. New phone code on the TV's setup screen opens every lock (resetLocks).
 */
object Auth {
    private val rnd = SecureRandom()
    @Volatile private var pin: String? = null
    @Volatile private var pinUntil = 0L
    @Volatile private var wrong = 0
    /** (address, wrong code) pairs already tried on the live code: the same again is not a new try. */
    private val guessed = HashSet<Pair<String, String>>()
    private val listeners = mutableListOf<(String?) -> Unit>()

    /** The clock, so the unit tests can move time on. */
    @Volatile var clock: () -> Long = { android.os.SystemClock.elapsedRealtime() }
    /** Wrong tries across every code from every address: 15 in 10 minutes lock pairing for everyone. */
    val lock = PairLock()
    const val ADDRESS_MAX = 5                    // different wrong codes from one address in the window, then 429 there
    const val ADDRESS_WINDOW_MS = 10 * 60_000L
    /**
     * Each phone address's wrong tries (time, code) in the window. An address is an IPv4 address or an IPv6 /64.
     * At most 1000 addresses are kept (the oldest goes first).
     */
    private val perAddress = LinkedHashMap<String, ArrayDeque<Pair<Long, String>>>()

    private fun prune(now: Long) {
        perAddress.values.forEach { q -> while (q.isNotEmpty() && now - q.first().first >= ADDRESS_WINDOW_MS) q.removeFirst() }
        perAddress.entries.removeAll { it.value.isEmpty() }
    }

    /** Seconds until this address may try again (0: it may). */
    private fun addressWait(key: String, now: Long): Int {
        val q = perAddress[key] ?: return 0
        val live = q.filter { now - it.first < ADDRESS_WINDOW_MS }
        if (live.size < ADDRESS_MAX) return 0
        return (((live.first().first + ADDRESS_WINDOW_MS - now) + 999) / 1000).toInt().coerceAtLeast(1)
    }

    /** The key a phone's wrong tries count under: the IPv4 address, or the first 64 bits of an IPv6 one. */
    fun addressKey(addr: String?): String {
        val a = addr?.trim().orEmpty()
        if (a.isEmpty()) return ""
        return try {
            val ip = java.net.InetAddress.getByName(a.substringBefore('%'))   // a literal: no DNS lookup
            if (ip is java.net.Inet6Address) ip.address.copyOf(8).joinToString(":") { "%02x".format(it) } + "::/64" else ip.hostAddress ?: a
        } catch (e: Exception) { a }
    }

    /** Seconds until pairing opens again for this address (0: open): its own wait or the lock for everyone. */
    @Synchronized fun lockedFor(addr: String? = ""): Int {
        val now = clock()
        return maxOf(lock.lockedFor(now), addressWait(addressKey(addr), now))
    }

    /** Seconds until pairing opens again for every phone (0: open). The setup screen shows it. */
    fun lockedEverywhere(): Int = lock.lockedFor(clock())

    /** Someone at the TV with its remote pressed New phone code: every lock opens. */
    @Synchronized fun resetLocks() { lock.reset(); perAddress.clear() }

    /** How many addresses are counted now (the tests check it stays at most 1000). */
    @Synchronized internal fun addressesKept(): Int = perAddress.size

    /** Token the TV's own home page uses (set as a cookie in its WebView). Never shown anywhere. */
    val internalToken: String by lazy {
        Store.str("internal_token") ?: hex(32).also { Store.putStr("internal_token", it) }
    }

    @Synchronized fun newPin(): String {
        val p = String.format("%06d", rnd.nextInt(1_000_000))
        pin = p; pinUntil = clock() + 3 * 60_000; wrong = 0; guessed.clear()
        notifyPin()
        return p
    }

    /** The code to show on the TV now, or null if none is live. */
    fun currentPin(): String? = if (pin != null && clock() < pinUntil) pin else null

    /** Seconds the live code has left (0: none), so a QR holding it can be made again in time. */
    fun pinSecondsLeft(): Int = if (currentPin() == null) 0 else ((pinUntil - clock()) / 1000).toInt().coerceAtLeast(0)

    /**
     * The code for Home settings' "Change this on your phone" QR: the live one if a code is already on
     * show with more than 30 seconds left (so a code someone is typing is not swapped), else a new one. Shown only inside the QR, on
     * the TV's own screen, exactly as visible as the code the setup screen shows.
     */
    @Synchronized fun pinForQr(minLeft: Int = 30): String = currentPin()?.takeIf { pinSecondsLeft() > minLeft } ?: newPin()

    fun onPin(fn: (String?) -> Unit) { synchronized(listeners) { listeners += fn } }
    fun offPin(fn: (String?) -> Unit) { synchronized(listeners) { listeners -= fn } }
    private fun notifyPin() { val p = currentPin(); synchronized(listeners) { listeners.toList() }.forEach { it(p) } }

    /** Returns a new token for the right code, null for a wrong one (or while pairing is locked). */
    @Synchronized fun pair(code: String?, name: String?, addr: String? = ""): String? {
        if (lockedFor(addr) > 0) return null
        // no live code: nothing to guess, and not counted, so nobody can keep pairing locked while no
        // code is on the TV
        val live = currentPin() ?: return null
        val given = code?.filter { it.isDigit() }.orEmpty()
        if (!MessageDigest.isEqual(given.toByteArray(), live.toByteArray())) {
            val now = clock()
            val key = addressKey(addr)
            // the same wrong code again from this address: refused, not a new try (the code on the TV lives on)
            if (!guessed.add(key to given.take(12))) return null
            prune(now)
            perAddress.getOrPut(key) { ArrayDeque() }.addLast(now to given.take(12))
            while (perAddress.size > 1000) perAddress.remove(perAddress.keys.first())
            if (lock.wrong(now)) { pin = null; notifyPin(); return null }
            wrong += 1
            if (wrong >= 5 && pin != null) { pin = null; notifyPin() }
            return null
        }
        pin = null
        lastPairedAt = System.currentTimeMillis()   // wall clock: the setup screen says how long ago (not the lock clock)
        notifyPin()
        val token = hex(32)
        val list = tokens()
        list.put(JSONObject().put("hash", sha(token)).put("name", (name ?: "Phone").take(40)).put("at", System.currentTimeMillis()))
        Store.putStr("tokens", list.toString())
        return token
    }

    fun valid(token: String?): Boolean {
        if (token.isNullOrEmpty()) return false
        if (MessageDigest.isEqual(token.toByteArray(), internalToken.toByteArray())) return true
        val h = sha(token)
        val list = tokens()
        for (i in 0 until list.length()) {
            if (MessageDigest.isEqual(list.getJSONObject(i).optString("hash").toByteArray(), h.toByteArray())) return true
        }
        return false
    }

    fun phoneCount() = tokens().length()

    /** When a phone last paired (ms, 0: not since the app started), so the setup screen can say so. */
    @Volatile var lastPairedAt = 0L

    fun forgetAll() = Store.putStr("tokens", "[]")

    private fun tokens(): JSONArray = Store.str("tokens")?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    private fun hex(n: Int) = ByteArray(n).also { rnd.nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private fun sha(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
