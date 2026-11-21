package app.couchtv.ha

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
 *   doorbell entity and the named camera's still picture. The smart home widgets (widgets.js,
 *   through smarthome.js) may also: read and switch a named light, switch, fan or blind (on, off,
 *   open, close; a garage door, gate or door blind is read but never switched), read a named
 *   sensor and its last 24 hours by the hour, read today's energy by the hour, read a named
 *   speaker and set its volume or play and pause it, get a still from a named camera (never
 *   video), and read when the doorbell last rang. Every call goes to the configured
 *   address only, never follows a redirect, and gives up after a few seconds, so a Home Assistant
 *   that is off never holds anything up. The token is never logged.
 *
 * Shared by the launcher (app.couchtv.launcher, through window.TVHA) and the on-TV app
 * (dev.couchtv.ontv, through its /api/ha endpoints). Two kinds of key are kept: a long-lived
 * access token ("token", from config.json or an older set up), or a refresh token from signing in
 * on a phone ("refresh_token" and the "client_id" it was made for, HaAuth.kt and HaPhone.kt). With
 * a refresh token the 30 minute access token is only ever held in memory.
 */
object HomeAssistant {
    private const val STORE = "ha"
    private const val KEY = "section"

    class Named(val entity: String, val name: String)
    class Bell(val entity: String, val camera: String?, val name: String)
    // the energy widget: one energy total (kWh) or power (W) sensor, and a home battery's charge if there is one
    class Energy(val entity: String, val name: String, val battery: String?)
    class Settings(val base: String, val token: String, val climate: List<Named>, val scenes: List<Named>, val doorbell: Bell?,
                   val controls: List<Named> = emptyList(), val cameras: List<Named> = emptyList(), val sensors: List<Named> = emptyList(),
                   val energy: Energy? = null, val speakers: List<Named> = emptyList(),
                   val refresh: String? = null, val client: String? = null)

    /** Called after the kept section changes (the launcher restarts its doorbell watch here). */
    @Volatile var changed: ((Context) -> Unit)? = null

