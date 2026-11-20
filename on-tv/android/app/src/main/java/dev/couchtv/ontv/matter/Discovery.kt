package dev.couchtv.ontv.matter

import android.content.Context
import android.net.ConnectivityManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import dev.couchtv.ontv.matter.DiscoveryDns.DnsName
import java.io.File
import java.net.DatagramSocket
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Finds Matter devices on the TV's network, Android 6 to 14. The API the Matter controller calls:
 *
 *  - [discover]: every Matter device in pairing mode (_matterc._udp) and every commissioned one
 *    (_matter._tcp), with all their IPv4 and IPv6 addresses, the Thread border routers, and a plain
 *    words diagnosis of whether this TV can reach Thread devices.
 *  - [findCommissionable]: the device a pairing code points at (by its discriminator).
 *  - [resolveOperational]: a commissioned device's current addresses and port, by node id.
 *  - [routeSnapshot] / [diagnose]: the Thread reachability check on its own.
 *
 * All calls block (seconds): call them off the main thread. Each runs NsdManager (Android's own mDNS)
 * and DiscoveryMdns (our own reader, for the IPv6 addresses NsdManager drops on Android 11 to 13)
 * side by side under a Wi-Fi multicast lock, and merges what both hear.
 */
class MatterDiscovery(context: Context, private val log: (String) -> Unit = {}) {
    private val app = context.applicationContext

    data class Result(
        val nodes: List<DiscoveryModel.Node>,
        val borderRouters: List<DiscoveryModel.BorderRouter>,
        val diagnosis: DiscoveryRoutes.Diagnosis,
        val stats: DiscoveryMdns.Stats?,
        val nsdFound: Int,
    )

    /** Everything Matter on the network. [timeoutMs] 3 to 8 seconds is right: devices answer within 1 s, sleepy ones later. */
    fun discover(timeoutMs: Long = 5000, useNsd: Boolean = true, extraRouteText: String? = null): Result {
        val c = DiscoveryModel.Collector()
        val (stats, nsd) = withLock {
            val nsdJob = if (useNsd) startNsd(listOf("_matterc._udp", "_matter._tcp", "_meshcop._udp"), c, timeoutMs) else null
            val s = DiscoveryMdns(log = log).run(DiscoveryModel.ALL_TYPES.map { it to DiscoveryDns.TYPE_PTR }, c, timeoutMs)
            s to (nsdJob?.finish() ?: 0)
        }
        val nodes: List<DiscoveryModel.Node>
        val routers: List<DiscoveryModel.BorderRouter>
        synchronized(c) { nodes = c.nodes(); routers = c.borderRouters() }
        val diag = diagnose(routers, nodes, extraRouteText)
        log("matter discovery: ${nodes.size} devices, ${routers.size} border routers, ${diag.code}; mdns $stats; nsd $nsd")
        return Result(nodes, routers, diag, stats, nsd)
    }

    /**
     * Devices in pairing mode matching [discriminator]. A manual pairing code (11 digits) only holds
     * the top 4 bits of the 12 bit discriminator: pass [short] = true for those. Null finds all.
     * Stops as soon as a match with an address is heard.
     */
    fun findCommissionable(discriminator: Int?, short: Boolean = false, timeoutMs: Long = 5000): List<DiscoveryModel.Node> {
        val c = DiscoveryModel.Collector()
        fun matches() = c.nodes().filter { it.kind == DiscoveryModel.Kind.COMMISSIONABLE && DiscoveryModel.matchesDiscriminator(it, discriminator, short) }
        val qs = ArrayList<Pair<DnsName, Int>>()
        qs += DiscoveryModel.COMMISSIONABLE to DiscoveryDns.TYPE_PTR
        // Subtype browse narrows the answers: _L<long> or _S<short> (Matter core 4.3.1.3).
        if (discriminator != null) qs += DnsName.mdns(if (short) "_S$discriminator" else "_L$discriminator", "_sub", "_matterc", "_udp") to DiscoveryDns.TYPE_PTR
        withLock {
            val nsdJob = startNsd(listOf("_matterc._udp"), c, timeoutMs)
            DiscoveryMdns(log = log).run(qs, c, timeoutMs) { matches().any { it.addresses.isNotEmpty() } }
            nsdJob?.finish()
        }
        return synchronized(c) { matches() }
    }

    /**
     * A commissioned device's addresses. With [compressedFabricId] (16 hex digits, from the
     * controller) it asks for the exact instance; without it, it browses and matches the node id.
     */
    fun resolveOperational(nodeId: Long, compressedFabricId: String? = null, timeoutMs: Long = 4000): DiscoveryModel.Node? {
        val c = DiscoveryModel.Collector()
        val qs = ArrayList<Pair<DnsName, Int>>()
        if (compressedFabricId != null) {
            val inst = DnsName(listOf(DiscoveryModel.operationalInstanceName(compressedFabricId, nodeId)) + DiscoveryModel.OPERATIONAL.labels)
            qs += inst to DiscoveryDns.TYPE_SRV; qs += inst to DiscoveryDns.TYPE_TXT
            // Matter 4.3.2.1: _I<fabric>._sub._matter._tcp lists one fabric's nodes.
            qs += DnsName.mdns("_I${compressedFabricId.uppercase()}", "_sub", "_matter", "_tcp") to DiscoveryDns.TYPE_PTR
        } else qs += DiscoveryModel.OPERATIONAL to DiscoveryDns.TYPE_PTR
        fun hit() = DiscoveryModel.pickOperational(c.nodes(), nodeId, compressedFabricId)
        withLock {
            val nsdJob = startNsd(listOf("_matter._tcp"), c, timeoutMs)
            DiscoveryMdns(log = log).run(qs, c, timeoutMs) { hit()?.addresses?.isNotEmpty() == true }
            nsdJob?.finish()
        }
        return synchronized(c) { hit() }
    }

    /**
     * One service instance, as the Matter controller asks for it ("6DD5...-0000...7A11",
     * "_matter._tcp"), by our own mDNS only: the controller's resolver runs Android's NsdManager
     * beside it. Null when nothing answered.
     */
    fun resolveInstance(instance: String, serviceType: String, timeoutMs: Long = 3000): DiscoveryModel.Node? {
        val svc = DnsName.of(serviceType.trim('.').removeSuffix(".local").trim('.') + ".local")
        val name = DnsName(listOf(instance) + svc.labels)
        val c = DiscoveryModel.Collector()
        fun hit() = c.nodes().firstOrNull { it.instance.equals(instance, true) }
        withLock {
            DiscoveryMdns(log = log).run(listOf(name to DiscoveryDns.TYPE_SRV, name to DiscoveryDns.TYPE_TXT), c, timeoutMs) {
                // Wait a moment past the first address so both IPv4 and IPv6 answers are in.
                hit()?.let { it.ipv6.isNotEmpty() || it.ipv4.isNotEmpty() } == true
            }
        }
        return synchronized(c) { hit() }
    }

    // ---------- Thread routes ----------

    @Volatile private var cachedSnap: Pair<Long, DiscoveryRoutes.Snapshot>? = null

    /** For Matter.threadRouteCheck: can the TV send to [address]? Routes are read again at most every 30 s. */
    fun canReach(address: java.net.InetAddress): Boolean {
        val now = System.currentTimeMillis()
        val snap = cachedSnap?.takeIf { now - it.first < 30_000 }?.second ?: routeSnapshot().also { cachedSnap = now to it }
        val text = address.hostAddress?.substringBefore('%') ?: return true
        return DiscoveryRoutes.canReach(address.address, snap, if (address is Inet6Address) kernelHasRoute(text) else null)
    }

    /** The TV's IPv6 routes and addresses: Android's LinkProperties, /proc/net/ipv6_route if readable, and [extraRouteText] (`ip -6 route` output, for example from the app's own ADB link). */
    fun routeSnapshot(extraRouteText: String? = null): DiscoveryRoutes.Snapshot {
        val routes = ArrayList<DiscoveryRoutes.Route>()
        val addrs = LinkedHashSet<String>()
        try {
            val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            @Suppress("DEPRECATION")
            val nets = (listOfNotNull(cm.activeNetwork) + cm.allNetworks.toList()).distinct()
            for (n in nets) {
                val lp = cm.getLinkProperties(n) ?: continue
                for (la in lp.linkAddresses) la.address.hostAddress?.let { addrs += it }
                for (r in lp.routes) {
                    val d = r.destination ?: continue
                    val p = DiscoveryAddr.parse(d.address.hostAddress ?: continue) ?: continue
                    if (p.size != 16) continue
                    val gw = r.gateway?.hostAddress?.substringBefore('%')?.takeIf { g -> DiscoveryAddr.parse(g)?.any { it.toInt() != 0 } == true }
                    routes += DiscoveryRoutes.Route(DiscoveryRoutes.Prefix(p, d.prefixLength), gw, r.`interface`)
                }
            }
        } catch (e: Exception) { log("matter routes: link properties: ${e.message}") }
        try {
            val f = File("/proc/net/ipv6_route")
            if (f.canRead()) routes += DiscoveryRoutes.parseProcIpv6Route(f.readText())
        } catch (e: Exception) { /* Android 10 and newer keep /proc/net from apps: expected */ }
        if (!extraRouteText.isNullOrBlank()) routes += DiscoveryRoutes.parseIpRoute(extraRouteText)
        if (addrs.isEmpty()) DiscoveryMdns.usableInterfaces().forEach { n -> n.inetAddresses.toList().forEach { a -> a.hostAddress?.let { addrs += it } } }
        return DiscoveryRoutes.Snapshot(routes.distinct(), addrs.map { it.substringBefore('%') }, Build.VERSION.SDK_INT)
    }

    fun diagnose(routers: List<DiscoveryModel.BorderRouter>, nodes: List<DiscoveryModel.Node>, extraRouteText: String? = null): DiscoveryRoutes.Diagnosis =
        DiscoveryRoutes.diagnose(routeSnapshot(extraRouteText), routers, nodes, ::kernelHasRoute)

    /** Asks the kernel: connecting a UDP socket picks a route or fails at once with "network unreachable". Sends nothing. */
    fun kernelHasRoute(address: String): Boolean? = try {
        DatagramSocket().use { s -> s.connect(InetSocketAddress(Inet6Address.getByName(address), 5540)); s.localAddress != null }
    } catch (e: java.net.SocketException) {
        if (e.message?.contains("unreachable", true) == true) false else null
    } catch (e: Exception) { null }

    // ---------- NsdManager ----------

    private inner class NsdJob(val nsd: NsdManager, val listeners: List<NsdManager.DiscoveryListener>, val resolver: Thread, val found: () -> Int) {
        fun finish(): Int {
            for (l in listeners) runCatching { nsd.stopServiceDiscovery(l) }
            resolver.interrupt()
            runCatching { resolver.join(500) }
            return found()
        }
    }

    /** Starts NsdManager browsing [types]; resolves each found service one at a time (Android before 14 allows only one resolve at once). */
    private fun startNsd(types: List<String>, c: DiscoveryModel.Collector, timeoutMs: Long): NsdJob? {
        val nsd = runCatching { app.getSystemService(Context.NSD_SERVICE) as NsdManager }.getOrNull() ?: return null
        val queue = LinkedBlockingQueue<NsdServiceInfo>()
        var count = 0
        val listeners = types.map { type ->
            object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) {}
                override fun onDiscoveryStopped(serviceType: String) {}
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { log("nsd: start $serviceType failed $errorCode") }
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
                override fun onServiceFound(info: NsdServiceInfo) { queue.offer(info) }
                override fun onServiceLost(info: NsdServiceInfo) {}
            }.also { l -> runCatching { nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, l) }.onFailure { log("nsd: $type: ${it.message}") } }
        }
        val deadline = System.currentTimeMillis() + timeoutMs
        val resolver = Thread({
            val seen = HashSet<String>()
            try {
                while (System.currentTimeMillis() < deadline) {
                    val info = queue.poll(200, TimeUnit.MILLISECONDS) ?: continue
                    if (!seen.add(info.serviceType + "/" + info.serviceName)) continue
                    val done = CountDownLatch(1)
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) { done.countDown() }
                        override fun onServiceResolved(si: NsdServiceInfo) {
                            try {
                                val addrs = ArrayList<String>()
                                if (Build.VERSION.SDK_INT >= 34) si.hostAddresses.forEach { a -> a.hostAddress?.let { addrs += it } }
                                @Suppress("DEPRECATION") si.host?.hostAddress?.let { addrs += it }
                                synchronized(c) { c.addNsd(si.serviceType ?: info.serviceType, si.serviceName ?: info.serviceName, si.port, addrs.distinct(), si.attributes ?: emptyMap()) }
                                count++
                            } finally { done.countDown() }
                        }
                    })
                    done.await(maxOf(100, minOf(3000, deadline - System.currentTimeMillis())), TimeUnit.MILLISECONDS)
                }
            } catch (e: InterruptedException) { /* finished */ }
        }, "matter-nsd-resolve").apply { isDaemon = true; start() }
        return NsdJob(nsd, listeners, resolver) { count }
    }

    /** Wi-Fi drops multicast to save power unless an app holds this lock (needed for every mDNS answer sent to the group). */
    private fun <T> withLock(block: () -> T): T {
        val lock = runCatching {
            (app.getSystemService(Context.WIFI_SERVICE) as WifiManager).createMulticastLock("couchtv-matter").apply { setReferenceCounted(true); acquire() }
        }.onFailure { log("matter: no multicast lock: ${it.message}") }.getOrNull()
        try { return block() } finally { runCatching { lock?.release() } }
    }
}
