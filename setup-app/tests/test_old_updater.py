"""A release test for the future: the Helper updater that is ALREADY installed on people's computers must still be able
to update to this release.

An installed Helper runs the updater it shipped with, not the one in this tree. tests/fixtures/helper_update_v0_13_14.py is
that updater, byte for byte from tag v0.13.14 (git show v0.13.14:setup-app/couchtv_setup/helper/update.py). These tests run
its real apply() against archives laid out the way the workflow makes them (compat_names.py is the workflow's own step),
then run the swap script it wrote in a sandbox (Mac and Linux; the Windows .cmd is checked from its text, because it
cannot run here) and ask: after the swap, is the program the old updater starts there, does it start the NEW version, and
did the old version stay recoverable when something failed?

Nothing here touches the real Setup folder, the real login item or the network.

When a release changes the program's name, the archive layout or the updater, add the OLD updater from the previous
release's tag as another fixture and another round of these tests. A name that the oldest updater in the field cannot
start strands that user with no Helper.
"""
import hashlib
import importlib.util
import json
import os
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

import compat_names  # noqa: E402
import couchtv_setup.helper  # noqa: E402,F401

OLD, NEW = "couch-tv Setup", "Couch TV Setup"


def load_old(name="update_v0_13_14", fixture="helper_update_v0_13_14.py"):
    spec = importlib.util.spec_from_file_location("couchtv_setup.helper." + name, HERE / "fixtures" / fixture)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


old_update = load_old()
WORKFLOW = (HERE.parent.parent / ".github" / "workflows" / "setup-app.yml").read_text(encoding="utf-8")


def program(version, marker_dir):
    """A stand-in program: a shell script that records that it started, with its version and arguments."""
    return '#!/bin/sh\necho "%s $*" >> "%s/started"\n' % (version, marker_dir)


