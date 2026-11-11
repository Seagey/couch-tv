package dev.couchtv.ontv

import android.util.Log

/**
 * Google TV voice search with Google's home switched off. The Assistant itself (com.google.android.katniss)
 * listens and answers, but many of its results ("Panchayat", "action movies", a show or actor page)
 * are screens inside Google's home package (launcherx's EntityActivity and deep links). With that
 * package off they silently fail to open, so a voice search seemed to do nothing.
 *
 * So while the Assistant is in use, Google's home package is switched back on, and once the results
 * are left (or its home tries to take the screen) it is switched off again by GoogleHome. This app
 * stays the home throughout: if Google's home screen itself comes forward, this one is put back.
 *
 * It sees the Assistant start from its own log lines over the TV's own ADB (the same follow FireHome
 * uses on Fire TV), so it works from the mic button anywhere, inside any app too. Only on Google TV
 * with "Use as home screen" on, and only when GoogleHome keeps Google's home off.
 */
object Voice {
    private const val TAG = "couchtv.voice"
    const val ASSISTANT = "com.google.android.katniss"
    private val LAUNCHERX = GoogleHome.HOMES[0]
    private const val LISTEN = "shell:logcat -T1 -v brief ActivityTaskManager:I katniss_interactor_VoicePlateActivity:I " +
        "katniss_interactor_KatnissVoiceInteractionUtilsImpl:I '*:S'"
    private const val HOLD_MS = 45_000L     // Google's home stays on this long after results were last on screen
    private const val AFTER_MS = 15_000L    // ... and this long once something else is in front
    private val lock = Any()
    @Volatile private var watching = false
    @Volatile private var following = false
    @Volatile private var until = 0L

    /** GoogleHome leaves Google's home on while this is true. */
    val active: Boolean get() = System.currentTimeMillis() < until

    private val wanted: Boolean
        get() = !FireHome.isFireTv && App.homeEnabled(App.instance) && GoogleHome.keepsOff(LAUNCHERX) && Tv.hasPackage(ASSISTANT)

    /** Starts the log watch once; cheap to call often (service start, every ADB connect). */
    fun start() {
        if (!wanted || !(Adb.everAllowed || Adb.paired)) return
        synchronized(lock) { if (watching) return; watching = true }
        Thread({ watch() }, "voice").start()
    }

    /** The Assistant is on screen (or about to be): switch Google's home on for its results. */
    fun started(why: String) {
        if (!wanted) return
        val first = !active
        until = System.currentTimeMillis() + HOLD_MS
        if (!first) return
        Log.i(TAG, "assistant opened ($why): switching Google's home on for its results")
        Thread({
            runCatching { Adb.shell("pm enable $LAUNCHERX", 8_000) }.onFailure { Log.w(TAG, "enable: ${it.message}") }
            follow()
        }, "voice-follow").start()
    }

    /** While Google's home is on: keep it on while the Assistant or its results are in front. */
    private fun follow() {
        synchronized(lock) { if (following) return; following = true }
        try {
            while (active) {
                Thread.sleep(1_000)
                val front = frontActivity() ?: continue
                val now = System.currentTimeMillis()
                when {
                    // The Assistant, or Google's home showing its results (they are pages of its one
                    // main screen): keep it on while it is in front. The Home key is caught in watch().
                    front.startsWith("$LAUNCHERX/") || front.startsWith("$ASSISTANT/") -> until = now + HOLD_MS
                    else -> if (until - now > AFTER_MS) until = now + AFTER_MS
                }
            }
        } finally {
            synchronized(lock) { following = false }
            Log.i(TAG, "assistant done: switching Google's home off again")
            GoogleHome.poke()
        }
    }

    private fun frontActivity(): String? = try {
        val out = Adb.shell("dumpsys activity activities | grep -m 1 -E 'mResumedActivity|topResumedActivity'", 6_000)
        Regex("u0 (\\S+/\\S+)").find(out)?.groupValues?.get(1)
    } catch (e: Exception) { null }

    private fun watch() {
        try {
            while (wanted) {
                if (!Adb.connected && !runCatching { Adb.ensure() }.getOrDefault(false)) { Thread.sleep(15_000); continue }
                try {
                    Adb.stream(LISTEN).openInputStream().bufferedReader().use { r ->
                        while (wanted) {
                            val line = r.readLine() ?: break
                            // The Home key while Google's home is on for voice: it starts Google's home
                            // by the HOME category (its own result pages start it without). Put this one back.
                            if ("START u0" in line && "android.intent.category.HOME" in line && active) {
                                Log.i(TAG, "Home key during voice search: back to this home")
                                until = 0
                                App.openHome()
                                continue
                            }
                            if (("VoicePlateActivity" in line && ("onStart" in line || "#setup" in line)) ||
                                "launchVoiceInteraction" in line ||
                                ("START u0" in line && "cmp=$ASSISTANT/" in line)) started("log")
                        }
                    }
                } catch (e: Exception) { Log.w(TAG, "watch: ${e.message}") }
                Thread.sleep(3_000)
            }
        } finally {
            synchronized(lock) { watching = false }
        }
    }
}
