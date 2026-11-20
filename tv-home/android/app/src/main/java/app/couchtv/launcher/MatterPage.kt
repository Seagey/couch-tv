package app.couchtv.launcher

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import dev.couchtv.ontv.matter.Matter
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * window.TVMATTER on the page: Matter on a Google TV or Android TV with the launcher and no computer
 * at home. The controller is the on-TV app's own (on-tv/android/app/src/main/java/dev/couchtv/ontv/matter,
 * built into this app too), so the calls are the same as the on-TV app's /api/matter (matter-contract.md):
 *
 *   TVMATTER.request(id, method, path, bodyJson)  ->  later CouchMatter.reply(id, jsonString)
 *
 * The page never waits on the network. Only the launcher's own pages may ask (the bridge it found,
 * or its saved copy), as with window.TVHA.
 */
class MatterPage(ctx: Context, private val web: WebView) {
    private val app = ctx.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool()   // a commissioning can take a minute; other asks go on meanwhile
    private val ids = Regex("[A-Za-z0-9_-]{1,32}")

    @JavascriptInterface
    fun request(id: String, method: String, path: String, body: String?) {
        if (!ids.matches(id)) return
        main.post {
            if (!trusted(web.url)) { reply(id, JSONObject().put("ok", false).put("error", "refused")); return@post }
            io.execute {
                val out = try { answer(method.uppercase(), path, runCatching { JSONObject(body ?: "{}") }.getOrDefault(JSONObject())) }
                    catch (e: Matter.Refused) { JSONObject().put("ok", false).put("error", e.message ?: "error").put("status", e.status).put("reason", e.reason) }
                    catch (e: Exception) { android.util.Log.w("couchtv.matter", "$method $path", e); JSONObject().put("ok", false).put("error", "Matter could not do that just now.").put("status", 500).put("reason", "failed") }
                main.post { reply(id, out) }
            }
        }
    }

    /** The same routes as the on-TV app's Server.kt (minus the event stream: the page asks again). */
    private fun answer(method: String, path: String, b: JSONObject): JSONObject = when ("$method ${path.removeSuffix("/")}") {
        "GET /api/matter/devices" -> Matter.devicesJson()
        "POST /api/matter/commission" -> Matter.commission(b.optString("code"), b.optString("address").ifEmpty { null })
        "POST /api/matter/command" -> Matter.command(b.optString("id"), b.optString("action"), b.opt("value"))
        "POST /api/matter/rename" -> Matter.rename(b.optString("id"), b.optString("name"))
        "POST /api/matter/remove" -> Matter.remove(b.optString("id"))
        else -> JSONObject().put("ok", false).put("error", "no such Matter call").put("status", 404)
    }

    private fun trusted(url: String?): Boolean {
        if (url == null) return false
        if (url.startsWith("http://$OFFLINE_HOST/")) return true
        val bridge = app.getSharedPreferences("home", Context.MODE_PRIVATE).getString("bridge", null) ?: return false
        return url.startsWith("$bridge/")
    }

    private fun reply(id: String, out: JSONObject) {
        // JSON.stringify'd twice: the page gets a string, as matter-ui reads it (CouchMatter.reply(id, jsonString))
        val s = JSONObject.quote(out.toString())
        try { web.evaluateJavascript("window.CouchMatter && CouchMatter.reply(\"$id\", $s)", null) } catch (e: Exception) {}
    }

    companion object { private const val OFFLINE_HOST = "home.tvos.invalid" }
}
