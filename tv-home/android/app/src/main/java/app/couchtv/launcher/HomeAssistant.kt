package app.couchtv.launcher

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Smart home, through Home Assistant. Optional and off unless config.json has a
 * "home_assistant" section (docs/CONFIG.md, Smart home): apply.sh hands it to the app as the
 * "ha_b64" extra, and the app keeps it in its own private store ("ha"), apart from the page's
 * settings. With no section there is nothing here: no calls, no tile, no doorbell.
 *
 * The page never sees Home Assistant's address or token. It asks through window.TVHA (Page below)
 * and only these are allowed, each for the entities named in config.json and nothing else:
 *   read the state of a named climate entity, change its temperature or mode, switch it on or
 *   off, and run a named scene or script. The doorbell (Doorbell.kt) also reads the named
 *   doorbell entity and the named camera's still picture. Every call goes to the configured
 *   address only, never follows a redirect, and gives up after a few seconds, so a Home Assistant
 *   that is off never holds anything up. The token is never logged.
 */
object HomeAssistant {
    private const val STORE = "ha"
    private const val KEY = "section"
    private const val OFFLINE_HOST = "home.tvos.invalid"   // the launcher's own copy of the page

    class Named(val entity: String, val name: String)
    class Bell(val entity: String, val camera: String?, val name: String)
    class Settings(val base: String, val token: String, val climate: List<Named>, val scenes: List<Named>, val doorbell: Bell?)

    private val CLIMATE = Regex("climate\\.[a-z0-9_]{1,64}")
    private val SCENE = Regex("(scene|script)\\.[a-z0-9_]{1,64}")
    private val BELL = Regex("(binary_sensor|input_boolean|event)\\.[a-z0-9_]{1,64}")
    private val CAMERA = Regex("camera\\.[a-z0-9_]{1,64}")
    private val TOKEN = Regex("[A-Za-z0-9._-]{20,1024}")
    private val MODES = listOf("off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only")

    @Volatile private var cached: Settings? = null
    @Volatile private var cachedFrom: String? = null

    private fun store(ctx: Context) = ctx.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /**
     * What apply.sh sent. The whole section is replaced at once, never merged, so an address can
     * never be changed without its token being replaced too. "none", an empty value or anything
     * that does not check out switches smart home off.
     */
    fun readExtras(ctx: Context, i: Intent) {
        val v = i.getStringExtra("ha_b64")?.trim() ?: return
        val e = store(ctx).edit()
        val json = if (v.isEmpty() || v == "none") null else try {
            String(android.util.Base64.decode(v, android.util.Base64.DEFAULT), Charsets.UTF_8)
                .takeIf { parse(JSONObject(it)) != null }
        } catch (x: Exception) { null }
        if (json == null) e.remove(KEY) else e.putString(KEY, json)
        e.commit()
        cached = null; cachedFrom = null
        Doorbell.start(ctx)
    }

    /** The section, checked, or null when smart home is off. */
    fun settings(ctx: Context): Settings? {
        val raw = store(ctx).getString(KEY, null) ?: return null
        if (raw == cachedFrom) return cached
        val s = try { parse(JSONObject(raw)) } catch (e: Exception) { null }
        cached = s; cachedFrom = raw
        return s
    }

    private fun parse(o: JSONObject): Settings? {
        val base = cleanBase(o.optString("url")) ?: return null
        val token = o.optString("token").trim().takeIf { TOKEN.matches(it) } ?: return null
        fun list(key: String, ok: Regex, most: Int): List<Named> {
            val a = o.optJSONArray(key) ?: return emptyList()
            val out = mutableListOf<Named>()
            for (k in 0 until a.length()) {
                if (out.size >= most) break
                val x = a.optJSONObject(k) ?: continue
                val ent = x.optString("entity").trim()
                if (!ok.matches(ent) || out.any { it.entity == ent }) continue
                out.add(Named(ent, x.optString("name").trim().take(40)))   // no name: Home Assistant's own
            }
            return out
        }
        val bell = o.optJSONObject("doorbell")?.let { b ->
            val ent = b.optString("entity").trim()
            val cam = b.optString("camera").trim().takeIf { it.isNotEmpty() }
            if (!BELL.matches(ent) || (cam != null && !CAMERA.matches(cam))) null
            else Bell(ent, cam, b.optString("name").trim().take(40))
        }
        return Settings(base, token, list("climate", CLIMATE, 8), list("scenes", SCENE, 10), bell)
    }

