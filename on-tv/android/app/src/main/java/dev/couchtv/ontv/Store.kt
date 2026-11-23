package dev.couchtv.ontv

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Small JSON files and settings kept on the TV. Nothing here leaves the TV. */
object Store {
    private lateinit var dir: File
    private lateinit var ctx: Context
    private val prefs by lazy { ctx.getSharedPreferences("couchtv", Context.MODE_PRIVATE) }

    fun init(c: Context) {
        ctx = c.applicationContext
        dir = File(ctx.filesDir, "data").apply { mkdirs() }
    }

    /** The app's context, for the few readers that need Android itself (WatchNext). */
    fun context(): Context = ctx

    fun str(key: String, def: String? = null): String? = prefs.getString(key, def)
    fun putStr(key: String, v: String?) = prefs.edit().apply { if (v == null) remove(key) else putString(key, v) }.apply()
    fun bool(key: String, def: Boolean = false) = prefs.getBoolean(key, def)
    fun putBool(key: String, v: Boolean) = prefs.edit().putBoolean(key, v).apply()
    fun int(key: String, def: Int) = prefs.getInt(key, def)
    fun putInt(key: String, v: Int) = prefs.edit().putInt(key, v).apply()

    @Synchronized fun readJson(name: String): Any? = try {
        val f = File(dir, name)
        if (!f.isFile) null else f.readText().trim().let { if (it.startsWith("[")) JSONArray(it) else JSONObject(it) }
    } catch (e: Exception) { null }

    @Synchronized fun writeJson(name: String, v: Any) {
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(v.toString())
        tmp.renameTo(File(dir, name))
    }

    /**
     * One change to the TV home's own Home settings (home-settings.json, the page's ST), read, changed
     * and written under one lock, so a phone adding a photo and a phone changing the town at the same
     * moment both stay. The home picks the new copy up on its next refresh (syncSettings in app.js).
     */
    @Synchronized fun editHomeSettings(fn: (JSONObject) -> Unit): JSONObject {
        val hs = readJson("home-settings.json") as? JSONObject ?: JSONObject()
        fn(hs)
        if (hs.toString().length > 32_000) throw ApiError(413, "settings are too big")
        writeJson("home-settings.json", hs)
        putStr("home_settings_updated", Now.iso())
        return hs
    }

    // ---------- settings the household can change from the phone (/setup) ----------
    val port get() = int("port", 5400)

    fun people(): JSONArray = (str("people")?.let { runCatching { JSONArray(it) }.getOrNull() })
        ?: JSONArray().put(JSONObject().put("id", "person1").put("name", "Person 1")).put(JSONObject().put("id", "person2").put("name", "Person 2"))

    /** Weather place for the home screen, set in Home settings, Location or on /setup. Null until one is
     *  set: the home then asks for the town (never a sample place such as Sydney). */
    fun weather(): JSONObject? = str("weather")?.let { runCatching { JSONObject(it) }.getOrNull() }
        ?.takeIf { it.has("lat") && it.has("lon") }

    /** Where shows stream (JustWatch): the setup page's Country; without it, the TV's own region when
     *  the TV is not in English (a German TV in Germany: DE, issue #23), else AU. */
    fun country(): String = str("country")?.takeIf { Regex("[A-Z]{2}").matches(it) }
        ?: java.util.Locale.getDefault().takeIf { it.language != "en" }?.country?.takeIf { Regex("[A-Z]{2}").matches(it) }
        ?: "AU"

    /** The public config the TV home and the phone remote read (same shape as the computer bridge). */
    fun publicConfig(): JSONObject = JSONObject()
        .put("people", Kids.attach(people()))   // a kids profile carries its shelf and its PIN's hash, never the PIN
        .put("weather", weather() ?: JSONObject.NULL)
        .put("tvs", JSONArray().put(JSONObject().put("id", TV_ID).put("name", tvName()).also {
            // Only a Fire TV changes: its quick buttons gain Bluetooth and Network (its long-press
            // Home menu has neither) and Input (the TV's own HDMI picker).
            // Every other TV keeps the home's default buttons, exactly as before.
            if (FireHome.isFireTv) it.put("quick", JSONArray(listOf("sleep", "bluetooth", "network", "look", "input")))
        }))
        .put("default_tv", TV_ID)
        .put("mode", "on-tv")
        // HDMI ports pinned as dock tiles, in the TV home's home.inputs shape (docs/CONFIG.md).
        // Left out when none are set, so the home is exactly as before.
        .also { c -> inputs().takeIf { it.length() > 0 }?.let { c.put("home", JSONObject().put("inputs", it)) } }
        // the Google Play build has no Ask AI: the phone remote hides its Ask button (remote/src/App.jsx, askOn)
        .also { c -> if (!PlayRules.askAi(BuildConfig.FLAVOR)) c.put("ask", JSONObject().put("enabled", false).put("available", false)) }

    /** Pinned inputs: [{port, label, icon, id?}], set from /api/settings "inputs". */
    fun inputs(): JSONArray = str("inputs")?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    fun tvName(): String = str("tv_name", "This TV") ?: "This TV"

