package dev.couchtv.ontv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Google TV and Android TV: keeps Google's own home switched off while this app is the home screen,
 * so nobody has to run a command again after a Google TV update switches it back on. The on-TV
 * twin of the computer bridge's daily keep-disabled check (bridge/server.py, keep_disabled_loop).
 *
 * It only ever touches a Google home package it has seen switched off on this TV while
 * "Use as home screen" was on (the one setup switched off with `pm disable-user`). Those are
 * remembered, and switched off again over the TV's own ADB if they come back on. It checks when
 * the service starts (every boot), when ADB connects, when one of those packages is updated or
 * changed, and every 6 hours; with ADB not ready it tries again every 15 minutes.
 *
 * Turning "Use as home screen" off stops it and forgets the list, so the undo (switch the Google
 * home back on, then remove this app) is never fought. Fire TV is left to FireHome.
 */
object GoogleHome {
    private const val TAG = "couchtv.googlehome"
    private const val KEY = "home_kept_off"
    val HOMES = listOf("com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher")
    // Google TV's setup wizard also answers the Home key, at a higher priority than any app (seen on
    // a Sony BRAVIA, Android 14), so with the Google home off it takes Home unless it is off too.
    const val WIZARD = "com.google.android.tungsten.setupwraith"
    private val WATCHED = HOMES + WIZARD
    private const val EVERY_MS = 6L * 3600_000
    private const val RETRY_MS = 15L * 60_000

    private val wake = LinkedBlockingQueue<Unit>()
    @Volatile private var started = false
    @Volatile var lastCheck: Long? = null; private set
    @Volatile var lastResult: String? = null; private set

    private val wanted: Boolean get() = !FireHome.isFireTv && App.homeEnabled(App.instance)

    fun status(): Map<String, Any?> = mapOf(
        "on" to wanted, "kept_off" to keptOff().toList(), "last_check" to lastCheck, "last" to lastResult,
    )

    /** Starts the check loop once, and listens for the Google home being updated or switched on. */
    fun start(c: Context) {
        synchronized(this) { if (started) return; started = true }
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_CHANGED); addAction(Intent.ACTION_PACKAGE_REPLACED); addAction(Intent.ACTION_PACKAGE_ADDED)
            addDataScheme("package")
        }
        val r = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, i: Intent) { if (i.data?.schemeSpecificPart in WATCHED) poke() }
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) c.registerReceiver(r, f, Context.RECEIVER_EXPORTED) else c.registerReceiver(r, f)
        }.onFailure { Log.w(TAG, "could not listen for package changes: ${it.message}") }
        Thread({ loop() }, "googlehome").start()
    }

    /** Check now (cheap; the loop does the work). */
    fun poke() { wake.offer(Unit) }

    private fun loop() {
        while (true) {
            val ok = runCatching { check() }.onFailure { lastResult = "error: ${it.message}"; Log.w(TAG, "check", it) }.getOrDefault(false)
            runCatching { wake.poll(if (ok) EVERY_MS else RETRY_MS, TimeUnit.MILLISECONDS) }
            Thread.sleep(2_000)   // a burst of package broadcasts makes one check
            wake.clear()
        }
    }

    private fun keptOff(): Set<String> = Store.str(KEY)?.split(',')?.filter { it in WATCHED }?.toSet() ?: emptySet()

    /** This TV keeps that package off (Voice switches it on only for the Assistant's results). */
    fun keepsOff(pkg: String): Boolean = wanted && (pkg in keptOff() || isOff(pkg) == true)

    /** null: not installed. */
    private fun isOff(pkg: String): Boolean? = try {
        val s = App.instance.packageManager.getApplicationEnabledSetting(pkg)
        s == PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER || s == PackageManager.COMPONENT_ENABLED_STATE_DISABLED
    } catch (e: IllegalArgumentException) { null }

    /** true when nothing is left to do; false to try again soon. */
    private fun check(): Boolean {
        lastCheck = System.currentTimeMillis()
        if (!wanted) {
            if (Store.str(KEY) != null) Store.putStr(KEY, null)
            lastResult = "off (not the home screen)"
            return true
        }
        // Remember every Google home that is switched off while this app is the home.
        val kept = keptOff() + WATCHED.filter { isOff(it) == true }
        if (kept != keptOff()) Store.putStr(KEY, kept.joinToString(","))
        Voice.start()
        // Google's home is left on while the Assistant's results need it (Voice switches it back off)
        val back = kept.filter { isOff(it) == false && !(it == HOMES[0] && Voice.active) }
        if (back.isEmpty()) { lastResult = "ok: ${kept.joinToString().ifEmpty { "nothing to keep off" }}" + if (Voice.active) " (on for voice search)" else ""; return true }

        Log.w(TAG, "switched back on: $back")
        if (!(Adb.everAllowed || Adb.paired) || !Adb.ensure()) { lastResult = "waiting for ADB to switch off $back"; return false }
        for (pkg in back) {
            val out = Adb.shell("pm disable-user --user 0 $pkg", 15_000).trim()
            Log.w(TAG, "re-disabled $pkg: $out")
        }
        runCatching { Adb.shell("cmd package set-home-activity ${BuildConfig.APPLICATION_ID}/.HomeAlias", 8_000) }
        // If Google's home is on screen right now, put this one back.
        runCatching { if (Tv.frontPackage() in WATCHED) App.openHome() }
        val still = back.filter { isOff(it) == false }
        lastResult = if (still.isEmpty()) "re-disabled ${back.joinToString()}" else "could not switch off $still"
        return still.isEmpty()
    }
}
