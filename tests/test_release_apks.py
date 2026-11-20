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


def apk(path, libs, stored=False):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("classes.dex", b"dex")
        for abi, names in libs.items():
            for n in names:
                z.writestr(zipfile.ZipInfo(f"lib/{abi}/{n}"), b"\0" * 1000,
                           compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)


def merge(*maps):
    out = {}
    for m in maps:
        for abi, names in m.items():
            out.setdefault(abi, []).extend(names)
    return out


class Dist:
    def __init__(self, ontv_libs=None, stored=False, extra=(), sums=True):
        self.t = tempfile.TemporaryDirectory()
        self.d = Path(self.t.name)
        apk(self.d / "couch-tv-home.apk", {})
        for n in crc.ONTV:
            apk(self.d / n, ontv_libs if ontv_libs is not None else merge(CONSCRYPT, MATTER), stored)
        for n in extra:
            apk(self.d / n, MATTER)
        if sums:
            lines = [f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}" for p in sorted(self.d.glob("*.apk"))]
            (self.d / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")

    def errs(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = crc.main([str(self.d), "--skip-signer", *args])
        crc_errs = [l for l in buf.getvalue().splitlines() if l.startswith("  - ")]
        return rc, crc_errs


class ReleaseApkRules(unittest.TestCase):
    def setUp(self):
        # aapt2 is for real APKs only; the fake ones have no manifest
        self._same = crc.check_same_app
        crc.check_same_app = lambda dist: []

    def tearDown(self):
        crc.check_same_app = self._same

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
