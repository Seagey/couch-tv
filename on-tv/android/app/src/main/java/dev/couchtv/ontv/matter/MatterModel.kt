package dev.couchtv.ontv.matter

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Plain Kotlin, no Matter library: turns what a Matter device reports into the smart home device
 * model the TV page already reads for Home Assistant (docs in matter-contract.md, "Device model"):
 *
 *   { id: "matter:<node>:<endpoint>", name, domain, state, attributes }
 *
 * with Home Assistant's attribute names (brightness, color_temp_kelvin, percentage, current_position,
 * current_temperature, temperature, hvac_modes, unit_of_measurement, device_class ...), and plans the
 * Matter command or attribute write for each action. Locks, alarms, garage doors and gates are never
 * listed and never controlled, the same rule as Home Assistant (AGENTS.md, Smart home).
 *
 * A node's data is kept as endpoint -> cluster -> attribute -> value, the values as the controller's
 * JSON report gives them (see [valueOf]).
 */
/** A node's reported values: endpoint to cluster to attribute to value. */
typealias MatterNode = Map<Int, Map<Long, Map<Long, Any?>>>

object MatterModel {
    // ---- clusters
    const val DESCRIPTOR = 0x001DL
    const val BASIC = 0x0028L
    const val BRIDGED_BASIC = 0x0039L
    const val ON_OFF = 0x0006L
    const val LEVEL = 0x0008L
    const val COLOR = 0x0300L
    const val FAN = 0x0202L
    const val COVER = 0x0102L
    const val THERMOSTAT = 0x0201L
    const val TEMPERATURE = 0x0402L
    const val HUMIDITY = 0x0405L
    const val ILLUMINANCE = 0x0400L
    const val OCCUPANCY = 0x0406L
    const val BOOLEAN_STATE = 0x0045L
    const val AIR_QUALITY = 0x005BL
    const val PM25 = 0x042AL
    const val DOOR_LOCK = 0x0101L
    const val SMOKE_CO_ALARM = 0x005CL
    const val CLOSURE_CONTROL = 0x0104L
    const val CLOSURE_DIMENSION = 0x0105L

    /** Clusters that mean "this opens the house or is an alarm": never shown, never controlled. */
    val BLOCKED_CLUSTERS = setOf(DOOR_LOCK, SMOKE_CO_ALARM, CLOSURE_CONTROL, CLOSURE_DIMENSION)

