package app.couchtv.launcher

/**
 * Wrong pairing tries across every code (PhoneAuth; the on-TV app's PairLock.kt, the same rule). 15 wrong tries within 10 minutes lock pairing for
 * 10 minutes: /api/pair and /api/pair/start answer 429 until then. Plain Kotlin, so PairLockTest runs
 * it on a computer with a made up clock.
 */
class PairLock(private val max: Int = 15, private val windowMs: Long = 10 * 60_000L, private val lockMs: Long = 10 * 60_000L) {
    private val tries = ArrayDeque<Long>()
    private var until = 0L

    /** Seconds the lock has left at [now] (0: open). */
    @Synchronized fun lockedFor(now: Long): Int = if (now < until) (((until - now) + 999) / 1000).toInt() else 0

    /** Counts one wrong try at [now]. True when this try has just locked pairing. */
    @Synchronized fun wrong(now: Long): Boolean {
        while (tries.isNotEmpty() && now - tries.first() >= windowMs) tries.removeFirst()
        tries.addLast(now)
        if (tries.size >= max) { until = now + lockMs; tries.clear(); return true }
        return false
    }

    /** For the tests (and a TV restart starts open anyway). */
    @Synchronized fun reset() { tries.clear(); until = 0L }
}
