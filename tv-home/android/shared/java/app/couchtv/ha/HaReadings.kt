package app.couchtv.ha

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

/**
 * What the smart home widgets read from Home Assistant, turned into the small answers the page gets
 * (HomeAssistant.kt answer()). Plain rules with no Android in them, so they are unit tested
 * (HaReadingsTest) against Home Assistant's own answers.
 *
 * The page only ever gets these few fields, never Home Assistant's whole state object: a name, an
 * on or off, a reading and its unit, a volume, a song's title, and readings by the hour.
 */
object HaReadings {
    class Named(val entity: String, val name: String)

    // Covers that open the house: never switched from a TV remote (locks and alarms are never even
    // allowed in config.json). A cover with one of these device classes reads "blocked", which the page
    // leaves out of every list (smarthome.js houseSafe), and "set" refuses it.
    val HOUSE_OPENERS = setOf("garage", "gate", "door")
    // Nothing that opens the house: a cover, switch, script or scene named for a garage, gate, door, lock or
    // alarm (or disarm). Joined words count (frontgate, backdoor, garagedoor, smartlock, unlock, garage2),
    // harmless ones do not (gateway, doorbell, indoor, outdoor, clock, block). The same test as
    // bridge/smarthome.py, home-config.py and smarthome.js/widgets.js; tests/fixtures/opens_house_ids.json
    // holds the ids every copy is tested with (HomeAssistantTest).
    val OPENS_HOUSE = Regex("(cover|switch|script|scene)\\.[a-z0-9_]*(garage|gate(?!way)|(?<![._]in)(?<![._]out)door(?!bell)|(?<![._]c)(?<![._]b)lock|alarm|disarm)[a-z0-9_]*")
    // a door, gate, garage door or lock as a reading: never listed (a doorbell is not one of these)
    val OPENING_SENSORS = setOf("door", "garage_door", "lock", "opening", "window")

    private fun slug(name: String) = name.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')

    /**
     * By its id, or by the name Home Assistant gives it (a switch called "Garage Door"): the same test on
     * domain + "." + the name in lower case with _ between words. Names in other languages are not caught.
     */
    fun opensHouse(entity: String, attrs: JSONObject?): Boolean {
        if (OPENS_HOUSE.matches(entity)) return true
        val n = slug(attrs?.optString("friendly_name").orEmpty())
        return n.isNotEmpty() && OPENS_HOUSE.matches(entity.substringBefore('.') + "." + n)
    }

    /** What a scene sets (Home Assistant lists it in its "entity_id" attribute). */
    fun sceneMembers(attrs: JSONObject?): List<String> {
        val l = attrs?.optJSONArray("entity_id") ?: return emptyList()
        return (0 until l.length()).map { l.optString(it) }
    }

    /**
     * A scene that sets a lock, an alarm, a group (it may hold locks), or a garage door, gate or door (by
     * its id, its name, or a blind whose device class says so) opens the house: never listed and never run
     * from a TV. [member] gives a blind's or switch's attributes, or null when they could not be read, and
     * then the scene counts as opening the house (bridge/smarthome.py scene_opens_house, the same).
     */
    fun sceneOpensHouse(attrs: JSONObject?, member: (String) -> JSONObject?): Boolean {
        for (e in sceneMembers(attrs)) {
            if (e.startsWith("lock.") || e.startsWith("alarm_control_panel.") || e.startsWith("group.") || OPENS_HOUSE.matches(e)) return true
            if (e.startsWith("cover.") || e.startsWith("switch.")) {
                val a = member(e) ?: return true
                if (opensHouse(e, a) || (e.startsWith("cover.") && a.optString("device_class") in HOUSE_OPENERS)) return true
            }
        }
        return false
    }

    /** One entity's attributes in Home Assistant's /api/states answer, or null. */
    fun attributes(states: JSONArray, entity: String): JSONObject? {
        for (k in 0 until states.length()) {
            val st = states.optJSONObject(k) ?: continue
            if (st.optString("entity_id") == entity) return st.optJSONObject("attributes") ?: JSONObject()
        }
        return null
    }

    private val UNIT = Regex("[^\\u0000-\\u001f<>]{1,12}")

    fun pretty(entity: String) =
        entity.substringAfter('.').replace('_', ' ').trim().replaceFirstChar { it.uppercase() }

    private fun base(n: Named, st: JSONObject?): JSONObject {
        val o = JSONObject().put("entity", n.entity)
        val friendly = st?.optJSONObject("attributes")?.optString("friendly_name").orEmpty().trim()
        return o.put("name", n.name.ifEmpty { friendly.ifEmpty { pretty(n.entity) } }.take(40))
    }

    private fun down(state: String?) = state == null || state == "unavailable" || state == "unknown"

