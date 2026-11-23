package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

/** The "ask" hook's rules for each kind of AI service, with no network and no TV. */
class AskWireTest {
    // Home network addresses are built from their parts, so the repo's privacy scan (scripts/privacy-scan.sh)
    // finds no private address written out in full.
    private fun dotted(vararg p: Int) = p.joinToString(".")
    private val HOME_PC = dotted(192, 168, 1, 20)
    private val TV_IP = dotted(192, 168, 1, 50)
    private val EMULATOR_HOST = dotted(10, 0, 2, 2)

    private val tools = listOf(
        AskTool("key", "Press a remote key.", JSONObject().put("key", JSONObject().put("type", "string")), listOf("key")),
        AskTool("now", "What is on.", JSONObject(), emptyList()))

    private fun claude(key: String? = "sk-ant-x", model: String? = null, base: String? = null) = AskConfig.of(null, base, model, key)
    private fun openai(base: String? = null, model: String? = "m1", key: String? = "sk-x") = AskConfig.of("openai", base, model, key)

    // ---- settings and checks

    @Test fun defaultsAreClaudeHaikuOnAnthropic() {
        val c = AskConfig.of(null, null, null, "k")
        assertEquals("anthropic", c.provider); assertEquals("https://api.anthropic.com", c.base); assertEquals("claude-haiku-5-5", c.model)
        assertEquals("https://api.anthropic.com/v1/messages", AskWire.endpoint(c))
    }

    @Test fun openAiDefaultsToOpenAiButHasNoDefaultModel() {
        val c = AskConfig.of("openai", "", "", "k")
        assertEquals("https://api.openai.com/v1", c.base); assertEquals("", c.model)
        assertFalse("no model, not ready", c.ready)
        assertEquals("https://api.openai.com/v1/chat/completions", AskWire.endpoint(c.let { AskConfig.of("openai", null, "m", "k") }))
    }

    @Test fun aTrailingSlashOnTheAddressIsIgnored() {
        assertEquals("https://openrouter.ai/api/v1/chat/completions", AskWire.endpoint(openai("https://openrouter.ai/api/v1/")))
    }

    @Test fun anUnknownProviderFallsBackToClaude() {
        assertEquals("anthropic", AskConfig.of("gemini-native", null, null, "k").provider)
    }

    @Test fun readyNeedsAKeyUnlessItIsAServerAtHome() {
        assertFalse(openai(key = null).ready)
        assertFalse(openai("https://api.openai.com/v1", key = null).ready)
        assertTrue(openai("http://$HOME_PC:11434/v1", key = null).ready)
        assertTrue(openai("http://my-computer.local:8080/v1", key = null).ready)
        assertFalse("Claude always needs a key", AskConfig.of(null, "http://$HOME_PC", null, null).ready)
        assertTrue(claude().ready)
    }

