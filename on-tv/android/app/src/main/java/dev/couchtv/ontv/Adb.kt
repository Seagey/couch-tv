package dev.couchtv.ontv

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import io.github.muntashirakon.adb.AdbStream
import io.github.muntashirakon.adb.android.AdbMdns
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.math.BigInteger
import java.net.InetAddress
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The TV talking to its own ADB, so it can press keys in other apps, type, and read what is playing.
 *
 * Two routes, tried in this order:
 *  1. "tcp": plain ADB on 127.0.0.1:5555. Older Android TV, Fire OS, and any TV where network
 *     debugging (or `adb tcpip 5555` from a computer) is on. The TV asks "Allow debugging?" once.
 *  2. "tls": Android 11+ wireless debugging. Paired once with the 6 digit code from
 *     Developer options > Wireless debugging > Pair device with pairing code. The connect port is
 *     random, so it is found by mDNS (_adb-tls-connect._tcp) on every start.
 *
 * The app's own RSA key and certificate are made on first run and kept in the app's private files.
 */
object Adb {
    private const val TAG = "couchtv.adb"
    private lateinit var ctx: Context
    private val io = Executors.newCachedThreadPool()
    private val lock = Any()

    @Volatile var route: String? = null; private set          // "tcp" | "tls" | null
    @Volatile var state: String = "off"; private set           // off | connecting | waiting_for_allow | connected | needs_pairing | failed
    @Volatile var lastError: String? = null; private set
    @Volatile var tlsPort: Int? = null; private set

    private val mgr by lazy { Manager(ctx) }

    /** The app's ADB key pair, for the step-by-step diagnostic (AdbDiag). */
    fun keyPair(): Pair<PrivateKey, java.security.interfaces.RSAPublicKey> = mgr.key to (mgr.cert.publicKey as java.security.interfaces.RSAPublicKey)

    fun init(c: Context) { ctx = c.applicationContext }

    // Our own flag, never the library's: its isConnected() takes a lock that connect() holds while
    // waiting for "Allow", and calling it from the UI thread froze the setup screen (ANR in testing).
    val connected: Boolean get() = route != null
    val paired: Boolean get() = Store.bool("adb_tls_paired")
    val everAllowed: Boolean get() = Store.bool("adb_ok_once")

    fun status(): Map<String, Any?> = mapOf(
        "connected" to connected, "route" to route, "state" to state, "error" to lastError,
        "tls_paired" to paired, "tls_port" to tlsPort, "ever_allowed" to everAllowed,
        "can_self_enable" to canWriteSecure(), "overlay" to Settings.canDrawOverlays(ctx),
        "sdk" to Build.VERSION.SDK_INT, "probe" to lastProbe,
    )

    /**
     * Connect if not connected. interactive=true waits up to 2 minutes for someone to press "Allow" on
     * the TV; background calls wait 8 s and never start a pairing. preferTls tries wireless
     * debugging first (used straight after pairing).
     */
    fun ensure(interactive: Boolean = false, preferTls: Boolean = false): Boolean = synchronized(lock) {
        if (connected) return true
        Log.i(TAG, "ensure(interactive=$interactive, preferTls=$preferTls)")
        closeQuietly()
        state = "connecting"
        lastError = null
        // Some Android 13+ Google TVs never show "Allow debugging?" for a new key on 5555 (seen on one
        // TV after its Google home was switched off), so do not make people wait 2 minutes there.
        allowSeconds = if (!interactive) 8L else if (Build.VERSION.SDK_INT >= 33 && !Store.bool("adb_ok_tcp")) 45L else 120L
        mgr.setTimeout(allowSeconds, TimeUnit.SECONDS)
        // Paired TVs use wireless debugging first. Plain 5555 is tried in the background only once it
        // has been allowed before, so a background retry never pops "Allow debugging?" over a show.
        val order = if (preferTls || paired) listOf("tls", "tcp") else listOf("tcp", "tls")
        for (r in order) {
            val ok = if (r == "tcp") (interactive || Store.bool("adb_ok_tcp")) && tryTcp() else tryTls(interactive)
            if (ok) return true
        }
        route = null
        state = if (!paired && Build.VERSION.SDK_INT >= 30 && !portOpen(5555)) "needs_pairing" else "failed"
        false
    }

