package dev.couchtv.ontv

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONObject

/**
 * Android's Watch Next rows (the "Continue watching" the apps keep for Google TV and Android TV).
 * Netflix gives Android no title while it plays and Prime only its own name (issue #23), but both
 * keep these rows, so Keep watching can name the play from them. Readable with READ_TV_LISTINGS
 * (READ_EPG_DATA before Android 10), which Adb.onConnected grants; ADB's own shell user cannot read
 * other apps' rows. Read only. Empty when the permission or the TV provider is missing.
 *
 * Where the app's own ADB never connects (current Fire OS blocks it, CVE-2024-27350), Keep watching
 * cannot see what plays, so it lists these rows as cards instead (#122), the way the TV home app
 * does. The permission is then granted once from a computer:
 *   adb shell pm grant dev.couchtv.ontv android.permission.READ_TV_LISTINGS
 */
object WatchNext {
    data class Row(val pkg: String, val title: String, val episodeTitle: String?, val season: String?,
                   val episode: String?, val engaged: Long, val poster: String?)

    private val URI = Uri.parse("content://android.media.tv/watch_next_program")
    private val COLS = arrayOf("package_name", "title", "episode_title", "season_display_number",
        "episode_display_number", "last_engagement_time_utc_millis", "poster_art_uri")

    fun rows(pkg: String? = null): List<Row> {
        val out = ArrayList<Row>()
        runCatching {
            Store.context().contentResolver.query(URI, COLS, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val p = c.getString(0) ?: continue
                    if (pkg != null && p != pkg) continue
                    val title = c.getString(1)?.takeIf { it.isNotBlank() } ?: continue
                    out.add(Row(p, title, c.getString(2)?.takeIf { it.isNotBlank() }, c.getString(3)?.takeIf { it.isNotBlank() },
                        c.getString(4)?.takeIf { it.isNotBlank() }, c.getLong(5), c.getString(6)?.takeIf { it.startsWith("https://") }))
                }
            }
        }.onFailure { android.util.Log.i("couchtv.keep", "watch next unreadable: ${it.message}") }
        return out
    }

    // ---------- Watch Next rows as Keep watching cards (#122) ----------

    const val ID_PREFIX = "wn:"
    private val PERMISSION = if (Build.VERSION.SDK_INT >= 29) "android.permission.READ_TV_LISTINGS"
        else "com.android.providers.tv.permission.READ_EPG_DATA"

    fun granted(): Boolean = Store.context().checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED

    /** Lists the rows as cards only where Keep watching has no other way to fill: the permission is
     *  there and the app's own ADB has never connected. A TV whose ADB works keeps Keep watching
     *  exactly as before. */
    fun listed(): Boolean = granted() && !Adb.everAllowed

    /** Pictures the page may ask for through tvos.invalid/art (content:// ones it cannot load itself). */
    private val artSeen = java.util.Collections.synchronizedSet(HashSet<String>())

    /** The rows as Keep watching cards, newest first, with the TV home app's rules (KeepMerge.watchNext). */
    fun cards(skip: Set<String>, perApp: Int): List<KeepMerge.Card<JSONObject>> {
        if (!listed()) return emptyList()
        val ctx = Store.context()
        val pm = ctx.packageManager
        val rows = ArrayList<KeepMerge.Card<JSONObject>>()
        runCatching {
            val cols = arrayOf("_id", "package_name", "title", "episode_title", "season_display_number",
                "episode_display_number", "poster_art_uri", "thumbnail_uri", "last_playback_position_millis",
                "duration_millis", "last_engagement_time_utc_millis")
            ctx.contentResolver.query(URI, cols, null, null, "last_engagement_time_utc_millis DESC")?.use { c ->
                while (c.moveToNext() && rows.size < 60) {
                    val pkg = c.getString(1) ?: continue
                    val title = c.getString(2)?.takeIf { it.isNotBlank() } ?: continue
                    val label = runCatching { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(pkg)
                    val art = c.getString(7)?.takeIf { it.isNotBlank() } ?: c.getString(6)?.takeIf { it.isNotBlank() }
                    val pos = c.getLong(8); val dur = c.getLong(9); val engaged = c.getLong(10)
                    val card = JSONObject().put("id", ID_PREFIX + c.getLong(0)).put("wn", true).put("title", title)
                        .put("episode_title", c.getString(3)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("season", c.getString(4)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("episode", c.getString(5)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                        .put("app", JSONObject().put("package", pkg).put("name", label))
                        .put("service", JSONObject.NULL).put("poster", JSONObject.NULL)
                        .put("backdrop", art?.let { artRoute(it) } ?: JSONObject.NULL)
                        .put("progress", if (dur > 0 && pos > 0) (pos.toDouble() / dur).coerceIn(0.0, 1.0) else JSONObject.NULL)
                        .put("kind", "continue").put("last_played", Now.iso(engaged)).put("source", "watch_next")
                    rows.add(KeepMerge.Card(Finder.norm(title), pkg, engaged, true, card))
                }
            }
        }.onFailure { android.util.Log.i("couchtv.keep", "watch next unreadable: ${it.message}") }
        return KeepMerge.watchNext(rows, BuildConfig.APPLICATION_ID, skip, perApp)
    }

    /** https pictures load as they are; anything else goes through the home's tvos.invalid/art route. */
    private fun artRoute(raw: String): String {
        if (raw.startsWith("https://")) return raw
        artSeen.add(raw)
        return "http://tvos.invalid/art/" + android.util.Base64.encodeToString(raw.toByteArray(),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
    }

    /** A card picture the page cannot read itself, only ever one a card named. */
    fun art(token: String): ByteArray? = runCatching {
        val raw = String(android.util.Base64.decode(token, android.util.Base64.URL_SAFE))
        if (raw !in artSeen) return null
        val u = Uri.parse(raw)
        when (u.scheme) {
            "content", "android.resource" -> Store.context().contentResolver.openInputStream(u)?.use { it.readBytes() }
            "http" -> (java.net.URL(raw).openConnection() as java.net.HttpURLConnection).run {
                connectTimeout = 6000; readTimeout = 8000; inputStream.use { it.readBytes() } }
            else -> null
        }
    }.getOrNull()

    /** Opens a card: the row's own link, only ever in the app that owns the row, else that app. */
    fun open(id: String): Boolean {
        val rowId = id.removePrefix(ID_PREFIX).toLongOrNull() ?: return false
        if (!granted()) return false
        val ctx = Store.context()
        var pkg: String? = null; var link: String? = null
        runCatching {
            ctx.contentResolver.query(android.content.ContentUris.withAppendedId(URI, rowId),
                arrayOf("package_name", "intent_uri"), null, null, null)?.use { c ->
                if (c.moveToFirst()) { pkg = c.getString(0); link = c.getString(1) }
            }
        }
        val owner = pkg ?: return false
        if (owner == BuildConfig.APPLICATION_ID) return false
        link?.let { raw ->
            val ok = runCatching {
                val i = Intent.parseUri(raw, Intent.URI_INTENT_SCHEME)
                if (i.component != null && i.component!!.packageName != owner) i.component = null
                i.`package` = owner
                i.selector = null
                if (i.resolveActivity(ctx.packageManager) == null) return@runCatching false
                Tv.start(i); true
            }.getOrDefault(false)
            if (ok) return true
        }
        return runCatching { Tv.launchPackage(owner); true }.getOrDefault(false)
    }
}
