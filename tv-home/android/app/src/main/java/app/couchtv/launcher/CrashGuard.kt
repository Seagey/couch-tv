package app.couchtv.launcher

import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * A home screen that crashes as it opens must never hold the TV in a loop. Two things are written
 * down, synchronously, so they survive the process dying:
 *
 * - every start of the home that never settled (ran for SETTLE_MS without dying). This catches any
 *   kind of crash at start, including native ones and the WebView's own crash handler, which ends
 *   the process before a Java handler further down the chain runs;
 * - every uncaught Java exception, at any time.
 *
 * Two of either within a few minutes and couch-tv stands aside: the home opens the TV's own home
 * screen instead of itself, and the Home button watch stops bringing couch-tv back, until the
 * last one is ASIDE_MS old. Then it tries again by itself.
 *
 * The TV's own home stays installed and switched on (apply.sh never switches it off), so there is
 * always one to stand aside to.
 */
object CrashGuard {
    private const val PREFS = "crash_guard"
    private const val WINDOW_MS = 3 * 60_000L      // two crashes or unsettled starts within this ...
    private const val ASIDE_MS = 5 * 60_000L       // ... and couch-tv stands aside this long after the last
    const val SETTLE_MS = 20_000L                  // a start that runs this long counts as healthy
    private const val LIMIT = 2

    @Volatile private var recorded = false   // one crash is one record, however many recorders are in the chain

    private class Recorder(val app: Context, val before: Thread.UncaughtExceptionHandler?) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(t: Thread, e: Throwable) {
            if (!recorded) {
                recorded = true
                runCatching { add(app, "crashes") }
            }
            before?.uncaughtException(t, e)
        }
    }

    /**
     * Puts the crash recorder first in line. Called again after the WebView starts, because the
     * WebView puts its own handler in front, and that one ends the process straight away.
     */
    fun install(c: Context) {
        val current = Thread.getDefaultUncaughtExceptionHandler()
        if (current is Recorder) return
        Thread.setDefaultUncaughtExceptionHandler(Recorder(c.applicationContext, current))
    }

    /** A fresh try: apply.sh sent new settings, or a new version of the app was installed. */
    fun reset(c: Context) {
        runCatching { prefs(c).edit().remove("starts").remove("crashes").commit() }
    }

    /** The home is starting fresh: written down until settled() says it lived. */
    fun started(c: Context) { runCatching { add(c, "starts") } }

    /** The home has run SETTLE_MS without dying: its start was a good one. */
    fun settled(c: Context) {
        runCatching { prefs(c).edit().remove("starts").apply() }
    }

    /** True while couch-tv has crashed too often lately, so the TV's own home should be on screen. */
    fun standingAside(c: Context): Boolean = runCatching {
        val now = System.currentTimeMillis()
        listOf("crashes", "starts").any { key ->
            val recent = times(prefs(c).getString(key, "")).filter { it <= now && now - it < WINDOW_MS + ASIDE_MS }
            val burst = recent.filter { t -> recent.count { kotlin.math.abs(it - t) < WINDOW_MS } >= LIMIT }
            burst.size >= LIMIT && now - (burst.maxOrNull() ?: 0L) < ASIDE_MS
        }
    }.getOrDefault(false)

    /**
     * Opens the TV's own home screen (Google TV, Android TV, Fire TV or a maker's own), never this
     * app. False when the TV has no other home, then the caller carries on as the home.
     */
    fun openStockHome(c: Context): Boolean {
        val homes = runCatching {
            c.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)
        }.getOrDefault(emptyList())
            .map { it.activityInfo }
            .filter { it.packageName != c.packageName && !it.name.endsWith("FallbackHome") &&
                !it.name.endsWith("RecoveryActivity") && !it.name.endsWith("ResolverActivity") }
        val pick = homes.firstOrNull { it.packageName == FireWatch.GOOGLE_TV_HOME }
            ?: homes.firstOrNull { it.packageName == FireWatch.ANDROID_TV_HOME }
            ?: homes.firstOrNull { it.packageName == FireWatch.AMAZON_HOME }
            ?: homes.firstOrNull()
            ?: run { Log.w("couchtv.guard", "couch-tv keeps crashing, but the TV has no other home to hand over to"); return false }
        return runCatching {
            c.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                .setClassName(pick.packageName, pick.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            Log.w("couchtv.guard", "couch-tv crashed twice lately: the TV's own home (${pick.packageName}) is on screen for a few minutes")
            true
        }.getOrDefault(false)
    }

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun add(c: Context, key: String) {
        val now = System.currentTimeMillis()
        // Fire OS starts about 12 days behind until network time syncs: a stamp from the future was
        // written before the clock jumped forward (issue #44) and tells nothing, so it is dropped.
        val kept = times(prefs(c).getString(key, "")).filter { it <= now && now - it < WINDOW_MS + ASIDE_MS } + now
        prefs(c).edit().putString(key, kept.takeLast(6).joinToString(",")).commit()
    }

    private fun times(s: String?) = s.orEmpty().split(',').mapNotNull { it.toLongOrNull() }
}
