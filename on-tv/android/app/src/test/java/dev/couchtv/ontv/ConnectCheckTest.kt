package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** "Can't connect?" (ConnectCheck.kt): each answer from a fake TV state, and a report that keeps addresses and keys out. */
class ConnectCheckTest {
    private val g = ConnectCheck.Facts(sdk = 34)              // a Google TV, Android 14, on Wi-Fi, debugging on
    private val old = ConnectCheck.Facts(sdk = 28)            // Android TV 9: no Wireless debugging menu

    @Test fun connectedIsOk() = assertEquals("ok", ConnectCheck.diagnose(g.copy(connected = true, route = "tls", state = "connected")))

    @Test fun phoneNetworkNeverBlamed() {
        // the TV's ADB is its own (127.0.0.1): a phone on another network or VLAN never stops key presses
        assertEquals("debugging_off", ConnectCheck.diagnose(g.copy(phoneSameNetwork = false, debuggingOn = false)))
        assertEquals("needs_pairing", ConnectCheck.diagnose(g.copy(phoneSameNetwork = false, wirelessOn = true)))
        assertFalse(ConnectCheck.CODES.contains("other_network"))
    }

    @Test fun fireTvUsesPlainPortOnly() {
        // Fire OS on Android 9 or 11: never Wireless debugging, ethernet or pairing answers
        val fire = ConnectCheck.Facts(sdk = 30, fireTv = true)
        assertEquals("no_wireless", ConnectCheck.diagnose(fire.copy(state = "failed")))
        assertEquals("no_wireless", ConnectCheck.diagnose(fire.copy(onWifi = false, onEthernet = true, wirelessOn = false)))
        assertEquals("port_closed", ConnectCheck.diagnose(fire.copy(everAllowed = true, state = "failed")))
        assertEquals("debugging_off", ConnectCheck.diagnose(fire.copy(debuggingOn = false)))
        assertTrue(ConnectCheck.report(fire, "no_wireless", "Amazon AFTKA", "11", "0.13.9").contains("Wireless debugging on: not on Fire TV"))
    }

    @Test fun fireTvBlocked() = assertEquals("fire_blocked", ConnectCheck.diagnose(old.copy(fireBlocked = true, port5555Open = true)))

    @Test fun debuggingSwitchedOff() {
        assertEquals("debugging_off", ConnectCheck.diagnose(g.copy(debuggingOn = false)))
        assertEquals("debugging_off", ConnectCheck.diagnose(old.copy(debuggingOn = false)))
    }

    @Test fun allowQuestionOnScreenNow() {
        assertEquals("waiting_allow", ConnectCheck.diagnose(g.copy(state = "waiting_for_allow", port5555Open = true)))
        assertEquals("waiting_allow", ConnectCheck.diagnose(g.copy(state = "connecting")))
    }

    @Test fun allowNeverAnswered() {
        assertEquals("allow_unanswered", ConnectCheck.diagnose(g.copy(state = "failed", unanswered = true)))
        // the port answers but Couch TV was not let in
        assertEquals("allow_unanswered", ConnectCheck.diagnose(old.copy(state = "failed", port5555Open = true)))
    }

    @Test fun tvOnEthernet() {
        assertEquals("ethernet", ConnectCheck.diagnose(g.copy(state = "needs_pairing", onWifi = false, onEthernet = true, wirelessOn = false)))
        // Ethernet is fine for plain 5555 on an older TV: not the answer there
        assertEquals("no_wireless", ConnectCheck.diagnose(old.copy(onWifi = false, onEthernet = true)))
        // Ethernet with the port open: the Allow question, not the cable
        assertEquals("allow_unanswered", ConnectCheck.diagnose(g.copy(onWifi = false, onEthernet = true, port5555Open = true, state = "failed")))
    }

    @Test fun wirelessDebuggingOff() = assertEquals("wireless_off", ConnectCheck.diagnose(g.copy(wirelessOn = false, state = "needs_pairing")))

    @Test fun wirelessOnButNotPaired() = assertEquals("needs_pairing", ConnectCheck.diagnose(g.copy(wirelessOn = true, state = "needs_pairing")))

    @Test fun portClosed() {
        // paired and switched on, but the port could not be reached (after a restart)
        assertEquals("port_closed", ConnectCheck.diagnose(g.copy(wirelessOn = true, tlsPaired = true, state = "failed")))
        // an older TV that worked before: Network debugging closed after a restart
        assertEquals("port_closed", ConnectCheck.diagnose(old.copy(everAllowed = true, state = "failed")))
    }

