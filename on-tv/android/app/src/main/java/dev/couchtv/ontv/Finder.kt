package dev.couchtv.ontv

import android.text.Html
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Where a show streams, from JustWatch's public GraphQL (no key, same as bridge/finder.py), and the
 * "play a show" logic from bridge/server.py, using the same app table and deep-link rules.
 */
object Finder {
    private const val URL_GQL = "https://apis.justwatch.com/graphql"
    private val KIND = mapOf("FREE" to "free", "ADS" to "free", "FAST" to "free", "FLATRATE" to "subscription", "RENT" to "rent", "BUY" to "buy")
    private val KIND_ORDER = mapOf("free" to 0, "subscription" to 1, "rent" to 2, "buy" to 3)
    private const val OFFER = "monetizationType deeplinkURL(platform: ANDROID_TV) standardWebURL package { clearName technicalName }"
    private val SEARCH = """
        query(${'$'}country: Country!, ${'$'}language: Language!, ${'$'}first: Int!, ${'$'}filter: TitleFilter) {
          popularTitles(country: ${'$'}country, first: ${'$'}first, filter: ${'$'}filter) {
            edges { node { id objectType
              content(country: ${'$'}country, language: ${'$'}language) {
                title originalReleaseYear posterUrl shortDescription runtime backdrops { backdropUrl } }
              offers(country: ${'$'}country, platform: ANDROID_TV) { $OFFER } } } } }""".trimIndent()
    private val EPISODES = """
        query(${'$'}country: Country!, ${'$'}language: Language!, ${'$'}id: ID!) {
          node(id: ${'$'}id) { ... on Show { seasons {
            content(country: ${'$'}country, language: ${'$'}language) { seasonNumber }
            episodes { content(country: ${'$'}country, language: ${'$'}language) { episodeNumber title runtime }
              offers(country: ${'$'}country, platform: ANDROID_TV) { $OFFER } } } } } }""".trimIndent()

    private fun post(query: String, vars: JSONObject): JSONObject {
        vars.put("country", Store.country()).put("language", "en")
        val c = URL(URL_GQL).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 15000
        c.requestMethod = "POST"; c.doOutput = true
        c.setRequestProperty("content-type", "application/json")
        c.setRequestProperty("user-agent", "couch-tv-on-tv/1")
        c.outputStream.use { it.write(JSONObject().put("query", query).put("variables", vars).toString().toByteArray()) }
        val text = (if (c.responseCode in 200..299) c.inputStream else c.errorStream).bufferedReader().readText()
        c.disconnect()
        val j = JSONObject(text)
        j.optJSONArray("errors")?.let { throw ApiError(502, it.getJSONObject(0).optString("message", "JustWatch error")) }
        return j.getJSONObject("data")
    }

    private fun img(path: String?, size: String) = path?.takeIf { it.isNotEmpty() && it != "null" }
        ?.let { "https://images.justwatch.com" + it.replace("{profile}", size).replace("{format}", "jpg") }

    fun norm(s: String?) = (s ?: "").lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()

    data class Provider(val service: String, val name: String, val kind: String, val playable: Boolean, val deeplink: String?, val web: String?)
    data class Title(val jwId: String, val title: String, val year: Int?, val type: String, val poster: String?, val backdrop: String?,
                     val overview: String?, val runtimeMin: Int?, val providers: List<Provider>)

    private fun providers(offers: JSONArray?): List<Provider> {
        val best = LinkedHashMap<String, Provider>()
        for (i in 0 until (offers?.length() ?: 0)) {
            val o = offers!!.getJSONObject(i)
            val pk = o.getJSONObject("package")
            val tech = pk.optString("technicalName")
            val app = Apps.BY_JW[tech]
            val key = app?.id ?: tech
            val kind = KIND[o.optString("monetizationType")] ?: "other"
            val cur = best[key]
            if (cur != null && (KIND_ORDER[cur.kind] ?: 9) <= (KIND_ORDER[kind] ?: 9)) continue
            val web = o.optString("standardWebURL").takeIf { it.isNotEmpty() && it != "null" }?.let { (if (android.os.Build.VERSION.SDK_INT >= 24) Html.fromHtml(it, 0) else @Suppress("DEPRECATION") Html.fromHtml(it)).toString() }
            best[key] = Provider(key, app?.name ?: pk.optString("clearName"), kind, app != null,
                o.optString("deeplinkURL").takeIf { it.isNotEmpty() && it != "null" }, web)
        }
        return best.values.sortedWith(compareBy({ !it.playable }, { KIND_ORDER[it.kind] ?: 9 }))
    }