    // ---- device types (Matter device library)
    val LIGHT_TYPES = setOf(0x0100L, 0x0101L, 0x010CL, 0x010DL)
    val SWITCH_TYPES = setOf(0x010AL, 0x010BL, 0x0110L, 0x0111L)
    const val FAN_TYPE = 0x002BL
    const val COVER_TYPE = 0x0202L
    val CLIMATE_TYPES = setOf(0x0301L, 0x0072L)
    val SENSOR_TYPES = setOf(0x0302L, 0x0307L, 0x0106L, 0x0107L, 0x0015L, 0x002CL)
    /** Door lock, door lock controller, smoke/CO alarm, closure, closure panel, closure controller. */
    val BLOCKED_TYPES = setOf(0x000AL, 0x000BL, 0x0076L, 0x0230L, 0x0231L, 0x023EL)
    /**
     * A name that says the thing opens the house: a garage door, a gate, a door or a lock, as whole words
     * ("Outdoor blind", "Margate blind" and "Block out blind" are blinds), in every language the home
     * speaks: English, German, Dutch, French, Spanish, Italian, Portuguese, Turkish, Serbian (Latin),
     * Polish, Czech, Hebrew and Arabic. The same list as the bridge (bridge/matter.py OPENS_HOUSE_WORDS),
     * word for word, so both hide the same devices. `\w` there is Python's Unicode word character: here
     * [WORD] (Android's regex has no UNICODE_CHARACTER_CLASS).
     */
    val OPENS_HOUSE_WORDS = listOf(
        """garages?""", """gates?""", """doors?""", """locks?""",                                              // en
        """garagen\w*""", """tore?""", """\w*(?:tür|tuer)(?:e|en)?""", """\w*schlo(?:ss|ß)""",                 // de
        """\w*(?:einfahrts|hof|garten|roll|schiebe|flügel|fluegel)tore?""",
        """(?:voor|achter|garage|zij|tuin|schuif|kantel|rol|kelder|balkon|terras)?deur(?:en)?""",       // nl
        """(?:garage|toegangs|tuin|rol|schuif|inrit)?poort(?:en)?""", """slot(?:en)?""", """(?:tuin|toegangs|schuif|draai|inrit)?hek(?:ken)?""",
        """portails?""", """portes?""", """serrures?""", """barrières?""",                                      // fr
        """garajes?""", """cocheras?""", """puertas?""", """port[oó]n(?:es)?""", """verjas?""", """cerraduras?""",    // es
        """cancelas?""", """cerrojos?""",
        """portas?""", """portone""", """portoni""", """cancell[oi]""", """serratur[ae]""", """basculante""",          // it
        """garage[mn]s?""", """port[ãa]o""", """port[õo]es""", """fechaduras?""",                                // pt
        """garaj\w*""", """kap[ıi]\w*""", """kilit\w*""", """kilid\w*""",                                        // tr
        """gara[žżz]\w*""", """kapij\w*""", """vrata""", """brav[au]""",                                          // sr, pl, cs
        """bram(?:a|y|ę|ie|ą|ka|ki|kę)?""", """drzwi""", """zam(?:ek|ka|ku|ki|kiem)""",
        """gar[áa][žz]\w*""", """br[áa]n(?:a|y|u|ou|ě)""", """dve[řr]\w*""", """z[áa]m(?:ek|ku|ky|kem)""",
        """[הבלמו]?(?:מוסך|שער|דלת|מנעול)""",                                                         // he
        """(?:ال)?(?:مرآب|كراج|جراج|بوابة|باب|قفل)""",                                                  // ar
    )
    private const val WORD = """[\p{L}\p{M}\p{N}_]"""
    private val OPENS_HOUSE: Regex = java.util.regex.Pattern.compile(
        "(?<!$WORD)(?:" + OPENS_HOUSE_WORDS.joinToString("|").replace("""\w""", WORD) + ")(?!$WORD)",
        java.util.regex.Pattern.CASE_INSENSITIVE or java.util.regex.Pattern.UNICODE_CASE).toRegex()

    /**
     * A typed name, tidied: control characters (new lines, tabs) become spaces, format characters (zero
     * width marks, direction marks) go, so "Gar<zero width space>age" is "Garage"; spaces collapsed.
     */
    fun cleanName(raw: String?): String =
        raw.orEmpty().replace(Regex("""\p{Cc}"""), " ").replace(Regex("""\p{Cf}"""), "").replace(Regex("""\s+"""), " ").trim()

    private val CAMEL = Regex("""(?<=[a-zà-ÿ])(?=[A-ZÀ-Þ])""")
    private val DIGITS = Regex("""[\d_]+""")

    /**
     * Joined names count too ("GarageDoor", "Garage2", "MyGarage", "Gate_1", "Door1"): CamelCase is split
     * and digits and underscores become spaces before the whole word match (the bridge does the same).
     */
    fun opensHouse(name: String?): Boolean {
        if (name.isNullOrEmpty()) return false
        val s = DIGITS.replace(CAMEL.replace(cleanName(name), " "), " ")
        return OPENS_HOUSE.containsMatchIn(s)
    }

    /**
     * True when a blind, a plug or an on/off only light is called a garage door, gate, door or lock (a
     * garage door opener is usually one of those): never shown, never switched. Same rule as the bridge.
     */
    fun hiddenByName(domain: String?, ep: Map<Long, Map<Long, Any?>>, name: String?): Boolean {
        val clusters = servers(ep)
        val opener = domain == "cover" || domain == "switch" || (domain == "light" && LEVEL !in clusters && COLOR !in clusters)
        return opener && opensHouse(name)
    }

    /** The attributes the controller subscribes to on every node (wildcard endpoint), as cluster to attribute ids. */
    val SUBSCRIBE: Map<Long, List<Long>> = linkedMapOf(
        DESCRIPTOR to listOf(0L, 1L, 3L),
        BASIC to listOf(1L, 3L, 5L),
        BRIDGED_BASIC to listOf(1L, 3L, 5L, 0x11L),
        ON_OFF to listOf(0L),
        LEVEL to listOf(0L, 2L, 3L),
        COLOR to listOf(0L, 1L, 7L, 8L, 0x400BL, 0x400CL, 0xFFFCL),
        FAN to listOf(0L, 2L, 3L),
        COVER to listOf(0L, 0x0EL),
        THERMOSTAT to listOf(0L, 0x11L, 0x12L, 0x15L, 0x16L, 0x17L, 0x18L, 0x1CL, 0x29L, 0xFFFCL),
        TEMPERATURE to listOf(0L),
        HUMIDITY to listOf(0L),
        ILLUMINANCE to listOf(0L),
        OCCUPANCY to listOf(0L),
        BOOLEAN_STATE to listOf(0L),
        AIR_QUALITY to listOf(0L),
        PM25 to listOf(0L),
    )

