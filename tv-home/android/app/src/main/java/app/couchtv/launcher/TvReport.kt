package app.couchtv.launcher

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.DisplayMetrics
import android.view.Display
import android.content.Intent
import org.json.JSONObject

/**
 * What the TV tells Couch TV Studio when it fetches a design by code (design-code.js): its memory,
 * so the gallery's "Will it play on your TV?" can answer "I have Couch TV" from the real TV.
 * Only the total memory Android sees, in whole MB. From 0.13.13 also the kind of TV (profileJson below).
 */
object TvReport {
    const val MIN_MB = 64
    const val MAX_MB = 65536

    /** Total memory in whole MB (bytes / 1048576), or 0 when it is not a believable number. */
    fun memoryMb(totalBytes: Long): Int {
        if (totalBytes <= 0L) return 0
        val mb = totalBytes / 1048576L
        return if (mb in MIN_MB..MAX_MB) mb.toInt() else 0
    }

    /** ActivityManager.MemoryInfo.totalMem, as memoryMb; 0 if Android will not say. */
    fun memoryMb(context: Context): Int = runCatching {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        memoryMb(info.totalMem)
    }.getOrDefault(0)

    // The kind of TV (0.13.13): TVOS.tvProfile() hands design-code.js a JSON string with these keys, the TV
    // profile Couch TV Studio keeps on the My TVs row (HOME-DETAILS-PAYLOAD.md, "What the TV says about
    // itself"): platform, sdk, memMb, res and model. Same names and ranges as Couch TV Setup's profile.
    // Never a serial, an address, an Android id or anything else; the page checks each key again.
    const val GOOGLE_TV_HOME = "com.google.android.apps.tv.launcherx"
    const val FIRE_TV_HOME = "com.amazon.tv.launcher"
    const val MODEL_MAX = 40

    /** Studio's platform key, cased as Setup sends it: "Fire OS", "Google TV", "Android TV", or null. */
    fun platform(fireHome: Boolean, maker: String?, googleTvHome: Boolean, leanback: Boolean): String? = when {
        fireHome || maker.equals("Amazon", ignoreCase = true) -> "Fire OS"
        googleTvHome -> "Google TV"
        leanback -> "Android TV"
        else -> null
    }

    /** Android's API level when it is one Studio takes (1 to 99), else null. */
    fun sdk(level: Int): Int? = if (level in 1..99) level else null

    /** "1920x1080", the long side first, or null when either side is not a believable size. */
    fun res(width: Int, height: Int): String? {
        val w = maxOf(width, height)
        val h = minOf(width, height)
        return if (h >= 100 && w <= 16384) "${w}x$h" else null
    }

    /** Android's model name, control characters and angle brackets taken out, spaces tidied, at most 40 characters. */
    fun model(raw: String?): String? {
        if (raw == null) return null
        val clean = raw.map { if (it.isISOControl()) ' ' else it }.filter { it != '<' && it != '>' }.joinToString("").replace(Regex("\\s+"), " ").trim()
        return if (clean.isEmpty()) null else clean.take(MODEL_MAX).trim()
    }

    // Installed apps (TV-APPS.md): package names of the apps with a launcher icon, so Studio's editor can show
    // "On Living room TV" apps first. Names only, at most 300; nothing about what is signed in inside them.
    const val APPS_MAX = 300
    private val PKG = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+")

    /** Package names that look like Android ones, no repeats, this app left out, first 300. */
    fun cleanApps(raw: List<String>, self: String = "app.couchtv.launcher"): List<String> =
        raw.filter { it.length <= 200 && PKG.matches(it) && it != self && it != "dev.couchtv.ontv" }.distinct().take(APPS_MAX)

    /** TV launcher apps first, then ordinary launcher apps. */
    fun apps(context: Context): List<String> = runCatching {
        val pm = context.packageManager
        val names = ArrayList<String>()
        for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val q = Intent(Intent.ACTION_MAIN).addCategory(cat)
            pm.queryIntentActivities(q, 0).forEach { names.add(it.activityInfo.packageName) }
        }
        cleanApps(names, context.packageName)
    }.getOrDefault(emptyList())

    /** The keys, left out when unknown. A plain map so the unit tests need no Android. */
    fun profile(platform: String?, sdk: Int?, memMb: Int, res: String?, model: String?, apps: List<String> = emptyList()): Map<String, Any> {
        val out = LinkedHashMap<String, Any>()
        platform?.let { out["platform"] = it }
        sdk?.let { out["sdk"] = it }
        if (memMb in MIN_MB..MAX_MB) out["memMb"] = memMb
        res?.let { out["res"] = it }
        model?.let { out["model"] = it }
        cleanApps(apps).let { if (it.isNotEmpty()) out["apps"] = it }
        return out
    }

    private fun installed(context: Context, pkg: String): Boolean =
        runCatching { context.packageManager.getPackageInfo(pkg, 0); true }.getOrDefault(false)

    /** This TV's profile as a JSON string ("{}" when Android will say nothing). */
    fun profileJson(context: Context): String = runCatching {
        val pm = context.packageManager
        val leanback = runCatching { pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) }.getOrDefault(false)
        val p = platform(installed(context, FIRE_TV_HOME), Build.MANUFACTURER, installed(context, GOOGLE_TV_HOME), leanback)
        val size = runCatching {
            val dm = DisplayMetrics()
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
                .getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(dm)
            res(dm.widthPixels, dm.heightPixels)
        }.getOrNull()
        JSONObject(profile(p, sdk(Build.VERSION.SDK_INT), memoryMb(context), size, model(Build.MODEL), apps(context))).toString()
    }.getOrDefault("{}")
}
