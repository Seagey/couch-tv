package dev.couchtv.ontv.matter

import dev.couchtv.ontv.matter.DiscoveryDns.DnsName
import dev.couchtv.ontv.matter.DiscoveryDns.RData

/**
 * What discovery finds, and the rules that turn mDNS records into it. No Android calls, so
 * DiscoveryDnsTest runs it on a computer.
 *
 * Matter's mDNS names (Matter core spec 4.3):
 *  - _matterc._udp: a device waiting to be commissioned (or opened for sharing, "multi-admin").
 *    TXT: D (12 bit discriminator), VP ("vendor+product"), CM (commissioning mode), DT (device type),
 *    DN (device name), PH/PI (pairing hint), SII/SAI/SAT/T/ICD (timing, TCP, sleepy device).
 *  - _matter._tcp: a commissioned device, instance "<compressed fabric id>-<node id>", both 16 hex digits.
 *  - _meshcop._udp: a Thread border router. TXT: vn (vendor), mn (model), nn (Thread network name),
 *    xp (extended PAN id, 8 bytes), omr (some routers, eero: prefix length byte then the prefix: the
 *    Thread devices' IPv6 prefix).
 */
object DiscoveryModel {
    val COMMISSIONABLE: DnsName = DnsName.mdns("_matterc", "_udp")
    val OPERATIONAL: DnsName = DnsName.mdns("_matter", "_tcp")
    val BORDER_ROUTER: DnsName = DnsName.mdns("_meshcop", "_udp")
    val ALL_TYPES = listOf(COMMISSIONABLE, OPERATIONAL, BORDER_ROUTER)

    enum class Kind { COMMISSIONABLE, OPERATIONAL }

    /** One Matter device found on the network. Addresses are text; IPv6 link-local ones carry "%iface" when known. */
    data class Node(
        val kind: Kind,
        val instance: String,
        val name: String?,
        val discriminator: Int?,
        val vendorId: Int?,
        val productId: Int?,
        val deviceType: Long?,
        val commissioningMode: Int?,
        val pairingHint: Int?,
        val compressedFabricId: String?,
        val nodeId: Long?,
        val host: String?,
        val port: Int?,
        val ipv4: List<String>,
        val ipv6: List<String>,
        /** True when an address sits in a Thread prefix a border router announced (omr), so it is a Thread device. */
        val onThread: Boolean,
        val sources: Set<String>,
        /** The TXT record as key to value bytes, as the Matter controller wants it. */
        val txt: Map<String, ByteArray> = emptyMap(),
    ) {
        /** Addresses the controller should try, best first: routable IPv6, IPv4, then link-local IPv6. */
        val addresses: List<String> get() =
            ipv6.filterNot { it.startsWith("fe80", true) } + ipv4 + ipv6.filter { it.startsWith("fe80", true) }
    }

    data class BorderRouter(
        val instance: String,
        val vendor: String?,
        val model: String?,
        val networkName: String?,
        val extPanId: String?,
        /** The Thread devices' prefix ("fd00:db8:2:1::/64") when the router says it (omr=). */
        val threadPrefix: String?,
        val host: String?,
        val ipv4: List<String>,
        val ipv6: List<String>,
    ) {
        /** "eero (eero-thread-0000)", "Apple (MyHome0000000000)": plain words for the diagnosis. */
        val label: String get() {
            val who = listOfNotNull(vendor?.takeIf { it.isNotBlank() }, model?.takeIf { it.isNotBlank() && !it.equals("BorderRouter", true) && !it.equals("thread", true) })
                .joinToString(" ").ifEmpty { instance }
            return if (networkName.isNullOrBlank()) who else "$who ($networkName)"
        }
    }

    // ---------- TXT helpers ----------

    fun txtString(m: Map<String, ByteArray>, key: String): String? =
        m.entries.firstOrNull { it.key.equals(key, true) }?.value?.toString(Charsets.UTF_8)

    fun txtBytes(m: Map<String, ByteArray>, key: String): ByteArray? = m.entries.firstOrNull { it.key.equals(key, true) }?.value

    /** "65521+32769" -> (65521, 32769); "4996" -> (4996, null). */
    fun vendorProduct(vp: String?): Pair<Int?, Int?> {
        if (vp.isNullOrBlank()) return null to null
        val parts = vp.split('+')
        return parts[0].trim().toIntOrNull()?.takeIf { it in 0..0xffff } to parts.getOrNull(1)?.trim()?.toIntOrNull()?.takeIf { it in 0..0xffff }
    }

