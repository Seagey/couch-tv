package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * What is on the TV now, in the same shape as the computer bridge's GET /api/now, and the push
 * to everyone listening (server-sent events and WebSockets).
 */
object Now {
    @Volatile private var whoNow: String? = null
    @Volatile private var whoRead = false
    /** Who is on the couch at this TV, saved so a restart keeps it. */
    var who: String?
        get() { if (!whoRead) { whoNow = Store.who(); whoRead = true }; return whoNow }
        set(v) { whoNow = v; whoRead = true; Store.saveWho(v) }
    @Volatile var playedItem: JSONObject? = null          // the last thing /api/play started
    @Volatile var sleepEnds: Long? = null
    @Volatile var idleEnds: Long? = null
    @Volatile private var pausedSince: Long? = null
    @Volatile private var pausedPkg: String? = null
    @Volatile private var snoozedUntil: Long = 0L
    @Volatile private var front: String? = null
    @Volatile private var media: JSONObject? = null
    @Volatile private var lastSig = ""
    // Keep watching from what the apps say is playing (see remember())
    private var seenKey = ""
    private var seenSince = 0L
    private var seenLast = 0L   // the last reading that still showed seenKey playing
    private var emptyReads = 0  // readings in a row with nothing playing since then
    private var keptKey = ""

    private val listeners = CopyOnWriteArraySet<(String) -> Unit>()
    private val loop = Executors.newSingleThreadScheduledExecutor()
    private var started = false

    fun listen(fn: (String) -> Unit) = listeners.add(fn)
    fun unlisten(fn: (String) -> Unit) = listeners.remove(fn)

