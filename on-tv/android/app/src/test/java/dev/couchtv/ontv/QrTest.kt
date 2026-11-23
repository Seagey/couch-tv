package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Test
import java.security.MessageDigest

/**
 * The setup screen's QR code (Qr.kt) must be the very code tv-home/web/qr.js draws, which is checked by
 * decoding (tools/tv-designer/server/tests/qr.test.mjs). The hashes are of qr.js's own rows ("1" dark,
 * "0" light, one row per line), made with node from that file on 19 Nov 2026.
 */
class QrTest {
    private fun hash(rows: List<String>) = MessageDigest.getInstance("SHA-256").digest(rows.joinToString("\n").toByteArray())
        .joinToString("") { "%02x".format(it) }

    @Test fun sameAsTheHomePageForAPhoneAddress() {
        val r = Qr.rows("http://192.0.2.10:5400")
        assertEquals(25, r.size)
        assertEquals("3bcea4ede94a44046f3c3647e2b3db384ab9d67d02189aee21f75f15a3ef7f86", hash(r))
    }

    @Test fun sameForTheSetupPage() {
        assertEquals("fc30ef2dfdab0a1ee8b2775c5d68e5f5bd5ff2a31bcd4aedb241bbd05e784e75", hash(Qr.rows("http://192.0.2.10:5400/setup")))
    }

    @Test fun sameForALongTextWithVersionBits() {
        val t = "https://example.com/a-much-longer-address-that-needs-a-bigger-version-of-the-code-to-fit-in-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        val r = Qr.rows(t)
        assertEquals(53, r.size)
        assertEquals("3e49e93530992f49b826fc4bd2c5dfe432a97e3ef3fcd348fbe152aeb1c28af4", hash(r))
    }
}
