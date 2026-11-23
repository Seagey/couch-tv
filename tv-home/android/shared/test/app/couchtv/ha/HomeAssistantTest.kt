package app.couchtv.ha

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * What the page may ask for the smart home widgets, against a pretend Home Assistant (no network):
 * only entities named in config.json, nothing switched before it was read, never a garage door,
 * and the readings the widgets draw.
 */
class HomeAssistantTest {
    private val calls = mutableListOf<String>()
    private val states = mutableMapOf<String, String>()
    private var historyBody = "[[]]"

    private val section = JSONObject("""{
        "url": "http://ha.example:8123", "token": "abcdefghijklmnopqrstuvwxyz0123456789",
        "climate": [{"entity": "climate.living"}],
        "controls": [{"entity": "light.lounge", "name": "Lounge"}, {"entity": "cover.garage"}, {"entity": "lock.front_door"}, {"entity": "fan.bed"}],
        "cameras": [{"entity": "camera.backyard", "name": "Backyard"}, {"entity": "sensor.not_a_camera"}],
        "sensors": [{"entity": "sensor.pool", "name": "Pool"}],
        "energy": {"entity": "sensor.solar_today", "name": "Solar", "battery": "sensor.battery"},
        "speakers": [{"entity": "media_player.kitchen"}],
        "doorbell": {"entity": "binary_sensor.door_ring", "camera": "camera.door"}
    }""")
    private lateinit var s: HomeAssistant.Settings

    @Before fun setUp() {
        s = HomeAssistant.parseForTest(section)!!
        HomeAssistant.fake = { method, path, body ->
            calls.add("$method $path" + (body?.let { " $it" } ?: ""))
            when {
                path.startsWith("/api/states/") -> states[path.removePrefix("/api/states/")]?.let { 200 to it.toByteArray() } ?: (404 to null)
                path.startsWith("/api/history/period/") -> 200 to historyBody.toByteArray()
                path.startsWith("/api/services/") -> 200 to "[]".toByteArray()
                else -> 404 to null
            }
        }
        DoorbellKept.clear()
    }

    @After fun tearDown() { HomeAssistant.fake = null; HomeAssistant.clock = { System.currentTimeMillis() } }

    private fun ask(action: String, entity: String = "", value: String = "") = HomeAssistant.answerForTest(s, action, entity, value)
    private fun state(e: String, st: String, attrs: String = "{}", changed: String = "2025-11-18T03:00:00+00:00") {
        states[e] = """{"entity_id":"$e","state":"$st","attributes":$attrs,"last_changed":"$changed"}"""
    }

    @Test fun onlyAllowedEntitiesAreKept() {
        assertEquals(listOf("light.lounge", "fan.bed"), s.controls.map { it.entity })   // no lock, and a garage door never shows (as the bridge)
        assertEquals(listOf("camera.backyard"), s.cameras.map { it.entity })
        assertEquals("sensor.battery", s.energy!!.battery)
        val bad = JSONObject(section.toString()).put("energy", JSONObject().put("entity", "lock.x"))
        assertNull(HomeAssistant.parseForTest(bad)!!.energy)
    }

    @Test fun controlsAreReadThenSwitched() {
        state("light.lounge", "off")
        assertEquals("refused", ask("set", "light.lounge", "on").getString("error"))   // not read yet
        assertTrue(calls.none { it.startsWith("POST") })
        val r = ask("controls")
        assertEquals(2, r.getJSONArray("controls").length())
        assertTrue(ask("set", "light.lounge", "on").getBoolean("ok"))
        assertTrue(calls.last().startsWith("POST /api/services/light/turn_on {\"entity_id\":\"light.lounge\"}"))
    }

    @Test fun aGarageDoorIsNeverOpened() {
        state("cover.garage", "closed", "{\"device_class\":\"garage\"}")
        ask("controls")
        assertEquals("refused", ask("set", "cover.garage", "open").getString("error"))
        assertTrue(calls.none { it.startsWith("POST") })
    }

