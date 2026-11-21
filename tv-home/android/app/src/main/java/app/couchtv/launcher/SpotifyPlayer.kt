package app.couchtv.launcher

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.service.notification.NotificationListenerService
import org.json.JSONObject

/** The Android grant authorizes media session access. This service has no notification callbacks. */
class SpotifySessionAccess : NotificationListenerService()

internal class SpotifyPlayer(context: Context) {
    private val media = context.getSystemService(MediaSessionManager::class.java)
    private val listener = ComponentName(context, SpotifySessionAccess::class.java)

    private fun controller(): MediaController? = try {
        media?.getActiveSessions(listener)?.firstOrNull { it.packageName == PACKAGE }
    } catch (_: SecurityException) {
        null
    }

    fun current(): String {
        return runCatching { controller()?.let { snapshot(it).toString() } ?: "{}" }.getOrDefault("{}")
    }

    fun key(command: String): Boolean {
        return runCatching {
            val session = controller() ?: return false
            val transport = session.transportControls
            when (command) {
                "previous" -> transport.skipToPrevious()
                "next" -> transport.skipToNext()
                "play_pause" -> if (session.playbackState?.state == PlaybackState.STATE_PLAYING) transport.pause() else transport.play()
                else -> return false
            }
            true
        }.getOrDefault(false)
    }

    private fun snapshot(session: MediaController): JSONObject {
        val state = session.playbackState ?: return JSONObject()
        if (state.state != PlaybackState.STATE_PLAYING && state.state != PlaybackState.STATE_PAUSED) return JSONObject()
        val metadata = session.metadata ?: return JSONObject()
        val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE) ?: metadata.description.title?.toString()
        if (title.isNullOrBlank()) return JSONObject()
        val art = listOf(MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
            MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI).mapNotNull(metadata::getString).firstOrNull { it.startsWith("https://") }
        return JSONObject().apply {
            put("title", title)
            put("artist", metadata.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: metadata.description.subtitle?.toString().orEmpty())
            put("art", art)
            put("state", if (state.state == PlaybackState.STATE_PLAYING) "playing" else "paused")
            put("pos", state.position.coerceAtLeast(0L) / 1000.0)
            put("dur", metadata.getLong(MediaMetadata.METADATA_KEY_DURATION) / 1000.0)
            put("source", "spotify-tv")
            put("app", JSONObject().put("name", "Spotify").put("package", PACKAGE))
        }
    }

    companion object {
        const val PACKAGE = "com.spotify.tv.android"
    }
}
