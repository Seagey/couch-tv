package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
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

    /** What came back when the service said no, as one short sentence. */
    fun errorMessage(cfg: AskConfig, code: Int, text: String): String {
        val detail = runCatching {
            val e = JSONObject(text).get("error")
            if (e is JSONObject) e.getString("message") else e.toString()
        }.getOrNull() ?: text.take(120)
        return (if (cfg.isAnthropic) "Claude API error $code: " else "AI service error $code (${host(cfg.base) ?: "?"}): ") + detail
    }

    /**
     * Ask the model, run the tools it wants, give it the results, up to [maxRounds] times.
     * [transport] does the HTTP call and returns the parsed reply (or throws). [runTool] runs one TV tool.
     */
    fun run(chat: AskChat, text: String, transport: (String, Map<String, String>, JSONObject) -> JSONObject,
            runTool: (String, JSONObject) -> String, maxRounds: Int = 5): AskOutcome {
        val actions = JSONArray()
        chat.addUser(text)
        for (round in 0 until maxRounds) {
            val turn = chat.accept(transport(chat.url, chat.headers(), chat.body()))
            if (turn.done) return AskOutcome(turn.text.ifEmpty { "Done." }, actions)
            val results = turn.calls.map { c ->
                val (ok, out) = if (c.error != null) false to c.error
                else try { true to runTool(c.name, c.args) } catch (e: Exception) { false to (e.message ?: "failed") }
                actions.put(JSONObject().put("tool", c.name).put("args", c.args).put("ok", ok))
                AskResult(c.id, out, !ok)
            }
            chat.addResults(results)
        }
        return AskOutcome("Done.", actions)
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