    /** "6DD5933D50CED4F8-0000000000007A11" -> ("6DD5933D50CED4F8", 0x7A11). */
    fun operationalInstance(instance: String): Pair<String, Long>? {
        val m = Regex("^([0-9A-Fa-f]{16})-([0-9A-Fa-f]{16})$").matchEntire(instance) ?: return null
        return m.groupValues[1].uppercase() to java.lang.Long.parseUnsignedLong(m.groupValues[2], 16)
    }

    fun operationalInstanceName(compressedFabricId: String, nodeId: Long): String =
        compressedFabricId.uppercase().padStart(16, '0') + "-" + "%016X".format(nodeId)

    /** omr= bytes: prefix length then prefix bytes. Returns "fd00:db8:2:1::/64" or null. */
    fun omrPrefix(b: ByteArray?): String? {
        if (b == null || b.size < 2) return null
        val len = b[0].toInt() and 0xff
        if (len == 0 || len > 128 || b.size - 1 < (len + 7) / 8) return null
        val full = ByteArray(16)
        System.arraycopy(b, 1, full, 0, minOf(16, b.size - 1))
        return DiscoveryAddr.format(full) + "/" + len
    }

    /** [value] null matches any; [short] compares the top 4 bits only (what an 11 digit manual code holds). */
    fun matchesDiscriminator(n: Node, value: Int?, short: Boolean): Boolean {
        if (value == null) return true
        val d = n.discriminator ?: return false
        return if (short) (d shr 8) == value else d == value
    }

    /** The commissioned node [nodeId] (on fabric [compressedFabricId] when given), the one with addresses first. */
    fun pickOperational(nodes: List<Node>, nodeId: Long, compressedFabricId: String?): Node? =
        nodes.filter { it.kind == Kind.OPERATIONAL && it.nodeId == nodeId && (compressedFabricId == null || it.compressedFabricId.equals(compressedFabricId, true)) }
            .maxByOrNull { it.addresses.size }

    /**
     * The one address to hand the Matter controller (its resolve callback takes a single address),
     * best first: IPv4 (Wi-Fi devices; what Android's own resolver gives), then IPv6 the TV can reach
     * ([canReach]: Thread devices), then other IPv6, link-local last (the controller can't use a
     * zone, so only when nothing else exists). Empty when there is no address.
     */
    fun controllerOrder(n: Node, canReach: (ByteArray) -> Boolean): List<String> {
        val v6 = n.ipv6.mapNotNull { a -> DiscoveryAddr.parse(a)?.let { a.substringBefore('%') to it } }
        val routable = v6.filter { !DiscoveryAddr.isLinkLocal6(it.second) }
        val (good, other) = routable.partition { canReach(it.second) }
        val linkLocal = v6.filter { DiscoveryAddr.isLinkLocal6(it.second) }
        return (n.ipv4 + good.map { it.first } + other.map { it.first } + linkLocal.map { it.first }).distinct()
    }

    fun hex(b: ByteArray?): String? = b?.takeIf { it.isNotEmpty() }?.joinToString("") { "%02x".format(it) }

    // ---------- collecting records into devices ----------

    /**
     * Gathers records from any number of mDNS packets (multicast answers, one-shot unicast answers,
     * NsdManager results) and turns them into [Node]s and [BorderRouter]s. A record with TTL 0 (a
     * goodbye) removes what it named. Not thread safe: callers lock around it.
     */
    class Collector {
        private val ptr = LinkedHashMap<String, Pair<DnsName, MutableSet<String>>>()   // service key -> (service, instance keys)
        private val instances = LinkedHashMap<String, DnsName>()                       // instance key -> full instance name
        private val srv = HashMap<String, RData.Srv>()
        private val txt = HashMap<String, Map<String, ByteArray>>()
        private val v4 = HashMap<String, LinkedHashSet<String>>()                      // host key -> addresses
        private val v6 = HashMap<String, LinkedHashSet<String>>()
        private val nsdAddr = HashMap<String, Pair<LinkedHashSet<String>, LinkedHashSet<String>>>()
        private val sources = HashMap<String, MutableSet<String>>()

