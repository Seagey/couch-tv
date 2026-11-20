package dev.couchtv.ontv.matter

import dev.couchtv.ontv.matter.DiscoveryDns.DnsName
import dev.couchtv.ontv.matter.DiscoveryDns.RData
import dev.couchtv.ontv.matter.DiscoveryDns.Record
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The mDNS reader against real packets captured on the home network on 20 Nov 2026
 * (src/test/resources/matter, one packet per line: family, sender, hex bytes; the home's public IPv6
 * prefix replaced by 2001:db8:82db, same length):
 *  - matterc-*: a chip-lighting-app virtual light ("Test Bulb", discriminator 3101) on a MacBook, in
 *    pairing mode, by one-shot unicast (Bonjour) and by multicast;
 *  - matter-op-*: a second virtual light after chip-tool commissioned it as node 0x7A11;
 *  - meshcop-legacy: the house's Thread border routers (two eero, one Apple) answering one query.
 */
class DiscoveryDnsTest {
    private fun capture(name: String): List<Triple<String, String, ByteArray>> =
        javaClass.getResourceAsStream("/matter/$name")!!.bufferedReader().readLines().filter { it.isNotBlank() }.map { l ->
            val (fam, src, hex) = l.trim().split(' ')
            Triple(fam, src, ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() })
        }

    private fun collect(vararg names: String): DiscoveryModel.Collector {
        val c = DiscoveryModel.Collector()
        for (n in names) for ((_, _, b) in capture(n)) c.add(DiscoveryDns.parse(b), "mdns", "en0")
        return c
    }

    @Test fun capturesParseRecordForRecord() {
        // Counts from an independent Python decode of the same files.
        val counts = mapOf(
            "matterc-legacy.txt" to listOf(15, 15),
            "matterc-multicast.txt" to listOf(10, 10, 16, 16, 16, 16),
            "matter-op-legacy.txt" to listOf(15, 15),
            "matter-op-multicast.txt" to listOf(16, 16, 26, 26),
            "meshcop-legacy.txt" to listOf(6, 6, 5, 5, 8, 8),
        )
        var packets = 0
        for ((file, want) in counts) {
            val got = capture(file).map { (_, _, b) -> DiscoveryDns.parse(b).let { it.answers.size + it.additionals.size } }
            assertEquals(file, want, got)
            packets += got.size
        }
        assertEquals(20, packets)
    }

    @Test fun commissionableLightByOneShotUnicast() {
        val nodes = collect("matterc-legacy.txt").nodes()
        assertEquals(1, nodes.size)
        val n = nodes[0]
        assertEquals(DiscoveryModel.Kind.COMMISSIONABLE, n.kind)
        assertEquals("31CEB3DA6788D849", n.instance)
        assertEquals("Test Bulb", n.name)
        assertEquals(3101, n.discriminator)
        assertEquals(65521, n.vendorId)
        assertEquals(32769, n.productId)
        assertEquals(257L, n.deviceType)
        assertEquals(1, n.commissioningMode)
        assertEquals(33, n.pairingHint)
        assertEquals(5641, n.port)
        assertEquals("AABBCCDDEEFF" + ".local", n.host)
        assertEquals(listOf("192.0.2.172"), n.ipv4)
        assertEquals(5, n.ipv6.size)
        assertTrue(n.ipv6.contains("fe80::200:0:0:3%en0"))
        assertTrue(n.ipv6.contains("fd00:db8:1:1:200::4"))
        // Routable IPv6 first, then IPv4, link-local last.
        assertEquals("192.0.2.172", n.addresses[4])
        assertEquals("fe80::200:0:0:3%en0", n.addresses.last())
    }

    @Test fun commissionableLightByMulticastWithSubtypesIsOneDevice() {
        val c = collect("matterc-multicast.txt")
        val nodes = c.nodes()
        assertEquals(1, nodes.size)                      // _L3101, _S12, _V65521, _T257, _CM subtypes add no devices
        assertEquals(3101, nodes[0].discriminator)
        assertEquals(5, nodes[0].ipv6.size)
        assertTrue(c.missing().isEmpty())
        assertTrue(DiscoveryModel.matchesDiscriminator(nodes[0], 12, short = true))   // 3101 >> 8 == 12
        assertFalse(DiscoveryModel.matchesDiscriminator(nodes[0], 13, short = true))
        assertTrue(DiscoveryModel.matchesDiscriminator(nodes[0], 3101, short = false))
    }

    @Test fun operationalNodeBothWays() {
        for (f in listOf("matter-op-legacy.txt", "matter-op-multicast.txt")) {
            val all = collect(f).nodes()
            val nodes = all.filter { it.kind == DiscoveryModel.Kind.OPERATIONAL }
            assertEquals(f, 1, nodes.size)
            val n = nodes[0]
            assertEquals("6DD5933D50CED4F8", n.compressedFabricId)
            assertEquals(0x7A11L, n.nodeId)
            assertEquals(5651, n.port)
            assertEquals(listOf("192.0.2.172"), n.ipv4)
            assertEquals(5, n.ipv6.size)
            assertEquals(n, DiscoveryModel.pickOperational(nodes, 0x7A11, "6dd5933d50ced4f8"))
            assertNull(DiscoveryModel.pickOperational(nodes, 0x7A11, "0000000000000001"))
            assertNull(DiscoveryModel.pickOperational(nodes, 0x7A12, null))
        }
        // After commissioning, the light keeps a _matterc record with CM=0 (heard in the multicast capture only).
        val c = collect("matter-op-multicast.txt").nodes().single { it.kind == DiscoveryModel.Kind.COMMISSIONABLE }
        assertEquals(3333, c.discriminator)
        assertEquals(0, c.commissioningMode)
        assertEquals(5651, c.port)
        assertEquals("6DD5933D50CED4F8-0000000000007A11", DiscoveryModel.operationalInstanceName("6dd5933d50ced4f8", 0x7A11))
        assertNull(DiscoveryModel.operationalInstance("not-a-node"))
    }

    @Test fun borderRoutersAndTheEeroThreadPrefix() {
        val routers = collect("meshcop-legacy.txt").borderRouters().sortedBy { it.instance }
        assertEquals(3, routers.size)
        val labels = routers.map { it.label }
        assertEquals(listOf("Apple (MyHome0000000000)", "eero (eero-thread-0000)", "eero (eero-thread-0000)"), labels)
        val eero = routers.filter { it.vendor == "eero" }
        assertEquals(setOf("fd00:db8:2:1::/64"), eero.map { it.threadPrefix }.toSet())
        assertNull(routers.first { it.vendor == "Apple" }.threadPrefix)
        assertEquals(16, routers[0].extPanId!!.length)
        assertEquals(listOf("192.0.2.26"), routers.first { it.vendor == "Apple" }.ipv4)
        assertEquals(3, routers.first { it.vendor == "Apple" }.ipv6.size)
    }

    @Test fun threadDeviceIsMarkedOnThread() {
        val c = collect("meshcop-legacy.txt")
        val inst = DnsName(listOf("AAAAAAAAAAAAAAAA-0000000000000005") + DiscoveryModel.OPERATIONAL.labels)
        val host = DnsName.mdns("thread-plug")
        c.add(DiscoveryDns.parse(DiscoveryDns.response(listOf(
            Record(DiscoveryModel.OPERATIONAL, DiscoveryDns.TYPE_PTR, false, 120, RData.Ptr(inst)),
            Record(inst, DiscoveryDns.TYPE_SRV, true, 120, RData.Srv(0, 0, 5540, host)),
            Record(host, DiscoveryDns.TYPE_AAAA, true, 120, RData.Aaaa(DiscoveryAddr.parse("fd00:db8:2:1:aa:bb:cc:dd")!!)),
        ))))
        val n = c.nodes().single()
        assertTrue(n.onThread)
        assertEquals(listOf("fd00:db8:2:1:aa:bb:cc:dd"), n.ipv6)
        assertTrue(n.ipv4.isEmpty())
        assertEquals(5L, n.nodeId)
    }

    @Test fun goodbyeRemovesTheDevice() {
        val c = collect("matter-op-legacy.txt")
        assertEquals(1, c.nodes().size)
        val inst = DnsName(listOf("6DD5933D50CED4F8-0000000000007A11") + DiscoveryModel.OPERATIONAL.labels)
        c.add(DiscoveryDns.parse(DiscoveryDns.response(listOf(
            Record(DiscoveryModel.OPERATIONAL, DiscoveryDns.TYPE_PTR, false, 0, RData.Ptr(inst)),
            Record(inst, DiscoveryDns.TYPE_SRV, true, 0, RData.Srv(0, 0, 5651, DnsName.mdns("AABBCCDDEEFF"))),
            Record(inst, DiscoveryDns.TYPE_TXT, true, 0, RData.Txt(listOf("T=6".toByteArray()))),
        ))))
        assertEquals(0, c.nodes().size)
    }

    @Test fun nsdIpv4MergesWithMdnsIpv6() {
        val c = DiscoveryModel.Collector()
        // What NsdManager gives on Android 11: one IPv4 address, the TXT.
        c.addNsd("._matterc._udp", "31CEB3DA6788D849", 5641, listOf("/192.0.2.172"), mapOf("D" to "3101".toByteArray(), "DN" to "Test Bulb".toByteArray()))
        assertEquals(listOf("192.0.2.172"), c.nodes().single().ipv4)
        assertTrue(c.nodes().single().ipv6.isEmpty())
        for ((_, _, b) in capture("matterc-legacy.txt")) c.add(DiscoveryDns.parse(b), "mdns", "wlan0")
        val n = c.nodes().single()
        assertEquals(setOf("nsd", "mdns"), n.sources)
        assertEquals(listOf("192.0.2.172"), n.ipv4)
        assertEquals(5, n.ipv6.size)
        assertTrue(n.ipv6.contains("fe80::200:0:0:3%wlan0"))
        // Android 14 type spelling.
        val c2 = DiscoveryModel.Collector()
        c2.addNsd("_matter._tcp.", "6DD5933D50CED4F8-0000000000007A11", 5651, listOf("fd00:db8:1:1:200::4", "192.0.2.172"), emptyMap())
        assertEquals(0x7A11L, c2.nodes().single().nodeId)
        assertEquals(1, c2.nodes().single().ipv6.size)
    }

    @Test fun missingAsksForSrvTxtAndAddresses() {
        val c = DiscoveryModel.Collector()
        val inst = DnsName(listOf("ABCDEF0123456789") + DiscoveryModel.COMMISSIONABLE.labels)
        c.add(DiscoveryDns.parse(DiscoveryDns.response(listOf(Record(DiscoveryModel.COMMISSIONABLE, DiscoveryDns.TYPE_PTR, false, 120, RData.Ptr(inst))))))
        assertEquals(setOf(DiscoveryDns.TYPE_SRV, DiscoveryDns.TYPE_TXT), c.missing().map { it.second }.toSet())
        c.add(DiscoveryDns.parse(DiscoveryDns.response(listOf(Record(inst, DiscoveryDns.TYPE_SRV, true, 120, RData.Srv(0, 0, 5540, DnsName.mdns("dev")))))))
        assertEquals(setOf(DiscoveryDns.TYPE_TXT, DiscoveryDns.TYPE_AAAA, DiscoveryDns.TYPE_A), c.missing().map { it.second }.toSet())
        assertEquals(listOf("dev", "local"), c.missing().first { it.second == DiscoveryDns.TYPE_AAAA }.first.labels)
    }

    @Test fun queryRoundTrip() {
        val q = DiscoveryDns.query(listOf(DiscoveryModel.COMMISSIONABLE to DiscoveryDns.TYPE_PTR, DnsName.mdns("_L3101", "_sub", "_matterc", "_udp") to DiscoveryDns.TYPE_PTR), id = 7, unicastResponse = true)
        val m = DiscoveryDns.parse(q)
        assertFalse(m.isResponse)
        assertEquals(7, m.id)
        assertEquals(2, m.questions.size)
        assertTrue(m.questions.all { it.unicastResponse && it.type == DiscoveryDns.TYPE_PTR })
        assertEquals(listOf("_L3101", "_sub", "_matterc", "_udp", "local"), m.questions[1].name.labels)
        // Byte exact against the Python capture tool's query for the same name (capture.py).
        val py = "000000000001000000000000075f6d6174746572045f746370056c6f63616c00000c0001"
        assertEquals(py, DiscoveryDns.query(listOf(DiscoveryModel.OPERATIONAL to 12)).joinToString("") { "%02x".format(it) })
    }

    @Test fun labelsWithDotsAndSpacesSurvive() {
        val routers = collect("meshcop-legacy.txt").borderRouters()
        assertTrue(routers.any { it.instance == "eero_thread #0000 (10233)" })
        val n = DnsName(listOf("a.b", "example"))
        assertEquals("a\\.b.example", n.key)
        assertFalse(n.key == DnsName.of("a.b.example").key)
    }

    @Test fun badPacketsThrowFormatExceptionNeverHang() {
        // Pointer pointing at itself.
        val loop = byteArrayOf(0, 0, 0x84.toByte(), 0, 0, 0, 0, 1, 0, 0, 0, 0, 0xc0.toByte(), 12, 0, 1, 0, 1, 0, 0, 0, 10, 0, 4, 1, 2, 3, 4)
        expectBad(loop)
        expectBad(ByteArray(5))
        val good = capture("matterc-legacy.txt")[0].third
        expectBad(good.copyOf(40))                          // cut in the middle of the answers
        // Bad AAAA length.
        val inst = DnsName.mdns("h")
        val r = DiscoveryDns.response(listOf(Record(inst, DiscoveryDns.TYPE_AAAA, false, 1, RData.Other(ByteArray(5)))))
        expectBad(r)
        // 3000 random mutations of real packets: each either parses or throws FormatException, nothing else.
        val rnd = java.util.Random(42)
        val all = listOf("matterc-legacy.txt", "matterc-multicast.txt", "matter-op-multicast.txt", "meshcop-legacy.txt").flatMap { capture(it) }.map { it.third }
        var parsed = 0; var refused = 0
        repeat(3000) {
            val b = all[rnd.nextInt(all.size)].copyOf()
            repeat(1 + rnd.nextInt(6)) { b[rnd.nextInt(b.size)] = rnd.nextInt(256).toByte() }
            try {
                val m = DiscoveryDns.parse(b)
                DiscoveryModel.Collector().apply { add(m, "mdns", "en0"); nodes(); borderRouters(); missing() }
                parsed++
            } catch (e: DiscoveryDns.FormatException) { refused++ }
        }
        assertEquals(3000, parsed + refused)
        assertTrue("some mutations still parse: $parsed", parsed > 100)
    }

    private fun expectBad(b: ByteArray) {
        try { DiscoveryDns.parse(b); fail("parsed a bad packet") } catch (e: DiscoveryDns.FormatException) { /* right */ }
    }

    @Test fun addressText() {
        assertEquals("fe80::200:0:0:3", DiscoveryAddr.format(DiscoveryAddr.parse("fe80:0:0:0:200:0:0:3")!!))
        assertEquals("::", DiscoveryAddr.format(ByteArray(16)))
        assertEquals("fd00::1", DiscoveryAddr.format(DiscoveryAddr.parse("fd00::1%wlan0")!!))
        assertEquals("1:0:2::", DiscoveryAddr.format(DiscoveryAddr.parse("1:0:2:0:0:0:0:0")!!))
        assertEquals("1:0:2:0:3::", DiscoveryAddr.format(DiscoveryAddr.parse("1:0:2:0:3:0:0:0")!!))
        assertEquals("::ffff:102:304", DiscoveryAddr.format(DiscoveryAddr.parse("::ffff:1.2.3.4")!!))
        assertEquals("192.0.2.172", DiscoveryAddr.format(DiscoveryAddr.parse("192.0.2.172")!!))
        for (bad in listOf("1::2::3", "12345::", "1.2.3", "256.1.1.1", "g::1", "1:2:3:4:5:6:7")) assertNull(bad, DiscoveryAddr.parse(bad))
        assertTrue(DiscoveryAddr.isUla(DiscoveryAddr.parse("fd01::1")!!))
        assertTrue(DiscoveryAddr.isLinkLocal6(DiscoveryAddr.parse("fe80::1")!!))
        assertTrue(DiscoveryAddr.inPrefix(DiscoveryAddr.parse("fd00:db8:2:1::9")!!, DiscoveryAddr.parse("fd00:db8:2:1::")!!, 64))
        assertFalse(DiscoveryAddr.inPrefix(DiscoveryAddr.parse("fd00:db8:2:2::9")!!, DiscoveryAddr.parse("fd00:db8:2:1::")!!, 64))
        assertNotNull(DiscoveryModel.omrPrefix(byteArrayOf(0x40, 0xfd.toByte(), 0, 0, 0, 0, 0, 0, 1)))
        assertNull(DiscoveryModel.omrPrefix(byteArrayOf(0x40, 1)))
        assertEquals(65521 to null, DiscoveryModel.vendorProduct("65521"))
        assertEquals(null to null, DiscoveryModel.vendorProduct("x+y"))
    }
}
