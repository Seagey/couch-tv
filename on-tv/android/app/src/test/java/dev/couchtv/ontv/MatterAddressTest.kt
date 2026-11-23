package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterCode
import dev.couchtv.ontv.matter.MatterModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The address typed with a code: number addresses only, a real port, never a bare link local IPv6. */
class MatterAddressTest {
    @Test fun goodAddresses() {
        MatterCode.address("192.0.2.7").let { assertNull(it.reason); assertEquals("192.0.2.7", it.host); assertEquals(5540, it.port) }
        MatterCode.address("192.0.2.7:5541").let { assertNull(it.reason); assertEquals(5541, it.port) }
        MatterCode.address("[fec0::2]:5544").let { assertNull(it.reason); assertEquals("fec0::2", it.host); assertEquals(5544, it.port) }
        MatterCode.address("fd00::1").let { assertNull(it.reason); assertEquals("fd00::1", it.host); assertEquals(5540, it.port) }
        MatterCode.address("[fe80::1%wlan0]:5540").let { assertNull(it.reason); assertEquals("fe80::1%wlan0", it.host) }
        MatterCode.address(" 192.0.2.7:65535 ").let { assertNull(it.reason); assertEquals(65535, it.port) }
    }

    @Test fun badAddressesSayWhy() {
        listOf("lamp.example", "example.com:5540", "300.1.1.1", "1.2.3", "[fec0::2", "[fec0::2]x", "fe80::1%bad name", "::ffff:192.0.2.7", "").forEach {
            assertEquals(it, "address", MatterCode.address(it).reason)
        }
        listOf("192.0.2.7:0", "192.0.2.7:65536", "192.0.2.7:", "192.0.2.7:55a", "[fec0::2]:99999").forEach {
            assertEquals(it, "port", MatterCode.address(it).reason)
        }
        assertEquals("link_local", MatterCode.address("fe80::1").reason)
        assertEquals("link_local", MatterCode.address("[fe80::1]:5540").reason)
        MatterCode.ADDRESS_NOTES.values.forEach { assertTrue(it, !it.contains('—') && !it.contains('–') && !it.contains(" - ")) }
    }

    @Test fun refusedAnswersCarryAReason() {
        // the keys the screens word (contract change 14); the rename one is set where it is thrown
        assertEquals("not_found", dev.couchtv.ontv.matter.Matter.Refused(404, "x").reason)
        assertEquals("opens_house", dev.couchtv.ontv.matter.Matter.Refused(400, "x", "opens_house").reason)
        assertEquals("not_answering", dev.couchtv.ontv.matter.Matter.Refused(504, "x").reason)
        assertEquals("Lounge lamp", MatterModel.cleanName("Lounge‮lamp".replace("‮", "‮ ")))
    }

    // contract change 15: every refused commission carries a reason; the key itself unless a caller puts a more specific one
    @Test fun everyCommissionFailureCarriesAReason() {
        listOf("wrong_code", "expired", "unreachable", "thread", "already").forEach { k ->
            val o = MatterCode.failure(k, MatterCode.NOTES.getValue(k))
            assertEquals(false, o.getBoolean("ok")); assertEquals(k, o.getString("error")); assertEquals(k, o.getString("reason"))
            assertEquals(0, o.getJSONArray("device_ids").length()); assertTrue(o.getString("note").isNotEmpty())
        }
        // a bad code from parse() keeps its own key as the reason
        val bad = MatterCode.parse("12345") as MatterCode.Parsed.Bad
        assertEquals(bad.key, MatterCode.failure(bad.key, bad.note).getString("reason"))
        // a caller's more specific reason wins (busy, blocked, port)
        assertEquals("blocked", MatterCode.failure("not_allowed", "x").put("reason", "blocked").getString("reason"))
        assertEquals("port", MatterCode.failure("unreachable", "x", "port").getString("reason"))
    }

    // an address named in the request where nothing answered: unreachable, reason address (ports 1 to 65535 still allowed)
    @Test fun nothingAnsweredAtTheAddressIsUnreachable() {
        assertEquals("unreachable" to "address", MatterCode.commissionFailure("expired", viaAddress = true))
        assertEquals("expired" to "expired", MatterCode.commissionFailure("expired", viaAddress = false))
        listOf("wrong_code", "already", "thread", "unreachable").forEach {
            assertEquals(it to it, MatterCode.commissionFailure(it, viaAddress = true))
        }
        val key = MatterCode.failureKey(null, MatterCode.ERR_TIMEOUT)   // the device never answered
        val (k, r) = MatterCode.commissionFailure(key, viaAddress = true)
        assertEquals("unreachable", k); assertEquals("address", r)
        assertEquals(MatterCode.ADDRESS_SILENT, MatterCode.failureNote(k, r))
        assertEquals(MatterCode.NOTES["expired"], MatterCode.failureNote("expired", "expired"))
        assertNull(MatterCode.address("192.0.2.7:1").reason)
        assertTrue(!MatterCode.ADDRESS_SILENT.contains('—') && !MatterCode.ADDRESS_SILENT.contains(" - "))
    }
}
