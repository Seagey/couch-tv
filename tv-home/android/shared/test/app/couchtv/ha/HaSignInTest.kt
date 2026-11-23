package app.couchtv.ha

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Home network addresses for the tests, made here so no real one is ever written down. */
private fun lan(c: Int, d: Int) = "192.168.$c.$d"
private fun ip(a: Int, b: Int, c: Int, d: Int) = "$a.$b.$c.$d"

/**
 * Signing the TV in to Home Assistant from a phone (HaAuth.kt, HaPhone.kt, HomeAssistant.kt), against
 * a pretend Home Assistant: PKCE as RFC 7636 makes it, the sign in address, the code swap, a refresh
 * token kept and used, an access token refreshed only when it runs out, a refused refresh, the TV's
 * client id, and finding Home Assistant's address from its announcement. The tokens are made up.
 */
class HaSignInTest {
    private val posts = mutableListOf<Map<String, String>>()
    private var refreshes = 0

    @After fun tearDown() {
        HaAuth.fake = null; HomeAssistant.fake = null; HomeAssistant.clock = { System.currentTimeMillis() }
    }

    @Test fun pkceMatchesTheRfcExample() {
        // RFC 7636, appendix B
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", HaAuth.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        val v = HaAuth.verifier()
        assertEquals(43, v.length)
        assertTrue(v.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertFalse(v == HaAuth.verifier())
        assertEquals("AQID", HaAuth.b64url(byteArrayOf(1, 2, 3)))
        assertEquals("AQ", HaAuth.b64url(byteArrayOf(1)))
        assertEquals("__4", HaAuth.b64url(byteArrayOf(-1, -2)))   // url safe letters, no padding
    }

    @Test fun signInAddressCarriesTheTvAsClient() {
        val u = HaAuth.authorizeUrl("http://${lan(1, 20)}:8123", "http://${lan(1, 50)}:5400/", "http://${lan(1, 50)}:5400/ha/done", "st4te", "chal")
        assertTrue(u.startsWith("http://${lan(1, 20)}:8123/auth/authorize?response_type=code&client_id=http%3A%2F%2F${lan(1, 50)}%3A5400%2F"))
        assertTrue(u.contains("&redirect_uri=http%3A%2F%2F${lan(1, 50)}%3A5400%2Fha%2Fdone&state=st4te"))
        assertTrue(u.endsWith("&code_challenge=chal&code_challenge_method=S256"))
    }

    private val access1 = "access-one-made-up-for-a-test-000001"
    private val access2 = "access-two-made-up-for-a-test-000002"
    private val refresh = "refresh-made-up-for-a-test-0000000001"

    private fun pretendHa(refuseRefresh: Boolean = false) {
        HaAuth.fake = { method, url, form ->
            if (form != null) posts.add(form)
            when {
                url.endsWith("/auth/providers") -> 200 to """{"providers":[{"name":"Home Assistant Local","id":null,"type":"homeassistant"}]}"""
                url.endsWith("/.well-known/oauth-authorization-server") -> 200 to """{"code_challenge_methods_supported":["S256"]}"""
                url.endsWith("/auth/token") && form?.get("grant_type") == "authorization_code" ->
                    if (form["code"] == "good-code") 200 to """{"access_token":"$access1","token_type":"Bearer","refresh_token":"$refresh","expires_in":1800}"""
                    else 400 to """{"error":"invalid_request"}"""
                url.endsWith("/auth/token") && form?.get("grant_type") == "refresh_token" -> {
                    refreshes++
                    if (refuseRefresh || form["client_id"] != "http://${lan(1, 50)}:5400/") 400 to """{"error":"invalid_grant"}"""
                    else 200 to """{"access_token":"$access2","token_type":"Bearer","expires_in":1800}"""
                }
                url.endsWith("/auth/revoke") -> 200 to ""
                else -> 404 to null
            }
        }
    }

    @Test fun codeIsSwappedOnTheTv() {
        pretendHa()
        assertEquals("ok", HaAuth.probe("http://ha.example:8123"))
        assertTrue(HaAuth.pkce("http://ha.example:8123"))
        val (code, t) = HaAuth.exchange("http://ha.example:8123", "good-code", "http://${lan(1, 50)}:5400/", "the-verifier")
        assertEquals(200, code)
        assertEquals(access1, t!!.access)
        assertEquals(refresh, t.refresh)
        assertEquals(1800L, t.expiresIn)
        assertEquals("the-verifier", posts.last()["code_verifier"])
        assertEquals("http://${lan(1, 50)}:5400/", posts.last()["client_id"])
        val (bad, none) = HaAuth.exchange("http://ha.example:8123", "used-code", "http://${lan(1, 50)}:5400/", "another-verifier")
        assertEquals(401, bad); assertNull(none)
        assertEquals("another-verifier", posts.last()["code_verifier"])   // PKCE is always sent
    }

    @Test fun notHomeAssistantOrNotReady() {
        HaAuth.fake = { _, url, _ -> if (url.contains("one")) 200 to "<html>router</html>" else if (url.contains("two")) 400 to "onboarding not finished" else -1 to null }
        assertEquals("not_ha", HaAuth.probe("http://one:80"))
        assertEquals("not_ready", HaAuth.probe("http://two:8123"))
        assertEquals("unreachable", HaAuth.probe("http://three:8123"))
        assertFalse(HaAuth.pkce("http://one:80"))
    }

    private fun signedIn(r: String = refresh): HomeAssistant.Settings =
        HomeAssistant.parseForTest(HomeAssistant.signedInSection(null, "http://ha.example:8123", r, "http://${lan(1, 50)}:5400/")
            .put("climate", org.json.JSONArray().put(JSONObject().put("entity", "climate.living"))))!!

    @Test fun aSignedInSectionHasNoLongLivedToken() {
        val s = signedIn()
        assertEquals("", s.token)
        assertEquals(refresh, s.refresh)
        assertEquals("http://${lan(1, 50)}:5400/", s.client)
        // a refresh token with no client id is refused (a refresh needs the same client id)
        assertNull(HomeAssistant.parseForTest(JSONObject().put("url", "http://ha.example:8123").put("refresh_token", refresh)))
        // an older section with a long-lived token still reads as before
        val old = HomeAssistant.parseForTest(JSONObject().put("url", "http://ha.example:8123").put("token", "abcdefghijklmnopqrstuvwxyz0123456789"))!!
        assertEquals("abcdefghijklmnopqrstuvwxyz0123456789", old.token)
        assertNull(old.refresh)
    }

    @Test fun signingInAgainKeepsTheTicksForTheSameHomeAssistantOnly() {
        val old = JSONObject().put("url", "http://ha.example:8123").put("token", "abcdefghijklmnopqrstuvwxyz0123456789")
            .put("scenes", org.json.JSONArray().put(JSONObject().put("entity", "scene.movie"))).toString()
        val same = HomeAssistant.signedInSection(old, "http://ha.example:8123", refresh, "http://${lan(1, 50)}:5400/")
        assertEquals("scene.movie", same.getJSONArray("scenes").getJSONObject(0).getString("entity"))
        assertFalse(same.has("token"))   // the long-lived token is dropped
        val other = HomeAssistant.signedInSection(old, "http://other.example:8123", refresh, "http://${lan(1, 50)}:5400/")
        assertFalse(other.has("scenes"))
    }

    @Test fun accessTokenIsRefreshedOnlyWhenItRunsOut() {
        pretendHa()
        var t0 = 1_000_000L
        HomeAssistant.clock = { t0 }
        val r = "refresh-only-for-this-test-0000000002"
        val s = signedIn(r)
        HomeAssistant.fake = { _, _, _ -> 200 to """{"entity_id":"climate.living","state":"cool","attributes":{}}""".toByteArray() }
        assertNotNull(HomeAssistant.state(s, "climate.living"))
        assertEquals(1, refreshes)
        assertEquals(access2, HomeAssistant.lastBearer)
        assertNotNull(HomeAssistant.state(s, "climate.living"))
        assertEquals(1, refreshes)   // still good: no second refresh
        t0 += 30 * 60_000L          // 30 minutes on: it runs out
        assertNotNull(HomeAssistant.state(s, "climate.living"))
        assertEquals(2, refreshes)
    }

    @Test fun anAccessTokenHomeAssistantRefusesIsRefreshedOnce() {
        pretendHa()
        val r = "refresh-only-for-this-test-0000000003"
        HomeAssistant.remember(r, HaAuth.Tokens(access1, r, 1800))
        val s = signedIn(r)
        HomeAssistant.fake = { _, _, _ -> if (HomeAssistant.lastBearer == access1) 401 to null else 200 to """{"state":"on"}""".toByteArray() }
        assertNotNull(HomeAssistant.state(s, "climate.living"))
        assertEquals(1, refreshes)
        assertEquals(access2, HomeAssistant.lastBearer)
    }

    @Test fun aRefusedRefreshTokenMeansSignInAgain() {
        pretendHa(refuseRefresh = true)
        val s = signedIn("refresh-only-for-this-test-0000000004")
        var asked = 0
        HomeAssistant.fake = { _, _, _ -> asked++; 200 to "{}".toByteArray() }
        assertNull(HomeAssistant.state(s, "climate.living"))
        assertEquals(0, asked)   // nothing went to Home Assistant without a token
        val r = HomeAssistant.listFor(s)
        assertEquals("token", r.optString("error"))
    }

    @Test fun clientIdIsTheTvOnTheHomeNetwork() {
        val own = setOf(lan(1, 50), ip(10, 0, 0, 7))
        assertEquals("http://${lan(1, 50)}:5400/", HaPhone.clientFor("${lan(1, 50)}:5400", null, 5400, own))
        assertEquals("http://${ip(10, 0, 0, 7)}:5401/", HaPhone.clientFor("${ip(10, 0, 0, 7)}:5401", "${lan(1, 50)}", 5401, own))
        // a Host address that is not one of this TV's own is never the client id: the TV's own instead
        assertEquals("http://${lan(1, 50)}:5400/", HaPhone.clientFor("${lan(1, 99)}:5400", "${lan(1, 50)}", 5400, own))
        assertNull(HaPhone.clientFor("${lan(1, 99)}:5400", null, 5400, own))
        assertEquals("http://${lan(1, 50)}:5400/", HaPhone.clientFor("evil.example:5400", "${lan(1, 50)}", 5400, own))
        assertEquals("http://${lan(1, 50)}:5400/", HaPhone.clientFor("${lan(1, 50)}:80", "${lan(1, 50)}", 5400, own))
        assertEquals("http://${ip(172, 20, 1, 2)}:5400/", HaPhone.clientFor("8.8.8.8:5400", "${ip(172, 20, 1, 2)}", 5400, own))
        assertNull(HaPhone.clientFor(null, null, 5400, own))
        assertNull(HaPhone.clientFor("8.8.8.8:5400", "8.8.4.4", 5400, setOf("8.8.8.8")))
    }

    @Test fun homeAssistantsAnnouncementGivesAnAddressTheTvCanReach() {
        // a name the TV cannot look up: the number address it resolved to, with the scheme and port said
        assertEquals("http://${lan(1, 20)}:8123", HaFind.urlFrom(mapOf("internal_url" to "http://homeassistant.local:8123"), "${lan(1, 20)}", 8123))
        // a number address said outright stays
        assertEquals("http://${lan(1, 21)}:8123", HaFind.urlFrom(mapOf("internal_url" to "http://${lan(1, 21)}:8123"), "${lan(1, 20)}", 8123))
        // https with a real name stays as it is (its certificate is for that name)
        assertEquals("https://ha.example.com", HaFind.urlFrom(mapOf("internal_url" to "https://ha.example.com"), "${lan(1, 20)}", 8123))
        // nothing said: the resolved address and port
        assertEquals("http://${lan(1, 20)}:8123", HaFind.urlFrom(emptyMap(), "${lan(1, 20)}", 8123))
        assertEquals("http://${lan(1, 20)}:8123", HaFind.urlFrom(mapOf("base_url" to "http://homeassistant.local:8123"), "${lan(1, 20)}", 8123))
        assertNull(HaFind.urlFrom(emptyMap(), null, 8123))
    }
}
