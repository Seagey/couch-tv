package dev.couchtv.ontv

import android.content.Context
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * The bridge, running on the TV. Same endpoint shapes as the computer bridge (bridge/API.md) so one
 * phone remote works with both, plus pairing (/api/pair), ADB setup (/api/adb) and settings.
 *
 * Every /api call needs a token except /api/health (which says only whether you are paired) and
 * /api/pair*. No CORS headers: the phone remote is served from here, so it is same-origin.
 */
class Server(private val ctx: Context, port: Int) : NanoWSD(port) {
    private val assets = ctx.assets

    override fun useGzipWhenAccepted(r: Response) = false   // gzip would hold back server-sent events

    override fun serve(session: IHTTPSession): Response {
        if (session.uri.startsWith("/api/ws") && session.headers["upgrade"]?.lowercase() == "websocket" && !authed(session))
            return json(401, err("pair this phone first"))
        return super.serve(session)
    }

    override fun openWebSocket(handshake: IHTTPSession): WebSocket = Socket(handshake)

    override fun serveHttp(s: IHTTPSession): Response = try {
        val uri = s.uri
        when {
            uri.startsWith("/api/") -> api(s)
            uri == "/setup" || uri == "/setup/" -> asset("www/ontv/setup.html")
            uri.startsWith("/ontv/") -> asset("www/ontv/" + uri.removePrefix("/ontv/"))
            uri == "/tv" -> redirect("/tv/")
            uri == "/tv/config.js" -> newFixedLengthResponse(Response.Status.OK, "application/javascript",
                "window.COUCH_CONFIG = " + Store.publicConfig() + ";\n").noCache()
            uri.startsWith("/tv/") -> staticOrIndex("www/tv", uri.removePrefix("/tv/"), inject = false)
            else -> staticOrIndex("www/remote", uri.removePrefix("/"), inject = true)
        }
    } catch (e: ApiError) {
        json(e.status, err(e.message ?: "error"))
    } catch (e: Exception) {
        Log.w(TAG, "request ${s.uri}", e)
        json(500, err(e.message ?: e.javaClass.simpleName))
    }

    // ---------------------------------------------------------------- auth

    private fun tokenOf(s: IHTTPSession): String? {
        s.headers["authorization"]?.let { if (it.startsWith("Bearer ", true)) return it.substring(7).trim() }
        s.headers["x-couch-token"]?.let { return it }
        s.parameters["token"]?.firstOrNull()?.let { return it }
        s.headers["cookie"]?.split(';')?.map { it.trim() }?.firstOrNull { it.startsWith("couchtv_token=") }?.let { return it.substringAfter('=') }
        return null
    }

    private fun authed(s: IHTTPSession) = Auth.valid(tokenOf(s))

    // ---------------------------------------------------------------- API

