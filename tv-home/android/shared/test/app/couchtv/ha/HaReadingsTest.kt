package app.couchtv.ha

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/** The smart home widgets' readings, from Home Assistant's own answers (no network). */
class HaReadingsTest {
    private fun st(state: String, attrs: String = "{}") = JSONObject("{\"state\":\"$state\",\"attributes\":$attrs}")
    private val n = { e: String -> HaReadings.Named(e, "") }
    private val H = 3_600_000L

    @Test fun aLightReadsOnAndItsBrightness() {
        val o = HaReadings.control(n("light.lounge"), st("on", "{\"brightness\":204,\"friendly_name\":\"Lounge lamp\"}"))
        assertTrue(o.getBoolean("ok")); assertTrue(o.getBoolean("on"))
        assertEquals(80, o.getInt("level")); assertEquals("Lounge lamp", o.getString("name")); assertEquals("light", o.getString("kind"))
    }

    @Test fun aBlindReadsOpenAndItsPosition() {
        val o = HaReadings.control(n("cover.blinds"), st("open", "{\"current_position\":40}"))
        assertTrue(o.getBoolean("on")); assertEquals(40, o.getInt("level")); assertFalse(o.has("blocked"))
    }

    @Test fun aGarageDoorReadsButIsNeverSwitched() {
        val o = HaReadings.control(n("cover.garage"), st("closed", "{\"device_class\":\"garage\"}"))
        assertTrue(o.getBoolean("blocked"))
        assertNull(HaReadings.service("cover.garage", "open", true))
        for (dc in listOf("gate", "door")) assertTrue(HaReadings.control(n("cover.x"), st("closed", "{\"device_class\":\"$dc\"}")).getBoolean("blocked"))
    }

    @Test fun servicesAreOnlyTheOnesAllowed() {
        assertEquals("light" to "turn_on", HaReadings.service("light.a", "on", false))
        assertEquals("switch" to "turn_off", HaReadings.service("switch.a", "off", false))
        assertEquals("cover" to "close_cover", HaReadings.service("cover.a", "close", false))
        assertNull(HaReadings.service("light.a", "toggle", false))
        assertNull(HaReadings.service("lock.front", "off", false))
        assertNull(HaReadings.service("cover.a", "on", false))
    }

    @Test fun anUnavailableThingSaysSo() {
        assertFalse(HaReadings.control(n("switch.heater"), st("unavailable")).getBoolean("ok"))
        assertFalse(HaReadings.control(n("switch.heater"), null).getBoolean("ok"))
        assertEquals("Heater", HaReadings.control(n("switch.heater"), null).getString("name"))
    }

    @Test fun aSensorReadsItsNumberAndUnit() {
        val o = HaReadings.sensor(n("sensor.pool"), st("26.4", "{\"unit_of_measurement\":\"°C\",\"device_class\":\"temperature\"}"))
        assertEquals(26.4, o.getDouble("num"), 0.001); assertEquals("°C", o.getString("unit")); assertEquals("temperature", o.getString("cls"))
        val w = HaReadings.sensor(n("sensor.wind"), st("Calm"))
        assertEquals("Calm", w.getString("value")); assertFalse(w.has("num"))
    }

    @Test fun aSpeakerReadsVolumeSongAndWhatItCanDo() {
        val o = HaReadings.speaker(n("media_player.kitchen"), st("playing", "{\"volume_level\":0.42,\"supported_features\":21437,\"media_title\":\"Song\",\"media_artist\":\"Band\"}"))
        assertEquals(42, o.getInt("volume")); assertTrue(o.getBoolean("can_volume")); assertTrue(o.getBoolean("can_pause"))
        assertEquals("Song", o.getString("title")); assertEquals("Band", o.getString("artist"))
        val fixed = HaReadings.speaker(n("media_player.tv"), st("on", "{\"supported_features\":0}"))
        assertFalse(fixed.getBoolean("can_volume")); assertFalse(fixed.getBoolean("can_pause"))
    }

