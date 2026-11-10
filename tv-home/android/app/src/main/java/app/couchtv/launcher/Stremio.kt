package app.couchtv.launcher

import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * Stremio's Continue Watching in Keep watching (the TV home app with no computer, option A).
 *
 * Stremio puts nothing in Android's Watch Next list, so Keep watching never showed it. Its own
 * Continue Watching is read from the household's Stremio account instead: the library items
 * Stremio's own row shows (stremio-core's rule: the type is not "other", the item is not removed
 * unless it is only temporary, and it is part way through), newest first, up to [MAX].
 *
 * Optional and off unless apply.sh hands the app an account key ("stremio_b64", from
 * STREMIO_AUTH_KEY in .env, which scripts/stremio-link.py makes with Stremio's own sign-in link).
 * The key is kept in this app's own private store ("stremio"), apart from the page's settings, and
 * is never logged or shown to the page. It is only sent to api.strem.io, to read the libraryItem
 * collection: nothing is ever written to the account. The last list is kept too, so the row shows
 * at once after a restart, and is read again in the background whenever the home comes forward (at
 * most once every [FRESH_MS]). OK on a card opens the item's page in Stremio
 * (stremio:///detail/<type>/<id>/<video>), where the stream is picked, as in Stremio's own row.
 */
object Stremio {
    const val PREFIX = "st:"
    private const val STORE = "stremio"
    private const val API = "https://api.strem.io/api/datastoreGet"
    private const val MAX = 10
    private const val FRESH_MS = 60_000L
    private const val MOST_BYTES = 16 * 1024 * 1024
    private val KEY = Regex("[A-Za-z0-9._=+/-]{16,512}")   // Stremio's keys are base64 with "=" padding
    private val ID = Regex("[A-Za-z0-9:._%-]{1,200}")
    private val TYPE = Regex("[a-z]{1,20}")
    private val IMDB = Regex("tt[0-9]{1,12}")
    private val NUM = Regex("[0-9]{1,4}")
    private val TIME = Regex("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?")
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var lastTry = 0L
    @Volatile private var busy = false

    /** One Continue Watching item, as kept: enough to draw its card and open it again. */
    class Item(val id: String, val type: String, val name: String, val video: String?, val season: String,
               val episode: String, val art: String?, val fallbackArt: String?, val progress: Double, val engaged: Long)

    private fun store(ctx: Context) = ctx.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)

    /** What apply.sh sent: {"authKey": "..."} as base64 JSON, or "none" (switches it off and forgets the list). */
    fun readExtras(ctx: Context, i: Intent) {
        val v = i.getStringExtra("stremio_b64")?.trim() ?: return
        val key = if (v.isEmpty() || v == "none") null else try {
            JSONObject(String(android.util.Base64.decode(v, android.util.Base64.DEFAULT), Charsets.UTF_8))
                .optString("authKey").takeIf { KEY.matches(it) }
        } catch (x: Exception) { null }
        val s = store(ctx)
        val e = s.edit()
        if (key == null) e.clear()
        else {
            if (key != s.getString("key", null)) e.remove("list")   // another account: never show the old one's shows
            e.putString("key", key)
        }
        e.commit()
        lastTry = 0L
    }

    fun on(ctx: Context): Boolean = store(ctx).getString("key", null) != null

    /** The package that opens stremio: links (Stremio's TV app, com.stremio.one), or null when it is not installed. */
    fun pkg(ctx: Context): String? = try {
        Intent(Intent.ACTION_VIEW, Uri.parse("stremio:///")).resolveActivity(ctx.packageManager)?.packageName
    } catch (e: Exception) { null }

    /** The kept list, newest first, straight away: never waits on the network. */
    fun items(ctx: Context): List<Item> {
        if (!on(ctx)) return emptyList()
        val raw = store(ctx).getString("list", null) ?: return emptyList()
        return try {
            val a = JSONArray(raw)
            (0 until a.length()).mapNotNull { n ->
                val o = a.optJSONObject(n) ?: return@mapNotNull null
                Item(o.optString("id"), o.optString("type"), o.optString("name"), o.optString("video").ifEmpty { null },
                    o.optString("season"), o.optString("episode"), o.optString("art").ifEmpty { null },
                    o.optString("fallbackArt").ifEmpty { null }, o.optDouble("progress", 0.0), o.optLong("engaged"))
            }
        } catch (e: Exception) { emptyList() }
    }

    /** The picture to try when [art] (the show's wide background) does not load: the item's own poster. */
    fun fallbackArt(ctx: Context, art: String): String? = items(ctx).firstOrNull { it.art == art }?.fallbackArt

    /**
     * Reads Stremio again in the background, at most once every [FRESH_MS]. [changed] runs (on a
     * worker thread) only when the list is different from the kept one, so the page redraws the row
     * only when there is something new to show.
     */
    fun refresh(ctx: Context, changed: () -> Unit) {
        val app = ctx.applicationContext
        val key = store(app).getString("key", null) ?: return
        val now = System.currentTimeMillis()
        if (busy || now - lastTry < FRESH_MS) return
        busy = true
        lastTry = now
        io.execute {
            try {
                val list = fetch(key) ?: return@execute
                val text = list.toString()
                val s = store(app)
                if (s.getString("key", null) != key || text == s.getString("list", null)) return@execute
                s.edit().putString("list", text).apply()
                changed()
            } catch (e: Exception) {
                // no network or Stremio is slow: keep the last list, try again next time
            } finally {
                busy = false
            }
        }
    }

    /** The intent that opens one card in Stremio (its page for that item, at the episode), or null. */
    fun intent(ctx: Context, cardId: String): Intent? {
        val id = cardId.removePrefix(PREFIX)
        val it = items(ctx).firstOrNull { x -> x.id == id } ?: return null
        val pkg = pkg(ctx) ?: return null
        if (!TYPE.matches(it.type) || !ID.matches(it.id)) return null
        val path = "/detail/" + it.type + "/" + Uri.encode(it.id) + (it.video?.let { v -> "/" + Uri.encode(v) } ?: "")
        // A fresh task: Stremio already running in the background restarts itself for a link, and
        // tearing down its old screen that way crashed it (Android 14, an onn 4K Pro, with the Home
        // button watch's accessibility service on). Clearing its task first opens the page cleanly.
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("stremio://$path")).setPackage(pkg)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        return if (i.resolveActivity(ctx.packageManager) != null) i else null
    }

    // ---------------------------------------------------------------- reading the account

    /** The Continue Watching items as JSON (the kept form), or null when Stremio could not be read. */
    private fun fetch(key: String): JSONArray? {
        val c = URL(API).openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = false
            c.connectTimeout = 6000
            c.readTimeout = 15000
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("authKey", key).put("collection", "libraryItem").put("ids", JSONArray()).put("all", true)
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (c.responseCode !in 200..299) return null
            val j = JSONObject(c.inputStream.use { capped(it) })
            // The key no longer works (signed out, or the account changed): show nothing rather
            // than an old list that never updates. apply.sh with a fresh key brings it back.
            if (j.has("error")) return JSONArray()
            return pick(j.optJSONArray("result") ?: return null)
        } finally {
            c.disconnect()
        }
    }

    private fun capped(s: InputStream): String {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = s.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > MOST_BYTES) throw IllegalStateException("too big")
        }
        return out.toString("UTF-8")
    }

    /** Stremio's own Continue Watching rule, newest first, as the kept JSON. */
    private fun pick(all: JSONArray): JSONArray {
        val found = ArrayList<JSONObject>()
        for (n in 0 until all.length()) {
            val o = all.optJSONObject(n) ?: continue
            val type = o.optString("type")
            if (type == "other" || !TYPE.matches(type)) continue
            if (o.optBoolean("removed") && !o.optBoolean("temp")) continue
            val st = o.optJSONObject("state") ?: continue
            val offset = st.optLong("timeOffset", 0L)
            if (offset <= 0L) continue
            val id = o.optString("_id")
            val name = o.optString("name").trim()
            if (!ID.matches(id) || name.isEmpty()) continue
            val video = if (st.isNull("video_id")) null else st.optString("video_id").takeIf { ID.matches(it) }
            // The state says the season and episode itself; else series videos are
            // "<id>:<season>:<episode>" (Cinemeta) or "<id>:<episode>" (Kitsu and others).
            var season = st.optInt("season", 0).takeIf { it > 0 }?.toString() ?: ""
            var episode = st.optInt("episode", 0).takeIf { it > 0 }?.toString() ?: ""
            if (episode.isEmpty() && video != null && video.startsWith("$id:")) {
                val rest = video.removePrefix("$id:").split(":")
                if (rest.size == 2 && rest.all { NUM.matches(it) }) { season = rest[0]; episode = rest[1] }
                else if (rest.size == 1 && NUM.matches(rest[0])) episode = rest[0]
            }
            val poster = if (o.isNull("poster")) null else o.optString("poster").takeIf { it.startsWith("https://") }
            // A wide picture suits the card: the background Stremio kept with the item, else the
            // show's background from Stremio's own image service for IMDb ids, else the poster.
            val background = if (o.isNull("background")) null else o.optString("background").takeIf { it.startsWith("https://") }
            val wide = background ?: if (IMDB.matches(id)) "https://images.metahub.space/background/medium/$id/img" else null
            val duration = st.optLong("duration", 0L)
            val engaged = time(if (st.isNull("lastWatched")) null else st.optString("lastWatched"))
                ?: time(o.optString("_mtime")) ?: 0L
            found.add(JSONObject().apply {
                put("id", id)
                put("type", type)
                put("name", name.take(200))
                put("video", video ?: "")
                put("season", season)
                put("episode", episode)
                put("art", wide ?: poster ?: "")
                put("fallbackArt", if (wide != null) poster ?: "" else "")
                put("progress", if (duration > 0) (offset.toDouble() / duration).coerceIn(0.0, 1.0) else 0.0)
                put("engaged", engaged)
            })
        }
        found.sortByDescending { it.optLong("engaged") }
        val out = JSONArray()
        found.take(MAX).forEach { out.put(it) }
        return out
    }

    /** An ISO 8601 time ("2026-11-10T06:48:00.123Z") in milliseconds, or null. Works on Android 7.1 (no java.time). */
    private fun time(s: String?): Long? {
        val m = TIME.matchEntire(s?.trim() ?: return null) ?: return null
        val g = m.groupValues
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.clear()
        cal.set(g[1].toInt(), g[2].toInt() - 1, g[3].toInt(), g[4].toInt(), g[5].toInt(), g[6].toInt())
        var ms = cal.timeInMillis
        if (g[7].isNotEmpty()) ms += ((g[7].drop(1) + "000").take(3)).toLong()
        val zone = g[8]
        if (zone.isNotEmpty() && zone != "Z") {
            val sign = if (zone[0] == '-') -1 else 1
            val digits = zone.drop(1).replace(":", "")
            ms -= sign * (digits.take(2).toLong() * 3_600_000L + digits.drop(2).take(2).toLong() * 60_000L)
        }
        return ms
    }
}
