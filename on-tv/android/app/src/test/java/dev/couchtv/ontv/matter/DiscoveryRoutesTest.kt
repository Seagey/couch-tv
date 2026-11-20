package dev.couchtv.ontv.matter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Thread reachability check: route parsing and the plain words diagnosis. */
class DiscoveryRoutesTest {
    // `ip -6 route show table all` as Android prints it (per-network tables), with the eero's RA routes.
    private val ipRoutes = """
        fd00:db8:2:1::/64 via fe80::200:ff:fe00:1 dev wlan0 table wlan0 proto ra metric 1024 expires 1786sec pref medium
        fd00:db8:1:1::/64 dev wlan0 table wlan0 proto kernel metric 256 expires 1786sec pref medium
        fe80::/64 dev wlan0 table wlan0 proto kernel metric 256 pref medium
        default via fe80::200:ff:fe00:1 dev wlan0 table wlan0 proto ra metric 1024 expires 1786sec hoplimit 64 pref medium
        local fd00:db8:1:1:aaaa:bbbb:cccc:dddd dev wlan0 table local proto kernel metric 0 pref medium
        multicast ff00::/8 dev wlan0 table local proto kernel metric 256 pref medium
        unreachable default dev lo table unreachable proto kernel metric 4294967295 error -101 pref medium
    """.trimIndent()

    private val noRio = ipRoutes.lines().filterNot { it.startsWith("fd00:db8:2") }.joinToString("\n")

    private val eero = DiscoveryModel.BorderRouter("eero_thread #0000", "eero", "thread", "eero-thread-0000", "aa", "fd00:db8:2:1::/64", "example.local", emptyList(), emptyList())
    private val apple = DiscoveryModel.BorderRouter("Lounge", "Apple", "BorderRouter", "MyHome0000000000", "bb", null, "example.local", emptyList(), emptyList())
    private val tvAddrs = listOf("fe80::1234", "fd00:db8:1:1:aaaa:bbbb:cccc:dddd", "192.0.2.24")

    @Test fun readsIpRouteOutput() {
        val r = DiscoveryRoutes.parseIpRoute(ipRoutes)
        assertEquals(4, r.size)   // the RIO route, the on-link /64, fe80::/64, default
        val rio = r.first { it.destination.toString() == "fd00:db8:2:1::/64" }
        assertEquals("fe80::200:ff:fe00:1", rio.gateway)
        assertEquals("wlan0", rio.iface)
        assertFalse(rio.onLink)
        assertTrue(r.first { it.destination.toString() == "fd00:db8:1:1::/64" }.onLink)
        assertTrue(r.any { it.isDefault })
        assertEquals("fd00:db8:2:1::/64", DiscoveryRoutes.routeFor("fd00:db8:2:1::5", r)!!.destination.toString())
        assertTrue(DiscoveryRoutes.routeFor("fd99::1", r)!!.isDefault)
        assertNull(DiscoveryRoutes.routeFor("198.51.100.1", r))
    }

    @Test fun readsProcIpv6Route() {
        val proc = """
            fd000db8000200010000000000000000 40 00000000000000000000000000000000 00 fe800000000000000200000000000001 00000400 00000001 00000000 00450003    wlan0
            fd000db8000100010000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001    wlan0
            00000000000000000000000000000001 80 00000000000000000000000000000000 00 00000000000000000000000000000000 00000000 00000004 00000000 80200001       lo
            00000000000000000000000000000000 00 00000000000000000000000000000000 00 00000000000000000000000000000000 ffffffff 00000001 00000000 00200200       lo
            ff000000000000000000000000000000 08 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000004 00000000 00000001    wlan0
        """.trimIndent()
        val r = DiscoveryRoutes.parseProcIpv6Route(proc)
        assertEquals(2, r.size)
        assertEquals("fd00:db8:2:1::/64", r[0].destination.toString())
        assertEquals("fe80::200:0:0:1", r[0].gateway)
        assertTrue(r[1].onLink)
    }

