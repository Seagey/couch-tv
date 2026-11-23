package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.URI

/*
 * The "ask" hook can talk to more than one kind of AI service. Everything that is specific to a
 * service lives here, in plain Kotlin with no Android in it, so the rules are unit tested
 * (AskWireTest). Ask.kt only does the HTTP call and runs the TV tools.
 *
 * Two wire formats cover nearly every service:
 *   "anthropic"  Anthropic's Messages API (Claude).
 *   "openai"     the OpenAI chat completions API with function calling. OpenAI itself, and the many
 *                services and local servers that copy it: OpenRouter, Google Gemini's compatible
 *                endpoint, Groq, Mistral, Together, Ollama, LM Studio, llama.cpp, vLLM...
 */

/** A tool the model may call. The same for every service. */
class AskTool(val name: String, val description: String, val properties: JSONObject, val required: List<String>)

/** One tool call the model asked for. [error] is set when the service sent arguments that were not JSON. */
class AskCall(val id: String, val name: String, val args: JSONObject, val error: String? = null)

/** What a tool call gave back, to hand to the model. */
class AskResult(val id: String, val content: String, val isError: Boolean)

/** What one model turn said. [done] is true when it asked for no more tools. */
class AskTurn(val text: String, val calls: List<AskCall>, val done: Boolean)

/** Which service to talk to. Built from the settings by [AskConfig.of], which fills in the defaults. */
class AskConfig(val provider: String, val base: String, val model: String, val key: String?) {
    val isAnthropic get() = provider == AskWire.ANTHROPIC

    /** Ready to use: a key, or no key because it is a server on the home network (Ollama and the like). */
    val ready get() = model.isNotEmpty() && (!key.isNullOrEmpty() || (!isAnthropic && AskWire.isLocalUrl(base)))

    companion object {
        fun of(provider: String?, base: String?, model: String?, key: String?): AskConfig {
            val p = if (provider == AskWire.OPENAI) AskWire.OPENAI else AskWire.ANTHROPIC
            val b = base?.trim()?.trimEnd('/').orEmpty().ifEmpty { if (p == AskWire.OPENAI) AskWire.OPENAI_BASE else AskWire.ANTHROPIC_BASE }
            val m = model?.trim().orEmpty().ifEmpty { if (p == AskWire.ANTHROPIC) AskWire.ANTHROPIC_MODEL else "" }
            return AskConfig(p, b, m, key?.trim()?.ifEmpty { null })
        }
    }
}

object AskWire {
    const val ANTHROPIC = "anthropic"
    const val OPENAI = "openai"
    const val ANTHROPIC_BASE = "https://api.anthropic.com"
    const val ANTHROPIC_MODEL = "claude-haiku-5-5"
    const val OPENAI_BASE = "https://api.openai.com/v1"
    private val MODEL_NAME = Regex("[A-Za-z0-9._:/@+-]{1,100}")

    fun host(url: String): String? = try { URI(url.trim()).host?.lowercase() } catch (e: Exception) { null }

