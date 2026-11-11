package dev.couchtv.ontv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Now playing (#31): the song any app is playing, for the home's card, the same as the computer
 * bridge's /api/music. Read from `dumpsys media_session` like Keep watching, but not only the app
 * in front: the point is music (Spotify, YouTube Music) carrying on behind the home. A session counts
 * while it plays, and stays for ten minutes after a pause so the card's play button can start it again.
 */
object Music {
    private const val PAUSE_KEEP_MS = 10 * 60_000L
    private val OWN = setOf("app.couchtv.launcher", "dev.couchtv.ontv")
    private var readAt = 0L
    private var item: JSONObject? = null
    private var last: Pair<String, Long>? = null          // package, when it was last seen playing
    private val art = ConcurrentHashMap<String, String>()  // "artist\ntitle" -> picture url, or "" for none
    private val pending = java.util.Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    private val pool = Executors.newSingleThreadExecutor()

    @Synchronized
    fun now(): JSONObject? {
        if (System.currentTimeMillis() - readAt < 3000) return item
        readAt = System.currentTimeMillis()
        val (uptime, all) = Tv.sessions()
        if (uptime == null) return item   // ADB busy or away for a moment: keep the card as it was
        item = null
        val found = all.filter { it.pkg !in OWN && !it.title.isNullOrEmpty() }
        val playing = found.filter { it.state == "PLAYING" }.sortedBy { !it.active }
        var pick = playing.firstOrNull()
        val l = last
        if (pick == null && l != null && System.currentTimeMillis() - l.second < PAUSE_KEEP_MS)
            pick = found.firstOrNull { it.pkg == l.first && (it.state == "PAUSED" || it.state == "STOPPED") }
        // A title made only of digits ("911", "1999") is a real song when the app names the artist
        // too; genericTitle alone would drop it as a placeholder (seen with Damso's "911" on Spotify).
        val t = pick?.title?.trim().orEmpty()
        val numericSong = pick != null && !pick.subtitle.isNullOrBlank() && t.isNotEmpty() && t.all { it.isDigit() }
        if (pick == null || (!numericSong && Tv.genericTitle(pick.title, pick.pkg))) return item
        if (pick.state == "PLAYING") last = pick.pkg to System.currentTimeMillis()
        val key = "${(pick.subtitle ?: "").lowercase()}\n${pick.title!!.lowercase()}"
        if (!art.containsKey(key) && pending.add(key)) {
            val artist = pick.subtitle; val title = pick.title
            pool.execute { try { art[key] = lookup(artist, title) } finally { pending.remove(key) } }
        }
        item = JSONObject().put("title", pick.title).put("artist", pick.subtitle ?: JSONObject.NULL)
            .put("album", pick.album ?: JSONObject.NULL).put("state", Tv.STATES[pick.state] ?: "stopped")
            .put("app", Apps.describe(pick.pkg)?.let { JSONObject(it) } ?: JSONObject().put("name", pick.pkg).put("package", pick.pkg))
            .put("art", art[key]?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
        if (pick.pos_s != null) item!!.put("position", pick.pos_s)
        if (pick.dur_s != null) item!!.put("duration", pick.dur_s)
        return item
    }

    /** The album picture from Apple's free iTunes search (no key), once per song. */
    private fun lookup(artist: String?, title: String?): String = try {
        val q = URLEncoder.encode("${artist ?: ""} ${title ?: ""}".trim(), "UTF-8")
        val c = URL("https://itunes.apple.com/search?entity=song&limit=1&term=$q").openConnection() as HttpURLConnection
        c.connectTimeout = 6000; c.readTimeout = 6000
        c.setRequestProperty("User-Agent", "couch-tv-ontv/1")
        val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
        j.optJSONArray("results")?.optJSONObject(0)?.optString("artworkUrl100")?.takeIf { it.isNotEmpty() }
            ?.replace("100x100bb", "600x600bb") ?: ""
    } catch (e: Exception) { "" }
}