    private fun api(s: IHTTPSession): Response {
        val path = s.uri.removeSuffix("/")
        val m = s.method
        // Always read the body first: an unread body would be taken as the start of the next request
        // on a kept-alive connection (seen in testing after a 401).
        bodies[s] = readBody(s)
        if (m == Method.OPTIONS) return newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
        // open endpoints
        when (path) {
            "/api/health" -> {
                val a = authed(s)
                val o = JSONObject().put("ok", true).put("mode", "on-tv").put("version", BuildConfig.VERSION_NAME).put("auth", if (a) "ok" else "required")
                if (a) o.put("tv_connected", true).put("adb", Adb.connected)
                return json(200, o)
            }
            "/api/pair/start" -> {
                if (m != Method.POST) throw ApiError(405, "POST only")
                Auth.newPin()
                App.showPin()
                return json(200, ok().put("digits", 6).put("expires_in", 180).put("note", "The code is on the TV now."))
            }
            "/api/pair" -> {
                if (m != Method.POST) throw ApiError(405, "POST only")
                val b = body(s)
                Thread.sleep(400)   // slows guessing a little more
                val token = Auth.pair(b.optString("pin"), b.optString("name").ifEmpty { null })
                    ?: return json(401, err(if (Auth.currentPin() == null) "That code has expired. Ask the TV for a new one." else "That code is not right. Check the TV."))
                Now.push()
                return json(200, ok().put("token", token))
            }
        }
        if (!authed(s)) return json(401, err("pair this phone first: open this page on your phone and type the code from the TV"))

        val q = { k: String -> s.parameters[k]?.firstOrNull() }
        return when ("$m $path") {
            "GET /api/now" -> json(200, Now.payload())
            "GET /api/events" -> events()
            "GET /api/tvs" -> json(200, ok().put("default", Store.TV_ID).put("tvs", JSONArray().put(JSONObject().put("id", Store.TV_ID)
                .put("name", Store.tvName()).put("paired", true).put("connected", true).put("adb", Adb.connected)
                .put("picture", false).put("power", if (Tv.isOn) "on" else "off"))))
            "GET /api/config" -> json(200, ok(Store.publicConfig()))
            "POST /api/key" -> {
                val b = body(s)
                val key = b.optString("key").ifEmpty { throw ApiError(400, "key is required") }
                Tv.key(key, b.optBoolean("hold"))
                json(200, ok().put("key", key))
            }
            "POST /api/text" -> {
                val t = body(s).optString("text").ifEmpty { throw ApiError(400, "text is required") }
                Tv.text(t); json(200, ok())
            }
            "GET /api/apps" -> {
                val inst = Tv.installed()
                val arr = JSONArray()
                Apps.ALL.forEach { a -> arr.put(JSONObject().put("id", a.id).put("name", a.name).put("package", a.pkg).put("colour", a.colour)
                    .put("installed", a.id == "home" || a.pkg in inst)) }
                json(200, ok().put("apps", arr))
            }
            "POST /api/launch" -> launch(body(s).optString("app"))
            "GET /api/find" -> {
                val title = q("title")?.trim().orEmpty().ifEmpty { throw ApiError(400, "title is required") }
                val (best, others) = Finder.find(title, q("type"))
                best ?: throw ApiError(404, "could not find $title")
                val o = JSONArray(); others.forEach { o.put(JSONObject().put("title", it.title).put("year", it.year ?: JSONObject.NULL).put("type", it.type)) }
                json(200, ok().put("result", Finder.publicResult(best, Tv.installed())).put("others", o))
            }
            "POST /api/play" -> {
                val b = body(s)
                val title = b.optString("title").trim().ifEmpty { throw ApiError(400, "title is required") }
                json(200, ok(Finder.play(title, b.optInt("season").takeIf { it > 0 }, b.optInt("episode").takeIf { it > 0 },
                    b.optString("service").ifEmpty { null }, b.optString("who").ifEmpty { null })))
            }
            "POST /api/ask" -> {
                if (!Ask.enabled) throw ApiError(501, "Ask is off in on-TV mode. To switch it on, add your own Anthropic API key on the setup page (it costs a fraction of a cent per ask).")
                val b = body(s)
                json(200, Ask.ask(b.optString("text").ifEmpty { throw ApiError(400, "text is required") }, b.optString("who").ifEmpty { Now.who }))
            }
            "GET /api/recs" -> json(200, ok().put("updated", Now.iso()).put("continue", Now.continueItems(q("who"))).put("picks", JSONArray()))
            "GET /api/continue" -> json(200, ok().put("items", Now.continueItems(q("who"))))
            "POST /api/continue/open" -> {
                val b = body(s)
                val idx = b.optString("id").removePrefix("h-").toIntOrNull() ?: throw ApiError(400, "id is required")
                val h = Store.history()
                if (idx !in 0 until h.length()) throw ApiError(404, "not in keep watching")
                val it = h.getJSONObject(idx)
                json(200, ok(Finder.play(it.getString("title"), it.optInt("season").takeIf { s -> s > 0 }, it.optInt("episode").takeIf { s -> s > 0 },
                    it.optString("service").ifEmpty { null }, b.optString("who").ifEmpty { null }, resume = true)))
            }
            "GET /api/history" -> json(200, ok().put("items", Store.history()))
            "GET /api/who" -> json(200, ok().put("who", Now.who ?: JSONObject.NULL))
            "POST /api/who" -> { Now.who = body(s).optString("who").ifEmpty { null }; Now.push(); json(200, ok().put("who", Now.who ?: JSONObject.NULL)) }
            "GET /api/sleep" -> json(200, ok().put("ends", Now.sleepEnds?.let { Now.iso(it) } ?: JSONObject.NULL))
            "POST /api/sleep" -> {
                val min = body(s).optDouble("minutes", Double.NaN)
                if (min.isNaN() || min < 0 || min > 600) throw ApiError(400, "minutes must be 0 to 600")
                App.setSleep(if (min > 0) System.currentTimeMillis() + (min * 60_000).toLong() else null)
                json(200, ok().put("ends", Now.sleepEnds?.let { Now.iso(it) } ?: JSONObject.NULL))
            }
            "GET /api/picture" -> json(200, ok().put("mode", JSONObject.NULL).put("supported", false).put("can_set", false))
            "POST /api/picture" -> json(409, err("picture mode is not available in on-TV mode"))
            "GET /api/screens" -> json(200, ok().put("screens", JSONArray()))
            "POST /api/screens/open" -> json(404, err("no screens in on-TV mode"))
            "POST /api/power" -> power(body(s).optString("state"))
            "POST /api/volume" -> volume(body(s))
            "GET /api/screenshot" -> newFixedLengthResponse(Response.Status.OK, "image/png", Tv.screenshot().inputStream(), -1).noStore()
            "GET /api/weather" -> json(200, ok(Weather.get() ?: throw ApiError(503, "No weather right now.")))
            "POST /api/home-apps" -> {
                val b = body(s)
                Store.writeJson("home-apps.json", JSONObject().put("apps", b.optJSONArray("apps") ?: JSONArray()).put("line", b.optInt("line", 10)))
                json(200, ok())
            }
            "GET /api/app-order" -> json(200, appOrder())
            "POST /api/app-order" -> {
                val b = body(s)
                val order = b.optJSONArray("order") ?: throw ApiError(400, "order must be a list of app packages")
                if (!b.has("line")) throw ApiError(400, "line is required")
                Store.writeJson("app-order.json", JSONObject().put("order", order).put("line", b.optInt("line").coerceIn(0, 10)))
                json(200, appOrder())
            }
            // ---- on-TV extras ----
            "GET /api/adb" -> json(200, ok(JSONObject(Adb.status())))
            "POST /api/adb/connect" -> { val tls = body(s).optString("route") == "tls"; if (tls) Adb.disconnect(); Thread { runCatching { Adb.ensure(interactive = true, preferTls = tls) }.onFailure { Log.w(TAG, "adb connect", it) }; Now.push() }.start(); json(200, ok(JSONObject(Adb.status()))) }
            "POST /api/adb/pair" -> {
                val b = body(s)
                val code = b.optString("code").filter { it.isDigit() }.ifEmpty { throw ApiError(400, "code is required") }
                val r = JSONObject(Adb.pair(code, b.optInt("port").takeIf { it > 0 }))
                if (r.optBoolean("ok")) { Adb.disconnect(); r.put("connected", Adb.ensure(interactive = true, preferTls = true)).put("route", Adb.route ?: JSONObject.NULL) }
                r.put("adb", JSONObject(Adb.status()))
                json(if (r.optBoolean("ok")) 200 else 502, r)
            }
            "POST /api/adb/disconnect" -> { Adb.disconnect(); json(200, ok()) }
            // Step-by-step handshake with every packet logged (tag couchtv.adb, "diag:"). See AdbDiag.
            "POST /api/adb/diag" -> {
                val b = body(s)
                AdbDiag.start(b.optString("host").ifEmpty { "127.0.0.1" }, b.optInt("port", 5555), b.optInt("wait", 90).coerceIn(5, 300))
                json(200, ok().put("note", "started; read GET /api/adb/diag or logcat -s couchtv.adb"))
            }
            "GET /api/adb/diag" -> json(200, ok().put("running", AdbDiag.running).put("lines", JSONArray(AdbDiag.lines)))
            // The TV home's people list (the same one /setup edits): the home's Home settings adds,
            // renames, removes and reorders people with it, as it does with the computer bridge.
            "GET /api/people" -> json(200, ok().put("people", Store.people()))
            "POST /api/people" -> { savePeople(body(s)); json(200, ok().put("people", Store.people())) }
            "GET /api/settings" -> json(200, settings())
            "POST /api/settings" -> { saveSettings(body(s)); json(200, settings()) }
            "POST /api/phones/forget" -> { Auth.forgetAll(); json(200, ok().put("note", "Every phone must pair again.")) }
            else -> json(404, err("no such endpoint: $m $path"))
        }
    }

