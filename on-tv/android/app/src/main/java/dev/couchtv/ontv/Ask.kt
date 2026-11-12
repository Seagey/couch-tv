package dev.couchtv.ontv

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URL
import java.net.UnknownHostException

/**
 * OPTIONAL "ask" hook. OFF by default. There is no AI in on-TV mode unless the household adds its
 * own API key (or the address of a model running at home) on the setup page and switches "ask" on.
 *
 * It can use Claude (Anthropic), OpenAI, or any service that copies OpenAI's chat completions API
 * (OpenRouter, Google Gemini, Groq, Mistral, Ollama, LM Studio...). Which one is a setting, and all
 * that differs between them is in AskWire.kt. Claude Haiku 5.5 is still the default.
 *
 * Cost: each ask is a few model calls, and a typical "put on X" is around 12,000 input and 1,200
 * output tokens. On Claude Haiku 5.5 (about US$0.10 per million input tokens and US$0.50 per
 * million output, Oct 2026) that is roughly a fifth of a US cent. Other services price differently.
 * Set a monthly spend limit on the key with the service, and use a key made only for this TV:
 * anyone with ADB access to the TV could read it from the app's storage.
 *
 * Raw HTTPS, to keep the TV app small. Nothing here runs unless a key is set (or a server at home
 * that needs none).
 */
object Ask {
    /** The service chosen on the setup page, with the defaults filled in. */
    fun config(): AskConfig {
        val c = AskConfig.of(Store.str("ask_provider"), Store.str("ask_base"), Store.str("ask_model"), null)
        // The key is tied to the exact origin it was saved for (service, scheme, host, port) and is only handed out
        // while that is still the address in use. A key saved before this existed was a Claude key.
        return AskConfig(c.provider, c.base, c.model, AskWire.usableKey(Store.str("ask_key"), Store.str("ask_key_origin"), c.provider, c.base))
    }

    val enabled get() = Store.bool("ask_enabled") && config().ready

    /** For the setup page. The key itself never leaves the TV: only whether there is one. */
    fun status(): JSONObject {
        val c = config()
        return JSONObject().put("enabled", Store.bool("ask_enabled")).put("has_key", !c.key.isNullOrEmpty()).put("model", c.model)
            .put("provider", c.provider).put("base", c.base).put("keyless_ok", !c.isAnthropic && AskWire.isLocalUrl(c.base)).put("ready", c.ready)
    }

    /**
     * The setup page's Ask settings. Throws an ApiError(400) with a sentence for the person if a value is
     * wrong, and saves nothing then. A key is saved together with the origin it belongs to (see [config]),
     * so it is only ever used with that origin. When the origin changes and no new key comes with it, the
     * old key is also deleted; that is only tidiness, since it could no longer be used anyway.
     */
    fun save(b: JSONObject) {
        if (b.has("ask_provider") || b.has("ask_base") || b.has("ask_model")) {
            val old = config()
            val p = if (b.has("ask_provider")) b.optString("ask_provider").trim().ifEmpty { AskWire.ANTHROPIC } else old.provider
            val moved = p != old.provider
            val base = if (b.has("ask_base")) b.optString("ask_base").trim() else if (moved) "" else Store.str("ask_base").orEmpty()
            val model = if (b.has("ask_model")) b.optString("ask_model").trim() else if (moved) "" else Store.str("ask_model").orEmpty()
            AskWire.check(p, base, model)?.let { throw ApiError(400, it) }
            Store.putStr("ask_provider", p.takeIf { it != AskWire.ANTHROPIC })
            Store.putStr("ask_base", base.trimEnd('/').ifEmpty { null })
            Store.putStr("ask_model", model.ifEmpty { null })
            if (!b.has("ask_key") && AskWire.origin(p, base.ifEmpty { if (p == AskWire.OPENAI) AskWire.OPENAI_BASE else AskWire.ANTHROPIC_BASE }) != AskWire.origin(old.provider, old.base)) {
                Store.putStr("ask_key", null); Store.putStr("ask_key_origin", null)
            }
        }
        if (b.has("ask_key")) {
            val typed = b.optString("ask_key").trim().ifEmpty { null }
            // the key goes in tied to the address that is saved right now, which is the new one if it came in the same request
            Store.putStr("ask_key_origin", typed?.let { config().let { c -> AskWire.origin(c.provider, c.base) } })
            Store.putStr("ask_key", typed)
        }
        if (b.has("ask_enabled")) Store.putBool("ask_enabled", b.optBoolean("ask_enabled"))
    }

    private val TOOLS = listOf(
        AskTool("play", "Find a show or film and start it in the right streaming app on the TV.",
            JSONObject().put("title", str("Show or film name")).put("season", int()).put("episode", int()).put("service", str("Optional app id, for example netflix")), listOf("title")),
        AskTool("launch", "Open an app on the TV by id (netflix, youtube, stan, abc-iview, disney-plus, prime-video, ...).",
            JSONObject().put("app", str("App id or Android package")), listOf("app")),
        AskTool("key", "Press a remote key: up, down, left, right, ok, back, home, play_pause, volume_up, volume_down, mute.",
            JSONObject().put("key", str("Key name")), listOf("key")),
        AskTool("now", "What is on the TV right now.", JSONObject(), emptyList()))

