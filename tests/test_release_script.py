"""scripts/release.sh: the release steps in order (Fable review of nl-matter-packaging, items 4a to 4f).

Each test copies release.sh into a fresh folder with a stand-in check-release-apks.py (it logs its
arguments and exits with STUB_RC) and stand-in git and gh on PATH (they log every call and push
nothing). So these tests prove the order and the stops: SHA256SUMS.txt has exactly the 6 release
files, the check always gets --release --matter --signer and an absolute --previous, and publish
runs every check before the first git push, and stops before it on any failure.

Run: python3 tests/test_release_script.py"""
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
CERT = "5b5ef39266a1b5bb2425ca8a0023003e895753630fffd4831efcf8c112372116"
FILES = ["couch-tv-home.apk", "couch-tv-ontv.apk", "couch-tv-ontv-watch.apk", "couch-tv-sync.apk",
         "couch-tv-samsung-setup.zip", "couch-tv-samsung.wgt"]

STUB_CHECK = """import os, sys
open(os.environ["CALLS"], "a").write("check " + " ".join(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("STUB_RC", "0")))
"""
FAKE = """#!/bin/bash
echo "{name} $*" >> "$CALLS"
if [ "{name}" = git ] && [ "$3" = status ]; then printf "%s" "${{FAKE_STATUS:-}}"; fi
exit 0
"""


