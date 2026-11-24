package app.couchtv.launcher

import android.content.Context
import android.content.Intent

/**
 * This TV's link to a Couch TV Studio account, and the design code Couch TV Setup brought with it
 * (setup-app/couchtv_setup/steps.py link_account: `am broadcast -n .../.SetupLink --es account_link <token> --es
 * design_code CTV1-...`, FromComputer.kt; DREAM-SETUP-BUILD.md, "TV side").
 *
 *  - account_link: a token for this TV only (32 to 128 of A-Z a-z 0-9 _ -). It is a password: kept in its
 *    own private preferences file "account", which backup_rules.xml and data_extraction_rules.xml leave out
 *    of every backup and device transfer; never logged, never handed to the page (the page only asks
 *    whether there is one), never in a design, a share or an export.
 *  - design_code: the account's CTV1 send code for this TV (CTV1- plus 43 of the same letters). Held until
 *    the page has fetched it (design-code.js fromSetup, the same path as a typed code), at most a day.
 * Anything of another shape is ignored and leaves what is kept as it was.
 */
object AccountLink {
    private val LINK = Regex("^[A-Za-z0-9_-]{32,128}$")
    private val CODE = Regex("^CTV1-[A-Za-z0-9_-]{43}$")
    const val CODE_KEEP_MS = 24L * 60 * 60 * 1000
    private const val K_LINK = "link"
    private const val K_CODE = "setup_code"
    private const val K_CODE_AT = "setup_code_at"

    /** A key and value store: the preferences file on a TV, a map in the tests. */
    interface Kv {
        fun get(k: String): String?
        fun put(k: String, v: String?)
    }

    fun kv(ctx: Context): Kv {
        val sp = ctx.getSharedPreferences("account", Context.MODE_PRIVATE)
        return object : Kv {
            override fun get(k: String): String? = sp.getString(k, null)
            override fun put(k: String, v: String?) { sp.edit().apply { if (v == null) remove(k) else putString(k, v) }.commit() }
        }
    }

    fun cleanLink(s: String?): String? = s?.takeIf { it.length <= 128 && LINK.matches(it) }
    fun cleanCode(s: String?): String? = s?.takeIf { it.length == 48 && CODE.matches(it) }

    /** Reads the two extras. Answers whether either was taken. */
    fun readExtras(kv: Kv, link: String?, code: String?, now: Long): Boolean {
        var took = false
        cleanLink(link)?.let { kv.put(K_LINK, it); took = true }
        cleanCode(code)?.let { kv.put(K_CODE, it); kv.put(K_CODE_AT, now.toString()); took = true }
        return took
    }

    fun readExtras(ctx: Context, i: Intent?): Boolean {
        if (i == null || !(i.hasExtra("account_link") || i.hasExtra("design_code"))) return false
        val kv = kv(ctx)
        val had = token(kv)
        val took = readExtras(kv, i.getStringExtra("account_link")?.trim(), i.getStringExtra("design_code")?.trim(), System.currentTimeMillis())
        if (had != null && had != token(kv)) letGo(had)
        return took
    }

    fun sha(s: String): String = java.security.MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    /** What the TV shows Setup so it knows this link is kept, without saying the link itself. */
    fun proof(link: String): String = sha(link).take(16)

    /** Tells Studio this TV no longer holds [token] (unlinked here, or another link took its place), so the account
     *  does not go on showing it as linked. Once, in the background; nothing depends on the answer. */
    fun letGo(token: String) {
        Thread {
            runCatching {
                val c = java.net.URL("$STUDIO/v1/setup/leave").openConnection() as java.net.HttpURLConnection
                try {
                    c.instanceFollowRedirects = false
                    c.connectTimeout = 10000
                    c.readTimeout = 15000
                    c.requestMethod = "POST"
                    c.setRequestProperty("Authorization", "Bearer $token")
                    c.responseCode
                } finally { c.disconnect() }
            }
        }.start()
    }

    fun linked(kv: Kv): Boolean = cleanLink(kv.get(K_LINK)) != null

    /** The token itself: only for the account's own calls made from Kotlin, never for the page. */
    internal fun token(kv: Kv): String? = cleanLink(kv.get(K_LINK))

    /** Setup's design code while it waits to be fetched; a day old or of a wrong shape, it is dropped. */
    fun pendingCode(kv: Kv, now: Long): String? {
        val c = cleanCode(kv.get(K_CODE))
        val at = kv.get(K_CODE_AT)?.toLongOrNull()
        if (c != null && at != null && now >= at && now - at < CODE_KEEP_MS) return c
        if (kv.get(K_CODE) != null || kv.get(K_CODE_AT) != null) codeDone(kv)
        return null
    }

