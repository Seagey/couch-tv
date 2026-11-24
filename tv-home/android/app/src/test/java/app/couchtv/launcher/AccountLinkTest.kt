package app.couchtv.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Couch TV Setup's two start extras: only exact shapes are kept, the link stays out of the page. */
class AccountLinkTest {
    private class Mem : AccountLink.Kv {
        val m = HashMap<String, String>()
        override fun get(k: String): String? = m[k]
        override fun put(k: String, v: String?) { if (v == null) m.remove(k) else m[k] = v }
    }

    private val link = "a".repeat(20) + "B9_-" + "z".repeat(16)          // 40 url safe characters
    private val code = "CTV1-" + "Ab3_-".repeat(8) + "xyz"              // CTV1- plus 43

    @Test fun takesTheExactShapes() {
        val kv = Mem()
        assertTrue(AccountLink.readExtras(kv, link, code, 1000L))
        assertTrue(AccountLink.linked(kv))
        assertEquals(link, AccountLink.token(kv))
        assertEquals(code, AccountLink.pendingCode(kv, 2000L))
    }

    @Test fun refusesEverythingElse() {
        val bad = listOf(null, "", "short", "a".repeat(31), "a".repeat(129), "a".repeat(40) + " ", "a".repeat(40) + ";rm",
            "a".repeat(39) + "\n", "a".repeat(39) + "é", "a".repeat(39) + "=", "../" + "a".repeat(40))
        for (b in bad) assertNull(b.toString(), AccountLink.cleanLink(b))
        val badCodes = listOf(null, "", "ABCDE-FGHJK", "CTV1-" + "a".repeat(42), "CTV1-" + "a".repeat(44), "ctv1-" + "a".repeat(43),
            "CTV1-" + "a".repeat(42) + "+", "CTV1-" + "a".repeat(42) + " ", "CTV2-" + "a".repeat(43))
        for (b in badCodes) assertNull(b.toString(), AccountLink.cleanCode(b))
        val kv = Mem()
        assertFalse(AccountLink.readExtras(kv, "nope", "nope", 1L))
        assertTrue(kv.m.isEmpty())
    }

    @Test fun aBadValueKeepsWhatWasThere() {
        val kv = Mem()
        AccountLink.readExtras(kv, link, null, 1L)
        AccountLink.readExtras(kv, "x", null, 2L)
        assertEquals(link, AccountLink.token(kv))
    }

    @Test fun theCodeIsKeptADayAndThenDropped() {
        val kv = Mem()
        AccountLink.readExtras(kv, null, code, 0L)
        assertFalse("a code alone does not link the TV", AccountLink.linked(kv))
        assertEquals(code, AccountLink.pendingCode(kv, AccountLink.CODE_KEEP_MS - 1))
        assertNull(AccountLink.pendingCode(kv, AccountLink.CODE_KEEP_MS))
        assertTrue("dropped once too old", kv.m.isEmpty())
        // a time before it was kept (the clock went back) is not trusted either
        AccountLink.readExtras(kv, null, code, 5000L)
        assertNull(AccountLink.pendingCode(kv, 4000L))
    }

    @Test fun doneAndUnlink() {
        val kv = Mem()
        AccountLink.readExtras(kv, link, code, 0L)
        AccountLink.codeDone(kv)
        assertNull(AccountLink.pendingCode(kv, 1L))
        assertTrue(AccountLink.linked(kv))
        AccountLink.readExtras(kv, null, code, 0L)
        AccountLink.unlink(kv)
        assertFalse(AccountLink.linked(kv))
        assertNull(AccountLink.pendingCode(kv, 1L))
        assertTrue(kv.m.isEmpty())
    }

    // ---- the TV inbox answer: only a state, one checked code and its title reach the page ----
    @Test fun inboxTakesTheNewestGoodItem() {
        val c2 = "CTV1-" + "Z".repeat(43)
        val r = AccountLink.readInbox(200, """{"items":[{"code":"$code","title":"Old"},{"code":"$c2","title":" Sunday <b>morning</b>\u0007 ","sent_at":"x"},{"code":"bad"}],"poll":60}""", null)
        assertEquals("item", r.getString("state"))
        assertEquals(c2, r.getString("code"))
        assertEquals("Sunday bmorning/b", r.getString("title"))
        assertEquals(60L, r.getLong("poll"))   // passed on; the page looks once a week unless Studio says longer
        assertEquals(setOf("state", "code", "title", "poll"), r.keys().asSequence().toSet())
    }

