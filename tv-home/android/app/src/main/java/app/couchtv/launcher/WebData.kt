package app.couchtv.launcher

import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * The relay for the home's web widgets (tv-home/web/widget-web.js) on a TV with no computer: a news
 * feed or a share price sends no CORS header, so the page asks here (http://tvos.invalid/webdata?src=
 * news&id=abc) and gets {"ok":true,"text":"..."} back. It only knows the sources named below, each by
 * an id, never a link, so the page can never point it anywhere else. Free sources, no key, no account:
 * public RSS feeds (personal, non commercial reading) and Yahoo Finance's public chart data
 * (unofficial, personal use). The last answer is kept in memory for a few minutes.
 *
 * The same lists are in bridge/webdata.py and on-tv's WebData.kt: change all three together.
 */
object WebData {
    private val FEEDS = mapOf(
        "abc" to "https://www.abc.net.au/news/feed/45910/rss.xml",
        "abc-justin" to "https://www.abc.net.au/news/feed/51120/rss.xml",
        "abc-sport" to "https://www.abc.net.au/news/feed/2942460/rss.xml",
        "abc-business" to "https://www.abc.net.au/news/feed/51892/rss.xml",
        "sbs" to "https://www.sbs.com.au/news/topic/latest/feed",
        "guardian" to "https://www.theguardian.com/au/rss",
        "bbc" to "https://feeds.bbci.co.uk/news/world/rss.xml",
        "rnz" to "https://www.rnz.co.nz/rss/national.xml"
    )
    private val SYMBOL = Regex("\\^?[A-Z0-9]{1,8}([.=-][A-Z0-9]{1,4})?")
    private const val MAX_SYMBOLS = 8
    private const val MAX_BYTES = 300 * 1024
    private const val UA = "couch-tv (+https://github.com/Seagey/couch-tv)"
    private val KEEP = mapOf("news" to 10 * 60_000L, "stocks" to 2 * 60_000L)
    private val cache = HashMap<String, Pair<Long, String>>()

    /** The one link for a source and id, or null when it is not one this relay knows. */
    fun urlFor(src: String, id: String): String? = when (src) {
        "news" -> FEEDS[id]
        "stocks" -> {
            val syms = id.split(",").filter { it.isNotEmpty() }
            if (syms.isEmpty() || syms.size > MAX_SYMBOLS || !syms.all { SYMBOL.matches(it) }) null
            else "https://query2.finance.yahoo.com/v7/finance/spark?symbols=" +
                syms.joinToString(",") { URLEncoder.encode(it, "UTF-8") } + "&range=1d&interval=15m"
        }
        else -> null
    }

    /** The answer for http://tvos.invalid/webdata: always JSON, {"ok":true,"text"} or {"ok":false,"error"}. */
    fun answer(u: Uri): Pair<Int, String> {
        val src = u.getQueryParameter("src") ?: ""
        val id = u.getQueryParameter("id") ?: ""
        val url = urlFor(src, id) ?: return 400 to JSONObject().put("ok", false).put("error", "unknown source").toString()
        val now = System.currentTimeMillis()
        synchronized(cache) {
            cache[url]?.let { (at, text) -> if (now - at < (KEEP[src] ?: 0L)) return 200 to ok(text) }
        }
        return try {
            val text = fetch(url)
            synchronized(cache) {
                cache[url] = now to text
                if (cache.size > 64) cache.entries.sortedBy { it.value.first }.take(16).forEach { cache.remove(it.key) }
            }
            200 to ok(text)
        } catch (e: Exception) {
            android.util.Log.w("couchtv", "webdata $src: ${e.message}")
            502 to JSONObject().put("ok", false).put("error", "The source could not be read just now.").toString()
        }
    }

    private fun ok(text: String) = JSONObject().put("ok", true).put("text", text).toString()

    private fun fetch(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 6000; c.readTimeout = 10000
            c.instanceFollowRedirects = true
            c.setRequestProperty("User-Agent", UA)
            if (c.responseCode != 200) throw java.io.IOException("source answered ${c.responseCode}")
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            c.inputStream.use { s ->
                while (out.size() < MAX_BYTES) {
                    val n = s.read(buf, 0, minOf(buf.size, MAX_BYTES - out.size()))
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
            }
            return String(out.toByteArray(), Charsets.UTF_8)
        } finally { c.disconnect() }
    }
}