class ReleaseScript(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.r = Path(self.t.name)
        (self.r / "scripts").mkdir()
        shutil.copy(ROOT / "scripts/release.sh", self.r / "scripts/release.sh")
        (self.r / "scripts/check-release-apks.py").write_text(STUB_CHECK)
        self.dist = self.r / "dist"
        self.dist.mkdir()
        for i, n in enumerate(FILES):
            (self.dist / n).write_bytes(n.encode() * (i + 1))
        (self.dist / "stray.apk").write_bytes(b"not a release file")   # never hashed, never published
        (self.r / "RELEASE-NOTES-9.9.9.md").write_text("notes\n")
        self.prev = self.r / "old-ontv.apk"
        self.prev.write_bytes(b"old")
        b = self.r / "bin"
        b.mkdir()
        for name in ("git", "gh"):
            (b / name).write_text(FAKE.format(name=name))
            (b / name).chmod(0o755)
        self.calls = self.r / "calls.log"
        self.env = dict(os.environ, PATH=f"{b}:{os.environ['PATH']}", CALLS=str(self.calls), ANDROID_HOME="/nonexistent")

    def tearDown(self):
        self.t.cleanup()

    def run_step(self, *args, **env):
        e = dict(self.env, **env)
        p = subprocess.run(["bash", str(self.r / "scripts/release.sh"), *args], capture_output=True, text=True, env=e)
        return p.returncode, p.stdout + p.stderr

    def log(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def sums(self):
        return (self.dist / "SHA256SUMS.txt").read_text().splitlines()

    # --- arguments (4e, 4f)
    def test_previous_is_required(self):
        rc, out = self.run_step("sums")
        self.assertEqual(rc, 2, out)
        self.assertIn("--previous is required", out)
        self.assertEqual(self.log(), [])

    def test_previous_must_be_absolute(self):
        rc, out = self.run_step("sums", "--previous", "wt-release-0138/dist/couch-tv-ontv.apk")
        self.assertEqual(rc, 2, out)
        self.assertIn("absolute", out)
        self.assertEqual(self.log(), [])

    def test_previous_must_exist(self):
        rc, out = self.run_step("sums", "--previous", str(self.r / "nope.apk"))
        self.assertEqual(rc, 2, out)

    def test_signer_must_be_a_sha256(self):
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "5b5ef392")
        self.assertEqual(rc, 2, out)
        self.assertEqual(self.log(), [])

    # --- sums (4b, 4c)
    def test_sums_are_exactly_the_six_release_files(self):
        rc, out = self.run_step("sums", "--previous", str(self.prev))
        self.assertEqual(rc, 0, out)
        lines = self.sums()
        self.assertEqual([l.split()[1] for l in lines], FILES)
        for l in lines:
            h, n = l.split()
            self.assertEqual(h, hashlib.sha256((self.dist / n).read_bytes()).hexdigest())
        self.assertEqual(self.log(), [f"check {self.dist} --release --matter --signer {CERT} --previous {self.prev}"])

    def test_sums_passes_another_signer(self):
        other = "a" * 64
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", other)
        self.assertEqual(rc, 0, out)
        self.assertIn(f"--signer {other} ", self.log()[0])

    def test_sums_stops_when_a_samsung_file_is_missing(self):
        (self.dist / "couch-tv-samsung.wgt").unlink()
        rc, out = self.run_step("sums", "--previous", str(self.prev))
        self.assertEqual(rc, 5, out)
        self.assertFalse((self.dist / "SHA256SUMS.txt").exists())
        self.assertEqual(self.log(), [])

    def test_sums_stops_when_the_check_fails(self):
        rc, out = self.run_step("sums", "--previous", str(self.prev), STUB_RC="1")
        self.assertEqual(rc, 5, out)
        self.assertIn("RELEASE CHECK FAILED", out)

    # --- publish (4d): every check before anything leaves the computer
    def publish(self, **env):
        return self.run_step("publish", "--previous", str(self.prev), "--version", "9.9.9", **env)

    def pushes(self):
        return [l for l in self.log() if l.startswith("git ") and " push " in l or l.startswith("gh release create")]

    def test_publish_runs_every_check_before_the_push(self):
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        rc, out = self.publish()
        self.assertEqual(rc, 0, out)
        log = self.log()
        first_push = next(i for i, l in enumerate(log) if " push " in l)
        check = next(i for i, l in enumerate(log) if l.startswith("check "))
        self.assertLess(check, first_push)
        self.assertIn("--release --matter --signer " + CERT, log[check])
        self.assertTrue(any(l.startswith("git -C") and "push origin HEAD:main" in l for l in log))
        self.assertTrue(any("tag -a v9.9.9" in l for l in log))
        create = [l for l in log if l.startswith("gh release create v9.9.9")]
        self.assertEqual(len(create), 1)
        self.assertTrue(create[0].endswith(" ".join(FILES) + " SHA256SUMS.txt"), create[0])
        self.assertNotIn("stray.apk", create[0])

    def test_publish_stops_when_the_check_fails(self):
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        rc, out = self.publish(STUB_RC="1")
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_a_file_changed_after_the_sums(self):
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        (self.dist / "couch-tv-samsung-setup.zip").write_bytes(b"built again")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])
        self.assertFalse(any(l.startswith("check ") for l in self.log()))

    def test_publish_stops_on_four_line_sums(self):
        # what release-checksums.sh wrote before Samsung was added: 4 APK lines
        lines = [f"{hashlib.sha256((self.dist / n).read_bytes()).hexdigest()}  {n}" for n in FILES[:4]]
        (self.dist / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertIn("6 lines", out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_on_six_lines_of_the_wrong_files(self):
        names = FILES[:5] + ["stray.apk"]
        lines = [f"{hashlib.sha256((self.dist / n).read_bytes()).hexdigest()}  {n}" for n in names]
        (self.dist / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_with_uncommitted_changes(self):
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        rc, out = self.publish(FAKE_STATUS=" M scripts/release.sh")
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_needs_a_version_and_notes(self):
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        rc, out = self.run_step("publish", "--previous", str(self.prev))
        self.assertEqual(rc, 2, out)
        rc, out = self.run_step("publish", "--previous", str(self.prev), "--version", "9.9.8")
        self.assertEqual(rc, 1, out)
        self.assertIn("RELEASE-NOTES-9.9.8.md is missing", out)
        self.assertEqual(self.pushes(), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
