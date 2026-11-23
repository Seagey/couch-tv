package dev.couchtv.ontv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * UpdateRules.signerOk with the real certificates of the 0.13.10 release APK, a 0.13.11-test APK signed by
 * scripts/sign-ontv.sh (the rotation test before 0.13.11), and an APK signed by a throwaway stranger key.
 * The fixtures (src/test/resources/rotation) were dumped with apksig: new = the v3 signer (what
 * signingInfo.apkContentsSigners gives on Android 9+), hist = the v3 lineage (signingCertificateHistory),
 * old = the v1/v2 signer (GET_SIGNATURES, Android 6 to 8). Public certificates only, each one DER in base64 (a
 * PEM body), turned back here into the hex Signature.toCharsString() gives. Not stored as hex: long digit runs in
 * hex look like phone numbers to scripts/privacy-scan.sh.
 */
class UpdateRotationRealKeysTest {
    private class Apk(val new: String, val hist: List<String>, val old: String)

    private fun load(name: String): Apk {
        val m = javaClass.classLoader!!.getResource("rotation/$name.txt")!!.readText().lines()
            .filter { it.contains('=') }.associate { it.substringBefore('=') to it.substringAfter('=') }
        return Apk(hex(m.getValue("new")), m.getValue("hist").split(',').map(::hex), hex(m.getValue("old")))
    }

    private fun hex(b64: String) = java.util.Base64.getDecoder().decode(b64).joinToString("") { "%02x".format(it) }

    private val v10 = load("0.13.10")
    private val v11 = load("0.13.11-test")
    private val stranger = load("stranger")

    @Test fun theFixturesAreWhatWeThinkTheyAre() {
        assertTrue("0.13.10 has one key", v10.new == v10.old)
        assertTrue("0.13.11 v1/v2 = 0.13.10's key", v11.old == v10.old)
        assertFalse("0.13.11 v3 is a new key", v11.new == v10.new)
        assertTrue("lineage: old key then the release key", v11.hist == listOf(v10.new, v11.new))
    }

    @Test fun android9AndNewerTakeTheRotatedUpdate() {
        // installed 0.13.10 (apkContentsSigners), the file's v3 signer and its history
        assertTrue(UpdateRules.signerOk(setOf(v10.new), setOf(v11.new), v11.hist))
    }

    @Test fun android6To8TakeItThroughTheOldKey() {
        // before Android 9 Update.kt reads GET_SIGNATURES (the v1/v2 signer) and passes no history
        assertTrue(UpdateRules.signerOk(setOf(v10.old), setOf(v11.old), emptyList()))
    }

    @Test fun afterTheMoveTheNextRotatedReleaseIsTakenAndTheOldOneIsNot() {
        assertTrue(UpdateRules.signerOk(setOf(v11.new), setOf(v11.new), v11.hist))
        assertFalse(UpdateRules.signerOk(setOf(v11.new), setOf(v10.new), v10.hist))
    }

    @Test fun aStrangerIsRefusedEverywhere() {
        assertFalse(UpdateRules.signerOk(setOf(v10.new), setOf(stranger.new), stranger.hist))
        assertFalse(UpdateRules.signerOk(setOf(v10.old), setOf(stranger.old), emptyList()))
        assertFalse(UpdateRules.signerOk(setOf(v11.new), setOf(stranger.new), stranger.hist))
    }
}