        /** Packets read so far, and records kept, for the report and tests. */
        var packets = 0; private set
        var records = 0; private set

        private fun serviceOf(name: DnsName): DnsName? = ALL_TYPES.firstOrNull { name.endsWith(it) }

        /**
         * Adds one parsed packet. [zone] is the interface name the packet came in on ("wlan0"); it is
         * added to IPv6 link-local addresses so they can be dialled.
         */
        fun add(msg: DiscoveryDns.Message, source: String = "mdns", zone: String? = null) {
            if (!msg.isResponse) return
            packets++
            for (r in msg.records + msg.authorities) addRecord(r, source, zone)
        }

        fun addRecord(r: DiscoveryDns.Record, source: String = "mdns", zone: String? = null) {
            val gone = r.ttl == 0L
            when (val d = r.data) {
                is RData.Ptr -> {
                    // PTR for _matterc._udp, or for a subtype like _L3101._sub._matterc._udp -> instance.
                    val svc = serviceOf(r.name) ?: return
                    if (!d.target.endsWith(svc) || d.target.labels.size != svc.labels.size + 1) return
                    val set = ptr.getOrPut(svc.key) { svc to LinkedHashSet() }.second
                    if (gone) { set.remove(d.target.key); return }
                    set += d.target.key
                    noteInstance(d.target, source)
                }
                is RData.Srv -> {
                    val svc = serviceOf(r.name) ?: return
                    if (r.name.labels.size != svc.labels.size + 1) return
                    if (gone) { srv.remove(r.name.key); return }
                    srv[r.name.key] = d
                    noteInstance(r.name, source)
                }
                is RData.Txt -> {
                    val svc = serviceOf(r.name) ?: return
                    if (r.name.labels.size != svc.labels.size + 1) return
                    if (gone) { txt.remove(r.name.key); return }
                    txt[r.name.key] = d.pairs()
                    noteInstance(r.name, source)
                }
                is RData.A -> {
                    val a = DiscoveryAddr.format(d.address)
                    val set = v4.getOrPut(r.name.key) { LinkedHashSet() }
                    if (gone) set.remove(a) else set += a
                }
                is RData.Aaaa -> {
                    val a = DiscoveryAddr.format(d.address).let { if (DiscoveryAddr.isLinkLocal6(d.address) && zone != null) "$it%$zone" else it }
                    val set = v6.getOrPut(r.name.key) { LinkedHashSet() }
                    if (gone) set.remove(a) else set += a
                }
                else -> return
            }
            records++
        }

        private fun noteInstance(n: DnsName, source: String) {
            instances.getOrPut(n.key) { n }
            sources.getOrPut(n.key) { LinkedHashSet() } += source
        }

        /**
         * Adds what NsdManager resolved. [type] is NsdServiceInfo's type ("._matterc._udp" or
         * "_matterc._udp."), [instance] its service name, [addresses] its host address(es).
         */
        fun addNsd(type: String, instance: String, port: Int, addresses: List<String>, attributes: Map<String, ByteArray?>, hostName: String? = null) {
            val want = DnsName.of(type.trim('.').removeSuffix(".local").trim('.') + ".local").key
            val svc = ALL_TYPES.firstOrNull { it.key == want } ?: return
            val name = DnsName(listOf(instance) + svc.labels)
            ptr.getOrPut(svc.key) { svc to LinkedHashSet() }.second += name.key
            noteInstance(name, "nsd")
            val host = hostName?.takeIf { it.isNotBlank() }?.let { DnsName.of(it).let { n -> if (n.labels.lastOrNull().equals(DnsName.LOCAL, true)) n else DnsName(n.labels + DnsName.LOCAL) } }
                ?: DnsName.of("${name.key}.nsdhost")
            if (port > 0 && srv[name.key] == null) srv[name.key] = RData.Srv(0, 0, port, host)
            if (attributes.isNotEmpty() && txt[name.key] == null) txt[name.key] = attributes.mapValues { it.value ?: ByteArray(0) }
            val sets = nsdAddr.getOrPut(name.key) { LinkedHashSet<String>() to LinkedHashSet() }
            for (a in addresses) {
                val clean = a.trim().removePrefix("/")
                val b = DiscoveryAddr.parse(clean) ?: continue
                (if (b.size == 4) sets.first else sets.second) += clean
            }
            records++
        }