    /** A server on the home network or this very device: no key needed, and plain http is fine. */
    fun isLocalHost(host: String?): Boolean {
        val h = host?.lowercase()?.trim('[', ']') ?: return false
        if (h == "localhost" || h == "::1" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true
        val p = h.split('.').mapNotNull { it.toIntOrNull() }
        if (p.size != 4 || h.split('.').size != 4 || p.any { it !in 0..255 }) return false
        return p[0] == 10 || p[0] == 127 || (p[0] == 192 && p[1] == 168) || (p[0] == 172 && p[1] in 16..31) || (p[0] == 169 && p[1] == 254)
    }

    fun isLocalUrl(url: String) = isLocalHost(host(url))

    /** The TV itself. Its own services are not an AI service, so an address that points there is refused. */
    fun isThisDevice(host: String?): Boolean {
        val h = host?.lowercase()?.trim('[', ']') ?: return false
        return h == "localhost" || h == "::1" || h == "0.0.0.0" || h == "::" || h.startsWith("127.")
    }

    /**
     * True if any of the addresses a host name resolved to is the TV itself: loopback, "any", or one of the
     * TV's own interface addresses. This is the real check, made when the TV is about to connect. [isThisDevice]
     * only catches the obvious spellings when settings are saved, and misses numeric forms such as
     * `https://2130706433/` and names that resolve to 127.0.0.1.
     */
    fun pointsAtThisDevice(resolved: Collection<InetAddress>, own: Collection<InetAddress>) =
        resolved.any { it.isLoopbackAddress || it.isAnyLocalAddress || it in own }

    /**
     * The saved key, if it may be used with the address now in use. A key saved before origins were
     * recorded ([keyOrigin] is null) was a Claude key, so it only works for Claude's own address.
     */
    fun usableKey(key: String?, keyOrigin: String?, provider: String, base: String): String? =
        key?.trim()?.ifEmpty { null }?.takeIf { (keyOrigin ?: origin(ANTHROPIC, ANTHROPIC_BASE)) == origin(provider, base) }

    /**
     * What a key is tied to: the service, the scheme, the host and the port, exactly. A key is handed out
     * only while the address in use has this same origin, so it can never go anywhere else, even for a
     * moment while settings are being changed.
     */
    fun origin(provider: String, base: String): String {
        val u = try { URI(base.trim()) } catch (e: Exception) { return "$provider|?" }
        val scheme = u.scheme?.lowercase() ?: "?"
        val port = if (u.port != -1) u.port else if (scheme == "https") 443 else 80
        return "$provider|$scheme://${u.host?.lowercase() ?: "?"}:$port"
    }

    /** The settings are saved only if this says null. Otherwise it is the sentence to show the person. */
    fun check(provider: String, base: String, model: String): String? {
        if (provider != ANTHROPIC && provider != OPENAI) return "Unknown AI service \"$provider\". Use anthropic or openai."
        val b = base.trim()
        if (b.isNotEmpty()) {
            if (b.length > 200) return "That web address is too long."
            val u = try { URI(b) } catch (e: Exception) { return "That is not a web address." }
            if (u.scheme != "https" && u.scheme != "http") return "The web address must start with https:// (or http:// for a server at home)."
            if (u.host.isNullOrEmpty()) return "That web address has no host name."
            if (u.userInfo != null) return "Leave a name and password out of the web address. The key goes in its own box."
            // the request goes to this address plus /chat/completions or /v1/messages: a ? or # would hide that ending
            if (u.rawQuery != null || u.rawFragment != null || b.contains('?') || b.contains('#')) return "Leave ? and # out of the web address: it ends at the path, like https://api.openai.com/v1."
            if (isThisDevice(u.host)) return "That address is the TV itself. Use the address of your computer or of the AI service."
            if (u.scheme == "http" && !isLocalHost(u.host)) return "A key must not travel over plain http. Use https://, or a server on your own network."
        }
        val m = model.trim()
        if (m.isEmpty() && provider == OPENAI) return "Type the model name your AI service gives you."
        if (m.isNotEmpty() && !MODEL_NAME.matches(m)) return "That model name has characters a model name does not use."
        return null
    }

    /** Where the question goes. */
    fun endpoint(cfg: AskConfig) = if (cfg.isAnthropic) cfg.base + "/v1/messages" else cfg.base + "/chat/completions"

    fun chat(cfg: AskConfig, system: String, tools: List<AskTool>): AskChat =
        if (cfg.isAnthropic) AnthropicChat(cfg, system, tools) else OpenAiChat(cfg, system, tools)

    /**
     * What came back when the service said no, as one short sentence. Only the service's own error message
     * is shown, never the rest of what it sent: the address can be one the household typed, so an answer
     * from some other kind of server must not be read back to whoever asked.
     */
    fun errorMessage(cfg: AskConfig, code: Int, text: String): String {
        val detail = runCatching {
            val e = JSONObject(text).get("error")
            (if (e is JSONObject) e.getString("message") else e.toString()).take(200)
        }.getOrNull() ?: "no details"
        return (if (cfg.isAnthropic) "Claude API error $code: " else "AI service error $code (${host(cfg.base) ?: "?"}): ") + detail
    }

    /**
     * Ask the model, run the tools it wants, give it the results, up to [maxRounds] times.
     * [transport] does the HTTP call and returns the parsed reply (or throws). [runTool] runs one TV tool.
     */
    fun run(chat: AskChat, text: String, transport: (String, Map<String, String>, JSONObject) -> JSONObject,
            runTool: (String, JSONObject) -> String, maxRounds: Int = 5): AskOutcome {
        val actions = JSONArray()
        val failures = ArrayList<String>()
        chat.addUser(text)
        for (round in 0 until maxRounds) {
            val reply = transport(chat.url, chat.headers(), chat.body())
            // A reply in the wrong shape makes the JSON reader throw, and its message can quote what it found.
            // Nothing from it goes back to the caller: only that the format was not understood.
            val turn = try { chat.accept(reply) } catch (e: Exception) {
                throw ApiError(502, "The AI service at ${host(chat.cfg.base) ?: "that address"} answered in a format this TV does not understand.")
            }
            if (turn.done) return AskOutcome(turn.text.ifEmpty { ending(actions, failures, false) }, actions)
            val results = turn.calls.map { c ->
                val (ok, out) = if (c.error != null) false to c.error
                else try { true to runTool(c.name, c.args) } catch (e: Exception) { false to (e.message ?: "failed") }
                if (!ok) failures.add("${c.name}: ${out.take(160)}")
                actions.put(JSONObject().put("tool", c.name).put("args", c.args).put("ok", ok))
                AskResult(c.id, out, !ok)
            }
            chat.addResults(results)
        }
        return AskOutcome(ending(actions, failures, true), actions)
    }

    /**
     * What to say when the model gives no words of its own (it stopped, or it ran out of rounds). "Done." is
     * only true when something was done: if every try failed, say so and give the last reason.
     */
    private fun ending(actions: JSONArray, failures: List<String>, ranOut: Boolean): String = when {
        failures.isNotEmpty() -> (if (ranOut) "I could not finish that." else "That did not work.") + " Last problem: " + failures.last()
        actions.length() == 0 -> "I did not catch that. Could you say it another way?"
        else -> "Done."
    }
}

class AskOutcome(val reply: String, val actions: JSONArray)

/** One conversation with one service. It keeps the history in that service's own shape. */
abstract class AskChat(val cfg: AskConfig, val system: String, val tools: List<AskTool>) {
    val url: String get() = AskWire.endpoint(cfg)
    abstract fun headers(): Map<String, String>
    abstract fun addUser(text: String)
    abstract fun body(): JSONObject
    /** Reads the service's reply, remembers it as the assistant's turn, and says what it wanted. */
    abstract fun accept(res: JSONObject): AskTurn
    abstract fun addResults(results: List<AskResult>)
}

/** Anthropic Messages API. Unchanged from when this was the only service. */
class AnthropicChat(cfg: AskConfig, system: String, tools: List<AskTool>) : AskChat(cfg, system, tools) {
    private val messages = JSONArray()