    @Test fun anythingNotInConfigIsRefused() {
        ask("controls")
        assertEquals("refused", ask("set", "lock.front_door", "off").getString("error"))
        assertEquals("refused", ask("set", "light.kitchen", "on").getString("error"))
        assertEquals("refused", ask("history", "sensor.other").getString("error"))
        assertEquals("refused", ask("still", "camera.neighbours").getString("error"))
        assertEquals("refused", ask("volume", "media_player.other", "50").getString("error"))
        assertEquals("refused", ask("nonsense").getString("error"))
        assertTrue(calls.none { it.startsWith("POST") })
    }

    @Test fun sensorsAndTheirLastDay() {
        state("sensor.pool", "26.5", "{\"unit_of_measurement\":\"°C\"}")
        val r = ask("sensors").getJSONArray("sensors").getJSONObject(0)
        assertEquals("Pool", r.getString("name")); assertEquals(26.5, r.getDouble("num"), 0.01)
        val now = HaReadings.parseTime("2025-11-18T10:20:00Z")!!
        HomeAssistant.clock = { now }
        historyBody = JSONArray().put(JSONArray().put(JSONObject().put("state", "24").put("last_changed", "2025-11-17T11:00:00Z"))
            .put(JSONObject().put("state", "26").put("last_changed", "2025-11-18T10:05:00Z"))).toString()
        val h = ask("history", "sensor.pool")
        val pts = h.getJSONArray("points")
        assertEquals(24, pts.length()); assertEquals(24.0, pts.getDouble(0), 0.01); assertEquals(26.0, pts.getDouble(23), 0.01)
        assertTrue(calls.last().contains("filter_entity_id=sensor.pool"))
        assertTrue(calls.last().contains("/api/history/period/2025-11-17T11:00:00Z"))
    }

    @Test fun energyTodayByTheHour() {
        state("sensor.solar_today", "6", "{\"unit_of_measurement\":\"kWh\"}")
        state("sensor.battery", "86.4", "{\"unit_of_measurement\":\"%\"}")
        val mid = HaReadings.midnight(HaReadings.parseTime("2025-11-18T12:00:00Z")!!)
        HomeAssistant.clock = { mid + 10 * 3_600_000L }
        historyBody = JSONArray().put(JSONArray()
            .put(JSONObject().put("state", "0").put("last_changed", HaReadings.isoUtc(mid)))
            .put(JSONObject().put("state", "2.5").put("last_changed", HaReadings.isoUtc(mid + 8 * 3_600_000L + 60_000)))
            .put(JSONObject().put("state", "6").put("last_changed", HaReadings.isoUtc(mid + 9 * 3_600_000L + 60_000)))).toString()
        val e = ask("energy")
        assertTrue(e.getBoolean("ok")); assertEquals("Solar", e.getString("name"))
        assertEquals(6.0, e.getDouble("total"), 0.01); assertEquals(86, e.getInt("battery"))
        val h = e.getJSONArray("hours")
        assertEquals(2.5, h.getDouble(8), 0.01); assertEquals(3.5, h.getDouble(9), 0.01); assertTrue(h.isNull(11))
        state("sensor.solar_today", "6", "{\"unit_of_measurement\":\"°C\"}")
        assertEquals("unit", ask("energy").getString("error"))
    }

    @Test fun speakersVolumeOnlyWhenItCan() {
        state("media_player.kitchen", "playing", "{\"volume_level\":0.3,\"supported_features\":4}")
        assertEquals("refused", ask("volume", "media_player.kitchen", "50").getString("error"))   // not read yet
        assertEquals(30, ask("speakers").getJSONArray("speakers").getJSONObject(0).getInt("volume"))
        assertTrue(ask("volume", "media_player.kitchen", "150").getBoolean("ok"))
        assertTrue(calls.last().contains("volume_set") && calls.last().contains("\"volume_level\":1"))
        assertEquals("refused", ask("playpause", "media_player.kitchen").getString("error"))   // no play or pause on this one
    }