        /** Instances still missing a SRV, TXT or any address: the follow-up questions to ask. */
        fun missing(): List<Pair<DnsName, Int>> {
            val out = ArrayList<Pair<DnsName, Int>>()
            for ((key, name) in instances) {
                if (srv[key] == null) out += name to DiscoveryDns.TYPE_SRV
                if (txt[key] == null) out += name to DiscoveryDns.TYPE_TXT
                val s = srv[key] ?: continue
                val hk = s.target.key
                if (v6[hk].isNullOrEmpty() && nsdAddr[key]?.second.isNullOrEmpty()) out += s.target to DiscoveryDns.TYPE_AAAA
                if (v4[hk].isNullOrEmpty() && v6[hk].isNullOrEmpty() && nsdAddr[key]?.first.isNullOrEmpty()) out += s.target to DiscoveryDns.TYPE_A
            }
            return out
        }

        private fun live(svc: DnsName): List<DnsName> =
            instances.values.filter { it.endsWith(svc) && it.labels.size == svc.labels.size + 1 }
                .filter { n -> ptr[svc.key]?.second?.contains(n.key) == true || srv.containsKey(n.key) || txt.containsKey(n.key) }

        private fun addrs(key: String): Pair<List<String>, List<String>> {
            val s = srv[key]
            val a4 = LinkedHashSet<String>(); val a6 = LinkedHashSet<String>()
            if (s != null) { v4[s.target.key]?.let { a4 += it }; v6[s.target.key]?.let { a6 += it } }
            nsdAddr[key]?.let { a4 += it.first; a6 += it.second }
            // An IPv6 address both with and without a zone: keep the one with the zone.
            val zoned = a6.filter { it.contains('%') }.map { it.substringBefore('%') }.toSet()
            return a4.toList() to a6.filter { it.contains('%') || it !in zoned }
        }

        fun borderRouters(): List<BorderRouter> = live(BORDER_ROUTER).map { n ->
            val t = txt[n.key] ?: emptyMap()
            val (a4, a6) = addrs(n.key)
            BorderRouter(
                instance = n.first,
                vendor = txtString(t, "vn"), model = txtString(t, "mn"), networkName = txtString(t, "nn"),
                extPanId = hex(txtBytes(t, "xp")), threadPrefix = omrPrefix(txtBytes(t, "omr")),
                host = srv[n.key]?.target?.toString(), ipv4 = a4, ipv6 = a6,
            )
        }

        fun nodes(): List<Node> {
            val prefixes = borderRouters().mapNotNull { it.threadPrefix }.mapNotNull { DiscoveryRoutes.Prefix.parse(it) }
            val out = ArrayList<Node>()
            for ((svc, kind) in listOf(COMMISSIONABLE to Kind.COMMISSIONABLE, OPERATIONAL to Kind.OPERATIONAL)) {
                for (n in live(svc)) {
                    val t = txt[n.key] ?: emptyMap()
                    val (a4, a6) = addrs(n.key)
                    val (vid, pid) = vendorProduct(txtString(t, "VP"))
                    val op = if (kind == Kind.OPERATIONAL) operationalInstance(n.first) else null
                    val onThread = a6.any { a -> DiscoveryAddr.parse(a)?.let { b -> prefixes.any { it.contains(b) } } == true }
                    out += Node(
                        kind = kind, instance = n.first,
                        name = txtString(t, "DN")?.takeIf { it.isNotBlank() },
                        discriminator = txtString(t, "D")?.trim()?.toIntOrNull()?.takeIf { it in 0..0xfff },
                        vendorId = vid, productId = pid,
                        deviceType = txtString(t, "DT")?.trim()?.toLongOrNull(),
                        commissioningMode = txtString(t, "CM")?.trim()?.toIntOrNull(),
                        pairingHint = txtString(t, "PH")?.trim()?.toIntOrNull(),
                        compressedFabricId = op?.first, nodeId = op?.second,
                        host = srv[n.key]?.target?.toString()?.takeUnless { it.endsWith(".nsdhost") },
                        port = srv[n.key]?.port,
                        ipv4 = a4, ipv6 = a6, onThread = onThread,
                        sources = sources[n.key]?.toSet() ?: emptySet(), txt = t,
                    )
                }
            }
            return out
        }
    }
}
