package app.couchtv.ha

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

// N12 (28 Nov 2026): the Home Assistant section Couch TV Setup sends a TV over adb (ha_b64, steps.make_home) is read by the launcher as it is.
// The fixture is made by setup-app/tests/test_smarthome_adb.py from Setup's own code, so the two sides cannot drift apart.
class SetupSectionTest {
    private fun fixture(): JSONObject {
        var d: java.io.File? = java.io.File(".").absoluteFile
        while (d != null) {
            val f = java.io.File(d, "tests/fixtures/setup_ha_section.json")
            if (f.isFile) return JSONObject(f.readText())
            d = d.parentFile
        }
        throw AssertionError("tests/fixtures/setup_ha_section.json not found")
    }

    @Test fun theTvReadsWhatSetupSends() {
        val s = HomeAssistant.parseForTest(fixture().getJSONObject("section"))
        assertNotNull(s)
        assertEquals("http://homeassistant.local:8123", s!!.base)
        assertEquals(listOf("climate.guest"), s.climate.map { it.entity })
        assertEquals(listOf("light.guest", "switch.kettle"), s.controls.map { it.entity })
        assertEquals(listOf("media_player.guest"), s.speakers.map { it.entity })
        assertEquals(listOf("scene.movie"), s.scenes.map { it.entity })
    }

    @Test fun theRoomSetupSavedCapsNothingFurtherAndNothingOpensTheHouse() {
        val f = fixture()
        val s = HomeAssistant.parseForTest(f.getJSONObject("section"))!!
        val room = RoomCap.parse(f.getJSONObject("room").toString())
        val capped = RoomCap.apply(room, s)
        assertEquals(s.climate.map { it.entity }, capped.climate.map { it.entity })
        assertEquals(s.controls.map { it.entity }, capped.controls.map { it.entity })
        assertEquals(s.speakers.map { it.entity }, capped.speakers.map { it.entity })
        val everything = (s.climate + s.controls + s.speakers + s.scenes + s.cameras + s.sensors).map { it.entity }
        assertTrue(everything.none { it.startsWith("lock.") || it.startsWith("alarm_control_panel.") || it.contains("garage") })
        assertEquals("refused", HomeAssistant.answerForTest(capped, "on", "climate.lounge", "").optString("error"))
    }
}
