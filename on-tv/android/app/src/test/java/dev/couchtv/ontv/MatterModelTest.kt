package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterModel
import dev.couchtv.ontv.matter.MatterModel.Step
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MatterModelTest {
    private fun dt(vararg t: Long) = t.map { mapOf(0L to it, 1L to 1L) }
    private fun ep(types: List<Map<Long, Long>>, vararg clusters: Pair<Long, Map<Long, Any?>>): Map<Long, Map<Long, Any?>> {
        val m = LinkedHashMap<Long, Map<Long, Any?>>()
        m[MatterModel.DESCRIPTOR] = mapOf(0L to types, 1L to clusters.map { it.first })
        clusters.forEach { m[it.first] = it.second }
        return m
    }
    private val root = mapOf(MatterModel.DESCRIPTOR to mapOf<Long, Any?>(0L to listOf(mapOf(0L to 0x16L, 1L to 1L))),
        MatterModel.BASIC to mapOf<Long, Any?>(1L to "Acme", 3L to "Bulb A19", 5L to ""))

    @Test fun readsReportJson() {
        assertEquals(true, MatterModel.valueOf(JSONObject("""{"0:BOOL":true}""")))
        assertEquals(254L, MatterModel.valueOf(JSONObject("""{"0:UINT":254}""")))
        assertEquals(-12L, MatterModel.valueOf(JSONObject("""{"0:INT":-12}""")))
        assertEquals(5000000000L, MatterModel.valueOf(JSONObject("""{"0:UINT":"5000000000"}""")))
        assertNull(MatterModel.valueOf(JSONObject("""{"18:NULL":null}""")))
        assertEquals(listOf(mapOf(0L to 256L, 1L to 1L)), MatterModel.valueOf(JSONObject("""{"0:ARRAY-STRUCT":[{"0:UINT":256,"1:UINT":1}]}""")))
        assertEquals(listOf(6L, 8L), MatterModel.valueOf(JSONObject("""{"1:ARRAY-UINT":[6,8]}""")))
        assertEquals("Lamp", MatterModel.valueOf(JSONObject("""{"5:STRING":"Lamp"}""")))
    }

    @Test fun ids() {
        assertEquals("matter:12:1", MatterModel.id(12, 1))
        assertEquals(12L to 1, MatterModel.parseId("matter:12:1"))
        assertEquals("matter:18446744073709551615:2", MatterModel.id(-1L, 2))
        assertEquals(-1L to 2, MatterModel.parseId("matter:18446744073709551615:2"))
        listOf("light.x", "matter:12", "matter:a:1", "matter:12:-1", "matter::1", "matter:1:70000").forEach { assertNull(it, MatterModel.parseId(it)) }
    }

    @Test fun dimmableLight() {
        val light = ep(dt(0x0101), MatterModel.ON_OFF to mapOf(0L to true), MatterModel.LEVEL to mapOf(0L to 127L))
        val list = MatterModel.devices(5, mapOf(0 to root, 1 to light), true)
        assertEquals(1, list.size)
        val d = list[0]
        assertEquals("matter:5:1", d.getString("id")); assertEquals("light", d.getString("domain")); assertEquals("on", d.getString("state"))
        assertEquals("Bulb A19", d.getString("name"))
        assertEquals(128, d.getJSONObject("attributes").getInt("brightness")); assertEquals(50, d.getJSONObject("attributes").getInt("level"))
    }

    @Test fun colourTemperatureLight() {
        val light = ep(dt(0x010C), MatterModel.ON_OFF to mapOf(0L to false), MatterModel.LEVEL to mapOf(0L to 254L),
            MatterModel.COLOR to mapOf(7L to 370L, 0x400BL to 153L, 0x400CL to 500L, 0xFFFCL to 0x10L))
        val a = MatterModel.devices(5, mapOf(0 to root, 1 to light), true)[0]
        assertEquals("off", a.getString("state"))
        val at = a.getJSONObject("attributes")
        assertEquals(2703, at.getInt("color_temp_kelvin")); assertEquals(2000, at.getInt("min_color_temp_kelvin")); assertEquals(6536, at.getInt("max_color_temp_kelvin"))
        assertEquals("color_temp", at.getJSONArray("supported_color_modes").getString(0))
    }

    @Test fun unreachableIsUnavailable() {
        val light = ep(dt(0x0100), MatterModel.ON_OFF to mapOf(0L to true))
        assertEquals("unavailable", MatterModel.devices(5, mapOf(0 to root, 1 to light), false)[0].getString("state"))
        val bridged = ep(dt(0x0100, 0x0013), MatterModel.ON_OFF to mapOf(0L to true), MatterModel.BRIDGED_BASIC to mapOf(5L to "Porch", 0x11L to false))
        val d = MatterModel.devices(5, mapOf(0 to root, 3 to bridged), true)[0]
        assertEquals("unavailable", d.getString("state")); assertEquals("Porch", d.getString("name"))
    }

    @Test fun plugFanCoverClimateSensors() {
        val node = mapOf(
            0 to root,
            1 to ep(dt(0x010A), MatterModel.ON_OFF to mapOf(0L to false)),
            2 to ep(dt(0x002B), MatterModel.FAN to mapOf(0L to 2L, 3L to 40L)),
            3 to ep(dt(0x0202), MatterModel.COVER to mapOf(0x0EL to 2500L)),
            4 to ep(dt(0x0301), MatterModel.THERMOSTAT to mapOf(0L to 2150L, 0x11L to 2400L, 0x12L to 2000L, 0x1CL to 3L, 0x29L to 2L, 0xFFFCL to 0x23L,
                0x15L to 700L, 0x16L to 3000L, 0x17L to 1600L, 0x18L to 3200L)),
            5 to ep(dt(0x0302), MatterModel.TEMPERATURE to mapOf(0L to 1987L)),
            6 to ep(dt(0x0307), MatterModel.HUMIDITY to mapOf(0L to 5500L)),
            7 to ep(dt(0x0015), MatterModel.BOOLEAN_STATE to mapOf(0L to true)),
            8 to ep(dt(0x0107), MatterModel.OCCUPANCY to mapOf(0L to 1L)),
            9 to ep(dt(0x0106), MatterModel.ILLUMINANCE to mapOf(0L to 20001L)),
        )
        val by = MatterModel.devices(9, node, true).associateBy { it.getString("id") }
        assertEquals(9, by.size)
        by["matter:9:1"]!!.let { assertEquals("switch", it.getString("domain")); assertEquals("off", it.getString("state")) }
        by["matter:9:2"]!!.let { assertEquals("fan", it.getString("domain")); assertEquals("on", it.getString("state")); assertEquals(40, it.getJSONObject("attributes").getInt("percentage")) }
        by["matter:9:3"]!!.let { assertEquals("cover", it.getString("domain")); assertEquals("open", it.getString("state")); assertEquals(75, it.getJSONObject("attributes").getInt("current_position")) }
        by["matter:9:4"]!!.let {
            assertEquals("climate", it.getString("domain")); assertEquals("cool", it.getString("state"))
            val a = it.getJSONObject("attributes")
            assertEquals(21.5, a.getDouble("current_temperature"), 0.001); assertEquals(24.0, a.getDouble("temperature"), 0.001)
            assertEquals(7.0, a.getDouble("min_temp"), 0.001); assertEquals(32.0, a.getDouble("max_temp"), 0.001)
            assertEquals("cooling", a.getString("hvac_action"))
            assertEquals(listOf("off", "heat", "cool", "heat_cool"), (0 until a.getJSONArray("hvac_modes").length()).map { i -> a.getJSONArray("hvac_modes").getString(i) })
        }
        by["matter:9:5"]!!.let { assertEquals("19.9", it.getString("state")); assertEquals("°C", it.getJSONObject("attributes").getString("unit_of_measurement")); assertEquals("temperature", it.getJSONObject("attributes").getString("device_class")) }
        by["matter:9:6"]!!.let { assertEquals("55", it.getString("state")); assertEquals("%", it.getJSONObject("attributes").getString("unit_of_measurement")) }
        by["matter:9:7"]!!.let { assertEquals("off", it.getString("state")); assertEquals("contact", it.getJSONObject("attributes").getString("device_class")); assertEquals("closed", it.getJSONObject("attributes").getString("reading")) }
        by["matter:9:8"]!!.let { assertEquals("on", it.getString("state")); assertEquals("occupancy", it.getJSONObject("attributes").getString("device_class")) }
        by["matter:9:9"]!!.let { assertEquals("100", it.getString("state")); assertEquals("lx", it.getJSONObject("attributes").getString("unit_of_measurement")) }
        // several things on one node: the endpoint number tells them apart
        assertEquals("Bulb A19 1", by["matter:9:1"]!!.getString("name"))
    }

    @Test fun locksAlarmsAndGaragesNeverShow() {
        val node = mapOf(0 to root,
            1 to ep(dt(0x000A), MatterModel.DOOR_LOCK to mapOf(0L to 1L)),
            2 to ep(dt(0x0076), MatterModel.SMOKE_CO_ALARM to mapOf(0L to 0L)),
            3 to ep(dt(0x0230), MatterModel.CLOSURE_CONTROL to mapOf(0L to 0L)),
            4 to ep(dt(0x0202), MatterModel.COVER to mapOf(0x0EL to 0L), MatterModel.BRIDGED_BASIC to mapOf(5L to "Garage door")),
            5 to ep(emptyList(), MatterModel.DOOR_LOCK to mapOf(0L to 1L), MatterModel.ON_OFF to mapOf(0L to true)),
        )
        assertTrue(MatterModel.devices(3, node, true).isEmpty())
        assertNull(MatterModel.domainOf(node[4]!!, "Front gate"))
        // the person's own name for a blind is not trusted to unblock a garage: a name with "garage" blocks it
        assertEquals(0, MatterModel.devices(3, mapOf(0 to root, 1 to ep(dt(0x0202), MatterModel.COVER to mapOf(0x0EL to 0L))), true, mapOf("matter:3:1" to "Garage")).size)
    }

    @Test fun unknownTypesGoByClusters() {
        assertEquals("light", MatterModel.domainOf(ep(emptyList(), MatterModel.ON_OFF to emptyMap(), MatterModel.LEVEL to emptyMap())))
        assertEquals("switch", MatterModel.domainOf(ep(emptyList(), MatterModel.ON_OFF to emptyMap())))
        assertEquals("sensor", MatterModel.domainOf(ep(emptyList(), MatterModel.TEMPERATURE to emptyMap())))
        assertNull(MatterModel.domainOf(ep(dt(0x000E))))   // a bridge's aggregator
    }

    @Test fun plansCommands() {
        val light = ep(dt(0x010D), MatterModel.ON_OFF to emptyMap(), MatterModel.LEVEL to emptyMap(), MatterModel.COLOR to emptyMap())
        assertEquals(listOf(Step.Invoke(MatterModel.ON_OFF, 1)), MatterModel.plan("light", "on", null, light))
        assertEquals(listOf(Step.Invoke(MatterModel.ON_OFF, 2)), MatterModel.plan("light", "toggle", null, light))
        val lv = MatterModel.plan("light", "level", 50, light).single() as Step.Invoke
        assertEquals(MatterModel.LEVEL, lv.cluster); assertEquals(4L, lv.command); assertEquals(127, lv.fields.getInt("0:UINT"))
        assertEquals(listOf(Step.Invoke(MatterModel.ON_OFF, 0)), MatterModel.plan("light", "level", 0, light))
        val t = MatterModel.plan("light", "temp", 2700, light).single() as Step.Invoke
        assertEquals(0x0AL, t.command); assertEquals(370, t.fields.getInt("0:UINT"))
        val c = MatterModel.plan("light", "colour", "#ff0000", light).single() as Step.Invoke
        assertEquals(0x06L, c.command); assertEquals(0, c.fields.getInt("0:UINT")); assertEquals(254, c.fields.getInt("1:UINT"))
        val cover = MatterModel.plan("cover", "position", 30, ep(dt(0x0202), MatterModel.COVER to emptyMap())).single() as Step.Invoke
        assertEquals(5L, cover.command); assertEquals(7000, cover.fields.getInt("0:UINT"))
        val fan = MatterModel.plan("fan", "level", 60, ep(dt(0x002B), MatterModel.FAN to emptyMap())).single() as Step.Write
        assertEquals(2L, fan.attribute); assertEquals(60, fan.json.getInt("2:UINT"))
        val fanOnOff = MatterModel.plan("fan", "level", 30, ep(dt(0x002B), MatterModel.FAN to emptyMap(), MatterModel.ON_OFF to emptyMap()))
        assertEquals(Step.Invoke(MatterModel.ON_OFF, 1), fanOnOff[0]); assertEquals(30, (fanOnOff[1] as Step.Write).json.getInt("2:UINT"))
        assertEquals(listOf(Step.Write(MatterModel.FAN, 0, """{"0:UINT":0}""")), MatterModel.plan("fan", "level", 0, ep(dt(0x002B), MatterModel.FAN to emptyMap())))
        val th = ep(dt(0x0301), MatterModel.THERMOSTAT to mapOf(0x1CL to 4L, 0xFFFCL to 3L))
        val heat = MatterModel.plan("climate", "target", 22.5, th).single() as Step.Write
        assertEquals(0x12L, heat.attribute); assertEquals(2250, heat.json.getInt("18:INT"))
        val mode = MatterModel.plan("climate", "mode", "cool", th).single() as Step.Write
        assertEquals(3, mode.json.getInt("28:UINT"))
        assertEquals(2, MatterModel.plan("climate", "target", 22, ep(dt(0x0301), MatterModel.THERMOSTAT to mapOf(0x1CL to 1L, 0xFFFCL to 0x23L))).size)
    }

    @Test fun refusesWhatADeviceCannotDo() {
        val bad = listOf("sensor" to "on", "switch" to "temp", "climate" to "colour", "light" to "explode", "lock" to "on")
        bad.forEach { (d, a) ->
            var threw = false
            try { MatterModel.plan(d, a, 1, emptyMap()) } catch (e: MatterModel.BadCommand) { threw = true; assertFalse(e.message.isNullOrEmpty()) }
            assertTrue("$d $a", threw)
        }
        var threw = false
        try { MatterModel.plan("climate", "mode", "warp", emptyMap()) } catch (e: MatterModel.BadCommand) { threw = true }
        assertTrue(threw)
        threw = false
        try { MatterModel.plan("light", "level", "lots", emptyMap()) } catch (e: MatterModel.BadCommand) { threw = true }
        assertTrue(threw)
    }

    @Test fun colours() {
        assertEquals(0.0 to 100.0, MatterModel.hueSat("#ff0000"))
        assertEquals(120.0, MatterModel.hueSat("00ff00").first, 0.01)
        assertEquals(30.0 to 50.0, MatterModel.hueSat("30,50"))
    }
}