def write_exe(path, text):
    path.write_text(text, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def make_new_layout(root, system, compat=True, marker_dir=None):
    """What the workflow's Package step makes for this release, under `root`. Returns the single top item."""
    marker_dir = marker_dir or root
    if system == "darwin":
        top = root / (NEW + ".app")
        (top / "Contents" / "MacOS").mkdir(parents=True)
        write_exe(top / "Contents" / "MacOS" / NEW, program("new", marker_dir))
        (top / "Contents" / "Info.plist").write_bytes(plistlib.dumps(
            {"CFBundleExecutable": NEW, "CFBundleName": NEW, "CFBundleIdentifier": "app.couchtv.setup"}))
        if compat:
            compat_names.mac(top)
        return top
    top = root / NEW
    (top / "_internal").mkdir(parents=True)
    (top / "_internal" / "lib").write_text("x", encoding="utf-8")
    exe = top / (NEW + (".exe" if system == "win32" else ""))
    write_exe(exe, program("new", marker_dir))
    if compat:
        (compat_names.windows if system == "win32" else compat_names.linux)(top)
    return top


def make_old_install(apps, system, marker_dir):
    if system == "darwin":
        top = apps / (OLD + ".app")
        (top / "Contents" / "MacOS").mkdir(parents=True)
        write_exe(top / "Contents" / "MacOS" / OLD, program("old", marker_dir))
        (top / "Contents" / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": OLD}))
        return top, top / "Contents" / "MacOS" / OLD
    top = apps / OLD
    top.mkdir(parents=True)
    exe = top / (OLD + (".exe" if system == "win32" else ""))
    write_exe(exe, program("old", marker_dir))
    return top, exe


def archive_of(top, system, into):
    name = old_update.NAMES[{"darwin": "mac-apple-silicon", "win32": "windows", "linux": "linux"}[system]]
    path = into / name
    if name.endswith(".zip"):
        with zipfile.ZipFile(path, "w") as z:
            for p in sorted(top.rglob("*")):
                z.write(p, p.relative_to(top.parent).as_posix())
    else:
        with tarfile.open(path, "w:gz") as t:
            t.add(top, arcname=top.name)
    return path


class Sandbox:
    """One pretend computer: an installed old Helper, a staged update, and the real old apply() run against them."""

    def __init__(self, test, system, compat=True):
        self.system = system
        self.root = Path(tempfile.mkdtemp()).resolve()   # Windows gives a short name (RUNNER~1) that the updater resolves
        self.marks = self.root / "marks"
        self.marks.mkdir()
        self.apps = self.root / "apps"
        self.apps.mkdir()
        self.cache = self.root / "cache"
        self.cache.mkdir()
        self.old_top, self.old_exe = make_old_install(self.apps, system, self.marks)
        build = self.root / "build"
        build.mkdir()
        self.new_top = make_new_layout(build, system, compat, self.marks)
        arc = archive_of(self.new_top, system, self.cache)
        sha = hashlib.sha256(arc.read_bytes()).hexdigest()
        (self.cache / "pending.json").write_text(json.dumps({"tag": "v0.13.15", "archive": arc.name, "sha256": sha}))
        self.spawned = []
        patches = [mock.patch.object(old_update.sys, "frozen", True, create=True),
                   mock.patch.object(old_update.sys, "executable", str(self.old_exe)),
                   mock.patch.object(old_update.sys, "platform", system)]
        for p in patches:
            p.start()
            test.addCleanup(p.stop)
        # the 0.13.14 updater, unchanged, decides everything from here
        self.ok = old_update.apply(staging=str(self.cache), spawn=lambda *a, **k: self.spawned.append(a), system=system)

    @property
    def script(self):
        return self.cache / ("swap.cmd" if self.system == "win32" else "swap.sh")

    def text(self):
        return self.script.read_text(encoding="utf-8")

    def relaunch_target(self):
        """The program the old updater's script starts after the swap, as a path."""
        t = self.text()
        if self.system == "win32":
            m = re.findall(r'^start "" "([^"]+)" --helper', t, re.M)
            return Path(m[-1].replace("\\", "/"))
        if self.system == "darwin":
            m = re.findall(r"open -a '([^']+)' --args --helper", t)
            return Path(m[-1])
        m = re.findall(r"^'([^']+)' --helper &", t, re.M)
        return Path(m[-1])

    def run_unix(self, relaunch_old_too=False, before=None):
        """Runs the swap script as the old updater wrote it, but for a program that has already exited, and with a
        Mac's `open -a` replaced by running the app's own program (a test must not open a real app)."""
        t = self.text()
        t = re.sub(r"kill -0 \d+", "kill -0 99999999", t)
        if self.system == "darwin":
            # what `open -a` does: start the program the bundle's Info.plist names
            t = re.sub(r"open -a '([^']+)' --args --helper",
                       lambda m: "\"%s/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' '%s/Contents/Info.plist')\" --helper"
                       % (m.group(1), m.group(1)), t)
        s = self.root / "run.sh"
        s.write_text(t, encoding="utf-8")
        if before:
            before()
        p = subprocess.run(["/bin/sh", str(s)], timeout=30, capture_output=True)
        deadline = time.monotonic() + 10
        started = self.marks / "started"
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        time.sleep(0.3)
        return p.returncode

    def started(self):
        f = self.marks / "started"
        return f.read_text(encoding="utf-8").splitlines() if f.exists() else []


SYSTEMS = ("linux", "darwin", "win32")


class OldUpdaterStartsTheNewRelease(unittest.TestCase):
    @unittest.skipIf(sys.platform == "win32", "the swap script is a shell script")
    def test_linux_swap_starts_the_new_version(self):
        sb = Sandbox(self, "linux")
        self.assertTrue(sb.ok)
        self.assertEqual(sb.run_unix(), 0)
        self.assertEqual(sb.started(), ["new --helper"], "the old updater started the new version")
        self.assertTrue((sb.old_top / "_internal" / "lib").exists(), "the new copy is where the old one was")
        self.assertTrue((sb.cache / "previous" / OLD / OLD).exists(), "the old version is kept")

    @unittest.skipUnless(sys.platform == "darwin" and Path("/usr/bin/ditto").exists(), "needs a Mac for the .app unpack")
    def test_mac_swap_puts_a_runnable_app_at_the_old_path(self):
        sb = Sandbox(self, "darwin")
        self.assertTrue(sb.ok)
        self.assertEqual(sb.run_unix(), 0)
        self.assertEqual(sb.started(), ["new --helper"])
        info = plistlib.loads((sb.old_top / "Contents" / "Info.plist").read_bytes())
        self.assertEqual(info["CFBundleDisplayName"], NEW)
        self.assertTrue((sb.old_top / "Contents" / "MacOS" / info["CFBundleExecutable"]).is_file())
        self.assertTrue((sb.old_top / "Contents" / "Resources" / "en.lproj" / "InfoPlist.strings").is_file())
        self.assertTrue((sb.cache / "previous" / (OLD + ".app")).is_dir(), "the old app is kept")

    def test_windows_script_starts_a_program_the_new_folder_has(self):
        sb = Sandbox(self, "win32")
        self.assertTrue(sb.ok)
        target = sb.relaunch_target()
        self.assertEqual(target.name, OLD + ".exe", "the old updater starts the old file name")
        self.assertEqual(target.parent.name, OLD, "in the folder it moved the new copy to")
        # the new folder is what gets moved to that path, so the file must be in it
        self.assertTrue((sb.new_top / target.name).is_file(), "the new archive has that file")
        self.assertEqual((sb.new_top / target.name).read_bytes(), (sb.new_top / (NEW + ".exe")).read_bytes(),
                         "and it is the same program")

    def test_without_the_old_name_the_old_updater_starts_nothing(self):
        """The control: proves these tests can fail. Without compat_names the archive has no program the old updater starts."""
        for system in ("linux", "win32"):
            sb = Sandbox(self, system, compat=False)
            self.assertTrue(sb.ok)
            target = sb.relaunch_target()
            self.assertFalse((sb.new_top / target.name).exists(), system)

    def test_every_platform_the_old_updater_finds_exactly_one_item(self):
        for system in SYSTEMS:
            if system == "darwin" and not (sys.platform == "darwin" and Path("/usr/bin/ditto").exists()):
                continue
            sb = Sandbox(self, system)
            self.assertTrue(sb.ok, system)   # apply() returns False for anything but one folder or one .app


class RollbackWithTheOldUpdater(unittest.TestCase):
    """The old updater must never leave the computer with neither version."""

    @unittest.skipIf(sys.platform == "win32", "the swap script is a shell script")
    def test_a_failed_second_move_puts_the_old_version_back_and_starts_it(self):
        sb = Sandbox(self, "linux")
        self.assertTrue(sb.ok)
        # the staged copy vanishes between the two moves' preparation and the swap: the second move fails
        rc = sb.run_unix(before=lambda: shutil.rmtree(sb.cache / "new"))
        self.assertEqual(sb.started(), ["old --helper"], "the old version runs again")
        self.assertTrue((sb.old_top / OLD).is_file(), "and is back where it was")
        self.assertTrue(sb.old_top.exists())
        self.assertTrue(rc in (0, 1))

    @unittest.skipIf(sys.platform == "win32", "the swap script is a shell script")
    def test_at_every_step_one_version_is_on_disk(self):
        """Stops the script after each line and checks the old version or the new one can be found."""
        sb = Sandbox(self, "linux")
        lines = [l for l in sb.text().splitlines() if l.strip() and not l.startswith("#") and not l.startswith("while")]
        for cut in range(1, len(lines) + 1):
            sb2 = Sandbox(self, "linux")
            part = "\n".join(l for l in sb2.text().splitlines()
                             if not l.startswith("while"))
            body = part.splitlines()
            keep = [body[0]] + body[1:cut + 1] if cut < len(body) else body
            s = sb2.root / "cut.sh"
            s.write_text("\n".join(keep).replace("&\n", "\n"), encoding="utf-8")
            subprocess.run(["/bin/sh", str(s)], timeout=20, capture_output=True)
            on_disk = [p for p in (sb2.old_top, sb2.cache / "previous" / OLD, sb2.cache / "new" / NEW) if p.exists()]
            self.assertTrue(on_disk, "after line %d nothing is left" % cut)
            has_program = any((p / name).is_file() for p in on_disk for name in (OLD, NEW))
            self.assertTrue(has_program, "after line %d no program is left" % cut)

    def test_windows_script_restores_the_old_folder_when_a_move_fails(self):
        sb = Sandbox(self, "win32")
        t = sb.script.read_bytes().decode("utf-8").replace("/private/var/", "/var/")
        old, keep = str(sb.old_top).replace("/private/var/", "/var/"), str(sb.cache / "previous" / OLD).replace("/private/var/", "/var/")
        self.assertRegex(t, r"move .* \|\| goto restore")
        self.assertIn(':restore\r\nif not exist "%s" move "%s" "%s"' % (old, keep, old), t)
        self.assertTrue(t.rstrip().endswith("--helper"), "both ends of the script start a program")
        # the program started after a restore is the old one, and it is where the restore puts it
        last = re.findall(r'^start "" "([^"]+)" --helper', t, re.M)[-1].replace("\\", "/")
        self.assertEqual(Path(last).name, OLD + ".exe")


class CompatNames(unittest.TestCase):
    def test_windows_copy_is_the_same_program(self):
        d = Path(tempfile.mkdtemp())
        (d / (NEW + ".exe")).write_bytes(b"MZ-program")
        compat_names.windows(d)
        self.assertEqual((d / (OLD + ".exe")).read_bytes(), b"MZ-program")

    @unittest.skipIf(sys.platform == "win32", "sh")
    def test_linux_launcher_starts_the_real_program_with_its_arguments(self):
        d = Path(tempfile.mkdtemp())
        out = d / "out"
        write_exe(d / NEW, '#!/bin/sh\necho "$@" > "%s"\n' % out)
        compat_names.linux(d)
        subprocess.run([str(d / OLD), "--helper", "a b"], check=True, timeout=10)
        self.assertEqual(out.read_text().strip(), "--helper a b")
        subprocess.run([str(d / OLD)], check=True, timeout=10, cwd=tempfile.mkdtemp())   # from any folder

    def test_a_missing_program_is_an_error_not_a_silent_skip(self):
        d = Path(tempfile.mkdtemp())
        for fn in (compat_names.windows, compat_names.linux):
            with self.assertRaises(SystemExit):
                fn(d)

    def test_mac_names(self):
        d = Path(tempfile.mkdtemp()) / (NEW + ".app")
        (d / "Contents").mkdir(parents=True)
        (d / "Contents" / "Info.plist").write_bytes(plistlib.dumps({"CFBundleName": "x"}))
        compat_names.mac(d)
        info = plistlib.loads((d / "Contents" / "Info.plist").read_bytes())
        self.assertEqual((info["CFBundleName"], info["CFBundleDisplayName"], info["CFBundleLocalizations"]), (NEW, NEW, ["en"]))
        self.assertIn(NEW, (d / "Contents" / "Resources" / "en.lproj" / "InfoPlist.strings").read_text())

    def test_the_workflow_runs_it_for_every_computer_type(self):
        for kind in ("windows", "linux", "mac"):
            self.assertRegex(WORKFLOW, r"python compat_names\.py %s " % kind, kind)
        self.assertIn("python tests/smoke.py \"$PROGRAM_OLD\"", WORKFLOW, "the old name is started in the build too")
        # the zip and tar.gz names stay, because the old updater and the website look for them
        for n in ("couch-tv-Setup-${{ matrix.name }}.zip", "couch-tv-Setup-${{ matrix.name }}.tar.gz"):
            self.assertIn(n, WORKFLOW)


if __name__ == "__main__":
    unittest.main()
