package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Make Home open Couch TV (HomeKeyRules.kt): the Home button watch with one press instead of a computer. */
class HomeKeyRulesTest {
    private val pkg = "dev.couchtv.ontv"
    private val me = "dev.couchtv.ontv/dev.couchtv.ontv.WatchService"

    @Test fun addsTheWatchWithoutClobberingOthers() {
        assertEquals(me, HomeKeyRules.withWatch(null, pkg))
        assertEquals(me, HomeKeyRules.withWatch("", pkg))
        assertEquals("com.a/.Talk:$me", HomeKeyRules.withWatch("com.a/.Talk", pkg))
        assertEquals("com.a/.Talk:com.b/com.b.S:$me", HomeKeyRules.withWatch("com.a/.Talk:com.b/com.b.S", pkg))
        // already there (either way Android writes it): unchanged, never twice
        assertEquals("com.a/.Talk:$me", HomeKeyRules.withWatch("com.a/.Talk:$me", pkg))
        assertEquals("$pkg/.WatchService:com.a/.Talk", HomeKeyRules.withWatch("$pkg/.WatchService:com.a/.Talk", pkg))
        // stray separators go, nothing else does
        assertEquals("com.a/.Talk:$me", HomeKeyRules.withWatch(":com.a/.Talk::", pkg))
    }

    @Test fun theRebindTakesOnlyTheWatchOut() {
        assertEquals("com.a/.Talk", HomeKeyRules.withoutWatch("com.a/.Talk:$me", pkg))
        assertEquals("com.a/.Talk", HomeKeyRules.withoutWatch("$pkg/.WatchService:com.a/.Talk", pkg))
        assertEquals("", HomeKeyRules.withoutWatch(me, pkg))
        assertEquals("com.a/.Talk:com.b/.X", HomeKeyRules.withoutWatch("com.a/.Talk:com.b/.X", pkg))
        // the launcher's own watch (a TV set up with apply.sh too) is someone else's: it stays
        assertEquals("app.couchtv.launcher/.FireWatch", HomeKeyRules.withoutWatch("app.couchtv.launcher/.FireWatch:$me", pkg))
        assertTrue(HomeKeyRules.listed("x/.Y:$me", pkg))
        assertFalse(HomeKeyRules.listed("app.couchtv.launcher/.FireWatch", pkg))
    }

    @Test fun onlyComponentNamesGoIntoAShellLine() {
        assertTrue(HomeKeyRules.shellSafe("com.a/.Talk:$me"))
        assertTrue(HomeKeyRules.shellSafe("com.a/com.a.Outer\$Inner"))
        assertTrue(HomeKeyRules.shellSafe(""))
        assertFalse(HomeKeyRules.shellSafe("com.a/.Talk'; reboot; '"))
        assertFalse(HomeKeyRules.shellSafe("com.a/.T alk"))
        assertFalse(HomeKeyRules.shellSafe("com.a/.T\"x"))
    }

    @Test fun tclOnlyByMakerOrBrand() {
        assertTrue(HomeKeyRules.isTcl("TCL", "TCL"))
        assertTrue(HomeKeyRules.isTcl("tcl", null))
        assertTrue(HomeKeyRules.isTcl("Sony", "TCL"))
        assertFalse(HomeKeyRules.isTcl("Sony", "Sony"))
        assertFalse(HomeKeyRules.isTcl("Google", "google"))
        assertFalse(HomeKeyRules.isTcl(null, null))
        assertFalse(HomeKeyRules.isTcl("TCLX", "Hisense"))
    }

    @Test fun switchOnLinesAppendAndReassertTheHome() {
        val l = HomeKeyRules.switchOnLines(pkg, "com.a/.Talk:$me", tcl = true, homeOn = true)
        assertEquals("appops set $pkg AUTO_START allow", l[0])
        assertEquals("settings put secure enabled_accessibility_services 'com.a/.Talk:$me'", l[1])
        assertEquals("settings put secure accessibility_enabled 1", l[2])
        assertEquals("cmd package set-home-activity $pkg/.HomeAlias", l[3])
        // not a TCL: no app op; home off: the home is not touched; an unsafe list is never written
        val plain = HomeKeyRules.switchOnLines(pkg, "bad 'x", tcl = false, homeOn = false)
        assertEquals(listOf("settings put secure accessibility_enabled 1"), plain)
        assertFalse(HomeKeyRules.switchOnLines(pkg, null, false, true).any { it.contains("enabled_accessibility_services") })
    }

