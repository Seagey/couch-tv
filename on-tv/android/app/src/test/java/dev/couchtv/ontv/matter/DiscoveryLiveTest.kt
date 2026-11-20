package dev.couchtv.ontv.matter

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The real network, with the same socket code the TV runs (DiscoveryMdns is plain java.net). Off
 * unless MATTER_LIVE=1, because it needs Matter devices on the LAN:
 *   MATTER_LIVE=1 MATTER_LIVE_NODE=7A11 MATTER_LIVE_DISCRIMINATOR=3101 gradle testDebugUnitTest --tests '*DiscoveryLiveTest*'
 * MATTER_LIVE_NODE: a commissioned node id (hex) that must be found with IPv6 addresses.
 * MATTER_LIVE_DISCRIMINATOR: a device in pairing mode that must be found.
 */
class DiscoveryLiveTest {
    @Test fun findsTheVirtualDevicesOnTheLan() {
        assumeTrue(System.getenv("MATTER_LIVE") == "1")
        val c = DiscoveryModel.Collector()
        val stats = DiscoveryMdns(log = { println(it) }).run(DiscoveryModel.ALL_TYPES.map { it to DiscoveryDns.TYPE_PTR }, c, 4000)
        val nodes = c.nodes(); val routers = c.borderRouters()
        println("live: $stats")
        nodes.forEach { println("live node: ${it.kind} ${it.instance} name=${it.name} D=${it.discriminator} port=${it.port} v4=${it.ipv4} v6=${it.ipv6} thread=${it.onThread}") }
        routers.forEach { println("live border router: ${it.label} prefix=${it.threadPrefix} v6=${it.ipv6.size}") }
        assertTrue("received nothing", stats.received > 0)
        System.getenv("MATTER_LIVE_NODE")?.let { hex ->
            val n = DiscoveryModel.pickOperational(nodes, java.lang.Long.parseUnsignedLong(hex, 16), null)
            assertNotNull("node $hex not found", n)
            assertTrue("node $hex has no IPv6", n!!.ipv6.isNotEmpty())
        }
        System.getenv("MATTER_LIVE_DISCRIMINATOR")?.toInt()?.let { d ->
            assertTrue("discriminator $d not found", nodes.any { it.kind == DiscoveryModel.Kind.COMMISSIONABLE && it.discriminator == d && it.addresses.isNotEmpty() })
        }
    }
}