    private fun launch(target: String): Response {
        if (target.isEmpty()) throw ApiError(400, "app is required")
        if ("://" in target || target.startsWith("intent:")) {
            Tv.startUri(target, Apps.packageForLink(target)?.takeIf { Tv.hasPackage(it) }); Thread.sleep(1500)
            return json(200, ok().put("app", Apps.describe(Tv.frontPackage())?.let { JSONObject(it) } ?: JSONObject.NULL))
        }
        val app = Apps.BY_ID[target] ?: Apps.BY_PACKAGE[target]
        if (app?.id == "home") {
            if (Adb.connected) Tv.key("home") else App.openHome()
            return json(200, ok().put("app", JSONObject(Apps.describe(BuildConfig.APPLICATION_ID)!!)))
        }
        val pkg = app?.pkg ?: if ("." in target) target else throw ApiError(400, "unknown app: $target")
        if (!Tv.hasPackage(pkg)) throw ApiError(404, "${app?.name ?: pkg} is not installed on the TV")
        Tv.launchPackage(pkg)
        val got = if (Adb.connected) Tv.waitForApp(setOf(pkg), 8000) else pkg
        if (got == null) throw ApiError(504, "asked the TV to open ${app?.name ?: pkg} but it did not come up")
        Now.push()
        return json(200, ok().put("app", JSONObject(Apps.describe(got)!!)))
    }

