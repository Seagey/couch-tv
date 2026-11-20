package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** An older whole copy from the home never undoes the phone's town or photos (Server.kt saveSettings, "seen"). */
class SettingsMergeTest {
    private val hobart = JSONObject().put("name", "Hobart").put("lat", -42.88).put("lon", 147.33)

    @Test fun thePhonesTownAndPhotosStay() {
        val home = JSONObject().put("wx_show", false).put("place", JSONObject().put("name", "Old town"))
        val server = JSONObject().put("place", hobart).put("photos", JSONArray().put(JSONObject().put("id", "a").put("file", "phonea.jpg")))
        val out = SettingsMerge.keepServer(home, server)
        assertEquals("Hobart", out.getJSONObject("place").getString("name"))
        assertEquals(1, out.getJSONArray("photos").length())
        assertFalse(out.getBoolean("wx_show"))   // the home's own change still lands
    }

    @Test fun whatThePhoneTookAwayDoesNotComeBack() {
        val home = JSONObject().put("place", hobart).put("photos", JSONArray().put(JSONObject().put("id", "a").put("file", "phonea.jpg")))
        val out = SettingsMerge.keepServer(home, JSONObject().put("lang", "en"))
        assertFalse(out.has("place")); assertFalse(out.has("photos"))
    }

    @Test fun noServerCopyKeepsTheHomes() {
        val home = JSONObject().put("place", hobart)
        assertTrue(SettingsMerge.keepServer(home, null).has("place"))
    }

    // ---- Photos.strays: what dropStrays deletes, and which entries it takes off ----
    @Test fun onlyUnlistedPhonePhotosAreDeleted() {
        val list = JSONArray().put(JSONObject().put("id", "a").put("file", "phonea.jpg")).put(JSONObject().put("id", "u").put("url", "https://example.com/x.jpg"))
        val (delete, missing) = Photos.strays(list, setOf("phonea.jpg", "phoneb.jpg", "upload.tmp", "other.jpg"))
        assertEquals(setOf("phoneb.jpg"), delete)
        assertTrue(missing.isEmpty())
    }

    @Test fun anEntryWhoseFileIsGoneComesOffTheList() {
        val list = JSONArray().put(JSONObject().put("id", "a").put("file", "phonea.jpg")).put(JSONObject().put("id", "b").put("file", "phoneb.jpg"))
        val (delete, missing) = Photos.strays(list, setOf("phonea.jpg"))
        assertTrue(delete.isEmpty())
        assertEquals(setOf("b"), missing)
    }

    @Test fun anEmptyListWithFilesDeletesOnlyPhonePhotos() {
        val (delete, _) = Photos.strays(JSONArray(), setOf("phonea.jpg", "picked.jpg"))
        assertEquals(setOf("phonea.jpg"), delete)
    }

    // ---- PageCode.isTrue: waiting At home changes go only to the loaded home (HomeActivity.sendWaitingAtHome) ----
    @Test fun onlyTheLoadedHomeTakesWaitingChanges() {
        assertTrue(PageCode.isTrue("true"))
        assertFalse(PageCode.isTrue("false"))
        assertFalse(PageCode.isTrue(null))
        assertFalse(PageCode.isTrue("\"true\""))
        assertFalse(PageCode.isTrue("null"))
    }
}
