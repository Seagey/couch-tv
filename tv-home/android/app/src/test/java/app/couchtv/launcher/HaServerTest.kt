package app.couchtv.launcher

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The launcher's small smart home set up server (HaServer.kt), over real sockets on this computer: one
 * request must all be there within its deadline however slowly it drips in, a silent client is dropped,
 * and when every worker is busy and the queue is full a new connection is closed at once.
 */
class HaServerTest {
    private val ss = ServerSocket(0, 50, InetAddress.getLoopbackAddress())

    @After fun tearDown() { HaServer.requestMs = 10_000L; ss.close() }

    /** A client on the other end of a fresh connection, and the server's side of it. */
    private fun pair(): Pair<Socket, Socket> {
        val client = Socket(InetAddress.getLoopbackAddress(), ss.localPort)
        return client to ss.accept()
    }

    @Test fun aWholeRequestIsRead() {
        val (client, server) = pair()
        client.getOutputStream().write("POST /ha/api/save HTTP/1.1\r\nHost: 192.0.2.7:5402\r\nContent-Length: 7\r\n\r\n{\"k\":1}".toByteArray())
        val r = HaServer.read(server)
        assertNotNull(r)
        assertEquals("POST", r!!.method); assertEquals("/ha/api/save", r.target)
        assertEquals("192.0.2.7:5402", r.headers["host"]); assertEquals("{\"k\":1}", r.body)
        client.close(); server.close()
    }

    @Test fun aSlowDripClientIsDroppedAtTheDeadline() {
        HaServer.requestMs = 1_500L
        val (client, server) = pair()
        // one byte every 200 ms, never finishing the headers: each read is well inside 5 s, the whole is not
        val drip = Thread {
            try {
                val out = client.getOutputStream()
                out.write("GET /ha/ HTTP/1.1\r\n".toByteArray())
                while (true) { out.write('X'.code); out.flush(); Thread.sleep(200) }
            } catch (e: Exception) {}
        }.apply { isDaemon = true; start() }
        val t0 = System.nanoTime()
        assertNull(HaServer.read(server))
        val ms = (System.nanoTime() - t0) / 1_000_000
        assertTrue("dropped after $ms ms", ms in 1_400..2_600)
        server.close(); client.close(); drip.join(2_000)
    }

    @Test fun aSlowDripBodyIsDroppedAtTheDeadline() {
        HaServer.requestMs = 1_500L
        val (client, server) = pair()
        val drip = Thread {
            try {
                val out = client.getOutputStream()
                out.write("POST /ha/api/save HTTP/1.1\r\nHost: 192.0.2.7:5402\r\nContent-Length: 60000\r\n\r\n".toByteArray())
                while (true) { out.write('a'.code); out.flush(); Thread.sleep(150) }
            } catch (e: Exception) {}
        }.apply { isDaemon = true; start() }
        val t0 = System.nanoTime()
        assertNull(HaServer.read(server))
        val ms = (System.nanoTime() - t0) / 1_000_000
        assertTrue("dropped after $ms ms", ms in 1_400..2_600)
        server.close(); client.close(); drip.join(2_000)
    }

    @Test fun aSilentClientIsDroppedAfterFiveSeconds() {
        val (client, server) = pair()
        val t0 = System.nanoTime()
        assertNull(HaServer.read(server))
        val ms = (System.nanoTime() - t0) / 1_000_000
        assertTrue("dropped after $ms ms", ms in 4_800..6_500)
        server.close(); client.close()
    }

    @Test fun aFullPoolClosesNewConnectionsAtOnce() {
        val release = CountDownLatch(1)
        val started = CountDownLatch(8)
        val conns = mutableListOf<Pair<Socket, Socket>>()
        val handed = mutableListOf<Boolean>()
        try {
            // 8 at work and 16 waiting fill it; the next ones are closed straight away
            repeat(30) {
                val p = pair(); conns += p
                handed += HaServer.hand(p.second) { started.countDown(); release.await(20, TimeUnit.SECONDS) }
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            assertEquals(24, handed.count { it })
            assertEquals(6, handed.count { !it })
            for (i in 24 until 30) {
                assertTrue("connection $i closed on our side", conns[i].second.isClosed)
                conns[i].first.soTimeout = 2_000
                assertEquals("connection $i: the client sees it closed", -1, conns[i].first.getInputStream().read())
            }
            for (i in 0 until 24) assertFalse(conns[i].second.isClosed)
        } finally {
            release.countDown()
            Thread.sleep(300)
            conns.forEach { (a, b) -> a.close(); b.close() }
        }
    }
}
