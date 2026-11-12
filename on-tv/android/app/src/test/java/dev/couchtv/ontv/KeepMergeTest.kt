package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Test

/** Keep watching's rules for Android's Watch Next rows on the on-TV app (#122). */
class KeepMergeTest {
    private val self = "dev.couchtv.ontv"
    private fun wn(show: String, pkg: String, t: Long) = KeepMerge.Card(show, pkg, t, true, "wn $show $t")
    private fun mine(show: String, pkg: String, t: Long) = KeepMerge.Card(show, pkg, t, false, "history $show $t")

    @Test fun watchNextIsNewestFirstWithoutThisAppOrSkippedApps() {
        val rows = listOf(wn("ozark", "com.netflix.ninja", 1), wn("8 mile", "com.nuvio.tv", 3),
            wn("ours", self, 9), wn("a video", "com.amazon.firetv.youtube", 5))
        val out = KeepMerge.watchNext(rows, self, setOf("com.amazon.firetv.youtube"), 5)
        assertEquals(listOf("8 mile", "ozark"), out.map { it.show })
    }

    @Test fun watchNextKeepsAtMostPerAppFromOneApp() {
        val rows = (1..8).map { wn("show $it", "com.nuvio.tv", it.toLong()) } + wn("ozark", "com.netflix.ninja", 0)
        val out = KeepMerge.watchNext(rows, self, emptySet(), 3)
        assertEquals(listOf("show 8", "show 7", "show 6", "ozark"), out.map { it.show })
    }

    @Test fun watchNextPerAppStaysBetweenOneAndTwenty() {
        val rows = (1..30).map { wn("show $it", "com.nuvio.tv", it.toLong()) }
        assertEquals(1, KeepMerge.watchNext(rows, self, emptySet(), 0).size)
        assertEquals(20, KeepMerge.watchNext(rows, self, emptySet(), 99).size)
    }

    @Test fun anAppsTwoRowsForOneShowMakeOneCard() {
        val rows = listOf(wn("slow horses", "com.nuvio.tv", 5), wn("slow horses", "com.nuvio.tv", 2))
        assertEquals(listOf(5L), KeepMerge.watchNext(rows, self, emptySet(), 5).map { it.whenMs })
    }

    @Test fun theAppsNewerRowWinsOverOlderHistory() {
        // couch-tv saw S1E10 at 100, Netflix moved on to S2E3 at 200 (f1fd148, the Ozark case)
        val out = KeepMerge.merge(listOf(mine("ozark", "com.netflix.ninja", 100)), listOf(wn("ozark", "com.netflix.ninja", 200)), 10)
        assertEquals(listOf("wn ozark 200"), out.map { it.item })
    }

    @Test fun newerHistoryWinsOverAnOlderRow() {
        val out = KeepMerge.merge(listOf(mine("ozark", "com.netflix.ninja", 300)), listOf(wn("ozark", "com.netflix.ninja", 200)), 10)
        assertEquals(listOf("history ozark 300"), out.map { it.item })
    }

    @Test fun aTieKeepsCouchTvsOwnLine() {
        val out = KeepMerge.merge(listOf(mine("ozark", "x", 200)), listOf(wn("ozark", "x", 200)), 10)
        assertEquals(listOf("history ozark 200"), out.map { it.item })
    }

    @Test fun mergedRowIsNewestFirstAndCapped() {
        val history = (1..6).map { mine("mine $it", "a", it * 10L) }
        val rows = (1..6).map { wn("row $it", "b", it * 10L + 5) }
        val out = KeepMerge.merge(history, rows, 10)
        assertEquals(10, out.size)
        assertEquals(out.sortedByDescending { it.whenMs }, out)
        assertEquals("row 6", out.first().show)
    }

    @Test fun noRowsLeavesHistoryExactlyAsItWas() {
        val history = listOf(mine("c", "a", 30), mine("b", "a", 20), mine("a", "a", 10))
        assertEquals(history, KeepMerge.merge(history, emptyList<KeepMerge.Card<String>>(), 10))
    }
}
