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

    // ---------- settings the household can change from the phone (/setup) ----------
    val port get() = int("port", 5400)

    fun people(): JSONArray = (str("people")?.let { runCatching { JSONArray(it) }.getOrNull() })
        ?: JSONArray().put(JSONObject().put("id", "person1").put("name", "Person 1")).put(JSONObject().put("id", "person2").put("name", "Person 2"))

    /** Weather place for the home screen. Defaults to a public example place; set your own in /setup. */
    fun weather(): JSONObject = (str("weather")?.let { runCatching { JSONObject(it) }.getOrNull() })
        ?: JSONObject().put("lat", -33.8688).put("lon", 151.2093).put("place", "Sydney").put("timezone", "Australia/Sydney")

    fun country(): String = str("country", "AU") ?: "AU"

    /** The public config the TV home and the phone remote read (same shape as the computer bridge). */
    fun publicConfig(): JSONObject = JSONObject()
        .put("people", people())
        .put("weather", weather())
        .put("tvs", JSONArray().put(JSONObject().put("id", TV_ID).put("name", tvName()).also {
            // Only a Fire TV changes: its quick buttons gain Input (the TV's own HDMI picker).
            // Every other TV keeps the home's default buttons, exactly as before.
            if (FireHome.isFireTv) it.put("quick", JSONArray(listOf("sleep", "look", "input")))
        }))
        .put("default_tv", TV_ID)
        .put("mode", "on-tv")

    fun tvName(): String = str("tv_name", "This TV") ?: "This TV"

    const val TV_ID = "this-tv"

    // ---------- watch history (plays started from the phone, and what apps report) ----------
    @Synchronized fun history(): JSONArray = (readJson("history.json") as? JSONArray) ?: JSONArray()

    @Synchronized fun addHistory(item: JSONObject) {
        val old = history()
        val out = JSONArray().put(item)
        for (i in 0 until minOf(old.length(), 499)) out.put(old.get(i))
        writeJson("history.json", out)
    }
}
