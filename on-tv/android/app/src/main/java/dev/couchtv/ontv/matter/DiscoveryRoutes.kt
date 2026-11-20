package dev.couchtv.ontv.matter

/**
 * Can this TV reach the Thread devices? Thread devices live on their own IPv6 prefix behind a
 * border router (a Nest Hub, a HomePod, an Apple TV, an eero). The border router announces a route
 * to that prefix in its IPv6 router adverts ("route information", RFC 4191). If the TV's kernel
 * takes the route, the TV can talk to Thread devices; many older Android TVs ignore it.
 *
 * Plain Kotlin, no Android calls: the Android side (DiscoveryAndroid.routeSnapshot) collects the
 * routes and addresses, this file reads them and says what is wrong in plain words.
 */
object DiscoveryRoutes {
    class Prefix(val address: ByteArray, val length: Int) {
        fun contains(a: ByteArray) = DiscoveryAddr.inPrefix(a, address, length)
        /** Same family, and this prefix holds all of [other]. */
        fun covers(other: Prefix) = other.address.size == address.size && other.length >= length && contains(other.address)
        override fun toString() = DiscoveryAddr.format(masked()) + "/" + length
        private fun masked(): ByteArray {
            val out = address.copyOf()
            for (i in out.indices) {
                val bitsLeft = length - i * 8
                out[i] = when { bitsLeft >= 8 -> out[i]; bitsLeft <= 0 -> 0; else -> (out[i].toInt() and ((0xff shl (8 - bitsLeft)) and 0xff)).toByte() }
            }
            return out
        }
        override fun equals(other: Any?) = other is Prefix && other.length == length && other.toString() == toString()
        override fun hashCode() = toString().hashCode()

        companion object {
            /** "fd00::/64", "default" (::/0), or a bare address (a host route). */
            fun parse(text: String): Prefix? {
                val t = text.trim()
                if (t == "default") return Prefix(ByteArray(16), 0)
                val addr = DiscoveryAddr.parse(t.substringBefore('/')) ?: return null
                val len = if (t.contains('/')) t.substringAfter('/').toIntOrNull() ?: return null else addr.size * 8
                if (len < 0 || len > addr.size * 8) return null
                return Prefix(addr, len)
            }
        }
    }

    data class Route(val destination: Prefix, val gateway: String?, val iface: String?) {
        val isDefault get() = destination.length == 0
        /** On the link itself (no next hop): the TV reaches these addresses directly. */
        val onLink get() = gateway == null || DiscoveryAddr.parse(gateway)?.all { it.toInt() == 0 } == true
    }

    /** What the TV knows about its own network: IPv6 routes and its own addresses. */
    data class Snapshot(val routes: List<Route>, val localAddresses: List<String>, val sdk: Int = 0)

    /**
     * Reads `ip -6 route` / `ip -6 route show table all` output, for example
     * "fd00:db8:2:1::/64 via fe80::200:ff:fe00:1 dev wlan0 table wlan0 proto ra metric 1024 pref medium".
     * Skips local, broadcast, multicast, unreachable and IPv4 lines.
     */
    fun parseIpRoute(text: String): List<Route> {
        val out = ArrayList<Route>()
        for (raw in text.lines()) {
            val tok = raw.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
            if (tok.isEmpty()) continue
            var i = 0
            if (tok[0] in setOf("local", "broadcast", "multicast", "unreachable", "prohibit", "blackhole", "throw", "anycast", "nat")) continue
            if (tok[0] == "unicast") i++
            val dest = Prefix.parse(tok.getOrNull(i) ?: continue) ?: continue
            if (dest.address.size != 16) continue
            if (dest.length == 8 && (dest.address[0].toInt() and 0xff) == 0xff) continue  // ff00::/8
            var via: String? = null; var dev: String? = null
            var j = i + 1
            while (j < tok.size) {
                when (tok[j]) { "via" -> via = tok.getOrNull(j + 1); "dev" -> dev = tok.getOrNull(j + 1) }
                j++
            }
            out += Route(dest, via?.takeIf { DiscoveryAddr.parse(it)?.size == 16 }, dev)
        }
        return out.distinct()
    }

