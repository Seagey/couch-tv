package dev.couchtv.ontv.matter

import dev.couchtv.ontv.matter.DiscoveryDns.DnsName
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * Asks the network itself for Matter devices, over plain java.net sockets (no Android calls), so it
 * also runs on a computer: DiscoveryLiveTest uses it against the real home network.
 *
 * Two sockets, because each one alone misses devices:
 *  - a "one-shot" socket on a free port: every responder must answer it by unicast (RFC 6762 5.1).
 *    Bonjour (Apple, the eero, the macOS virtual light) answers it with every A and AAAA record.
 *  - a socket on 5353 that joins 224.0.0.251 and ff02::fb: some responders (Matter's own minimal
 *    mDNS on many devices, the Thread advertising proxies) only answer by multicast. Android's own
 *    mDNS service holds 5353 too; SO_REUSEADDR lets both listen. If 5353 can't be had, the one-shot
 *    socket still works.
 * Queries go out at 0 s, 1 s and 3 s (RFC 6762 5.2), each round also asking for anything still
 * missing (SRV, TXT, AAAA) for instances heard so far.
 */
class DiscoveryMdns(
    private val interfaces: () -> List<NetworkInterface> = { usableInterfaces() },
    private val log: (String) -> Unit = {},
) {
    data class Stats(val sent: Int, val received: Int, val badPackets: Int, val listenedOn5353: Boolean, val interfaces: List<String>)

    companion object {
        val GROUP4: InetAddress = InetAddress.getByAddress(byteArrayOf(224.toByte(), 0, 0, 251.toByte()))
        val GROUP6_BYTES = ByteArray(16).also { it[0] = 0xff.toByte(); it[1] = 0x02; it[15] = 0xfb.toByte() }
        const val PORT = 5353

        /** Up, multicast-capable, not loopback, not a tunnel or a phone data link; Wi-Fi and Ethernet first. */
        fun usableInterfaces(): List<NetworkInterface> = try {
            NetworkInterface.getNetworkInterfaces()?.toList().orEmpty().filter { n ->
                runCatching { n.isUp && !n.isLoopback && n.supportsMulticast() && !n.isPointToPoint && !n.isVirtual }.getOrDefault(false) &&
                    n.inetAddresses.toList().isNotEmpty() &&
                    !Regex("^(tun|ppp|rmnet|ccmni|dummy|p2p|utun|awdl|llw|bridge|veth|docker|ap|ipsec|ifb)").containsMatchIn(n.name)
            }.sortedBy { if (Regex("^(wlan|eth|en|wl)").containsMatchIn(it.name)) 0 else 1 }
        } catch (e: Exception) { emptyList() }

        fun group6(nif: NetworkInterface): InetAddress = Inet6Address.getByAddress(null, GROUP6_BYTES, nif)
    }

    /**
     * Sends [questions] (and the follow-ups the collector asks for) for [timeoutMs], feeding every
     * answer to [collector] (locked on [collector] itself). Returns early when [done] says so.
     */
    fun run(
        questions: List<Pair<DnsName, Int>>,
        collector: DiscoveryModel.Collector,
        timeoutMs: Long,
        done: (() -> Boolean)? = null,
    ): Stats {
        val ifs = interfaces()
        var sent = 0; var received = 0; var bad = 0
        val oneShot = runCatching { MulticastSocket(0).apply { soTimeout = 150; timeToLive = 255 } }.getOrNull()
        val listener = runCatching {
            MulticastSocket(null as java.net.SocketAddress?).apply {
                reuseAddress = true
                bind(InetSocketAddress(PORT))
                soTimeout = 150
                timeToLive = 255
            }
        }.onFailure { log("mdns: no 5353 listener: ${it.message}") }.getOrNull()
        if (listener != null) for (nif in ifs) {
            runCatching { listener.joinGroup(InetSocketAddress(GROUP4, PORT), nif) }
            runCatching { listener.joinGroup(InetSocketAddress(group6(nif), PORT), nif) }
        }
        val sockets = listOfNotNull(oneShot, listener)
        if (sockets.isEmpty()) return Stats(0, 0, 0, false, ifs.map { it.name })

        val stop = java.util.concurrent.atomic.AtomicBoolean(false)
        val readers = sockets.map { s ->
            Thread({
                val buf = ByteArray(9000)
                while (!stop.get()) {
                    val p = DatagramPacket(buf, buf.size)
                    try { s.receive(p) } catch (e: SocketTimeoutException) { continue } catch (e: Exception) { break }
                    val msg = try { DiscoveryDns.parse(p.data.copyOfRange(p.offset, p.offset + p.length)) }
                        catch (e: Exception) { synchronized(collector) { bad++ }; continue }
                    if (!msg.isResponse) continue
                    val zone = (p.address as? Inet6Address)?.scopedInterface?.name
                        ?: (p.address as? Inet6Address)?.scopeId?.takeIf { it > 0 }?.let { id -> ifs.firstOrNull { it.index == id }?.name }
                        ?: ifs.singleOrNull()?.name
                    synchronized(collector) { received++; collector.add(msg, "mdns", zone) }
                }
            }, "matter-mdns-read").apply { isDaemon = true; start() }
        }

        fun send(qs: List<Pair<DnsName, Int>>) {
            if (qs.isEmpty()) return
            // Keep each packet small: 8 questions a packet.
            for (chunk in qs.distinct().chunked(8)) {
                val oneShotBytes = DiscoveryDns.query(chunk, id = 0x4d54)
                val mcBytes = DiscoveryDns.query(chunk, id = 0)
                for (nif in ifs) {
                    val has4 = nif.inetAddresses.toList().any { it is Inet4Address }
                    val has6 = nif.inetAddresses.toList().any { it is Inet6Address }
                    for ((sock, bytes) in listOf(oneShot to oneShotBytes, listener to mcBytes)) {
                        if (sock == null) continue
                        runCatching { sock.networkInterface = nif }
                        if (has4) runCatching { sock.send(DatagramPacket(bytes, bytes.size, GROUP4, PORT)); sent++ }
                            .onFailure { log("mdns: v4 send on ${nif.name}: ${it.message}") }
                        if (has6) runCatching { sock.send(DatagramPacket(bytes, bytes.size, group6(nif), PORT)); sent++ }
                            .onFailure { log("mdns: v6 send on ${nif.name}: ${it.message}") }
                    }
                }
            }
        }

        val start = System.currentTimeMillis()
        val rounds = longArrayOf(0, 1000, 3000)
        var round = 0
        var followUpAt = 400L
        try {
            while (true) {
                val t = System.currentTimeMillis() - start
                if (t >= timeoutMs) break
                if (round < rounds.size && t >= rounds[round]) {
                    send(questions + synchronized(collector) { collector.missing() })
                    round++
                } else if (t >= followUpAt) {
                    send(synchronized(collector) { collector.missing() })
                    followUpAt += 700
                }
                if (done != null && t > 250 && synchronized(collector) { done() }) break
                Thread.sleep(50)
            }
        } finally {
            stop.set(true)
            readers.forEach { runCatching { it.join(400) } }
            sockets.forEach { runCatching { it.close() } }
        }
        return Stats(sent, received, bad, listener != null, ifs.map { it.name })
    }
}
