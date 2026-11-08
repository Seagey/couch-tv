package dev.couchtv.fakeplayer

import android.app.Activity
import android.content.ContentValues
import android.media.tv.TvContract
import android.content.Intent
import android.graphics.Color
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.widget.TextView

/**
 * Tests only (README.md). Plays nothing; publishes a media session the way a streaming app does,
 * set by launch extras, so the on-TV app's Keep watching can be checked on an emulator.
 */
class Player : Activity() {
    private var session: MediaSession? = null
    private val main = Handler(Looper.getMainLooper())
    private lateinit var label: TextView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        label = TextView(this).apply { setTextColor(Color.WHITE); textSize = 32f; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK) }
        setContentView(label)
        handle(intent)
    }

    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i)
        setIntent(i)
        handle(i)
    }

    private fun handle(i: Intent) {
        main.removeCallbacksAndMessages(null)
        if (i.action == Intent.ACTION_VIEW) {
            Log.i(TAG, "fakeplayer opened ${i.dataString}")
            // starts playing with no title (as couch-tv waits to see playback), so nothing is recorded from it
            play(null, null, null, true, 0L)
            label.text = "opened ${i.dataString}"
            return
        }
        if (i.getBooleanExtra("stop", false)) { release(); label.text = "stopped"; return }
        // Watch Next (Android's "Continue watching" row, as Netflix and Prime fill it): `--es wn "Title"`
        // adds or replaces this app's one row; `--ez wn_clear true` removes it. With nometa it copies
        // Netflix on a Xiaomi box (issue #23): playing, no metadata, a Watch Next row.
        if (i.getBooleanExtra("wn_clear", false)) clearWatchNext()
        i.getStringExtra("wn")?.let { putWatchNext(it, i.getStringExtra("wn_ep"), i.getIntExtra("wn_s", 0), i.getIntExtra("wn_e", 0), i.getIntExtra("wn_pos_s", 600)) }
        if (i.getBooleanExtra("wn_only", false)) { label.text = "watch next set"; return }
        // `--ez wn_read true`: logs every Watch Next row this app can see (tests what READ_TV_LISTINGS allows)
        if (i.getBooleanExtra("wn_read", false)) { readWatchNext(); return }
        val rotate = i.getStringExtra("rotate")?.split("|")?.filter { it.isNotBlank() }
        if (rotate != null && rotate.isNotEmpty()) {
            val every = i.getIntExtra("rotate_s", 15) * 1000L
            var n = 0
            val step = object : Runnable {
                override fun run() {
                    play(rotate[n % rotate.size], null, null, false, 0L)
                    n++
                    main.postDelayed(this, every)
                }
            }
            step.run()
            return
        }
        play(i.getStringExtra("title"), i.getStringExtra("subtitle"), i.getStringExtra("queue"),
            i.getBooleanExtra("nometa", false), i.getIntExtra("pos_s", 0) * 1000L)
    }

    private fun play(title: String?, subtitle: String?, queue: String?, noMeta: Boolean, posMs: Long) {
        val s = session ?: MediaSession(this, "fakeplayer").also { session = it }
        if (!noMeta) {
            s.setMetadata(MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, 45 * 60_000L)
                .build())
        } else s.setMetadata(null)
        s.setQueueTitle(queue)
        s.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PAUSE)
            .setState(PlaybackState.STATE_PLAYING, posMs, 1.0f, SystemClock.elapsedRealtime())
            .build())
        s.isActive = true
        label.text = if (noMeta) "playing (no metadata)" else "playing $title" + (subtitle?.let { " · $it" } ?: "") + (queue?.let { " [queue: $it]" } ?: "")
        Log.i(TAG, "fakeplayer playing title=$title subtitle=$subtitle queue=$queue nometa=$noMeta pos=$posMs")
    }

    private fun readWatchNext() {
        val rows = ArrayList<String>()
        runCatching {
            contentResolver.query(TvContract.WatchNextPrograms.CONTENT_URI, arrayOf("package_name", "title"), null, null, null)?.use { c ->
                while (c.moveToNext()) rows.add("${c.getString(0)}:${c.getString(1)}")
            }
        }.onFailure { Log.w(TAG, "fakeplayer watch next read failed: ${it.message}") }
        Log.i(TAG, "fakeplayer watch next read ${rows.size} rows: $rows")
        label.text = "read ${rows.size} rows"
    }

    private fun clearWatchNext() {
        runCatching { contentResolver.delete(TvContract.WatchNextPrograms.CONTENT_URI, null, null) }
            .onFailure { Log.w(TAG, "fakeplayer watch next clear: ${it.message}") }
    }

    private fun putWatchNext(title: String, ep: String?, season: Int, episode: Int, posS: Int) {
        clearWatchNext()
        val v = ContentValues().apply {
            put(TvContract.WatchNextPrograms.COLUMN_TYPE, if (season > 0) TvContract.WatchNextPrograms.TYPE_TV_EPISODE else TvContract.WatchNextPrograms.TYPE_MOVIE)
            put(TvContract.WatchNextPrograms.COLUMN_WATCH_NEXT_TYPE, TvContract.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
            put(TvContract.WatchNextPrograms.COLUMN_TITLE, title)
            if (ep != null) put(TvContract.WatchNextPrograms.COLUMN_EPISODE_TITLE, ep)
            if (season > 0) put(TvContract.WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER, season.toString())
            if (episode > 0) put(TvContract.WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER, episode.toString())
            put(TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS, System.currentTimeMillis())
            put(TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS, posS * 1000L)
            put(TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS, 45 * 60_000L)
            put(TvContract.WatchNextPrograms.COLUMN_INTENT_URI, "fakeplayer://resume/" + android.net.Uri.encode(title))
            put(TvContract.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID, "fake-" + title.hashCode())
        }
        runCatching { contentResolver.insert(TvContract.WatchNextPrograms.CONTENT_URI, v) }
            .onSuccess { Log.i(TAG, "fakeplayer watch next $title -> $it") }
            .onFailure { Log.w(TAG, "fakeplayer watch next failed: ${it.message}") }
    }

    private fun release() {
        session?.let { it.isActive = false; it.release() }
        session = null
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        release()
        super.onDestroy()
    }

    companion object { const val TAG = "fakeplayer" }
}
