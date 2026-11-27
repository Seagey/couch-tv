package app.couchtv.ha

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Rooms per TV (lane B, 28 Nov 2026): the launcher's copy of the one rule, tested with tests/fixtures/room_caps.json like every other copy,
// and the guest room TV's Home Assistant cut down to its own room before anything reads or controls it.
class RoomCapTest {
    private fun table(): JSONObject {
        var d: java.io.File? = java.io.File(".").absoluteFile
        while (d != null) {
            val f = java.io.File(d, "tests/fixtures/room_caps.json")
            if (f.isFile) return JSONObject(f.readText())
            d = d.parentFile
        }
        throw AssertionError("tests/fixtures/room_caps.json not found")
    }

    @Test fun theRuleAgreesWithEveryOtherCopy() {
        val cases = table().getJSONArray("cases")
        assertTrue(cases.length() >= 20)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val room = if (c.isNull("room")) null else RoomCap.parse(c.getJSONObject("room").toString())
            val e = c.getString("entity")
            val got = room?.allows(e) ?: true
            assertEquals(c.toString(), c.getBoolean("ok"), got)
        }
    }

    @Test fun aNameAloneCapsNothing() {
        assertNull(RoomCap.parse("""{"label":"Lounge"}"""))
        assertNull(RoomCap.parse("not json"))
        assertNull(RoomCap.parse(null))
    }

    @Test fun theGuestRoomTvSeesOnlyItsRoom() {
        val all = HomeAssistant.parseForTest(JSONObject("""{"url":"http://homeassistant.local:8123","token":"abcdefghijklmnopqrstuvwxyz",
            "climate":[{"entity":"climate.lounge"},{"entity":"climate.guest"}],
            "controls":[{"entity":"light.lounge"},{"entity":"light.guest"},{"entity":"switch.kettle"}],
            "speakers":[{"entity":"media_player.lounge"}],"scenes":[{"entity":"scene.movie"}]}"""))!!
        val room = RoomCap.parse("""{"label":"Guest room","only":true,"climate":["climate.guest"],"lights":["light.guest"]}""")
        val s = RoomCap.apply(room, all)
        assertEquals(listOf("climate.guest"), s.climate.map { it.entity })
        assertEquals(listOf("light.guest", "switch.kettle"), s.controls.map { it.entity })
        assertEquals(emptyList<String>(), s.speakers.map { it.entity })
        assertEquals(listOf("scene.movie"), s.scenes.map { it.entity })
        // asking for the lounge by name is refused before Home Assistant is called (no climate entry, so no service call)
        assertEquals("refused", HomeAssistant.answerForTest(s, "on", "climate.lounge", "").optString("error"))
        assertEquals("refused", HomeAssistant.answerForTest(s, "set", "light.lounge", "on").optString("error"))
        // the same settings with no room: everything stays
        assertEquals(2, RoomCap.apply(null, all).climate.size)
    }
}
