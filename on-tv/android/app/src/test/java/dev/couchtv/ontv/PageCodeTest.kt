package dev.couchtv.ontv

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the app hands the home page (typed words, At home from the phone) stays data, never code. */
class PageCodeTest {
    @Test fun lineBreaksJavaScriptDoesNotAllowAreEscaped() {
        val s = PageCode.string("a b c")
        assertFalse(s.contains(' ')); assertFalse(s.contains(' '))
        assertTrue(s.contains("\\u2028")); assertTrue(s.contains("\\u2029"))
    }

    @Test fun quotesAndScriptEndsStayInsideTheString() {
        val s = PageCode.string("\"); alert(1); (\"</script>")
        assertTrue(s.startsWith("\"") && s.endsWith("\""))
        assertFalse(Regex("(?<!\\\\)\"").findAll(s.substring(1, s.length - 1)).any())
    }

    @Test fun jsonIsParsedByThePageNotRun() {
        val edit = JSONObject().put("note", JSONObject().put("text", "Fish & chips   \"6pm\""))
        val code = PageCode.json(edit.toString())
        assertTrue(code.startsWith("JSON.parse(\"") && code.endsWith("\")"))
        assertFalse(code.contains(' '))
        // what JSON.parse gets back is the same JSON
        val inner = code.removePrefix("JSON.parse(").removeSuffix(")")
        assertEquals(edit.toString(), JSONObject("{\"v\":$inner}").getString("v"))
    }
}