    private fun power(state: String): Response {
        when (state) {
            "on" -> if (!Tv.powerOn()) throw ApiError(503, "The TV app cannot wake a sleeping TV. Turn it on with its own remote.")
            "off" -> if (Tv.isOn) Tv.powerOff()
            "toggle" -> if (Tv.isOn) Tv.powerOff() else if (!Tv.powerOn()) throw ApiError(503, "The TV app cannot wake a sleeping TV.")
            else -> throw ApiError(400, "state must be on, off or toggle")
        }
        Now.push()
        return json(200, ok().put("power", if (Tv.isOn) "on" else "off"))
    }

    private fun volume(b: JSONObject): Response {
        if (b.has("level")) Tv.setLevel(b.optInt("level"))
        else {
            val code = mapOf("up" to "KEYCODE_VOLUME_UP", "down" to "KEYCODE_VOLUME_DOWN", "mute" to "KEYCODE_VOLUME_MUTE")[b.optString("action")]
                ?: throw ApiError(400, "action must be up, down or mute, or send level")
            val steps = if (code.endsWith("MUTE")) 1 else b.optInt("steps", 1).coerceIn(1, 20)
            repeat(steps) { Tv.volumeKey(code); Thread.sleep(80) }
        }
        Thread.sleep(300)
        Now.push()
        return json(200, ok().put("volume", JSONObject(Tv.volume())))
    }