    fun ask(text: String, who: String?): JSONObject {
        val cfg = config()
        if (!cfg.ready) throw ApiError(501, "Ask is off in on-TV mode.")
        val started = System.currentTimeMillis()
        val system = "You control a TV through tools. Do what the person asks with the fewest tool calls, then reply in one or two short plain sentences. " +
            "Apps on this TV: ${installedApps()}. Only open apps from this list. " +
            "If the person asks for a suggestion or recommendation, do not use tools: reply with two or three specific titles, each with one app from the list above that could play it. Never name an app that is not in the list. " +
            "If something fails, try at most one other way, then say plainly what did not work. " +
            "Country: ${Store.country()}." + (who?.let { " Watching: $it." } ?: "")
        val out = AskWire.run(AskWire.chat(cfg, system, TOOLS), text, { url, headers, body -> call(cfg, url, headers, body) }, { name, a -> runTool(name, a, who) })
        return JSONObject().put("ok", true).put("reply", out.reply).put("actions", out.actions)
            .put("seconds", (System.currentTimeMillis() - started) / 1000.0)
    }

    /**
     * The apps this TV really has, so the model does not guess at ones it lacks (it used to try Netflix, Stan and
     * ABC iview on a TV that has none of them). A known app is listed by its id, any other by its package name;
     * the launch tool takes either.
     */
    private fun installedApps(): String = try {
        val pm = Store.context().packageManager
        Tv.tvLaunchables().map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
            .filter { it.first != BuildConfig.APPLICATION_ID }.take(30)
            .joinToString(", ") { (pkg, label) -> "$label (${Apps.BY_PACKAGE[pkg]?.id ?: pkg})" }
            .ifEmpty { "unknown" }
    } catch (e: Exception) { "unknown" }

    private fun runTool(name: String, a: JSONObject, who: String?): String = when (name) {
        "play" -> Finder.play(a.getString("title"), a.optInt("season").takeIf { it > 0 }, a.optInt("episode").takeIf { it > 0 }, a.optString("service").ifEmpty { null }, who).toString()
        "launch" -> { val app = Apps.BY_ID[a.getString("app")]; Tv.launchPackage(app?.pkg ?: a.getString("app")); "opened" }
        "key" -> Tv.key(a.getString("key"))
        "now" -> Now.payload().toString()
        else -> throw IllegalArgumentException("unknown tool $name")
    }

    private fun call(cfg: AskConfig, url: String, headers: Map<String, String>, body: JSONObject): JSONObject {
        val u = URL(url)
        // Resolve the name now and refuse the TV itself, whatever it was spelled as (a number, a name that points at
        // 127.0.0.1...). For https a name that changes its mind afterwards cannot reach the TV's own plain http services,
        // because the certificate would not match; for http only home network names are allowed in the first place.
        val own = try { NetworkInterface.getNetworkInterfaces()?.toList()?.flatMap { it.inetAddresses.toList() } ?: emptyList() } catch (e: Exception) { emptyList() }
        val resolved = try { InetAddress.getAllByName(u.host).toList() } catch (e: UnknownHostException) { throw ApiError(502, "Could not find ${u.host}.") }
        if (AskWire.pointsAtThisDevice(resolved, own)) throw ApiError(502, "${u.host} is the TV itself, so it is not used as an AI service.")
        val c = u.openConnection() as HttpURLConnection
        // a model running on a computer at home can take a while to answer
        c.connectTimeout = 10_000; c.readTimeout = if (AskWire.isLocalUrl(cfg.base)) 180_000 else 60_000
        c.requestMethod = "POST"; c.doOutput = true
        c.instanceFollowRedirects = false   // the key must only ever go to the address that was saved with it
        for ((k, v) in headers) c.setRequestProperty(k, v)
        val code: Int
        val text: String
        try {
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            code = c.responseCode
            text = (if (code in 200..299) c.inputStream else (c.errorStream ?: "".byteInputStream())).bufferedReader().readText()
        } catch (e: IOException) {
            throw ApiError(502, "Could not reach ${AskWire.host(cfg.base) ?: "the AI service"}: ${e.message ?: e.javaClass.simpleName}")
        } finally { c.disconnect() }
        if (code !in 200..299) throw ApiError(502, AskWire.errorMessage(cfg, code, text))
        return try { JSONObject(text) } catch (e: Exception) { throw ApiError(502, "The AI service at ${AskWire.host(cfg.base) ?: "that address"} did not answer in the format expected (not JSON, ${text.length} bytes).") }
    }

    private fun str(d: String) = JSONObject().put("type", "string").put("description", d)
    private fun int() = JSONObject().put("type", "integer")
}
