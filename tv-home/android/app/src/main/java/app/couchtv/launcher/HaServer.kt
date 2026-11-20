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
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Smart home set up from a phone when the launcher runs no other server. With no computer at home
 * (option A) the phone's Home settings page server (PhoneServer.kt, 5400 or 5401) is running and
 * answers /ha itself, so this one never starts (HaPage.phone asks MainActivity.phonePagePort first):
 * one launcher server, not two. Otherwise (a computer at home that the launcher talks to) this small
 * one answers /ha (HaPhone.kt) and nothing else, and only while someone is setting up: it starts when
 * Home settings, Smart home opens and stops by itself 30 minutes after the screen last asked for it.
 * Plain HTTP on the home network address only, one short request per connection, at most 64 KB a body.
 * Its ports, 5402 to 5409, are never the phone page's (5400, 5401) nor the on-TV app's (5400), so
 * neither can take the other's port whichever starts first.
 */
object HaServer {
    private const val TAG = "couchtv.haserver"
    private const val IDLE_MS = 30 * 60_000L
    /** Never PhoneServer.PORT or PORT + 1 (the phone page) nor 5400 (the on-TV app). */
    internal val PORTS = 5402..5409
    @Volatile private var socket: ServerSocket? = null
    @Volatile private var lastAsked = 0L
    // enough for a phone page and its few files at once: 8 at work and 16 waiting; more than that and the
    // connection is closed at once. A silent client is dropped after 5 s, a slow one after 10 s in all.
    private val pool = ThreadPoolExecutor(8, 8, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(16))
    /** The most one request (its first line, headers and body) may take to arrive. Tests make it shorter. */
    @Volatile internal var requestMs = 10_000L

    /** Hands [c] to the pool, or closes it when the pool is full. False when it was closed. */
    internal fun hand(c: Socket, work: () -> Unit): Boolean = try {
        pool.execute { try { work() } catch (e: Exception) {} finally { try { c.close() } catch (e: Exception) {} } }
        true
    } catch (e: RejectedExecutionException) { try { c.close() } catch (x: Exception) {}; false }

    /** Starts it if it is not running; the port it listens on, or null when none was free. */
    @Synchronized
    fun ensure(ctx: Context): Int? {
        lastAsked = System.currentTimeMillis()
        socket?.takeIf { !it.isClosed }?.let { return it.localPort }
        val app = ctx.applicationContext
        // only on the home network address the QR code names, never every interface
        val lan = HaPhone.lanAddress(app) ?: return null
        for (port in PORTS) {
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
            hand(c) { serve(app, c) }
        }
    }

    /** Before each read: wait at most 5 s, and never past the request's deadline (System.nanoTime). */
    private fun left(c: Socket, until: Long): Boolean {
        val ms = (until - System.nanoTime()) / 1_000_000
        if (ms <= 0) return false
        c.soTimeout = minOf(5_000L, ms).toInt().coerceAtLeast(1)
        return true
    }

    private fun line(c: Socket, inp: InputStream, until: Long): String? {
        val out = ByteArrayOutputStream()
        while (true) {
            if (!left(c, until)) return null
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

    internal class Request(val method: String, val target: String, val headers: Map<String, String>, val body: String)
    internal class TooLarge : Exception()

    /** One request off [c]: null when it is broken, silent for 5 s or not all there within [requestMs]. */
    internal fun read(c: Socket): Request? {
        val until = System.nanoTime() + requestMs * 1_000_000
        val inp = BufferedInputStream(c.getInputStream())
        try {
            val first = line(c, inp, until) ?: return null
            val parts = first.split(' ')
            if (parts.size < 3) return null
            val headers = HashMap<String, String>()
            var count = 0
            while (true) {
                val h = line(c, inp, until) ?: return null
                if (h.isEmpty()) break
                if (++count > 64) return null
                headers[h.substringBefore(':').trim().lowercase()] = h.substringAfter(':', "").trim()
            }
            val len = headers["content-length"]?.toIntOrNull() ?: 0
            if (len < 0 || len > 64 * 1024) throw TooLarge()
            val buf = ByteArray(len)
            var read = 0
            while (read < len) {
                if (!left(c, until)) return null
                val n = inp.read(buf, read, len - read); if (n < 0) break; read += n
            }
            return Request(parts[0], parts[1], headers, String(buf, 0, read, Charsets.UTF_8))
        } catch (e: java.net.SocketTimeoutException) { return null }
    }

    private fun serve(app: Context, c: Socket) {
        val req = try { read(c) } catch (e: TooLarge) { write(c, HaPhone.Reply(413, "text/plain", "Too large".toByteArray())); return } ?: return
        val target = req.target
        val path = target.substringBefore('?')
        val reply = HaPhone.handle(app, req.method, path, query(target.substringAfter('?', "")), req.body, req.headers["host"], c.localPort) {
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
