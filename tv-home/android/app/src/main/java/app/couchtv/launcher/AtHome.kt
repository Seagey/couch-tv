package app.couchtv.launcher

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar

/**
 * What couch-tv Studio's home widgets need from Android (tv-home/web/athome.js):
 *  - a private store for the things typed at home (the note, lists, guest Wi-Fi, house guide, the
 *    calendar link), its own preferences file "athome", which backup_rules.xml and
 *    data_extraction_rules.xml leave out of every backup and device transfer;
 *  - reading the person's calendar (an https link they typed, treated as a password): plain GET, https
 *    only, no cookies, at most 3 https redirects, 4 MB, and only an answer that is a calendar;
 *  - today's screen time from Android's own usage numbers, once "usage access" is allowed (apply.sh with
 *    SCREEN_TIME=1 grants it over ADB, or the TV's own Usage access screen);
 *  - the day a photo was taken, from its EXIF block, when Home settings copies it in.
 * Nothing here talks to any server of couch-tv's.
 */
object AtHome {
    private const val MAX_BYTES = 4 * 1024 * 1024

    fun prefs(ctx: Context) = ctx.getSharedPreferences("athome", Context.MODE_PRIVATE)

    /** An https link that names no user or password: anything else is never fetched. */
    fun calendarUrlOk(url: String): Boolean {
        val u = try { URL(url) } catch (e: Exception) { return false }
        return u.protocol == "https" && !u.host.isNullOrEmpty() && u.userInfo == null && url.length <= 2000 && !url.contains(Regex("\\s"))
    }

    /** Reads the calendar. Returns (true, its words) or (false, why). Blocking: call it off the main thread. */
    fun calendar(url: String): Pair<Boolean, String> {
        if (!calendarUrlOk(url)) return Pair(false, "not a calendar link")
        var at = url
        for (hop in 0..3) {
            val c = URL(at).openConnection() as HttpURLConnection
            try {
                c.instanceFollowRedirects = false
                c.connectTimeout = 10000
                c.readTimeout = 20000
                c.useCaches = false
                c.setRequestProperty("Accept", "text/calendar, text/plain;q=0.5")
                val code = c.responseCode
                if (code in 300..399) {
                    val next = c.getHeaderField("Location") ?: return Pair(false, "http $code")
                    at = URL(URL(at), next).toString()
                    if (!calendarUrlOk(at)) return Pair(false, "redirected away from https")
                    continue
                }
                if (code !in 200..299) return Pair(false, "http $code")
                val out = ByteArrayOutputStream()
                c.inputStream.use { inp ->
                    val buf = ByteArray(16384)
                    while (true) {
                        val n = inp.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > MAX_BYTES) return Pair(false, "too big")
                    }
                }
                val text = out.toString("UTF-8")
                if (!text.take(2000).contains("BEGIN:VCALENDAR", ignoreCase = true)) return Pair(false, "not a calendar")
                return Pair(true, text)
            } catch (e: Exception) {
                return Pair(false, "unreachable")
            } finally {
                c.disconnect()
            }
        }
        return Pair(false, "too many redirects")
    }

    /** Whether this app may read usage numbers (allowed over ADB or in the TV's Usage access screen). */
    fun usageAllowed(ctx: Context): Boolean = try {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= 29) ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        else @Suppress("DEPRECATION") ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        mode == AppOpsManager.MODE_ALLOWED
    } catch (e: Exception) { false }

    /** The TV's own "Usage access" screen, where the TV has one. */
    fun usageAccessIntent(ctx: Context): Intent? {
        val i = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return if (ctx.packageManager.resolveActivity(i, 0) != null) i else null
    }

    /**
     * Time in apps today (from midnight), as {"ok":true,"minutes":N,"apps":[{"package","name","minutes"}]}
     * or {"ok":false,"why":"access"}. Counted from Android's own resume and pause events, so an app left
     * open with the screen off stops counting when the screen goes off. This home itself is not counted.
     */
    fun screenTime(ctx: Context, label: (String) -> String): String {
        if (!usageAllowed(ctx)) return JSONObject().put("ok", false).put("why", "access").toString()
        return try {
            val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val day = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
            val ev = usm.queryEvents(day, now)
            val e = UsageEvents.Event()
            val since = HashMap<String, Long>()
            val total = HashMap<String, Long>()
            val add = { pkg: String, until: Long -> since.remove(pkg)?.let { s -> total[pkg] = (total[pkg] ?: 0L) + maxOf(0L, until - s) } }
            while (ev.hasNextEvent()) {
                ev.getNextEvent(e)
                val pkg = e.packageName ?: continue
                when (e.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> if (!since.containsKey(pkg)) since[pkg] = e.timeStamp
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> add(pkg, e.timeStamp)
                    // the screen went off (Android 9 and newer): nothing is in front any more
                    15 /* SCREEN_NON_INTERACTIVE */ -> since.keys.toList().forEach { add(it, e.timeStamp) }
                }
            }
            since.keys.toList().forEach { add(it, now) }
            total.remove(ctx.packageName)
            val apps = total.entries.filter { it.value >= 60000L }.sortedByDescending { it.value }
            val list = JSONArray()
            apps.take(8).forEach { list.put(JSONObject().put("package", it.key).put("name", label(it.key)).put("minutes", (it.value / 60000L).toInt())) }
            JSONObject().put("ok", true).put("minutes", (apps.sumOf { it.value } / 60000L).toInt()).put("apps", list).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("why", "error").toString()
        }
    }

    /** "-t20231118" for a photo taken on 18 November 2023, from "2023:11:18 07:12:44"; "" when unknown. */
    fun takenNote(exifDate: String?): String {
        val m = Regex("^(\\d{4}):(\\d{2}):(\\d{2})").find(exifDate ?: "") ?: return ""
        val (y, mo, d) = m.destructured
        val year = y.toInt()
        if (year < 1900 || mo.toInt() !in 1..12 || d.toInt() !in 1..31) return ""
        return "-t$y$mo$d"
    }
}
