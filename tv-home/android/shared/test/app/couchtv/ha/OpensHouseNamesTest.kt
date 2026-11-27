package app.couchtv.ha

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// G11 (lane B, 28 Nov 2026): Home Assistant names in other languages, the same cases as every copy (tests/fixtures/opens_house_names.json).
class OpensHouseNamesTest {
    private fun table(): JSONObject {
        var d: java.io.File? = java.io.File(".").absoluteFile
        while (d != null) {
            val f = java.io.File(d, "tests/fixtures/opens_house_names.json")
            if (f.isFile) return JSONObject(f.readText())
            d = d.parentFile
        }
        throw AssertionError("tests/fixtures/opens_house_names.json not found")
    }

    @Test fun namesAgreeWithEveryOtherCopy() {
        val t = table()
        val refuse = t.getJSONArray("refuse"); val pass = t.getJSONArray("pass")
        for (i in 0 until refuse.length()) {
            val c = refuse.getJSONObject(i)
            assertTrue("misses " + c.getString("name"), HaReadings.opensHouse(c.getString("entity"), JSONObject().put("friendly_name", c.getString("name"))))
        }
        for (i in 0 until pass.length()) {
            val c = pass.getJSONObject(i)
            assertFalse("hides " + c.getString("name"), HaReadings.opensHouse(c.getString("entity"), JSONObject().put("friendly_name", c.getString("name"))))
        }
    }

    @Test fun aKeptTickNamedForAGarageIsDropped() {
        val s = HomeAssistant.parseForTest(JSONObject("""{"url":"http://homeassistant.local:8123","token":"abcdefghijklmnopqrstuvwxyz",
            "controls":[{"entity":"switch.relay_1","name":"Garagentor"},{"entity":"switch.kettle","name":"Wasserkocher"}]}"""))!!
        assertTrue(s.controls.map { it.entity } == listOf("switch.kettle"))
    }
}