    @Volatile var lastProbe: String? = null; private set
    @Volatile private var allowSeconds = 8L

    /**
     * Plain ADB on port 5555: 127.0.0.1 first, then the TV's own network address (some adbd builds
     * treat the two differently). Each address is probed with a bare CNXN first, so a daemon that
     * accepts the socket but never answers fails in seconds with a clear error, instead of the
     * library waiting the whole Allow timeout.
     */
    private fun tryTcp(): Boolean {
        val hosts = listOfNotNull("127.0.0.1", App.lanAddress()).distinct()
        for (host in hosts) {
            if (!portOpen(5555, host)) { Log.i(TAG, "tcp $host:5555 closed"); continue }
            val probe = probeCnxn(host, 5555, 5000)
            lastProbe = "$host:5555 $probe"
            Log.i(TAG, "tcp probe $host:5555 -> $probe")
            if (!probe.startsWith("AUTH") && !probe.startsWith("CNXN") && !probe.startsWith("STLS")) {
                note("$host:5555 accepted the connection but adbd did not answer the handshake ($probe)")
                continue
            }
            if (connectWatched(host, 5555, "tcp")) return true
        }
        return false
    }

    /**
     * Runs the library's connect with our own watchdog (its timeout plus 10 s). If it hangs, the
     * socket is closed from outside so the call returns and the error says where it stopped.
     */
    private fun connectWatched(host: String, port: Int, r: String): Boolean {
        state = if (r == "tcp") "waiting_for_allow" else "connecting"
        val limitMs = allowSeconds * 1000 + 10_000
        Log.i(TAG, "$r $host:$port: library connect start (waits up to $allowSeconds s for Allow, watchdog ${limitMs / 1000} s)")
        val started = System.currentTimeMillis()
        val f = io.submit<Boolean> { mgr.connect(host, port) }
        try {
            val ok = f.get(limitMs, TimeUnit.MILLISECONDS)
            Log.i(TAG, "$r $host:$port: library connect returned $ok after ${System.currentTimeMillis() - started} ms")
            if (ok) return onConnected(r)
            note("$host:$port: no answer to \"Allow debugging?\" in time (or the TV refused)." +
                if (Build.VERSION.SDK_INT >= 33) " On Android 13+ the TV may never ask: pair wireless debugging on the setup page instead." else " Press Connect again.")
        } catch (e: java.util.concurrent.TimeoutException) {
            note("$host:$port: library connect hung for ${limitMs / 1000} s, closed it")
            // getAdbConnection() waits on the lock the hung connect() holds, so reach the field directly
            runCatching {
                val fld = AbsAdbConnectionManager::class.java.getDeclaredField("mAdbConnection").apply { isAccessible = true }
                (fld.get(mgr) as? java.io.Closeable)?.close()
            }.onFailure { Log.w(TAG, "could not close the hung connection: ${it.message}") }
            f.cancel(true)
        } catch (e: java.util.concurrent.ExecutionException) {
            val c = e.cause ?: e
            note("$host:$port: ${c.javaClass.simpleName}: ${c.message}")
        } catch (e: Throwable) { note("$host:$port: ${e.javaClass.simpleName}: ${e.message}") }
        closeQuietly()   // a half-open connection would make the next connect() return false at once
        return false
    }

