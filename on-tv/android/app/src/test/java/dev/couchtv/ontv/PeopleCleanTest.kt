package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The people list the home hands over (Server.kt POST /api/people): an account person keeps its mark. */
class PeopleCleanTest {
    private fun person(id: String, name: String) = JSONObject().put("id", id).put("name", name)

    @Test fun anAccountPersonKeepsItsMarkKidsFlagAndColour() {
        val out = PeopleClean.clean(JSONArray()
            .put(person("p_3k9x2m", "Ruby").put("src", "account").put("kid", true).put("colour", "#e07a5f"))
            .put(person("mum", "Mum")))
        val ruby = out.getJSONObject(0)
        assertEquals("account", ruby.getString("src"))
        assertTrue(ruby.getBoolean("kid"))
        assertEquals("#e07a5f", ruby.getString("colour"))
        val mum = out.getJSONObject(1)
        assertFalse(mum.has("src")); assertFalse(mum.has("kid")); assertFalse(mum.has("colour"))
    }

    @Test fun aPhotoOrAnythingElseNeverComesHere() {
        val out = PeopleClean.clean(JSONArray().put(person("p_3k9x2m", "Ruby")
            .put("photo", "data:image/jpeg;base64,/9j/4AAQ").put("src", "phone").put("colour", "red").put("kid", "yes").put("pin", "1234")))
        val p = out.getJSONObject(0)
        assertEquals(setOf("id", "name"), p.keys().asSequence().toSet())
    }

    @Test fun guestsStayGuests() {
        assertTrue(PeopleClean.clean(JSONArray().put(person("g", "Visitor").put("guest", true))).getJSONObject(0).getBoolean("guest"))
    }

    @Test fun namesAreTidiedAndTheListIsCapped() {
        val list = JSONArray()
        list.put(person("", "  Sam  "))
        list.put(person("blank", "   "))
        list.put(person("long", "x".repeat(60)))
        for (i in 0 until 20) list.put(person("n$i", "N$i"))
        val out = PeopleClean.clean(list)
        assertEquals("person1", out.getJSONObject(0).getString("id"))
        assertEquals("Sam", out.getJSONObject(0).getString("name"))
        assertEquals(40, out.getJSONObject(1).getString("name").length)
        assertEquals(11, out.length())   // the first 12 sent, less the blank one
    }
}