    // ---------------------------------------------------------------- reading reports

    /**
     * One attribute's value from the controller's JSON report (AttributeState.getJson()): an object
     * with a single key "<attribute id>:<TYPE>". Structs come back as maps keyed by context tag, arrays
     * as lists, big unsigned numbers (sent as strings) as Long. Null when the report holds no value.
     */
    fun valueOf(json: JSONObject?): Any? {
        if (json == null) return null
        val k = json.keys().asSequence().firstOrNull() ?: return null
        return convert(json.opt(k), k.substringAfter(':', ""))
    }

    private fun convert(v: Any?, type: String): Any? = when {
        v == null || v == JSONObject.NULL -> null
        type.startsWith("ARRAY") && v is JSONArray -> {
            val sub = type.substringAfter('-', "")
            (0 until v.length()).map { convert(v.opt(it), sub) }
        }
        type == "STRUCT" && v is JSONObject -> v.keys().asSequence().associate { key ->
            key.substringBefore(':').toLong() to convert(v.opt(key), key.substringAfter(':', ""))
        }
        (type == "UINT" || type == "INT") && v is String -> v.toLongOrNull() ?: v
        v is Int -> v.toLong()
        else -> v
    }

    // ---------------------------------------------------------------- the device list

    fun id(node: Long, endpoint: Int) = "matter:${java.lang.Long.toUnsignedString(node)}:$endpoint"

    /** "matter:<node>:<endpoint>" back to (node, endpoint), or null for anything else. */
    fun parseId(id: String): Pair<Long, Int>? {
        val p = id.split(':')
        if (p.size != 3 || p[0] != "matter") return null
        val node = java.lang.Long.parseUnsignedLong(p[1].ifEmpty { return null }.takeIf { s -> s.all { it.isDigit() } } ?: return null)
        val ep = p[2].toIntOrNull()?.takeIf { it in 0..0xFFFE } ?: return null
        return node to ep
    }

    private fun Map<Long, Map<Long, Any?>>.attr(cluster: Long, attr: Long): Any? = this[cluster]?.get(attr)
    private fun num(v: Any?): Double? = (v as? Number)?.toDouble()
    private fun long(v: Any?): Long? = (v as? Number)?.toLong()

    /** The device types an endpoint says it is (Descriptor DeviceTypeList: a list of {0: type, 1: revision}). */
    fun deviceTypes(ep: Map<Long, Map<Long, Any?>>): Set<Long> =
        (ep.attr(DESCRIPTOR, 0L) as? List<*>)?.mapNotNull { s -> long((s as? Map<*, *>)?.get(0L)) }?.toSet() ?: emptySet()

    private fun servers(ep: Map<Long, Map<Long, Any?>>): Set<Long> =
        (ep.attr(DESCRIPTOR, 1L) as? List<*>)?.mapNotNull { long(it) }?.toSet() ?: ep.keys