    @Test fun noWirelessDebuggingOnOlderTv() = assertEquals("no_wireless", ConnectCheck.diagnose(old.copy(state = "failed")))

    @Test fun everyCodeIsReachableAndKnown() {
        val seen = setOf(
            ConnectCheck.diagnose(g.copy(connected = true)),
            ConnectCheck.diagnose(g.copy(fireBlocked = true)), ConnectCheck.diagnose(g.copy(debuggingOn = false)),
            ConnectCheck.diagnose(g.copy(state = "connecting")), ConnectCheck.diagnose(g.copy(unanswered = true)),
            ConnectCheck.diagnose(g.copy(onWifi = false, onEthernet = true)), ConnectCheck.diagnose(g.copy(wirelessOn = false)),
            ConnectCheck.diagnose(g.copy(wirelessOn = true)), ConnectCheck.diagnose(g.copy(wirelessOn = true, tlsPaired = true)),
            ConnectCheck.diagnose(old),
        )
        assertTrue(ConnectCheck.CODES.containsAll(seen))
        // every code but "unknown" (the page's own fallback) comes from some state
        assertEquals(ConnectCheck.CODES.toSet() - "unknown", seen)
    }

    @Test fun sameNetworkByPrefix() {
        assertEquals(true, ConnectCheck.sameNetwork("198.51.100.50", "198.51.100.24", 24))
        assertEquals(false, ConnectCheck.sameNetwork("198.51.101.50", "198.51.100.24", 24))
        assertEquals(true, ConnectCheck.sameNetwork("198.51.101.50", "198.51.100.24", 22))
        assertEquals(false, ConnectCheck.sameNetwork("203.0.113.9", "198.51.100.24", 24))   // a guest network
        assertEquals(true, ConnectCheck.sameNetwork("127.0.0.1", "198.51.100.24", 24))   // the TV's own browser
        assertEquals(true, ConnectCheck.sameNetwork("::ffff:198.51.100.9", "198.51.100.24", 24))
        assertNull(ConnectCheck.sameNetwork("fe80::1", "198.51.100.24", 24))
        assertNull(ConnectCheck.sameNetwork(null, "198.51.100.24", 24))
        assertNull(ConnectCheck.sameNetwork("198.51.100.9", null, 24))
    }

    @Test fun maskKeepsAddressesAndKeysOut() {
        val m = ConnectCheck.mask("198.51.100.24:5555 accepted the connection but adbd did not answer; 127.0.0.1:41233: SSLException: key abcdefghijklmnopqrstuvwxyz0123 fe80::1c2b:3aff:fe4d:5e6f")
        assertFalse(m.contains("198.51"))
        assertFalse(m.contains("fe80"))
        assertFalse(m.contains("abcdefghijklmnop"))
        assertTrue(m.contains("[address]:5555"))
        assertTrue(m.contains("127.0.0.1:41233"))
        assertTrue(m.contains("[hidden]"))
        assertEquals("none", ConnectCheck.mask(null))
        assertTrue(ConnectCheck.mask("x".repeat(20) + " " + "y ".repeat(400)).length <= 301)
    }

    @Test fun reportIsShortAndPrivate() {
        val f = g.copy(state = "failed", onWifi = false, onEthernet = true, wirelessOn = false, phoneSameNetwork = true,
            lastError = "Wireless debugging is not on. 198.51.100.24 then zyxwvutsrqponmlkjihgfedcba98765")
        val r = ConnectCheck.report(f, ConnectCheck.diagnose(f), "TCL 55C735", "14", "0.13.9")
        assertTrue(r.startsWith("Couch TV report\n"))
        assertTrue(r.contains("TV: TCL 55C735, Android 14 (API 34)"))
        assertTrue(r.contains("Network: Ethernet"))
        assertTrue(r.contains("Wireless debugging on: no"))
        assertTrue(r.contains("Check says: ethernet"))
        assertTrue(r.contains("App: on-TV 0.13.9"))
        assertFalse(r.contains("198.51"))
        assertFalse(r.contains("zyxwvutsrqpon"))
        assertTrue(r.lines().size <= 14)
        // an older TV says so instead of "no"
        assertTrue(ConnectCheck.report(old, "no_wireless", "Sony", "9", "0.13.9").contains("Wireless debugging on: not on this Android"))
    }
}
