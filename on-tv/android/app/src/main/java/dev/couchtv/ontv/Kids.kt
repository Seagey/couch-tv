package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Kids mode in on-TV mode, the same as the computer bridge's bridge/kids.py (docs/CONFIG.md, "Kids
 * mode"). With no config.json here, a parent makes someone a kids profile from the phone remote
 * (TV, Kids mode), choosing the PIN there, and adds the shows by searching. Kept in kids.json on
 * the TV. The PIN itself is never kept: only a salted hash, SHA-256 applied PIN_ROUNDS times to
 * "salt:pin", which is what the TV home (kids.js) checks a typed PIN against.
 */
object Kids {
    const val PIN_ROUNDS = 4000
    private const val MAX_SHOWS = 24
    private const val MAX_APPS = 6
    private val PIN = Regex("\\d{4,8}")
    private val PKG = Regex("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+")
    private val HTTPS = Regex("^https://[^\\s\"'<>()]{1,500}$")
    private val wrong = HashMap<String, MutableList<Long>>()

    fun goodPin(pin: String?) = pin != null && PIN.matches(pin)

    fun hash(pin: String, salt: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        var h = "$salt:$pin".toByteArray(Charsets.UTF_8)
        repeat(PIN_ROUNDS) { h = md.digest(h) }
        return h.joinToString("") { "%02x".format(it) }
    }

    private fun salt(): String = ByteArray(12).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    @Synchronized private fun all(): JSONObject = (Store.readJson("kids.json") as? JSONObject)?.optJSONObject("people") ?: JSONObject()

    @Synchronized private fun save(id: String, change: (JSONObject) -> Unit) {
        val people = all()
        val rec = people.optJSONObject(id) ?: JSONObject()
        change(rec)
        people.put(id, rec)
        Store.writeJson("kids.json", JSONObject().put("people", people))
    }

    /** This person's kids mode (pin_hash, pin_salt, shows, apps), or null. */
    fun mode(id: String?): JSONObject? {
        if (id.isNullOrEmpty()) return null
        val ids = Store.people().let { p -> (0 until p.length()).map { p.optJSONObject(it)?.optString("id") } }
        if (id !in ids) return null
        val m = all().optJSONObject(id) ?: return null
        if (m.optBoolean("off") || m.optString("pin_hash").isEmpty()) return null
        return m
    }

    fun isKid(id: String?) = mode(id) != null

    fun verify(id: String?, pin: String?): Boolean {
        val m = mode(id) ?: return false
        if (!goodPin(pin)) return false
        return MessageDigest.isEqual(hash(pin!!, m.optString("pin_salt")).toByteArray(), m.optString("pin_hash").toByteArray())
    }

    @Synchronized fun lockedOut(addr: String): Boolean {
        val now = System.currentTimeMillis()
        val times = (wrong[addr] ?: return false).filter { now - it < 300_000 }.toMutableList()
        if (times.isEmpty()) wrong.remove(addr) else wrong[addr] = times
        return times.size >= 5
    }

    @Synchronized fun wrongPin(addr: String) {
        wrong.getOrPut(addr) { mutableListOf() }.add(System.currentTimeMillis())
        if (wrong.size > 256) wrong.remove(wrong.keys.first())
    }

    fun cleanShow(s: JSONObject?): JSONObject? {
        s ?: return null
        val title = s.optString("title").trim().replace(Regex("\\s+"), " ").take(80)
        if (title.isEmpty()) return null
        val out = JSONObject().put("title", title)
        val svc = s.optString("service").trim().lowercase()
        Apps.BY_ID[svc]?.let { out.put("service", it.id) }
        val season = s.optInt("season").takeIf { it in 1..99 }
        season?.let { out.put("season", it) }
        if (season != null) s.optInt("episode").takeIf { it in 1..999 }?.let { out.put("episode", it) }
        for (k in listOf("poster", "backdrop")) s.optString(k).trim().takeIf { HTTPS.matches(it) }?.let { out.put(k, it) }
        out.put("id", listOf(title, out.optString("service"), season?.toString() ?: "", out.optString("episode"))
            .filter { it.isNotEmpty() }.joinToString("-").lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(40))
        return out
    }

    private fun cleanApps(a: JSONArray?): JSONArray {
        val out = JSONArray(); val seen = HashSet<String>()
        for (i in 0 until (a?.length() ?: 0)) {
            val v = a!!.optString(i).trim()
            val pkg = Apps.BY_ID[v.lowercase()]?.pkg ?: v
            if (PKG.matches(pkg) && pkg != "com.android.tv.settings" && seen.add(pkg)) out.put(pkg)
            if (out.length() >= MAX_APPS) break
        }
        return out
    }

