package dev.couchtv.synctest

import android.app.Activity
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.SurfaceHolder
import android.view.SurfaceView
import java.io.File

/**
 * Tests only. Plays a local video with MediaPlayer and publishes a MediaSession the way a
 * streaming app does: the PlaybackState is updated when something changes (play, pause, a seek
 * finishing, a speed change), not continuously. Every callback is logged with elapsedRealtime so a
 * test can see when the player really acted. Start it:
 *   adb push sync/build/sync-test.mp4 /sdcard/Android/data/dev.couchtv.synctest/files/
 *   am start -n dev.couchtv.synctest/.Player
 * The video is made by sync/make-test-video.sh.
 */
class Player : Activity(), SurfaceHolder.Callback {
    private val mp = MediaPlayer()
    private lateinit var session: MediaSession
    private var ready = false
    private var wantPlay = false
    private var speed = 1.0f
    private var seeking = false

    private fun ms() = SystemClock.elapsedRealtimeNanos() / 1e6

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val sv = SurfaceView(this); this.sv = sv
        setContentView(sv)
        sv.holder.addCallback(this)
        session = MediaSession(this, "synctest")
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() { Log.i(TAG, "cb play at=${ms()}"); mp.start(); wantPlay = true; publish() }
            override fun onPause() { Log.i(TAG, "cb pause at=${ms()}"); mp.pause(); wantPlay = false; publish() }
            override fun onSeekTo(pos: Long) {
                Log.i(TAG, "cb seek $pos at=${ms()}")
                seeking = true; publish()
                mp.seekTo(pos, MediaPlayer.SEEK_CLOSEST)   // API 26: frame accurate, not just the nearest keyframe
            }
            override fun onSetPlaybackSpeed(s: Float) {
                Log.i(TAG, "cb speed $s at=${ms()}")
                speed = s
                try { mp.playbackParams = PlaybackParams().setSpeed(s); if (!wantPlay) mp.pause() } catch (e: Exception) { Log.w(TAG, "speed failed $e") }
                publish()
            }
        })
        mp.setOnSeekCompleteListener { seeking = false; Log.i(TAG, "seek done pos=${mp.currentPosition} at=${ms()}"); publish() }
        mp.setOnPreparedListener { ready = true; Log.i(TAG, "prepared dur=${mp.duration}"); publish() }
    }

    override fun surfaceCreated(h: SurfaceHolder) {
        val f = File(getExternalFilesDir(null), "sync-test.mp4")
        mp.setDisplay(h)
        if (!ready) {
            mp.setDataSource(f.absolutePath); mp.isLooping = false; mp.prepareAsync()
        }
        session.isActive = true
        poll()
    }
    override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, hh: Int) {}
    override fun surfaceDestroyed(h: SurfaceHolder) {}

    /** What a streaming app reports: state, position and when it was read, speed, what it accepts. */
    private fun publish() {
        val st = when {
            !ready -> PlaybackState.STATE_BUFFERING
            seeking -> PlaybackState.STATE_BUFFERING
            mp.isPlaying -> PlaybackState.STATE_PLAYING
            else -> PlaybackState.STATE_PAUSED
        }
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SEEK_TO or (1L shl 18) // ACTION_SET_PLAYBACK_SPEED, Android 10
        session.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(st, if (ready) mp.currentPosition.toLong() else 0L, if (st == PlaybackState.STATE_PLAYING) speed else 0f, SystemClock.elapsedRealtime())
            .build())
        if (ready) session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "sync test")
            .putLong(MediaMetadata.METADATA_KEY_DURATION, mp.duration.toLong()).build())
    }

    /** Test only: log the player's own position every 50 ms with the clock, an independent check of the sync result. */
    private fun poll() {
        if (ready) Log.i(TAG, "pos ${mp.currentPosition} at=${ms()} playing=${mp.isPlaying}")
        sv?.postDelayed({ poll() }, 50)
    }
    private var sv: SurfaceView? = null

    override fun onDestroy() { session.release(); mp.release(); super.onDestroy() }
    companion object { const val TAG = "synctest" }
}
