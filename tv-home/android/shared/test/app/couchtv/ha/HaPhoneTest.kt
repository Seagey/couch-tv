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

/** A home network address for the tests, made here so no real one is ever written down. */
private fun lan(c: Int, d: Int) = "192.168.$c.$d"

/**
 * The phone set up's server side (HaPhone.handleFor) and the rules a save goes through, against a
 * pretend Home Assistant: a failed /ha/done never carries the set up key, only a Host of the TV's own
 * number address or a .local name is answered, PKCE is always sent, only ids Home Assistant listed are
 * kept, nothing that opens the house is kept, and a refused refresh token waits a minute and says
 * sign in again. Made up tokens only.
 */
class HaPhoneTest {
    private val tv = lan(1, 50)
    private val host = "$tv:5400"
    private val files: (String) -> ByteArray? = { name -> if (name == "ha-phone.html") "<html>page</html>".toByteArray() else null }
    private var refreshes = 0
    private var refuse = false
    private var kept = 0

    @Before fun setUp() {
        HaPhone.ownAddresses = { setOf(tv) }
        HaPhone.keepSignIn = { _, _, t, _ -> kept++; t.refresh != null }
        HaAuth.fake = { _, url, form ->
            when {
                url.endsWith("/auth/providers") -> 200 to """{"providers":[{"type":"homeassistant"}]}"""
                url.endsWith("/.well-known/oauth-authorization-server") -> 404 to null   // an older Home Assistant that does not say
                url.endsWith("/auth/token") && form?.get("grant_type") == "authorization_code" ->
                    if (form["code"] == "good-code" && !form["code_verifier"].isNullOrEmpty())
                        200 to """{"access_token":"access-made-up-for-a-test-000001","refresh_token":"refresh-made-up-for-a-test-0000001","expires_in":1800}"""
                    else 400 to """{"error":"invalid_grant"}"""
                url.endsWith("/auth/token") && form?.get("grant_type") == "refresh_token" -> {
                    refreshes++
                    if (refuse) 400 to """{"error":"invalid_grant"}""" else 200 to """{"access_token":"access-made-up-for-a-test-000002","expires_in":1800}"""
                }
                else -> 404 to null
            }
        }
    }

    @After fun tearDown() {
        HaAuth.fake = null; HomeAssistant.fake = null; HomeAssistant.clock = { System.currentTimeMillis() }
        HomeAssistant.listedForTest(null); HaPhone.stop()
        HaPhone.ownAddresses = { emptySet() }
        HaPhone.keepSignIn = { _, _, _, _ -> false }
    }

    private fun ask(method: String, path: String, q: Map<String, String> = emptyMap(), body: JSONObject? = null, h: String? = host) =
        HaPhone.handleFor(null, method, path, q, body?.toString() ?: "", h, 5400, files)!!

    @Test fun aFailedReturnFromHomeAssistantNeverCarriesTheKey() {
        val key = HaPhone.startForTest(tv, 5400)
        val locations = mutableListOf<String?>()
        // before any sign in was asked for
        locations += ask("GET", "/ha/done").location
        locations += ask("GET", "/ha/done", mapOf("code" to "x", "state" to "anything")).location
        // the phone asks for the sign in address
        val r = JSONObject(String(ask("POST", "/ha/api/signin", body = JSONObject().put("k", key).put("url", "http://ha.example:8123")).body))
        assertTrue(r.toString(), r.getBoolean("ok"))
        val go = r.getString("go")
        assertTrue("PKCE is sent even when Home Assistant does not say it takes it", go.contains("code_challenge_method=S256") && go.contains("code_challenge="))
        val state = go.substringAfter("state=").substringBefore('&')
        // a stranger's link: no state, a forged one, an empty one
        locations += ask("GET", "/ha/done", mapOf("code" to "x")).location
        locations += ask("GET", "/ha/done", mapOf("code" to "x", "state" to "forged")).location
        locations += ask("GET", "/ha/done", mapOf("code" to "x", "state" to "")).location
        locations.forEach { assertEquals("/ha/?e=expired", it); assertFalse(it!!.contains(key)) }
        assertEquals(0, kept)
        // the phone that asked: back to its devices, with the key
        val ok = ask("GET", "/ha/done", mapOf("code" to "good-code", "state" to state))
        assertEquals(302, ok.status)
        assertEquals("/ha/?k=" + java.net.URLEncoder.encode(key, "UTF-8") + "#devices", ok.location)
        assertEquals(1, kept)
        // the code and state are used once
        assertEquals("/ha/?e=expired", ask("GET", "/ha/done", mapOf("code" to "good-code", "state" to state)).location)
    }

