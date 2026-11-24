package app.couchtv.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    // The kind of TV (0.13.13): the five keys Couch TV Studio keeps, in its ranges, nothing else
    @Test fun platformAsSetupSaysIt() {
        assertEquals("Fire OS", TvReport.platform(true, "Amazon", false, true))
        assertEquals("Fire OS", TvReport.platform(false, "amazon", false, true))
        assertEquals("Google TV", TvReport.platform(false, "TCL", true, true))
        assertEquals("Android TV", TvReport.platform(false, "Sony", false, true))
        assertNull(TvReport.platform(false, "Google", false, false))
        assertNull(TvReport.platform(false, null, false, false))
    }

    @Test fun sdkAndScreenSize() {
        assertEquals(34, TvReport.sdk(34))
        assertEquals(23, TvReport.sdk(23))
        assertNull(TvReport.sdk(0))
        assertNull(TvReport.sdk(100))
        assertEquals("1920x1080", TvReport.res(1920, 1080))
        assertEquals("3840x2160", TvReport.res(2160, 3840))
        assertEquals("1280x720", TvReport.res(1280, 720))
        assertNull(TvReport.res(0, 0))
        assertNull(TvReport.res(1920, 99))
        assertNull(TvReport.res(20000, 1080))
    }

    @Test fun modelCleanedAndShort() {
        assertEquals("Smart TV Pro", TvReport.model("Smart TV Pro"))
        assertEquals("BRAVIA 4K VH2", TvReport.model("  BRAVIA\t4K\n VH2 "))
        assertEquals("scriptx/script", TvReport.model("<script>x</script>"))
        assertEquals(40, TvReport.model("A".repeat(80))!!.length)
        assertNull(TvReport.model(""))
        assertNull(TvReport.model("\u0000\u0007"))
        assertNull(TvReport.model(null))
    }

    @Test fun profileHasOnlyTheFiveKeys() {
        val p = TvReport.profile("Google TV", 34, 1843, "1920x1080", "Smart TV Pro")
        assertEquals(listOf("platform", "sdk", "memMb", "res", "model"), p.keys.toList())
        assertEquals(1843, p["memMb"])
        val empty = TvReport.profile(null, null, 0, null, null)
        assertTrue(empty.isEmpty())
        assertEquals(listOf("sdk"), TvReport.profile(null, 31, 63, null, null).keys.toList())
    }

    @Test
    fun appsAreCleanPackageNamesOnly() {
        val raw = listOf("com.netflix.ninja", "app.couchtv.launcher", "bad name", "com.netflix.ninja", "<x>.y", "org.a.b")
        assertEquals(listOf("com.netflix.ninja", "org.a.b"), TvReport.cleanApps(raw))
        assertEquals(300, TvReport.cleanApps((0 until 400).map { "com.x.p$it" }).size)
        assertTrue(TvReport.profile(null, null, 0, null, null, listOf("no")).isEmpty())
        assertTrue(TvReport.profile(null, 31, 0, null, null, listOf("com.a.b")).containsKey("apps"))
    }
}