    /**
     * Reads /proc/net/ipv6_route: "dest plen src plen nexthop metric refcnt use flags iface", addresses
     * as 32 hex digits. Skips loopback, rejected (RTF_REJECT 0x200) and multicast routes.
     */
    fun parseProcIpv6Route(text: String): List<Route> {
        val out = ArrayList<Route>()
        for (line in text.lines()) {
            val f = line.trim().split(Regex("\\s+"))
            if (f.size < 10 || f[0].length != 32) continue
            val dest = hex16(f[0]) ?: continue
            val plen = f[1].toIntOrNull(16) ?: continue
            val next = hex16(f[4]) ?: continue
            val flags = f[8].toLongOrNull(16) ?: 0
            val iface = f[9]
            if (iface == "lo" || flags and 0x200L != 0L) continue
            if ((dest[0].toInt() and 0xff) == 0xff) continue
            val gw = if (next.all { it.toInt() == 0 }) null else DiscoveryAddr.format(next)
            out += Route(Prefix(dest, plen), gw, iface)
        }
        return out.distinct()
    }

    private fun hex16(s: String): ByteArray? = if (s.length != 32) null else
        ByteArray(16) { (s.substring(it * 2, it * 2 + 2).toIntOrNull(16) ?: return null).toByte() }

    /** The most specific route for [address], or null when the TV has none at all. */
    fun routeFor(address: String, routes: List<Route>): Route? {
        val b = DiscoveryAddr.parse(address) ?: return null
        return routes.filter { it.destination.address.size == b.size && it.destination.contains(b) }.maxByOrNull { it.destination.length }
    }

    /**
     * Can the TV send to [address]? True when it is on the TV's own link or a route other than the
     * default one covers it (a Thread prefix route from a border router). A ULA address (fc00::/7,
     * what Thread uses) with only the default route is false: the main router does not know Thread
     * networks. When no routes could be read at all, [kernel] (the UDP connect probe) decides, and
     * no answer at all counts as yes, so a TV that hides its routes is never blocked by this check.
     */
    fun canReach(address: ByteArray, snap: Snapshot, kernel: Boolean?): Boolean {
        if (address.size == 4) return true
        if (DiscoveryAddr.isLinkLocal6(address)) return true
        val routes = snap.routes.filter { it.destination.address.size == 16 && it.destination.contains(address) && !DiscoveryAddr.isLinkLocal6(it.destination.address) }
        if (routes.any { !it.isDefault }) return true
        if (snap.routes.isEmpty()) return kernel ?: true
        if (kernel == false) return false
        return !DiscoveryAddr.isUla(address)
    }

    // ---------- the diagnosis ----------

    /**
     * [code]: "no_thread" (no border router heard: nothing to check), "ok", "partial" (some Thread
     * networks reachable, not all), "no_route", "no_ipv6". [words] is the plain English line for the
     * screen; [code] lets a screen use its own translation.
     */
    data class Diagnosis(
        val code: String,
        val ok: Boolean,
        val words: String,
        val borderRouters: List<String>,
        val threadPrefixes: List<String>,
        val reachablePrefixes: List<String>,
    )