    private val CLIMATE = Regex("climate\\.[a-z0-9_]{1,64}")
    private val SCENE = Regex("(scene|script)\\.[a-z0-9_]{1,64}")
    private val BELL = Regex("(binary_sensor|input_boolean|event)\\.[a-z0-9_]{1,64}")
    private val CAMERA = Regex("camera\\.[a-z0-9_]{1,64}")
    // Control Centre: lights, switches, fans and blinds. Never lock.*, alarm_control_panel.* or anything
    // else that opens the house; a cover that is a garage door, gate or door reads but is never switched.
    private val CONTROL = Regex("(light|switch|fan|cover)\\.[a-z0-9_]{1,64}")
    private val SENSOR = Regex("sensor\\.[a-z0-9_]{1,64}")
    private val SPEAKER = Regex("media_player\\.[a-z0-9_]{1,64}")
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
        // apply.sh sends "none" when config.json has no section: a set up made on the TV itself stays
        if ((v.isEmpty() || v == "none") && store(ctx).getBoolean("made_on_tv", false)) return
        val e = store(ctx).edit().remove("made_on_tv")
        val json = if (v.isEmpty() || v == "none") null else try {
            String(android.util.Base64.decode(v, android.util.Base64.DEFAULT), Charsets.UTF_8)
                .takeIf { parse(JSONObject(it)) != null }
        } catch (x: Exception) { null }
        if (json == null) e.remove(KEY) else e.putString(KEY, json)
        e.commit()
        cached = null; cachedFrom = null
        changed?.invoke(ctx)
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
        // signed in on a phone: a refresh token and the client id it was made for, no long-lived token
        val refresh = o.optString("refresh_token").trim().takeIf { TOKEN.matches(it) }
        val client = o.optString("client_id").trim().takeIf { refresh != null && cleanBase(it) != null }
        if (refresh != null && client == null) return null
        val token = o.optString("token").trim().takeIf { TOKEN.matches(it) } ?: if (refresh != null) "" else return null
        fun list(key: String, ok: Regex, most: Int): List<Named> {
            val a = o.optJSONArray(key) ?: return emptyList()
            val out = mutableListOf<Named>()
            for (k in 0 until a.length()) {
                if (out.size >= most) break
                val x = a.optJSONObject(k) ?: continue
                val ent = x.optString("entity").trim()
                if (!ok.matches(ent) || HaReadings.OPENS_HOUSE.matches(ent) || out.any { it.entity == ent }) continue
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
        val energy = o.optJSONObject("energy")?.let { e ->
            val ent = e.optString("entity").trim()
            val bat = e.optString("battery").trim().takeIf { it.isNotEmpty() }
            if (!SENSOR.matches(ent) || (bat != null && !SENSOR.matches(bat))) null
            else Energy(ent, e.optString("name").trim().take(40), bat)
        }
        return Settings(base, token, list("climate", CLIMATE, 8), list("scenes", SCENE, 10).filter { !OPENS_HOUSE.matches(it.entity) }, bell,
            list("controls", CONTROL, 16).filter { !OPENS_HOUSE.matches(it.entity) }, list("cameras", CAMERA, 4), list("sensors", SENSOR, 8), energy, list("speakers", SPEAKER, 6),
            if (token.isEmpty()) refresh else null, if (token.isEmpty()) client else null)
    }

    /** Parsed for tests (HomeAssistantTest): the same checks readExtras makes. */
    internal fun parseForTest(o: JSONObject): Settings? = parse(o)

    /** http(s)://host[:port][/path], nothing else: no user name, no query, no fragment. */
    internal fun cleanBase(u: String): String? = try {
        val url = URL(u.trim())
        if ((url.protocol != "http" && url.protocol != "https") || url.host.isNullOrEmpty() ||
            url.userInfo != null || url.query != null || url.ref != null) null
        else url.protocol + "://" + url.host + (if (url.port > 0) ":" + url.port else "") + url.path.trimEnd('/')
    } catch (e: Exception) { null }

    /**
     * The address and token a check uses. A typed token goes with the typed address. An empty token
     * means the one kept on this TV, and then only with the address kept with it: an empty or the same
     * address gives the kept pair; any other address gives an empty token (refused), so the kept token is
     * never sent to a new host.
     */
    internal fun keptFor(url: String, token: String, kept: Pair<String, String>?): Pair<String, String> {
        val t = token.trim()
        if (t.isNotEmpty()) return url to t
        if (kept == null) return url to ""
        val asked = if (url.isBlank()) kept.first else cleanBase(url)
        return if (asked != null && asked == cleanBase(kept.first)) kept.first to kept.second else url to ""
    }

    internal fun pretty(entity: String) =
        entity.substringAfter('.').replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

    // ---------------------------------------------------------------- talking to Home Assistant

    /** Tests put a pretend Home Assistant here (HomeAssistantTest); the app never sets it. */
    @Volatile internal var fake: ((method: String, path: String, body: JSONObject?) -> Pair<Int, ByteArray?>)? = null

    /** The bearer the last call sent (tests only, to check which token went). Never logged. */
    @Volatile internal var lastBearer: String? = null

    // Access tokens made from a refresh token: in memory only, by refresh token, with when they run out.
    private class Access(val token: String, val until: Long)
    private val access = ConcurrentHashMap<String, Access>()
    private val refreshing = Any()
    // A refresh token Home Assistant refused, and when: it is not tried again for a minute, and the TV
    // and the phone say "Sign in again" (status signin_again) until a new sign in.
    private val refused = ConcurrentHashMap<String, Long>()
    private const val REFUSED_WAIT_MS = 60_000L

    /** Home Assistant refused this set up's refresh token: the TV and the phone say "Sign in again". */
    internal fun signInAgain(s: Settings) = s.refresh != null && refused.containsKey(s.refresh)

    /** Keeps an access token just made (signing in), so the first calls need no refresh. */
    internal fun remember(refresh: String, t: HaAuth.Tokens) { access[refresh] = Access(t.access, clock() + t.expiresIn * 1000) }

    /**
     * The token for the Authorization header: the long-lived token as it is, or an access token made
     * from the refresh token, refreshed a minute before it runs out (or now, when [fresh]). Null:
     * Home Assistant did not answer (-1) or refused the refresh token (401: sign in again).
     */
    private fun bearer(s: Settings, fresh: Boolean): Pair<Int, String?> {
        val r = s.refresh ?: return 200 to s.token
        if (!fresh) access[r]?.takeIf { it.until > clock() + 60_000 }?.let { return 200 to it.token }
        refused[r]?.let { if (clock() - it < REFUSED_WAIT_MS) return 401 to null }
        synchronized(refreshing) {
            if (!fresh) access[r]?.takeIf { it.until > clock() + 60_000 }?.let { return 200 to it.token }
            refused[r]?.let { if (clock() - it < REFUSED_WAIT_MS) return 401 to null }
            val (code, t) = HaAuth.refresh(s.base, r, s.client ?: "")
            if (t == null) { if (code == 401) { access.remove(r); refused[r] = clock() }; return code to null }
            refused.remove(r)
            remember(r, t)
            return 200 to t.access
        }
    }

    /** One call. Returns the status code and the body (at most [limit] bytes), or -1 when it failed. */
    private fun call(s: Settings, method: String, path: String, body: JSONObject?, limit: Int): Pair<Int, ByteArray?> {
        val first = send(s, method, path, body, limit, false)
        // an access token Home Assistant no longer takes (it restarted, or the clock is off): one fresh try
        return if (first.first == 401 && s.refresh != null) send(s, method, path, body, limit, true) else first
    }

    private fun send(s: Settings, method: String, path: String, body: JSONObject?, limit: Int, fresh: Boolean): Pair<Int, ByteArray?> {
        val (ok, tok) = bearer(s, fresh)
        if (tok == null) return (if (ok == 401) 401 else -1) to null
        lastBearer = tok
        fake?.let { f -> return f(method, path, body).let { (code, b) -> if (b != null && b.size > limit) -1 to null else code to b } }
        var c: HttpURLConnection? = null
        return try {
            c = URL(s.base + path).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false   // the token only ever goes to the address in config.json
            c.connectTimeout = 3000
            c.readTimeout = 6000
            c.requestMethod = method
            c.setRequestProperty("Authorization", "Bearer $tok")
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

    // Home Assistant's own temperature unit ("°C" or "°F", from /api/config), read once per Home
    // Assistant address: every climate temperature it sends is in that unit, and the aircon widget
    // converts to the home's unit only when a room says which it is (widgets.js roomUnit)
    @Volatile private var unitFor: String? = null
    @Volatile private var unit: String = ""
    private fun haUnit(s: Settings): String {
        if (unitFor == s.base) return unit
        val (code, bytes) = call(s, "GET", "/api/config", null, 64 * 1024)
        if (code != 200 || bytes == null) return ""   // asked again next time
        val u = try { JSONObject(String(bytes, Charsets.UTF_8)).optJSONObject("unit_system")?.optString("temperature") ?: "" } catch (e: Exception) { "" }
        unit = if (u == "°C" || u == "°F") u else ""
        unitFor = s.base
        return unit
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
        return snapshot(s, cam, width)
    }

    /** A named camera's still picture (only a camera in config.json), shrunk to about [width] pixels wide. */
    fun snapshot(s: Settings, cam: String, width: Int): Bitmap? {
        if (s.cameras.none { it.entity == cam } && s.doorbell?.camera != cam) return null
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
    private class Limits(val min: Double, val max: Double, val step: Double, val modes: List<String>, val fans: List<String> = emptyList())
    // a fan speed is a short word Home Assistant's climate entity lists itself (low, medium, high, auto, ...)
    private val FAN = Regex("[A-Za-z0-9 _-]{1,24}")
    private val limits = ConcurrentHashMap<String, Limits>()

    private fun room(n: Named, st: JSONObject?, unit: String = ""): JSONObject {
        val o = JSONObject().put("entity", n.entity).put("name", n.name.ifEmpty { pretty(n.entity) })
        if (unit.isNotEmpty()) o.put("unit", unit)
        val state = st?.optString("state")
        if (st == null || state == null || state == "unavailable" || state == "unknown") return o.put("ok", false)
        val a = st.optJSONObject("attributes") ?: JSONObject()
        val max = a.optDouble("max_temp", 35.0)
        // Home Assistant only sends a step when the device has one: half a degree in Celsius, one in Fahrenheit
        val step = a.optDouble("target_temp_step", if (max > 50) 1.0 else 0.5).takeIf { it > 0 } ?: 0.5
        val min = a.optDouble("min_temp", 7.0)
        val modes = mutableListOf<String>()
        a.optJSONArray("hvac_modes")?.let { m -> for (k in 0 until m.length()) m.optString(k).takeIf { it in MODES }?.let { modes.add(it) } }
        val fans = mutableListOf<String>()
        a.optJSONArray("fan_modes")?.let { m -> for (k in 0 until minOf(m.length(), 8)) m.optString(k).takeIf { FAN.matches(it) }?.let { fans.add(it) } }
        limits[n.entity] = Limits(min, max, step, modes, fans)
        if (fans.isNotEmpty()) o.put("fan_modes", JSONArray(fans))
        a.optString("fan_mode").takeIf { it in fans }?.let { o.put("fan", it) }
        o.put("ok", true).put("state", state).put("min", min).put("max", max).put("step", step)
            .put("modes", JSONArray(modes)).put("action", a.optString("hvac_action"))
        if (a.has("current_temperature") && !a.isNull("current_temperature")) o.put("current", a.optDouble("current_temperature"))
        if (a.has("temperature") && !a.isNull("temperature")) o.put("target", a.optDouble("temperature"))
        if (a.has("target_temp_low") && !a.isNull("target_temp_low")) o.put("low", a.optDouble("target_temp_low"))
        if (a.has("target_temp_high") && !a.isNull("target_temp_high")) o.put("high", a.optDouble("target_temp_high"))
        if (n.name.isEmpty() && a.optString("friendly_name").isNotEmpty()) o.put("name", a.optString("friendly_name").take(40))
        return o
    }

    internal fun answer(s: Settings?, action: String, entity: String, value: String): JSONObject {
        if (s == null) return JSONObject().put("ok", false).put("error", "off")
        val refused = JSONObject().put("ok", false).put("error", "refused")
        val climate = s.climate.firstOrNull { it.entity == entity }
        val done = { ok: Boolean -> JSONObject().put("ok", ok).apply { if (!ok) put("error", "failed") } }
        val id = JSONObject().put("entity_id", entity)
        return when (action) {
            "climate" -> { val u = if (s.climate.isEmpty()) "" else haUnit(s); JSONObject().put("ok", true).put("rooms", JSONArray(s.climate.map { room(it, state(s, it.entity), u) })) }
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
            "fan" -> {
                climate ?: return refused
                val known = limits[entity]?.fans ?: return refused   // read the room first
                if (value !in known) return refused
                done(service(s, "climate", "set_fan_mode", id.put("fan_mode", value)))
            }
            "on", "off" -> {
                climate ?: return refused
                done(service(s, "climate", if (action == "on") "turn_on" else "turn_off", id))
            }
            "scene" -> {
                val sc = s.scenes.firstOrNull { it.entity == entity } ?: return refused
                // read first: a script or scene Home Assistant names for a garage, gate, door, lock or alarm,
                // or a scene that sets one, never runs from a TV (a failed read runs nothing)
                val failed = JSONObject().put("ok", false).put("error", "failed")
                val st = state(s, sc.entity) ?: return failed
                val a = st.optJSONObject("attributes") ?: JSONObject()
                if (HaReadings.opensHouse(sc.entity, a)) { refusedScenes.add(sc.entity); return refused }
                if (sc.entity.startsWith("scene.")) {
                    val members = HashMap<String, JSONObject>()
                    for (e in HaReadings.sceneMembers(a)) {
                        if ((e.startsWith("cover.") || e.startsWith("switch.")) && e !in members)
                            members[e] = state(s, e)?.let { it.optJSONObject("attributes") ?: JSONObject() } ?: return failed
                    }
                    if (HaReadings.sceneOpensHouse(a) { members[it] }) { refusedScenes.add(sc.entity); return refused }
                }
                done(service(s, sc.entity.substringBefore('.'), "turn_on", id))
            }
            else -> widgets(s, action, entity, value) ?: refused
        }
    }

    // ---------------------------------------------------------------- the smart home widgets

    // What was last read for each control (is it a garage door?) and speaker (can its volume be
    // set?), to check a switch or a volume against: nothing is switched that was not read first.
    private val readControls = ConcurrentHashMap<String, Boolean>()
    // scenes and scripts a run found open the house: info() leaves them out (bridge/smarthome.py refused_scenes)
    internal val refusedScenes: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val readSpeakers = ConcurrentHashMap<String, JSONObject>()
    internal var clock: () -> Long = { System.currentTimeMillis() }
    private const val HOUR = 3_600_000L

    private fun hx(l: List<Named>) = l.map { HaReadings.Named(it.entity, it.name) }

    /** One entity's history between two times, as (time, state), or null when Home Assistant did not answer. */
    private fun history(s: Settings, entity: String, from: Long, to: Long, limit: Int): List<Pair<Long, String>>? {
        val path = "/api/history/period/" + HaReadings.isoUtc(from) + "?filter_entity_id=" + entity +
            "&end_time=" + HaReadings.isoUtc(to) + "&minimal_response&no_attributes"
        val (code, bytes) = call(s, "GET", path, null, limit)
        if (code != 200 || bytes == null) return null
        return try { HaReadings.points(JSONArray(String(bytes, Charsets.UTF_8))) } catch (e: Exception) { null }
    }

    private fun widgets(s: Settings, action: String, entity: String, value: String): JSONObject? {
        val failed = JSONObject().put("ok", false).put("error", "failed")
        val refused = JSONObject().put("ok", false).put("error", "refused")
        val done = { ok: Boolean -> if (ok) JSONObject().put("ok", true) else failed }
        val id = JSONObject().put("entity_id", entity)
        return when (action) {
            "controls" -> JSONObject().put("ok", true).put("controls", JSONArray(hx(s.controls).map { n ->
                HaReadings.control(n, state(s, n.entity)).also { r -> if (r.optBoolean("ok") || r.optBoolean("blocked")) readControls[n.entity] = r.optBoolean("blocked") }
            }))
            "set" -> {
                if (s.controls.none { it.entity == entity }) return refused
                val blocked = readControls[entity] ?: return refused   // read it first
                val (domain, svc) = HaReadings.service(entity, value, blocked) ?: return refused
                done(service(s, domain, svc, id))
            }
            "sensors" -> JSONObject().put("ok", true).put("sensors", JSONArray(hx(s.sensors).map { HaReadings.sensor(it, state(s, it.entity)) }))
            "history" -> {
                if (s.sensors.none { it.entity == entity }) return refused
                val now = clock()
                val start = now / HOUR * HOUR - 23 * HOUR   // 24 hours, the last one is this hour
                val p = history(s, entity, start, now, 6 * 1024 * 1024) ?: return failed
                JSONObject().put("ok", true).put("start", start).put("points", HaReadings.series(HaReadings.hourlyMeans(p, start, 24)))
            }
            "energy" -> {
                val e = s.energy ?: return refused
                val st = state(s, e.entity) ?: return failed
                val unit = st.optJSONObject("attributes")?.optString("unit_of_measurement").orEmpty()
                val now = clock()
                val start = HaReadings.midnight(now)
                val p = history(s, e.entity, start, now, 6 * 1024 * 1024) ?: return failed
                val hours = HaReadings.energyHours(p, start, now, unit) ?: return JSONObject().put("ok", false).put("error", "unit")
                val o = JSONObject().put("ok", true).put("name", e.name.ifEmpty { st.optJSONObject("attributes")?.optString("friendly_name").orEmpty().take(40) })
                    .put("start", start).put("hours", HaReadings.series(hours)).put("total", Math.round(hours.sumOf { it ?: 0.0 } * 100) / 100.0)
                if (unit.trim() in listOf("W", "kW", "MW")) st.optString("state").toDoubleOrNull()?.takeIf { it.isFinite() }?.let { o.put("power", it).put("power_unit", unit.trim()) }
                e.battery?.let { b -> state(s, b)?.optString("state")?.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { o.put("battery", Math.round(it).toInt().coerceIn(0, 100)) } }
                o
            }
            "speakers" -> JSONObject().put("ok", true).put("speakers", JSONArray(hx(s.speakers).map { n ->
                HaReadings.speaker(n, state(s, n.entity)).also { r -> if (r.optBoolean("ok")) readSpeakers[n.entity] = r }
            }))
            "volume" -> {
                if (s.speakers.none { it.entity == entity }) return refused
                val r = readSpeakers[entity] ?: return refused   // read it first
                if (!r.optBoolean("can_volume")) return refused
                val v = value.toIntOrNull()?.coerceIn(0, 100) ?: return refused
                done(service(s, "media_player", "volume_set", id.put("volume_level", v / 100.0)))
            }
            "playpause" -> {
                if (s.speakers.none { it.entity == entity }) return refused
                val r = readSpeakers[entity] ?: return refused
                if (!r.optBoolean("can_pause")) return refused
                done(service(s, "media_player", "media_play_pause", id))
            }
            "bell" -> {
                val bell = s.doorbell ?: return refused
                val st = state(s, bell.entity) ?: return failed
                val state = st.optString("state")
                val now = clock()
                var ringing = false
                val fromHa = when {
                    bell.entity.startsWith("event.") -> HaReadings.parseTime(state)
                    state == "on" -> { ringing = true; HaReadings.parseTime(st.optString("last_changed")) }
                    // off now: when it last turned on, from the last week of its history (a small answer)
                    else -> history(s, bell.entity, now - 7 * 24 * HOUR, now, 512 * 1024)?.let { HaReadings.lastOn(it) }
                }
                val seen = DoorbellKept.at.takeIf { it > 0 }
                val at = listOfNotNull(fromHa, seen).maxOrNull()
                val friendly = st.optJSONObject("attributes")?.optString("friendly_name").orEmpty()
                JSONObject().put("ok", true).put("name", bell.name.ifEmpty { friendly.take(40) }).put("ringing", ringing)
                    .put("camera", bell.camera != null).put("kept", DoorbellKept.still != null).apply { if (at != null) put("at", at) }
            }
            "still" -> {
                // "doorbell": the doorbell's own camera (the page knows only that there is one)
                val cam = if (entity == "doorbell") s.doorbell?.camera ?: return refused else entity
                if (s.cameras.none { it.entity == cam } && s.doorbell?.camera != cam) return refused
                val w = value.toIntOrNull()?.coerceIn(160, 1280) ?: 640
                val bmp = snapshot(s, cam, w) ?: return failed
                JSONObject().put("ok", true).put("src", jpeg(bmp, w))
            }
            "ringstill" -> {
                if (s.doorbell == null) return refused
                val b = DoorbellKept.still ?: return JSONObject().put("ok", false).put("error", "none")
                JSONObject().put("ok", true).put("src", "data:image/jpeg;base64," + android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP))
                    .put("at", DoorbellKept.stillAt)
            }
            else -> null
        }
    }

    /** A still as a picture the page can draw, kept in memory only: never written anywhere. */
    private fun jpeg(bmp: Bitmap, width: Int): String {
        val b = if (bmp.width > width) Bitmap.createScaledBitmap(bmp, width, Math.max(1, bmp.height * width / bmp.width), true) else bmp
        val out = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.JPEG, 72, out)
        return "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
    }

    // ---------------------------------------------------------------- set up on the TV (no computer)
    //
    // Home settings, Smart home: the person types Home Assistant's address and pastes a token (the phone
    // remote's Type on the TV), the TV checks them and lists what Home Assistant has that couch-tv can
    // show, and the person ticks what they want. The section is then kept exactly as apply.sh would
    // keep it, so everything else (the checks, the allow lists, the doorbell) is unchanged. The page
    // hands the token over once; it is never handed back, and a later change of ticks reuses the kept one.

    private val PICKABLE = Regex("(climate|scene|script|light|switch|fan|cover|camera|sensor|media_player|event|binary_sensor|input_boolean)\\.[a-z0-9_]{1,64}")
    // nothing that opens the house: a cover, switch, script or scene named for a garage, gate, door,
    // lock or alarm is never listed, kept or switched (HaReadings.OPENS_HOUSE, the one test)
    private val OPENS_HOUSE = HaReadings.OPENS_HOUSE
    private const val MOST_LISTED = 400

    /** Home Assistant's /api/states, cut to what couch-tv can show: entity, name, and for a sensor its unit. */
    internal fun pickable(states: JSONArray): JSONArray {
        val out = mutableListOf<JSONObject>()
        for (k in 0 until states.length()) {
            val st = states.optJSONObject(k) ?: continue
            val ent = st.optString("entity_id")
            val a = st.optJSONObject("attributes") ?: JSONObject()
            if (!PICKABLE.matches(ent) || HaReadings.opensHouse(ent, a)) continue
            if (ent.startsWith("cover.") && a.optString("device_class") in HaReadings.HOUSE_OPENERS) continue
            if (ent.startsWith("scene.") && HaReadings.sceneOpensHouse(a) { HaReadings.attributes(states, it) }) continue
            // a door, gate or lock as a reading; a sensor with no unit named for one ("Front door lock")
            if (ent.startsWith("binary_sensor.") && a.optString("device_class") in HaReadings.OPENING_SENSORS) continue
            if (ent.startsWith("binary_sensor.") && a.optString("device_class").isEmpty() && HaReadings.opensHouse("switch." + ent.substringAfter('.'), a)) continue
            if (ent.startsWith("sensor.") && a.optString("unit_of_measurement").isEmpty() && HaReadings.opensHouse("switch." + ent.substringAfter('.'), a)) continue
            val o = JSONObject().put("entity", ent).put("name", a.optString("friendly_name").trim().take(40).ifEmpty { pretty(ent) })
            a.optString("unit_of_measurement").takeIf { it.length in 1..12 && !it.contains('<') }?.let { o.put("unit", it) }
            a.optString("device_class").takeIf { it.matches(Regex("[a-z_]{1,32}")) }?.let { o.put("cls", it) }
            out.add(o)
        }
        out.sortWith(compareBy({ it.optString("entity").substringBefore('.') }, { it.optString("name").lowercase() }))
        return JSONArray(out.take(MOST_LISTED))
    }

    /**
     * Checks an address and a token: { ok, entities } or { ok: false, error: "address" | "token" |
     * "unreachable" | "not_ha" }. Only the address typed is ever called, with no redirect followed.
     */
    fun check(url: String, token: String): JSONObject {
        val base = cleanBase(url) ?: return JSONObject().put("ok", false).put("error", "address")
        val tok = token.trim().takeIf { TOKEN.matches(it) } ?: return JSONObject().put("ok", false).put("error", "token")
        return listFor(Settings(base, tok, emptyList(), emptyList(), null))
    }

    /** What Home Assistant has that couch-tv can show, read with the kept key: { ok, entities } or { ok: false, error }. */
    fun listFor(s: Settings): JSONObject {
        val (code, body) = call(s, "GET", "/api/", null, 64 * 1024)
        when {
            code == 401 || code == 403 -> return JSONObject().put("ok", false).put("error", "token")
            code == -1 -> return JSONObject().put("ok", false).put("error", "unreachable")
            code != 200 || body == null || !String(body, Charsets.UTF_8).contains("API running") -> return JSONObject().put("ok", false).put("error", "not_ha")
        }
        val (c2, all) = call(s, "GET", "/api/states", null, 12 * 1024 * 1024)
        if (c2 != 200 || all == null) return JSONObject().put("ok", false).put("error", "unreachable")
        val list = try { pickable(JSONArray(String(all, Charsets.UTF_8))) } catch (e: Exception) { return JSONObject().put("ok", false).put("error", "not_ha") }
        listed = (0 until list.length()).associate { list.getJSONObject(it).let { e -> e.getString("entity") to e.optString("name") } }
        return JSONObject().put("ok", true).put("entities", list)
    }

    /** Keeps a section made on the TV, with the address and token it was checked with. False when it does not check out. */
    fun keep(ctx: Context, picks: JSONObject, base: String, token: String): Boolean {
        val o = rebuilt(picksOf(picks.toString()).put("url", base).put("token", token), settings(ctx)) ?: return false
        store(ctx).edit().putString(KEY, o.toString()).putBoolean("made_on_tv", true).commit()
        cached = null; cachedFrom = null
        changed?.invoke(ctx)
        return true
    }

    /** Smart home off on this TV: the section, address and token are gone. */
    fun forget(ctx: Context) {
        store(ctx).edit().remove(KEY).remove("made_on_tv").commit()
        cached = null; cachedFrom = null
        access.clear(); refused.clear(); listed = null
        changed?.invoke(ctx)
    }

    // ---------------------------------------------------------------- signed in on a phone (HaPhone.kt)

    /** The section's ticks only: everything but the address and the keys. */
    private fun picksOf(raw: String?): JSONObject {
        val o = try { JSONObject(raw ?: "{}") } catch (e: Exception) { JSONObject() }
        listOf("url", "token", "refresh_token", "client_id").forEach { o.remove(it) }
        return o
    }

    /**
     * The section for a sign in: the address, the refresh token and the client id it was made for.
     * The ticks kept before stay when it is the same Home Assistant, so signing in again changes no
     * widget. Pure, for tests.
     */
    internal fun signedInSection(old: String?, base: String, refresh: String, client: String): JSONObject {
        val oldBase = try { cleanBase(JSONObject(old ?: "{}").optString("url")) } catch (e: Exception) { null }
        val o = if (oldBase == base) picksOf(old) else JSONObject()
        return o.put("url", base).put("refresh_token", refresh).put("client_id", client)
    }

    /** Keeps a sign in made on a phone. False when Home Assistant gave no refresh token. */
    fun keepSignIn(ctx: Context, base: String, t: HaAuth.Tokens, client: String): Boolean {
        val r = t.refresh ?: return false
        val o = signedInSection(store(ctx).getString(KEY, null), base, r, client)
        if (parse(o) == null) return false
        remember(r, t)
        store(ctx).edit().putString(KEY, o.toString()).putBoolean("made_on_tv", true).commit()
        cached = null; cachedFrom = null
        changed?.invoke(ctx)
        return true
    }

    /** New ticks from the phone, kept with the address and key already kept. False when nothing is kept or they do not check out. */
    fun keepPicks(ctx: Context, picks: JSONObject): Boolean {
        val raw = store(ctx).getString(KEY, null) ?: return false
        val keys = try { JSONObject(raw) } catch (e: Exception) { return false }
        val o = picksOf(picks.toString())
        listOf("url", "token", "refresh_token", "client_id").forEach { k -> keys.optString(k).takeIf { it.isNotEmpty() }?.let { o.put(k, it) } }
        val section = rebuilt(o, settings(ctx)) ?: return false
        store(ctx).edit().putString(KEY, section.toString()).putBoolean("made_on_tv", true).commit()
        cached = null; cachedFrom = null
        changed?.invoke(ctx)
        return true
    }

    // What Home Assistant listed last (listFor), entity to its name: a save may only keep these, so a
    // garage door under a plain id (left out of the list by its device class) can never be kept.
    @Volatile private var listed: Map<String, String>? = null

    /** Tests: as if Home Assistant had just listed these. */
    internal fun listedForTest(m: Map<String, String>?) { listed = m }

    /**
     * The section to keep, made from what parsed (never the raw JSON from a page): only ids Home
     * Assistant listed last, each with the name kept before, else Home Assistant's own name. Null when
     * nothing was listed yet or it does not check out. Pure but for [listed], for tests.
     */
    internal fun rebuilt(o: JSONObject, old: Settings?): JSONObject? {
        val ok = listed ?: return null
        val s = parse(o) ?: return null
        val oldNames = old?.let { (it.climate + it.scenes + it.controls + it.cameras + it.sensors + it.speakers).associate { n -> n.entity to n.name } } ?: emptyMap()
        fun name(e: String, given: String) = given.ifEmpty { oldNames[e].orEmpty().ifEmpty { ok[e].orEmpty() } }.take(40)
        fun arr(l: List<Named>) = JSONArray(l.filter { it.entity in ok }.map { JSONObject().put("entity", it.entity).put("name", name(it.entity, it.name)) })
        val out = JSONObject().put("url", s.base)
        if (s.refresh != null) out.put("refresh_token", s.refresh).put("client_id", s.client) else out.put("token", s.token)
        out.put("climate", arr(s.climate)).put("scenes", arr(s.scenes)).put("controls", arr(s.controls))
            .put("cameras", arr(s.cameras)).put("sensors", arr(s.sensors)).put("speakers", arr(s.speakers))
        s.doorbell?.takeIf { it.entity in ok && (it.camera == null || it.camera in ok) }?.let { b ->
            out.put("doorbell", JSONObject().put("entity", b.entity).put("name", name(b.entity, b.name)).apply { b.camera?.let { put("camera", it) } })
        }
        s.energy?.takeIf { it.entity in ok && (it.battery == null || it.battery in ok) }?.let { e ->
            out.put("energy", JSONObject().put("entity", e.entity).put("name", name(e.entity, e.name)).apply { e.battery?.let { put("battery", it) } })
        }
        return if (parse(out) != null) out else null
    }

    /** Disconnect: Home Assistant forgets this TV's refresh token (when it is one), then this TV forgets everything. */
    fun disconnect(ctx: Context) {
        settings(ctx)?.let { s -> s.refresh?.let { r -> try { HaAuth.revoke(s.base, r) } catch (e: Exception) {} } }
        forget(ctx)
    }

    /** What the page may know: names only, no address, no token (window.TVHA info(), /api/ha/info). */
    fun info(ctx: Context): JSONObject {
        val s = settings(ctx) ?: return JSONObject()
        fun names(l: List<Named>) = JSONArray(l.map { JSONObject().put("entity", it.entity).put("name", it.name.ifEmpty { pretty(it.entity) }) })
        return JSONObject().put("climate", names(s.climate)).put("scenes", names(s.scenes.filter { it.entity !in refusedScenes }))
            .put("doorbell", s.doorbell != null)
            .put("controls", names(s.controls.filter { readControls[it.entity] != true })).put("cameras", names(s.cameras)).put("sensors", names(s.sensors))
            .put("speakers", names(s.speakers)).put("energy", s.energy != null)
            .put("doorbell_camera", s.doorbell?.camera != null)
    }

    /** What the set up screen shows: the host only (never the token or the whole address) and what is ticked. */
    fun status(ctx: Context): JSONObject {
        val s = settings(ctx) ?: return JSONObject().put("set", false)
        fun ids(l: List<Named>) = JSONArray(l.map { it.entity })
        val count = s.climate.size + s.scenes.size + s.controls.size + s.cameras.size + s.sensors.size + s.speakers.size +
            (if (s.doorbell != null) 1 else 0) + (if (s.energy != null) 1 else 0)
        return JSONObject().put("set", true).put("host", try { URL(s.base).host } catch (e: Exception) { "" })
            .put("made_on_tv", store(ctx).getBoolean("made_on_tv", false))
            .put("signed_in", s.refresh != null).put("count", count)
            .put("signin_again", signInAgain(s))
            .put("climate", ids(s.climate)).put("scenes", ids(s.scenes)).put("controls", ids(s.controls)).put("cameras", ids(s.cameras))
            .put("sensors", ids(s.sensors)).put("speakers", ids(s.speakers)).put("energy", s.energy?.entity ?: "").put("battery", s.energy?.battery ?: "")
            .put("doorbell", s.doorbell?.entity ?: "").put("doorbell_camera", s.doorbell?.camera ?: "")
    }

    /** The page's question, answered as the launcher would (tests: HomeAssistantTest). */
    internal fun answerForTest(s: Settings?, action: String, entity: String, value: String): JSONObject = answer(s, action, entity, value)
}

/**
 * The last ring this TV saw, for the Doorbell widget (HomeAssistant.kt "bell" and "ringstill"): its
 * time and the door camera's first still from it. Kept in memory only, never written anywhere, and
 * gone when the app restarts or the doorbell is taken out. The launcher's Doorbell.kt fills it.
 */
object DoorbellKept {
    @Volatile var at = 0L
    @Volatile var still: ByteArray? = null
    @Volatile var stillAt = 0L
    fun clear() { at = 0L; still = null; stillAt = 0L }
}
