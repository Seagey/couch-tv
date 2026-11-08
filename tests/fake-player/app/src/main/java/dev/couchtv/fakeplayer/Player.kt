package dev.couchtv.fakeplayer

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
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
    // Now playing (#31): a playlist the media keys step through ("Title~Artist|Title~Artist")
    private var songs: List<Pair<String, String?>> = emptyList()
    private var songAt = 0
    private var album: String? = null
    private var playing = true
    // Android sends the remote's media keys to the app that is really playing sound, so a song plays
    // silence while it is "playing" (a real music app plays its music)
    private var track: AudioTrack? = null
    private fun sound(on: Boolean) {
        if (!on) { track?.let { runCatching { it.pause(); it.flush() } }; return }
        val t = track ?: run {
            val frames = 44100
            AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(44100).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(frames * 2).build()
                .also { it.write(ShortArray(frames), 0, frames); it.setLoopPoints(0, frames, -1); track = it }
        }
        runCatching { t.play() }
    }

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
        album = i.getStringExtra("album")
        songs = i.getStringExtra("songs")?.split("|")?.filter { it.isNotBlank() }?.map { it.substringBefore("~") to it.substringAfter("~", "").ifEmpty { null } } ?: emptyList()
        songAt = 0; playing = true
        if (songs.isNotEmpty()) { play(songs[0].first, songs[0].second, null, false, 0L); sound(true); return }
        play(i.getStringExtra("title"), i.getStringExtra("subtitle"), i.getStringExtra("queue"),
            i.getBooleanExtra("nometa", false), i.getIntExtra("pos_s", 0) * 1000L)
    }

    // the remote's media keys, as a music app takes them: play, pause, next and previous
    private val keys = object : MediaSession.Callback() {
        override fun onPlay() { Log.i(TAG, "fakeplayer key play"); playing = true; sound(true); state() }
        override fun onPause() { Log.i(TAG, "fakeplayer key pause"); playing = false; sound(false); state() }
        override fun onSkipToNext() { Log.i(TAG, "fakeplayer key next"); step(1) }
        override fun onSkipToPrevious() { Log.i(TAG, "fakeplayer key previous"); step(-1) }
    }
    private fun step(d: Int) {
        if (songs.isEmpty()) return
        songAt = (songAt + d + songs.size) % songs.size
        playing = true
        play(songs[songAt].first, songs[songAt].second, null, false, 0L)
    }
    private fun state() {
        session?.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, 0L, if (playing) 1.0f else 0f, SystemClock.elapsedRealtime())
            .build())
        label.text = (if (playing) "playing " else "paused ") + (songs.getOrNull(songAt)?.first ?: "")
    }

    private fun play(title: String?, subtitle: String?, queue: String?, noMeta: Boolean, posMs: Long) {
        val s = session ?: MediaSession(this, "fakeplayer").also { session = it; it.setCallback(keys) }
        if (!noMeta) {
            s.setMetadata(MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_DESCRIPTION, album)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, 45 * 60_000L)
                .build())
        } else s.setMetadata(null)
        s.setQueueTitle(queue)
        s.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, posMs, if (playing) 1.0f else 0f, SystemClock.elapsedRealtime())
            .build())
        s.isActive = true
        label.text = if (noMeta) "playing (no metadata)" else "playing $title" + (subtitle?.let { " · $it" } ?: "") + (queue?.let { " [queue: $it]" } ?: "")
        Log.i(TAG, "fakeplayer playing title=$title subtitle=$subtitle queue=$queue nometa=$noMeta pos=$posMs")
    }

    private fun release() {
        track?.let { runCatching { it.stop(); it.release() } }
        track = null
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
