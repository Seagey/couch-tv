"""scripts/release.sh: the release steps in order (Fable review of nl-matter-packaging, items 4a to 4f,
and the hardening review after it, M1 to M4 and L1 to L3).

Each test copies release.sh into a fresh folder with a stand-in check-release-apks.py (it logs its
arguments and exits with STUB_RC), stand-in git and gh on PATH (they log every call and push nothing),
a stand-in gradlew (writes fake APKs) and a stand-in Samsung build. So these tests prove the order and
the stops: SHA256SUMS.txt has exactly the 6 release files, the check always gets --release --matter
--signer and an absolute --previous (and --version when given), build runs only from a clean tree and
writes BUILT-FROM, and publish runs every check before the first git push, and stops before it on any
failure.

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
ONTV = "fab6cebbd4958043be63273fbba15f34447d6169d309f0c8e3bd65ac58469556"
HEAD = "0123456789abcdef0123456789abcdef01234567"
FILES = ["couch-tv-home.apk", "couch-tv-ontv.apk", "couch-tv-ontv-watch.apk", "couch-tv-sync.apk",
         "couch-tv-samsung-setup.zip", "couch-tv-samsung.wgt"]

STUB_CHECK = """import os, sys
open(os.environ["CALLS"], "a").write("check " + " ".join(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("STUB_RC", "0")))
"""
FAKE_GIT = """#!/bin/bash
echo "git $*" >> "$CALLS"
case "$3" in
  status) printf "%s" "${FAKE_STATUS:-}" ;;
  rev-parse) if [ "$4" = HEAD ]; then echo "${FAKE_HEAD}"; elif [ -n "${FAKE_LOCAL_TAG:-}" ]; then exit 0; else exit 1; fi ;;
  ls-remote) printf "%s" "${FAKE_REMOTE_TAG:-}" ;;
  remote) [ -n "${FAKE_REMOTE_URL:-}" ] || exit 2; echo "$FAKE_REMOTE_URL" ;;
  push) exit "${FAKE_PUSH_RC:-0}" ;;
esac
exit 0
"""
SETUP = ["couch-tv-Setup-mac-apple-silicon.zip", "couch-tv-Setup-mac-intel.zip", "couch-tv-Setup-windows.zip",
         "couch-tv-Setup-linux.tar.gz", "SHA256SUMS-setup.txt"]
# release view --json assets: the asset names (FAKE_ASSETS, default every Setup file; after a rerun FAKE_ASSETS_AFTER);
# run list: "id status conclusion" (FAKE_RUN)
ARCHIVES = SETUP[:4]
HASHES = {n: "%064x" % (i + 1) for i, n in enumerate(ARCHIVES)}
SUMS_TEXT = "".join("%s  %s\n" % (HASHES[n], n) for n in ARCHIVES)
DIGESTS = "".join("%s sha256:%s\n" % (n, HASHES[n]) for n in ARCHIVES)
# the tag's commit (FAKE_TAG_COMMIT), the Setup workflow run's commit (FAKE_RUN_SHA), the sums file on the release
# (FAKE_SUMS) and each asset's GitHub digest (FAKE_DIGESTS); the defaults agree with one another
FAKE_GH = """#!/bin/bash
echo "gh $*" >> "$CALLS"
[ "$1" = auth ] && exit "${FAKE_GH_AUTH:-0}"
[ "$1" = api ] && { printf "%s\\n" "${FAKE_TAG_COMMIT:-$FAKE_HEAD}"; exit 0; }
case "$*" in *headSha*) printf "%s" "${FAKE_RUN_SHA-$FAKE_HEAD}"; exit 0 ;; esac
case "$*" in *'.digest'*) printf "%s" "${FAKE_DIGESTS-}"; exit 0 ;; esac
if [ "$1 $2" = "release view" ] && [ "$7" = assets ]; then
  if [ -n "${FAKE_ASSETS_AFTER+x}" ] && grep -q "^gh run rerun" "$CALLS"; then printf "%b" "$FAKE_ASSETS_AFTER"; else printf "%b" "${FAKE_ASSETS-SETUP_DEFAULT}"; fi
fi
[ "$1 $2" = "run list" ] && printf "%s" "${FAKE_RUN:-}"
if [ "$1 $2" = "release download" ]; then
  [ -n "${FAKE_DOWNLOAD_RC:-}" ] && exit "$FAKE_DOWNLOAD_RC"
  dir=""; pats=""; prev=""
  for a in "$@"; do [ "$prev" = --dir ] && dir=$a; [ "$prev" = --pattern ] && pats="$pats $a"; prev=$a; done
  for f in $pats; do echo "content of $f" > "$dir/$f"; [ "$f" = SHA256SUMS-setup.txt ] && printf "%s" "${FAKE_SUMS-}" > "$dir/$f"; done
