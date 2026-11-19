package dev.couchtv.ontv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * "Update couch-tv" for the on-TV app (Home settings, About, and Updates), the page side shared with the
 * launcher's Updater.kt (window.TVUP). It looks and tells; it never installs: the rules and the steps
 * are in UpdateRules.kt. One request to GitHub's API, no account, no key, nothing about the TV sent.
 * Once a week while the home is on screen, only after the household said yes to "Tell me about new
 * versions" (asked once on the home); "Check for updates now" looks straight away either way.
 */
object Update {
    private const val STORE = "update"
    private const val WEEK_MS = 7 * 24 * 60 * 60 * 1000L
    private const val RETRY_MS = 60 * 60 * 1000L

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var busy = ""
    @Volatile private var error = ""
    @Volatile var listener: ((String) -> Unit)? = null

    private fun watch() = BuildConfig.BUILD_TYPE == "watch"
    private fun store(c: Context) = c.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    fun state(c: Context): String {
        val s = store(c)
        val latest = s.getString("latest", "") ?: ""
        val w = watch()
        return JSONObject()
            .put("supported", true)
            .put("current", BuildConfig.VERSION_NAME)
            .put("channel", "stable")
            .put("latest", latest)
            .put("title", s.getString("title", "") ?: "")
            .put("available", UpdateRules.offered(latest, BuildConfig.VERSION_NAME, s.getBoolean("has_asset", false)))
            .put("refused", false)
            .put("checked", s.getLong("checked", 0L))
            .put("auto", s.getBoolean("auto", false))
            .put("answered", s.contains("auto"))
            .put("busy", busy)
            .put("progress", 0)
            .put("error", error)
            // it cannot install: the page shows these steps instead of "Update to ..."
            .put("manual", true)
            .put("code", if (w) "" else UpdateRules.CODE)
            .put("how", UpdateRules.how(w))
            .put("steps", JSONArray(UpdateRules.steps(w)))
            .toString()
    }

    private fun changed(c: Context) {
        val json = state(c)
        main.post { listener?.invoke(json) }
    }

    fun setAuto(c: Context, on: Boolean) {
        store(c).edit().putBoolean("auto", on).apply()
        changed(c)
        if (on) checkIfDue(c.applicationContext)
    }

    /** From HomeActivity.onResume: the weekly look, only when it is switched on and due. */
    fun resumed(c: Context) = checkIfDue(c.applicationContext)

    private fun checkIfDue(c: Context) {
        val s = store(c)
        val now = System.currentTimeMillis()
        if (!s.getBoolean("auto", false) || busy.isNotEmpty()) return
        if (now - s.getLong("checked", 0L) < WEEK_MS || now - s.getLong("tried", 0L) < RETRY_MS) return
        check(c, false)
    }

    fun check(c: Context, manual: Boolean) {
        val app = c.applicationContext
        if (busy.isNotEmpty()) return
        busy = "checking"
        if (manual) error = ""
        changed(app)
        io.execute {
            val s = store(app)
            s.edit().putLong("tried", System.currentTimeMillis()).apply()
            try {
                val f = UpdateRules.read(fetch("https://api.github.com/repos/${UpdateRules.REPO}/releases/latest"), watch())
                val e = s.edit().putLong("checked", System.currentTimeMillis())
                if (f != null) e.putString("latest", f.version).putString("title", f.title).putBoolean("has_asset", f.hasAsset)
                e.apply()
                error = ""
            } catch (x: Exception) {
                if (manual) error = "net"
            }
            busy = ""
            changed(app)
        }
    }

    private fun fetch(url: String): String {
        val con = URL(url).openConnection() as HttpURLConnection
        con.connectTimeout = 10_000; con.readTimeout = 15_000
        con.instanceFollowRedirects = true
        con.setRequestProperty("Accept", "application/vnd.github+json")
        con.setRequestProperty("User-Agent", "couch-tv-ontv")
        try {
            if (con.responseCode != 200) throw java.io.IOException("HTTP ${con.responseCode}")
            return con.inputStream.bufferedReader().use { it.readText().take(2_000_000) }
        } finally { con.disconnect() }
    }

    /** window.TVUP for the home page. Only the app's own page (base/tv/) may start a check. */
    class Page(c: Context, private val web: WebView, private val base: String) {
        private val app = c.applicationContext
        init { listener = { json -> runCatching { web.evaluateJavascript("window.tv && tv.update && tv.update($json)", null) } } }
        @JavascriptInterface fun state(): String = Update.state(app)
        @JavascriptInterface fun check() { main.post { if (trusted()) Update.check(app, true) } }
        /** Nothing to install here: the page shows the steps (UpdateRules.steps). */
        @JavascriptInterface fun install() {}
        @JavascriptInterface fun auto(on: Boolean) { main.post { if (trusted()) setAuto(app, on) } }
        private fun trusted(): Boolean = web.url?.startsWith("$base/tv/") == true
    }
}