    @Test fun noBorderRouterIsFine() {
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 34), emptyList())
        assertEquals("no_thread", d.code)
        assertTrue(d.ok)
    }

    @Test fun eeroRouteTakenMeansOk() {
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34), listOf(eero))
        assertEquals("ok", d.code)
        assertEquals(listOf("fd00:db8:2:1::/64"), d.reachablePrefixes)
        assertEquals("This TV can reach your Thread devices. Your border router: eero (eero-thread-0000).", d.words)
    }

    @Test fun eeroRouteMissingSaysSoInPlainWords() {
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 30), listOf(eero, apple))
        assertEquals("no_route", d.code)
        assertFalse(d.ok)
        assertTrue(d.words, d.words.startsWith("This TV can't reach your Thread devices. Your border routers: eero (eero-thread-0000), Apple (MyHome0000000000)."))
        assertTrue(d.words.contains("Android 12 or older"))
        // Android 13 and newer: no old-Android line.
        val d14 = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 34), listOf(eero))
        assertFalse(d14.words.contains("Android 12"))
        assertTrue(d14.words.contains("Your border router: eero (eero-thread-0000)."))
    }

    @Test fun kernelProbeOnlyCountsWithoutADefaultRoute() {
        // The default route would send it to the main router anyway: a probe saying "routable" proves nothing.
        val withDefault = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 34), listOf(eero)) { true }
        assertEquals("no_route", withDefault.code)
        // No routes readable at all (Android 10+ hides /proc): the kernel's answer decides.
        val blind = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(emptyList(), tvAddrs, 34), listOf(eero)) { true }
        assertEquals("ok", blind.code)
        val blindNo = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(emptyList(), tvAddrs, 34), listOf(eero)) { false }
        assertEquals("no_route", blindNo.code)
    }

    @Test fun appleRouterWithoutPrefixUsesAnyRoutedUla() {
        val apple6 = "fd7a:1b2c:3d4e:1::/64 via fe80::200:0:0:2 dev wlan0 table wlan0 proto ra metric 1024 pref medium\n$noRio"
        val ok = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(apple6), tvAddrs, 34), listOf(apple))
        assertEquals("ok", ok.code)
        assertEquals(listOf("fd7a:1b2c:3d4e:1::/64"), ok.reachablePrefixes)
        val bad = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 34), listOf(apple))
        assertEquals("no_route", bad.code)
    }

    @Test fun threadDevicePrefixFromDiscoveredNodes() {
        val node = DiscoveryModel.Node(DiscoveryModel.Kind.OPERATIONAL, "A-B", null, null, null, null, null, null, null, "A", 1, null, 5540,
            emptyList(), listOf("fd11:2233:4455:1::7", "fd00:db8:1:1::9", "fe80::7%wlan0"), false, setOf("mdns"))
        // Two prefixes now: the eero's and the device's own (fd11:...); only the eero's is routed.
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34), listOf(eero), listOf(node))
        assertEquals("partial", d.code)
        assertEquals(listOf("fd00:db8:2:1::/64", "fd11:2233:4455:1::/64"), d.threadPrefixes)   // fd00:db8:1 is the TV's own Wi-Fi: not Thread
        assertEquals(listOf("fd00:db8:2:1::/64"), d.reachablePrefixes)
    }

    @Test fun canReachForTheControllersThreadCheck() {
        fun a(s: String) = DiscoveryAddr.parse(s)!!
        val with = DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34)
        val without = DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 34)
        val blind = DiscoveryRoutes.Snapshot(emptyList(), tvAddrs, 34)
        assertTrue(DiscoveryRoutes.canReach(a("fd00:db8:2:1::5"), with, null))        // the RIO route
        assertFalse(DiscoveryRoutes.canReach(a("fd00:db8:2:1::5"), without, true))    // only the default route: a ULA is not there
        assertTrue(DiscoveryRoutes.canReach(a("fd00:db8:1:1::9"), without, null))     // the TV's own Wi-Fi prefix
        assertTrue(DiscoveryRoutes.canReach(a("2001:db8:82db::9"), without, null))        // a global address goes out the default route
        assertFalse(DiscoveryRoutes.canReach(a("2001:db8:82db::9"), without, false))
        assertTrue(DiscoveryRoutes.canReach(a("192.0.2.172"), without, false))
        assertTrue(DiscoveryRoutes.canReach(a("fe80::1"), without, false))
        assertTrue(DiscoveryRoutes.canReach(a("fd00:db8:2:1::5"), blind, null))       // routes hidden, no probe answer: don't block
        assertFalse(DiscoveryRoutes.canReach(a("fd00:db8:2:1::5"), blind, false))
    }

    @Test fun controllerGetsIpv4ThenReachableIpv6ThenLinkLocal() {
        val n = DiscoveryModel.Node(DiscoveryModel.Kind.OPERATIONAL, "X", null, null, null, null, null, null, null, null, 1, null, 5540,
            listOf("192.0.2.172"), listOf("fe80::1%wlan0", "fd11::1", "fd00:db8:2:1::5"), false, emptySet())
        val snap = DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34)
        val reach = { b: ByteArray -> DiscoveryRoutes.canReach(b, snap, null) }
        assertEquals(listOf("192.0.2.172", "fd00:db8:2:1::5", "fd11::1", "fe80::1"), DiscoveryModel.controllerOrder(n, reach))
        val thread = n.copy(ipv4 = emptyList())
        assertEquals("fd00:db8:2:1::5", DiscoveryModel.controllerOrder(thread, reach).first())
        assertTrue(DiscoveryModel.controllerOrder(n.copy(ipv4 = emptyList(), ipv6 = emptyList()), reach).isEmpty())
    }

    @Test fun noIpv6AtAll() {
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(emptyList(), listOf("192.0.2.24"), 28), listOf(eero))
        assertEquals("no_ipv6", d.code)
        assertTrue(d.words.contains("Turn on IPv6"))
    }

    @Test fun wordsFollowTheHouseRules() {
        val snaps = listOf(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(noRio), tvAddrs, 30), DiscoveryRoutes.Snapshot(emptyList(), listOf("192.0.2.24"), 28),
            DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34))
        val all = snaps.flatMap { s -> listOf(emptyList(), listOf(eero), listOf(apple)).map { DiscoveryRoutes.diagnose(s, it).words } }
        assertEquals(9, all.size)
        for (w in all) {
            val noNames = w.replace("eero-thread-0000", "").replace("Wi-Fi", "")
            assertFalse(w, noNames.contains(" - ") || noNames.contains('—') || noNames.contains('–') || noNames.contains("-"))
            for (banned in listOf("Beta", "Experimental", "coming soon", "RIO", "prefix", "IPv6 route")) assertFalse("$banned in: $w", w.contains(banned, ignoreCase = true))
        }
    }

    @Test fun jsonHasTheFieldsTheControllerReads() {
        val d = DiscoveryRoutes.diagnose(DiscoveryRoutes.Snapshot(DiscoveryRoutes.parseIpRoute(ipRoutes), tvAddrs, 34), listOf(eero))
        val j = DiscoveryJson.result(emptyList(), listOf(eero), d)
        assertEquals("ok", j.getJSONObject("thread").getString("code"))
        assertEquals("fd00:db8:2:1::/64", j.getJSONArray("borderRouters").getJSONObject(0).getString("threadPrefix"))
        val n = DiscoveryModel.Node(DiscoveryModel.Kind.OPERATIONAL, "X", "Lamp", 3101, 65521, 32769, 257, 1, 33, "6DD5933D50CED4F8", -1L, "example.local", 5540,
            listOf("192.0.2.172"), listOf("fd00::1"), true, setOf("mdns", "nsd"))
        val jn = DiscoveryJson.node(n)
        assertEquals("18446744073709551615", jn.getString("nodeId"))   // node ids are unsigned 64 bit
        assertEquals("operational", jn.getString("kind"))
        assertEquals(2, jn.getJSONArray("sources").length())
    }
}