    /**
     * Sends one plain CNXN and reports the first packet adbd sends back: "AUTH token" (normal for a
     * secure adbd), "CNXN" (already trusted, or insecure), "STLS" (a TLS-only port), or why none came.
     */
    fun probeCnxn(host: String, port: Int, ms: Int): String {
        val t0 = System.currentTimeMillis()
        return try {
            java.net.Socket().use { s ->
                s.tcpNoDelay = true
                s.connect(java.net.InetSocketAddress(host, port), 2000)
                s.soTimeout = ms
                val payload = "host::features=shell_v2,cmd,stat_v2\u0000".toByteArray()
                val cmd = 0x4e584e43   // "CNXN"
                val head = java.nio.ByteBuffer.allocate(24).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                    .putInt(cmd).putInt(0x01000001).putInt(256 * 1024).putInt(payload.size)
                    .putInt(payload.sumOf { it.toInt() and 0xff }).putInt(cmd.inv()).array()
                s.getOutputStream().apply { write(head + payload); flush() }
                val buf = ByteArray(24); var n = 0
                while (n < 24) { val r = s.getInputStream().read(buf, n, 24 - n); if (r < 0) return "closed by adbd after ${System.currentTimeMillis() - t0} ms"; n += r }
                val bb = java.nio.ByteBuffer.wrap(buf).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                val c = bb.int; val a0 = bb.int; val a1 = bb.int
                val name = String(byteArrayOf(c.toByte(), (c shr 8).toByte(), (c shr 16).toByte(), (c shr 24).toByte()), Charsets.US_ASCII)
                "$name arg0=0x${a0.toString(16)} arg1=$a1 in ${System.currentTimeMillis() - t0} ms"
            }
        } catch (e: java.net.SocketTimeoutException) {
            "no reply in $ms ms"
        } catch (e: Exception) {
            "${e.javaClass.simpleName}: ${e.message}"
        }
    }

    /** Wireless debugging, once paired. The port is random, so it is found by mDNS every time. */
    private fun tryTls(interactive: Boolean): Boolean {
        if (!paired || Build.VERSION.SDK_INT < 30) return false
        selfEnableWireless()
        val port = discover(AdbMdns.SERVICE_TYPE_TLS_CONNECT, if (interactive) 10_000 else 6_000)
        if (port == null) { note("wireless debugging not found (is it switched on, and is the TV on Wi-Fi?)"); return false }
        tlsPort = port
        Log.i(TAG, "wireless debugging on port $port")
        return connectWatched("127.0.0.1", port, "tls")
    }

    private fun note(msg: String) {
        lastError = (lastError?.let { "$it; " } ?: "") + msg
        Log.w(TAG, msg)
    }

