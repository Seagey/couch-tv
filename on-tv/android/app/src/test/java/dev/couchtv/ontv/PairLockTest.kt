package dev.couchtv.ontv

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * S1: 15 wrong pairing codes in 10 minutes, across codes, lock pairing for 10 minutes (PairLock, Auth).
 * S2: the code a QR or someone typing is using is never swapped by asking again (pinForQr), and every
 * change of code reaches the listeners (HomeActivity redraws the QR from them).
 */
class PairLockTest {
    private var now = 1_000_000_000L

    @Before fun setUp() { Auth.clock = { now }; Auth.resetLocks(); Auth.lastPairedAt = 0 }
    @After fun tearDown() { Auth.resetLocks() }

    @Test fun fourteenWrongTriesStayOpenTheFifteenthLocks() {
        val l = PairLock()
        repeat(14) { assertFalse(l.wrong(now + it * 1000L)) }
        assertEquals(0, l.lockedFor(now + 14_000))
        assertTrue(l.wrong(now + 14_000))
        assertEquals(600, l.lockedFor(now + 14_000))
    }

    @Test fun theLockLastsTenMinutesThenOpens() {
        val l = PairLock()
        repeat(15) { l.wrong(now) }
        assertEquals(600, l.lockedFor(now))
        assertEquals(1, l.lockedFor(now + 599_500))
        assertEquals(0, l.lockedFor(now + 600_000))
    }

    @Test fun triesOlderThanTenMinutesDoNotCount() {
        val l = PairLock()
        repeat(14) { l.wrong(now) }
        assertFalse(l.wrong(now + 600_000))    // the first 14 fell out of the window
        assertEquals(0, l.lockedFor(now + 600_000))
    }

    /**
     * True when the TV takes [code] from [addr]: a token comes back, or (in these plain JVM tests, with no Android
     * Store) the right code got past every lock and was used up, which is only reached for an accepted code.
     */
    private fun accepted(code: String, addr: String): Boolean = try {
        Auth.pair(code, "x", addr) != null
    } catch (e: UninitializedPropertyAccessException) { Auth.currentPin() == null && Auth.lastPairedAt > 0 }

    /** A wrong code for the live one: six digits that are not it, different for each n. */
    private fun bad(code: String, n: Int): String { var b = String.format("%06d", (n * 7919) % 1_000_000); if (b == code) b = String.format("%06d", (n * 7919 + 1) % 1_000_000); return b }

    /** [count] different wrong codes from [addr], each on a fresh code if the last one was thrown away. */
    private fun guess(addr: String, count: Int, from: Int = 0) = repeat(count) {
        val c = Auth.currentPin() ?: Auth.newPin()
        assertNull(Auth.pair(bad(c, from + it + 1), "x", addr)); now += 500
    }

    @Test fun wrongTriesFromThreeAddressesLockPairingForEveryone() {
        // 5 different wrong codes from each of 3 addresses: the 15th locks pairing for everyone
        guess("192.0.2.1", 5); guess("192.0.2.2", 5, 100)
        assertEquals(0, Auth.lockedEverywhere())
        guess("192.0.2.3", 5, 200)
        assertTrue(Auth.lockedEverywhere() in 595..600)
        assertTrue(Auth.lockedFor("192.0.2.99") > 0)
        // while locked, even the right code is refused, and the refusal does not count against the new code
        val code = Auth.newPin()
        assertNull(Auth.pair(code, "x", "192.0.2.99"))
        assertEquals(code, Auth.currentPin())
        now += 600_000
        assertEquals(0, Auth.lockedFor("192.0.2.99"))
    }

    @Test fun triesWithNoLiveCodeDoNotCount() {
        Auth.newPin(); now += 200_000           // the code ran out
        assertNull(Auth.currentPin())
        repeat(30) { assertNull(Auth.pair(String.format("%06d", it), "x", "192.0.2.5")) }
        assertEquals(0, Auth.lockedFor("192.0.2.5"))   // nothing to guess: nobody can keep pairing locked
    }

    // coordinator 21 Nov (1): the same wrong code again from one address is not a new try
    @Test fun theSameWrongCodeSixTimesFromOneAddressLeavesTheLiveCodeWorking() {
        val code = Auth.newPin()
        val b = bad(code, 1)
        repeat(6) { assertNull(Auth.pair(b, "x", "192.0.2.5")) }
        assertEquals(code, Auth.currentPin())          // still live: one guess, not six
        assertEquals(0, Auth.lockedFor("192.0.2.5"))
        assertTrue(accepted(code, "192.0.2.6"))
    }