    private fun appOrder(): JSONObject {
        val known = (Store.readJson("home-apps.json") as? JSONObject) ?: JSONObject()
        val apps = known.optJSONArray("apps") ?: JSONArray()
        val saved = Store.readJson("app-order.json") as? JSONObject
        if (saved == null) return ok().put("apps", apps).put("line", minOf(known.optInt("line", 10), 10, apps.length())).put("saved", false).put("dock_max", 10)
        val by = (0 until apps.length()).associate { apps.getJSONObject(it).optString("package") to apps.getJSONObject(it) }
        val order = saved.optJSONArray("order") ?: JSONArray()
        val listed = JSONArray(); val inOrder = HashSet<String>()
        for (i in 0 until order.length()) { val p = order.optString(i); inOrder += p; by[p]?.let { listed.put(it) } }
        val line = (0 until minOf(saved.optInt("line"), order.length())).count { by.containsKey(order.optString(it)) }
        by.forEach { (p, a) -> if (p !in inOrder) listed.put(a) }
        return ok().put("apps", listed).put("line", minOf(line, 10)).put("saved", true).put("dock_max", 10)
    }

    private fun settings(): JSONObject = ok()
        // the TV home's own Home settings (language, place, look...), kept here as they come
        .put("settings", Store.readJson("home-settings.json") as? JSONObject ?: JSONObject())
        .put("updated", Store.str("home_settings_updated") ?: JSONObject.NULL)
        .put("people", Store.people()).put("weather", Store.weather()).put("country", Store.country()).put("tv_name", Store.tvName())
        .put("ask", JSONObject().put("enabled", Store.bool("ask_enabled")).put("has_key", !Store.str("ask_key").isNullOrEmpty()).put("model", Ask.MODEL))
        .put("phones", Auth.phoneCount()).put("port", Store.port).put("adb", JSONObject(Adb.status()))

    /** {"people": [...]} replaces the list; {"order": [ids]} only reorders it. */
    private fun savePeople(b: JSONObject) {
        val list = b.optJSONArray("people") ?: run {
            val order = b.optJSONArray("order") ?: throw ApiError(400, "people (a list) or order (a list of ids) is required")
            val now = Store.people()
            val by = (0 until now.length()).associate { now.getJSONObject(it).optString("id") to now.getJSONObject(it) }
            val out = JSONArray(); val seen = HashSet<String>()
            for (i in 0 until order.length()) by[order.optString(i)]?.let { if (seen.add(order.optString(i))) out.put(it) }
            by.forEach { (id, p) -> if (id !in seen) out.put(p) }
            out
        }
        val clean = JSONArray()
        for (i in 0 until minOf(list.length(), 12)) {
            val p = list.optJSONObject(i) ?: continue
            val name = p.optString("name").trim().take(40)
            if (name.isNotEmpty()) clean.put(JSONObject().put("id", p.optString("id").ifEmpty { "person${i + 1}" }.take(32)).put("name", name))
        }
        Store.putStr("people", clean.toString())
        Now.push()
    }