    @Test fun theDoorbellsLastRing() {
        val now = HaReadings.parseTime("2025-11-18T10:00:00Z")!!
        HomeAssistant.clock = { now }
        state("binary_sensor.door_ring", "off")
        historyBody = JSONArray().put(JSONArray()
            .put(JSONObject().put("state", "off").put("last_changed", "2025-11-17T10:00:00Z"))
            .put(JSONObject().put("state", "on").put("last_changed", "2025-11-18T04:14:00Z"))
            .put(JSONObject().put("state", "off").put("last_changed", "2025-11-18T04:14:20Z"))).toString()
        val b = ask("bell")
        assertTrue(b.getBoolean("ok")); assertEquals(HaReadings.parseTime("2025-11-18T04:14:00Z"), b.getLong("at"))
        assertFalse(b.getBoolean("ringing")); assertTrue(b.getBoolean("camera")); assertFalse(b.getBoolean("kept"))
        // a ring this TV saw itself, later than Home Assistant's history
        DoorbellKept.at = now - 60_000
        assertEquals(now - 60_000, ask("bell").getLong("at"))
        assertEquals("none", ask("ringstill").getString("error"))
    }

    // ---- set up on the TV (Home settings, Smart home): no computer

    @Test fun pickableListsOnlyWhatCouchTvCanShow() {
        val all = JSONArray("""[
            {"entity_id":"light.lounge","attributes":{"friendly_name":"Lounge lamp"}},
            {"entity_id":"lock.front_door","attributes":{}},
            {"entity_id":"alarm_control_panel.house","attributes":{}},
            {"entity_id":"cover.garage_door","attributes":{}},
            {"entity_id":"cover.blinds","attributes":{"device_class":"garage"}},
            {"entity_id":"cover.lounge_blinds","attributes":{"device_class":"blind"}},
            {"entity_id":"sensor.pool","attributes":{"unit_of_measurement":"°C","device_class":"temperature","friendly_name":"Pool"}},
            {"entity_id":"climate.bedroom","attributes":{}},
            {"entity_id":"automation.morning","attributes":{}},
            {"entity_id":"Bad Id","attributes":{}}
        ]""")
        val p = HomeAssistant.pickable(all)
        val ids = (0 until p.length()).map { p.getJSONObject(it).getString("entity") }
        assertEquals(listOf("climate.bedroom", "cover.lounge_blinds", "light.lounge", "sensor.pool"), ids)
        val pool = p.getJSONObject(3)
        assertEquals("Pool", pool.getString("name")); assertEquals("°C", pool.getString("unit"))
        assertEquals("Bedroom", p.getJSONObject(0).getString("name"))   // no friendly name: from the id
    }

    @Test fun checkSaysWhatIsWrongInPlainWords() {
        assertEquals("address", HomeAssistant.check("ftp://ha.example", "abcdefghijklmnopqrstuvwxyz0123").getString("error"))
        assertEquals("address", HomeAssistant.check("http://user:pw@192.0.2.5:8123", "abcdefghijklmnopqrstuvwxyz0123").getString("error"))
        assertEquals("token", HomeAssistant.check("http://ha.example:8123", "short").getString("error"))
        HomeAssistant.fake = { _, path, _ -> if (path == "/api/") 401 to null else 404 to null }
        assertEquals("token", HomeAssistant.check("http://ha.example:8123", "abcdefghijklmnopqrstuvwxyz0123").getString("error"))
        HomeAssistant.fake = { _, _, _ -> -1 to null }
        assertEquals("unreachable", HomeAssistant.check("http://ha.example:8123", "abcdefghijklmnopqrstuvwxyz0123").getString("error"))
        HomeAssistant.fake = { _, path, _ -> if (path == "/api/") 200 to "<html>router</html>".toByteArray() else 404 to null }
        assertEquals("not_ha", HomeAssistant.check("http://192.0.2.1", "abcdefghijklmnopqrstuvwxyz0123").getString("error"))
        HomeAssistant.fake = { _, path, _ ->
            when (path) {
                "/api/" -> 200 to """{"message":"API running."}""".toByteArray()
                "/api/states" -> 200 to """[{"entity_id":"light.lounge","attributes":{}},{"entity_id":"lock.door","attributes":{}}]""".toByteArray()
                else -> 404 to null
            }
        }
        val ok = HomeAssistant.check("http://ha.example:8123/", "abcdefghijklmnopqrstuvwxyz0123")
        assertTrue(ok.getBoolean("ok"))
        assertEquals(1, ok.getJSONArray("entities").length())
        assertFalse(ok.toString().contains("abcdefghijklmnopqrstuvwxyz0123"))   // the token never comes back
    }