    fun iso(t: Long = System.currentTimeMillis()): String =
        // "XXX" (a +11:00 offset) needs Android 7; Android 6 has "Z" (+1100), so put the colon in by hand
        if (android.os.Build.VERSION.SDK_INT >= 24) SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(Date(t))
        else SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date(t)).let { it.substring(0, it.length - 2) + ":" + it.substring(it.length - 2) }

    fun payload(): JSONObject {
        val p = media
        return JSONObject()
            .put("ok", true)
            .put("tv_connected", true)                      // the server is on the TV: if it answers, the TV is there
            .put("power", if (Tv.isOn) "on" else "off")
            .put("app", Apps.describe(front)?.let { JSONObject(it) } ?: JSONObject.NULL)
            .put("volume", JSONObject(Tv.volume()))
            .put("playing", p ?: JSONObject.NULL)
            .put("sleep", JSONObject().put("ends", sleepEnds?.let { iso(it) } ?: JSONObject.NULL))
            .put("idle", idleEnds?.let { JSONObject().put("ends", iso(it)).put("reason", "paused") } ?: JSONObject.NULL)
            .put("waking", false)
            .put("who", who ?: JSONObject.NULL)
            .put("picture", JSONObject.NULL)
            .put("mode", "on-tv")
            .put("adb", Adb.connected)
    }

    /** Sends the current state to every listener. */
    fun push() {
        val msg = payload().toString()
        listeners.forEach { runCatching { it(msg) } }
    }

    /** Every 4 s: front app, power, volume. Every 8 s while an app is in front: what it says is playing. */
    @Synchronized fun start() {
        if (started) return
        started = true
        var tick = 0
        loop.scheduleWithFixedDelay({
            try {
                tick++
                if (!Adb.connected && (Adb.everAllowed || Adb.paired) && tick % 15 == 1) runCatching { Adb.ensure() }
                front = Tv.frontPackage()
                if (tick % 2 == 0) { media = readMedia(); remember(media) }
                stepPausedIdle(media)
                val v = Tv.volume()
                val sig = listOf(front, Tv.isOn, v["level"], v["muted"], media?.optString("title"), media?.optString("state"),
                    sleepEnds, idleEnds, who, Adb.connected).joinToString("|")
                if (sig != lastSig) { lastSig = sig; push() }
            } catch (e: Exception) { android.util.Log.w("couchtv", "now loop: ${e.message}") }
        }, 1, 4, TimeUnit.SECONDS)
    }

    fun resetPausedIdle() {
        val had = idleEnds != null
        pausedSince = null; pausedPkg = null; idleEnds = null
        if (had) push()
    }

    fun cancelPausedIdle() {
        val cfg = Store.smartIdle()
        val qh = cfg.optJSONObject("quiet_hours")
        val mins = if (qh != null && inQuietHours(qh)) qh.optInt("idle_minutes", 15) else cfg.optInt("paused_idle_minutes", 30)
        snoozedUntil = System.currentTimeMillis() + maxOf(300, mins * 60) * 1000L
        resetPausedIdle()
    }

    private fun inQuietHours(qh: JSONObject): Boolean {
        if (!qh.optBoolean("enabled", false)) return false
        val tzId = Store.weather().optString("timezone", "auto")
        val tz = if (tzId.isNotEmpty() && tzId != "auto") java.util.TimeZone.getTimeZone(tzId) else java.util.TimeZone.getDefault()
        val cal = java.util.Calendar.getInstance(tz)
        val cur = cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
        fun mins(s: String, def: Int) = Regex("([01]\\d|2[0-3]):([0-5]\\d)").matchEntire(s.trim())
            ?.let { it.groupValues[1].toInt() * 60 + it.groupValues[2].toInt() } ?: def
        val start = mins(qh.optString("start", "23:00"), 23 * 60)
        val end = mins(qh.optString("end", "06:00"), 6 * 60)
        if (start == end) return true
        return if (start < end) cur in start until end else (cur >= start || cur < end)
    }

    private fun stepPausedIdle(m: JSONObject?) {
        val cfg = Store.smartIdle()
        val pkg = front
        val now = System.currentTimeMillis()
        if (!cfg.optBoolean("enabled", false) || !Tv.isOn || pkg == null || m?.optString("state") != "paused") {
            if (pausedSince != null || idleEnds != null) { pausedSince = null; pausedPkg = null; idleEnds = null }
            return
        }
        if (now < snoozedUntil) return
        val qh = cfg.optJSONObject("quiet_hours")
        val mins = if (qh != null && inQuietHours(qh)) qh.optInt("idle_minutes", 15) else cfg.optInt("paused_idle_minutes", 30)
        if (mins <= 0) {
            if (pausedSince != null || idleEnds != null) { pausedSince = null; pausedPkg = null; idleEnds = null }
            return
        }
        if (pausedSince == null || pausedPkg != pkg) { pausedSince = now; pausedPkg = pkg }
        val deadline = pausedSince!! + mins * 60_000L
        idleEnds = if (deadline - now <= 300_000L) deadline else null
        if (now < deadline) return
        android.util.Log.i("couchtv", "smart idle: $pkg paused for $mins min, turning TV off")
        pausedSince = null; pausedPkg = null; idleEnds = null
        if (sleepEnds != null) App.setSleep(null)
        runCatching { Tv.powerOff() }.onFailure { android.util.Log.w("couchtv", "smart idle powerOff: ${it.message}") }
    }

    private fun readMedia(): JSONObject? {
        val pkg = front ?: return null
        if (pkg in Apps.HOME_PACKAGES) return null
        val (uptime, all) = Tv.sessions()
        val s = all.filter { it.pkg == pkg && it.state != null }.sortedWith(compareBy({ !it.active }, { it.state == "NONE" })).firstOrNull()
            ?: return null
        val state = Tv.STATES[s.state] ?: "stopped"
        var pos = s.position
        if (pos != null && pos >= 0 && uptime != null && s.updated != null && state == "playing") pos += ((uptime - s.updated!!) * (if (s.speed == 0.0) 1.0 else s.speed)).toLong()
        if (pos != null && pos < 0) pos = null
        val item = playedItem?.takeIf { it.optString("package") == pkg }
        // "PrimeVideo" while a film plays (a Sony, issue #23) is no title: try the queue's title
        var title = s.title?.takeIf { !Tv.genericTitle(it, pkg) } ?: s.queueTitle?.takeIf { !Tv.genericTitle(it, pkg) }
        val ownSubtitle = if (title != null && title == s.title) s.subtitle else null
        var source = "tv"
        if (title == null && item != null) { title = item.optString("title"); source = "bridge" }
        val (poster, backdrop) = if (item != null && Finder.norm(item.optString("title")) == Finder.norm(title)) item.opt("poster") as? String to item.opt("backdrop") as? String
            else Finder.artworkSoon(title)
        val sameAsPlayed = item != null && Finder.norm(item.optString("title")) == Finder.norm(title)
        return JSONObject().put("title", title ?: JSONObject.NULL)
            .put("episode_title", ownSubtitle ?: (if (sameAsPlayed) item!!.opt("episode_title") else null) ?: JSONObject.NULL)
            .put("season", if (sameAsPlayed) item!!.opt("season") else JSONObject.NULL)
            .put("episode", if (sameAsPlayed) item!!.opt("episode") else JSONObject.NULL)
            .put("service", Apps.BY_PACKAGE[pkg]?.id ?: JSONObject.NULL)
            .put("poster", poster ?: JSONObject.NULL).put("backdrop", backdrop ?: JSONObject.NULL)
            .put("state", state).put("position_ms", pos ?: JSONObject.NULL).put("updated", iso())
            .put("duration_ms", JSONObject.NULL).put("duration_source", JSONObject.NULL)
            .put("source", source).put("started", item?.opt("started") ?: JSONObject.NULL)
    }

    // ---------------------------------------------------------------- keep watching

    /**
     * Puts what an app says it is playing into Keep watching, so the row fills without the phone
     * starting the show (issue #17: before this, only shows started through the phone's search or
     * Ask landed there, and Ask needs an API key in on-TV mode). It counts once a title has played
     * for a minute, so a trailer that autoplays while browsing does not, once per show until
     * something else plays, and only a title the show finder knows, so the tile can open it again. Needs ADB (the media sessions come from it) and an app that tells
     * Android its title: YouTube, Netflix and most others do, a few say nothing.
     */
    private fun remember(m: JSONObject?) {
        if (Store.testProp("keep_log") == 1L) android.util.Log.d("couchtv.keep", "read front=$front title=${m?.optString("title")} state=${m?.optString("state")} source=${m?.optString("source")} pos=${m?.optLong("position_ms", -1L)}")
        runCatching { untitledStep(front, m); untitledResolve() }.onFailure { android.util.Log.w("couchtv.keep", "untitled: ${it.message}") }
        val pkg = front ?: return
        // only a title the app itself reports (not the last show couch-tv opened in it)
        val title = m?.optString("title")?.takeIf { m.optString("state") == "playing" && m.optString("source") == "tv" && it.isNotEmpty() && it != "null" }
        val key = if (title == null) "" else pkg + "|" + Finder.norm(title) + "|" + (who ?: "")
        val now = System.currentTimeMillis()
        val after = (Store.testProp("seen_after_s") ?: 60L) * 1000
        // Up to two readings in a row with nothing playing (a slow or failed dumpsys, the front app
        // read as the home for a moment) do not start the minute again, within 40 s of the last good
        // one: only a different title, or nothing for longer. Under load the readings came 16 to 20 s
        // apart and one now and then came back empty mid-show, so shows were counted twice and missed.
        if (key.isEmpty() && seenKey.isNotEmpty() && emptyReads < 2 && now - seenLast < 40_000) { emptyReads++; return }
        emptyReads = 0
        if (key != seenKey) { seenKey = key; seenSince = now; seenLast = now; if (key.isNotEmpty()) android.util.Log.i("couchtv.keep", "counting $title for ${who ?: "nobody"}"); return }
        seenLast = now
        if (key.isEmpty() || key == keptKey || now - seenSince < after) return
        // the app's own position has to be past the minute too, when it gives one: a preview that
        // autoplays on a browse screen starts at 0 each time
        val pos = m!!.optLong("position_ms", -1L)
        if (pos in 0 until after) return
        keptKey = key
        val played = playedItem
        // A show started from the phone for the same person in the last three hours is already in
        // Keep watching (Finder.finish)
        if (played != null && played.optString("package") == pkg && Finder.norm(played.optString("title")) == Finder.norm(title)
            && played.optString("who") == (who ?: "") && now - played.optLong("ts") < 3 * 3600_000L) return
        // Only the streaming apps couch-tv knows, never YouTube or music: a video or a song is not
        // something to keep watching.
        val app = Apps.BY_PACKAGE[pkg] ?: return
        if (app.id in NOT_KEPT) return
        val mm = m ?: return
        Store.addHistory(JSONObject().put("title", title)
            .put("episode_title", mm.opt("episode_title") ?: JSONObject.NULL)
            .put("season", mm.opt("season") ?: JSONObject.NULL).put("episode", mm.opt("episode") ?: JSONObject.NULL)
            .put("poster", mm.opt("poster") ?: JSONObject.NULL).put("backdrop", mm.opt("backdrop") ?: JSONObject.NULL)
            .put("service", Apps.BY_PACKAGE[pkg]?.id ?: JSONObject.NULL).put("package", pkg)
            .put("who", who ?: JSONObject.NULL).put("when", iso(now)).put("method", "seen"))
        android.util.Log.i("couchtv.keep", "kept $title for ${who ?: "nobody"}")
    }

    // ---------------------------------------------------------------- plays with no title of their own

    /** A play whose app gives Android no usable title: Netflix sends none on some TVs, Prime only its
     *  own name (issue #23). Counted like any other play (a minute of continuous playing, and past the
     *  minute when the app gives a position), for the person picked when it played, then named from
     *  that app's Watch Next row (WatchNext.kt) once one turns up, which can be after it stops. */
    private class Untitled(val pkg: String, val who: String?, val since: Long) {
        var last = since; var qualified = false; var done = false; var namedBy = ""; var lastCheck = 0L
    }
    @Volatile private var untitled: Untitled? = null
    private const val UNTITLED_KEEP_MS = 3 * 3600_000L   // how long after the play its row may turn up
    private const val OPENED_WINDOW_MS = 10 * 60_000L    // a show couch-tv opened this soon before covers it

    private fun untitledStep(pkg: String?, m: JSONObject?) {
        val now = System.currentTimeMillis()
        val after = (Store.testProp("seen_after_s") ?: 60L) * 1000
        val app = pkg?.let { Apps.BY_PACKAGE[it] }
        // a title the app named itself has source "tv"; no title (Netflix with no metadata) or one
        // borrowed from what couch-tv last opened is a play with no title of its own
        val t = m?.optString("title")
        val ownTitle = m?.optString("source") == "tv" && !t.isNullOrEmpty() && t != "null"
        val isUntitled = pkg != null && app != null && app.id !in NOT_KEPT && m != null &&
            m.optString("state") == "playing" && !ownTitle
        var u = untitled
        if (!isUntitled) {
            // a break before the minute; or the same app now names what it plays, so a later Watch
            // Next row would be that show, not the earlier unnamed one
            // (a short gap with nothing read is forgiven, as for named shows)
            if (u != null && !u.done && ((!u.qualified && now - u.last >= 40_000) || (ownTitle && pkg == u.pkg && m?.optString("state") == "playing"))) untitled = null
            return
        }
        if (u == null || u.pkg != pkg || u.who != who || (u.done && now - u.last > 600_000)) {
            u = Untitled(pkg!!, who, now)
            // A show couch-tv itself opened in this app just before (phone search, Ask, a Keep
            // watching card) was logged when it was opened (Finder.finish), which already names this play.
            val played = playedItem
            if (played != null && played.optString("package") == pkg && played.optString("who") == (who ?: "")
                && played.optLong("ts") in (now - OPENED_WINDOW_MS)..(now + 60_000)) { u.done = true; u.namedBy = "opened" }
            untitled = u
        }
        u.last = now
        val pos = m!!.optLong("position_ms", -1L)
        if (!u.qualified && now - u.since >= after && (pos < 0 || pos >= after)) {
            u.qualified = true
            android.util.Log.i("couchtv.keep", "untitled play counted in $pkg for ${who ?: "nobody"}" + if (u.done) " (opened by couch-tv)" else "")
        }
    }

    private fun untitledResolve() {
        val u = untitled ?: return
        if (u.done || !u.qualified) return
        val now = System.currentTimeMillis()
        if (now - u.last > UNTITLED_KEEP_MS) { untitled = null; return }
        if (now - u.lastCheck < 30_000) return
        u.lastCheck = now
        val row = WatchNext.rows(u.pkg).filter { it.engaged >= u.since - 120_000 && !Tv.genericTitle(it.title, u.pkg) }
            .maxByOrNull { it.engaged } ?: return
        u.done = true; u.namedBy = "watch-next"
        val (poster, backdrop) = Finder.artworkSoon(row.title)   // an exact match only, else none
        Store.addHistory(JSONObject().put("title", row.title)
            .put("episode_title", row.episodeTitle ?: JSONObject.NULL)
            .put("season", row.season ?: JSONObject.NULL).put("episode", row.episode ?: JSONObject.NULL)
            .put("poster", poster ?: row.poster ?: JSONObject.NULL).put("backdrop", backdrop ?: JSONObject.NULL)
            .put("service", Apps.BY_PACKAGE[u.pkg]?.id ?: JSONObject.NULL).put("package", u.pkg)
            .put("who", u.who ?: JSONObject.NULL).put("when", iso(now)).put("method", "watch-next"))
        android.util.Log.i("couchtv.keep", "kept ${row.title} for ${u.who ?: "nobody"} (watch next)")
    }

    private val NOT_KEPT = setOf("youtube", "spotify", "twitch", "moonlight", "settings", "home")
    const val KEEP_MAX = 10
    const val KEEP_DAYS = 30

    /** Keep watching for one person at this TV: one card per show (the latest), newest first, up to
     *  10, nothing older than 30 days. Only lines made since 0.9 (with an id, this TV and a person).
     *  Where the app's own ADB never connects (current Fire OS), Android's Watch Next rows join in
     *  (WatchNext.cards, #122): the same for everyone at the TV, and the newer of the two wins for a
     *  show both name (KeepMerge). */
    fun continueItems(whoFilter: String?): JSONArray {
        val who = whoFilter?.takeIf { it.isNotEmpty() } ?: this.who
        val history = ArrayList<KeepMerge.Card<JSONObject>>()
        if (who != null) {
            val h = Store.history()
            val seen = HashSet<String>()
            val nowMs = System.currentTimeMillis() + (Store.testProp("clock_offset_s") ?: 0L) * 1000
            val cutoff = nowMs - KEEP_DAYS * 24 * 3600_000L
            for (i in 0 until h.length()) {
                val it = h.getJSONObject(i)
                if (it.optString("id").isEmpty() || it.optString("tv") != Store.TV_ID || it.optString("who") != who) continue
                val whenMs = parseIso(it.optString("when")) ?: continue
                if (whenMs < cutoff) continue
                val key = Finder.norm(it.optString("title"))
                if (key.isEmpty() || !seen.add(key)) continue
                val pkg = it.optString("package").ifEmpty { Apps.BY_ID[it.optString("service")]?.pkg ?: "" }
                history.add(KeepMerge.Card(key, pkg, whenMs, false, JSONObject().put("id", it.optString("id")).put("title", it.optString("title"))
                    .put("episode_title", it.opt("episode_title") ?: JSONObject.NULL).put("season", it.opt("season") ?: JSONObject.NULL)
                    .put("episode", it.opt("episode") ?: JSONObject.NULL).put("app", Apps.describe(pkg)?.let { d -> JSONObject(d) } ?: JSONObject.NULL)
                    .put("service", it.opt("service") ?: JSONObject.NULL).put("poster", it.opt("poster") ?: JSONObject.NULL)
                    .put("backdrop", it.opt("backdrop") ?: JSONObject.NULL).put("progress", JSONObject.NULL).put("kind", "continue")
                    .put("last_played", it.opt("when") ?: JSONObject.NULL).put("source", "bridge")))
            }
        }
        // the rows are the whole TV's, so never on a kids profile (Kids mode)
        val wn = if (who != null && Kids.isKid(who)) emptyList() else WatchNext.cards(Store.skipWatchNext(), Store.watchNextPerApp())
        val out = JSONArray()
        KeepMerge.merge(history, wn, KEEP_MAX).forEach { out.put(it.item) }
        return out
    }

    private fun parseIso(s: String?): Long? {
        if (s.isNullOrEmpty()) return null
        for (f in listOf("yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssX"))
            runCatching { return SimpleDateFormat(f, Locale.US).parse(s)!!.time }
        return null
    }
}
