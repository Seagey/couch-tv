package dev.couchtv.ontv

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.content.pm.PackageManager

class ApiError(val status: Int, message: String) : Exception(message)

/**
 * Everything the bridge does to the TV, done on the TV itself. Plain Android calls where an app is
 * allowed (open apps, volume on the TV's own speaker, the app list), loopback ADB where it is not
 * (keys in other apps, typing, power off, what is playing).
 */
object Tv {
    private lateinit var ctx: Context
    private val main = Handler(Looper.getMainLooper())
    private val audio by lazy { ctx.getSystemService(AudioManager::class.java) }
    private val power by lazy { ctx.getSystemService(PowerManager::class.java) }

    fun init(c: Context) { ctx = c.applicationContext }

    val isOn: Boolean get() = power.isInteractive

    private fun needAdb(what: String) {
        // Never pop "Allow debugging?" on the TV from a phone tap: the first connection is started
        // on purpose, from setup. After that, reconnecting is silent.
        if (!Adb.connected && (!(Adb.everAllowed || Adb.paired) || !Adb.ensure())) throw ApiError(503,
            "$what needs ADB on the TV. Open Couch TV on the TV and connect it (see the setup page).")
    }

    // ---------- keys and text ----------
    fun key(name: String, hold: Boolean = false): String {
        val code = Keys.resolve(name) ?: throw ApiError(400, "unknown key: $name")
        if (!Adb.connected && code == "KEYCODE_HOME" && startHome()) return code
        if (!Adb.connected && code in VOLUME_CODES) { volumeLocal(code); return code }
        needAdb("Pressing keys")
        Adb.quick(if (hold) "input keyevent --longpress $code" else "input keyevent $code")
        return code
    }

    fun text(s: String) {
        needAdb("Typing")
        // `input text` takes %s for a space; quote everything else for the shell.
        val arg = s.replace("%", "\\%").replace(" ", "%s").replace("'", "'\\''")
        Adb.shell("input text '$arg'", 10_000)
    }

    // ---------- apps ----------
    fun installed(): Set<String> = try {
        ctx.packageManager.getInstalledApplications(0).map { it.packageName }.toSet()
    } catch (e: Exception) { emptySet() }

    fun tvLaunchables(): List<android.content.pm.ResolveInfo> {
        val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        return ctx.packageManager.queryIntentActivities(q, 0).distinctBy { it.activityInfo.packageName }
    }

