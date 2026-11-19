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

    private val sha = "a".repeat(64)
    private fun asset(name: String, url: String, digest: String = "sha256:$sha", size: Long = 44_412_953) =
        """{"name":"$name","browser_download_url":"$url","digest":"$digest","size":$size}"""
    private fun full(vararg assets: String) = """{"tag_name":"v0.13.9","name":"couch-tv 0.13.9","prerelease":false,"draft":false,"assets":[${assets.joinToString(",")}]}"""

    @Test fun installsOnlyAFileFromThisReleaseWithItsChecks() {
        val good = "https://github.com/Seagey/couch-tv/releases/download/v0.13.9/couch-tv-ontv.apk"
        val f = UpdateRules.read(full(asset("couch-tv-ontv.apk", good)), watch = false)!!
        assertEquals(good, f.url)
        assertEquals(sha, f.digest)
        assertEquals(44_412_953L, f.size)
        assertTrue(f.installable)
        // the watch copy takes its own file only
        val w = UpdateRules.read(full(asset("couch-tv-ontv.apk", good), asset("couch-tv-ontv-watch.apk", good.replace("ontv.apk", "ontv-watch.apk"))), watch = true)!!
        assertTrue(w.url.endsWith("couch-tv-ontv-watch.apk"))
        // anywhere else, no SHA-256, or no size: nothing to install (the steps instead)
        for (bad in listOf(
            asset("couch-tv-ontv.apk", "https://example.com/couch-tv-ontv.apk"),
            asset("couch-tv-ontv.apk", "http://github.com/Seagey/couch-tv/releases/download/v0.13.9/couch-tv-ontv.apk"),
            asset("couch-tv-ontv.apk", "https://github.com/someone/couch-tv/releases/download/v0.13.9/couch-tv-ontv.apk"),
            asset("couch-tv-ontv.apk", "https://github.com/Seagey/couch-tv/releases/download/../../x/couch-tv-ontv.apk"),
            asset("couch-tv-ontv.apk", good, digest = ""),
            asset("couch-tv-ontv.apk", good, digest = "sha256:1234"),
            asset("couch-tv-ontv.apk", good, size = 0))) {
            assertFalse(bad, UpdateRules.read(full(bad), watch = false)!!.installable)
        }
    }

    @Test fun downloadsOnlyFromGitHub() {
        assertTrue(UpdateRules.gitHubHost("github.com"))
        assertTrue(UpdateRules.gitHubHost("objects.githubusercontent.com"))
        assertTrue(UpdateRules.gitHubHost("release-assets.githubusercontent.com"))
        assertFalse(UpdateRules.gitHubHost("github.com.evil.example"))
        assertFalse(UpdateRules.gitHubHost("githubusercontent.com.example"))
    }

    @Test fun readsWhatTheInstallSaid() {
        assertNull(UpdateRules.installResult(""))
        assertNull(UpdateRules.installResult("Performing Streamed Install\n"))
        assertEquals("", UpdateRules.installResult("Performing Streamed Install\nSuccess\n"))
        assertEquals("space", UpdateRules.installResult("Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE: Failed to override installation location]"))
        assertEquals("other_key", UpdateRules.installResult("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package dev.couchtv.ontv signatures do not match]"))
        assertEquals("not_newer", UpdateRules.installResult("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"))
        assertEquals("failed", UpdateRules.installResult("Failure [INSTALL_FAILED_INVALID_APK]"))
        assertEquals("failed", UpdateRules.installResult("Error: Unable to open file"))
        assertEquals("space", UpdateRules.failure("push failed: couldn't write: No space left on device"))
    }

    @Test fun theInstallRunsApartFromTheAppAndOpensItAgain() {
        val s = UpdateRules.installScript("dev.couchtv.ontv", reopen = true)
        assertTrue(s.contains("pm install -r /data/local/tmp/couch-tv-update.apk > /data/local/tmp/couch-tv-update.txt"))
        assertTrue(s.contains("nohup sh -c"))
        assertTrue(s.contains("setsid"))
        assertTrue(s.contains("rm -f /data/local/tmp/couch-tv-update.apk"))
        assertTrue(s.contains("grep -q Success /data/local/tmp/couch-tv-update.txt && am start -n dev.couchtv.ontv/.SetupActivity --ez updated true"))
        assertTrue(s.trim().endsWith("&"))
        // started from a phone while a show is on: it installs, and leaves the show on screen
        assertFalse(UpdateRules.installScript("dev.couchtv.ontv", reopen = false).contains("am start"))
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