    /**
     * Pair with this TV's wireless debugging. The TV must be showing the "Pair device with pairing
     * code" dialog. port is optional: found by mDNS when left out.
     */
    fun pair(code: String, port: Int?): Map<String, Any?> = synchronized(lock) {
        if (Build.VERSION.SDK_INT < 30) return mapOf("ok" to false, "error" to "Wireless debugging needs Android 11 or newer. Use network debugging on port 5555.")
        val p = port ?: discover(AdbMdns.SERVICE_TYPE_TLS_PAIRING, 10_000)
            ?: return mapOf("ok" to false, "error" to "Could not find the pairing dialog. Open Developer options > Wireless debugging > Pair device with pairing code on the TV, or type the port shown there.")
        return try {
            val ok = mgr.pair("127.0.0.1", p, code.trim())
            if (!ok) mapOf("ok" to false, "error" to "Pairing was refused. Check the code and try again.")
            else {
                Store.putBool("adb_tls_paired", true)
                lastError = null
                mapOf("ok" to true, "paired_port" to p)
            }
        } catch (e: Exception) {
            Log.w(TAG, "pair", e)
            mapOf("ok" to false, "error" to "Pairing failed: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun onConnected(r: String): Boolean {
        route = r; state = "connected"; lastError = null
        Store.putBool("adb_ok_once", true)
        if (r == "tcp") Store.putBool("adb_ok_tcp", true)
        Log.i(TAG, "connected over $r")
        // One-off grants that make the app work better, and keep working when ADB is off:
        //  - draw over other apps: lets the app open other apps with plain intents from the background
        //  - write secure settings: lets the app switch wireless debugging back on after a reboot
        io.execute {
            runCatching { shell("appops set ${BuildConfig.APPLICATION_ID} SYSTEM_ALERT_WINDOW allow", 8000) }
            if (Build.VERSION.SDK_INT >= 30) runCatching { shell("pm grant ${BuildConfig.APPLICATION_ID} android.permission.WRITE_SECURE_SETTINGS", 8000) }
            FireHome.poke()
        }
        return true
    }

    /** Android 11+ turns wireless debugging off after a reboot. With the secure-settings grant, turn it back on. */
    fun selfEnableWireless(): Boolean {
        if (Build.VERSION.SDK_INT < 30 || !canWriteSecure()) return false
        return try {
            val cr = ctx.contentResolver
            if (Settings.Global.getInt(cr, Settings.Global.ADB_ENABLED, 0) != 1) Settings.Global.putInt(cr, Settings.Global.ADB_ENABLED, 1)
            if (Settings.Global.getInt(cr, "adb_wifi_enabled", 0) != 1) {
                Settings.Global.putInt(cr, "adb_wifi_enabled", 1)
                Thread.sleep(1500)
            }
            true
        } catch (e: Exception) { Log.w(TAG, "self enable", e); false }
    }

    private fun canWriteSecure() = ctx.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED

    private fun discover(type: String, ms: Long): Int? {
        val found = AtomicInteger(-1)
        val latch = CountDownLatch(1)
        val mdns = AdbMdns(ctx, type) { _: InetAddress?, port: Int -> if (port > 0) { found.set(port); latch.countDown() } }
        return try {
            mdns.start()
            latch.await(ms, TimeUnit.MILLISECONDS)
            found.get().takeIf { it > 0 }
        } catch (e: Exception) { null } finally { runCatching { mdns.stop() } }
    }

    private fun portOpen(port: Int, host: String = "127.0.0.1") = try {
        java.net.Socket().use { it.connect(java.net.InetSocketAddress(host, port), 400); true }
    } catch (e: Exception) { false }

    fun disconnect() = synchronized(lock) { closeQuietly(); route = null; state = "off" }

    private fun closeQuietly() {
        route = null
        keyShell = null
        runCatching { mgr.disconnect() }
    }

    // ---------------------------------------------------------------- running things

    /** Runs a shell command and returns its output. Throws if ADB is not connected. */
    fun shell(cmd: String, timeoutMs: Long = 15_000): String = String(exec("shell:$cmd", timeoutMs), Charsets.UTF_8)

    // One ADB command at a time: the library numbers new streams without a lock, and two opened
    // at once (the now-playing poll and a launch check) got mixed up in testing.
    private val execLock = java.util.concurrent.locks.ReentrantLock(true)

    /**
     * A long-lived stream (a logcat follow, say). The caller owns it: reads it until it dies and
     * closes it. The lock is held only while the stream opens, like the key shell.
     */
    fun stream(service: String): AdbStream {
        if (!connected && (!(everAllowed || paired) || !ensure())) throw IllegalStateException("ADB is not connected")
        if (!execLock.tryLock(15_000, TimeUnit.MILLISECONDS)) throw IllegalStateException("ADB is busy")
        return try { mgr.openStream(service) } finally { execLock.unlock() }
    }

    /** Binary output, for `exec:screencap -p`. */
    fun exec(service: String, timeoutMs: Long = 15_000): ByteArray {
        if (!execLock.tryLock(timeoutMs, TimeUnit.MILLISECONDS)) throw IllegalStateException("ADB is busy")
        try { return execLocked(service, timeoutMs) } finally { execLock.unlock() }
    }

    private fun execLocked(service: String, timeoutMs: Long): ByteArray {
        if (!connected && (!(everAllowed || paired) || !ensure())) throw IllegalStateException("ADB is not connected")
        val stream: AdbStream = try { mgr.openStream(service) } catch (e: Exception) {
            // The connection went stale (TV slept, adbd restarted). Reconnect once.
            route = null
            if (!ensure()) throw IllegalStateException("ADB is not connected")
            mgr.openStream(service)
        }
        val f = io.submit<ByteArray> {
            val out = ByteArrayOutputStream()
            stream.openInputStream().use { inp ->
                val buf = ByteArray(16384)
                while (true) { val n = try { inp.read(buf) } catch (e: Exception) { -1 }; if (n < 0) break; out.write(buf, 0, n) }
            }
            out.toByteArray()
        }
        return try { f.get(timeoutMs, TimeUnit.MILLISECONDS) } catch (e: Exception) {
            runCatching { stream.close() }
            throw IllegalStateException("ADB command timed out: ${service.take(60)}")
        }
    }

    // A long-lived shell for key presses, so a press does not wait for a new stream and its output.
    @Volatile private var keyShell: Pair<AdbStream, OutputStream>? = null

    /** Fire and forget: writes a command into the persistent shell. */
    fun quick(cmd: String) {
        if (!connected && (!(everAllowed || paired) || !ensure())) throw IllegalStateException("ADB is not connected")
        for (attempt in 0..1) {
            try {
                val ks = keyShell ?: openKeyShell()
                ks.second.write((cmd + "\n").toByteArray())
                ks.second.flush()
                return
            } catch (e: Exception) {
                keyShell = null
                if (attempt == 1) throw IllegalStateException("ADB shell failed: ${e.message}")
                // the connection may have gone stale (TV slept, adbd restarted): reconnect once
                route = null
                if (!ensure()) throw IllegalStateException("ADB is not connected")
            }
        }
    }

    private fun openKeyShell(): Pair<AdbStream, OutputStream> {
        execLock.lock()
        val s = try { mgr.openStream("shell:") } finally { execLock.unlock() }
        val out = s.openOutputStream()
        // drain the shell's output so it never blocks
        io.execute { runCatching { s.openInputStream().use { val b = ByteArray(4096); while (it.read(b) >= 0) { } } }; if (keyShell?.first === s) keyShell = null }
        return (s to out).also { keyShell = it }
    }

    // ---------------------------------------------------------------- key and certificate

    private class Manager(c: Context) : AbsAdbConnectionManager() {
        val key: PrivateKey
        val cert: Certificate

        init {
            setApi(Build.VERSION.SDK_INT)
            setThrowOnUnauthorised(false)   // wait for "Allow" on the TV instead of failing at once
            val dir = File(c.filesDir, "adb").apply { mkdirs() }
            val kf = File(dir, "key.pk8"); val cf = File(dir, "cert.der")
            if (kf.isFile && cf.isFile) {
                key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(kf.readBytes()))
                cert = CertificateFactory.getInstance("X.509").generateCertificate(cf.inputStream())
            } else {
                val kpg = KeyPairGenerator.getInstance("RSA"); kpg.initialize(2048, SecureRandom())
                val kp = kpg.generateKeyPair()
                val name = X500Name("CN=couch-tv")
                val now = Date()
                val holder = JcaX509v3CertificateBuilder(name, BigInteger.valueOf(SecureRandom().nextLong() and Long.MAX_VALUE),
                    Date(now.time - 86_400_000L), Date(now.time + 20L * 365 * 86_400_000L), name, kp.public)
                    .build(JcaContentSignerBuilder("SHA256withRSA").build(kp.private))
                key = kp.private
                cert = JcaX509CertificateConverter().getCertificate(holder)
                kf.writeBytes(key.encoded)
                cf.writeBytes(cert.encoded)
            }
        }

        override fun getPrivateKey() = key
        override fun getCertificate() = cert
        override fun getDeviceName() = "couch-tv"
    }
}
