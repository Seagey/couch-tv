package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The music card of the Spotlight look: a YouTube or YouTube Music playlist, read from YouTube's
 * public playlist feed (no sign-in, no key; the playlist has to be public or unlisted, and the feed
 * gives its first 15 songs). The home plays them itself in YouTube's embedded player.
 * Set with POST /api/settings {"music_playlist": "<share link or playlist id>"}.
 */
object Playlist {
    private const val KEY = "music_playlist"
    // until one is set: YouTube Music's own "The Hit List"
    private const val DEFAULT = "RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs"
    @Volatile private var cache: Pair<String, JSONObject>? = null
    @Volatile private var at = 0L

    /** A share link (music.youtube.com/playlist?list=..., youtube.com/...&list=...) or a bare id. */
    fun idFrom(s: String): String? {
        val t = s.trim()
        Regex("[?&]list=([A-Za-z0-9_-]{10,})").find(t)?.let { return it.groupValues[1] }
        return t.takeIf { Regex("[A-Za-z0-9_-]{10,64}").matches(it) }
    }

    fun set(s: String) {
        val id = if (s.isBlank()) null else idFrom(s) ?: throw ApiError(400, "That isn't a YouTube playlist link.")
        Store.putStr(KEY, id)
        cache = null
    }

    fun current(): String = Store.str(KEY) ?: DEFAULT

    @Synchronized fun get(): JSONObject {
        val id = current()
        cache?.let { (cid, j) -> if (cid == id && System.currentTimeMillis() - at < 30 * 60_000) return j }
        val c = URL("https://www.youtube.com/feeds/videos.xml?playlist_id=$id").openConnection() as HttpURLConnection
        c.connectTimeout = 6000; c.readTimeout = 8000
        val xml = try {
            if (c.responseCode != 200) throw ApiError(404, "That playlist can't be read. Is it public or unlisted?")
            c.inputStream.bufferedReader().readText()
        } finally { c.disconnect() }
        val title = Regex("<title>([^<]*)</title>").find(xml)?.groupValues?.get(1)?.let(::unxml) ?: ""
        val items = JSONArray()
        for (m in Regex("<entry>(.*?)</entry>", RegexOption.DOT_MATCHES_ALL).findAll(xml)) {
            val e = m.groupValues[1]
            val vid = Regex("<yt:videoId>([^<]+)</yt:videoId>").find(e)?.groupValues?.get(1) ?: continue
            val raw = Regex("<title>([^<]*)</title>").find(e)?.groupValues?.get(1)?.let(::unxml) ?: continue
            val author = Regex("<name>([^<]*)</name>").find(e)?.groupValues?.get(1)?.let(::unxml) ?: ""
            val (song, artist) = tidy(raw, author)
            items.put(JSONObject().put("id", vid).put("title", song).put("artist", artist)
                .put("thumb", "https://i.ytimg.com/vi/$vid/hqdefault.jpg"))
        }
        val j = JSONObject().put("id", id).put("title", title).put("custom", Store.str(KEY) != null).put("items", items)
        cache = id to j; at = System.currentTimeMillis()
        return j
    }

    private fun unxml(s: String) = s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")

    /** "Artist - Song (Official Video)" by "ArtistVEVO" -> ("Song", "Artist"). */
    private fun tidy(raw: String, author: String): Pair<String, String> {
        var t = raw.replace(Regex("\\s*[(\\[][^)\\]]*(official|video|audio|lyric|visuali[sz]er|4k|hd|remaster)[^)\\]]*[)\\]]", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s*\\|.*$"), "").trim()
        var artist = author.removeSuffix(" - Topic").replace(Regex("VEVO$"), "").trim()
        val dash = Regex("^(.+?)\\s+[-–—]\\s+(.+)$").find(t)
        if (dash != null) { artist = dash.groupValues[1].trim(); t = dash.groupValues[2].trim() }
        return t to artist
    }
}