    override fun headers() = mapOf("content-type" to "application/json", "x-api-key" to (cfg.key ?: ""), "anthropic-version" to "2023-06-01")

    override fun addUser(text: String) { messages.put(JSONObject().put("role", "user").put("content", text)) }

    override fun body(): JSONObject {
        val t = JSONArray()
        for (x in tools) t.put(JSONObject().put("name", x.name).put("description", x.description)
            .put("input_schema", JSONObject().put("type", "object").put("properties", x.properties).put("required", JSONArray(x.required))))
        val b = JSONObject().put("model", cfg.model).put("max_tokens", 1024).put("system", system)
            .put("tools", t).put("tool_choice", JSONObject().put("type", "auto"))
        // "effort" is a Haiku 5.5 setting. Another Claude model may not know it, so it is only sent for that one.
        if (cfg.model == AskWire.ANTHROPIC_MODEL) b.put("output_config", JSONObject().put("effort", "low"))
        return b.put("messages", messages)
    }

    override fun accept(res: JSONObject): AskTurn {
        val content = res.getJSONArray("content")
        messages.put(JSONObject().put("role", "assistant").put("content", content))
        val blocks = (0 until content.length()).map { content.getJSONObject(it) }
        val text = blocks.filter { it.optString("type") == "text" }.joinToString(" ") { it.optString("text") }.trim()
        val calls = blocks.filter { it.optString("type") == "tool_use" }.map { AskCall(it.getString("id"), it.getString("name"), it.optJSONObject("input") ?: JSONObject()) }
        return AskTurn(text, calls, res.optString("stop_reason") != "tool_use" || calls.isEmpty())
    }

