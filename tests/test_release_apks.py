"""scripts/check-release-apks.py: one APK per app with every processor inside, the same names as always.

Fake dist folders (zip files laid out like APKs) prove each rule fails when broken and passes when kept.
With COUCHTV_RELEASE_DIST set to a folder of real built APKs, the whole check (aapt2, apksigner) runs
on them too.

Run: python3 tests/test_release_apks.py"""
import hashlib
import importlib.util
import io
import os
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("check_release_apks", ROOT / "scripts/check-release-apks.py")
crc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crc)

CONSCRYPT = {abi: ["libconscrypt_jni.so", "libspake2.so"] for abi in ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"]}
MATTER = {abi: ["libCHIPController.so", "libc++_shared.so"] for abi in ["armeabi-v7a", "arm64-v8a"]}


INTEL = {abi: ["libcouchtv_placeholder.so"] for abi in ["x86", "x86_64"]}
WATCH_MARK = "assets/fake-watch-service"   # stands for the watch APK's accessibility service in these fakes
# placeholders are tiny (1 KB, like nl-matter-android's libmatternone.so); every other fake library is
# 20 KB, over the check's 16 KB placeholder limit, like any real library
TINY = {"libcouchtv_placeholder.so", "libmatternone.so", "libtiny.so"}


def apk(path, libs, stored=False, watch=False):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("classes.dex", b"dex")
        if watch:
            z.writestr(WATCH_MARK, b"1")
        for abi, names in libs.items():
            for n in names:
                z.writestr(zipfile.ZipInfo(f"lib/{abi}/{n}"), b"\0" * (1000 if n in TINY else 20_000),
                           compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)


def merge(*maps):
    out = {}
    for m in maps:
        for abi, names in m.items():
            out.setdefault(abi, []).extend(names)
    return out


class Dist:
    def __init__(self, ontv_libs=None, stored=False, extra=(), sums=True, home_libs=None, samsung=False):
        self.t = tempfile.TemporaryDirectory()
        self.d = Path(self.t.name)
        apk(self.d / "couch-tv-home.apk", home_libs or {})
        for n in crc.ONTV:
            apk(self.d / n, ontv_libs if ontv_libs is not None else merge(CONSCRYPT, MATTER), stored,
                watch=n == "couch-tv-ontv-watch.apk")
        for n in extra:
            apk(self.d / n, MATTER)
        if samsung:
            (self.d / "couch-tv-samsung.wgt").write_bytes(b"wgt" * 100)
            (self.d / "couch-tv-samsung-setup.zip").write_bytes(b"zip" * 100)
        if sums:
            self.sums()

    def sums(self):
        files = sorted(self.d.glob("*.apk")) + sorted(self.d.glob("couch-tv-samsung*"))
        lines = [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}" for p in files]
        (self.d / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")

    def errs(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = crc.main([str(self.d), "--skip-signer", *args])
        crc_errs = [l[4:] for l in buf.getvalue().splitlines() if l.startswith("  - ")]
        return rc, crc_errs


class ReleaseApkRules(unittest.TestCase):
    def setUp(self):
        # aapt2 is for real APKs only; the fake ones have no manifest. The plain/watch rule still runs:
        # a fake counts one accessibility service when it carries WATCH_MARK.
        self._same, self._acc, self._tool = crc.check_same_app, crc.accessibility_services, crc.tool
        crc.check_same_app = lambda dist: []
        crc.tool = lambda name: "/fake/aapt2" if name == "aapt2" else self._tool(name)

        def acc(p):
            with zipfile.ZipFile(p) as z:
                return int(WATCH_MARK in z.namelist())
        crc.accessibility_services = acc

    def tearDown(self):
        crc.check_same_app, crc.accessibility_services, crc.tool = self._same, self._acc, self._tool

    def test_a_universal_compressed_release_passes(self):
        rc, errs = Dist().errs("--release", "--matter")
        self.assertEqual((rc, errs), (0, []))

    def test_today_without_matter_still_passes(self):
        rc, errs = Dist(ontv_libs=CONSCRYPT).errs("--release")
        self.assertEqual((rc, errs), (0, []))
        rc, errs = Dist(ontv_libs=CONSCRYPT).errs("--release", "--matter")
        self.assertEqual(rc, 1)
        self.assertEqual(len(errs), 2, errs)   # both on-TV APKs

    def test_per_processor_files_are_refused(self):
        rc, errs = Dist(extra=["couch-tv-ontv-arm64-v8a.apk", "couch-tv-ontv-armeabi-v7a.apk"]).errs()
        self.assertEqual(rc, 1)
        self.assertEqual(sum("not a release name" in e for e in errs), 2, errs)

    def test_a_missing_name_fails(self):
        d = Dist()
        (d.d / "couch-tv-ontv-watch.apk").unlink()
        rc, errs = d.errs()
        self.assertEqual(rc, 1)
        self.assertTrue(any("couch-tv-ontv-watch.apk is missing" in e for e in errs), errs)

    def test_matter_for_one_processor_only_fails(self):
        only32 = merge(CONSCRYPT, {"armeabi-v7a": MATTER["armeabi-v7a"]})
        rc, errs = Dist(ontv_libs=only32).errs()
        self.assertEqual(rc, 1)
        # arm64 would start without the controller: caught as a mismatch and as missing Matter
        self.assertTrue(any("lib/arm64-v8a lacks" in e and "libCHIPController.so" in e for e in errs), errs)
        self.assertTrue(any("lib/arm64-v8a/libCHIPController.so is missing" in e for e in errs), errs)

    def test_intel_folders_may_lack_matter_but_nothing_else(self):
        # Conscrypt has x86 too: an Intel TV gets no Matter (the app says so) but must keep Conscrypt
        rc, errs = Dist().errs()
        self.assertEqual((rc, errs), (0, []))
        no_conscrypt = merge({k: v for k, v in CONSCRYPT.items() if k != "x86"}, MATTER, {"x86": ["libspake2.so"]})
        rc, errs = Dist(ontv_libs=no_conscrypt).errs()
        self.assertEqual(rc, 1)
        self.assertTrue(any("lib/x86 lacks libconscrypt_jni.so" in e for e in errs), errs)

    def test_stored_libraries_fail(self):
        rc, errs = Dist(stored=True).errs()
        self.assertEqual(rc, 1)
        self.assertTrue(any("stored, not compressed" in e for e in errs), errs)

    def test_checksums(self):
        rc, errs = Dist(sums=False).errs("--release")
        self.assertEqual(rc, 1)
        self.assertTrue(any("SHA256SUMS.txt is missing" in e for e in errs), errs)
        self.assertEqual(Dist(sums=False).errs()[0], 0)   # not a release yet: fine without
        d = Dist()
        apk(d.d / "couch-tv-ontv.apk", merge(CONSCRYPT, MATTER, {"x86": ["libextra.so"]}))
        rc, errs = d.errs("--release")
        self.assertTrue(any("another SHA-256 for couch-tv-ontv.apk" in e for e in errs), errs)

    def test_size_limit(self):
        d = Dist()
        with zipfile.ZipFile(d.d / "couch-tv-ontv.apk", "a") as z:
            z.writestr(zipfile.ZipInfo("assets/big.bin"), os.urandom(61 * crc.MB), compress_type=zipfile.ZIP_STORED)
        rc, errs = d.errs()
        self.assertEqual(rc, 1)
        self.assertTrue(any("over its 60 MB limit" in e for e in errs), errs)


    # fable NO-GO 21 Nov, 1: Android refuses an APK with native libraries but no folder for the TV's processor
    def test_launcher_with_matter_for_arm_only_fails(self):
        rc, errs = Dist(home_libs=MATTER).errs("--release", "--matter")
        self.assertEqual(rc, 1)
        self.assertEqual(sorted(e for e in errs if "no lib/" in e), [
            "couch-tv-home.apk: native libraries inside but no lib/x86 folder: Android refuses to install it on a TV with that processor",
            "couch-tv-home.apk: native libraries inside but no lib/x86_64 folder: Android refuses to install it on a TV with that processor",
        ])
        self.assertEqual(len(errs), 2, errs)

    def test_launcher_with_matter_and_intel_placeholders_passes(self):
        rc, errs = Dist(home_libs=merge(MATTER, INTEL)).errs("--release", "--matter")
        self.assertEqual((rc, errs), (0, []))
        # a placeholder in only one Intel folder: the other has no folder at all
        rc, errs = Dist(home_libs=merge(MATTER, {"x86": INTEL["x86"]})).errs()
        self.assertEqual(rc, 1)
        self.assertEqual(errs, ["couch-tv-home.apk: native libraries inside but no lib/x86_64 folder: Android refuses to install it on a TV with that processor"])
        # a real library (not a placeholder) only in the Intel folders: the ARM folders miss it
        rc, errs = Dist(home_libs=merge(MATTER, {a: ["libreal.so"] for a in ["x86", "x86_64"]})).errs()
        self.assertEqual(rc, 1)
        self.assertEqual(sorted(errs), ["couch-tv-home.apk: lib/arm64-v8a lacks libreal.so (a TV of that kind would miss it)",
                                        "couch-tv-home.apk: lib/armeabi-v7a lacks libreal.so (a TV of that kind would miss it)"])

    def test_placeholder_is_known_by_size_not_name(self):
        # nl-matter-android's real launcher (21 Nov, 05:43): lib/x86/libmatternone.so 1,300 bytes,
        # lib/x86_64 1,880 bytes, Matter in both ARM folders
        rc, errs = Dist(home_libs=merge(MATTER, {a: ["libmatternone.so"] for a in ["x86", "x86_64"]})).errs("--release", "--matter")
        self.assertEqual((rc, errs), (0, []))
        # a full size library only in the Intel folders, even named like a placeholder: ARM would miss it
        big = {a: ["libbig_placeholder.so"] for a in ["x86", "x86_64"]}
        rc, errs = Dist(home_libs=merge(MATTER, big)).errs()
        self.assertEqual(sorted(errs), ["couch-tv-home.apk: lib/arm64-v8a lacks libbig_placeholder.so (a TV of that kind would miss it)",
                                        "couch-tv-home.apk: lib/armeabi-v7a lacks libbig_placeholder.so (a TV of that kind would miss it)"])
        # the limit itself
        self.assertTrue(crc.placeholder(zipfile.ZipInfo("x")) is True)   # 0 bytes
        zi = zipfile.ZipInfo("x"); zi.file_size = crc.PLACEHOLDER_MAX + 1
        self.assertFalse(crc.placeholder(zi))

    def test_launcher_without_native_libraries_still_passes(self):
        # 0.13.8's launcher had none: an APK with no lib/ at all installs on every processor
        rc, errs = Dist(home_libs={}).errs("--release", "--matter")
        self.assertEqual((rc, errs), (0, []))

    def test_on_tv_without_intel_folders_fails(self):
        arm_only = merge({a: v for a, v in CONSCRYPT.items() if a in crc.ARM}, MATTER)
        rc, errs = Dist(ontv_libs=arm_only).errs("--release", "--matter")
        self.assertEqual(rc, 1)
        self.assertEqual(len(errs), 4, errs)   # x86 and x86_64, in both on-TV APKs
        self.assertTrue(all("no lib/x86" in e for e in errs), errs)
        no64 = merge({a: v for a, v in CONSCRYPT.items() if a != "x86_64"}, MATTER)
        rc, errs = Dist(ontv_libs=no64).errs()
        self.assertEqual(sorted(errs), ["couch-tv-ontv-watch.apk: native libraries inside but no lib/x86_64 folder: Android refuses to install it on a TV with that processor",
                                        "couch-tv-ontv.apk: native libraries inside but no lib/x86_64 folder: Android refuses to install it on a TV with that processor"])

    # fable NO-GO 21 Nov, 5: the plain and the watch APK told apart by their accessibility service
    def test_plain_and_watch_swapped_fails(self):
        d = Dist()
        a, b = d.d / "couch-tv-ontv.apk", d.d / "couch-tv-ontv-watch.apk"
        tmp = d.d / "swap.tmp"
        a.rename(tmp); b.rename(a); tmp.rename(b)
        d.sums()
        rc, errs = d.errs("--release", "--matter")
        self.assertEqual(rc, 1)
        self.assertEqual(sorted(errs), [
            "couch-tv-ontv-watch.apk has 0 accessibility services but must be the watch app (one accessibility service): are the two on-TV files swapped?",
            "couch-tv-ontv.apk has 1 accessibility services but must be the plain app (no accessibility service): are the two on-TV files swapped?",
        ])

    def test_two_plain_or_two_watch_copies_fail(self):
        d = Dist()
        apk(d.d / "couch-tv-ontv-watch.apk", merge(CONSCRYPT, MATTER))           # a plain build under the watch name
        d.sums()
        rc, errs = d.errs("--release")
        self.assertEqual((rc, len(errs)), (1, 1), errs)
        self.assertIn("couch-tv-ontv-watch.apk has 0 accessibility services", errs[0])
        d = Dist()
        apk(d.d / "couch-tv-ontv.apk", merge(CONSCRYPT, MATTER), watch=True)     # a watch build under the plain name
        d.sums()
        rc, errs = d.errs("--release")
        self.assertEqual((rc, len(errs)), (1, 1), errs)
        self.assertIn("couch-tv-ontv.apk has 1 accessibility services", errs[0])

    def test_without_aapt2_the_plain_watch_rule_says_so(self):
        crc.tool = lambda name: None
        rc, errs = Dist().errs()
        self.assertEqual(rc, 1)
        self.assertEqual(errs, ["aapt2 not found (set ANDROID_HOME): cannot tell the plain on-TV APK from the watch one"])

    def test_count_accessibility_reads_aapt2_xmltree(self):
        svc = '            A: http://schemas.android.com/apk/res/android:permission(0x01010006)="android.permission.BIND_ACCESSIBILITY_SERVICE" (Raw: "android.permission.BIND_ACCESSIBILITY_SERVICE")'
        uses = '      A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.BIND_ACCESSIBILITY_SERVICE" (Raw: "android.permission.BIND_ACCESSIBILITY_SERVICE")'
        other = '            A: http://schemas.android.com/apk/res/android:permission(0x01010006)="android.permission.BIND_JOB_SERVICE" (Raw: "android.permission.BIND_JOB_SERVICE")'
        self.assertEqual(crc.count_accessibility("\n".join([svc, uses, other])), 1)
        self.assertEqual(crc.count_accessibility("\n".join([uses, other])), 0)
        self.assertEqual(crc.count_accessibility("\n".join([svc, other, svc])), 2)

    # fable NO-GO 21 Nov, 6: every file SHA256SUMS.txt lists is checked, the Samsung files too
    def test_samsung_files_in_the_sums_are_checked(self):
        d = Dist(samsung=True)
        rc, errs = d.errs("--release", "--matter")
        self.assertEqual((rc, errs), (0, []))
        lines = (d.d / "SHA256SUMS.txt").read_text().splitlines()
        self.assertEqual(len(lines), 5)   # 3 APKs + 2 Samsung files in this fake (6 with the sync APK)
        (d.d / "couch-tv-samsung.wgt").write_bytes(b"built again")
        rc, errs = d.errs("--release")
        self.assertEqual(rc, 1)
        self.assertEqual(errs, ["SHA256SUMS.txt has another SHA-256 for couch-tv-samsung.wgt (built again after the sums?)"])
        (d.d / "couch-tv-samsung-setup.zip").unlink()
        rc, errs = d.errs("--release")
        self.assertEqual(sorted(errs), ["SHA256SUMS.txt has another SHA-256 for couch-tv-samsung.wgt (built again after the sums?)",
                                        "SHA256SUMS.txt lists couch-tv-samsung-setup.zip, which is not in dist"])

    def test_a_wrong_checksum_line_for_a_samsung_file_fails(self):
        d = Dist(samsung=True)
        f = d.d / "SHA256SUMS.txt"
        f.write_text("\n".join(("0" * 64 + l[64:]) if "samsung.wgt" in l else l for l in f.read_text().splitlines()) + "\n")
        rc, errs = d.errs("--release")
        self.assertEqual((rc, errs), (1, ["SHA256SUMS.txt has another SHA-256 for couch-tv-samsung.wgt (built again after the sums?)"]))


@unittest.skipUnless(os.environ.get("COUCHTV_RELEASE_DIST"), "set COUCHTV_RELEASE_DIST to a folder of real built APKs")
class RealBuild(unittest.TestCase):
    def test_real_apks(self):
        d = os.environ["COUCHTV_RELEASE_DIST"]
        args = [d] + os.environ.get("COUCHTV_RELEASE_ARGS", "").split()
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = crc.main([a for a in args if a])
        print(buf.getvalue())
        self.assertEqual(rc, 0, buf.getvalue())


if __name__ == "__main__":
    unittest.main()