    /**
     * Decides whether the TV can reach the Thread networks behind [routers]. Thread prefixes come
     * from the routers (omr=) and from discovered devices' IPv6 addresses that are not on the TV's
     * own link. [kernelSaysRoute] is an optional live check (DiscoveryAndroid asks the kernel by
     * connecting a UDP socket, which fails at once with "network unreachable" when no route exists).
     */
    fun diagnose(
        snap: Snapshot,
        routers: List<DiscoveryModel.BorderRouter>,
        nodes: List<DiscoveryModel.Node> = emptyList(),
        kernelSaysRoute: ((String) -> Boolean?)? = null,
    ): Diagnosis {
        val labels = routers.map { it.label }.distinct()
        val v6Local = snap.localAddresses.mapNotNull { DiscoveryAddr.parse(it) }.filter { it.size == 16 }
        val onLinkPrefixes = snap.routes.filter { it.onLink && !it.isDefault && !DiscoveryAddr.isLinkLocal6(it.destination.address) }.map { it.destination }

        val prefixes = LinkedHashSet<Prefix>()
        routers.mapNotNull { it.threadPrefix?.let(Prefix::parse) }.forEach { prefixes += it }
        for (n in nodes) for (a in n.ipv6) {
            val b = DiscoveryAddr.parse(a) ?: continue
            if (DiscoveryAddr.isLinkLocal6(b)) continue
            if (onLinkPrefixes.any { it.contains(b) }) continue          // on the TV's own Wi-Fi: not a Thread address
            if (v6Local.any { DiscoveryAddr.inPrefix(b, it, 64) }) continue
            if (prefixes.any { it.contains(b) }) continue
            prefixes += Prefix(b, 64)
        }
        val known = prefixes.map { it.toString() }

        if (routers.isEmpty() && prefixes.isEmpty()) return Diagnosis("no_thread", true,
            "No Thread border router found on this network. Matter devices on Wi-Fi still work.", labels, known, emptyList())

        val routerWords = when (labels.size) {
            0 -> ""
            1 -> " Your border router: ${labels[0]}."
            else -> " Your border routers: ${labels.joinToString(", ")}."
        }

        if (v6Local.isEmpty()) return Diagnosis("no_ipv6", false,
            "This TV can't reach your Thread devices: it has no IPv6 address.$routerWords " +
                "Turn on IPv6 in your Wi-Fi router's settings, then restart the TV.", labels, known, emptyList())

        fun reachable(p: Prefix): Boolean {
            val specific = snap.routes.any { !it.isDefault && it.destination.covers(p) && !DiscoveryAddr.isLinkLocal6(it.destination.address) }
            if (specific) return true
            val probe = kernelSaysRoute?.invoke(DiscoveryAddr.format(p.address).let { if (it.endsWith("::")) it + "1" else it })
            // A default route alone only counts when the kernel itself says the address is reachable.
            return probe == true && snap.routes.any { it.isDefault }.not()
        }

        val reach: List<String>
        val code: String
        if (prefixes.isNotEmpty()) {
            reach = prefixes.filter { reachable(it) }.map { it.toString() }
            code = when (reach.size) { prefixes.size -> "ok"; 0 -> "no_route"; else -> "partial" }
        } else {
            // A border router with no prefix in its adverts (Apple, Google): any routed ULA /64 that is
            // not this TV's own link is taken as the Thread network's.
            reach = snap.routes.filter { r ->
                !r.isDefault && !r.onLink && r.destination.length in 48..64 && DiscoveryAddr.isUla(r.destination.address) &&
                    onLinkPrefixes.none { it.covers(r.destination) }
            }.map { it.destination.toString() }.distinct()
            code = if (reach.isEmpty()) "no_route" else "ok"
        }
        val words = when (code) {
            "ok" -> "This TV can reach your Thread devices.$routerWords"
            "partial" -> "This TV can reach some of your Thread devices, not all.$routerWords " +
                "Restart the TV, then the border routers. If it still can't, keep one border router and switch the others off."
            else -> "This TV can't reach your Thread devices.$routerWords " +
                "The border router tells the TV the way to them, but this TV did not take it. " +
                "Check the TV and the border router are on the same Wi-Fi (not a guest network), restart the TV, then try again. " +
                (if (snap.sdk in 1..32) "Some TVs on Android 12 or older never take it: a computer at home running Couch TV can control them instead. " else "") +
                "Matter devices on Wi-Fi still work."
        }
        return Diagnosis(code, code == "ok", words, labels, known, reach)
    }
}
