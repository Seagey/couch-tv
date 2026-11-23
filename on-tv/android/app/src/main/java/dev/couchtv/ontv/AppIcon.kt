package dev.couchtv.ontv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.util.DisplayMetrics
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * An installed app's icon as a PNG for the phone page's apps card ("Widgets on your screen", setup.html):
 * GET /api/appicon/<package>, paired phones only. Drawn at 192 px from the app's sharpest icon, the same
 * way the home draws its dock icons (HomeActivity.iconImage). Only an app that is installed; null otherwise.
 */
object AppIcon {
    private val cache = ConcurrentHashMap<String, ByteArray>()
    private val PKG = Regex("[A-Za-z0-9_.]{3,120}")

    fun png(ctx: Context, pkg: String): ByteArray? {
        if (!PKG.matches(pkg)) return null
        cache[pkg]?.let { return it }
        val pm = ctx.packageManager
        val d = try {
            val info = pm.getApplicationInfo(pkg, 0)
            (if (info.icon != 0) runCatching { pm.getResourcesForApplication(pkg).getDrawableForDensity(info.icon, DisplayMetrics.DENSITY_XXXHIGH, null) }.getOrNull() else null)
                ?: pm.getApplicationIcon(pkg)
        } catch (e: Exception) { return null }
        val n = 192
        val bmp = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888)
        val adaptive = android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && d is AdaptiveIconDrawable
        val iw = d.intrinsicWidth; val ih = d.intrinsicHeight
        if (!adaptive && iw > 0 && ih > 0 && iw != ih) {
            val w = if (iw > ih) n else (n * iw / ih).coerceAtLeast(1)
            val h = if (ih > iw) n else (n * ih / iw).coerceAtLeast(1)
            d.setBounds((n - w) / 2, (n - h) / 2, (n + w) / 2, (n + h) / 2)
        } else d.setBounds(0, 0, n, n)
        d.draw(Canvas(bmp))
        val bytes = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.PNG, 100, it); bmp.recycle() }.toByteArray()
        if (cache.size < 200) cache[pkg] = bytes
        return bytes
    }
}