    @Test fun theKeptTokenNeverGoesToANewHost() {
        val kept = "http://ha.example:8123" to "keptkeptkeptkeptkeptkeptkept01"
        // an empty token with another address: no token at all, so nothing is sent anywhere
        assertEquals("", HomeAssistant.keptFor("http://other.example:8123", "", kept).second)
        assertEquals("", HomeAssistant.keptFor("http://ha.example:9999", " ", kept).second)
        assertEquals("", HomeAssistant.keptFor("http://ha.example:8123", "", null).second)
        // an empty token with the kept address, or none: the kept pair
        assertEquals(kept, HomeAssistant.keptFor("http://ha.example:8123/", "", kept))
        assertEquals(kept, HomeAssistant.keptFor("", "", kept))
        // a typed token goes with the typed address, never the kept one
        assertEquals("http://other.example:8123" to "typedtypedtypedtypedtyped0001", HomeAssistant.keptFor("http://other.example:8123", "typedtypedtypedtypedtyped0001", kept))
    }

    @Test fun nothingWithoutASection() {
        assertEquals("off", HomeAssistant.answerForTest(null, "controls", "", "").getString("error"))
        assertNotNull(HomeAssistant.parseForTest(JSONObject(section.toString()).put("controls", JSONArray())))
    }

    // ---- the aircon widget: Home Assistant's own temperature unit (/api/config), asked once

    private fun unitSetUp(host: String, config: () -> Pair<Int, ByteArray?>): HomeAssistant.Settings {
        state("climate.living", "cool", "{\"temperature\":72,\"current_temperature\":75}")
        HomeAssistant.fake = { method, path, _ ->
            calls.add("$method $path")
            when {
                path == "/api/config" -> config()
                path.startsWith("/api/states/") -> states[path.removePrefix("/api/states/")]?.let { 200 to it.toByteArray() } ?: (404 to null)
                else -> 404 to null
            }
        }
        // each test its own address: the unit is kept per Home Assistant address
        return HomeAssistant.parseForTest(JSONObject(section.toString()).put("url", "http://$host:8123"))!!
    }

    @Test fun theRoomsCarryHomeAssistantsOwnUnitAskedOnce() {
        val u = unitSetUp("unit-f.example") { 200 to """{"unit_system":{"temperature":"°F","length":"mi"}}""".toByteArray() }
        val a = HomeAssistant.answerForTest(u, "climate", "", "")
        assertEquals("°F", a.getJSONArray("rooms").getJSONObject(0).getString("unit"))
        val b = HomeAssistant.answerForTest(u, "climate", "", "")
        assertEquals("°F", b.getJSONArray("rooms").getJSONObject(0).getString("unit"))
        assertEquals(1, calls.count { it == "GET /api/config" })   // asked once
    }

    @Test fun aFailedUnitReadGivesNoUnitAndIsAskedAgain() {
        var up = false
        val u = unitSetUp("unit-down.example") { if (up) 200 to """{"unit_system":{"temperature":"°C"}}""".toByteArray() else 500 to null }
        val a = HomeAssistant.answerForTest(u, "climate", "", "")
        assertTrue(a.getBoolean("ok"))
        assertFalse(a.getJSONArray("rooms").getJSONObject(0).has("unit"))   // no unit, never a guess
        up = true
        val b = HomeAssistant.answerForTest(u, "climate", "", "")
        assertEquals("°C", b.getJSONArray("rooms").getJSONObject(0).getString("unit"))
        assertEquals(2, calls.count { it == "GET /api/config" })   // asked again after the failure
    }

    @Test fun anOddUnitIsNoUnit() {
        val u = unitSetUp("unit-odd.example") { 200 to """{"unit_system":{"temperature":"K"}}""".toByteArray() }
        assertFalse(HomeAssistant.answerForTest(u, "climate", "", "").getJSONArray("rooms").getJSONObject(0).has("unit"))
    }

    // ---- nothing that opens the house: scenes and scripts too (owner's rule)