fi
exit 0
""".replace("SETUP_DEFAULT", "\\\\n".join(SETUP) + "\\\\n")
# called as: gradlew -p <dir> --no-daemon -q <tasks...>  or  gradlew -p <dir> --stop
FAKE_GRADLEW = """#!/bin/bash
[ "$3" = --stop ] && exit 0
echo "gradle $*" >> "$CALLS"
[ -n "${GRADLE_LOCK:-}" ] && [ -d "$GRADLE_LOCK" ] && echo "gradle lock held" >> "$CALLS"
[ -n "${FAKE_GRADLE_KILL:-}" ] && kill -TERM $PPID
d=$2
mkdir -p "$d/app/build/outputs/apk/release" "$d/app/build/outputs/apk/watch"
echo "$d release" > "$d/app/build/outputs/apk/release/app-release.apk"
echo "$d watch" > "$d/app/build/outputs/apk/watch/app-watch.apk"
# the on-TV app has store flavours (github, play): its GitHub APKs are under apk/github/
mkdir -p "$d/app/build/outputs/apk/github/release" "$d/app/build/outputs/apk/github/watch"
echo "$d release" > "$d/app/build/outputs/apk/github/release/app-github-release.apk"
echo "$d watch" > "$d/app/build/outputs/apk/github/watch/app-github-watch.apk"
exit "${FAKE_GRADLE_RC:-0}"
"""
# called as: sign-ontv.sh apk|aab <in> <out>: logs, then copies (the real one signs with the release key)
FAKE_SIGN = """#!/bin/bash
echo "sign $1 $(basename "$3")" >> "$CALLS"
[ -n "${FAKE_SIGN_RC:-}" ] && exit "$FAKE_SIGN_RC"
cp "$2" "$3"
"""
# the Setup sums signer and checker: the real ones need the release key and the app's public key
FAKE_SIGN_SUMS = """import os, sys
open(os.environ["CALLS"], "a").write("sign-setup-sums " + os.path.basename(sys.argv[1]) + "\\n")
open(sys.argv[1] + ".sig", "w").write("c2ln\\n")
"""
FAKE_VERIFY_SUMS = """import os, sys
open(os.environ["CALLS"], "a").write("verify-setup-sig " + " ".join(os.path.basename(a) for a in sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("FAKE_VERIFY_RC", "0")))
"""
FAKE_SAMSUNG = """#!/bin/bash
echo "samsung $*" >> "$CALLS"
r=$(dirname "$(dirname "$1")")
mkdir -p "$r/build/samsung"
echo wgt > "$r/build/samsung/couch-tv-samsung.wgt"
echo zip > "$r/build/samsung/couch-tv-samsung-setup.zip"
"""


def exe(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)


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
        exe(b / "git", FAKE_GIT)
        exe(b / "gh", FAKE_GH)
        exe(self.r / "tv-home/android/gradlew", FAKE_GRADLEW)
        exe(self.r / "fake-samsung", FAKE_SAMSUNG)
        exe(self.r / "scripts/sign-ontv.sh", FAKE_SIGN)
        (self.r / "scripts/sign-setup-sums.py").write_text(FAKE_SIGN_SUMS)
        (self.r / "scripts/verify-setup-sig.py").write_text(FAKE_VERIFY_SUMS)
        (self.r / "fake-signing-key.pem").write_text("not a key\n")
        (self.r / "remote/dist").mkdir(parents=True)
        (self.r / "remote/dist/index.html").write_text("x")
        self.calls = self.r / "calls.log"
        self.lock = self.r / "gradle.lock"
        self.env = dict(os.environ, PATH=f"{b}:{os.environ['PATH']}", CALLS=str(self.calls), ANDROID_HOME="/nonexistent",
                        FAKE_HEAD=HEAD, JAVA_HOME=str(self.r), SAMSUNG_PYTHON=str(self.r / "fake-samsung"),
                        COUCHTV_SIGNING_KEY=str(self.r / "fake-signing-key.pem"), FAKE_SUMS=SUMS_TEXT, FAKE_DIGESTS=DIGESTS)
        for k in ("REPO", "REMOTE", "GRADLE_LOCK", "CONFIG", "STUB_RC"):
            self.env.pop(k, None)

    def tearDown(self):
        self.t.cleanup()

    def run_step(self, *args, **env):
        e = dict(self.env, **env)
        p = subprocess.run(["bash", str(self.r / "scripts/release.sh"), *args], capture_output=True, text=True, env=e, timeout=30)
        return p.returncode, p.stdout + p.stderr

    def raw_log(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def log(self):
        """Every call but the read of the remote's address, which each run makes for the L2 pin."""
        return [l for l in self.raw_log() if " remote get-url " not in l]

    def sums(self):
        return (self.dist / "SHA256SUMS.txt").read_text().splitlines()

    def built(self, head=HEAD):
        """sums as build leaves them: SHA256SUMS.txt and BUILT-FROM, then a fresh call log."""
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        sha = hashlib.sha256((self.dist / "SHA256SUMS.txt").read_bytes()).hexdigest()
        (self.dist / "BUILT-FROM").write_text(f"{head}\n{sha}\n")
        self.calls.unlink()

    # --- arguments (4e, 4f, L1, L2)
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

    def test_a_flag_without_a_value_stops_at_once(self):
        # L1: this looped forever (shift 2 with one argument left fails and shifts nothing)
        for flag in ("--previous", "--signer", "--version"):
            rc, out = self.run_step("sums", "--previous", str(self.prev), flag)
            self.assertEqual(rc, 2, f"{flag}: {out}")
        self.assertEqual(self.log(), [])

    def test_couch_tv_takes_only_its_own_certificate(self):
        # L2: for Seagey/couch-tv another --signer is refused, even a well formed one
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64)
        self.assertEqual(rc, 2, out)
        self.assertIn("couch-tv's own certificate", out)
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64, REPO="Seagey/couch-tv")
        self.assertEqual(rc, 2, out)
        self.assertEqual(self.log(), [])

    def test_the_pin_holds_however_repo_is_spelt(self):
        for repo in ("seagey/couch-tv", "SEAGEY/COUCH-TV", "Seagey/Couch-TV"):
            rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64, REPO=repo)
            self.assertEqual(rc, 2, f"{repo}: {out}")
        self.assertEqual(self.raw_log(), [f"git -C {self.r} remote get-url origin"] * 3)

    def test_the_pin_holds_when_the_remote_is_couch_tv(self):
        # REPO says a fork, but the git remote is couch-tv's own: still only couch-tv's certificate
        for url in ("ssh://github.com/Seagey/couch-tv.git", "https://github.com/seagey/COUCH-TV"):
            rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64,
                                    REPO="someone/couch-tv", FAKE_REMOTE_URL=url)
            self.assertEqual(rc, 2, f"{url}: {out}")
        self.assertFalse(any(l.startswith("check ") for l in self.log()))
        # the remote named by REMOTE is the one looked at
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64,
                                REPO="someone/couch-tv", REMOTE="upstream", FAKE_REMOTE_URL="https://github.com/Seagey/couch-tv")
        self.assertEqual(rc, 2, out)
        self.assertIn(f"git -C {self.r} remote get-url upstream", self.raw_log())
        # a fork's own remote: its own signer is fine
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", "a" * 64,
                                REPO="someone/couch-tv", FAKE_REMOTE_URL="https://github.com/someone/couch-tv")
        self.assertEqual(rc, 0, out)

    def test_a_fork_passes_its_own_signer(self):
        other = "a" * 64
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--signer", other, REPO="someone/couch-tv")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"--signer {other} ", self.log()[0])

    # --- sums (4b, 4c)
    def test_sums_are_exactly_the_six_release_files(self):
        rc, out = self.run_step("sums", "--previous", str(self.prev))
        self.assertEqual(rc, 0, out)
        lines = self.sums()
        self.assertEqual([l.split()[1] for l in lines], FILES)
        for l in lines:
            h, n = l.split()
            self.assertEqual(h, hashlib.sha256((self.dist / n).read_bytes()).hexdigest())
        self.assertEqual(self.log(), [f"check {self.dist} --release --matter --signer {CERT} --previous {self.prev} --ontv-signer {ONTV}"])

    def test_sums_passes_the_version_when_given(self):
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", "0.13.11")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.log(), [f"check {self.dist} --release --matter --signer {CERT} --previous {self.prev} --ontv-signer {ONTV} --version 0.13.11"])

    def test_versions_before_0_13_11_are_debug_key_only_by_default(self):
        # the key rotation starts at 0.13.11: "publish --version 0.13.10" checks what an ONTV_SIGN=0 build made
        for v in ("0.13.10", "0.13.9", "0.12"):
            self.calls.unlink(missing_ok=True)
            rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", v)
            self.assertEqual(rc, 0, out)
            self.assertEqual(self.log(), [f"check {self.dist} --release --matter --signer {CERT} --previous {self.prev} --version {v}"])
        for v in ("0.13.11", "0.14", "1.0.0"):
            self.calls.unlink(missing_ok=True)
            rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", v)
            self.assertIn(f"--ontv-signer {ONTV}", self.log()[0])
        # ONTV_SIGN still decides when it is set
        self.calls.unlink(missing_ok=True)
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", "0.13.10", ONTV_SIGN="1")
        self.assertIn(f"--ontv-signer {ONTV}", self.log()[0])
        self.calls.unlink(missing_ok=True)
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", "0.13.11", ONTV_SIGN="0")
        self.assertNotIn("--ontv-signer", self.log()[0])

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

    # --- build (4a, M3, M4, L3)
    def build(self, **env):
        return self.run_step("build", "--previous", str(self.prev), **env)

    def test_build_writes_the_commit_and_the_six_sums(self):
        (self.dist / "BUILT-FROM").write_text("an older commit\n")
        rc, out = self.build(GRADLE_LOCK=str(self.lock))
        self.assertEqual(rc, 0, out)
        sha = hashlib.sha256((self.dist / "SHA256SUMS.txt").read_bytes()).hexdigest()
        self.assertEqual((self.dist / "BUILT-FROM").read_text().splitlines(), [HEAD, sha])
        self.assertEqual([l.split()[1] for l in self.sums()], FILES)
        self.assertEqual((self.dist / "couch-tv-ontv-watch.apk").read_text().strip(), f"{self.r}/on-tv/android watch")
        log = self.log()
        self.assertEqual(sum(1 for l in log if l.startswith("gradle -p")), 3)
        self.assertEqual(log.count("gradle lock held"), 3)      # each gradle run under the lock
        self.assertFalse(self.lock.exists())                   # and the lock given back
        self.assertTrue(log[-1].startswith("check "))
        # the two on-TV APKs are signed with the release key and the proof of rotation (sign-ontv.sh)
        self.assertEqual([l for l in log if l.startswith("sign ")], ["sign apk couch-tv-ontv.apk", "sign apk couch-tv-ontv-watch.apk"])

    def test_a_fork_build_signs_nothing_itself(self):
        rc, out = self.build(REPO="someone/couch-tv", FAKE_REMOTE_URL="https://github.com/someone/couch-tv")
        self.assertEqual(rc, 0, out)
        self.assertFalse(any(l.startswith("sign ") for l in self.log()))
        self.assertNotIn("--ontv-signer", self.log()[-1])

    def test_one_more_debug_only_release_when_asked(self):
        rc, out = self.build(ONTV_SIGN="0")
        self.assertEqual(rc, 0, out)
        self.assertFalse(any(l.startswith("sign ") for l in self.log()))
        self.assertNotIn("--ontv-signer", self.log()[-1])

    def test_a_failed_signing_stops_the_build(self):
        rc, out = self.build(GRADLE_LOCK=str(self.lock), FAKE_SIGN_RC="1")
        self.assertEqual(rc, 6, out)
        self.assertIn("SIGNING FAILED", out)
        self.assertFalse((self.dist / "BUILT-FROM").exists())
        self.assertFalse(any(l.startswith("check ") for l in self.log()))

    def test_play_builds_and_signs_the_bundle(self):
        out_aab = self.r / "on-tv/android/app/build/outputs/bundle/playRelease"
        out_aab.mkdir(parents=True)
        (out_aab / "app-play-release.aab").write_text("aab")
        rc, out = self.run_step("play", GRADLE_LOCK=str(self.lock))
        self.assertEqual(rc, 0, out)
        log = self.log()
        self.assertTrue(any(l.startswith("gradle -p") and l.endswith("clean bundlePlayRelease") for l in log), log)
        self.assertIn("sign aab couch-tv-play.aab", log)
        self.assertEqual((self.r / "dist-play/couch-tv-play.aab").read_text(), "aab")
        self.assertFalse(any(l.startswith("check ") or " push " in l for l in log))
        rc, out = self.run_step("play", FAKE_STATUS="?? x")
        self.assertEqual(rc, 1, out)

    def test_build_always_carries_the_example_config(self):
        # M4: a CONFIG in the environment (this computer's own settings) is never built in
        rc, out = self.build(CONFIG=str(self.r / "config.json"))
        self.assertEqual(rc, 0, out)
        home = [l for l in self.log() if l.startswith("gradle -p") and "tv-home/android" in l]
        self.assertEqual(len(home), 1)
        self.assertTrue(home[0].endswith(f"-PconfigJson={self.r}/config.example.json"), home[0])

    def test_build_only_from_a_clean_tree(self):
        for status in (" M scripts/release.sh", "?? new-file.txt"):
            rc, out = self.build(FAKE_STATUS=status)
            self.assertEqual(rc, 1, out)
            self.assertFalse(any(l.startswith("gradle -p") for l in self.log()), status)

    def test_a_failed_gradle_run_gives_the_lock_back(self):
        rc, out = self.build(GRADLE_LOCK=str(self.lock), FAKE_GRADLE_RC="7")
        self.assertEqual(rc, 7, out)
        self.assertFalse(self.lock.exists())
        self.assertFalse((self.dist / "BUILT-FROM").exists())

    def test_a_killed_build_gives_the_lock_back(self):
        # L3: killed in the middle of a gradle run, the EXIT trap still removes the lock it holds
        rc, out = self.build(GRADLE_LOCK=str(self.lock), FAKE_GRADLE_KILL="1")
        self.assertNotEqual(rc, 0, out)
        self.assertIn("gradle lock held", self.log())
        self.assertFalse(self.lock.exists())

    def test_never_removes_a_lock_it_does_not_hold(self):
        self.lock.mkdir()     # another agent's gradle run
        rc, out = self.run_step("sums", "--previous", str(self.prev), GRADLE_LOCK=str(self.lock))
        self.assertEqual(rc, 0, out)
        self.assertTrue(self.lock.is_dir())
        rc, out = self.run_step("sums", "--previous", str(self.prev), GRADLE_LOCK=str(self.lock), STUB_RC="1")
        self.assertEqual(rc, 5, out)
        self.assertTrue(self.lock.is_dir())

    # --- publish (4d, M1, M2, M3): every check before anything leaves the computer
    def publish(self, version="9.9.9", **env):
        return self.run_step("publish", "--previous", str(self.prev), "--version", version, **env)

    def pushes(self):
        return [l for l in self.log() if (l.startswith("git ") and " push " in l) or l.startswith("gh release create")]

    def test_publish_runs_every_check_before_the_push(self):
        self.built()
        rc, out = self.publish()
        self.assertEqual(rc, 0, out)
        log = self.log()
        first_push = next(i for i, l in enumerate(log) if " push " in l)
        check = next(i for i, l in enumerate(log) if l.startswith("check "))
        local_tag = next(i for i, l in enumerate(log) if "rev-parse -q --verify refs/tags/v9.9.9" in l)
        remote_tag = next(i for i, l in enumerate(log) if "ls-remote --tags origin refs/tags/v9.9.9" in l)
        auth = next(i for i, l in enumerate(log) if l == "gh auth status")
        self.assertLess(max(check, local_tag, remote_tag, auth), first_push)
        self.assertEqual(log[check], f"check {self.dist} --release --matter --signer {CERT} --previous {self.prev} --ontv-signer {ONTV} --version 9.9.9")
        # the tag first, then ONE atomic push of main and the tag, then the GitHub release
        tag = next(i for i, l in enumerate(log) if "tag -a v9.9.9 -m couch-tv 9.9.9" in l)
        pushes = [l for l in log if " push " in l]
        self.assertEqual(pushes, [f"git -C {self.r} push --atomic origin HEAD:main refs/tags/v9.9.9"])
        create_i = next(i for i, l in enumerate(log) if l.startswith("gh release create v9.9.9"))
        self.assertLess(tag, first_push)
        self.assertLess(first_push, create_i)
        create = [l for l in log if l.startswith("gh release create v9.9.9")]
        self.assertEqual(len(create), 1)
        self.assertTrue(create[0].endswith(" ".join(FILES) + " SHA256SUMS.txt"), create[0])
        self.assertNotIn("stray.apk", create[0])
        self.assertFalse(any("tag -d" in l for l in log))

    # --- couch-tv Setup's zips on the release (0.13.11 shipped without them: the Apple silicon job never got a
    # runner, so the Setup app workflow skipped its upload job)
    def setup_step(self, **env):
        return self.run_step("setup", "--version", "9.9.9", SETUP_WAIT="0", **env)

    def test_publish_ends_by_checking_the_setup_files(self):
        self.built()
        rc, out = self.publish(SETUP_WAIT="0")
        self.assertEqual(rc, 0, out)
        self.assertIn("SETUP FILES OK on v9.9.9", out)
        log = self.log()
        create = next(i for i, l in enumerate(log) if l.startswith("gh release create"))
        look = next(i for i, l in enumerate(log) if l.startswith("gh release view v9.9.9 --repo Seagey/couch-tv --json assets"))
        self.assertLess(create, look)

    def test_publish_exits_7_when_the_setup_files_never_come(self):
        self.built()
        rc, out = self.publish(SETUP_WAIT="0", SETUP_TIMEOUT="0", FAKE_ASSETS="couch-tv-home.apk\n")
        self.assertEqual(rc, 7, out)
        self.assertIn("SETUP FILES MISSING on v9.9.9", out)
        for f in SETUP:
            self.assertIn(f, out)

    def test_setup_needs_no_previous_and_passes_when_all_four_are_there(self):
        rc, out = self.setup_step()
        self.assertEqual(rc, 0, out)
        self.assertEqual([l for l in self.log() if l.startswith("gh run rerun")], [])

    def test_setup_signs_the_sums_on_the_release_and_uploads_the_sig(self):
        rc, out = self.setup_step()
        self.assertEqual(rc, 0, out)
        self.assertIn("SETUP SUMS SIGNED on v9.9.9", out)
        log = self.log()
        up = [l for l in log if l.startswith("gh release upload v9.9.9")]
        self.assertEqual(len(up), 1, up)
        self.assertIn("SHA256SUMS-setup.txt.sig", up[0])
        self.assertIn("--clobber", up[0])
        # checked before the upload and again from the release's own copy after it
        verifies = [i for i, l in enumerate(log) if l.startswith("verify-setup-sig")]
        upload = next(i for i, l in enumerate(log) if l.startswith("gh release upload"))
        self.assertEqual(len(verifies), 2, log)
        self.assertLess(verifies[0], upload)
        self.assertGreater(verifies[1], upload)
        self.assertFalse((self.dist / "setup-sign").exists(), "the working folder is cleaned up")
        self.assertNotIn("not a key", out, "the key is never printed")

    def test_setup_signs_nothing_when_the_sums_hold_a_fifth_name(self):
        rc, out = self.setup_step(FAKE_SUMS=SUMS_TEXT + "%s  extra.apk\n" % ("f" * 64))
        self.assertEqual(rc, 8, out)
        self.assertIn("NOT SIGNING", out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_signs_nothing_when_an_archive_is_missing_from_the_sums(self):
        rc, out = self.setup_step(FAKE_SUMS="".join(SUMS_TEXT.splitlines(True)[:3]))
        self.assertEqual(rc, 8, out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_signs_nothing_when_a_hash_is_not_githubs_digest(self):
        rc, out = self.setup_step(FAKE_DIGESTS=DIGESTS.replace(HASHES[ARCHIVES[2]], "e" * 64))
        self.assertEqual(rc, 8, out)
        self.assertIn(ARCHIVES[2], out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_signs_nothing_when_github_has_no_digest(self):
        rc, out = self.setup_step(FAKE_DIGESTS="")
        self.assertEqual(rc, 8, out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_signs_nothing_when_the_workflow_ran_on_another_commit(self):
        rc, out = self.setup_step(FAKE_RUN_SHA="b" * 40)
        self.assertEqual(rc, 8, out)
        self.assertIn("NOT SIGNING", out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_signs_nothing_when_there_is_no_workflow_run(self):
        rc, out = self.setup_step(FAKE_RUN_SHA="")
        self.assertEqual(rc, 8, out)
        self.assertEqual([l for l in self.log() if l.startswith("sign-setup-sums") or l.startswith("gh release upload")], [])

    def test_setup_without_the_signing_key_exits_8_and_uploads_nothing(self):
        rc, out = self.setup_step(COUCHTV_SIGNING_KEY=str(self.r / "no-such-key.pem"))
        self.assertEqual(rc, 8, out)
        self.assertEqual([l for l in self.log() if l.startswith("gh release upload")], [])

    def test_setup_does_not_upload_a_signature_that_does_not_check(self):
        rc, out = self.setup_step(FAKE_VERIFY_RC="1")
        self.assertEqual(rc, 8, out)
        self.assertEqual([l for l in self.log() if l.startswith("gh release upload")], [])

    def test_setup_names_the_one_missing_file(self):
        have = "\n".join(f for f in SETUP if "apple-silicon" not in f) + "\n"
        rc, out = self.setup_step(SETUP_TIMEOUT="0", FAKE_ASSETS=have)
        self.assertEqual(rc, 7, out)
        self.assertIn("couch-tv-Setup-mac-apple-silicon.zip", out.split("MISSING", 1)[1])
        self.assertNotIn("couch-tv-Setup-windows.zip", out.split("MISSING", 1)[1])

    def test_setup_reruns_a_failed_workflow_run_and_then_passes(self):
        rc, out = self.setup_step(SETUP_TIMEOUT="60", FAKE_ASSETS="", FAKE_RUN="4242 completed failure",
                                  FAKE_ASSETS_AFTER="\n".join(SETUP) + "\n")
        self.assertEqual(rc, 0, out)
        reruns = [l for l in self.log() if l.startswith("gh run rerun")]
        self.assertEqual(reruns, ["gh run rerun 4242 --repo Seagey/couch-tv --failed"])
        runs = [l for l in self.log() if l.startswith("gh run list")]
        self.assertTrue(runs and "--workflow setup-app.yml --event release --branch v9.9.9" in runs[0], runs)

    def test_setup_gives_up_after_its_reruns(self):
        rc, out = self.setup_step(SETUP_TIMEOUT="60", SETUP_RERUNS="2", FAKE_ASSETS="", FAKE_RUN="4242 completed failure")
        self.assertEqual(rc, 7, out)
        self.assertEqual(len([l for l in self.log() if l.startswith("gh run rerun")]), 2)
        self.assertIn("gh run rerun 4242 --failed", out)

    def test_setup_fails_when_the_run_succeeded_but_the_files_are_not_there(self):
        rc, out = self.setup_step(SETUP_TIMEOUT="60", FAKE_ASSETS="", FAKE_RUN="4242 completed success")
        self.assertEqual(rc, 7, out)
        self.assertEqual([l for l in self.log() if l.startswith("gh run rerun")], [])

    def test_setup_needs_a_version(self):
        rc, out = self.run_step("setup")
        self.assertEqual(rc, 2, out)

    def test_the_workflow_uploads_and_checks_all_five(self):
        wf = (ROOT / ".github/workflows/setup-app.yml").read_text()
        for name in ("mac-apple-silicon", "mac-intel", "windows", "linux"):
            self.assertIn("- name: " + name, wf)
        self.assertIn("gh release upload \"$TAG\" couch-tv-Setup-*.zip couch-tv-Setup-*.tar.gz SHA256SUMS-setup.txt", wf)
        self.assertIn("sha256sum couch-tv-Setup-*.zip couch-tv-Setup-*.tar.gz > SHA256SUMS-setup.txt", wf)
        self.assertIn("os: ubuntu-22.04", wf)
        self.assertIn('tar -czf "dist/couch-tv-Setup-${{ matrix.name }}.tar.gz"', wf)
        check = wf.split("- name: Check the release has all five", 1)[1]
        for f in SETUP:
            self.assertIn(f, check)

    def test_a_refused_push_leaves_no_tag_and_no_release(self):
        self.built()
        rc, out = self.publish(FAKE_PUSH_RC="1")
        self.assertEqual(rc, 1, out)
        log = self.log()
        push = next(i for i, l in enumerate(log) if " push --atomic " in l)
        self.assertEqual(log[push + 1], f"git -C {self.r} tag -d v9.9.9")
        self.assertFalse(any(l.startswith("gh release create") for l in log))
        self.assertEqual(sum(1 for l in log if " push " in l), 1)

    def test_files_swapped_in_after_build_stop_publish(self):
        # item 3: build checked these files; one swapped in later and sums run again matches the
        # commit and SHA256SUMS.txt, but not the sums build recorded in BUILT-FROM
        self.built()
        (self.dist / "couch-tv-ontv.apk").write_bytes(b"another on-TV APK")
        self.assertEqual(self.run_step("sums", "--previous", str(self.prev))[0], 0)
        self.calls.unlink()
        rc, out = self.publish()
        self.assertEqual(rc, 1, out)
        self.assertIn("SHA256SUMS.txt changed since build", out)
        self.assertEqual(self.pushes(), [])
        # a BUILT-FROM with only the commit (no sums line) stops too
        (self.dist / "BUILT-FROM").write_text(HEAD + "\n")
        rc, out = self.publish()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_on_a_badly_formed_version(self):
        self.built()
        for v in ("v0.13.9", "0.13.9-rc1", "0.13.9.1", "13", "0.13.x"):
            (self.r / f"RELEASE-NOTES-{v}.md").write_text("notes\n")
            rc, out = self.publish(version=v)
            self.assertEqual(rc, 2, f"{v}: {out}")
        self.assertEqual(self.log(), [])
        for v in ("0.13", "0.13.9", "1.0.10"):
            (self.r / f"RELEASE-NOTES-{v}.md").write_text("notes\n")
            self.assertEqual(self.publish(version=v)[0], 0, v)

    def test_publish_stops_when_the_tag_is_here(self):
        self.built()
        rc, out = self.publish(FAKE_LOCAL_TAG="1")
        self.assertEqual(rc, 1, out)
        self.assertIn("already exists here", out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_the_tag_is_on_github(self):
        self.built()
        rc, out = self.publish(FAKE_REMOTE_TAG="deadbeef\trefs/tags/v9.9.9\n")
        self.assertEqual(rc, 1, out)
        self.assertIn("already on origin", out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_gh_is_not_signed_in(self):
        self.built()
        rc, out = self.publish(FAKE_GH_AUTH="1")
        self.assertEqual(rc, 1, out)
        self.assertIn("gh is not signed in", out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_dist_is_from_another_commit(self):
        self.built(head="f" * 40)
        rc, out = self.publish()
        self.assertEqual(rc, 1, out)
        self.assertIn("dist was not built from this commit: run build again", out)
        self.assertEqual(self.pushes(), [])
        (self.dist / "BUILT-FROM").unlink()
        rc, out = self.publish()
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_the_check_fails(self):
        self.built()
        rc, out = self.publish(STUB_RC="1")
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_when_a_file_changed_after_the_sums(self):
        self.built()
        (self.dist / "couch-tv-samsung-setup.zip").write_bytes(b"built again")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])
        self.assertFalse(any(l.startswith("check ") for l in self.log()))

    def test_publish_stops_on_four_line_sums(self):
        # what release-checksums.sh wrote before Samsung was added: 4 APK lines
        lines = [f"{hashlib.sha256((self.dist / n).read_bytes()).hexdigest()}  {n}" for n in FILES[:4]]
        (self.dist / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")
        (self.dist / "BUILT-FROM").write_text(HEAD + "\n")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertIn("6 lines", out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_on_six_lines_of_the_wrong_files(self):
        names = FILES[:5] + ["stray.apk"]
        lines = [f"{hashlib.sha256((self.dist / n).read_bytes()).hexdigest()}  {n}" for n in names]
        (self.dist / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n")
        (self.dist / "BUILT-FROM").write_text(HEAD + "\n")
        rc, out = self.publish()
        self.assertEqual(rc, 5, out)
        self.assertEqual(self.pushes(), [])

    def test_publish_stops_with_uncommitted_or_untracked_files(self):
        self.built()
        for status in (" M scripts/release.sh", "?? new-file.txt"):
            rc, out = self.publish(FAKE_STATUS=status)
            self.assertEqual(rc, 1, f"{status}: {out}")
        self.assertEqual(self.pushes(), [])
        self.assertFalse(any("--untracked-files" in l for l in self.log()))

    def test_publish_refuses_the_debug_key_alone_from_0_13_11(self):
        # 0.13.10 was the last debug-key-only release: ONTV_SIGN=0 stops publish for 0.13.11 and later on couch-tv
        self.built()
        for v in ("0.13.11", "0.13.12", "0.14", "1.0.0"):
            (self.r / f"RELEASE-NOTES-{v}.md").write_text("notes\n")
            rc, out = self.publish(version=v, ONTV_SIGN="0")
            self.assertEqual(rc, 2, f"{v}: {out}")
            self.assertIn("ONTV_SIGN=0 is refused", out)
        self.assertEqual(self.log(), [])
        # also when only the git remote says couch-tv
        rc, out = self.publish(version="0.13.11", ONTV_SIGN="0", REPO="someone/couch-tv", FAKE_REMOTE_URL="https://github.com/Seagey/couch-tv")
        self.assertEqual(rc, 2, out)
        self.assertEqual(self.pushes(), [])
        # 0.13.10 itself, the rotated build (ONTV_SIGN unset or 1), and a fork's own release still go ahead
        (self.r / "RELEASE-NOTES-0.13.10.md").write_text("notes\n")
        self.assertEqual(self.publish(version="0.13.10", ONTV_SIGN="0")[0], 0)
        self.assertEqual(self.publish(version="0.13.11")[0], 0)
        self.assertEqual(self.publish(version="0.13.11", ONTV_SIGN="1")[0], 0)
        rc, out = self.publish(version="0.13.11", ONTV_SIGN="0", REPO="someone/couch-tv", FAKE_REMOTE_URL="https://github.com/someone/couch-tv")
        self.assertEqual(rc, 0, out)
        # build and sums are not publishing: a test build with the debug key alone still works
        rc, out = self.run_step("sums", "--previous", str(self.prev), "--version", "0.13.11", ONTV_SIGN="0")
        self.assertEqual(rc, 0, out)

    def test_publish_needs_a_version_and_notes(self):
        self.built()
        rc, out = self.run_step("publish", "--previous", str(self.prev))
        self.assertEqual(rc, 2, out)
        rc, out = self.run_step("publish", "--previous", str(self.prev), "--version", "9.9.8")
        self.assertEqual(rc, 1, out)
        self.assertIn("RELEASE-NOTES-9.9.8.md is missing", out)
        self.assertEqual(self.pushes(), [])


if __name__ == "__main__":
    unittest.main(verbosity=1)