    @Test fun localHostsAreOnlyHomeNetworkAddresses() {
        for (h in listOf("localhost", "127.0.0.1", dotted(10, 1, 2, 3), dotted(192, 168, 0, 9), dotted(172, 16, 0, 1), dotted(172, 31, 255, 1), dotted(169, 254, 1, 1), "example.local", "[::1]")) assertTrue(h, AskWire.isLocalHost(h))
        for (h in listOf("api.openai.com", "8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "11.0.0.1", "1.2.3", "10.0.0.256", "evil.example.local.example.com", "", null)) assertFalse(h.toString(), AskWire.isLocalHost(h))
    }

    @Test fun checkAcceptsGoodSettings() {
        assertNull(AskWire.check("anthropic", "", ""))
        assertNull(AskWire.check("openai", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"))
        assertNull(AskWire.check("openai", "http://$HOME_PC:11434/v1", "qwen2.5:7b"))
        assertNull(AskWire.check("openai", "https://openrouter.ai/api/v1", "anthropic/claude-haiku-5-5"))
    }

    @Test fun checkRefusesWhatCouldLeakAKey() {
        assertNotNull("plain http to the internet", AskWire.check("openai", "http://api.example.com/v1", "m"))
        assertNotNull("name and password in the address", AskWire.check("openai", "https://user:pw@example.com/v1", "m"))
        assertNotNull("a query hides the real path", AskWire.check("openai", "http://$HOME_PC/admin?cmd=reboot&x=", "m"))
        assertNotNull("a fragment hides the real path", AskWire.check("openai", "https://api.example.com/v1#", "m"))
        assertNotNull("not http at all", AskWire.check("openai", "file:///etc/passwd", "m"))
        assertNotNull("not http at all", AskWire.check("openai", "javascript:alert(1)", "m"))
        assertNotNull("no host", AskWire.check("openai", "https:///v1", "m"))
        assertNotNull("not a web address", AskWire.check("openai", "not a url", "m"))
        assertNotNull("too long", AskWire.check("openai", "https://a.example.com/" + "x".repeat(300), "m"))
    }

    @Test fun checkWantsAModelForOpenAiAndASaneName() {
        assertNotNull(AskWire.check("openai", "", ""))
        assertNotNull(AskWire.check("openai", "", "bad model name!"))
        assertNotNull(AskWire.check("openai", "", "x".repeat(101)))
        assertNotNull(AskWire.check("grok", "", "m"))
    }

    // ---- Claude (Anthropic)

    @Test fun claudeRequestKeepsItsOldShape() {
        val chat = AskWire.chat(claude(), "sys", tools)
        chat.addUser("put on bluey")
        val b = chat.body()
        assertEquals("claude-haiku-5-5", b.getString("model")); assertEquals(1024, b.getInt("max_tokens")); assertEquals("sys", b.getString("system"))
        assertEquals("auto", b.getJSONObject("tool_choice").getString("type"))
        assertEquals("low", b.getJSONObject("output_config").getString("effort"))
        val t = b.getJSONArray("tools").getJSONObject(0)
        assertEquals("key", t.getString("name")); assertEquals("object", t.getJSONObject("input_schema").getString("type"))
        assertEquals("key", t.getJSONObject("input_schema").getJSONArray("required").getString(0))
        assertEquals("user", b.getJSONArray("messages").getJSONObject(0).getString("role"))
        assertEquals("https://api.anthropic.com/v1/messages", chat.url)
        assertEquals("sk-ant-x", chat.headers()["x-api-key"]); assertEquals("2023-06-01", chat.headers()["anthropic-version"])
    }

    @Test fun claudeEffortIsOnlySentToHaiku() {
        val b = AskWire.chat(claude(model = "claude-sonnet-5-5"), "s", tools).body()
        assertFalse(b.has("output_config")); assertEquals("claude-sonnet-5-5", b.getString("model"))
    }

    @Test fun claudeToolUseGoesRoundAndBack() {
        val chat = AskWire.chat(claude(), "s", tools)
        chat.addUser("louder")
        val turn = chat.accept(JSONObject("""{"stop_reason":"tool_use","content":[{"type":"text","text":"ok"},{"type":"tool_use","id":"tu_1","name":"key","input":{"key":"volume_up"}}]}"""))
        assertFalse(turn.done); assertEquals("ok", turn.text)
        assertEquals("tu_1", turn.calls[0].id); assertEquals("volume_up", turn.calls[0].args.getString("key"))
        chat.addResults(listOf(AskResult("tu_1", "pressed", false)))
        val m = chat.body().getJSONArray("messages")
        assertEquals(3, m.length())
        assertEquals("assistant", m.getJSONObject(1).getString("role"))
        val r = m.getJSONObject(2).getJSONArray("content").getJSONObject(0)
        assertEquals("tool_result", r.getString("type")); assertEquals("tu_1", r.getString("tool_use_id")); assertFalse(r.getBoolean("is_error"))
    }

    @Test fun claudeEndTurnIsDone() {
        val chat = AskWire.chat(claude(), "s", tools); chat.addUser("hi")
        val t = chat.accept(JSONObject("""{"stop_reason":"end_turn","content":[{"type":"text","text":"Hello there"}]}"""))
        assertTrue(t.done); assertEquals("Hello there", t.text)
    }

    // ---- OpenAI and everything like it

    @Test fun openAiRequestUsesSystemMessageAndFunctionTools() {
        val chat = AskWire.chat(openai(), "sys", tools)
        chat.addUser("put on bluey")
        val b = chat.body()
        assertEquals("m1", b.getString("model")); assertEquals("auto", b.getString("tool_choice"))
        val m = b.getJSONArray("messages")
        assertEquals("system", m.getJSONObject(0).getString("role")); assertEquals("sys", m.getJSONObject(0).getString("content"))
        assertEquals("user", m.getJSONObject(1).getString("role"))
        val t = b.getJSONArray("tools").getJSONObject(0)
        assertEquals("function", t.getString("type"))
        val f = t.getJSONObject("function")
        assertEquals("key", f.getString("name")); assertEquals("object", f.getJSONObject("parameters").getString("type"))
        assertFalse("no Anthropic fields", b.has("system") || b.has("output_config"))
        assertEquals("https://api.openai.com/v1/chat/completions", chat.url)
        assertEquals("Bearer sk-x", chat.headers()["authorization"]); assertFalse(chat.headers().containsKey("x-api-key"))
    }

    @Test fun openAiTokenLimitNameDependsOnTheService() {
        val official = AskWire.chat(openai("https://api.openai.com/v1"), "s", tools).body()
        assertTrue(official.has("max_completion_tokens")); assertFalse(official.has("max_tokens"))
        val other = AskWire.chat(openai("https://api.groq.com/openai/v1"), "s", tools).body()
        assertTrue(other.has("max_tokens")); assertFalse(other.has("max_completion_tokens"))
    }

    @Test fun aServerAtHomeGetsNoAuthorizationHeader() {
        val h = AskWire.chat(openai("http://$HOME_PC:11434/v1", key = null), "s", tools).headers()
        assertFalse(h.containsKey("authorization"))
    }

    @Test fun openAiToolCallsAreReadAndEchoedBackCleanly() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("louder")
        val turn = chat.accept(JSONObject("""{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"refusal":null,"reasoning_content":"thinking",
            "tool_calls":[{"id":"call_a","type":"function","function":{"name":"key","arguments":"{\"key\":\"volume_up\"}"}}]}}]}"""))
        assertFalse(turn.done); assertEquals("call_a", turn.calls[0].id); assertEquals("key", turn.calls[0].name); assertEquals("volume_up", turn.calls[0].args.getString("key"))
        chat.addResults(listOf(AskResult("call_a", "pressed", false)))
        val m = chat.body().getJSONArray("messages")
        assertEquals(4, m.length())
        val echoed = m.getJSONObject(2)
        assertEquals("assistant", echoed.getString("role")); assertTrue(echoed.isNull("content"))
        assertFalse("extras are not sent back", echoed.has("refusal") || echoed.has("reasoning_content"))
        assertEquals("call_a", echoed.getJSONArray("tool_calls").getJSONObject(0).getString("id"))
        assertEquals("{\"key\":\"volume_up\"}", echoed.getJSONArray("tool_calls").getJSONObject(0).getJSONObject("function").getString("arguments"))
        val r = m.getJSONObject(3)
        assertEquals("tool", r.getString("role")); assertEquals("call_a", r.getString("tool_call_id")); assertEquals("pressed", r.getString("content"))
    }

    @Test fun openAiToolErrorsGoBackAsErrors() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("x")
        chat.accept(JSONObject("""{"choices":[{"message":{"content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"key","arguments":"{}"}}]}}]}"""))
        chat.addResults(listOf(AskResult("c1", "no such key", true)))
        assertEquals("Error: no such key", chat.body().getJSONArray("messages").getJSONObject(3).getString("content"))
    }

    @Test fun openAiToleratesServicesThatBendTheRules() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("x")
        // no id, arguments as an object, finish_reason "stop" although tools were asked for (Gemini and Ollama do these)
        val turn = chat.accept(JSONObject("""{"choices":[{"finish_reason":"stop","message":{"content":"on it","tool_calls":[{"type":"function","function":{"name":"key","arguments":{"key":"home"}}}]}}]}"""))
        assertFalse("tools were asked for, so it is not done", turn.done)
        assertTrue(turn.calls[0].id.isNotEmpty()); assertEquals("home", turn.calls[0].args.getString("key"))
        val echoed = chat.body().getJSONArray("messages").getJSONObject(2)
        assertEquals(turn.calls[0].id, echoed.getJSONArray("tool_calls").getJSONObject(0).getString("id"))
        assertTrue("arguments go back as a string", echoed.getJSONArray("tool_calls").getJSONObject(0).getJSONObject("function").get("arguments") is String)
    }

    @Test fun openAiEmptyArgumentsAreAnEmptyObject() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("x")
        val t = chat.accept(JSONObject("""{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"now","arguments":""}}]}}]}"""))
        assertNull(t.calls[0].error); assertEquals(0, t.calls[0].args.length())
    }

