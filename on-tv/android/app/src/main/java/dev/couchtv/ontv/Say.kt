package dev.couchtv.ontv

import org.json.JSONObject

/**
 * What the TV home shows from Ask AI and from the person's own AI agent (docs/AI-AGENT.md), the same
 * as the bridge's bridge/say.py:
 *  GET  /api/say                the last question and answer, the last message and the last design code
 *  POST /api/say/message        {"text", "from"?, "seconds"?} a short plain message for the TV home
 *  POST /api/say/design         {"code"} a couch-tv Studio design code; the TV home fetches the design
 *                               itself and asks "Use this design?" first, as when the code is typed
 *  POST /api/say/scene          {"pick": "next" | "prev"} the phone remote's Scene buttons (g34): the home
 *                               shows the next or the previous scene (or photo)
 * Kept in memory only. Plain Kotlin with no Android in it, so SayTest.kt checks it on the computer.
 */
object Say {
    const val MAX_TEXT = 280
    const val MAX_FROM = 24
    private const val SHORT = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
    private var nextId = 1L
    private var message: JSONObject? = null
    private var design: JSONObject? = null
    private var ask: JSONObject? = null
    private var scene: JSONObject? = null

    fun plain(s: String?, limit: Int): String =
        (s ?: "").replace(Regex("[\\x00-\\x08\\x0b-\\x1f\\x7f]"), " ").replace(Regex("[ \\t]+"), " ").trim()
            .replace(Regex("\\n{3,}"), "\n\n").take(limit)

    /** A design code as the TV home reads it (tv-home/web/design-code.js readCode), or "" when it is not one. */
    fun readCode(s: String?): String {
        val t = (s ?: "").trim()
        val long = t.replace(Regex("^CTV1-", RegexOption.IGNORE_CASE), "")
        if (Regex("[A-Za-z0-9_-]{43}").matches(long)) return "CTV1-$long"
        val c = t.uppercase().replace(Regex("[\\s-]"), "")
        if (c.length != 10 || c.any { it !in SHORT }) return ""
        return c.take(5) + "-" + c.drop(5)
    }

    @Synchronized
    fun message(text: String?, from: String?, seconds: Int?, now: Long = System.currentTimeMillis()): JSONObject {
        val t = plain(text, MAX_TEXT)
        if (t.isEmpty()) throw IllegalArgumentException("text is required: the words to show on the TV")
        val f = plain(from, MAX_FROM).ifEmpty { "Your AI" }
        val m = JSONObject().put("id", nextId++).put("text", t).put("from", f)
            .put("seconds", (seconds ?: 30).coerceIn(5, 600)).put("at", now)
        message = m
        return m
    }

    /** from: "phone" when the phone remote's Send a design sent it; anything else is an AI agent. */
    @Synchronized
    fun design(code: String?, now: Long = System.currentTimeMillis(), from: String? = null): JSONObject {
        val c = readCode(code)
        if (c.isEmpty()) throw IllegalArgumentException("code must be a Couch TV Studio design code, like ABCDE-FGHJK or CTV1-...")
        val d = JSONObject().put("id", nextId++).put("code", c).put("at", now).put("from", if (from == "phone") "phone" else "ai")
        design = d
        return d
    }

    /** The phone remote's Scene buttons: only "next" or "prev" ever reaches the TV home. */
    @Synchronized
    fun scene(pick: String?, now: Long = System.currentTimeMillis()): JSONObject {
        if (pick != "next" && pick != "prev") throw IllegalArgumentException("pick must be next or prev")
        val s = JSONObject().put("id", nextId++).put("pick", pick).put("at", now)
        scene = s
        return s
    }

    /** Called after every ask (Server.kt, POST /api/ask), so the answer shows on the TV too. */
    @Synchronized
    fun asked(question: String, reply: String?, by: String, now: Long = System.currentTimeMillis()) {
        ask = JSONObject().put("q", plain(question, 400)).put("a", plain(reply, 1200)).put("at", now).put("pending", false).put("by", by)
    }

    @Synchronized
    fun snapshot(): JSONObject = JSONObject().put("message", message ?: JSONObject.NULL)
        .put("design", design ?: JSONObject.NULL).put("scene", scene ?: JSONObject.NULL).put("ask", ask ?: JSONObject.NULL)

    /** The TV home asks every 6 s while it is open; 30 s of silence means it is not. */
    const val HEARD_MS = 30_000L
    @Volatile private var heardAt = 0L

    /** The TV home itself asked (GET /api/say?home=1): it is open and sees a design sent now. */
    fun heard(now: Long = System.currentTimeMillis()) { heardAt = now }

    /** Whether the TV home asked in the last 30 seconds (POST /api/say/design answers it as "listening"). */
    fun listening(now: Long = System.currentTimeMillis()): Boolean = heardAt > 0 && now - heardAt < HEARD_MS

    @Synchronized
    fun clear() { message = null; design = null; scene = null; ask = null; heardAt = 0L }
}
