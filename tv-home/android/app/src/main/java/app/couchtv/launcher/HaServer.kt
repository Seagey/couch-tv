package app.couchtv.launcher

import android.content.Context
import android.util.Log
import app.couchtv.ha.HaPhone
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

/**
 * The launcher has no web server, so smart home set up from a phone gets this small one: it only
 * answers /ha (HaPhone.kt) and nothing else, and only runs while someone is setting up. It starts
 * when Home settings, Smart home opens and stops by itself 30 minutes after the screen last asked
 * for it. Plain HTTP on the home network, one short request per connection, at most 64 KB a body.
 * The on-TV app (dev.couchtv.ontv) uses its own server on 5400; this one takes 5401, or the next
 * free port up to 5409.
 */
object HaServer {
    private const val TAG = "couchtv.haserver"
    private const val IDLE_MS = 30 * 60_000L
    @Volatile private var socket: ServerSocket? = null
    @Volatile private var lastAsked = 0L
    // enough for a phone page and its few files at once; a slow or silent client gives up after 5 s
    private val pool = Executors.newFixedThreadPool(8)

    /** Starts it if it is not running; the port it listens on, or null when none was free. */
    @Synchronized
    fun ensure(ctx: Context): Int? {
        lastAsked = System.currentTimeMillis()
        socket?.takeIf { !it.isClosed }?.let { return it.localPort }
        val app = ctx.applicationContext
        // only on the home network address the QR code names, never every interface
        val lan = HaPhone.lanAddress(app) ?: return null
        for (port in 5401..5409) {
            val ss = try { ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(java.net.InetAddress.getByName(lan), port)) } } catch (e: Exception) { continue }
            socket = ss
            Thread({ loop(app, ss) }, "ha-server").apply { isDaemon = true }.start()
            Log.i(TAG, "smart home set up page on port $port")
            return port
        }
        return null
    }

    @Synchronized
    fun stop() {
        try { socket?.close() } catch (e: Exception) {}
        socket = null
        HaPhone.stop()
    }

    private fun loop(app: Context, ss: ServerSocket) {
        ss.soTimeout = 60_000
        while (!ss.isClosed) {
            val c = try { ss.accept() } catch (e: java.net.SocketTimeoutException) { null } catch (e: Exception) { return }
            // idle for 30 minutes since the TV screen last asked: stop, whether or not phones keep asking
            if (System.currentTimeMillis() - lastAsked > IDLE_MS) { try { c?.close() } catch (e: Exception) {}; stop(); return }
            if (c == null) continue
            pool.execute { try { serve(app, c) } catch (e: Exception) {} finally { try { c.close() } catch (e: Exception) {} } }
        }
    }

    private fun line(inp: InputStream): String? {
        val out = ByteArrayOutputStream()
        while (true) {
            val b = inp.read()
            if (b < 0) return if (out.size() == 0) null else out.toString("ISO-8859-1")
            if (b == '\n'.code) return out.toString("ISO-8859-1").trimEnd('\r')
            out.write(b)
            if (out.size() > 8192) return null
        }
    }

    internal fun query(q: String?): Map<String, String> = (q ?: "").split('&').filter { it.isNotEmpty() }.associate {
        val k = it.substringBefore('='); val v = it.substringAfter('=', "")
        (try { URLDecoder.decode(k, "UTF-8") } catch (e: Exception) { k }) to (try { URLDecoder.decode(v, "UTF-8") } catch (e: Exception) { v })
    }

    private fun serve(app: Context, c: Socket) {
        c.soTimeout = 5_000
        val inp = BufferedInputStream(c.getInputStream())
        val first = line(inp) ?: return
        val parts = first.split(' ')
        if (parts.size < 3) return
        val method = parts[0]
        val target = parts[1]
        val headers = HashMap<String, String>()
        var count = 0
        while (true) {
            val h = line(inp) ?: return
            if (h.isEmpty()) break
            if (++count > 64) return
            headers[h.substringBefore(':').trim().lowercase()] = h.substringAfter(':', "").trim()
        }
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        if (len < 0 || len > 64 * 1024) { write(c, HaPhone.Reply(413, "text/plain", "Too large".toByteArray())); return }
        val buf = ByteArray(len)
        var read = 0
        while (read < len) { val n = inp.read(buf, read, len - read); if (n < 0) break; read += n }
        val path = target.substringBefore('?')
        val reply = HaPhone.handle(app, method, path, query(target.substringAfter('?', "")), String(buf, 0, read, Charsets.UTF_8), headers["host"], c.localPort) {
            name -> try { app.assets.open("www/tv/$name").use { it.readBytes() } } catch (e: Exception) { null }
        } ?: HaPhone.Reply(404, "text/plain", "Not found".toByteArray())
        write(c, reply)
    }

    private fun write(c: Socket, r: HaPhone.Reply) {
        val reason = when (r.status) { 200 -> "OK"; 302 -> "Found"; 403 -> "Forbidden"; 404 -> "Not Found"; 413 -> "Payload Too Large"; else -> "Status" }
        val head = StringBuilder("HTTP/1.1 ${r.status} $reason\r\n")
            .append("Content-Type: ${r.type}\r\nContent-Length: ${r.body.size}\r\nCache-Control: no-store\r\n")
            .append("Referrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n")
        r.location?.let { head.append("Location: $it\r\n") }
        head.append("\r\n")
        val out = c.getOutputStream()
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        out.write(r.body)
        out.flush()
    }
}