    /** http(s)://host[:port][/path], nothing else: no user name, no query, no fragment. */
    private fun cleanBase(u: String): String? = try {
        val url = URL(u.trim())
        if ((url.protocol != "http" && url.protocol != "https") || url.host.isNullOrEmpty() ||
            url.userInfo != null || url.query != null || url.ref != null) null
        else url.protocol + "://" + url.host + (if (url.port > 0) ":" + url.port else "") + url.path.trimEnd('/')
    } catch (e: Exception) { null }

    private fun pretty(entity: String) =
        entity.substringAfter('.').replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

    // ---------------------------------------------------------------- talking to Home Assistant

    /** One call. Returns the status code and the body (at most [limit] bytes), or -1 when it failed. */
    private fun call(s: Settings, method: String, path: String, body: JSONObject?, limit: Int): Pair<Int, ByteArray?> {
        var c: HttpURLConnection? = null
        return try {
            c = URL(s.base + path).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false   // the token only ever goes to the address in config.json
            c.connectTimeout = 3000
            c.readTimeout = 6000
            c.requestMethod = method
            c.setRequestProperty("Authorization", "Bearer " + s.token)
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            if (code !in 200..299) return code to null
            val out = ByteArrayOutputStream()
            c.inputStream.use { inp ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = inp.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) return -1 to null   // far bigger than any answer we asked for
                }
            }
            code to out.toByteArray()
        } catch (e: Exception) {
            -1 to null
        } finally {
            c?.disconnect()
        }
    }

    /** The state of one entity, as Home Assistant sends it, or null when it did not answer. */
    fun state(s: Settings, entity: String): JSONObject? {
        val (code, bytes) = call(s, "GET", "/api/states/$entity", null, 256 * 1024)
        if (code != 200 || bytes == null) return null
        return try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (e: Exception) { null }
    }

    /** The doorbell camera's still picture, shrunk to about [width] pixels wide. */
    fun snapshot(s: Settings, width: Int): Bitmap? {
        val cam = s.doorbell?.camera ?: return null
        val (code, bytes) = call(s, "GET", "/api/camera_proxy/$cam", null, 6 * 1024 * 1024)
        if (code != 200 || bytes == null) return null
        return try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            var sample = 1
            while (o.outWidth / (sample * 2) >= width) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        } catch (e: Exception) { null }
    }

    private fun service(s: Settings, domain: String, service: String, data: JSONObject): Boolean =
        call(s, "POST", "/api/services/$domain/$service", data, 512 * 1024).first in 200..299

    // ---------------------------------------------------------------- what the page may ask

    // What was last read for each climate entity, to check a new temperature or mode against.
    private class Limits(val min: Double, val max: Double, val step: Double, val modes: List<String>)
    private val limits = ConcurrentHashMap<String, Limits>()

    private fun room(n: Named, st: JSONObject?): JSONObject {
        val o = JSONObject().put("entity", n.entity).put("name", n.name.ifEmpty { pretty(n.entity) })
        val state = st?.optString("state")
        if (st == null || state == null || state == "unavailable" || state == "unknown") return o.put("ok", false)
        val a = st.optJSONObject("attributes") ?: JSONObject()
        val max = a.optDouble("max_temp", 35.0)
        // Home Assistant only sends a step when the device has one: half a degree in Celsius, one in Fahrenheit
        val step = a.optDouble("target_temp_step", if (max > 50) 1.0 else 0.5).takeIf { it > 0 } ?: 0.5
        val min = a.optDouble("min_temp", 7.0)
        val modes = mutableListOf<String>()
        a.optJSONArray("hvac_modes")?.let { m -> for (k in 0 until m.length()) m.optString(k).takeIf { it in MODES }?.let { modes.add(it) } }
        limits[n.entity] = Limits(min, max, step, modes)
        o.put("ok", true).put("state", state).put("min", min).put("max", max).put("step", step)
            .put("modes", JSONArray(modes)).put("action", a.optString("hvac_action"))
        if (a.has("current_temperature") && !a.isNull("current_temperature")) o.put("current", a.optDouble("current_temperature"))
        if (a.has("temperature") && !a.isNull("temperature")) o.put("target", a.optDouble("temperature"))
        if (a.has("target_temp_low") && !a.isNull("target_temp_low")) o.put("low", a.optDouble("target_temp_low"))
        if (a.has("target_temp_high") && !a.isNull("target_temp_high")) o.put("high", a.optDouble("target_temp_high"))
        if (n.name.isEmpty() && a.optString("friendly_name").isNotEmpty()) o.put("name", a.optString("friendly_name").take(40))
        return o
    }

    private fun answer(s: Settings?, action: String, entity: String, value: String): JSONObject {
        if (s == null) return JSONObject().put("ok", false).put("error", "off")
        val refused = JSONObject().put("ok", false).put("error", "refused")
        val climate = s.climate.firstOrNull { it.entity == entity }
        val done = { ok: Boolean -> JSONObject().put("ok", ok).apply { if (!ok) put("error", "failed") } }
        val id = JSONObject().put("entity_id", entity)
        return when (action) {
            "climate" -> JSONObject().put("ok", true).put("rooms", JSONArray(s.climate.map { room(it, state(s, it.entity)) }))
            "temp" -> {
                climate ?: return refused
                val lim = limits[entity] ?: return refused   // read the room first
                val want = value.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return refused
                val t = (Math.round(want.coerceIn(lim.min, lim.max) / lim.step) * lim.step)
                done(service(s, "climate", "set_temperature", id.put("temperature", t)))
            }
            "mode" -> {
                climate ?: return refused
                val known = limits[entity]?.modes ?: return refused
                if (value !in MODES || value !in known) return refused
                done(service(s, "climate", "set_hvac_mode", id.put("hvac_mode", value)))
            }
            "on", "off" -> {
                climate ?: return refused
                done(service(s, "climate", if (action == "on") "turn_on" else "turn_off", id))
            }
            "scene" -> {
                val sc = s.scenes.firstOrNull { it.entity == entity } ?: return refused
                done(service(s, sc.entity.substringBefore('.'), "turn_on", id))
            }
            else -> refused
        }
    }

    /**
     * window.TVHA on the page. info() says what is set up (names only, no address, no token);
     * request() does one of the allowed things and answers later through smartHome.reply(id, ...),
     * so the page never waits on the network. Only the launcher's own pages may ask: the bridge it
     * found, or its saved copy.
     */
    class Page(ctx: Context, private val web: WebView) {
        private val app = ctx.applicationContext
        private val main = Handler(Looper.getMainLooper())
        private val io = Executors.newSingleThreadExecutor()
        private val ids = Regex("[a-z0-9]{1,16}")

        @JavascriptInterface
        fun info(): String {
            val s = settings(app) ?: return "{}"
            fun names(l: List<Named>) = JSONArray(l.map { JSONObject().put("entity", it.entity).put("name", it.name.ifEmpty { pretty(it.entity) }) })
            return JSONObject().put("climate", names(s.climate)).put("scenes", names(s.scenes))
                .put("doorbell", s.doorbell != null).toString()
        }

        @JavascriptInterface
        fun request(id: String, action: String, entity: String, value: String) {
            if (!ids.matches(id)) return
            main.post {
                if (!trusted(web.url)) { reply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
                io.execute {
                    val out = try { answer(settings(app), action, entity, value) } catch (e: Exception) { JSONObject().put("ok", false) }
                    main.post { reply(id, out) }
                }
            }
        }

        private fun trusted(url: String?): Boolean {
            if (url == null) return false
            if (url.startsWith("http://$OFFLINE_HOST/")) return true
            val bridge = app.getSharedPreferences("home", Context.MODE_PRIVATE).getString("bridge", null) ?: return false
            return url.startsWith("$bridge/")
        }

        private fun reply(id: String, out: JSONObject) {
            try { web.evaluateJavascript("window.smartHome && smartHome.reply(\"$id\", $out)", null) } catch (e: Exception) {}
        }
    }
}