    /** A light, switch, fan or blind as a Control Centre switch. */
    fun control(n: Named, st: JSONObject?): JSONObject {
        val o = base(n, st)
        val domain = n.entity.substringBefore('.')
        o.put("kind", domain)
        val a = st?.optJSONObject("attributes") ?: JSONObject()
        // a garage door, gate or door (by its class, id or name): never shown on the TV, never switched,
        // known even while it is not answering
        if ((domain == "cover" && a.optString("device_class") in HOUSE_OPENERS) || ((domain == "cover" || domain == "switch") && opensHouse(n.entity, a))) o.put("blocked", true)
        val state = st?.optString("state")
        if (st == null || down(state)) return o.put("ok", false)
        o.put("ok", true).put("state", state)
        when (domain) {
            "cover" -> {
                o.put("on", state == "open" || state == "opening")
                if (a.has("current_position") && !a.isNull("current_position")) o.put("level", a.optInt("current_position").coerceIn(0, 100))
            }
            "light" -> {
                o.put("on", state == "on")
                if (state == "on" && a.has("brightness") && !a.isNull("brightness")) o.put("level", Math.round(a.optDouble("brightness") / 255.0 * 100).toInt().coerceIn(1, 100))
            }
            "fan" -> {
                o.put("on", state == "on")
                if (state == "on" && a.has("percentage") && !a.isNull("percentage")) o.put("level", a.optInt("percentage").coerceIn(0, 100))
            }
            else -> o.put("on", state == "on")
        }
        return o
    }

    /** The Home Assistant service that switches a control, or null when it may not be switched. */
    fun service(entity: String, value: String, blocked: Boolean): Pair<String, String>? {
        if (blocked) return null
        val domain = entity.substringBefore('.')
        return when (domain) {
            "cover" -> when (value) { "open" -> "cover" to "open_cover"; "close" -> "cover" to "close_cover"; else -> null }
            "light", "switch", "fan" -> when (value) { "on" -> domain to "turn_on"; "off" -> domain to "turn_off"; else -> null }
            else -> null
        }
    }

    /** One sensor: what it reads now, and its unit. */
    fun sensor(n: Named, st: JSONObject?): JSONObject {
        val o = base(n, st)
        val state = st?.optString("state")
        if (st == null || down(state)) return o.put("ok", false)
        val a = st.optJSONObject("attributes") ?: JSONObject()
        o.put("ok", true).put("value", state!!.take(24))
        state.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { o.put("num", it) }
        a.optString("unit_of_measurement").takeIf { UNIT.matches(it) }?.let { o.put("unit", it) }
        a.optString("device_class").takeIf { it.matches(Regex("[a-z_]{1,32}")) }?.let { o.put("cls", it) }
        return o
    }

    // media_player supported_features (Home Assistant MediaPlayerEntityFeature)
    private const val PAUSE = 1
    private const val VOLUME_SET = 4
    private const val PLAY = 16384

    /** A speaker: playing or not, its volume, and the song. */
    fun speaker(n: Named, st: JSONObject?): JSONObject {
        val o = base(n, st)
        val state = st?.optString("state")
        if (st == null || down(state)) return o.put("ok", false)
        val a = st.optJSONObject("attributes") ?: JSONObject()
        val f = a.optInt("supported_features", 0)
        o.put("ok", true).put("state", state).put("can_volume", f and VOLUME_SET != 0).put("can_pause", f and (PAUSE or PLAY) != 0)
        if (a.has("volume_level") && !a.isNull("volume_level")) o.put("volume", Math.round(a.optDouble("volume_level") * 100).toInt().coerceIn(0, 100))
        if (a.optBoolean("is_volume_muted", false)) o.put("muted", true)
        a.optString("media_title").trim().takeIf { it.isNotEmpty() }?.let { o.put("title", it.take(80)) }
        (a.optString("media_artist").ifEmpty { a.optString("media_album_artist") }).trim().takeIf { it.isNotEmpty() }?.let { o.put("artist", it.take(80)) }
        return o
    }

    // ---------------------------------------------------------------- times