    /**
     * The domain for one endpoint, or null when it is not something the TV shows (or is blocked).
     * [names]: the device's own name and the name the person gave it; either one that opens the house
     * hides it (so a rename can never bring a garage door back).
     */
    fun domainOf(ep: Map<Long, Map<Long, Any?>>, vararg names: String?): String? {
        val types = deviceTypes(ep)
        val clusters = servers(ep)
        if (types.any { it in BLOCKED_TYPES } || clusters.any { it in BLOCKED_CLUSTERS }) return null
        val d = when {
            types.any { it in LIGHT_TYPES } -> "light"
            types.any { it in SWITCH_TYPES } -> "switch"
            FAN_TYPE in types -> "fan"
            COVER_TYPE in types -> "cover"
            types.any { it in CLIMATE_TYPES } -> "climate"
            types.any { it in SENSOR_TYPES } -> "sensor"
            types.isNotEmpty() && types.all { it == 0x0013L || it == 0x000EL || it == 0x0016L || it == 0x0011L } -> null   // bridged node, aggregator, root, power source
            // no known device type: go by what it serves
            COLOR in clusters || (LEVEL in clusters && ON_OFF in clusters) -> "light"
            THERMOSTAT in clusters -> "climate"
            FAN in clusters -> "fan"
            COVER in clusters -> "cover"
            ON_OFF in clusters -> "switch"
            clusters.any { it in SENSOR_CLUSTERS } -> "sensor"
            else -> null
        }
        if (names.any { hiddenByName(d, ep, it) }) return null   // a garage door, gate, door or lock made as a blind, plug or plain light
        return d
    }
    private val SENSOR_CLUSTERS = listOf(TEMPERATURE, HUMIDITY, ILLUMINANCE, OCCUPANCY, BOOLEAN_STATE, AIR_QUALITY, PM25)

    /** The name to show: the person's own name for it, else the bridged or node label, else the product. */
    fun nameOf(node: MatterNode, endpoint: Int, custom: String?): String {
        if (!custom.isNullOrBlank()) return custom
        val ep = node[endpoint] ?: emptyMap()
        val root = node[0] ?: emptyMap()
        val pick = listOf(ep.attr(BRIDGED_BASIC, 5L), ep.attr(BRIDGED_BASIC, 3L), root.attr(BASIC, 5L), root.attr(BASIC, 3L))
            .map { cleanName(it as? String) }.firstOrNull { it.isNotEmpty() }
        val base = pick ?: "Matter device"
        // more than one thing on the same node: say which one
        val shown = node.keys.count { it != 0 && domainOf(node[it] ?: emptyMap()) != null }
        return if (shown > 1 && ep.attr(BRIDGED_BASIC, 5L) == null && ep.attr(BRIDGED_BASIC, 3L) == null) "$base $endpoint" else base
    }

