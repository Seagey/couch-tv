package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The home page's files answer 304 to the WebView's own copy of this version, and never to another's (StaticTag.kt). */
class StaticTagTest {
    private val tag = StaticTag.of(1310, 1795000000000)

    @Test fun oneTagPerInstalledVersion() {
        assertEquals("\"tv-1310-1795000000000\"", tag)
        assertNotEquals(tag, StaticTag.of(1311, 1795000000000))
        assertNotEquals("an update of the same version code still gets a new tag", tag, StaticTag.of(1310, 1795000999000))
    }

    @Test fun theSameCopyIsUnchanged() {
        assertTrue(StaticTag.unchanged(tag, tag))
        assertTrue(StaticTag.unchanged("W/$tag", tag))
        assertTrue(StaticTag.unchanged("\"tv-1-1\", $tag", tag))
    }

    @Test fun anythingElseGetsTheFile() {
        assertFalse(StaticTag.unchanged(null, tag))
        assertFalse(StaticTag.unchanged("", tag))
        assertFalse(StaticTag.unchanged("*", tag))
        assertFalse(StaticTag.unchanged(StaticTag.of(1309, 1795000000000), tag))
        assertFalse(StaticTag.unchanged("tv-1310-1795000000000", tag))
    }
}
