package app.couchtv.ha

import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder

/** A home network address for the TV's client id; Home Assistant only checks it matches the redirect. */
private fun lan(c: Int, d: Int) = "192.168.$c.$d"

/**
 * The TV's own sign in (HaAuth.kt, HomeAssistant.kt), against a real Home Assistant. Skipped unless
 * HA_E2E_URL (its address) and HA_E2E_CREDS (a JSON file with tv_user and tv_pass for a throwaway,
 * non-admin test user) are set, so the normal test run never needs one. The phone's part, signing in
 * on Home Assistant's own login flow with the TV's client id and PKCE challenge, is played here the
 * way Home Assistant's /auth/authorize page does it.
 */
class HaRealTest {
    private val base = System.getenv("HA_E2E_URL") ?: ""
    private val creds = System.getenv("HA_E2E_CREDS")?.let { File(it) }?.takeIf { it.isFile }?.let { JSONObject(it.readText()) }

    @After fun tearDown() { HomeAssistant.clock = { System.currentTimeMillis() } }

    private fun post(url: String, json: JSONObject): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(json.toString().toByteArray()) }
        return JSONObject((if (c.responseCode < 400) c.inputStream else c.errorStream).bufferedReader().readText())
    }

    private fun query(u: String): Map<String, String> = URL(u).query.split('&').associate {
        URLDecoder.decode(it.substringBefore('='), "UTF-8") to URLDecoder.decode(it.substringAfter('='), "UTF-8")
    }

    @Test fun signInRefreshAndRevokeAgainstRealHomeAssistant() {
        assumeTrue("set HA_E2E_URL and HA_E2E_CREDS to run", base.isNotEmpty() && creds != null)
        val c = creds!!
        assertEquals("ok", HaAuth.probe(base))
        assertTrue("Home Assistant says it takes PKCE S256", HaAuth.pkce(base))
        assertEquals("unreachable", HaAuth.probe("http://127.0.0.1:1"))

        // the TV makes the sign in address (HaPhone's /ha/api/signin)
        val client = "http://${lan(1, 50)}:5400/"
        val verifier = HaAuth.verifier()
        val q = query(HaAuth.authorizeUrl(base, client, client + "ha/done", "st4te", HaAuth.challenge(verifier)))
        assertEquals(client, q["client_id"]); assertEquals("S256", q["code_challenge_method"])

        // the phone signs in on Home Assistant's page
        val flow = post("$base/auth/login_flow", JSONObject().put("client_id", client).put("handler", JSONArray().put("homeassistant").put(JSONObject.NULL))
            .put("redirect_uri", q["redirect_uri"]).put("code_challenge", q["code_challenge"]).put("code_challenge_method", "S256"))
        assertEquals("Home Assistant takes the TV's client id: $flow", "form", flow.optString("type"))
        val done = post("$base/auth/login_flow/" + flow.getString("flow_id"), JSONObject().put("client_id", client)
            .put("username", c.getString("tv_user")).put("password", c.getString("tv_pass")))
        assertEquals("create_entry", done.optString("type"))
        val code = done.getString("result")

        // a wrong verifier is refused, so PKCE is really checked
        val (bad, none) = HaAuth.exchange(base, code, client, HaAuth.verifier())
        assertEquals(401, bad); assertEquals(null, none)
        // the code is used once (a refused try burns it in Home Assistant), so sign in again for the real swap
        val flow2 = post("$base/auth/login_flow", JSONObject().put("client_id", client).put("handler", JSONArray().put("homeassistant").put(JSONObject.NULL))
            .put("redirect_uri", q["redirect_uri"]).put("code_challenge", q["code_challenge"]).put("code_challenge_method", "S256"))
        val code2 = post("$base/auth/login_flow/" + flow2.getString("flow_id"), JSONObject().put("client_id", client)
            .put("username", c.getString("tv_user")).put("password", c.getString("tv_pass"))).getString("result")
        val (status, t) = HaAuth.exchange(base, code2, client, verifier)
        assertEquals(200, status)
        val tokens = t!!
        assertNotNull("Home Assistant gives a refresh token", tokens.refresh)

        // what the TV keeps: the refresh token and client id, no long-lived token
        val s = HomeAssistant.Settings(base, "", listOf(HomeAssistant.Named("climate.hvac", "")), emptyList(), null, refresh = tokens.refresh, client = client)
        HomeAssistant.remember(tokens.refresh!!, tokens)
        val list = HomeAssistant.listFor(s)
        assertTrue(list.toString().take(200), list.optBoolean("ok"))
        val ents = (0 until list.getJSONArray("entities").length()).map { list.getJSONArray("entities").getJSONObject(it).getString("entity") }
        assertTrue("devices listed: ${ents.size}", ents.size > 20)
        assertFalse("no lock or alarm", ents.any { it.startsWith("lock.") || it.startsWith("alarm_control_panel.") })
        assertFalse("no garage door", ents.contains("cover.garage_door"))
        assertTrue(HomeAssistant.answer(s, "climate", "", "").getJSONArray("rooms").getJSONObject(0).optBoolean("ok"))

        // the access token runs out: the next call makes a new one from the refresh token
        HomeAssistant.clock = { System.currentTimeMillis() + 3_600_000L }
        HomeAssistant.lastBearer = null
        assertTrue(HomeAssistant.answer(s, "climate", "", "").optBoolean("ok"))
        assertNotNull(HomeAssistant.lastBearer)

        // disconnect: Home Assistant forgets the refresh token
        assertTrue(HaAuth.revoke(base, tokens.refresh!!))
        assertEquals(401, HaAuth.refresh(base, tokens.refresh!!, client).first)

        // Home Assistant signed the TV out: the TV's next call is refused, it says sign in again, and it does
        // not ask Home Assistant again within the minute
        HomeAssistant.clock = { System.currentTimeMillis() + 7_200_000L }   // the access token made above has run out too
        assertNull(HomeAssistant.state(s, "climate.hvac"))
        assertTrue("sign in again", HomeAssistant.signInAgain(s))
        var asked = 0
        HaAuth.fake = { _, _, _ -> asked++; 500 to null }
        try { assertNull(HomeAssistant.state(s, "climate.hvac")) } finally { HaAuth.fake = null }
        assertEquals("not asked again within the minute", 0, asked)
    }
}
