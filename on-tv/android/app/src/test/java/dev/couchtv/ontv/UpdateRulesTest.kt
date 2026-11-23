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

    @Test fun takesTheRotatedReleaseKeyButNoStranger() {
        val debug = setOf("debug"); val release = setOf("release")
        assertTrue("same key", UpdateRules.signerOk(debug, debug, emptyList()))
        // 0.13.11: v3 signed by the release key, with the proof of rotation from the debug key
        assertTrue("rotated from ours", UpdateRules.signerOk(debug, release, listOf("debug", "release")))
        // after the move, later releases carry the release key (with or without the history)
        assertTrue(UpdateRules.signerOk(release, release, listOf("debug", "release")))
        assertFalse("a stranger's key", UpdateRules.signerOk(debug, setOf("other"), emptyList()))
        assertFalse("a stranger's rotation", UpdateRules.signerOk(debug, setOf("other"), listOf("someone", "other")))
        // never back: an old key file over a rotated install is not an update
        assertFalse(UpdateRules.signerOk(release, debug, emptyList()))
        // no signer read from the file: Android's installer decides
        assertTrue(UpdateRules.signerOk(debug, emptySet(), emptyList()))
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
        assertFalse(UpdateRules.gitHubHost("evilgithubusercontent.com"))
        assertFalse(UpdateRules.gitHubHost("githubusercontent.com"))
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
        // in the background, and the outer shell waits for it to leave adbd's process group (a real TCL)
        assertTrue(s.trim().endsWith("< /dev/null & sleep 2"))
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
        // plain words (WORDING-PROPOSAL-0139 3c): the commands stay behind More help on the TV, not here
        assertTrue(computer.contains("couch-tv-ontv-watch.apk"))
        assertTrue(computer.contains("couchtv.joshuaseage.com/help/home-button"))
        assertFalse(computer.contains("adb "))
        assertTrue(UpdateRules.how(true).startsWith("This is the Home button version of Couch TV."))
        for (s in UpdateRules.steps(false) + UpdateRules.steps(true) + UpdateRules.how(false) + UpdateRules.how(true)) {
            assertFalse("no long dashes: $s", s.contains('–') || s.contains('—'))
            assertFalse("no Beta: $s", s.contains("Beta") || s.contains("coming soon", ignoreCase = true))
        }
    }

    @Test fun watchVersionIsNotSaidToComeFromAComputer() {
        // audit 0.13.9 path 12: Make Home open Couch TV puts the watch version on with one press, no computer,
        // so the update page never says it was put on from a computer; it points at Update to first
        val how = UpdateRules.how(true)
        assertFalse(how.contains("put on from a computer"))
        assertTrue(how.contains("Update to"))
        assertTrue(how.contains("Make Home open Couch TV again after a Downloader update"))
        val w = UpdateRules.steps(watch = true)
        assertTrue(w.first().startsWith("Easiest:"))
        assertTrue(w.first().contains("Phone remote, then Set it up") && w.first().contains("Update to"))
        // Downloader's code gives the plain app (no Home button watch): its row warns and says what to press
        val dl = w.first { it.contains("8180170") }
        assertTrue(dl.contains("Home opens Google TV again") && dl.contains("Make Home open Couch TV"))
        assertTrue(w.size <= 8)
    }

    @Test fun downloaderStepsUseUpAndHashNotBack() {
        // the beginner tests: Back leaves Downloader; Up until the Downloader button lights, Right twice to #
        val phone = UpdateRules.steps(watch = false).joinToString(" ")
        assertFalse(phone.contains("press Back"))
        assertTrue(phone.contains("press Up again and again until the Downloader button at the top left turns light"))
        assertTrue(phone.contains("Right twice, to the # button"))
        // and the way to one button updates next time
        assertTrue(UpdateRules.steps(watch = false).last().contains("Phone remote, then Set it up"))
    }

    // ---------------------------------------------------------------- Matter: one APK, every processor inside

    private val dl = "https://github.com/Seagey/couch-tv/releases/download/v0.14"
    private val lookalikes = listOf("couch-tv-ontv-arm64-v8a.apk", "couch-tv-ontv-armeabi-v7a.apk", "couch-tv-ontv.apk.sha256",
        "couch-tv-ontv-watch-arm64-v8a.apk", "couch-tv-ontv.apk.zip", "couch-tv-home.apk", "SHA256SUMS.txt")

    @Test fun takesExactlyItsOwnFileWhateverElseTheReleaseHas() {
        val shaOf = mapOf("couch-tv-ontv.apk" to "b".repeat(64), "couch-tv-ontv-watch.apk" to "c".repeat(64))
        fun a(n: String) = asset(n, "$dl/$n", "sha256:" + (shaOf[n] ?: "d".repeat(64)), size = if (n in shaOf) 45_792_606L else 1_000L)
        // lookalikes before and after the real file, in both orders
        for (order in listOf(lookalikes + shaOf.keys, shaOf.keys.toList() + lookalikes, lookalikes.reversed() + shaOf.keys.reversed())) {
            val json = full(*order.map(::a).toTypedArray())
            for (watch in listOf(false, true)) {
                val want = UpdateRules.asset(watch)
                val f = UpdateRules.read(json, watch)!!
                assertTrue(f.installable)
                assertEquals("$dl/$want", f.url)
                assertEquals(shaOf[want], f.digest)
                assertEquals(45_792_606L, f.size)
            }
        }
    }

    @Test fun aReleaseWithOnlyPerProcessorFilesOffersNothing() {
        // the TV's Downloader code and the latest/download link cannot pick a processor, so a release
        // without the one file is never offered (scripts/check-release-apks.py stops it being made)
        val json = full(*lookalikes.map { asset(it, "$dl/$it") }.toTypedArray())
        for (watch in listOf(false, true)) {
            val f = UpdateRules.read(json, watch)!!
            assertFalse(f.hasAsset)
            assertFalse(f.installable)
            assertFalse(UpdateRules.offered(f.version, "0.13.9", f.hasAsset))
        }
    }

    @Test fun theFileMustBeTheOneItsNameSays() {
        // GitHub's name says couch-tv-ontv.apk but the address is another file: not installed
        for (url in listOf("$dl/couch-tv-ontv-arm64-v8a.apk", "$dl/couch-tv-ontv-watch.apk", "$dl/xcouch-tv-ontv.apk.zip")) {
            assertFalse(url, UpdateRules.read(full(asset("couch-tv-ontv.apk", url)), watch = false)!!.installable)
        }
        assertFalse(UpdateRules.read(full(asset("couch-tv-ontv-watch.apk", "$dl/couch-tv-ontv.apk")), watch = true)!!.installable)
    }

    @Test fun everyWayInKeepsItsName() {
        // the names and the code every path uses: Update now, Make Home open Couch TV, Downloader, Studio
        assertEquals("couch-tv-ontv.apk", UpdateRules.asset(watch = false))
        assertEquals("couch-tv-ontv-watch.apk", UpdateRules.asset(watch = true))
        assertEquals("8180170", UpdateRules.CODE)
        val phone = UpdateRules.steps(watch = false).joinToString(" ")
        assertTrue(phone.contains("Type 8180170"))
        assertTrue(phone.contains("github.com/Seagey/couch-tv/releases/latest/download/couch-tv-ontv.apk"))
        assertTrue(UpdateRules.steps(watch = true).joinToString(" ").contains("couch-tv-ontv-watch.apk"))
    }

    @Test fun spaceCountsTheLibrariesAndroidUnpacks() {
        // fable NO-GO 21 Nov, 10: the libraries are compressed in the APK, so Android also writes them out
        // on install: 15.7 MB on a 64 bit ARM TV, 8.6 MB on a 32 bit one, on top of 2.5 times the file
        val apk = 45_792_606L   // couch-tv-ontv.apk with Matter, measured
        assertEquals(apk * 5 / 2 + 15_700_000L, UpdateRules.spaceNeeded(apk, "arm64-v8a"))
        assertEquals(apk * 5 / 2 + 8_600_000L, UpdateRules.spaceNeeded(apk, "armeabi-v7a"))
        assertEquals(apk * 5 / 2 + 2_600_000L, UpdateRules.spaceNeeded(apk, "x86_64"))
        assertEquals(apk * 5 / 2 + 2_400_000L, UpdateRules.spaceNeeded(apk, "x86"))
        // a processor we do not know, or none reported: the largest, never too little
        assertEquals(apk * 5 / 2 + 15_700_000L, UpdateRules.spaceNeeded(apk, null))
        assertEquals(apk * 5 / 2 + 15_700_000L, UpdateRules.spaceNeeded(apk, "riscv64"))
        // what the old rule let through now says "space": 120 MB free on a 64 bit TV is 4.2 MB short
        val free = 120_000_000L
        assertTrue(free >= apk * 5 / 2)
        assertTrue(free < UpdateRules.spaceNeeded(apk, "arm64-v8a"))
        // each figure covers what was measured in the real APK (lib/<abi> uncompressed, bytes)
        val measured = mapOf("arm64-v8a" to 15_646_680L, "armeabi-v7a" to 8_586_668L, "x86_64" to 2_536_560L, "x86" to 2_309_184L)
        for ((abi, bytes) in measured) assertTrue(abi, UpdateRules.unpacked(abi) >= bytes)
    }
}
