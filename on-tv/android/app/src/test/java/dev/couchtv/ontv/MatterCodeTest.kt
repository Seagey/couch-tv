package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterCode
import dev.couchtv.ontv.matter.MatterCode.Parsed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MatterCodeTest {
    @Test fun acceptsRealCodes() {
        // the test code of the virtual light (passcode 20202021, discriminator 3840) and the spike's light
        assertEquals(Parsed.Manual("34970112332"), MatterCode.parse("34970112332"))
        assertEquals(Parsed.Manual("34970112332"), MatterCode.parse(" 3497-011-2332 "))
        assertEquals(Parsed.Manual("34970112332"), MatterCode.parse("3497 011 2332"))
        assertEquals(Parsed.Qr("MT:-24J0AFN00KA0648G00"), MatterCode.parse("mt:-24j0afn00ka0648g00"))
    }

    @Test fun refusesWrongCodes() {
        listOf("", "   ", "1234", "34970112333", "94970112332", "3497011233a", "MT:", "MT:abc", "http://x").forEach {
            val p = MatterCode.parse(it)
            assertTrue("$it should be refused", p is Parsed.Bad)
            assertEquals("wrong_code", (p as Parsed.Bad).key)
        }
    }

    @Test fun verhoeff() {
        assertEquals(2, MatterCode.checkDigit("3497011233"))
        assertTrue(MatterCode.verhoeffOk("2363"))   // the classic Verhoeff example: 236 -> 3
        // every single digit change is caught
        val good = "34970112332"
        for (i in good.indices) for (d in '0'..'9') if (d != good[i]) {
            val bad = good.substring(0, i) + d + good.substring(i + 1)
            assertTrue(bad, !MatterCode.verhoeffOk(bad))
        }
    }

    @Test fun failureKeys() {
        assertEquals("wrong_code", MatterCode.failureKey("SecurePairing", MatterCode.ERR_INVALID_PASE_PARAMETER))
        assertEquals("wrong_code", MatterCode.failureKey(null, MatterCode.ERR_INVALID_PASE_PARAMETER))
        assertEquals("expired", MatterCode.failureKey(null, MatterCode.ERR_TIMEOUT))
        assertEquals("expired", MatterCode.failureKey("SecurePairing", MatterCode.ERR_TIMEOUT))
        assertEquals("unreachable", MatterCode.failureKey("FindOperationalForStayActive", MatterCode.ERR_TIMEOUT))
        assertEquals("thread", MatterCode.failureKey("FindOperationalForCommissioningComplete", MatterCode.ERR_TIMEOUT, thread = true))
        assertEquals("thread", MatterCode.failureKey("SendNOC", 3, thread = true, threadRoute = false))
        assertEquals("unreachable", MatterCode.failureKey("SendNOC", 3))
        assertEquals("already", MatterCode.failureKey("SendNOC", MatterCode.ERR_FABRIC_EXISTS))
        assertEquals(5, MatterCode.NOTES.size)
        MatterCode.NOTES.values.forEach { assertTrue(it, !it.contains('—') && !it.contains('–') && !it.contains(" - ")) }
    }
}