    @Test fun scenesAndScriptsThatOpenTheHouseAreNeverKept() {
        val o = JSONObject(section.toString()).put("scenes", JSONArray("""[{"entity":"scene.movie_night"},{"entity":"script.open_garage"},
            {"entity":"script.unlock_front_door"},{"entity":"scene.disarm_alarm"},{"entity":"scene.goodnight"}]"""))
            .put("controls", JSONArray("""[{"entity":"switch.garagedoor"},{"entity":"cover.frontgate"},{"entity":"switch.doorlock"},
            {"entity":"cover.garage2"},{"entity":"switch.alarm_siren"},{"entity":"light.lounge"}]"""))
        val k = HomeAssistant.parseForTest(o)!!
        assertEquals(listOf("scene.movie_night", "scene.goodnight"), k.scenes.map { it.entity })
        assertEquals(listOf("light.lounge"), k.controls.map { it.entity })
        // asked anyway: refused, and nothing is sent to Home Assistant
        val r = HomeAssistant.answerForTest(k, "scene", "script.open_garage", "")
        assertEquals("refused", r.getString("error"))
        assertTrue(calls.none { it.startsWith("POST") })
    }

    @Test fun aSceneThatSetsALockAnAlarmOrAGarageNeverRuns() {
        val o = JSONObject(section.toString()).put("scenes", JSONArray("""[{"entity":"scene.movie_night"},{"entity":"scene.leaving"},
            {"entity":"scene.away"},{"entity":"scene.home"},{"entity":"script.morning"}]"""))
        val k = HomeAssistant.parseForTest(o)!!
        state("scene.movie_night", "2025-11-18T03:00:00+00:00", "{\"entity_id\":[\"light.lounge\",\"cover.blinds\"]}")
        state("cover.blinds", "closed", "{\"device_class\":\"blind\"}")
        state("scene.leaving", "2025-11-18T03:00:00+00:00", "{\"entity_id\":[\"light.lounge\",\"lock.front\"]}")
        state("scene.away", "2025-11-18T03:00:00+00:00", "{\"entity_id\":[\"alarm_control_panel.house\"]}")
        state("scene.home", "2025-11-18T03:00:00+00:00", "{\"entity_id\":[\"cover.big_roller\"]}")
        state("cover.big_roller", "closed", "{\"device_class\":\"garage\"}")
        state("script.morning", "off")
        for (e in listOf("scene.leaving", "scene.away", "scene.home")) {
            assertEquals(e, "refused", HomeAssistant.answerForTest(k, "scene", e, "").getString("error"))
        }
        assertTrue(calls.none { it.startsWith("POST") })
        assertTrue(HomeAssistant.answerForTest(k, "scene", "scene.movie_night", "").getBoolean("ok"))
        assertTrue(calls.last().startsWith("POST /api/services/scene/turn_on"))
        assertTrue(HomeAssistant.answerForTest(k, "scene", "script.morning", "").getBoolean("ok"))   // a script lists nothing: its name decides
        assertTrue(calls.last().startsWith("POST /api/services/script/turn_on"))
    }

    @Test fun pickableLeavesOutScenesAndScriptsThatOpenTheHouse() {
        val all = JSONArray("""[
            {"entity_id":"scene.movie_night","attributes":{"entity_id":["light.lounge"]}},
            {"entity_id":"scene.leaving","attributes":{"entity_id":["lock.front"]}},
            {"entity_id":"scene.away","attributes":{"entity_id":["alarm_control_panel.house"]}},
            {"entity_id":"scene.home","attributes":{"entity_id":["cover.big_roller"]}},
            {"entity_id":"cover.big_roller","attributes":{"device_class":"garage"}},
            {"entity_id":"scene.disarm_alarm","attributes":{}},
            {"entity_id":"script.open_garage","attributes":{}},
            {"entity_id":"script.unlock_front_door","attributes":{}},
            {"entity_id":"switch.alarm_siren","attributes":{}},
            {"entity_id":"script.morning","attributes":{}}
        ]""")
        val p = HomeAssistant.pickable(all)
        assertEquals(listOf("scene.movie_night", "script.morning"), (0 until p.length()).map { p.getJSONObject(it).getString("entity") })
    }

    // ---- the one house test, the same ids as every other copy (tests/fixtures/opens_house_ids.json)

    private fun table(): JSONObject {
        var d: java.io.File? = java.io.File(".").absoluteFile
        while (d != null) {
            val f = java.io.File(d, "tests/fixtures/opens_house_ids.json")
            if (f.isFile) return JSONObject(f.readText())
            d = d.parentFile
        }
        throw AssertionError("tests/fixtures/opens_house_ids.json not found")
    }

