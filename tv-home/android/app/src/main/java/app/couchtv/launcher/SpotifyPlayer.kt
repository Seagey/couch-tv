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

/**
 * The song playing on this TV, from Android's media sessions (Now playing with no computer). Spotify first, else any other app with a
 * song playing or paused (lane D, 28 Nov 2026: "any music app", not only Spotify). Needs notification access for [SpotifySessionAccess],
 * which Couch TV Setup grants from the computer (cmd notification allow_listener). Local only: no account, no network.
 */
internal class SpotifyPlayer(context: Context) {
    private val app = context.applicationContext
    private val media = context.getSystemService(MediaSessionManager::class.java)
    private val listener = ComponentName(context, SpotifySessionAccess::class.java)

    private fun sessions(): List<MediaController>? = try {
        media?.getActiveSessions(listener)
    } catch (_: SecurityException) {
        null
    }

    /** Spotify's session, else the first other app's that has a song playing or paused (never Couch TV's own). */
    private fun controller(): MediaController? {
        val all = sessions() ?: return null
        return all.firstOrNull { it.packageName == PACKAGE } ?: pick(all.map { Session(it.packageName, it.playbackState?.state ?: PlaybackState.STATE_NONE) })
            ?.let { p -> all.firstOrNull { it.packageName == p } }
    }

    /** Whether this TV has given Couch TV the media session access (the page then shows Now playing for any music app). */
    fun access(): Boolean = sessions() != null

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
            val pkg = session.packageName
            put("source", if (pkg == PACKAGE) "spotify-tv" else "tv")
            put("app", JSONObject().put("name", if (pkg == PACKAGE) "Spotify" else label(pkg)).put("package", pkg))
        }
    }

    private fun label(pkg: String): String = runCatching {
        app.packageManager.getApplicationLabel(app.packageManager.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg.substringAfterLast('.'))

    /** One session as the pick sees it: its app and its PlaybackState state. */
    data class Session(val pkg: String, val state: Int)

    companion object {
        const val PACKAGE = "com.spotify.tv.android"
        private val OWN = setOf("app.couchtv.launcher", "dev.couchtv.ontv")

        /** Which app's song to show when Spotify has none: the first playing, else the first paused; never Couch TV's own. */
        fun pick(all: List<Session>): String? {
            val others = all.filter { it.pkg !in OWN }
            return (others.firstOrNull { it.state == PlaybackState.STATE_PLAYING } ?: others.firstOrNull { it.state == PlaybackState.STATE_PAUSED })?.pkg
        }
    }
}