    @Test fun theInstallLineInstallsFirstAndSwitchesOnOnlyAfterSuccess() {
        val s = HomeKeyRules.installScript(pkg, "com.a/.Talk:$me", tcl = true, homeOn = true, reopen = true)
        assertTrue(s.startsWith("rm -f ${HomeKeyRules.TMP_LOG}; "))
        assertTrue(s.contains("setsid) nohup sh -c \""))
        assertTrue(s.endsWith("& sleep 2"))
        val install = s.indexOf("pm install -r ${HomeKeyRules.TMP_APK} > ${HomeKeyRules.TMP_LOG}")
        val gate = s.indexOf("grep -qx Success ${HomeKeyRules.TMP_LOG} && {")
        assertTrue(install > 0 && gate > install)
        // everything that switches the watch on is behind the Success check, in this order
        val order = listOf("appops set $pkg AUTO_START allow", "enabled_accessibility_services 'com.a/.Talk:$me'",
            "accessibility_enabled 1", "set-home-activity $pkg/.HomeAlias", "am start -n $pkg/.SetupActivity")
        var at = gate
        for (o in order) { val i = s.indexOf(o); assertTrue("$o after the check", i > at); at = i }
        // the copy goes either way
        assertTrue(s.indexOf("rm -f ${HomeKeyRules.TMP_APK}") in install until gate)
        // not on screen: nothing opens over a show
        assertFalse(HomeKeyRules.installScript(pkg, me, false, true, reopen = false).contains("am start"))
        // its own files, never Update's
        assertFalse(s.contains(UpdateRules.TMP_APK) || s.contains(UpdateRules.TMP_LOG))
    }