    // The answer exactly as Studio's setup API was built (DREAM-SETUP-BUILD.md, "TV inbox", 24 Nov 2026):
    // GET /v1/setup/inbox, Bearer link, {items: [{code, title, sent_at}], poll: 60}, newest last, at most 5,
    // each item handed out once; 401 {"error": "unlinked"} means stop and forget the link.
    @Test fun inboxAsStudioBuiltIt() {
        val older = "CTV1-" + "Q".repeat(43)
        val newest = "CTV1-" + "r".repeat(42) + "9"
        val body = """{"items":[{"code":"$older","title":"Weekday","sent_at":"2026-11-24T05:09:00.000Z"},""" +
            """{"code":"$newest","title":"Sunday morning","sent_at":"2026-11-24T05:10:00.000Z"}],"poll":60}"""
        val r = AccountLink.readInbox(200, body, null)
        assertEquals("item", r.getString("state"))
        assertEquals(newest, r.getString("code"))
        assertEquals("Sunday morning", r.getString("title"))
        assertEquals(60L, r.getLong("poll"))
        assertFalse("sent_at never reaches the page", r.has("sent_at"))
        assertEquals("none", AccountLink.readInbox(200, """{"items":[],"poll":60}""", null).getString("state"))
        assertEquals("unlinked", AccountLink.readInbox(401, """{"error":"unlinked"}""", null).getString("state"))
        assertEquals("unlinked", AccountLink.readInbox(401, "", null).getString("state"))
        assertEquals(90L, AccountLink.readInbox(429, """{"error":"slow_down","retry_after":90}""", "90").getLong("wait"))
        assertEquals("https://couchtv.joshuaseage.com", AccountLink.STUDIO)
    }

    @Test fun inboxStates() {
        assertEquals("none", AccountLink.readInbox(200, """{"items":[],"poll":60}""", null).getString("state"))
        assertEquals(30L, AccountLink.readInbox(200, """{"items":[],"poll":1}""", null).getLong("poll"))
        assertEquals(1209600L, AccountLink.readInbox(200, """{"items":[],"poll":1209600}""", null).getLong("poll"))   // two weeks: kept
        assertEquals(1728000L, AccountLink.readInbox(200, """{"items":[],"poll":1e9}""", null).getLong("poll"))
        assertEquals(604800L, AccountLink.readInbox(200, """{"items":[],"poll":"soon"}""", null).getLong("poll"))   // a week
        assertEquals("none", AccountLink.readInbox(200, """{"items":[{"code":"ABCDE-FGHJK"},{"x":1},5]}""", null).getString("state"))
        assertEquals("unlinked", AccountLink.readInbox(401, """{"error":"unlinked"}""", null).getString("state"))
        val w = AccountLink.readInbox(429, null, "120")
        assertEquals("wait", w.getString("state")); assertEquals(120L, w.getLong("wait"))
        assertEquals(86400L, AccountLink.readInbox(429, null, "999999").getLong("wait"))
        assertEquals(30L, AccountLink.readInbox(429, null, "1").getLong("wait"))
        assertEquals(900L, AccountLink.readInbox(429, null, "Wed, 21 Oct 2026 07:28:00 GMT").getLong("wait"))
        for ((s, b) in listOf(500 to "{}", 200 to null, 200 to "not json", 200 to "[]", 200 to "{}", 302 to "", 200 to "x".repeat(70000)))
            assertEquals("$s $b".take(30), "error", AccountLink.readInbox(s, b, null).getString("state"))
    }

    @Test fun noLinkNoRequest() {
        val kv = Mem()
        assertEquals("unlinked", AccountLink.inbox(kv).getString("state"))
    }

    @Test fun aStoredValueIsCheckedAgainWhenRead() {
        val kv = Mem()
        kv.m["link"] = "tampered value"
        assertFalse(AccountLink.linked(kv))
        assertNull(AccountLink.token(kv))
    }

    // ---- the security gate, 25 Nov 2026 ----