    private fun shape(node: JSONObject): Title {
        val c = node.getJSONObject("content")
        val bd = c.optJSONArray("backdrops")?.optJSONObject(0)?.optString("backdropUrl")
        return Title(node.getString("id"), c.optString("title"), c.optInt("originalReleaseYear").takeIf { it > 0 },
            if (node.optString("objectType") == "SHOW") "tv" else "movie", img(c.optString("posterUrl"), "s592"), img(bd, "s1440"),
            c.optString("shortDescription").takeIf { it.isNotEmpty() && it != "null" }, c.optInt("runtime").takeIf { it > 0 },
            providers(node.optJSONArray("offers")))
    }

    fun search(title: String, type: String? = null, first: Int = 8): List<Title> {
        val flt = JSONObject().put("searchQuery", title)
        if (type == "tv" || type == "movie") flt.put("objectTypes", JSONArray().put(if (type == "tv") "SHOW" else "MOVIE"))
        val edges = post(SEARCH, JSONObject().put("first", first).put("filter", flt)).getJSONObject("popularTitles").getJSONArray("edges")
        return (0 until edges.length()).map { shape(edges.getJSONObject(it).getJSONObject("node")) }
    }

    fun find(title: String, type: String? = null): Pair<Title?, List<Title>> {
        val r = search(title, type)
        if (r.isEmpty()) return null to emptyList()
        val want = norm(title)
        val ranked = r.indices.sortedWith(compareBy({ norm(r[it].title) != want }, { r[it].providers.isEmpty() }, { it }))
        return r[ranked[0]] to r.filterIndexed { i, _ -> i != ranked[0] }
    }

    data class Episode(val season: Int, val episode: Int, val name: String?, val runtimeMin: Int?, val providers: List<Provider>)

    fun episode(jwId: String, season: Int, episode: Int?): Episode? {
        val seasons = post(EPISODES, JSONObject().put("id", jwId)).optJSONObject("node")?.optJSONArray("seasons") ?: return null
        for (i in 0 until seasons.length()) {
            val s = seasons.getJSONObject(i)
            if (s.getJSONObject("content").optInt("seasonNumber") != season) continue
            val eps = s.getJSONArray("episodes")
            for (j in 0 until eps.length()) {
                val e = eps.getJSONObject(j); val c = e.getJSONObject("content")
                if (episode == null || c.optInt("episodeNumber") == episode)
                    return Episode(season, c.optInt("episodeNumber"), c.optString("title").takeIf { it != "null" }, c.optInt("runtime").takeIf { it > 0 }, providers(e.optJSONArray("offers")))
            }
        }
        return null
    }

    // ---------------------------------------------------------------- the API shapes

    fun publicResult(t: Title, installed: Set<String>): JSONObject {
        val provs = JSONArray()
        t.providers.forEach { p ->
            val app = Apps.BY_ID[p.service]
            val inst = app != null && (installed.isEmpty() || app.pkg in installed)
            provs.put(JSONObject().put("service", p.service).put("name", p.name).put("kind", p.kind).put("playable", p.playable && inst))
        }
        return JSONObject().put("title", t.title).put("year", t.year ?: JSONObject.NULL).put("type", t.type)
            .put("poster", t.poster ?: JSONObject.NULL).put("backdrop", t.backdrop ?: JSONObject.NULL)
            .put("overview", t.overview ?: JSONObject.NULL).put("providers", provs)
    }

    private val artCache = java.util.concurrent.ConcurrentHashMap<String, Pair<String?, String?>>()

    /** Poster and backdrop for a title an app reports as playing. Cached; never throws. */
    fun artwork(title: String?): Pair<String?, String?> {
        if (title.isNullOrEmpty()) return null to null
        artCache[norm(title)]?.let { return it }
        // only a show of the same name: a near miss is another show, and no picture beats the wrong one
        val art = try { find(title).first?.takeIf { norm(it.title) == norm(title) }?.let { it.poster to it.backdrop } ?: (null to null) } catch (e: Exception) { return null to null }
        artCache[norm(title)] = art
        return art
    }

    private val artPending = java.util.Collections.newSetFromMap(java.util.concurrent.ConcurrentHashMap<String, Boolean>())
    private val artPool = java.util.concurrent.Executors.newSingleThreadExecutor()

    /** The same, but never waits: what is cached now, with the lookup started in the background for
     *  next time. The "what is playing" loop uses this, so a slow show finder can never hold it up
     *  past the minute a show needs to count (seen in the emulator tests). */
    fun artworkSoon(title: String?): Pair<String?, String?> {
        if (title.isNullOrEmpty()) return null to null
        artCache[norm(title)]?.let { return it }
        if (artPending.add(norm(title))) artPool.execute { try { artwork(title) } finally { artPending.remove(norm(title)) } }
        return null to null
    }

