package dev.couchtv.sync

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Commands by ADB broadcast, answers as JSON in the broadcast's result data (`am broadcast` prints
 * it as data="..."):
 *
 *   am broadcast -a dev.couchtv.sync.CMD -n dev.couchtv.sync/.CmdReceiver --es op state --es pkg <package>
 *
 * Extras are all strings. op is one of:
 *   ping                          the TV's elapsedRealtime
 *   state    pkg                  that app's PlaybackState and what it advertises
 *   pause | play   pkg            [at_elapsed_ms]
 *   seek     pkg pos_ms           [at_elapsed_ms]
 *   speed    pkg x                [at_elapsed_ms]   (Android 10 and newer)
 *   last     [id]                 the report of a scheduled command, once it has fired
 * With at_elapsed_ms (this TV's own SystemClock.elapsedRealtime, fractions allowed) the command is
 * armed and the reply says "scheduled" with an id; a dedicated thread waits (sleep, then spin for
 * the last ~15 ms) and calls the controller at that moment. `last` returns when it actually fired.
 */
class CmdReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val out = try { handle(ctx, intent) } catch (e: Exception) {
            JSONObject().put("error", e.javaClass.simpleName + ": " + e.message)
        }
        out.put("elapsed_ms", SystemClock.elapsedRealtimeNanos() / 1e6)
        setResultData(out.toString())
    }

    private fun handle(ctx: Context, i: Intent): JSONObject {
        val op = i.getStringExtra("op") ?: return JSONObject().put("error", "no op")
        val pkg = i.getStringExtra("pkg")
        if (op == "ping") return JSONObject().put("sdk", Build.VERSION.SDK_INT)
        if (op == "last") {
            val id = i.getStringExtra("id")?.toIntOrNull() ?: lastId.get()
            return reports[id] ?: JSONObject().put("error", "not fired yet or unknown id").put("id", id)
        }
        if (op == "sessions") return sessionsJson(ctx)
        if (pkg == null) return JSONObject().put("error", "no pkg")
        val c = controller(ctx, pkg) ?: return JSONObject().put("error", "no media session for $pkg (is the listener granted, and is the app playing?)")
        if (op == "state") return stateJson(c)

        val tc = c.transportControls
        val pos = i.getStringExtra("pos_ms")?.toDoubleOrNull()?.toLong()
        val x = i.getStringExtra("x")?.toFloatOrNull()
        val action: () -> String = when (op) {
            "pause" -> fun(): String { tc.pause(); return "ok" }
            "play" -> fun(): String { tc.play(); return "ok" }
            "seek" -> {
                if (pos == null) return JSONObject().put("error", "no pos_ms")
                fun(): String { tc.seekTo(pos); return "ok" }
            }
            "speed" -> {
                if (x == null) return JSONObject().put("error", "no x")
                if (Build.VERSION.SDK_INT < 29) return JSONObject().put("error", "setPlaybackSpeed needs Android 10")
                fun(): String { tc.setPlaybackSpeed(x); return "ok" }
            }
            else -> return JSONObject().put("error", "unknown op $op")
        }
        val at = i.getStringExtra("at_elapsed_ms")?.toDoubleOrNull()
        val id = nextId.incrementAndGet()
        lastId.set(id)
        if (at == null) return fire(id, op, null, action)
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
            val target = (at * 1e6).toLong()
            while (true) {
                val left = target - SystemClock.elapsedRealtimeNanos()
                if (left <= 0) break
                if (left > 20_000_000L) Thread.sleep((left - 15_000_000L) / 1_000_000L) // then spin the last ~15 ms
            }
            fire(id, op, at, action)
        }, "fire-$id").start()
        return JSONObject().put("scheduled", true).put("id", id).put("at_elapsed_ms", at)
    }

    /** Runs the controller call now, writes the report. */
    private fun fire(id: Int, op: String, want: Double?, action: () -> String): JSONObject {
        val t0 = SystemClock.elapsedRealtimeNanos()
        val result = try { action() } catch (e: Exception) { "error " + e.message }
        val t1 = SystemClock.elapsedRealtimeNanos()
        val r = JSONObject().put("id", id).put("op", op).put("result", result)
            .put("fired_ms", t0 / 1e6).put("call_ms", (t1 - t0) / 1e6)
        if (want != null) r.put("want_ms", want).put("late_ms", t0 / 1e6 - want)
        reports[id] = r
        Log.i(TAG, "fired $r")
        return r
    }

    companion object {
        const val TAG = "couchtvsync"
        private val nextId = AtomicInteger(0)
        private val lastId = AtomicInteger(0)
        private val reports = ConcurrentHashMap<Int, JSONObject>()

        const val ACTION_SEEK_TO = 256L
        const val ACTION_SET_PLAYBACK_SPEED = 1L shl 18   // PlaybackState.ACTION_SET_PLAYBACK_SPEED, Android 10

        fun manager(ctx: Context) = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager

        fun sessions(ctx: Context): List<MediaController> =
            manager(ctx).getActiveSessions(ComponentName(ctx, Listener::class.java))

        /** The app's session that is doing something (playing, buffering, paused) first. */
        fun controller(ctx: Context, pkg: String): MediaController? =
            sessions(ctx).filter { it.packageName == pkg }.minByOrNull {
                when (it.playbackState?.state) {
                    PlaybackState.STATE_PLAYING, PlaybackState.STATE_BUFFERING -> 0
                    PlaybackState.STATE_PAUSED -> 1
                    else -> 2
                }
            }

        fun sessionsJson(ctx: Context): JSONObject {
            val a = JSONArray()
            for (c in sessions(ctx)) a.put(JSONObject().put("pkg", c.packageName).put("state", c.playbackState?.state ?: -1))
            return JSONObject().put("sessions", a)
        }

        fun stateJson(c: MediaController): JSONObject {
            val s = c.playbackState ?: return JSONObject().put("pkg", c.packageName).put("state", -1).put("error", "no playback state")
            val now = SystemClock.elapsedRealtime()
            val playing = s.state == PlaybackState.STATE_PLAYING
            val pos = s.position + if (playing) ((now - s.lastPositionUpdateTime) * s.playbackSpeed).toLong() else 0L
            return JSONObject().put("pkg", c.packageName)
                .put("state", s.state)
                .put("position", s.position)
                .put("last_update", s.lastPositionUpdateTime)   // SystemClock.elapsedRealtime base
                .put("speed", s.playbackSpeed.toDouble())
                .put("buffered", s.bufferedPosition)
                .put("actions", s.actions)
                .put("can_seek", s.actions and ACTION_SEEK_TO != 0L)
                .put("can_speed", s.actions and ACTION_SET_PLAYBACK_SPEED != 0L)
                .put("position_now", pos)
                .put("duration", c.metadata?.getLong(android.media.MediaMetadata.METADATA_KEY_DURATION) ?: -1L)
        }
    }
}