    @Test fun timesParseWithAnyOffset() {
        assertEquals(1763434800000L, HaReadings.parseTime("2025-11-18T03:00:00+00:00"))
        assertEquals(1763434800000L, HaReadings.parseTime("2025-11-18T03:00:00Z"))
        assertEquals(1763434800123L, HaReadings.parseTime("2025-11-18T13:00:00.123456+10:00"))
        assertEquals(1763434800000L, HaReadings.parseTime("2025-11-17T22:00:00-05:00"))
        assertNull(HaReadings.parseTime("unknown")); assertNull(HaReadings.parseTime(null))
        assertEquals("2025-11-18T03:00:00Z", HaReadings.isoUtc(1763434800000L))
    }

    @Test fun midnightIsOnTheTvsOwnClock() {
        val tz = TimeZone.getTimeZone("Australia/Brisbane")
        assertEquals(HaReadings.parseTime("2025-11-18T00:00:00+10:00"), HaReadings.midnight(HaReadings.parseTime("2025-11-18T21:30:00+10:00")!!, tz))
    }

    private fun hist(vararg p: Pair<String, String>) = JSONArray().put(JSONArray(p.map { JSONObject().put("state", it.second).put("last_changed", it.first) }))

    @Test fun historyComesInTimeOrder() {
        val p = HaReadings.points(hist("2025-11-18T02:00:00Z" to "2", "2025-11-18T01:00:00Z" to "1"))
        assertEquals(listOf("1", "2"), p.map { it.second })
        assertTrue(HaReadings.points(JSONArray()).isEmpty())
    }

    @Test fun hourlyMeansHoldTheLastReading() {
        val t0 = 1_000L * H
        val p = listOf(t0 + 60_000 to "10", t0 + 120_000 to "20", t0 + 2 * H + 1 to "30", t0 + 2 * H + 5 to "unavailable")
        val m = HaReadings.hourlyMeans(p, t0, 4)
        assertEquals(15.0, m[0]!!, 0.001)   // the mean of 10 and 20
        assertEquals(20.0, m[1]!!, 0.001)   // nothing new: it held 20
        assertEquals(30.0, m[2]!!, 0.001)
        assertEquals(30.0, m[3]!!, 0.001)
        assertNull(HaReadings.hourlyMeans(p, t0 - 2 * H, 2)[0])   // before the first reading
    }

    @Test fun anEnergyTotalCountsWhatItWentUpEachHourAndItsReset() {
        val t0 = 1_000L * H
        val p = listOf(t0 to "100.0", t0 + H + 10 to "101.5", t0 + H + 20 to "102.0", t0 + 2 * H + 10 to "0.5", t0 + 3 * H + 10 to "1.5")
        val h = HaReadings.energyHours(p, t0, t0 + 3 * H + 100, "kWh")!!
        assertEquals(0.0, h[0]!!, 0.001); assertEquals(2.0, h[1]!!, 0.001); assertEquals(0.5, h[2]!!, 0.001); assertEquals(1.0, h[3]!!, 0.001)
        assertNull(h[4])   // still to come
        val wh = HaReadings.energyHours(listOf(t0 to "0", t0 + 10 to "500"), t0, t0 + 100, "Wh")!!
        assertEquals(0.5, wh[0]!!, 0.001)
    }

    @Test fun powerIsAddedUpOverTheHour() {
        val t0 = 1_000L * H
        // 2 kW for the first half hour, 1000 W from then, read until 90 minutes in
        val p = listOf(t0 to "2000", t0 + H / 2 to "1000")
        val h = HaReadings.energyHours(p, t0, t0 + H + H / 2, "W")!!
        assertEquals(1.5, h[0]!!, 0.001); assertEquals(0.5, h[1]!!, 0.001)
        assertNull(HaReadings.energyHours(p, t0, t0 + H, "°C"))   // not energy at all
    }

    @Test fun aDoorbellRangWhenItLastTurnedOn() {
        assertEquals(30L, HaReadings.lastOn(listOf(10L to "on", 20L to "off", 30L to "on", 40L to "on", 50L to "off")))
        assertNull(HaReadings.lastOn(listOf(10L to "off")))
    }

    @Test fun seriesRoundsAndKeepsGaps() {
        val s = HaReadings.series(arrayOf(1.234, null))
        assertEquals(1.23, s.getDouble(0), 0.0001); assertTrue(s.isNull(1))
    }
}