    private fun publicShow(s: JSONObject): JSONObject {
        val o = JSONObject(s.toString())
        Apps.BY_ID[o.optString("service")]?.let { a ->
            o.put("package", a.pkg)
            o.put("app", JSONObject().put("id", a.id).put("name", a.name).put("package", a.pkg))
        }
        return o
    }

    /** What a page gets for a kids profile: the shelf, the apps and the PIN's hash. Never the PIN. */
    fun publicMode(m: JSONObject): JSONObject {
        val shows = JSONArray()
        val src = m.optJSONArray("shows") ?: JSONArray()
        for (i in 0 until src.length()) src.optJSONObject(i)?.let { shows.put(publicShow(it)) }
        return JSONObject().put("shows", shows).put("apps", m.optJSONArray("apps") ?: JSONArray())
            .put("pin_hash", m.optString("pin_hash")).put("pin_salt", m.optString("pin_salt")).put("pin_rounds", PIN_ROUNDS)
    }

    /** The people list with "kids_mode" on each kids profile (for config.js and /api/config). */
    fun attach(people: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until people.length()) {
            val p = JSONObject(people.optJSONObject(i)?.toString() ?: continue)
            mode(p.optString("id"))?.let { p.put("kids_mode", publicMode(it)) }
            out.put(p)
        }
        return out
    }

    /** GET /api/kids: every kids profile, its shelf, its apps and its PIN's hash. */
    fun list(): JSONArray {
        val out = JSONArray()
        val people = Store.people()
        for (i in 0 until people.length()) {
            val p = people.optJSONObject(i) ?: continue
            val m = mode(p.optString("id")) ?: continue
            val pub = publicMode(m)
            val apps = JSONArray()
            val pk = pub.optJSONArray("apps") ?: JSONArray()
            for (j in 0 until pk.length()) apps.put(JSONObject().put("package", pk.optString(j))
                .put("name", Apps.BY_PACKAGE[pk.optString(j)]?.name ?: pk.optString(j)))
            out.put(pub.put("id", p.optString("id")).put("name", p.optString("name")).put("apps", apps))
        }
        return out
    }

    /** POST /api/kids. Returns null when it worked, else (status, message). */
    fun change(b: JSONObject, addr: String): Pair<Int, String>? {
        val id = b.optString("who")
        val ids = Store.people().let { p -> (0 until p.length()).map { p.optJSONObject(it)?.optString("id") } }
        if (id.isEmpty() || id !in ids) return 400 to "who must be one person's id"
        val action = b.optString("action")
        val m = mode(id)
        if (action == "on") {
            if (m != null) return 409 to "That is a kids profile already."
            val pin = b.optString("new_pin")
            if (!goodPin(pin)) return 400 to "The PIN must be 4 to 8 digits."
            val s = salt()
            save(id) { it.put("pin_hash", hash(pin, s)).put("pin_salt", s).put("off", false)
                if (!it.has("shows")) it.put("shows", JSONArray()); if (!it.has("apps")) it.put("apps", JSONArray()) }
            return null
        }
        if (m == null) return 404 to "That is not a kids profile."
        if (lockedOut(addr)) return 429 to "Too many wrong PINs. Wait a few minutes and try again."
        val pin = b.optString("pin")
        if (!verify(id, pin)) { wrongPin(addr); return 403 to (if (pin.isEmpty()) "The parent PIN is needed for that." else "That PIN is not right.") }
        when (action) {
            "add" -> {
                val show = cleanShow(b.optJSONObject("show")) ?: return 400 to "show needs a title"
                val shows = m.optJSONArray("shows") ?: JSONArray()
                if (shows.length() >= MAX_SHOWS) return 400 to "A shelf holds $MAX_SHOWS shows. Remove one first."
                for (i in 0 until shows.length()) if (shows.optJSONObject(i)?.optString("id") == show.optString("id")) return null
                save(id) { it.put("shows", shows.put(show)) }
            }
            "remove" -> {
                val gone = b.optString("id")
                val shows = m.optJSONArray("shows") ?: JSONArray()
                val kept = JSONArray()
                for (i in 0 until shows.length()) shows.optJSONObject(i)?.let { if (it.optString("id") != gone) kept.put(it) }
                save(id) { it.put("shows", kept) }
            }
            "apps" -> save(id) { it.put("apps", cleanApps(b.optJSONArray("apps"))) }
            "pin" -> {
                val np = b.optString("new_pin")
                if (!goodPin(np)) return 400 to "The PIN must be 4 to 8 digits."
                val s = salt()
                save(id) { it.put("pin_hash", hash(np, s)).put("pin_salt", s) }
            }
            "off" -> save(id) { it.put("off", true).remove("pin_hash") }
            "check" -> {}
            else -> return 400 to "action must be check, add, remove, apps, pin, on or off"
        }
        return null
    }
}