    fun codeDone(kv: Kv) { kv.put(K_CODE, null); kv.put(K_CODE_AT, null) }

    /** Home settings, Designs, Unlink this TV: the link and anything waiting with it go. */
    fun unlink(kv: Kv) { kv.put(K_LINK, null); codeDone(kv) }

    // ---- The TV inbox (DREAM-SETUP-BUILD.md, "TV inbox"): sends made for this TV, no code typed ----
    // GET <Studio>/v1/setup/inbox with the link as a Bearer token. Only to Couch TV Studio's own address,
    // https, no redirects followed (the token never goes anywhere else), no cookies, at most 64 KB read.
    // The page gets only what readInbox keeps: one checked CTV1 code and its title, or a state.
    const val STUDIO = "https://couchtv.joshuaseage.com"
    private const val INBOX_MAX = 64 * 1024
    // When the TV asks is the page's (design-code.js, app.js: after 30 minutes away, a press, or once a week; Studio's
    // poll only when longer). Here the numbers are only kept sane: poll 30 s to 20 days (a week when missing),
    // a 429's Retry-After 30 s to a day (15 minutes when missing or a date).
    const val POLL_MIN = 30L
    const val POLL_MAX = 1728000L
    const val POLL_DEFAULT = 604800L
    const val WAIT_MAX = 86400L
    const val WAIT_DEFAULT = 900L
    private val TITLE_DROP = Regex("[\\u0000-\\u001f\\u007f<>]")

    private fun clampSecs(v: Long?, lo: Long, hi: Long, dflt: Long): Long = if (v == null) dflt else v.coerceIn(lo, hi)

    /**
     * What the page may see of an answer: {state: "item", code, title, poll}, {state: "none", poll},
     * {state: "unlinked"}, {state: "wait", wait} or {state: "error"}. Several items: only the newest (the last).
     */
    fun readInbox(status: Int, body: String?, retryAfter: String?): org.json.JSONObject {
        val out = org.json.JSONObject()
        when {
            status == 401 -> return out.put("state", "unlinked")
            status == 429 -> return out.put("state", "wait").put("wait", clampSecs(retryAfter?.trim()?.toLongOrNull(), POLL_MIN, WAIT_MAX, WAIT_DEFAULT))
            status != 200 || body == null || body.length > INBOX_MAX -> return out.put("state", "error")
        }
        val j = try { org.json.JSONObject(body) } catch (e: Exception) { return out.put("state", "error") }
        val poll = clampSecs(j.opt("poll").let { if (it is Number) it.toLong() else null }, POLL_MIN, POLL_MAX, POLL_DEFAULT)
        val items = j.optJSONArray("items") ?: return out.put("state", "error")
        for (i in items.length() - 1 downTo maxOf(0, items.length() - 5)) {
            val it = items.optJSONObject(i) ?: continue
            val code = cleanCode(it.opt("code") as? String) ?: continue
            val title = ((it.opt("title") as? String) ?: "").replace(TITLE_DROP, "").replace(Regex("\\s+"), " ").trim().take(60)
            return out.put("state", "item").put("code", code).put("title", title).put("poll", poll)
        }
        return out.put("state", "none").put("poll", poll)
    }

    /** A 401 is about the link that was asked with: a newer one written meanwhile stays. */
    fun answered(kv: Kv, asked: String, r: org.json.JSONObject) {
        if (r.optString("state") != "unlinked") return
        if (token(kv) == asked) unlink(kv) else r.put("state", "error")
    }

    /** Asks the inbox once. Blocking: off the main thread. A 401 forgets the link here and now. */
    fun inbox(kv: Kv): org.json.JSONObject {
        val token = token(kv) ?: return org.json.JSONObject().put("state", "unlinked")
        val r = try {
            val c = java.net.URL("$STUDIO/v1/setup/inbox").openConnection() as java.net.HttpURLConnection
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = 10000
                c.readTimeout = 15000
                c.useCaches = false
                c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("Accept", "application/json")
                val code = c.responseCode
                val body = if (code == 200) c.inputStream.use { s ->
                    val buf = java.io.ByteArrayOutputStream()
                    val b = ByteArray(8192)
                    while (true) {
                        val n = s.read(b)
                        if (n < 0) break
                        buf.write(b, 0, n)
                        if (buf.size() > INBOX_MAX) break
                    }
                    if (buf.size() > INBOX_MAX) null else buf.toString("UTF-8")
                } else null
                readInbox(code, body, c.getHeaderField("Retry-After"))
            } finally { c.disconnect() }
        } catch (e: Exception) { org.json.JSONObject().put("state", "error") }
        answered(kv, token, r)
        return r
    }
}