    /** Opens an app. ADB when connected (works from the background on every TV), else an intent. */
    fun launchPackage(pkg: String): String {
        val pm = ctx.packageManager
        val i = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg)
            ?: throw ApiError(404, "$pkg is not installed on the TV")
        val comp = i.component
        if (Adb.connected && comp != null) {
            val out = Adb.shell("am start -n ${comp.packageName}/${comp.className} -a android.intent.action.MAIN -f 0x10200000", 12_000)
            if (!out.contains("Error")) return "adb"
        }
        start(i)
        return "intent"
    }

    /**
     * Opens a link: an intent:// URI from JustWatch, an app scheme, or https. cold restarts the app
     * first (needs ADB). Falls back to a plain Android intent without ADB.
     */
    fun startUri(uriIn: String, pkg: String? = null, cold: Boolean = false): String {
        var uri = uriIn.replace("'", "")
        // JustWatch sometimes names an inner screen that newer app versions no longer have.
        uri = Regex("component=([^/;]+)/[^;]+").replace(uri) { "package=${it.groupValues[1]}" }
        if (Adb.connected) {
            val s = if (cold) "-S " else ""
            val out = if (uri.startsWith("intent:")) Adb.shell("am start -W $s'$uri'", 25_000)
            else Adb.shell("am start -W $s-a android.intent.action.VIEW -d '$uri'" + (pkg?.let { " -p $it" } ?: ""), 25_000)
            if (out.contains("Error")) throw ApiError(502, out.trim().lines().last().take(160))
            return "adb"
        }
        val i = if (uri.startsWith("intent:")) Intent.parseUri(uri, Intent.URI_INTENT_SCHEME)
        else Intent(Intent.ACTION_VIEW, android.net.Uri.parse(uri)).apply { pkg?.let { setPackage(it) } }
        start(i)
        return "intent"
    }

    private fun start(i: Intent) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        var err: Exception? = null
        val latch = java.util.concurrent.CountDownLatch(1)
        main.post { try { ctx.startActivity(i) } catch (e: Exception) { err = e }; latch.countDown() }
        latch.await(3, java.util.concurrent.TimeUnit.SECONDS)
        err?.let { throw ApiError(502, "the TV would not open it: ${it.message}") }
        if (!Settings.canDrawOverlays(ctx) && !App.inForeground) {
            // Android may drop activity starts from a background app. Not an error we can see.
            App.note = "Opened with a plain intent while in the background; if nothing appeared, connect ADB once in setup."
        }
    }

    /**
     * The TV's own settings. On Fire OS the plain Settings action goes through Amazon's home on its
     * way there, which the Fire TV Home watcher sends straight back, so its Settings screen is
     * opened by name.
     */
    fun openSettings() {
        val fire = android.content.ComponentName("com.amazon.tv.launcher", "com.amazon.tv.launcher.ui.MainSettingsActivity")
        start(if (FireHome.isFireTv) Intent().setComponent(fire) else Intent(Settings.ACTION_SETTINGS))
    }

    fun startHome(): Boolean = try {
        start(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)); true
    } catch (e: Exception) { false }

    /** The app on screen. Needs ADB; null without it. */
    fun frontPackage(): String? {
        if (!Adb.connected) return if (App.inForeground) BuildConfig.APPLICATION_ID else null
        return try {
            val out = Adb.shell("dumpsys activity activities | grep -m 3 -E 'topResumedActivity|mResumedActivity|ResumedActivity'", 8000)
            Regex("ActivityRecord\\{\\S+ u0 ([^/\\s]+)/").find(out)?.groupValues?.get(1)
        } catch (e: Exception) { null }
    }

    fun waitForApp(pkgs: Set<String>, timeoutMs: Long = 8000): String? {
        if (!Adb.connected) return null
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            val f = frontPackage()
            if (f != null && f in pkgs) return f
            Thread.sleep(500)
        }
        return null
    }

    // ---------- volume ----------
    private val VOLUME_CODES = setOf("KEYCODE_VOLUME_UP", "KEYCODE_VOLUME_DOWN", "KEYCODE_VOLUME_MUTE")

    fun volume(): Map<String, Any?> {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val known = !audio.isVolumeFixed && max > 0
        return mapOf("level" to if (known) audio.getStreamVolume(AudioManager.STREAM_MUSIC) else null,
            "max" to if (known) max else 0, "muted" to audio.isStreamMute(AudioManager.STREAM_MUSIC), "known" to known)
    }

    /** Volume through the TV's own audio service: works without ADB, but not for most HDMI soundbars. */
    fun volumeLocal(code: String) {
        val dir = when (code) {
            "KEYCODE_VOLUME_UP" -> AudioManager.ADJUST_RAISE
            "KEYCODE_VOLUME_DOWN" -> AudioManager.ADJUST_LOWER
            else -> AudioManager.ADJUST_TOGGLE_MUTE
        }
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI)
    }

    /** Volume keys go through ADB when it is on (so HDMI-CEC soundbars follow), else the audio service. */
    fun volumeKey(code: String) {
        if (Adb.connected) Adb.quick("input keyevent $code") else volumeLocal(code)
    }

    fun setLevel(level: Int) {
        val v = volume()
        if (v["known"] != true) throw ApiError(409, "this TV does not report a volume level, use up and down")
        val max = v["max"] as Int
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(level.coerceIn(0, 100) * max / 100f), AudioManager.FLAG_SHOW_UI)
    }

    // ---------- power ----------
    fun powerOff() {
        needAdb("Turning the TV off")
        Adb.quick("input keyevent KEYCODE_SLEEP")
        Thread.sleep(1500)
        if (power.isInteractive) Adb.quick("input keyevent KEYCODE_POWER")
    }

    /** Only works while the TV is in light standby and the app is still running. A sleeping TV cannot be woken by itself. */
    fun powerOn(): Boolean {
        if (power.isInteractive) return true
        if (!Adb.connected && (!(Adb.everAllowed || Adb.paired) || !Adb.ensure())) return false
        Adb.quick("input keyevent KEYCODE_WAKEUP")
        for (i in 0 until 12) { Thread.sleep(250); if (power.isInteractive) return true }
        return power.isInteractive
    }

    fun screenshot(): ByteArray {
        needAdb("A screenshot")
        return Adb.exec("exec:screencap -p", 20_000)
    }

    // ---------- what is playing (dumpsys media_session, same parsing as the computer bridge) ----------
    data class Session(val pkg: String, var active: Boolean = false, var state: String? = null, var position: Long? = null,
                       var updated: Long? = null, var speed: Double = 0.0, var title: String? = null, var subtitle: String? = null)

    fun sessions(): Pair<Long?, List<Session>> {
        if (!Adb.connected) return null to emptyList()
        val out = try { Adb.shell("cat /proc/uptime; dumpsys media_session", 10_000) } catch (e: Exception) { return null to emptyList() }
        val uptime = out.trim().split(Regex("\\s+")).firstOrNull()?.toDoubleOrNull()?.let { (it * 1000).toLong() }
        val found = mutableListOf<Session>()
        var cur: Session? = null
        for (raw in out.lines()) {
            val line = raw.trim()
            when {
                line.startsWith("package=") -> { cur = Session(line.substringAfter("=")); found += cur!! }
                line.startsWith("active=") && cur != null -> cur!!.active = line.endsWith("true")
                line.startsWith("state=PlaybackState") && cur != null -> {
                    cur!!.state = Regex("\\{state=([A-Z_]+)\\(").find(line)?.groupValues?.get(1)
                    cur!!.position = Regex("[ {]position=(-?\\d+)").find(line)?.groupValues?.get(1)?.toLongOrNull()
                    cur!!.updated = Regex("[ {]updated=(-?\\d+)").find(line)?.groupValues?.get(1)?.toLongOrNull()
                    cur!!.speed = Regex("speed=([-\\d.]+)").find(line)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
                }
                line.startsWith("metadata:") && line.contains("description=") && cur != null -> {
                    val parts = line.substringAfter("description=").split(", ").map { it.trim() }
                    cur!!.title = parts.getOrNull(0)?.takeIf { it != "null" && it.isNotEmpty() }
                    cur!!.subtitle = parts.getOrNull(1)?.takeIf { it != "null" && it.isNotEmpty() }
                }
            }
        }
        return uptime to found
    }

    val STATES = mapOf("PLAYING" to "playing", "PAUSED" to "paused", "BUFFERING" to "buffering", "CONNECTING" to "buffering",
        "FAST_FORWARDING" to "playing", "REWINDING" to "playing", "SKIPPING_TO_NEXT" to "buffering",
        "SKIPPING_TO_PREVIOUS" to "buffering", "SKIPPING_TO_QUEUE_ITEM" to "buffering", "STOPPED" to "stopped",
        "NONE" to "stopped", "ERROR" to "stopped")

    /** True once the app's media session says PLAYING and its position moves on. */
    fun waitUntilPlaying(pkg: String, timeoutMs: Long = 30_000): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        var first: Long? = null
        while (System.currentTimeMillis() < end) {
            Thread.sleep(1500)
            val s = sessions().second.firstOrNull { it.pkg == pkg && it.state != null }
            if (s == null || s.state != "PLAYING" || s.position == null) { first = null; continue }
            if (first == null) first = s.position else if (s.position != first) return true
        }
        return false
    }

    fun hasPackage(pkg: String) = try { ctx.packageManager.getPackageInfo(pkg, 0); true } catch (e: PackageManager.NameNotFoundException) { false }
}
