package dev.couchtv.ontv

import android.app.ActivityManager
import android.content.Context

/**
 * What the TV tells Couch TV Studio when it fetches a design by code (tv-home/web/design-code.js):
 * its memory, so the gallery's "Will it play on your TV?" can answer "I have Couch TV" from the real
 * TV. Only the total memory Android sees, in whole MB. Nothing else about the TV (no ids, no model).
 * The same rules as the TV home app's TvReport.
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
}