    private fun saveSettings(b: JSONObject) {
        b.optJSONObject("settings")?.let {
            if (it.toString().length > 32_000) throw ApiError(413, "settings are too big")
            Store.writeJson("home-settings.json", it)
            Store.putStr("home_settings_updated", Now.iso())
        }
        b.optJSONArray("people")?.let { arr ->
            val clean = JSONArray()
            for (i in 0 until minOf(arr.length(), 8)) {
                val p = arr.optJSONObject(i) ?: continue
                val name = p.optString("name").trim().take(30)
                if (name.isNotEmpty()) clean.put(JSONObject().put("id", p.optString("id").ifEmpty { "person${i + 1}" }.take(30)).put("name", name))
            }
            if (clean.length() > 0) Store.putStr("people", clean.toString())
        }
        b.optJSONObject("weather")?.let { w ->
            if (w.has("lat") && w.has("lon")) Store.putStr("weather", JSONObject().put("lat", w.getDouble("lat")).put("lon", w.getDouble("lon"))
                .put("place", w.optString("place").take(40)).put("timezone", w.optString("timezone", "UTC").take(40)).toString())
            Weather.clear()
        }
        b.optString("country").takeIf { Regex("[A-Z]{2}").matches(it) }?.let { Store.putStr("country", it) }
        b.optString("tv_name").trim().takeIf { it.isNotEmpty() }?.let { Store.putStr("tv_name", it.take(30)) }
        if (b.has("ask_key")) Store.putStr("ask_key", b.optString("ask_key").trim().ifEmpty { null })
        if (b.has("ask_enabled")) Store.putBool("ask_enabled", b.optBoolean("ask_enabled"))
    }

    // ---------------------------------------------------------------- server-sent events