    /** The guest's name for the Welcome widget ("Sarah", "the Nguyen family"), typed on the TV or the
     *  phone remote, with when it was set (ms). Kept on this TV only. Empty: the widget says just "Welcome". */
    fun guest(): JSONObject = JSONObject().put("name", str("guest_name") ?: "").put("at", str("guest_at")?.toLongOrNull() ?: 0L)
        .put("stay_url", str("guest_stay_url") ?: "").put("stay_at", str("guest_stay_at")?.toLongOrNull() ?: 0L)
    /** A bookings calendar link sent from the phone (typing a long Airbnb link with the TV remote is hard).
     *  Held only until the home takes it into its own private store, which then clears it here. */
    fun saveStayUrl(url: String, at: Long = System.currentTimeMillis()) {
        putStr("guest_stay_url", url.ifEmpty { null }); if (url.isNotEmpty()) putStr("guest_stay_at", at.toString())
    }
    fun saveGuest(name: String, at: Long = System.currentTimeMillis()): JSONObject {
        val clean = guestName(name)
        putStr("guest_name", clean.ifEmpty { null }); putStr("guest_at", at.toString())
        return guest()
    }
    /** One line of up to 38 characters: letters, digits, spaces and ' & , . ! -; never a link or an address. */
    fun guestName(v: String?): String {
        val s = (v ?: "").replace(Regex("[\\u0000-\\u001f\\u007f\\u2028\\u2029]+"), " ")
        if (Regex("[:/@]|www\\.", RegexOption.IGNORE_CASE).containsMatchIn(s)) return ""
        return s.replace(Regex("[^\\p{L}\\p{M}0-9 '&,.!-]"), " ").replace(Regex("\\s+"), " ").trim().take(38).trim()
    }

    /** Watch Next in Keep watching (#122), with the TV home app's names and limits (docs/CONFIG.md):
     *  packages never listed, and at most this many cards from any one app (1 to 20, 5 if unset). */
    fun skipWatchNext(): Set<String> = runCatching {
        val a = JSONArray(str("skip_watch_next") ?: "[]")
        (0 until a.length()).map { a.optString(it) }.filter { PACKAGE.matches(it) }.toSet()
    }.getOrDefault(emptySet())
    fun watchNextPerApp(): Int = (str("watch_next_per_app")?.toIntOrNull() ?: 5).coerceIn(1, 20)
    val PACKAGE = Regex("[A-Za-z0-9_.]{1,200}")

    const val TV_ID = "this-tv"

    // ---------- watch history (plays started from the phone, and what apps report) ----------
    @Synchronized fun history(): JSONArray = (readJson("history.json") as? JSONArray) ?: JSONArray()

    @Synchronized fun historyItem(id: String): JSONObject? {
        val h = history()
        for (i in 0 until h.length()) h.optJSONObject(i)?.let { if (it.optString("id") == id) return it }
        return null
    }

    /** Who is on the couch, kept across restarts (it was only in memory, so after a restart every
     *  play was logged to nobody). */
    fun who(): String? = str("who")
    fun saveWho(v: String?) = putStr("who", v)

    fun smartIdle(): JSONObject {
        val hs = (readJson("home-settings.json") as? JSONObject)?.optJSONObject("smart_idle") ?: JSONObject()
        val qh = hs.optJSONObject("quiet_hours") ?: JSONObject()
        val paused = hs.optInt("paused_idle_minutes", 30).let { if (it in listOf(0, 10, 15, 20, 30, 45, 60)) it else 30 }
        val qMin = qh.optInt("idle_minutes", 15).let { if (it in listOf(5, 10, 15, 20, 30)) it else 15 }
        return JSONObject()
            .put("enabled", hs.optBoolean("enabled", false))
            .put("paused_idle_minutes", paused)
            .put("quiet_hours", JSONObject()
                .put("enabled", qh.optBoolean("enabled", false))
                .put("start", qh.optString("start", "23:00"))
                .put("end", qh.optString("end", "06:00"))
                .put("idle_minutes", qMin))
    }

    /** Test knobs for the emulator tests only, set with `adb shell setprop`; a TV never has them.
     *  debug.couchtv.seen_after_s: seconds a title plays before it counts (default 60).
     *  debug.couchtv.clock_offset_s: moves Keep watching's clock forward, to test the 30 day drop off.
     *  debug.couchtv.keep_log: 1 logs every "what is playing" reading Keep watching sees (couchtv.keep). */
    fun testProp(name: String): Long? = runCatching {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java)
            .invoke(null, "debug.couchtv.$name") as String
    }.getOrNull()?.trim()?.toLongOrNull()

    /** Every new line gets its own id and this TV's id, so a Keep watching card opens the line it
     *  shows and only lines made since 0.9 (which say who and where) are listed. */
    @Synchronized fun addHistory(item: JSONObject) {
        val old = history()
        if (!item.has("id")) item.put("id", java.util.UUID.randomUUID().toString().replace("-", "").take(16))
        if (!item.has("tv")) item.put("tv", TV_ID)
        val out = JSONArray().put(item)
        for (i in 0 until minOf(old.length(), 499)) out.put(old.get(i))
        writeJson("history.json", out)
    }
}
