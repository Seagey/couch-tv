package dev.couchtv.ontv

import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * The Shows page of the Glass look: what each app has published to Android TV, grouped by app.
 * Two sources, both read only with READ_TV_LISTINGS (granted over ADB in Adb.onConnected):
 * Watch Next (the apps' own "continue watching") and preview programs (the rows apps put on the
 * Google TV home). An app that publishes nothing simply has no row. Opening a show starts the
 * intent the app itself stored, and only one this object handed out (by id), never one a caller
 * makes up.
 */
object Rows {
    private val PREVIEW = Uri.parse("content://android.media.tv/preview_program")
    private val WATCH_NEXT = Uri.parse("content://android.media.tv/watch_next_program")
    private val COLS = arrayOf("_id", "package_name", "title", "episode_title", "season_display_number",
        "episode_display_number", "poster_art_uri", "thumbnail_uri", "intent_uri", "last_playback_position_millis", "duration_millis")
    private val WN_COLS = COLS + "last_engagement_time_utc_millis"
    private const val PER_APP = 12
    private val intents = ConcurrentHashMap<String, String>()

    private fun art(s: String?) = s?.takeIf { it.startsWith("https://") || it.startsWith("http://") }

    private fun read(uri: Uri, cols: Array<String>, prefix: String, each: (JSONObject, Long) -> Unit) {
        runCatching {
            Store.context().contentResolver.query(uri, cols, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val pkg = c.getString(1) ?: continue
                    val title = c.getString(2)?.takeIf { it.isNotBlank() } ?: continue
                    val id = prefix + c.getLong(0)
                    c.getString(8)?.takeIf { it.isNotBlank() }?.let { intents[id] = pkg + "\n" + it }
                    val pos = c.getLong(9); val dur = c.getLong(10)
                    val o = JSONObject().put("id", id).put("package", pkg).put("title", title)
                        .put("episode_title", c.getString(3)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("season", c.getString(4)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("episode", c.getString(5)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("poster", art(c.getString(6)) ?: JSONObject.NULL)
                        .put("thumb", art(c.getString(7)) ?: JSONObject.NULL)
                        .put("progress", if (pos > 0 && dur > 0) (pos.toDouble() / dur).coerceIn(0.0, 1.0) else JSONObject.NULL)
                        .put("openable", intents.containsKey(id))
                    each(o, if (cols.size > COLS.size) c.getLong(COLS.size) else 0L)
                }
            }
        }.onFailure { android.util.Log.i("couchtv.rows", "${uri.lastPathSegment} unreadable: ${it.message}") }
    }

    /** {continue: [...], apps: [{package, items: [...]}]} */
    fun all(): JSONObject {
        val cont = ArrayList<Pair<JSONObject, Long>>()
        read(WATCH_NEXT, WN_COLS, "w") { o, t -> cont.add(o to t) }
        val byApp = LinkedHashMap<String, JSONArray>()
        read(PREVIEW, COLS, "p") { o, _ ->
            val a = byApp.getOrPut(o.getString("package")) { JSONArray() }
            if (a.length() < PER_APP) a.put(o)
        }
        val c = JSONArray(); cont.sortedByDescending { it.second }.take(PER_APP).forEach { c.put(it.first) }
        val apps = JSONArray(); byApp.forEach { (p, items) -> apps.put(JSONObject().put("package", p).put("items", items)) }
        return JSONObject().put("continue", c).put("apps", apps)
    }

    /** Opens a show by an id from all(). False when the id is unknown or the app is gone. */
    fun open(id: String): Boolean {
        val v = intents[id] ?: return false
        val pkg = v.substringBefore('\n')
        val i = runCatching { Intent.parseUri(v.substringAfter('\n'), Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return false
        // Only ever into the app that published the row.
        if (i.`package` != null && i.`package` != pkg) return false
        if (i.component != null && i.component!!.packageName != pkg) return false
        if (i.`package` == null && i.component == null) i.setPackage(pkg)
        i.selector = null
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { Store.context().startActivity(i); true }.getOrElse {
            android.util.Log.i("couchtv.rows", "open $id: ${it.message}")
            Store.context().packageManager.getLeanbackLaunchIntentForPackage(pkg)?.let { li ->
                runCatching { Store.context().startActivity(li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
            } ?: false
        }
    }
}
