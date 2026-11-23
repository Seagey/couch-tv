package app.couchtv.launcher

import org.junit.Assert.assertEquals
import org.junit.Test

/** The memory a TV reports with a design fetch: whole MB, only in the store's 64 to 65536 range. */
class TvReportTest {
    private val mb = 1048576L

    @Test fun wholeMegabytesRoundedDown() {
        assertEquals(2048, TvReport.memoryMb(2048 * mb))
        assertEquals(912, TvReport.memoryMb(912 * mb + 1000))   // a "1 GB" TV sees about 900 MB
        assertEquals(1433, TvReport.memoryMb(1433 * mb + mb - 1))
    }

    @Test fun theStoreRangeAndNothingElse() {
        assertEquals(64, TvReport.memoryMb(64 * mb))
        assertEquals(65536, TvReport.memoryMb(65536 * mb))
        assertEquals(0, TvReport.memoryMb(63 * mb))
        assertEquals(0, TvReport.memoryMb(65537 * mb))
        assertEquals(0, TvReport.memoryMb(0L))
        assertEquals(0, TvReport.memoryMb(-1L))
        assertEquals(0, TvReport.memoryMb(Long.MAX_VALUE))
    }
}
