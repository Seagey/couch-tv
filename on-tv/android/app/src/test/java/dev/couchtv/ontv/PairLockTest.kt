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

    @Before fun setUp() { Auth.clock = { now }; Auth.lock.reset() }
    @After fun tearDown() { Auth.clock = { System.currentTimeMillis() }; Auth.lock.reset() }

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

    @Test fun wrongTriesAcrossManyCodesLockPairing() {
        // 3 codes, 5 wrong tries each (each code is thrown away after 5): the 15th locks
        repeat(3) { round ->
            val code = Auth.newPin()
            val bad = if (code == "000000") "111111" else "000000"
            repeat(5) { assertNull(Auth.pair(bad, "x")); now += 1000 }
            if (round < 2) { assertNull(Auth.currentPin()); assertEquals(0, Auth.lockedFor()) }
        }
        assertTrue(Auth.lockedFor() in 595..600)
        // while locked, even the right code is refused
        val code = Auth.newPin()
        assertNull(Auth.pair(code, "x"))
        assertEquals(code, Auth.currentPin())   // and the refusal does not count against the new code
        now += 600_000
        assertEquals(0, Auth.lockedFor())
    }

    @Test fun triesWithNoLiveCodeCountToo() {
        Auth.newPin(); now += 200_000           // the code ran out
        assertNull(Auth.currentPin())
        repeat(15) { assertNull(Auth.pair("123456", "x")) }
        assertTrue(Auth.lockedFor() > 0)
    }

    @Test fun theLockThrowsAwayTheLiveCodeAndTellsTheListeners() {
        val seen = mutableListOf<String?>()
        val fn: (String?) -> Unit = { seen += it }
        repeat(10) { Auth.lock.wrong(now) }     // 10 already counted
        val code = Auth.newPin()
        Auth.onPin(fn)
        try {
            val bad = if (code == "000000") "111111" else "000000"
            repeat(4) { Auth.pair(bad, "x") }
            assertEquals(code, Auth.currentPin())
            Auth.pair(bad, "x")                  // the 15th wrong try: locked, code gone
            assertNull(Auth.currentPin())
            assertEquals(listOf<String?>(null), seen)
        } finally { Auth.offPin(fn) }
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

    @Test fun fiveWrongTriesTellTheListenersTheCodeIsGone() {
        val code = Auth.newPin()
        val seen = mutableListOf<String?>()
        val fn: (String?) -> Unit = { seen += it }
        Auth.onPin(fn)
        try {
            val bad = if (code == "000000") "111111" else "000000"
            repeat(4) { Auth.pair(bad, "x") }
            assertTrue(seen.isEmpty())
            Auth.pair(bad, "x")
            assertEquals(listOf<String?>(null), seen)
        } finally { Auth.offPin(fn) }
    }
}