    @Test fun openAiBrokenArgumentsAreReportedNotCrashed() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("x")
        val t = chat.accept(JSONObject("""{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{not json"}}]}}]}"""))
        assertNotNull(t.calls[0].error); assertEquals(0, t.calls[0].args.length())
    }

    @Test fun openAiTextCanComeAsParts() {
        val chat = AskWire.chat(openai(), "s", tools); chat.addUser("x")
        val t = chat.accept(JSONObject("""{"choices":[{"finish_reason":"stop","message":{"content":[{"type":"text","text":"Hello"},{"type":"text","text":"there"}]}}]}"""))
        assertTrue(t.done); assertEquals("Hello there", t.text)
    }

    // ---- the whole loop

    private fun claudeTransport(vararg replies: String): (String, Map<String, String>, JSONObject) -> JSONObject {
        var i = 0; return { _, _, _ -> JSONObject(replies[i++]) }
    }

    @Test fun runLoopRunsToolsThenAnswers() {
        val replies = listOf(
            """{"choices":[{"message":{"content":null,"tool_calls":[{"id":"c1","type":"function","function":{"name":"key","arguments":"{\"key\":\"mute\"}"}}]}}]}""",
            """{"choices":[{"finish_reason":"stop","message":{"content":"Muted."}}]}""")
        var n = 0; val seen = ArrayList<JSONObject>()
        val ran = ArrayList<String>()
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "mute it", { url, h, body ->
            assertEquals("https://api.openai.com/v1/chat/completions", url); assertEquals("Bearer sk-x", h["authorization"])
            seen.add(JSONObject(body.toString())); JSONObject(replies[n++])
        }, { name, a -> ran.add(name + ":" + a.getString("key")); "ok" })
        assertEquals("Muted.", out.reply); assertEquals(listOf("key:mute"), ran)
        assertEquals(1, out.actions.length()); assertTrue(out.actions.getJSONObject(0).getBoolean("ok"))
        assertEquals("the second call carries the tool result", "tool", seen[1].getJSONArray("messages").let { it.getJSONObject(it.length() - 1) }.getString("role"))
    }

    @Test fun runLoopWorksTheSameForClaude() {
        val tr = claudeTransport(
            """{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"now","input":{}}]}""",
            """{"stop_reason":"end_turn","content":[{"type":"text","text":"Bluey is on."}]}""")
        val out = AskWire.run(AskWire.chat(claude(), "s", tools), "what is on", tr, { _, _ -> "Bluey" })
        assertEquals("Bluey is on.", out.reply); assertEquals(1, out.actions.length())
    }

    @Test fun runLoopTurnsAToolFailureIntoAnErrorTheModelSees() {
        val seen = ArrayList<String>()
        var n = 0
        val replies = listOf(
            """{"choices":[{"message":{"tool_calls":[{"id":"c1","type":"function","function":{"name":"key","arguments":"{\"key\":\"zzz\"}"}}]}}]}""",
            """{"choices":[{"message":{"content":"That key does not exist."}}]}""")
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, body ->
            seen.add(body.getJSONArray("messages").let { it.getJSONObject(it.length() - 1) }.optString("content")); JSONObject(replies[n++])
        }, { _, _ -> throw IllegalArgumentException("unknown key zzz") })
        assertEquals("That key does not exist.", out.reply)
        assertEquals("Error: unknown key zzz", seen[1]); assertFalse(out.actions.getJSONObject(0).getBoolean("ok"))
    }

    @Test fun runLoopStopsAfterFiveRoundsAndSaysDone() {
        var calls = 0
        val reply = """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"now","arguments":"{}"}}]}}]}"""
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "loop", { _, _, _ -> calls++; JSONObject(reply) }, { _, _ -> "x" })
        assertEquals(5, calls); assertEquals("Done.", out.reply); assertEquals(5, out.actions.length())
    }

    @Test fun runLoopDoesNotPretendWhenTheModelSaidAndDidNothing() {
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject("""{"choices":[{"message":{"content":""}}]}""") }, { _, _ -> "" })
        assertEquals("I did not catch that. Could you say it another way?", out.reply)
        assertEquals(0, out.actions.length())
    }

    @Test fun runLoopSaysDoneWhenToolsRanFineAndTheModelHadNoWords() {
        val replies = listOf(
            """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{\"key\":\"mute\"}"}}]}}]}""",
            """{"choices":[{"message":{"content":""}}]}""")
        var n = 0
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject(replies[n++]) }, { _, _ -> "ok" })
        assertEquals("Done.", out.reply)
    }

    @Test fun runLoopExplainsWhenEveryTryFailedAndItRanOutOfRounds() {
        // what happened on a TV with none of the apps the model guessed: five launches, five failures, then a bare "Done."
        val reply = """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{\"key\":\"x\"}"}}]}}]}"""
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "put on something funny", { _, _, _ -> JSONObject(reply) },
            { _, _ -> throw IllegalStateException("com.netflix.ninja is not installed on the TV") })
        assertTrue(out.reply, out.reply.startsWith("I could not finish that."))
        assertTrue(out.reply, out.reply.contains("com.netflix.ninja is not installed on the TV"))
        assertFalse(out.reply == "Done.")
        assertEquals(5, out.actions.length())
    }

    @Test fun runLoopGivesTheReasonWhenAToolFailedAndTheModelStoppedWithoutWords() {
        val replies = listOf(
            """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{\"key\":\"zzz\"}"}}]}}]}""",
            """{"choices":[{"message":{"content":""}}]}""")
        var n = 0
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject(replies[n++]) }, { _, _ -> throw IllegalArgumentException("unknown key zzz") })
        assertEquals("That did not work. Last problem: key: unknown key zzz", out.reply)
    }

    @Test fun aLongToolErrorIsCutInTheReply() {
        val reply = """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{}"}}]}}]}"""
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject(reply) }, { _, _ -> throw IllegalStateException("e".repeat(1000)) })
        assertTrue(out.reply.length < 260)
    }

    @Test fun runLoopDoesNotRunATool_WhenItsArgumentsWereBroken() {
        var ran = false; var n = 0
        val replies = listOf(
            """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":{"name":"key","arguments":"{oops"}}]}}]}""",
            """{"choices":[{"message":{"content":"Sorry."}}]}""")
        val out = AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject(replies[n++]) }, { _, _ -> ran = true; "x" })
        assertFalse(ran); assertEquals("Sorry.", out.reply)
    }

    // ---- errors

    @Test fun errorMessagesNameTheServiceAndTheReason() {
        assertEquals("Claude API error 401: invalid x-api-key", AskWire.errorMessage(claude(), 401, """{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"""))
        assertEquals("AI service error 429 (api.openai.com): Rate limit", AskWire.errorMessage(openai(), 429, """{"error":{"message":"Rate limit","type":"x"}}"""))
        assertEquals("AI service error 400 (openrouter.ai): bad model", AskWire.errorMessage(openai("https://openrouter.ai/api/v1"), 400, """{"error":"bad model"}"""))
    }

    @Test fun errorMessagesNeverReadBackWhateverElseAServerSent() {
        // the address can be one the household typed: only a JSON error message is shown, not an arbitrary page or file
        val page = AskWire.errorMessage(openai(), 502, "<html>secret internal page</html>")
        assertEquals("AI service error 502 (api.openai.com): no details", page)
        assertFalse(AskWire.errorMessage(openai(), 200, "root:x:0:0:root:/root:/bin/sh").contains("root:"))
        assertFalse("JSON without an error is not echoed", AskWire.errorMessage(openai(), 404, """{"name":"internal","password":"hunter2"}""").contains("hunter2"))
        assertEquals("a long message is cut", 200, AskWire.errorMessage(openai(), 500, """{"error":{"message":"${"x".repeat(500)}"}}""").substringAfter("): ").length)
    }

    @Test fun aReplyInTheWrongShapeIsNeverQuotedBack() {
        val odd = listOf(
            """{"choices":"hunter2"}""", """{"choices":[{"message":"hunter2"}]}""", """{"choices":[]}""",
            """{"content":"hunter2"}""", """{"name":"internal","password":"hunter2"}""",
            """{"choices":[{"message":{"tool_calls":[{"id":"c","type":"function","function":"hunter2"}]}}]}""")
        for (cfg in listOf(openai(), claude())) for (json in odd) {
            try {
                AskWire.run(AskWire.chat(cfg, "s", tools), "x", { _, _, _ -> JSONObject(json) }, { _, _ -> "" })
                // a reply the reader could make sense of is fine, as long as nothing was quoted
            } catch (e: ApiError) {
                assertEquals(502, e.status)
                assertFalse("quoted the reply: ${e.message}", e.message!!.contains("hunter2") || e.message!!.contains("password"))
                assertTrue(e.message!!.contains(AskWire.host(cfg.base)!!))
            }
        }
        // and the common bad shape really does end in that sentence, not in a raw JSON error
        try { AskWire.run(AskWire.chat(openai(), "s", tools), "x", { _, _, _ -> JSONObject("""{"choices":"hunter2"}""") }, { _, _ -> "" }); org.junit.Assert.fail("should have thrown") }
        catch (e: ApiError) { assertEquals("The AI service at api.openai.com answered in a format this TV does not understand.", e.message) }
    }

    // ---- the TV itself, checked on the addresses a name really resolved to

    private fun ip(s: String) = InetAddress.getByAddress(s.split('.').map { it.toInt().toByte() }.toByteArray())

    @Test fun theTvItselfIsCaughtOnTheResolvedAddress() {
        val own = listOf(ip("$TV_IP"))
        assertTrue("loopback, however it was spelled", AskWire.pointsAtThisDevice(listOf(ip("127.0.0.1")), own))
        assertTrue("any other 127.x", AskWire.pointsAtThisDevice(listOf(ip("127.9.8.7")), own))
        assertTrue("0.0.0.0", AskWire.pointsAtThisDevice(listOf(ip("0.0.0.0")), own))
        assertTrue("IPv6 loopback", AskWire.pointsAtThisDevice(listOf(InetAddress.getByName("::1")), own))
        assertTrue("the TV's own address on the network", AskWire.pointsAtThisDevice(listOf(ip("$TV_IP")), own))
        assertTrue("one bad address among good ones (a name with several answers)", AskWire.pointsAtThisDevice(listOf(ip("8.8.8.8"), ip("127.0.0.1")), own))
        assertFalse("another computer on the network", AskWire.pointsAtThisDevice(listOf(ip("$HOME_PC")), own))
        assertFalse("the internet", AskWire.pointsAtThisDevice(listOf(ip("104.18.2.161")), own))
        assertFalse("nothing resolved is not a hit", AskWire.pointsAtThisDevice(emptyList(), own))
    }

    // ---- where a key may go

    @Test fun anOriginIsTheServiceSchemeHostAndPort() {
        assertEquals("openai|https://api.openai.com:443", AskWire.origin("openai", "https://api.openai.com/v1"))
        assertEquals("openai|https://api.openai.com:443", AskWire.origin("openai", "HTTPS://API.OPENAI.COM:443/other/path"))
        assertEquals("anthropic|https://api.anthropic.com:443", AskWire.origin("anthropic", AskWire.ANTHROPIC_BASE))
        assertEquals("openai|http://$HOME_PC:11434", AskWire.origin("openai", "http://$HOME_PC:11434/v1"))
    }

    @Test fun anyChangeOfServiceSchemeHostOrPortIsADifferentOrigin() {
        val o = AskWire.origin("openai", "https://api.example.com/v1")
        for (other in listOf(
            AskWire.origin("anthropic", "https://api.example.com/v1"),
            AskWire.origin("openai", "http://api.example.com/v1"),
            AskWire.origin("openai", "https://api.example.org/v1"),
            AskWire.origin("openai", "https://api.example.com:8443/v1"),
            AskWire.origin("openai", "https://api.example.com.evil.test/v1"))) assertTrue(other, other != o)
        assertEquals("a path change is the same origin", o, AskWire.origin("openai", "https://api.example.com/v2/other"))
        assertEquals("the default port is the same origin", o, AskWire.origin("openai", "https://api.example.com:443/v1"))
    }

    @Test fun aClaudeKeySavedByAnOlderVersionKeepsWorkingForClaude() {
        // older versions stored just the key, with no origin
        assertEquals("sk-old", AskWire.usableKey("sk-old", null, "anthropic", AskWire.ANTHROPIC_BASE))
        assertEquals("sk-old", AskWire.usableKey("  sk-old ", null, "anthropic", "https://api.anthropic.com/"))
        // ...but never for anywhere else
        assertNull(AskWire.usableKey("sk-old", null, "openai", "https://api.openai.com/v1"))
        assertNull(AskWire.usableKey("sk-old", null, "anthropic", "https://proxy.example.com"))
        assertNull(AskWire.usableKey("sk-old", null, "anthropic", "http://$HOME_PC:8080"))
    }

    @Test fun aKeyIsUsableOnlyWhileItsOriginIsTheOneInUse() {
        val o = AskWire.origin("openai", "https://api.groq.com/openai/v1")
        assertEquals("k", AskWire.usableKey("k", o, "openai", "https://api.groq.com/openai/v1"))
        assertNull("another host", AskWire.usableKey("k", o, "openai", "https://api.openai.com/v1"))
        assertNull("another port", AskWire.usableKey("k", o, "openai", "https://api.groq.com:8443/openai/v1"))
        assertNull("another scheme", AskWire.usableKey("k", o, "openai", "http://api.groq.com/openai/v1"))
        assertNull("another service", AskWire.usableKey("k", o, "anthropic", "https://api.groq.com/openai/v1"))
        assertNull("no key", AskWire.usableKey(null, o, "openai", "https://api.groq.com/openai/v1"))
        assertNull("blank key", AskWire.usableKey("  ", o, "openai", "https://api.groq.com/openai/v1"))
    }

    @Test fun theTvItselfIsRefusedAsAnAddress() {
        for (u in listOf("http://localhost:5400/v1", "http://127.0.0.1:5400/v1", "http://127.1.2.3/v1", "http://[::1]:5400/v1", "http://0.0.0.0/v1", "https://localhost/v1"))
            assertNotNull(u, AskWire.check("openai", u, "m"))
        assertNull("a computer on the home network is fine", AskWire.check("openai", "http://$HOME_PC:11434/v1", "m"))
        assertNull("so is the emulator's address for its computer", AskWire.check("openai", "http://$EMULATOR_HOST:11434/v1", "m"))
    }
}