    @Test fun onlyTheTvsOwnAddressOrALocalNameIsAnswered() {
        assertEquals(200, ask("GET", "/ha/").status)
        assertEquals(200, ask("GET", "/ha/", h = "example.local:5400").status)
        assertEquals(403, ask("GET", "/ha/", h = "evil.example:5400").status)        // a name a web page points at the TV
        assertEquals(403, ask("GET", "/ha/", h = "$tv:5401").status)                // another port
        assertEquals(403, ask("GET", "/ha/", h = tv).status)                        // no port
        assertEquals(403, ask("GET", "/ha/", h = null).status)
        assertEquals(403, ask("GET", "/ha/done", mapOf("state" to "x"), h = "evil.example:5400").status)
        assertNull(HaPhone.handleFor(null, "GET", "/api/x", emptyMap(), "", host, 5400, files))   // not ours
    }

    @Test fun aSaveKeepsOnlyWhatHomeAssistantListedWithItsNames() {
        val section = JSONObject().put("url", "http://ha.example:8123").put("refresh_token", "refresh-made-up-for-a-test-0000001").put("client_id", "http://$tv:5400/")
            .put("climate", JSONArray().put(JSONObject().put("entity", "climate.lounge")))
            .put("controls", JSONArray().put(JSONObject().put("entity", "light.lamp").put("name", "Reading")).put(JSONObject().put("entity", "cover.main")))
            .put("scenes", JSONArray().put(JSONObject().put("entity", "script.open_garage")))
            .put("extra", "never kept")
        assertNull("nothing listed yet: nothing kept", HomeAssistant.rebuilt(section, null))
        HomeAssistant.listedForTest(mapOf("climate.lounge" to "Lounge aircon", "light.lamp" to "Lamp", "script.open_garage" to "Open garage"))
        val o = HomeAssistant.rebuilt(section, null)!!
        fun pairs(k: String) = o.getJSONArray(k).let { a -> (0 until a.length()).map { a.getJSONObject(it).let { e -> e.getString("entity") to e.getString("name") } } }
        assertEquals(listOf("climate.lounge" to "Lounge aircon"), pairs("climate"))   // Home Assistant's own name
        assertEquals(listOf("light.lamp" to "Reading"), pairs("controls"))   // the name given kept; cover.main was not listed
        assertEquals(0, o.getJSONArray("scenes").length())   // a script that opens the garage is never kept
        assertFalse(o.has("extra")); assertFalse(o.has("token"))
        assertEquals("refresh-made-up-for-a-test-0000001", o.getString("refresh_token"))
        // a name kept before stays when the phone sends the id alone (ha-picks.js section sends ids only)
        val old = HomeAssistant.parseForTest(JSONObject().put("url", "http://ha.example:8123").put("token", "t".repeat(30))
            .put("climate", JSONArray().put(JSONObject().put("entity", "climate.lounge").put("name", "Living room"))))
        assertEquals("Living room", HomeAssistant.rebuilt(section, old)!!.getJSONArray("climate").getJSONObject(0).getString("name"))
    }

    @Test fun scenesAndScriptsThatOpenTheHouseNeverShow() {
        val s = HomeAssistant.parseForTest(JSONObject().put("url", "http://ha.example:8123").put("token", "t".repeat(30))
            .put("scenes", JSONArray().put(JSONObject().put("entity", "scene.movie")).put(JSONObject().put("entity", "script.open_garage"))
                .put(JSONObject().put("entity", "scene.alarm_off")).put(JSONObject().put("entity", "script.front_door_unlock"))))!!
        assertEquals(listOf("scene.movie"), s.scenes.map { it.entity })
        val listed = HomeAssistant.pickable(JSONArray().put(JSONObject().put("entity_id", "script.garage_open")).put(JSONObject().put("entity_id", "scene.alarm_arm"))
            .put(JSONObject().put("entity_id", "scene.movie")))
        assertEquals(1, listed.length())
    }

    @Test fun aRefusedRefreshTokenWaitsAMinuteAndSaysSignInAgain() {
        var now = 1_000_000L
        HomeAssistant.clock = { now }
        val r = "refresh-only-for-the-backoff-test-0001"
        val s = HomeAssistant.parseForTest(JSONObject().put("url", "http://ha.example:8123").put("refresh_token", r).put("client_id", "http://$tv:5400/")
            .put("climate", JSONArray().put(JSONObject().put("entity", "climate.lounge"))))!!
        HomeAssistant.fake = { _, _, _ -> 200 to """{"state":"cool","attributes":{}}""".toByteArray() }
        refuse = true
        assertNull(HomeAssistant.state(s, "climate.lounge"))
        assertEquals(1, refreshes)
        assertTrue(HomeAssistant.signInAgain(s))
        now += 30_000
        assertNull(HomeAssistant.state(s, "climate.lounge"))
        assertEquals("not asked again within the minute", 1, refreshes)
        now += 31_000
        refuse = false
        assertNotNull(HomeAssistant.state(s, "climate.lounge"))
        assertEquals(2, refreshes)
        assertFalse(HomeAssistant.signInAgain(s))
    }
}