    @Test fun theHouseTestAgreesWithEveryOtherCopy() {
        val t = table()
        val refuse = t.getJSONArray("refuse"); val pass = t.getJSONArray("pass")
        assertTrue(refuse.length() >= 50 && pass.length() >= 30)
        for (i in 0 until refuse.length()) assertTrue("refuses " + refuse.getString(i), HaReadings.OPENS_HOUSE.matches(refuse.getString(i)))
        for (i in 0 until pass.length()) assertFalse("lets through " + pass.getString(i), HaReadings.OPENS_HOUSE.matches(pass.getString(i)))
        // parse keeps the harmless ones and drops the rest
        val o = JSONObject(section.toString()).put("controls", JSONArray(listOf("switch.outdoor_lights", "switch.wall_clock", "switch.doorbell_mute", "switch.backdoor", "cover.frontgate", "switch.smartlock").map { JSONObject().put("entity", it) }))
        assertEquals(listOf("switch.outdoor_lights", "switch.wall_clock", "switch.doorbell_mute"), HomeAssistant.parseForTest(o)!!.controls.map { it.entity })
    }

    @Test fun aGarageDoorNamedSoOnlyInHomeAssistantNeverShowsNorOpens() {
        val all = JSONArray("""[
            {"entity_id":"switch.shellyplus1_a8032ab1","attributes":{"friendly_name":"Garage Door"}},
            {"entity_id":"switch.sonoff_1000ab","attributes":{"friendly_name":"Front gate"}},
            {"entity_id":"cover.tuya_bf12","attributes":{"friendly_name":"Garage door"}},
            {"entity_id":"script.arrive","attributes":{"friendly_name":"Open the garage"}},
            {"entity_id":"scene.new_scene_2","attributes":{"friendly_name":"Unlock front door","entity_id":["light.hall"]}},
            {"entity_id":"switch.porch","attributes":{"friendly_name":"Outdoor lights"}},
            {"entity_id":"light.hall","attributes":{"friendly_name":"Hall"}}
        ]""")
        val p = HomeAssistant.pickable(all)
        assertEquals(listOf("light.hall", "switch.porch"), (0 until p.length()).map { p.getJSONObject(it).getString("entity") })
        // kept anyway (config.json): read blocked, never switched, never run
        val k = HomeAssistant.parseForTest(JSONObject(section.toString())
            .put("controls", JSONArray("""[{"entity":"switch.shellyplus1_a8032ab1"},{"entity":"cover.tuya_bf12"},{"entity":"switch.porch"}]"""))
            .put("scenes", JSONArray("""[{"entity":"script.arrive"},{"entity":"scene.new_scene_2"}]""")))!!
        state("switch.shellyplus1_a8032ab1", "off", "{\"friendly_name\":\"Garage Door\"}")
        state("cover.tuya_bf12", "unavailable", "{\"friendly_name\":\"Garage door\"}")   // not answering: still a garage door
        state("switch.porch", "off", "{\"friendly_name\":\"Outdoor lights\"}")
        state("script.arrive", "off", "{\"friendly_name\":\"Open the garage\"}")
        state("scene.new_scene_2", "2025-11-18T03:00:00+00:00", "{\"friendly_name\":\"Unlock front door\",\"entity_id\":[\"light.hall\"]}")
        val c = HomeAssistant.answerForTest(k, "controls", "", "").getJSONArray("controls")
        val by = (0 until c.length()).associate { c.getJSONObject(it).getString("entity") to c.getJSONObject(it) }
        assertTrue(by["switch.shellyplus1_a8032ab1"]!!.optBoolean("blocked"))
        assertTrue(by["cover.tuya_bf12"]!!.optBoolean("blocked"))
        assertFalse(by["switch.porch"]!!.optBoolean("blocked"))
        for (v in listOf("on", "off", "open", "close")) {
            assertEquals("refused", HomeAssistant.answerForTest(k, "set", "switch.shellyplus1_a8032ab1", v).getString("error"))
            assertEquals("refused", HomeAssistant.answerForTest(k, "set", "cover.tuya_bf12", v).getString("error"))
        }
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "script.arrive", "").getString("error"))
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "scene.new_scene_2", "").getString("error"))
        assertTrue(calls.none { it.startsWith("POST") })
        assertTrue(HomeAssistant.answerForTest(k, "set", "switch.porch", "on").getBoolean("ok"))
    }

    @Test fun aSceneRunsNothingWhenWhatItSetsCannotBeRead() {
        val k = HomeAssistant.parseForTest(JSONObject(section.toString()).put("scenes", JSONArray("""[{"entity":"scene.movie"},{"entity":"scene.grouped"}]""")))!!
        state("scene.movie", "x", "{\"entity_id\":[\"light.lounge\",\"cover.roller\"]}")
        state("scene.grouped", "x", "{\"entity_id\":[\"group.all_locks\"]}")
        // cover.roller's state cannot be read: nothing runs
        assertEquals("failed", HomeAssistant.answerForTest(k, "scene", "scene.movie", "").getString("error"))
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "scene.grouped", "").getString("error"))   // a group may hold locks
        assertTrue(calls.none { it.startsWith("POST") })
        state("cover.roller", "closed", "{\"device_class\":\"blind\"}")
        assertTrue(HomeAssistant.answerForTest(k, "scene", "scene.movie", "").getBoolean("ok"))
        // a scene that sets a switch Home Assistant calls a garage door
        state("cover.roller", "closed", "{\"friendly_name\":\"Garage roller door\"}")
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "scene.movie", "").getString("error"))
    }

    @Test fun doorAndLockReadingsAreNeverListedButDoorbellsAre() {
        val all = JSONArray("""[
            {"entity_id":"binary_sensor.front_gate","attributes":{"device_class":"door"}},
            {"entity_id":"binary_sensor.garage_door","attributes":{"device_class":"garage_door"}},
            {"entity_id":"binary_sensor.back","attributes":{"device_class":"lock"}},
            {"entity_id":"binary_sensor.hall_window","attributes":{"device_class":"window"}},
            {"entity_id":"binary_sensor.front_doorbell","attributes":{}},
            {"entity_id":"binary_sensor.side_gate","attributes":{}},
            {"entity_id":"binary_sensor.shed","attributes":{"friendly_name":"Garage door"}},
            {"entity_id":"binary_sensor.doorbell_button","attributes":{}},
            {"entity_id":"event.front_door_ding","attributes":{"device_class":"doorbell"}},
            {"entity_id":"sensor.front_door_lock","attributes":{}},
            {"entity_id":"sensor.alarm_state","attributes":{}},
            {"entity_id":"sensor.garage_temp","attributes":{"unit_of_measurement":"°C"}}
        ]""")
        val p = HomeAssistant.pickable(all)
        assertEquals(listOf("binary_sensor.doorbell_button", "binary_sensor.front_doorbell", "event.front_door_ding", "sensor.garage_temp"), (0 until p.length()).map { p.getJSONObject(it).getString("entity") })
    }

    @Test fun aSceneFoundToOpenTheHouseIsRemembered() {
        val k = HomeAssistant.parseForTest(JSONObject(section.toString()).put("scenes", JSONArray("""[{"entity":"scene.evening"},{"entity":"script.arrive"},{"entity":"scene.movie3"}]""")))!!
        state("scene.evening", "x", "{\"entity_id\":[\"lock.front\"]}")
        state("script.arrive", "off", "{\"friendly_name\":\"Open the garage\"}")
        state("scene.movie3", "x", "{\"entity_id\":[\"light.lounge\"]}")
        HomeAssistant.refusedScenes.clear()
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "scene.evening", "").getString("error"))
        assertEquals("refused", HomeAssistant.answerForTest(k, "scene", "script.arrive", "").getString("error"))
        assertTrue(HomeAssistant.answerForTest(k, "scene", "scene.movie3", "").getBoolean("ok"))
        assertEquals(setOf("scene.evening", "script.arrive"), HomeAssistant.refusedScenes.toSet())
        states.remove("scene.movie3")   // a failed read is not a refusal
        assertEquals("failed", HomeAssistant.answerForTest(k, "scene", "scene.movie3", "").getString("error"))
        assertEquals(setOf("scene.evening", "script.arrive"), HomeAssistant.refusedScenes.toSet())
    }
}