    /** POST /api/play. Same order as the computer bridge: free, then subscription, then the rest. */
    fun play(title: String, season: Int?, episode: Int?, service: String?, who: String?, resume: Boolean = false): JSONObject {
        val installed = Tv.installed()
        val (best, _) = find(title)
        best ?: throw ApiError(404, "could not find $title")
        val ep = if (season != null && best.type == "tv") runCatching { episode(best.jwId, season, episode) }.getOrNull() else null

        fun usable(p: Provider) = Apps.BY_ID[p.service]?.let { p.playable && it.pkg in installed } ?: false
        var cands = best.providers.filter { usable(it) }
        if (service != null) {
            cands = cands.filter { it.service == service }
            if (cands.isEmpty()) {
                val app = Apps.BY_ID[service] ?: throw ApiError(400, "unknown service: $service")
                val (m, note) = searchInApp(app, best.title)
                return finish(best, app, m, note, season, episode, who, ep)
            }
        }
        if (cands.isEmpty()) {
            val where = best.providers.joinToString(", ") { it.name }.ifEmpty { "nowhere in this country right now" }
            throw ApiError(404, "${best.title} is not on any app on this TV (streams on: $where)")
        }
        val pick = cands[0]
        val app = Apps.BY_ID[pick.service]!!
        var link = pick.deeplink
        if ((pick.kind == "rent" || pick.kind == "buy") && pick.web?.startsWith("https://") == true) link = pick.web
        if (app.useWeb != null && pick.web != null) app.useWeb.find(pick.web)?.let { link = it.groupValues[1] }
        var note = "Opened the show page."
        if (ep != null) {
            val epLink = ep.providers.firstOrNull { it.service == app.id }?.deeplink
            if (epLink != null) { link = epLink; note = "Opened season $season episode ${ep.episode}." }
            else note = "Opened the show page. Season $season is picked on the TV."
        } else if (season != null) note = "Opened the show page. Season $season is picked on the TV."

        var method: String? = null
        var started: Boolean? = null
        if (app.deeplink == "jw" && link != null) {
            val cold = when (app.cold) { "always" -> true; "background" -> Tv.frontPackage() != app.pkg; else -> false }
            try {
                Tv.startUri(link!!, app.pkg, cold && Adb.connected)
                method = if (Adb.connected) (if (Tv.waitForApp(setOf(app.pkg), 10_000) != null) "deeplink" else null) else "deeplink"
            } catch (e: Exception) { android.util.Log.w("couchtv", "deep link failed for ${app.id}: ${e.message}") }
            if (method != null && app.verify && Adb.connected) {
                started = Tv.waitUntilPlaying(app.pkg)
                note = if (started) "${best.title} is playing in ${app.name}."
                else "${app.name} is open, but ${best.title} has not started. If it asks who is watching, pick a profile, then ask again."
            }
        }
        if (method == null) { val r = searchInApp(app, best.title); method = r.first; note = r.second }
        return finish(best, app, method, note, season, episode, who, ep).also { if (started != null) it.put("started", started) }
    }

    private fun searchInApp(app: TvApp, title: String): Pair<String, String> {
        Apps.SEARCH_LINKS[app.id]?.let { tpl ->
            runCatching {
                Tv.startUri(tpl.replace("{q}", URLEncoder.encode(title, "UTF-8")), app.pkg)
                if (!Adb.connected || Tv.waitForApp(setOf(app.pkg)) != null) return "search" to "Opened ${app.name} search for $title."
            }
        }
        Tv.launchPackage(app.pkg)
        return "app" to "Opened ${app.name}. Search for $title on the TV."
    }

    private fun finish(t: Title, app: TvApp, method: String, note: String, season: Int?, episode: Int?, who: String?, ep: Episode?): JSONObject {
        val s = ep?.season ?: season
        val e = ep?.episode ?: episode
        val now = Now.iso()
        val item = JSONObject().put("title", t.title).put("year", t.year ?: JSONObject.NULL).put("type", t.type)
            .put("poster", t.poster ?: JSONObject.NULL).put("backdrop", t.backdrop ?: JSONObject.NULL).put("service", app.id)
            .put("season", s ?: JSONObject.NULL).put("episode", e ?: JSONObject.NULL).put("episode_title", ep?.name ?: JSONObject.NULL)
            .put("package", app.pkg).put("started", now)
        Now.playedItem = item.put("who", who ?: Now.who ?: "").put("ts", System.currentTimeMillis())
        Store.addHistory(JSONObject(item.toString()).put("who", who ?: Now.who ?: JSONObject.NULL).put("when", now).put("method", method)
            .apply { remove("ts") })
        Now.push()
        return JSONObject().put("title", t.title).put("year", t.year ?: JSONObject.NULL).put("type", t.type)
            .put("poster", t.poster ?: JSONObject.NULL).put("backdrop", t.backdrop ?: JSONObject.NULL).put("service", app.id)
            .put("app", JSONObject(Apps.describe(app.pkg)!!)).put("method", method).put("note", note)
    }
}