    override fun addResults(results: List<AskResult>) {
        val blocks = JSONArray()
        for (r in results) blocks.put(JSONObject().put("type", "tool_result").put("tool_use_id", r.id).put("content", r.content).put("is_error", r.isError))
        messages.put(JSONObject().put("role", "user").put("content", blocks))
    }
}

/** OpenAI chat completions with function calling, and everything that copies it. */
class OpenAiChat(cfg: AskConfig, system: String, tools: List<AskTool>) : AskChat(cfg, system, tools) {
    private val messages = JSONArray().put(JSONObject().put("role", "system").put("content", system))

    override fun headers(): Map<String, String> {
        val h = linkedMapOf("content-type" to "application/json")
        if (!cfg.key.isNullOrEmpty()) h["authorization"] = "Bearer ${cfg.key}"
        return h
    }

    override fun addUser(text: String) { messages.put(JSONObject().put("role", "user").put("content", text)) }

    override fun body(): JSONObject {
        val t = JSONArray()
        for (x in tools) t.put(JSONObject().put("type", "function").put("function", JSONObject().put("name", x.name).put("description", x.description)
            .put("parameters", JSONObject().put("type", "object").put("properties", x.properties).put("required", JSONArray(x.required)))))
        // OpenAI's newer models refuse "max_tokens" and want "max_completion_tokens"; most other services only know "max_tokens".
        val limit = if (AskWire.host(cfg.base) == "api.openai.com") "max_completion_tokens" else "max_tokens"
        return JSONObject().put("model", cfg.model).put(limit, 1024).put("tools", t).put("tool_choice", "auto").put("messages", messages)
    }

    override fun accept(res: JSONObject): AskTurn {
        val msg = res.getJSONArray("choices").getJSONObject(0).getJSONObject("message")
        val text = textOf(msg.opt("content"))
        val raw = msg.optJSONArray("tool_calls")
        val calls = ArrayList<AskCall>()
        val echo = JSONArray()
        if (raw != null) for (i in 0 until raw.length()) {
            val c = raw.getJSONObject(i)
            val fn = c.optJSONObject("function") ?: continue
            // some services send no id, or send arguments as an object instead of a string
            val id = c.optString("id").ifEmpty { "call_${messages.length()}_$i" }
            val a = fn.opt("arguments")
            val argText = when (a) { is String -> a.trim().ifEmpty { "{}" }; is JSONObject -> a.toString(); else -> "{}" }
            val parsed = try { JSONObject(argText) } catch (e: Exception) { null }
            calls.add(AskCall(id, fn.optString("name"), parsed ?: JSONObject(), if (parsed == null) "The arguments were not valid JSON." else null))
            echo.put(JSONObject().put("id", id).put("type", "function").put("function", JSONObject().put("name", fn.optString("name")).put("arguments", argText)))
        }
        // only the standard fields go back: extras such as "refusal" or "reasoning_content" can make a strict service say no
        val m = JSONObject().put("role", "assistant").put("content", if (text.isEmpty() && echo.length() > 0) JSONObject.NULL else text)
        if (echo.length() > 0) m.put("tool_calls", echo)
        messages.put(m)
        return AskTurn(text, calls, calls.isEmpty())
    }

    override fun addResults(results: List<AskResult>) {
        for (r in results) messages.put(JSONObject().put("role", "tool").put("tool_call_id", r.id).put("content", if (r.isError) "Error: ${r.content}" else r.content))
    }

    private fun textOf(c: Any?): String = when (c) {
        is String -> c.trim()
        is JSONArray -> (0 until c.length()).mapNotNull { c.optJSONObject(it)?.takeIf { p -> p.optString("type") == "text" }?.optString("text") }.joinToString(" ").trim()
        else -> ""
    }
}
