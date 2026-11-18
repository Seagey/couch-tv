package app.couchtv.launcher

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Batteries widget's reading of paired Bluetooth devices (Batteries.kt). */
class BatteriesTest {
    private val PERIPHERAL = 0x0500
    private val AUDIO = 0x0400

    @Test fun kindsFromNameThenClass() {
        assertEquals("remote", Batteries.kindOf(0, 0, "Chromecast Remote"))
        assertEquals("controller", Batteries.kindOf(0, 0, "Xbox Wireless Controller"))
        assertEquals("headphones", Batteries.kindOf(AUDIO, AUDIO or 0x18, "WH-1000XM5"))
        assertEquals("controller", Batteries.kindOf(PERIPHERAL, PERIPHERAL or 0x08, "Pad"))      // gamepad
        assertEquals("remote", Batteries.kindOf(PERIPHERAL, PERIPHERAL or 0x0C, "RC"))          // remote control
        assertEquals("keyboard", Batteries.kindOf(PERIPHERAL, PERIPHERAL or 0x40, "Keys"))
        assertEquals("other", Batteries.kindOf(0x0200, 0x020C, "Phone"))
    }

    @Test fun lowestFirstOnlyRealLevelsAtMostEight() {
        val list = (1..10).map { Batteries.Device("d$it", it * 9, "remote") } + Batteries.Device("none", -1, "remote")
        val j = JSONObject(Batteries.json(list))
        assertTrue(j.getBoolean("ok"))
        val d = j.getJSONArray("devices")
        assertEquals(8, d.length())
        assertEquals(9, d.getJSONObject(0).getInt("level"))
        for (i in 0 until d.length()) assertFalse(d.getJSONObject(i).getString("name") == "none")
    }

    @Test fun saysWhatIsMissing() {
        val j = JSONObject(Batteries.json(emptyList(), "permission"))
        assertFalse(j.getBoolean("ok"))
        assertEquals("permission", j.getString("need"))
    }
}