    /**
     * Every device the TV can show for one node. [reachable] false (the node does not answer) gives
     * state "unavailable" with the last known attributes. [names] holds names the person chose, by id.
     */
    fun devices(nodeId: Long, node: MatterNode, reachable: Boolean, names: Map<String, String> = emptyMap()): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        for (endpoint in node.keys.sorted()) {
            if (endpoint == 0 && node.size > 1 && deviceTypes(node[0]!!).let { it.isEmpty() || it.all { t -> t == 0x0016L || t == 0x0011L || t == 0x0012L } }) continue
            val ep = node[endpoint] ?: continue
            val id = id(nodeId, endpoint)
            val name = nameOf(node, endpoint, names[id])
            val domain = domainOf(ep, nameOf(node, endpoint, null), name) ?: continue
            val bridgedReachable = ep.attr(BRIDGED_BASIC, 0x11L) as? Boolean
            val a = JSONObject().put("friendly_name", name)
            var state = describe(domain, ep, a)
            if (!reachable || bridgedReachable == false) state = "unavailable"
            out.add(JSONObject().put("id", id).put("name", name).put("domain", domain).put("state", state).put("attributes", a))
        }
        return out
    }

    /** Fills [a] with Home Assistant style attributes and gives the state. */
    fun describe(domain: String, ep: Map<Long, Map<Long, Any?>>, a: JSONObject): String {
        val on = ep.attr(ON_OFF, 0L) as? Boolean
        return when (domain) {
            "light" -> {
                long(ep.attr(LEVEL, 0L))?.let { lv ->
                    val b = (lv.coerceIn(0, 254) * 255.0 / 254).roundToInt()
                    a.put("brightness", b).put("level", (lv.coerceIn(0, 254) * 100.0 / 254).roundToInt())
                }
                long(ep.attr(COLOR, 7L))?.takeIf { it > 0 }?.let { a.put("color_temp_kelvin", (1_000_000.0 / it).roundToInt()) }
                long(ep.attr(COLOR, 0x400CL))?.takeIf { it > 0 }?.let { a.put("min_color_temp_kelvin", (1_000_000.0 / it).roundToInt()) }
                long(ep.attr(COLOR, 0x400BL))?.takeIf { it > 0 }?.let { a.put("max_color_temp_kelvin", (1_000_000.0 / it).roundToInt()) }
                val hue = long(ep.attr(COLOR, 0L)); val sat = long(ep.attr(COLOR, 1L))
                if (hue != null && sat != null) a.put("hs_color", JSONArray().put((hue * 360.0 / 254).roundToInt()).put((sat * 100.0 / 254).roundToInt()))
                val modes = JSONArray()
                if (ep.containsKey(COLOR)) {
                    val fm = long(ep.attr(COLOR, 0xFFFCL)) ?: 0
                    if (fm and 0x1L != 0L || hue != null) modes.put("hs")
                    if (fm and 0x10L != 0L || ep.attr(COLOR, 7L) != null) modes.put("color_temp")
                }
                if (modes.length() == 0) modes.put(if (ep.containsKey(LEVEL)) "brightness" else "onoff")
                a.put("supported_color_modes", modes)
                if (on == true) "on" else if (on == false) "off" else "unknown"
            }
            "switch" -> if (on == true) "on" else if (on == false) "off" else "unknown"
            "fan" -> {
                val pct = long(ep.attr(FAN, 3L)) ?: long(ep.attr(FAN, 2L))
                pct?.let { a.put("percentage", it.coerceIn(0, 100)) }
                val mode = long(ep.attr(FAN, 0L))
                when {
                    on != null -> if (on) "on" else "off"
                    mode != null -> if (mode == 0L) "off" else "on"
                    pct != null -> if (pct > 0) "on" else "off"
                    else -> "unknown"
                }
            }
            "cover" -> {
                // Matter counts how far it is closed (0 = open, 10000 = closed); Home Assistant how far it is open
                val closed100 = long(ep.attr(COVER, 0x0EL))
                if (closed100 != null) {
                    val pos = 100 - (closed100.coerceIn(0, 10000) / 100.0).roundToInt()
                    a.put("current_position", pos)
                    if (pos <= 0) "closed" else "open"
                } else "unknown"
            }
            "climate" -> {
                num(ep.attr(THERMOSTAT, 0L))?.let { a.put("current_temperature", it / 100.0) }
                val mode = long(ep.attr(THERMOSTAT, 0x1CL))
                val fm = long(ep.attr(THERMOSTAT, 0xFFFCL)) ?: 0x3L
                val heat = fm and 0x1L != 0L; val cool = fm and 0x2L != 0L
                val hs = num(ep.attr(THERMOSTAT, 0x12L)); val cs = num(ep.attr(THERMOSTAT, 0x11L))
                val setpoint = when (mode) { 3L, 6L -> cs; 4L, 5L -> hs; else -> hs ?: cs }
                setpoint?.let { a.put("temperature", it / 100.0) }
                if (mode == 1L && hs != null && cs != null) a.put("target_temp_low", hs / 100.0).put("target_temp_high", cs / 100.0)
                val lows = listOfNotNull(if (heat) num(ep.attr(THERMOSTAT, 0x15L)) else null, if (cool) num(ep.attr(THERMOSTAT, 0x17L)) else null)
                val highs = listOfNotNull(if (heat) num(ep.attr(THERMOSTAT, 0x16L)) else null, if (cool) num(ep.attr(THERMOSTAT, 0x18L)) else null)
                a.put("min_temp", (lows.minOrNull() ?: 700.0) / 100.0).put("max_temp", (highs.maxOrNull() ?: 3500.0) / 100.0)
                a.put("target_temp_step", 0.5)
                val modes = JSONArray().put("off")
                if (heat) modes.put("heat"); if (cool) modes.put("cool"); if (heat && cool && fm and 0x20L != 0L) modes.put("heat_cool")
                if (mode == 7L) modes.put("fan_only"); if (mode == 8L) modes.put("dry")
                a.put("hvac_modes", modes)
                val run = long(ep.attr(THERMOSTAT, 0x29L))
                a.put("hvac_action", when {
                    mode == 0L -> "off"
                    run == null -> if (mode == 4L) "heating" else if (mode == 3L) "cooling" else "idle"
                    run and 0x9L != 0L -> "heating"
                    run and 0x12L != 0L -> "cooling"
                    run and 0x24L != 0L -> "fan"
                    else -> "idle"
                })
                SYSTEM_MODES[mode] ?: "unknown"
            }
            "sensor" -> sensor(ep, a)
            else -> "unknown"
        }
    }

    /** Thermostat SystemMode values to Home Assistant hvac modes (and back, [systemModeFor]). */
    val SYSTEM_MODES = mapOf(0L to "off", 1L to "heat_cool", 3L to "cool", 4L to "heat", 5L to "heat", 6L to "cool", 7L to "fan_only", 8L to "dry", 9L to "auto")
    fun systemModeFor(hvac: String): Long? = when (hvac) {
        "off" -> 0L; "heat_cool", "auto" -> 1L; "cool" -> 3L; "heat" -> 4L; "fan_only" -> 7L; "dry" -> 8L; else -> null
    }

    private val AIR = listOf("unknown", "good", "fair", "moderate", "poor", "very_poor", "extremely_poor")

    private fun fmt(d: Double): String = if (d == Math.floor(d) && kotlin.math.abs(d) < 1e9) d.toLong().toString() else "%.1f".format(java.util.Locale.ROOT, d)

    private fun sensor(ep: Map<Long, Map<Long, Any?>>, a: JSONObject): String {
        val types = deviceTypes(ep)
        val order = when {
            0x0302L in types -> TEMPERATURE; 0x0307L in types -> HUMIDITY; 0x0106L in types -> ILLUMINANCE
            0x0107L in types -> OCCUPANCY; 0x0015L in types -> BOOLEAN_STATE; 0x002CL in types -> AIR_QUALITY
            else -> SENSOR_CLUSTERS.firstOrNull { ep.containsKey(it) }
        }
        // a second reading on the same endpoint (a temperature and humidity sensor) rides along
        if (order != HUMIDITY) num(ep.attr(HUMIDITY, 0L))?.let { a.put("humidity", it / 100.0) }
        if (order != TEMPERATURE) num(ep.attr(TEMPERATURE, 0L))?.let { a.put("temperature", it / 100.0) }
        return when (order) {
            TEMPERATURE -> { a.put("device_class", "temperature").put("unit_of_measurement", "°C").put("state_class", "measurement")
                num(ep.attr(TEMPERATURE, 0L))?.let { fmt(it / 100.0) } ?: "unknown" }
            HUMIDITY -> { a.put("device_class", "humidity").put("unit_of_measurement", "%").put("state_class", "measurement")
                num(ep.attr(HUMIDITY, 0L))?.let { fmt(it / 100.0) } ?: "unknown" }
            ILLUMINANCE -> { a.put("device_class", "illuminance").put("unit_of_measurement", "lx").put("state_class", "measurement")
                num(ep.attr(ILLUMINANCE, 0L))?.let { if (it <= 0) "0" else fmt(10.0.pow((it - 1) / 10000.0).roundToInt().toDouble()) } ?: "unknown" }
            OCCUPANCY -> { a.put("device_class", "occupancy")
                long(ep.attr(OCCUPANCY, 0L))?.let { if (it and 1L != 0L) "on" else "off" } ?: "unknown" }
            BOOLEAN_STATE -> { a.put("device_class", "contact")
                // StateValue true: in contact (the door is shut); Home Assistant's contact is "on" when open
                (ep.attr(BOOLEAN_STATE, 0L) as? Boolean)?.let { a.put("reading", if (it) "closed" else "open"); if (it) "off" else "on" } ?: "unknown" }
            AIR_QUALITY -> { a.put("device_class", "aqi")
                num(ep.attr(PM25, 0L))?.let { a.put("pm25", it) }
                long(ep.attr(AIR_QUALITY, 0L))?.let { AIR.getOrElse(it.toInt()) { "unknown" } } ?: "unknown" }
            PM25 -> { a.put("device_class", "pm25").put("unit_of_measurement", "µg/m³")
                num(ep.attr(PM25, 0L))?.let { fmt(it) } ?: "unknown" }
            else -> "unknown"
        }
    }

    // ---------------------------------------------------------------- commands

    /** One thing to send: a command with JSON fields (the controller's JSON TLV format), or an attribute write. */
    sealed class Step {
        data class Invoke(val cluster: Long, val command: Long, val body: String = "{}", val timed: Boolean = false) : Step() { val fields: JSONObject get() = JSONObject(body) }
        data class Write(val cluster: Long, val attribute: Long, val body: String) : Step() { val json: JSONObject get() = JSONObject(body) }
    }

    class BadCommand(msg: String) : IllegalArgumentException(msg)

    private fun u(tag: Int, v: Long) = "$tag:UINT" to v
    private fun fields(vararg p: Pair<String, Any>) = JSONObject().apply { p.forEach { put(it.first, it.second) } }.toString()
    private fun writeU(attr: Long, v: Long) = JSONObject().put("$attr:UINT", v).toString()
    private fun writeI(attr: Long, v: Long) = JSONObject().put("$attr:INT", v).toString()

    private fun numberOf(value: Any?): Double {
        val d = when (value) { is Number -> value.toDouble(); is String -> value.trim().removeSuffix("%").toDoubleOrNull(); else -> null }
        return d?.takeIf { !it.isNaN() && !it.isInfinite() } ?: throw BadCommand("That needs a number.")
    }

    /**
     * The steps for [action] on an endpoint of [domain] ("on", "off", "toggle", "level", "colour",
     * "temp", "target", "position", "mode"). [ep] is what the endpoint last reported (for the
     * thermostat's current mode). Throws [BadCommand] with plain words for anything else.
     */
    fun plan(domain: String, action: String, value: Any?, ep: Map<Long, Map<Long, Any?>> = emptyMap()): List<Step> {
        val hasOnOff = ON_OFF in servers(ep) || ep.isEmpty()
        return when (domain) {
            "light", "switch" -> when (action) {
                "on" -> listOf(Step.Invoke(ON_OFF, 1))
                "off" -> listOf(Step.Invoke(ON_OFF, 0))
                "toggle" -> listOf(Step.Invoke(ON_OFF, 2))
                "level" -> {
                    if (domain == "switch" && LEVEL !in servers(ep)) throw BadCommand("This switch has no brightness.")
                    val pct = numberOf(value).coerceIn(0.0, 100.0)
                    if (pct <= 0.0) listOf(Step.Invoke(ON_OFF, 0))
                    else listOf(Step.Invoke(LEVEL, 4, fields(u(0, (pct * 254 / 100).roundToInt().coerceIn(1, 254).toLong()), u(1, 0), u(2, 0), u(3, 0))))
                }
                "temp" -> {
                    if (domain != "light") throw BadCommand("Only a light has a colour temperature.")
                    val k = numberOf(value).coerceIn(1500.0, 10000.0)
                    listOf(Step.Invoke(COLOR, 0x0A, fields(u(0, (1_000_000 / k).roundToInt().toLong()), u(1, 0), u(2, 0), u(3, 0))))
                }
                "colour" -> {
                    if (domain != "light") throw BadCommand("Only a light has a colour.")
                    val (h, s) = hueSat(value)
                    listOf(Step.Invoke(COLOR, 0x06, fields(u(0, (h * 254 / 360).roundToInt().toLong().coerceIn(0, 254)), u(1, (s * 254 / 100).roundToInt().toLong().coerceIn(0, 254)), u(2, 0), u(3, 0), u(4, 0))))
                }
                else -> throw BadCommand("A ${if (domain == "light") "light" else "switch"} can't do that.")
            }
            "fan" -> when (action) {
                "on" -> if (ep.isNotEmpty() && ON_OFF in servers(ep)) listOf(Step.Invoke(ON_OFF, 1)) else listOf(Step.Write(FAN, 0, writeU(0, 4)))
                "off" -> if (ep.isNotEmpty() && ON_OFF in servers(ep)) listOf(Step.Invoke(ON_OFF, 0)) else listOf(Step.Write(FAN, 0, writeU(0, 0)))
                "toggle" -> {
                    val on = (ep.attr(ON_OFF, 0L) as? Boolean) ?: ((long(ep.attr(FAN, 0L)) ?: 0L) != 0L)
                    plan("fan", if (on) "off" else "on", null, ep)
                }
                "level" -> {
                    val pct = numberOf(value).coerceIn(0.0, 100.0).roundToInt().toLong()
                    // a fan with its own on and off ignores the speed while off: a speed above 0 switches it on first
                    val onOff = ep.isNotEmpty() && ON_OFF in servers(ep)
                    when {
                        pct == 0L -> plan("fan", "off", null, ep)
                        onOff -> listOf(Step.Invoke(ON_OFF, 1), Step.Write(FAN, 2, writeU(2, pct)))
                        else -> listOf(Step.Write(FAN, 2, writeU(2, pct)))
                    }
                }
                else -> throw BadCommand("A fan can't do that.")
            }
            "cover" -> when (action) {
                "on" -> listOf(Step.Invoke(COVER, 0))   // open
                "off" -> listOf(Step.Invoke(COVER, 1))  // close
                "toggle" -> listOf(Step.Invoke(COVER, if ((long(ep.attr(COVER, 0x0EL)) ?: 0L) >= 10000L) 0 else 1))
                "position", "level" -> {
                    val open = numberOf(value).coerceIn(0.0, 100.0)
                    listOf(Step.Invoke(COVER, 5, fields(u(0, ((100 - open) * 100).roundToInt().toLong()))))
                }
                else -> throw BadCommand("A blind can't do that.")
            }
            "climate" -> when (action) {
                "off" -> listOf(Step.Write(THERMOSTAT, 0x1C, writeU(0x1C, 0)))
                "on" -> listOf(Step.Write(THERMOSTAT, 0x1C, writeU(0x1C, 1)))
                "mode" -> {
                    val m = systemModeFor(value?.toString()?.trim().orEmpty()) ?: throw BadCommand("That is not a mode this air conditioner has.")
                    listOf(Step.Write(THERMOSTAT, 0x1C, writeU(0x1C, m)))
                }
                "target" -> {
                    val c = numberOf(value).coerceIn(4.0, 40.0)
                    val v = (c * 100).roundToInt().toLong()
                    val mode = long(ep.attr(THERMOSTAT, 0x1CL))
                    val fm = long(ep.attr(THERMOSTAT, 0xFFFCL)) ?: 0x3L
                    when {
                        mode == 3L || mode == 6L || (fm and 0x1L == 0L) -> listOf(Step.Write(THERMOSTAT, 0x11, writeI(0x11, v)))
                        mode == 4L || mode == 5L || (fm and 0x2L == 0L) -> listOf(Step.Write(THERMOSTAT, 0x12, writeI(0x12, v)))
                        // auto or off: move both, keeping 2 degrees between them
                        else -> listOf(Step.Write(THERMOSTAT, 0x12, writeI(0x12, v - 100)), Step.Write(THERMOSTAT, 0x11, writeI(0x11, v + 100)))
                    }
                }
                else -> throw BadCommand("An air conditioner can't do that.")
            }
            "sensor" -> throw BadCommand("A sensor only reports; there is nothing to switch.")
            else -> throw BadCommand("That device can't be controlled.")
        }.also { if (!hasOnOff && it.any { s -> s is Step.Invoke && s.cluster == ON_OFF }) throw BadCommand("This device has no on and off.") }
    }

    /** "#ff8800", "ff8800", [h, s], {h, s} or "h,s" to hue (0-360) and saturation (0-100). */
    fun hueSat(value: Any?): Pair<Double, Double> {
        fun hs(h: Double, s: Double) = h.coerceIn(0.0, 360.0) to s.coerceIn(0.0, 100.0)
        when (value) {
            is JSONArray -> if (value.length() >= 2) return hs(value.optDouble(0), value.optDouble(1))
            is JSONObject -> if (value.has("h")) return hs(value.optDouble("h"), value.optDouble("s"))
            is String -> {
                val t = value.trim()
                Regex("^#?([0-9a-fA-F]{6})$").find(t)?.let { m ->
                    val rgb = m.groupValues[1].toInt(16)
                    val r = (rgb shr 16 and 255) / 255.0; val g = (rgb shr 8 and 255) / 255.0; val b = (rgb and 255) / 255.0
                    val max = maxOf(r, g, b); val min = minOf(r, g, b); val d = max - min
                    val h = when { d == 0.0 -> 0.0; max == r -> 60 * (((g - b) / d) % 6); max == g -> 60 * ((b - r) / d + 2); else -> 60 * ((r - g) / d + 4) }
                    return hs((h + 360) % 360, if (max == 0.0) 0.0 else d / max * 100)
                }
                t.split(',').mapNotNull { it.trim().toDoubleOrNull() }.takeIf { it.size == 2 }?.let { return hs(it[0], it[1]) }
            }
        }
        throw BadCommand("A colour is written like #ff8800.")
    }

    /** Illuminance MeasuredValue to lux (exposed for tests). */
    fun lux(measured: Double) = 10.0.pow((measured - 1) / 10000.0)
    @Suppress("unused") private fun luxBack(lux: Double) = 10000 * log10(lux) + 1
}
