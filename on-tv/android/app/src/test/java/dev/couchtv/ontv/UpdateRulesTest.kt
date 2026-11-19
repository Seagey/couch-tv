package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Update couch-tv on the on-TV app (UpdateRules.kt): a 0.13.3 owner on a TCL was never told about 0.13.5. */
class UpdateRulesTest {
    private fun release(tag: String, vararg assets: String, pre: Boolean = false, draft: Boolean = false) =
        """{"tag_name":"$tag","name":"couch-tv $tag","prerelease":$pre,"draft":$draft,"assets":[${assets.joinToString(",") { "{\"name\":\"$it\"}" }}]}"""

    @Test fun versionsCompareTheWayPeopleReadThem() {
        assertTrue(UpdateRules.newer("0.13.6", "0.13.5"))
        assertTrue(UpdateRules.newer("v0.14", "0.13.6"))
        assertTrue(UpdateRules.newer("0.10", "0.9"))
        assertTrue(UpdateRules.newer("0.13", "0.13-beta.1"))
        assertFalse(UpdateRules.newer("0.13.5", "0.13.5"))
        assertFalse(UpdateRules.newer("0.13.4", "0.13.5"))
    }

    @Test fun readsTheLatestReleaseForThisApp() {
        val f = UpdateRules.read(release("v0.13.6", "couch-tv-home.apk", "couch-tv-ontv.apk", "couch-tv-ontv-watch.apk"), watch = false)
        assertNotNull(f)
        assertEquals("0.13.6", f!!.version)
        assertTrue(f.hasAsset)
        assertTrue(UpdateRules.offered(f.version, "0.13.5", f.hasAsset))
        assertFalse(UpdateRules.offered(f.version, "0.13.6", f.hasAsset))
        // a release with only the home APK is nothing for the on-TV app
        val home = UpdateRules.read(release("v0.13.7", "couch-tv-home.apk"), watch = false)!!
        assertFalse(UpdateRules.offered(home.version, "0.13.6", home.hasAsset))
        // the watch copy looks for its own file
        assertTrue(UpdateRules.read(release("v0.13.6", "couch-tv-ontv-watch.apk"), watch = true)!!.hasAsset)
        assertFalse(UpdateRules.read(release("v0.13.6", "couch-tv-ontv.apk"), watch = true)!!.hasAsset)
    }

    @Test fun neverATestBuild() {
        assertNull(UpdateRules.read(release("v0.14-beta.1", "couch-tv-ontv.apk"), watch = false))
        assertNull(UpdateRules.read(release("v0.14", "couch-tv-ontv.apk", pre = true), watch = false))
        assertNull(UpdateRules.read(release("v0.14", "couch-tv-ontv.apk", draft = true), watch = false))
        assertNull(UpdateRules.read("""{"tag_name":""}""", watch = false))
    }

    @Test fun stepsSayExactlyWhatToDo() {
        val phone = UpdateRules.steps(watch = false).joinToString(" ")
        assertTrue(phone.contains("Downloader"))
        assertTrue(phone.contains("8180170"))
        assertTrue(phone.contains("github.com/Seagey/couch-tv/releases/latest/download/couch-tv-ontv.apk"))
        assertTrue(UpdateRules.how(false).contains("cannot install an update by itself"))
        assertTrue(phone.contains("If it says App not installed, the TV is usually short of space"))   // a real TCL, 20 Nov 2026
        assertTrue(UpdateRules.steps(watch = false).size <= 8)   // the page shows 8 steps at most
        val computer = UpdateRules.steps(watch = true).joinToString(" ")
        assertTrue(computer.contains("adb install -r couch-tv-ontv-watch.apk"))
        assertFalse(computer.contains("8180170"))   // the code gives the phone only APK, which has no watch
        for (s in UpdateRules.steps(false) + UpdateRules.steps(true) + UpdateRules.how(false) + UpdateRules.how(true)) {
            assertFalse("no long dashes: $s", s.contains('–') || s.contains('—'))
            assertFalse("no Beta: $s", s.contains("Beta") || s.contains("coming soon", ignoreCase = true))
        }
    }
}
