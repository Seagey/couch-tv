package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** Ask AI on the TV home, and messages and designs from the person's own AI agent (Say.kt). */
class SayTest {
    @Before fun fresh() = Say.clear()

    @Test fun readsCodesLikeTheTvHome() {
        assertEquals("ABCDE-FGHJK", Say.readCode(" abcde fghjk "))
        assertEquals("ABCDE-FGHJK", Say.readCode("ABCDE-FGHJK"))
        assertEquals("", Say.readCode("ABCDE-FGHJ1"))   // 1 is not in the code alphabet
        assertEquals("", Say.readCode("https://example.com/x"))
        val long = "A".repeat(43)
        assertEquals("CTV1-$long", Say.readCode("ctv1-$long"))
    }

    @Test fun messageIsPlainShortAndBounded() {
        val m = Say.message("Dinner\u0007 is   ready" + "x".repeat(400), null, 9999, 5)
        assertEquals(Say.MAX_TEXT, m.getString("text").length)
        assertFalse(m.getString("text").contains("\u0007"))
        assertTrue(m.getString("text").startsWith("Dinner is ready"))
        assertEquals("Your AI", m.getString("from"))
        assertEquals(600, m.getInt("seconds"))
        assertEquals(5, Say.message("hi", "Claude", 1).getInt("seconds"))
    }

    @Test(expected = IllegalArgumentException::class) fun emptyMessageIsRefused() { Say.message("   ", null, null) }

    @Test(expected = IllegalArgumentException::class) fun aLinkIsNotACode() { Say.design("http://evil.example/design.json") }

    @Test fun aSceneIsOnlyNextOrPrev() {
        assertEquals("next", Say.scene("next", now = 5L).getString("pick"))
        Say.scene("prev")
        assertEquals("prev", Say.snapshot().getJSONObject("scene").getString("pick"))
        for (bad in listOf("night", "", null, "<script>")) {
            try { Say.scene(bad); fail("took $bad") } catch (e: IllegalArgumentException) { }
        }
        Say.clear()
        assertTrue(Say.snapshot().isNull("scene"))
    }

    @Test fun aDesignSaysOnlyPhoneOrAi() {
        assertEquals("phone", Say.design("abcde-fghjk", from = "phone").getString("from"))
        assertEquals("ai", Say.design("abcde-fghjk").getString("from"))
        assertEquals("ai", Say.design("abcde-fghjk", from = "<b>Mum's phone</b>").getString("from"))
    }

    @Test fun listeningOnlyWhileTheHomeAsks() {
        assertFalse(Say.listening(1_000_000))
        Say.heard(1_000_000)
        assertTrue(Say.listening(1_000_000 + 29_000))
        assertFalse(Say.listening(1_000_000 + 31_000))
    }

    @Test fun snapshotHoldsTheLatestOfEach() {
        assertTrue(Say.snapshot().isNull("message"))
        Say.design("abcde-fghjk")
        Say.asked("what is on tonight", "Bluey at 7", "test")
        val s = Say.snapshot()
        assertEquals("ABCDE-FGHJK", s.getJSONObject("design").getString("code"))
        assertEquals("Bluey at 7", s.getJSONObject("ask").getString("a"))
    }
}
