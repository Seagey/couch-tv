package app.couchtv.launcher

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import app.couchtv.ha.HaPhone
import app.couchtv.ha.HomeAssistant
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * window.TVHA on the page (smart home, app.couchtv.ha.HomeAssistant). info() says what is set up
 * (names only, no address, no token); request() does one of the allowed things and answers later
 * through smartHome.reply(id, ...), so the page never waits on the network. Only the launcher's own
 * pages may ask: the bridge it found, or its saved copy.
 *
 * Home settings, Smart home: phone() starts the set up from a phone (HaServer.kt, HaPhone.kt) and
 * says the address for the QR code. setupCheck/setupSave stay for a TV that was set up with a typed
 * token before, and for tests; the TV screen itself no longer asks for a token.
 */
class HaPage(ctx: Context, private val web: WebView) {
    private val app = ctx.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val ids = Regex("[a-z0-9]{1,16}")

    @JavascriptInterface
    fun info(): String = try { HomeAssistant.info(app).toString() } catch (e: Exception) { "{}" }

    @JavascriptInterface
    fun request(id: String, action: String, entity: String, value: String) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { reply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            io.execute {
                val out = try { HomeAssistant.answer(HomeAssistant.settings(app), action, entity, value) } catch (e: Exception) { JSONObject().put("ok", false) }
                main.post { reply(id, out) }
            }
        }
    }

    // The address and token checked last are held here in memory only, so the page never hands the token over twice.
    @Volatile private var pending: Pair<String, String>? = null

    @JavascriptInterface
    fun setupStatus(): String = try { HomeAssistant.status(app).toString() } catch (e: Exception) { "{\"set\":false}" }

    /**
     * Set up from a phone: starts the small set up server and says { ok, url, seen, ...status }. The
     * same key comes back while the screen keeps asking, so the QR code stays put. Only the
     * launcher's own pages may start it.
     */
    @JavascriptInterface
    fun phone(id: String) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { setupReply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            io.execute {
                val out = try {
                    // one launcher server: the phone page's (PhoneServer.kt, option A) when it runs, else the small one
                    val port = MainActivity.phonePagePort() ?: HaServer.ensure(app)
                    if (port == null) JSONObject().put("ok", false).put("error", "port")
                    else HaPhone.start(app, HaPhone.lanAddress(app), port)
                } catch (e: Exception) { JSONObject().put("ok", false).put("error", "port") }
                main.post { setupReply(id, out) }
            }
        }
    }

    @JavascriptInterface
    fun setupCheck(id: String, url: String, token: String) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { setupReply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            io.execute {
                // an empty token: check again with the one kept, and only with the address kept with it,
                // so the kept token never goes to a new host
                val (addr, tok) = HomeAssistant.keptFor(url, token, HomeAssistant.settings(app)?.takeIf { it.refresh == null }?.let { it.base to it.token })
                val out = if (tok.isEmpty()) JSONObject().put("ok", false).put("error", "token")
                    else try { HomeAssistant.check(addr, tok) } catch (e: Exception) { JSONObject().put("ok", false).put("error", "unreachable") }
                if (out.optBoolean("ok")) pending = (HomeAssistant.cleanBase(addr) ?: "") to tok.trim()
                main.post { setupReply(id, out) }
            }
        }
    }

    @JavascriptInterface
    fun setupSave(id: String, picks: String) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { setupReply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            io.execute {
                val p = pending
                val ok = try { if (p != null) HomeAssistant.keep(app, JSONObject(picks), p.first, p.second) else HomeAssistant.keepPicks(app, JSONObject(picks)) } catch (e: Exception) { false }
                main.post { setupReply(id, JSONObject().put("ok", ok).apply { if (!ok) put("error", if (p == null && HomeAssistant.settings(app) == null) "check" else "picks") }) }
            }
        }
    }

    @JavascriptInterface
    fun setupForget(id: String) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { setupReply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            pending = null
            io.execute { HomeAssistant.disconnect(app); main.post { setupReply(id, JSONObject().put("ok", true)) } }
        }
    }

    private fun setupReply(id: String, out: JSONObject) {
        try { web.evaluateJavascript("window.smartHome && smartHome.setupReply && smartHome.setupReply(\"$id\", $out)", null) } catch (e: Exception) {}
    }

    private fun trusted(url: String?): Boolean {
        if (url == null) return false
        if (url.startsWith("http://$OFFLINE_HOST/")) return true
        val bridge = app.getSharedPreferences("home", Context.MODE_PRIVATE).getString("bridge", null) ?: return false
        return url.startsWith("$bridge/")
    }

    private fun reply(id: String, out: JSONObject) {
        try { web.evaluateJavascript("window.smartHome && smartHome.reply(\"$id\", $out)", null) } catch (e: Exception) {}
    }

    companion object {
        private const val OFFLINE_HOST = "home.tvos.invalid"   // the launcher's own copy of the page
    }
}
