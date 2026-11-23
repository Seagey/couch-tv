package app.couchtv.launcher

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Reads and controls the locally installed Spotify app (com.spotify.tv.android or com.spotify.music)
 * via Android's MediaSessionManager and MediaController.
 *
 * Requires Notification Access (cmd notification allow_listener app.couchtv.launcher/.SpotifyMediaListener).
 * Completely local: no network requests to Spotify, no tokens, no accounts. The cover is only ever the picture
 * inside the session (a data: URI), never a link, which the WebView would load from Spotify.
 *
 * onStateChangedListener is static, so MainActivity sets it through a WeakReference and clears it in
 * onDestroy: the service outlives the activity and must not keep it in memory.
 */
class SpotifyMediaListener : NotificationListenerService() {

    private val main = Handler(Looper.getMainLooper())
    private var mediaSessionManager: MediaSessionManager? = null
    private var activeController: MediaController? = null
    private var cachedArtUrl: String? = null
    private var lastTrackKey: String? = null

    private val sessionCallback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) {
            postStateUpdate()
        }

        override fun onMetadataChanged(metadata: MediaMetadata?) {
            updateCoverArt(metadata)
            postStateUpdate()
        }

        override fun onSessionDestroyed() {
            if (activeController != null) {
                activeController?.unregisterCallback(this)
                activeController = null
                cachedArtUrl = null
                lastTrackKey = null
                postStateUpdate()
            }
        }
    }

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
        updateController(controllers)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        instance = this
        Log.i(TAG, "SpotifyMediaListener connected")
        try {
            mediaSessionManager = getSystemService(MediaSessionManager::class.java)
            val comp = ComponentName(this, SpotifyMediaListener::class.java)
            mediaSessionManager?.addOnActiveSessionsChangedListener(sessionsListener, comp)
            updateController(mediaSessionManager?.getActiveSessions(comp))
        } catch (e: Exception) {
            Log.w(TAG, "Failed to register active sessions listener", e)
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        if (instance == this) instance = null
        try {
            mediaSessionManager?.removeOnActiveSessionsChangedListener(sessionsListener)
        } catch (e: Exception) {}
        activeController?.unregisterCallback(sessionCallback)
        activeController = null
        cachedArtUrl = null
        lastTrackKey = null
        Log.i(TAG, "SpotifyMediaListener disconnected")
    }

    private fun updateController(controllers: List<MediaController>?) {
        val spotify = controllers?.firstOrNull { it.packageName in SPOTIFY_PACKAGES }
        if (spotify?.sessionToken != activeController?.sessionToken) {
            activeController?.unregisterCallback(sessionCallback)
            activeController = spotify
            cachedArtUrl = null
            lastTrackKey = null
            if (spotify != null) {
                spotify.registerCallback(sessionCallback, main)
                updateCoverArt(spotify.metadata)
            }
            postStateUpdate()
        }
    }

    private fun updateCoverArt(metadata: MediaMetadata?) {
        if (metadata == null) {
            cachedArtUrl = null
            lastTrackKey = null
            return
        }
        val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
        val artist = metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)
            ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: ""
        val trackKey = "$artist\n$title"
        if (trackKey == lastTrackKey && cachedArtUrl != null) return

        lastTrackKey = trackKey
        // Extract embedded album art bitmap
        var bmp: Bitmap? = null
        try {
            bmp = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
                ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        } catch (e: Exception) {
            Log.d(TAG, "Could not get artwork bitmap", e)
        }

        if (bmp != null) {
            try {
                val stream = ByteArrayOutputStream()
                // Compress to compact JPEG
                bmp.compress(Bitmap.CompressFormat.JPEG, 85, stream)
                val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
                cachedArtUrl = "data:image/jpeg;base64,$base64"
                return
            } catch (e: Exception) {
                Log.w(TAG, "Failed to encode artwork to base64", e)
            }
        }

        // No picture in the session: no cover. A cover given only as a link (METADATA_KEY_ALBUM_ART_URI and the
        // like) would load from Spotify's servers, and this card sends nothing to Spotify, so it is never used.
        cachedArtUrl = null
    }

    private fun postStateUpdate() {
        val stateJson = currentStateJson()
        main.post {
            onStateChangedListener?.invoke(stateJson)
        }
    }

    fun currentStateJson(): JSONObject {
        val out = JSONObject()
        val controller = activeController
        if (controller == null) {
            out.put("available", false)
            out.put("package", JSONObject.NULL)
            out.put("state", "stopped")
            return out
        }

        out.put("available", true)
        out.put("package", controller.packageName)

        val meta = controller.metadata
        if (meta != null) {
            out.put("title", meta.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "")
            out.put("artist", meta.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: meta.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: "")
            out.put("album", meta.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "")
            val dur = meta.getLong(MediaMetadata.METADATA_KEY_DURATION)
            out.put("duration", if (dur > 0) dur else 0L)
        } else {
            out.put("title", "")
            out.put("artist", "")
            out.put("album", "")
            out.put("duration", 0L)
        }

        out.put("art", cachedArtUrl ?: JSONObject.NULL)

        val pb = controller.playbackState
        if (pb != null) {
            val stateStr = when (pb.state) {
                PlaybackState.STATE_PLAYING -> "playing"
                PlaybackState.STATE_PAUSED -> "paused"
                PlaybackState.STATE_BUFFERING, PlaybackState.STATE_CONNECTING -> "buffering"
                PlaybackState.STATE_FAST_FORWARDING, PlaybackState.STATE_REWINDING -> "playing"
                PlaybackState.STATE_SKIPPING_TO_NEXT, PlaybackState.STATE_SKIPPING_TO_PREVIOUS -> "buffering"
                else -> "stopped"
            }
            out.put("state", stateStr)
            out.put("position", pb.position)
            out.put("last_update", pb.lastPositionUpdateTime)
            out.put("speed", pb.playbackSpeed.toDouble())
            out.put("actions", pb.actions)
        } else {
            out.put("state", "stopped")
            out.put("position", 0L)
            out.put("last_update", SystemClock.elapsedRealtime())
            out.put("speed", 0.0)
            out.put("actions", 0L)
        }

        return out
    }

    fun executeControl(action: String, paramMs: Long): Boolean {
        val controller = activeController ?: return false
        val transport = controller.transportControls ?: return false
        val pb = controller.playbackState
        val meta = controller.metadata

        when (action.lowercase()) {
            "play" -> transport.play()
            "pause" -> transport.pause()
            "play_pause" -> {
                if (pb?.state == PlaybackState.STATE_PLAYING) {
                    transport.pause()
                } else {
                    transport.play()
                }
            }
            "next" -> transport.skipToNext()
            "previous" -> transport.skipToPrevious()
            "seek" -> {
                val dur = meta?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: Long.MAX_VALUE
                val target = paramMs.coerceIn(0L, if (dur > 0) dur else Long.MAX_VALUE)
                transport.seekTo(target)
            }
            "rewind" -> {
                val interval = if (paramMs > 0) paramMs else DEFAULT_SEEK_MS
                val curPos = computeCurrentPosition(pb)
                val target = (curPos - interval).coerceAtLeast(0L)
                transport.seekTo(target)
            }
            "fast_forward" -> {
                val interval = if (paramMs > 0) paramMs else DEFAULT_SEEK_MS
                val curPos = computeCurrentPosition(pb)
                val dur = meta?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L
                val maxTarget = if (dur > 0) dur else (curPos + interval)
                val target = (curPos + interval).coerceIn(0L, maxTarget)
                transport.seekTo(target)
            }
            else -> return false
        }
        return true
    }

    private fun computeCurrentPosition(pb: PlaybackState?): Long {
        if (pb == null) return 0L
        var pos = pb.position
        if (pb.state == PlaybackState.STATE_PLAYING) {
            val elapsed = SystemClock.elapsedRealtime() - pb.lastPositionUpdateTime
            if (elapsed > 0) {
                pos += (elapsed * pb.playbackSpeed).toLong()
            }
        }
        return pos.coerceAtLeast(0L)
    }

    companion object {
        const val TAG = "couchtv.spotify"
        val SPOTIFY_PACKAGES = setOf("com.spotify.tv.android", "com.spotify.music")
        const val DEFAULT_SEEK_MS = 10_000L

        var instance: SpotifyMediaListener? = null
            private set

        var onStateChangedListener: ((JSONObject) -> Unit)? = null

        fun isListenerConnected(): Boolean = instance != null

        fun hasNotificationAccess(context: Context): Boolean {
            val enabledListeners = android.provider.Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false
            val myComponent = ComponentName(context, SpotifyMediaListener::class.java).flattenToString()
            return enabledListeners.contains(myComponent)
        }
    }
}