    @Test fun theProofIsNotTheLink() {
        assertEquals(16, AccountLink.proof(link).length)
        assertFalse(link.contains(AccountLink.proof(link)))
        assertEquals("ba7816bf8f01cfea", AccountLink.proof("abc"))      // sha256("abc"), as Setup works it out
    }

    @Test fun aRefusalOfTheOldLinkNeverForgetsTheNewOne() {
        val kv = Mem()
        AccountLink.readExtras(kv, link, null, 1L)
        val newer = "n".repeat(43)
        AccountLink.readExtras(kv, newer, null, 2L)                     // relinked while the old one was being asked about
        val r = org.json.JSONObject().put("state", "unlinked")
        AccountLink.answered(kv, link, r)
        assertEquals(newer, AccountLink.token(kv))
        assertEquals("error", r.optString("state"))
        AccountLink.answered(kv, newer, org.json.JSONObject().put("state", "unlinked"))
        assertFalse(AccountLink.linked(kv))
    }

    @Test fun whoStartedIt() {
        val who = StartRules.Who.UNKNOWN
        assertEquals(StartRules.Who.COMPUTER, StartRules.who(30, "com.android.shell"))
        assertEquals(StartRules.Who.COMPUTER, StartRules.who(34, "com.android.shell"))
        assertEquals(StartRules.Who.APP, StartRules.who(31, "com.some.game"))
        assertEquals(who, StartRules.who(31, null))
        // Android 10 and older (Fire OS 7 is 9): the name is only what the caller says
        assertEquals(who, StartRules.who(28, "com.android.shell"))
        assertEquals(who, StartRules.who(29, "com.android.shell"))
    }

    @Test fun whatHappensToAStart() {
        val take = StartRules.Do.TAKE; val ask = StartRules.Do.ASK; val drop = StartRules.Do.DROP
        for (link in listOf(true, false)) for (setUp in listOf(true, false)) {
            assertEquals(take, StartRules.decide(StartRules.Who.COMPUTER, false, link, setUp))
            assertEquals(drop, StartRules.decide(StartRules.Who.APP, false, link, setUp))
            for (w in StartRules.Who.values()) assertEquals("a replay", drop, StartRules.decide(w, true, link, setUp))
        }
        val u = StartRules.Who.UNKNOWN
        assertEquals("the first set up asks nothing", take, StartRules.decide(u, false, false, false))
        assertEquals(ask, StartRules.decide(u, false, false, true))
        assertEquals("never a link from nobody", ask, StartRules.decide(u, false, true, false))
        assertEquals(ask, StartRules.decide(u, false, true, true))
    }

    @Test fun aTvInUseAsksEvenWhenNoComputerSetItUp() {
        val hour = 3_600_000L
        assertFalse("just installed, nothing on it", StartRules.setUp(settings = false, linked = false, installedFor = 5 * 60_000L))
        assertTrue(StartRules.setUp(settings = true, linked = false, installedFor = 0))
        assertTrue("linked to an account", StartRules.setUp(settings = false, linked = true, installedFor = 0))
        assertTrue("put on by hand and used for days", StartRules.setUp(settings = false, linked = false, installedFor = 48 * hour))
        assertTrue("a clock that moved back says nothing", StartRules.setUp(settings = false, linked = false, installedFor = -hour))
    }

    @Test fun theSameStartIsDealtWithOnce() {
        val kv = Mem()
        val x = mapOf("bridge" to "none", "config_b64" to "e30=", "account_link" to null)
        val a = StartRules.startId(x, 7, 3)
        assertEquals(a, StartRules.startId(x.toList().reversed().toMap(), 7, 3))
        assertFalse(StartRules.seen(kv, a))
        assertTrue("after the process died, the same task's intent again", StartRules.seen(kv, a))
        assertFalse("a new am start of the same words is a new task", StartRules.seen(kv, StartRules.startId(x, 8, 3)))
        assertFalse("or another boot", StartRules.seen(kv, StartRules.startId(x, 7, 4)))
        assertFalse(StartRules.seen(kv, StartRules.startId(x + ("bridge" to "http://192.0.2.1"), 7, 3)))
        assertTrue(StartRules.seen(kv, a))
        repeat(40) { StartRules.seen(kv, "s$it") }
        assertTrue(kv.get("starts")!!.split(",").size <= 12)
    }
}