    // coordinator 21 Nov (2): one address may make 5 different wrong tries in 10 minutes, then it waits
    @Test fun oneAddressIsLimitedAfterFiveDifferentWrongCodes() {
        guess("192.0.2.5", 5)
        assertTrue(Auth.lockedFor("192.0.2.5") in 590..600)
        assertEquals(0, Auth.lockedFor("192.0.2.6"))   // nobody else waits
        assertEquals(0, Auth.lockedEverywhere())       // the setup screen and its QR keep their code
        val code = Auth.newPin()
        assertNull(Auth.pair(code, "x", "192.0.2.5"))  // the guessing phone: refused even with the right code
        assertEquals(code, Auth.currentPin())
        assertTrue(accepted(code, "192.0.2.6"))  // anyone else: pairs
        now += 600_000
        assertEquals(0, Auth.lockedFor("192.0.2.5"))   // 10 minutes on, it may try again
    }

    @Test fun fiveDifferentWrongTriesThrowTheCodeAwayAndTellTheListeners() {
        val code = Auth.newPin()
        val seen = mutableListOf<String?>()
        val fn: (String?) -> Unit = { seen += it }
        Auth.onPin(fn)
        try {
            for (i in 1..4) Auth.pair(bad(code, i), "x", "192.0.2.${i}")
            assertTrue(seen.isEmpty())
            assertEquals(code, Auth.currentPin())
            Auth.pair(bad(code, 5), "x", "192.0.2.5")
            assertNull(Auth.currentPin())
            assertEquals(listOf<String?>(null), seen)
        } finally { Auth.offPin(fn) }
    }

    @Test fun theLockThrowsAwayTheLiveCodeAndTellsTheListeners() {
        guess("192.0.2.1", 5); guess("192.0.2.2", 5, 100); guess("192.0.2.3", 4, 200)
        val code = Auth.currentPin() ?: Auth.newPin()
        val seen = mutableListOf<String?>()
        val fn: (String?) -> Unit = { seen += it }
        Auth.onPin(fn)
        try {
            Auth.pair(bad(code, 999), "x", "192.0.2.3")   // the 15th wrong try: locked for everyone, code gone
            assertNull(Auth.currentPin())
            assertTrue(Auth.lockedEverywhere() > 0)
            assertEquals(listOf<String?>(null), seen)
        } finally { Auth.offPin(fn) }
    }

    @Test fun newPhoneCodeOnTheTvOpensEveryLock() {
        guess("192.0.2.1", 5); guess("192.0.2.2", 5, 100); guess("192.0.2.3", 5, 200)
        Auth.resetLocks(); Auth.newPin()                // SetupActivity, New phone code
        assertEquals(0, Auth.lockedEverywhere())
        assertEquals(0, Auth.lockedFor("192.0.2.1"))
    }

    @Test fun anIpv6PhoneCountsByItsSlash64AndMappedIpv4IsTheSame() {
        assertEquals(Auth.addressKey("2001:db8:1:2::5"), Auth.addressKey("2001:db8:1:2:aaaa:bbbb:cccc:9"))
        assertNotEquals(Auth.addressKey("2001:db8:1:2::5"), Auth.addressKey("2001:db8:1:3::5"))
        assertEquals("192.0.2.5", Auth.addressKey("::ffff:192.0.2.5"))
        assertEquals(Auth.addressKey("fe80::1%wlan0"), Auth.addressKey("fe80::2"))
        guess("2001:db8:1:2::5", 3); guess("2001:db8:1:2::77", 2, 50)   // a new address in the same /64 counts on
        assertTrue(Auth.lockedFor("2001:db8:1:2::1234") > 0)
    }

    @Test fun atMost1000AddressesAreKept() {
        // 1200 phones one wrong try each, 1 s apart, all within the window: the oldest go first
        for (i in 0 until 1200) {
            val c = Auth.newPin()
            Auth.pair(bad(c, i + 1), "x", "198.51.${100 + i / 250}.${i % 250}")
            Auth.lock.reset()                         // keep the lock for everyone open, this test is about the map
            now += 100
        }
        assertEquals(1000, Auth.addressesKept())
    }

    @Test fun pinForQrKeepsALiveCodeAndMakesANewOneNearTheEnd() {
        val a = Auth.newPin()
        now += 60_000
        assertEquals(a, Auth.pinForQr())        // 120 s left: the same code
        now += 100_000                          // 20 s left: a new one, so a QR is never about to die
        var changed: String? = "none"
        val fn: (String?) -> Unit = { changed = it }
        Auth.onPin(fn)
        try {
            val b = Auth.pinForQr()
            assertNotEquals("none", changed)
            assertEquals(b, changed)
            assertEquals(180, Auth.pinSecondsLeft())
        } finally { Auth.offPin(fn) }
    }
}