    /**
     * Fable review of 265f08b: the line runs inside double quotes in an outer sh, which expanded a $ in
     * another service's name (com.a/com.a.Outer$Inner arrived as com.a/com.a.Outer, switching it off). Run the
     * real line through /bin/sh with stand-in commands and check what each one received.
     */
    @Test fun theShellLineHandsEveryNameOverWhole() {
        val dir = java.nio.file.Files.createTempDirectory("hkcheck").toFile()
        try {
            val bin = java.io.File(dir, "bin").apply { mkdirs() }
            val tmp = java.io.File(dir, "tmp").apply { mkdirs() }
            val out = java.io.File(dir, "out.txt")
            for (c in listOf("appops", "settings", "cmd", "am")) java.io.File(bin, c).apply {
                writeText("#!/bin/sh\nprintf '%s\\n' \"$c \$*\" >> \"\$HKOUT\"\n"); setExecutable(true) }
            java.io.File(bin, "pm").apply { writeText("#!/bin/sh\necho Success\n"); setExecutable(true) }
            java.io.File(tmp, "couch-tv-homekey.apk").writeText("x")
            val other = "com.a/com.a.Outer\$Inner"
            val services = HomeKeyRules.withWatch(other, pkg)
            val line = HomeKeyRules.installScript(pkg, services, tcl = true, homeOn = true, reopen = true)
                .replace("/data/local/tmp", tmp.path)
            val pb = ProcessBuilder("/bin/sh", "-c", line).directory(dir)
            pb.environment()["PATH"] = bin.path + ":" + System.getenv("PATH")
            pb.environment()["HKOUT"] = out.path
            pb.redirectErrorStream(true)
            assertEquals(0, pb.start().waitFor())
            val until = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < until && !(out.isFile && out.readText().contains("am start"))) Thread.sleep(100)
            val got = out.readText().trim().lines()
            assertEquals(listOf(
                "appops set $pkg AUTO_START allow",
                "settings put secure enabled_accessibility_services $other:$me",
                "settings put secure accessibility_enabled 1",
                "cmd package set-home-activity $pkg/.HomeAlias",
                "am start -n $pkg/.SetupActivity"), got)
            // the copy went, and the log holds what pm said
            assertFalse(java.io.File(tmp, "couch-tv-homekey.apk").exists())
            assertEquals("Success", java.io.File(tmp, "couch-tv-homekey.txt").readText().trim())
        } finally { dir.deleteRecursively() }
    }

    @Test fun aFailedInstallSwitchesNothingOn() {
        val dir = java.nio.file.Files.createTempDirectory("hkcheck").toFile()
        try {
            val bin = java.io.File(dir, "bin").apply { mkdirs() }
            val tmp = java.io.File(dir, "tmp").apply { mkdirs() }
            val out = java.io.File(dir, "out.txt")
            for (c in listOf("appops", "settings", "cmd", "am")) java.io.File(bin, c).apply {
                writeText("#!/bin/sh\nprintf '%s\\n' \"$c \$*\" >> \"\$HKOUT\"\n"); setExecutable(true) }
            // a line that only mentions Success is not a Success (grep -x)
            java.io.File(bin, "pm").apply { writeText("#!/bin/sh\necho 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: not Success]'\n"); setExecutable(true) }
            val line = HomeKeyRules.installScript(pkg, me, tcl = false, homeOn = true, reopen = true).replace("/data/local/tmp", tmp.path)
            val pb = ProcessBuilder("/bin/sh", "-c", line).directory(dir)
            pb.environment()["PATH"] = bin.path + ":" + System.getenv("PATH")
            pb.environment()["HKOUT"] = out.path
            assertEquals(0, pb.start().waitFor())
            val log = java.io.File(tmp, "couch-tv-homekey.txt")
            val until = System.currentTimeMillis() + 10_000
            while (System.currentTimeMillis() < until && !(log.isFile && log.readText().isNotEmpty())) Thread.sleep(100)
            Thread.sleep(500)
            assertFalse(out.exists())
            assertEquals("other_key", UpdateRules.installResult(log.readText()))
        } finally { dir.deleteRecursively() }
    }

    @Test fun fireOs6WatchesWithUsageAccess() {
        assertTrue(HomeKeyRules.watching(connected = true, fireTv = false, sdk = 34, usageAllowed = false))
        assertTrue(HomeKeyRules.watching(connected = false, fireTv = true, sdk = 25, usageAllowed = true))
        assertFalse(HomeKeyRules.watching(connected = false, fireTv = true, sdk = 25, usageAllowed = false))
        assertFalse(HomeKeyRules.watching(connected = false, fireTv = true, sdk = 28, usageAllowed = true))
        assertFalse(HomeKeyRules.watching(connected = false, fireTv = false, sdk = 25, usageAllowed = true))
    }

    @Test fun menuNamesAndFireTv() {
        assertTrue(HomeKeyRules.steps(false)[2].contains("Accessibility (on some TVs inside System or Device Preferences), Couch TV home watch, On"))
        assertTrue(HomeKeyRules.steps(true)[2].contains("help page"))
        assertFalse(HomeKeyRules.steps(true)[2].contains("Accessibility"))
        assertTrue(HomeKeyRules.errorWords("not_bound").contains("(on some TVs inside System or Device Preferences)"))
        assertTrue(HomeKeyRules.errorWords("not_bound", fireTv = true).contains("couchtv.joshuaseage.com/help/home-button"))
        assertFalse(HomeKeyRules.errorWords("not_bound", fireTv = true).contains("Accessibility"))
        // the phone page: its own section and the steps under it, no More button and no code to scan
        listOf(HomeKeyRules.STEPS_PHONE, HomeKeyRules.STEPS_FIRE_PHONE).forEach {
            assertTrue(it, it.contains("the steps below")); assertFalse(it, it.contains("More")); assertFalse(it, it.contains("scan"))
        }
        assertTrue(HomeKeyRules.STEPS_PHONE.contains("Let the phone press keys on this page"))
        assertTrue(HomeKeyRules.errorWords("update_busy").contains("busy with an update"))
        // never a promise the code cannot check: the watch is on, Home should bring Couch TV back
        assertTrue(HomeKeyRules.DONE.contains("should") && HomeKeyRules.DONE.contains("check"))
    }

    @Test(expected = IllegalArgumentException::class) fun refusesAStrangePackageName() {
        HomeKeyRules.installScript("dev.couchtv.ontv; reboot", null, false, false, false)
    }

    @Test fun theSameVersionMayGoOnButNeverAnOlderOne() {
        assertTrue(HomeKeyRules.versionOk(22, 22))
        assertTrue(HomeKeyRules.versionOk(23, 22))
        assertFalse(HomeKeyRules.versionOk(21, 22))
    }

    @Test fun whatTheScreensShow() {
        // Google TV with the phone version and the link: one press
        assertEquals("ready", HomeKeyRules.view(needed = true, watchApk = false, bound = false, homeOn = false, busy = false, link = true, canWriteSecure = false))
        // no link: the computer steps and the QR code
        assertEquals("steps", HomeKeyRules.view(true, false, false, false, false, link = false, canWriteSecure = true))
        // the watch APK with the grant needs no link to switch its watch on
        assertEquals("ready", HomeKeyRules.view(true, true, false, true, false, link = false, canWriteSecure = true))
        assertEquals("steps", HomeKeyRules.view(true, true, false, true, false, link = false, canWriteSecure = false))
        // the watch APK, connected, home on: done; home off: one press switches it on again
        assertEquals("done", HomeKeyRules.view(true, true, bound = true, homeOn = true, busy = false, link = false, canWriteSecure = false))
        assertEquals("ready", HomeKeyRules.view(true, true, bound = true, homeOn = false, busy = false, link = true, canWriteSecure = false))
        // working: busy, whatever else
        assertEquals("busy", HomeKeyRules.view(true, false, false, false, busy = true, link = true, canWriteSecure = false))
        // a plain Android TV with the phone version: the Home button is Android's to give, nothing here
        assertEquals("hidden", HomeKeyRules.view(needed = false, watchApk = false, bound = false, homeOn = true, busy = false, link = true, canWriteSecure = true))
        assertTrue(HomeKeyRules.needed(googleHome = true, fireTv = false))
        assertTrue(HomeKeyRules.needed(googleHome = false, fireTv = true))
        assertFalse(HomeKeyRules.needed(googleHome = false, fireTv = false))
    }

    @Test fun plainWords() {
        val all = listOf(HomeKeyRules.BUTTON, HomeKeyRules.READY, HomeKeyRules.READY_WATCH, HomeKeyRules.DONE, HomeKeyRules.STEPS, HomeKeyRules.STEPS_FIRE) +
            listOf("checking", "downloading", "installing", "switching").map { HomeKeyRules.busyWords(it, 40) } +
            listOf("net", "bad", "other_key", "not_newer", "space", "adb", "not_bound", "update_busy", "failed").map { HomeKeyRules.errorWords(it) } +
            listOf(HomeKeyRules.STEPS_PHONE, HomeKeyRules.STEPS_FIRE_PHONE, HomeKeyRules.errorWords("not_bound", true))
        val bad = Regex("[–—]|\\bBeta\\b|experimental|coming soon|\\bADB\\b|accessibility service|couch-tv(?![-./])", RegexOption.IGNORE_CASE)
        all.forEach { assertTrue(it, it.isNotEmpty()); assertFalse(it, bad.containsMatchIn(it)) }
        assertEquals("", HomeKeyRules.errorWords(""))
        assertEquals("Downloading… 40%", HomeKeyRules.busyWords("downloading", 40))
        assertTrue(HomeKeyRules.READY.contains("Your settings stay"))
        assertTrue(HomeKeyRules.HELP_URL.startsWith("https://couchtv.joshuaseage.com/help/"))
        // every error says what to do next or that nothing changed
        listOf("net", "bad", "other_key", "not_newer", "space", "adb", "not_bound", "update_busy", "failed").forEach {
            val w = HomeKeyRules.errorWords(it)
            assertTrue(w, w.contains("try again", true) || w.contains("nothing", true) || w.contains("computer steps") || w.contains("switch it on") || w.contains("press again", true))
        }
    }

    @Test fun theSetupScreenNamesTheOnePress() {
        assertTrue(SetupWords.homeNote(true, false, true, watchApk = false).contains("press Make Home open Couch TV"))
        assertTrue(SetupWords.homeNote(true, true, false, watchApk = false, googleHome = true).contains("press Make Home open Couch TV"))
    }
}