    /** Home Assistant's ISO 8601 times ("2026-11-18T03:04:05.123456+00:00", "...Z") as epoch ms. */
    fun parseTime(s: String?): Long? {
        val m = Regex("(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,9}))?)?(Z|[+-]\\d{2}:?\\d{2})?").matchEntire(s?.trim() ?: return null) ?: return null
        val g = m.groupValues
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        c.clear()
        c.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].ifEmpty { "0" }.toInt())
        var ms = c.timeInMillis + (g[7].ifEmpty { "0" }.padEnd(3, '0').take(3).toInt())
        val z = g[8]
        if (z.isNotEmpty() && z != "Z") {
            val d = z.replace(":", "")
            val off = (d.substring(1, 3).toInt() * 60 + d.substring(3, 5).toInt()) * 60_000L
            ms -= if (d[0] == '+') off else -off
        }
        return ms
    }

    /** The UTC time Home Assistant's history API takes in its path and query. */
    fun isoUtc(ms: Long): String {
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        c.timeInMillis = ms
        return String.format(java.util.Locale.ROOT, "%04d-%02d-%02dT%02d:%02d:%02dZ", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND))
    }

    /** Midnight today on the TV's own clock. */
    fun midnight(now: Long, tz: TimeZone = TimeZone.getDefault()): Long {
        val c = Calendar.getInstance(tz)
        c.timeInMillis = now
        c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    // ---------------------------------------------------------------- history

    /** Home Assistant's history answer (one list per entity) as (time, state) in time order. */
    fun points(history: JSONArray?): List<Pair<Long, String>> {
        val list = history?.optJSONArray(0) ?: return emptyList()
        val out = ArrayList<Pair<Long, String>>(list.length())
        for (i in 0 until list.length()) {
            val x = list.optJSONObject(i) ?: continue
            val t = parseTime(x.optString("last_changed").ifEmpty { x.optString("last_updated") }) ?: continue
            out.add(t to x.optString("state"))
        }
        out.sortBy { it.first }
        return out
    }

    private fun numbers(p: List<Pair<Long, String>>) =
        p.mapNotNull { (t, s) -> s.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { t to it } }

    /**
     * A sensor's last [hours] hours, one reading an hour: the mean of the readings in that hour, or the
     * reading it held from before (Home Assistant only writes a change). Null before the first reading.
     */
    fun hourlyMeans(p: List<Pair<Long, String>>, start: Long, hours: Int): Array<Double?> {
        val n = numbers(p)
        val out = arrayOfNulls<Double>(hours)
        var held: Double? = null
        var k = 0
        for (h in 0 until hours) {
            val from = start + h * 3_600_000L
            val to = from + 3_600_000L
            while (k < n.size && n[k].first < from) { held = n[k].second; k++ }
            var sum = 0.0; var cnt = 0
            while (k < n.size && n[k].first < to) { sum += n[k].second; cnt++; held = n[k].second; k++ }
            out[h] = if (cnt > 0) sum / cnt else held
        }
        return out
    }

    /** kWh for one unit of [unit] energy; null when it is not an energy unit. */
    private fun energyScale(unit: String) = when (unit.trim()) { "Wh" -> 0.001; "kWh" -> 1.0; "MWh" -> 1000.0; else -> null }
    /** kW for one unit of [unit] power; null when it is not a power unit. */
    private fun powerScale(unit: String) = when (unit.trim()) { "W" -> 0.001; "kW" -> 1.0; "MW" -> 1000.0; else -> null }

    /**
     * Today by the hour, in kWh, from midnight ([start]) to [now]: hours still to come are null.
     * An energy total (kWh, Wh) counts what it went up by in each hour; when it drops (the meter's
     * daily reset) the new reading counts from zero. A power reading (W, kW) is held until the next
     * one and added up over the hour. Null when the unit is neither.
     */
    fun energyHours(p: List<Pair<Long, String>>, start: Long, now: Long, unit: String): Array<Double?>? {
        val n = numbers(p)
        val hours = arrayOfNulls<Double>(24)
        val last = ((now - start) / 3_600_000L).toInt().coerceIn(0, 23)
        for (h in 0..last) hours[h] = 0.0
        val e = energyScale(unit)
        val w = powerScale(unit)
        if (e == null && w == null) return null
        fun add(at: Long, kwh: Double) {
            val h = ((at - start) / 3_600_000L).toInt()
            if (h in 0..last && kwh > 0) hours[h] = (hours[h] ?: 0.0) + kwh
        }
        if (e != null) {
            var prev: Double? = null
            for ((t, v) in n) {
                val before = prev
                prev = v
                if (before == null || t < start) continue
                add(t, (if (v >= before) v - before else v) * e)
            }
        } else {
            // each reading holds until the next (or until now), cut at the hour lines
            for (i in n.indices) {
                var from = maxOf(n[i].first, start)
                val to = minOf(if (i + 1 < n.size) n[i + 1].first else now, now)
                val kw = n[i].second * w!!
                while (from < to) {
                    val edge = minOf(to, start + (((from - start) / 3_600_000L) + 1) * 3_600_000L)
                    add(from, kw * (edge - from) / 3_600_000.0)
                    from = edge
                }
            }
        }
        return hours
    }

    /** When it last turned on (a doorbell that is on while it rings), or null. */
    fun lastOn(p: List<Pair<Long, String>>): Long? {
        var at: Long? = null
        var was = "off"
        for ((t, s) in p) { if (s == "on" && was != "on") at = t; was = s }
        return at
    }

    /** Readings to the page: numbers rounded to two places, gaps as null. */
    fun series(a: Array<Double?>): JSONArray {
        val out = JSONArray()
        for (v in a) out.put(if (v == null) JSONObject.NULL else Math.round(v * 100) / 100.0)
        return out
    }
}
