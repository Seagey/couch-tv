package app.couchtv.launcher

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Bundle
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

        override fun onQueueChanged(queue: MutableList<MediaSession.QueueItem>?) {
            postStateUpdate()
        }

        override fun onExtrasChanged(extras: Bundle?) {
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

    private fun isMusicSession(c: MediaController): Boolean {
        val pb = c.playbackState
        if (pb != null && pb.state == PlaybackState.STATE_ERROR) return false
        val title = c.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
        if (title.isNullOrBlank()) return false
        if (c.packageName in MUSIC_ONLY_PACKAGES) return true
        val contentType = try { c.playbackInfo?.audioAttributes?.contentType } catch (_: Exception) { null }
        return contentType == AudioAttributes.CONTENT_TYPE_MUSIC
    }

    private fun pickMusicController(controllers: List<MediaController>?): MediaController? {
        val candidates = controllers?.filter { isMusicSession(it) }.orEmpty()
        if (candidates.isEmpty()) return null
        return candidates.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: candidates.firstOrNull { it.packageName in SPOTIFY_PACKAGES }
            ?: candidates.firstOrNull()
    }

    private fun resolveAppName(pkg: String): String {
        return try {
            val info = packageManager.getApplicationInfo(pkg, 0)
            packageManager.getApplicationLabel(info)?.toString()?.takeIf { it.isNotBlank() } ?: pkg
        } catch (_: Exception) {
            if (pkg in SPOTIFY_PACKAGES) "Spotify" else pkg
        }
    }

    private fun updateController(controllers: List<MediaController>?) {
        val chosen = pickMusicController(controllers)
        if (chosen?.sessionToken != activeController?.sessionToken) {
            activeController?.unregisterCallback(sessionCallback)
            activeController = chosen
            cachedArtUrl = null
            lastTrackKey = null
            if (chosen != null) {
                chosen.registerCallback(sessionCallback, main)
                updateCoverArt(chosen.metadata)
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
        out.put("app_name", resolveAppName(controller.packageName))

        // Up Next queue peek (when the app populates MediaController.queue)
        var upNextTitle: String? = null
        var upNextArtist: String? = null
        try {
            val queue = controller.queue
            if (!queue.isNullOrEmpty()) {
                val activeId = pb?.activeQueueItemId ?: -1L
                val curTitle = meta?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
                val activeIdx = queue.indexOfFirst { it.queueId == activeId }
                val nextItem = when {
                    activeIdx >= 0 && activeIdx + 1 < queue.size -> queue[activeIdx + 1]
                    queue.size > 1 -> {
                        val firstTitle = queue[0].description?.title?.toString() ?: ""
                        if (firstTitle.isNotEmpty() && firstTitle != curTitle) queue[0] else queue[1]
                    }
                    else -> null
                }
                if (nextItem != null) {
                    val t = nextItem.description?.title?.toString()?.trim()
                    if (!t.isNullOrEmpty() && t != curTitle) {
                        upNextTitle = t
                        upNextArtist = nextItem.description?.subtitle?.toString()?.trim()
                    }
                }
            }
        } catch (e: Exception) {}
        out.put("up_next_title", upNextTitle ?: JSONObject.NULL)
        out.put("up_next_artist", upNextArtist ?: JSONObject.NULL)

        // Shuffle & Repeat state (from PlaybackState/Controller extras or custom actions)
        val pbExtras = pb?.extras
        val ctlExtras = try { controller.extras } catch (e: Exception) { null }
        val shuffleVal = readIntExtra(pbExtras, ctlExtras,
            "android.support.v4.media.session.EXTRA_SHUFFLE_MODE",
            "androidx.media3.session.EXTRA_SHUFFLE_MODE")
        val repeatVal = readIntExtra(pbExtras, ctlExtras,
            "android.support.v4.media.session.EXTRA_REPEAT_MODE",
            "androidx.media3.session.EXTRA_REPEAT_MODE")
        val customActions = pb?.customActions ?: emptyList()
        val shuffleCa = customActions.firstOrNull {
            it.action.contains("shuffle", ignoreCase = true) || it.name.toString().contains("shuffle", ignoreCase = true)
        }
        val repeatCa = customActions.firstOrNull {
            it.action.contains("repeat", ignoreCase = true) || it.name.toString().contains("repeat", ignoreCase = true)
        }

        val shuffleState: String? = when (shuffleVal) {
            1 -> "normal"
            2 -> "smart"
            0 -> "off"
            else -> shuffleCa?.let { ca ->
                val act = ca.action.lowercase()
                val nm = ca.name.toString().lowercase()
                when {
                    act.contains("smart_shuffle_off") || act.contains("disable_smart") || nm.contains("disable smart") -> "smart"
                    act.contains("smart_shuffle_on") || act.contains("enable_smart") -> "normal"
                    act.contains("shuffle_off") || act.contains("disable_shuffle") || act.contains("stop_shuffle") ||
                        nm.contains("disable") || nm.contains("turn off") || nm.contains("stop shuffle") -> "normal"
                    act.contains("shuffle_on") || act.contains("enable_shuffle") || act.contains("start_shuffle") ||
                        nm.contains("enable") || nm.contains("turn on") || nm.contains("start shuffle") -> "off"
                    else -> null
                }
            }
        }

        val repeatState: String? = when (repeatVal) {
            1 -> "one"
            2, 3 -> "all"
            0 -> "off"
            else -> repeatCa?.let { ca ->
                val act = ca.action.lowercase()
                val nm = ca.name.toString().lowercase()
                when {
                    act.contains("repeat_off") || act.contains("disable_repeat") || act.contains("stop_repeat") ||
                        nm.contains("stop repeat") || nm.contains("disable repeat") -> "one"
                    act.contains("repeat_one") || nm.contains("one track") || nm.contains("repeat one") -> "all"
                    act.contains("repeat_all_on") || act.contains("repeat_on") || act.contains("enable_repeat") || act.contains("start_repeat") ||
                        nm.contains("start repeat") || nm.contains("enable repeat") -> "off"
                    else -> null
                }
            }
        }

        out.put("shuffle", shuffleState ?: JSONObject.NULL)
        out.put("repeat", repeatState ?: JSONObject.NULL)
        out.put("can_shuffle", shuffleVal != null || shuffleCa != null)
        out.put("can_repeat", repeatVal != null || repeatCa != null)

        return out
    }

    private fun readIntExtra(b1: Bundle?, b2: Bundle?, vararg keys: String): Int? {
        for (k in keys) {
            if (b1 != null && b1.containsKey(k)) return b1.getInt(k)
            if (b2 != null && b2.containsKey(k)) return b2.getInt(k)
        }
        return null
    }

    fun openSessionApp(context: Context): Boolean {
        val controller = activeController ?: return false
        val pkg = controller.packageName
        try {
            val pm = context.packageManager
            val launch = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launch)
                return true
            }
        } catch (_: Exception) {}
        return try {
            val pi = controller.sessionActivity ?: return false
            if (android.os.Build.VERSION.SDK_INT >= 34) {
                val opts = android.app.ActivityOptions.makeBasic()
                    .setPendingIntentBackgroundActivityStartMode(
                        android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    )
                pi.send(context, 0, null, null, null, null, opts.toBundle())
            } else {
                pi.send()
            }
            true
        } catch (e: Exception) {
            false
        }
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
            "shuffle" -> {
                val custom = pb?.customActions?.firstOrNull {
                    it.action.contains("shuffle", ignoreCase = true) || it.name.toString().contains("shuffle", ignoreCase = true)
                }
                if (custom != null) {
                    transport.sendCustomAction(custom, null)
                } else {
                    val nextMode = if (paramMs >= 0L) paramMs.toInt() else 1
                    val b = Bundle().apply {
                        putInt("android.support.v4.media.session.action.ARGUMENT_SHUFFLE_MODE", nextMode)
                    }
                    try {
                        controller.sendCommand("android.support.v4.media.session.command.SET_SHUFFLE_MODE", b, null)
                    } catch (e: Exception) {
                        return false
                    }
                }
                postStateUpdate()
            }
            "repeat" -> {
                val custom = pb?.customActions?.firstOrNull {
                    it.action.contains("repeat", ignoreCase = true) || it.name.toString().contains("repeat", ignoreCase = true)
                }
                if (custom != null) {
                    transport.sendCustomAction(custom, null)
                } else {
                    val nextMode = if (paramMs >= 0L) paramMs.toInt() else 2
                    val b = Bundle().apply {
                        putInt("android.support.v4.media.session.action.ARGUMENT_REPEAT_MODE", nextMode)
                    }
                    try {
                        controller.sendCommand("android.support.v4.media.session.command.SET_REPEAT_MODE", b, null)
                    } catch (e: Exception) {
                        return false
                    }
                }
                postStateUpdate()
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
        val MUSIC_ONLY_PACKAGES = SPOTIFY_PACKAGES + setOf(
            "tv.plex.labs.plexamp",
            "com.google.android.apps.youtube.music",
            "com.apple.android.music",
            "com.amazon.mp3",
            "com.aspiro.tidal",
            "deezer.android.app",
            "com.soundcloud.android",
            "com.pandora.android",
            "tunein.player"
        )
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
