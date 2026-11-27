package app.couchtv.ha

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// Phase 2: the account's Home Assistant must never replace or blank what is already ticked on the TV.
class HomeAssistantAccountTest {
    private fun ents(o: JSONObject, g: String) = (0 until (o.optJSONArray(g)?.length() ?: 0)).map { o.getJSONArray(g).getJSONObject(it).getString("entity") }

    @Test fun accountPicksAreAddedToTheTicksAlreadyKept() {
        val old = """{"url":"http://homeassistant.local:8123","token":"t","climate":[{"entity":"climate.lounge","name":"Lounge"}],"scenes":[{"entity":"scene.movie","name":"Movie"}]}"""
        val picks = JSONObject("""{"climate":[{"entity":"climate.guest","name":""},{"entity":"climate.lounge","name":""}]}""")
        val m = HomeAssistant.mergedTicks(old, picks, "http://homeassistant.local:8123")
        assertEquals(listOf("climate.guest", "climate.lounge"), ents(m, "climate").sorted())
        assertEquals(listOf("scene.movie"), ents(m, "scenes"))
        assertTrue("the address and token are not carried in the ticks", !m.has("url") && !m.has("token"))
    }

    @Test fun noAccountPicksMeansTheKeptTicksStayAndNothingGoesBlank() {
        val old = """{"url":"http://homeassistant.local:8123","token":"t","sensors":[{"entity":"sensor.pool","name":"Pool"}],"doorbell":{"entity":"event.door","name":"Door"}}"""
        val m = HomeAssistant.mergedTicks(old, JSONObject("{}"), "http://homeassistant.local:8123")
        assertEquals(listOf("sensor.pool"), ents(m, "sensors"))
        assertTrue(m.has("doorbell"))
    }

    @Test fun aDifferentHomeAssistantStartsFromTheAccountsPicksOnly() {
        val old = """{"url":"http://other-host:8123","token":"t","scenes":[{"entity":"scene.old","name":"Old"}]}"""
        val m = HomeAssistant.mergedTicks(old, JSONObject("""{"scenes":[{"entity":"scene.new","name":""}]}"""), "http://homeassistant.local:8123")
        assertEquals(listOf("scene.new"), ents(m, "scenes"))
    }
}