    private fun events(): Response {
        val q = LinkedBlockingQueue<String>(50)
        val fn: (String) -> Unit = { q.offer("event: now\ndata: $it\n\n") }
        q.offer("event: now\ndata: ${Now.payload()}\n\n")
        Now.listen(fn)
        val stream = object : InputStream() {
            private var buf = ByteArray(0); private var pos = 0; private var closed = false
            override fun read(): Int { val b = ByteArray(1); return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 0xff }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (closed) return -1
                if (pos >= buf.size) {
                    val msg = try { q.poll(20, TimeUnit.SECONDS) } catch (e: InterruptedException) { null } ?: ": keepalive\n\n"
                    buf = msg.toByteArray(); pos = 0
                }
                val n = minOf(len, buf.size - pos)
                System.arraycopy(buf, pos, b, off, n); pos += n
                return n
            }
            override fun close() { closed = true; Now.unlisten(fn) }
        }
        return newChunkedResponse(Response.Status.OK, "text/event-stream", stream).apply {
            addHeader("Cache-Control", "no-cache"); addHeader("X-Accel-Buffering", "no")
        }
    }

    // ---------------------------------------------------------------- WebSocket (/api/ws)

    /**
     * Low-latency channel. Sends {"event":"now", ...} on every change. Takes
     * {"key":"up"}, {"key":"ok","hold":true}, {"volume":"up"} or {"text":"bluey"}; answers {"ok":true} or an error.
     */
    private inner class Socket(h: IHTTPSession) : WebSocket(h) {
        private val fn: (String) -> Unit = { runCatching { send(JSONObject(it).put("event", "now").toString()) } }
        override fun onOpen() { Now.listen(fn); runCatching { send(Now.payload().put("event", "now").toString()) } }
        override fun onClose(code: NanoWSD.WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) { Now.unlisten(fn) }
        override fun onPong(pong: NanoWSD.WebSocketFrame?) {}
        override fun onException(e: IOException?) { Now.unlisten(fn) }
        override fun onMessage(frame: NanoWSD.WebSocketFrame) {
            val reply = try {
                val m = JSONObject(frame.textPayload)
                when {
                    m.has("key") -> { Tv.key(m.getString("key"), m.optBoolean("hold")); JSONObject().put("ok", true).put("key", m.getString("key")) }
                    m.has("volume") -> { volume(JSONObject().put("action", m.getString("volume"))); JSONObject().put("ok", true) }
                    m.has("text") -> { Tv.text(m.getString("text")); JSONObject().put("ok", true) }
                    else -> JSONObject().put("ok", false).put("error", "unknown message")
                }
            } catch (e: ApiError) { JSONObject().put("ok", false).put("error", e.message).put("status", e.status) }
            catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message) }
            runCatching { send(reply.toString()) }
        }
    }

    // ---------------------------------------------------------------- static files

    private fun staticOrIndex(root: String, rel: String, inject: Boolean): Response {
        val clean = URLDecoder.decode(rel, "UTF-8")
        if (clean.contains("..")) return json(400, err("bad path"))
        if (clean.isNotEmpty() && exists("$root/$clean")) return if (inject && clean == "index.html") index(root) else asset("$root/$clean")
        // single page apps: unknown paths get index.html (files with an extension get a 404)
        if (clean.substringAfterLast('/').contains('.')) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        return if (inject) index(root) else asset("$root/index.html")
    }

    /** The phone remote's index.html with the on-TV pairing script added first. */
    private fun index(root: String): Response {
        val html = assets.open("$root/index.html").bufferedReader().readText()
        val tag = "<script src=\"/ontv/shim.js\"></script>"
        val out = if (html.contains("<head>")) html.replaceFirst("<head>", "<head>$tag") else tag + html
        return newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", out).noCache()
    }

    private fun exists(path: String) = try { assets.open(path).close(); true } catch (e: IOException) { false }

    private fun asset(path: String): Response = try {
        val stream = assets.open(path)
        newChunkedResponse(Response.Status.OK, mime(path), stream).noCache()
    } catch (e: IOException) { newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found") }

    private fun mime(p: String) = when (p.substringAfterLast('.').lowercase()) {
        "html" -> "text/html; charset=utf-8"; "js", "mjs" -> "application/javascript"; "css" -> "text/css"
        "json" -> "application/json"; "webmanifest" -> "application/manifest+json"; "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"; "webp" -> "image/webp"; "svg" -> "image/svg+xml"; "woff2" -> "font/woff2"
        "ico" -> "image/x-icon"; "txt" -> "text/plain"; else -> "application/octet-stream"
    }

    private fun redirect(to: String) = newFixedLengthResponse(Response.Status.REDIRECT, "text/plain", "").apply { addHeader("Location", to) }

    // ---------------------------------------------------------------- helpers

    private val bodies = java.util.Collections.synchronizedMap(java.util.WeakHashMap<IHTTPSession, JSONObject>())

    private fun body(s: IHTTPSession): JSONObject = bodies[s] ?: JSONObject()

    private fun readBody(s: IHTTPSession): JSONObject {
        val len = s.headers["content-length"]?.toIntOrNull() ?: 0
        if (len <= 0) return JSONObject()
        if (len > 64 * 1024) throw ApiError(413, "request too large")
        val buf = ByteArray(len)
        var read = 0
        while (read < len) { val n = s.inputStream.read(buf, read, len - read); if (n < 0) break; read += n }
        val text = String(buf, 0, read, Charsets.UTF_8).trim()
        if (text.isEmpty()) return JSONObject()
        return try { JSONObject(text) } catch (e: Exception) { throw ApiError(400, "body must be JSON") }
    }

    private fun ok(from: JSONObject? = null): JSONObject = (from ?: JSONObject()).put("ok", true)
    private fun err(msg: String) = JSONObject().put("ok", false).put("error", msg)

    private fun json(status: Int, o: JSONObject): Response =
        newFixedLengthResponse(Status(status), "application/json", o.toString()).noStore()

    private fun Response.noCache() = apply { addHeader("Cache-Control", "no-cache") }
    private fun Response.noStore() = apply { addHeader("Cache-Control", "no-store") }

    private class Status(private val code: Int) : Response.IStatus {
        override fun getRequestStatus() = code
        override fun getDescription() = "$code " + when (code) { 200 -> "OK"; 400 -> "Bad Request"; 401 -> "Unauthorized"; 404 -> "Not Found"
            409 -> "Conflict"; 413 -> "Payload Too Large"; 501 -> "Not Implemented"; 502 -> "Bad Gateway"; 503 -> "Service Unavailable"; 504 -> "Gateway Timeout"; else -> "Status" }
    }

    companion object { private const val TAG = "couchtv.server" }
}
