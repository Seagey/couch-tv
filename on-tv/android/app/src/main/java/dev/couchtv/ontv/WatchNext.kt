package dev.couchtv.ontv

import android.net.Uri

/**
 * Android's Watch Next rows (the "Continue watching" the apps keep for Google TV and Android TV).
 * Netflix gives Android no title while it plays and Prime only its own name (issue #23), but both
 * keep these rows, so Keep watching can name the play from them. Readable with READ_TV_LISTINGS
 * (READ_EPG_DATA before Android 10), which Adb.onConnected grants; ADB's own shell user cannot read
 * other apps' rows. Read only. Empty when the permission or the TV provider is missing.
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
}
