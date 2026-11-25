"""Couch TV Helper phase 2: signed updates, keep awake on power, remove everything. No network, no real power state."""
import base64
import hashlib
import io
import shutil
import json
import os
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import zipfile
from unittest import mock
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ed25519  # noqa: E402

from couchtv_setup import release  # noqa: E402
from test_helper import FakeReg  # noqa: E402
from couchtv_setup.helper import keepawake, remove, update  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402


def keypair():
    k = ed25519.Ed25519PrivateKey.generate()
    pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    return k, pub


class Signature(unittest.TestCase):
    def test_signature_checks(self):
        k, pub = keypair()
        msg = b"abc  couch-tv-Setup-linux.tar.gz\n"
        sig = k.sign(msg)
        self.assertTrue(update.verify_signature(msg, sig, pub))
        self.assertTrue(update.verify_signature(msg, base64.b64encode(sig) + b"\n", pub))
        self.assertFalse(update.verify_signature(msg + b"x", sig, pub))
        self.assertFalse(update.verify_signature(msg, b"junk", pub))
        self.assertFalse(update.verify_signature(msg, sig, keypair()[1]))

    def test_the_embedded_public_key_is_a_real_ed25519_key(self):
        self.assertEqual(len(base64.b64decode(update.PUBLIC_KEY_B64)), 32)

    def test_versions(self):
        self.assertTrue(update.newer("v0.13.14", "0.13.13"))
        self.assertFalse(update.newer("0.13.13", "0.13.13"))
        self.assertFalse(update.newer("garbage", "0.13.13"))
        self.assertTrue(update.newer("0.14.0", "0.13.99"))

    def test_flavours(self):
        self.assertEqual(update.flavour("darwin", "arm64"), "mac-apple-silicon")
        self.assertEqual(update.flavour("darwin", "x86_64"), "mac-intel")
        self.assertEqual(update.flavour("win32", "AMD64"), "windows")
        self.assertEqual(update.flavour("linux", "x86_64"), "linux")


class Stage(unittest.TestCase):
    def setUp(self):
        self.key, self.pub = keypair()
        self.archive = b"not really a tar"
        self.sha = hashlib.sha256(self.archive).hexdigest()
        self.sums = ("%s  couch-tv-Setup-linux.tar.gz\n" % self.sha).encode()
        self.rel = {"tag_name": "v0.13.99", "assets": [
            {"name": "couch-tv-Setup-linux.tar.gz", "size": len(self.archive), "digest": "sha256:" + self.sha,
             "browser_download_url": "https://github.com/Seagey/couch-tv/releases/download/x/a"}]}
        self.real_open, self.real_pub = release._open, update.PUBLIC_KEY_B64
        update.PUBLIC_KEY_B64 = self.pub
        update.verify_signature.__defaults__ = (self.pub,)
        release._open = lambda url, timeout=30: io.BytesIO(self.archive)

    def tearDown(self):
        release._open, update.PUBLIC_KEY_B64 = self.real_open, self.real_pub
        update.verify_signature.__defaults__ = (self.real_pub,)

    def fetch(self, sums=None, sig=None):
        s = sums if sums is not None else self.sums
        sg = sig if sig is not None else self.key.sign(update.signed_message("v0.13.99", s))
        return lambda rel, name, limit=0: s if name == update.SUMS else sg

    def test_good_update_is_staged(self):
        d = tempfile.mkdtemp()
        path = update.stage(self.rel, system="linux", staging=d, fetch=self.fetch())
        self.assertEqual(path.read_bytes(), self.archive)
        self.assertEqual(json.loads(Path(d, "pending.json").read_text())["tag"], "v0.13.99")

    def test_unsigned_or_wrongly_signed_sums_are_refused(self):
        d = tempfile.mkdtemp()
        other = ed25519.Ed25519PrivateKey.generate().sign(update.signed_message("v0.13.99", self.sums))
        with self.assertRaises(TvError) as c:
            update.stage(self.rel, system="linux", staging=d, fetch=self.fetch(sig=other))
        self.assertEqual(c.exception.code, "bad_signature")
        self.assertFalse(Path(d, "couch-tv-Setup-linux.tar.gz").exists())

    def test_a_signature_made_for_another_release_is_refused(self):
        d = tempfile.mkdtemp()
        old = self.key.sign(update.signed_message("v0.13.14", self.sums))   # a real signature, but for 0.13.14
        with self.assertRaises(TvError) as c:
            update.stage(self.rel, system="linux", staging=d, fetch=self.fetch(sig=old))   # served as v0.13.99
        self.assertEqual(c.exception.code, "bad_signature")
        bare = self.key.sign(self.sums)   # the sums file alone, as before the tag was signed
        with self.assertRaises(TvError):
            update.stage(self.rel, system="linux", staging=d, fetch=self.fetch(sig=bare))

    def test_a_download_longer_than_the_release_says_is_stopped(self):
        d = tempfile.mkdtemp()
        release._open = lambda url, timeout=30: io.BytesIO(self.archive + b"x" * 5000)
        with self.assertRaises(TvError):
            update.stage(self.rel, system="linux", staging=d, fetch=self.fetch())
        self.assertEqual(list(Path(d).glob("*.part")), [])

    def test_a_download_has_a_hard_ceiling_even_with_no_size_in_the_release(self):
        d = tempfile.mkdtemp()
        rel = json.loads(json.dumps(self.rel))
        del rel["assets"][0]["size"]
        real = update.MAX_DOWNLOAD
        update.MAX_DOWNLOAD = 1000
        try:
            release._open = lambda url, timeout=30: io.BytesIO(b"x" * 600000)
            with self.assertRaises(TvError) as c:
                update.stage(rel, system="linux", staging=d, fetch=self.fetch())
        finally:
            update.MAX_DOWNLOAD = real
        self.assertEqual(c.exception.code, "offline")
        self.assertEqual(list(Path(d).glob("*.part")), [])

    def test_a_changed_archive_is_deleted(self):
        d = tempfile.mkdtemp()
        release._open = lambda url, timeout=30: io.BytesIO(b"x" * len(self.archive))
        with self.assertRaises(TvError) as c:
            update.stage(self.rel, system="linux", staging=d, fetch=self.fetch())
        self.assertEqual(c.exception.code, "checksum")
        self.assertEqual(list(Path(d).iterdir()), [])

    def test_signed_sums_without_this_file_are_refused(self):
        sums = ("%s  something-else.zip\n" % self.sha).encode()
        with self.assertRaises(TvError):
            update.stage(self.rel, system="linux", staging=tempfile.mkdtemp(), fetch=self.fetch(sums=sums))


class Unpack(unittest.TestCase):
    def test_zip_slip_is_refused(self):
        d = tempfile.mkdtemp()
        z = os.path.join(d, "a.zip")
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("../evil.txt", "x")
        with self.assertRaises(TvError):
            update.unpack(z, os.path.join(d, "out"))
        self.assertFalse(Path(d, "evil.txt").exists())

    def test_tar_links_and_escapes_are_refused(self):
        d = tempfile.mkdtemp()
        t = os.path.join(d, "a.tar.gz")
        with tarfile.open(t, "w:gz") as f:
            info = tarfile.TarInfo("app/link")
            info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
            f.addfile(info)
        with self.assertRaises(TvError):
            update.unpack(t, os.path.join(d, "out"))

    def _zip_with_link(self, d, target):
        z = os.path.join(d, "l.zip")
        with zipfile.ZipFile(z, "w") as f:
            info = zipfile.ZipInfo("app/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o755) << 16
            f.writestr(info, target)
            f.writestr("app/readme.txt", "hi")
        return z

    def test_zip_symlinks_that_point_outside_are_refused_before_unpacking(self):
        for target in ("/etc", "../../x", "a/../../../b", "C:\\Windows", "..", ""):
            d = tempfile.mkdtemp()
            z = self._zip_with_link(d, target)
            with mock.patch.object(update.subprocess, "run") as run:
                with self.assertRaises(TvError, msg=target):
                    update.unpack(z, os.path.join(d, "out"), "darwin")
                run.assert_not_called()
            self.assertEqual(list(Path(d, "out").iterdir()), [])

    def test_a_zip_symlink_that_climbs_but_stays_inside_is_allowed(self):
        # a Mac .app links Frameworks and Versions/Current with "..": the CI archive has them
        d = tempfile.mkdtemp()
        z = os.path.join(d, "l.zip")
        with zipfile.ZipFile(z, "w") as f:
            info = zipfile.ZipInfo("app/Contents/Frameworks/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o755) << 16
            f.writestr(info, "../Resources/lib")
            f.writestr("app/Contents/Resources/lib", "x")
        with mock.patch.object(update.subprocess, "run") as run:
            update.unpack(z, os.path.join(d, "out"), "darwin")
            self.assertEqual(run.call_args[0][0][:3], ["/usr/bin/ditto", "-x", "-k"])

    def test_a_zip_symlink_inside_the_app_is_allowed(self):
        d = tempfile.mkdtemp()
        z = self._zip_with_link(d, "readme.txt")
        with mock.patch.object(update.subprocess, "run") as run:
            update.unpack(z, os.path.join(d, "out"), "darwin")
            self.assertEqual(run.call_args[0][0][:3], ["/usr/bin/ditto", "-x", "-k"])

    def test_unpack_wants_a_fresh_empty_folder(self):
        d = tempfile.mkdtemp()
        z = os.path.join(d, "a.zip")
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("app/readme.txt", "hi")
        out = Path(d, "out")
        out.mkdir()
        (out / "left-behind").write_text("x")
        with self.assertRaises(TvError):
            update.unpack(z, out)

    def test_good_zip_unpacks(self):
        d = tempfile.mkdtemp()
        z = os.path.join(d, "a.zip")
        with zipfile.ZipFile(z, "w") as f:
            f.writestr("app/readme.txt", "hi")
        self.assertEqual([p.name for p in update.unpack(z, os.path.join(d, "out"))], ["app"])


class Swap(unittest.TestCase):
    @unittest.skipIf(sys.platform == "win32", "sh script")
    def test_swap_script_replaces_keeps_and_rolls_forward(self):
        d = Path(tempfile.mkdtemp())
        old, new, keep = d / "old", d / "new", d / "prev" / "old"
        old.mkdir(); new.mkdir(); keep.parent.mkdir()
        (old / "v").write_text("1"); (new / "v").write_text("2")
        script = d / "s.sh"
        script.write_text(update.swap_script(old, new, keep, 99999999, "true", "linux"))
        subprocess.run(["/bin/sh", str(script)], check=True, timeout=20)
        self.assertEqual((old / "v").read_text(), "2")
        self.assertEqual((keep / "v").read_text(), "1")

    @unittest.skipIf(sys.platform == "win32", "sh script")
    def test_a_failed_first_move_starts_the_old_app_again(self):
        d = Path(tempfile.mkdtemp())
        old, new = d / "old", d / "new"
        old.mkdir()
        new.mkdir()
        keep = d / "missing-folder" / "old"   # the parent is not there, so the first mv fails
        marker = d / "started"
        script = d / "s.sh"
        script.write_text(update.swap_script(old, new, keep, 99999999, "touch '%s'" % marker, "linux"))
        p = subprocess.run(["/bin/sh", str(script)], timeout=20)
        deadline = time.monotonic() + 10   # (other tests may stub time.sleep, so wait on the clock)
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(p.returncode, 1)
        self.assertTrue(marker.exists(), "the old app is started again")
        self.assertTrue(old.exists() and new.exists())

    def test_windows_script_escapes_percent_and_survives_non_ascii(self):
        old = "C:\\Users\\Jos\u00e9\\100%\\app"
        keep = "C:\\Users\\Jos\u00e9\\100%\\prev\\app"
        new = "C:\\Users\\Jos\u00e9\\100%\\new\\%TEMP%"
        s = update.swap_script(old, new, keep, 42, '"%s\\x.exe" --helper' % old, "win32")
        self.assertTrue(s.startswith("@echo off\r\nchcp 65001 >NUL\r\n"))
        self.assertIn("100%%\\app", s)
        self.assertIn("%%TEMP%%", s)
        self.assertNotIn("%", s.replace("%%", ""), "no single percent is left")
        self.assertIn(":restore", s)
        self.assertIn("|| goto restore", s)
        self.assertTrue(s.rstrip().splitlines()[-1].startswith('start ""'), "the old or the new app is started last")
        f = Path(tempfile.mkdtemp(), "swap.cmd")
        update.write_script(f, s)
        raw = f.read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\r\r\n", raw)
        self.assertIn("Jos\u00e9".encode("utf-8"), raw)
        self.assertEqual(raw.decode("utf-8"), s)

    def test_windows_script_text(self):
        s = update.swap_script("C:\\a", "C:\\n", "C:\\k", 42, '"C:\\a\\x.exe" --helper', "win32")
        self.assertIn("PID eq 42", s)
        self.assertIn("--helper", s)

    def test_nothing_staged_or_not_built_app(self):
        self.assertFalse(update.apply(staging=tempfile.mkdtemp()))
        d = tempfile.mkdtemp()
        Path(d, "pending.json").write_text(json.dumps({"archive": "a.zip"}))
        self.assertFalse(update.apply(staging=d))   # from source: nothing to replace


def shutil_copy(src, out):
    shutil.copytree(src, out)
    return list(Path(out).iterdir())


class RenameMigration(unittest.TestCase):
    """0.13.15 renamed the program from "couch-tv Setup" to "Couch TV Setup". An installed Helper that updates itself
    must end up running the new program, with its start with the computer entry and (Windows) link following."""

    @unittest.skipIf(sys.platform == "win32", "sh script")
    def test_swap_puts_the_new_copy_under_its_own_name_and_keeps_the_old(self):
        d = Path(tempfile.mkdtemp())
        old, new, keep, dest = d / "couch-tv Setup", d / "stage" / "Couch TV Setup", d / "prev" / "couch-tv Setup", d / "Couch TV Setup"
        old.mkdir(); new.mkdir(parents=True); keep.parent.mkdir()
        (old / "v").write_text("1"); (new / "v").write_text("2")
        marker = d / "started-new"
        script = d / "s.sh"
        script.write_text(update.swap_script(old, new, keep, 99999999, "touch '%s'" % marker, "linux", dest, "touch '%s'" % (d / "started-old")))
        subprocess.run(["/bin/sh", str(script)], check=True, timeout=20)
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual((dest / "v").read_text(), "2")
        self.assertEqual((keep / "v").read_text(), "1")
        self.assertFalse(old.exists(), "the old name is gone")
        self.assertTrue(marker.exists())
        self.assertFalse((d / "started-old").exists())

    @unittest.skipIf(sys.platform == "win32", "sh script")
    def test_a_failed_second_move_puts_the_old_one_back_and_starts_it(self):
        d = Path(tempfile.mkdtemp())
        old, new, keep, dest = d / "couch-tv Setup", d / "stage" / "Couch TV Setup", d / "prev" / "couch-tv Setup", d / "nowhere" / "Couch TV Setup"
        old.mkdir(); new.mkdir(parents=True); keep.parent.mkdir()
        (old / "v").write_text("1")
        script = d / "s.sh"
        script.write_text(update.swap_script(old, new, keep, 99999999, "touch '%s'" % (d / "started-new"), "linux", dest, "touch '%s'" % (d / "started-old")))
        p = subprocess.run(["/bin/sh", str(script)], timeout=20, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while not (d / "started-old").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertEqual(p.returncode, 1)
        self.assertEqual((old / "v").read_text(), "1", "the old app is back where it was")
        self.assertTrue((d / "started-old").exists())
        self.assertFalse((d / "started-new").exists())

    def stage(self, system, old_name, new_name, exists=False):
        d = Path(tempfile.mkdtemp())
        folder = d / "cache"
        (folder / "new-src" / new_name).mkdir(parents=True)
        (folder / "a.zip").write_bytes(b"x")
        (folder / "pending.json").write_text(json.dumps({"archive": "couch-tv-Setup-linux.tar.gz", "sha256": "0" * 64}))
        apps = d / "apps"
        (apps / old_name).mkdir(parents=True)
        if exists:
            (apps / new_name).mkdir()
        spawned = []
        from unittest import mock
        exe = apps / old_name / ("couch-tv Setup" + (".exe" if system == "win32" else ""))
        patches = [mock.patch.object(update, "app_location", lambda exe=None, system=None: apps / old_name),
                   mock.patch.object(update.release, "verify", lambda *a, **k: True),
                   mock.patch.object(update, "unpack", lambda archive, out, system=None: shutil_copy(folder / "new-src", out)),
                   mock.patch.object(update.sys, "executable", str(exe))]
        for m in patches:
            m.start()
            self.addCleanup(m.stop)
        ok = update.apply(staging=str(folder), spawn=lambda *a, **k: spawned.append(a), system=system)
        return ok, folder, apps, spawned

    def test_apply_starts_the_new_program_by_its_new_name(self):
        for system in ("linux", "win32"):
            ok, folder, apps, spawned = self.stage(system, "couch-tv Setup", "Couch TV Setup")
            self.assertTrue(ok, system)
            script = (folder / ("swap.cmd" if system == "win32" else "swap.sh")).read_text(encoding="utf-8")
            sep = os.sep   # the staged paths are made on this computer
            self.assertIn("Couch TV Setup" + sep + "Couch TV Setup" + (".exe" if system == "win32" else ""), script, system)
            self.assertIn("couch-tv Setup" + sep + "couch-tv Setup" + (".exe" if system == "win32" else ""), script, "the old one is what a failed swap starts")

    def test_apply_never_goes_over_something_already_called_the_new_name(self):
        ok, folder, apps, spawned = self.stage("linux", "couch-tv Setup", "Couch TV Setup", exists=True)
        self.assertFalse(ok)
        self.assertEqual(spawned, [])

    def test_same_name_still_updates_in_place(self):
        ok, folder, apps, spawned = self.stage("linux", "Couch TV Setup", "Couch TV Setup")
        self.assertTrue(ok)

    def test_login_item_follows_the_new_program(self):
        old = ["/Apps/couch-tv Setup.app/Contents/MacOS/couch-tv Setup", "--helper"]
        new = ["/Apps/Couch TV Setup.app/Contents/MacOS/Couch TV Setup", "--helper"]
        from couchtv_setup.helper import autostart
        for plat in ("darwin", "linux"):
            home = tempfile.mkdtemp()
            self.assertFalse(autostart.refresh(new, plat, home, frozen=True), "nothing switched on: nothing written")
            autostart.enable(old, plat, home)
            self.assertFalse(autostart.refresh(old, plat, home, frozen=True), "already right")
            self.assertTrue(autostart.refresh(new, plat, home, frozen=True))
            self.assertIn("Couch TV Setup", Path(autostart.file_path(plat, home)).read_text(errors="replace") if plat == "linux" else Path(autostart.file_path(plat, home)).read_bytes().decode("latin-1"))
            self.assertFalse(autostart.refresh(new, plat, home, frozen=True), "second time changes nothing")
        reg = FakeReg()
        autostart.enable(old, "win32", registry=reg)
        self.assertTrue(autostart.refresh(new, "win32", registry=reg, frozen=True))
        self.assertEqual(reg.values[autostart.RUN_VALUE], '"%s" "--helper"' % new[0])
        self.assertFalse(autostart.refresh(new, "win32", registry=reg, frozen=False), "a source run never rewrites it")

    def test_windows_link_is_registered_again_by_the_running_program(self):
        from couchtv_setup import linkin
        reg = FakeReg()
        keys = {}

        class W:
            HKEY_CURRENT_USER = 1
            REG_SZ = 1
            def CreateKey(self, root, path):
                keys.setdefault(path, {})
                outer = self
                class K:
                    def __enter__(s): return path
                    def __exit__(s, *a): return False
                return K()
            def SetValueEx(self, k, name, _r, _t, value): keys[k][name] = value
        from unittest import mock
        with mock.patch.object(linkin.sys, "platform", "win32"), mock.patch.object(linkin.sys, "frozen", True, create=True), \
                mock.patch.dict(sys.modules, {"winreg": W()}):
            self.assertTrue(linkin.register_windows("C:\\Apps\\Couch TV Setup\\Couch TV Setup.exe"))
        cmd = keys[r"Software\Classes\couchtv\shell\open\command"][""]
        self.assertIn("Couch TV Setup.exe", cmd)
        self.assertNotIn("couch-tv Setup", cmd)


class Awake(unittest.TestCase):
    def cfg(self, kind=None, **kw):
        return dict({"mode": "helper", "tvs": [{"ip": "192.0.2.20", "kind": kind}] if kind else []}, **kw)

    def test_wanted_only_with_samsung_lg_roku_on_power(self):
        for kind in ("samsung", "lg", "roku"):
            self.assertTrue(keepawake.wanted(self.cfg(kind), True))
        self.assertFalse(keepawake.wanted(self.cfg("samsung"), False))
        self.assertFalse(keepawake.wanted(self.cfg("samsung"), None))
        self.assertFalse(keepawake.wanted(self.cfg(None), True))      # Google TV only
        self.assertFalse(keepawake.wanted(self.cfg("lg", allow_sleep=True), True))
        self.assertFalse(keepawake.wanted(self.cfg("lg", mode="once"), True))

    def test_power_state(self):
        run = lambda out: (lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=out))
        self.assertTrue(keepawake.on_power("darwin", run("Now drawing from 'AC Power'\n")))
        self.assertFalse(keepawake.on_power("darwin", run("Now drawing from 'Battery Power'\n")))
        self.assertTrue(keepawake.on_power("win32", winstatus=lambda: 1))
        self.assertFalse(keepawake.on_power("win32", winstatus=lambda: 0))
        files = {"/s/AC/type": "Mains\n", "/s/AC/online": "0\n", "/s/BAT0/type": "Battery\n"}
        self.assertFalse(keepawake.on_power("linux", glob_=lambda p: [k for k in files if k.endswith("type")], read=lambda p: files[p]))
        files["/s/AC/online"] = "1\n"
        self.assertTrue(keepawake.on_power("linux", glob_=lambda p: [k for k in files if k.endswith("type")], read=lambda p: files[p]))
        self.assertTrue(keepawake.on_power("linux", glob_=lambda p: [], read=None))   # a desktop

    def test_assertion_is_taken_and_released(self):
        procs = []

        class P:
            terminated = False
            def terminate(self): self.terminated = True
        ka = keepawake.KeepAwake(popen=lambda cmd, **k: procs.append((cmd, P())) or procs[-1][1], system="darwin")
        self.assertTrue(ka.update(self.cfg("roku"), power=True))
        self.assertEqual(procs[0][0], ["caffeinate", "-i", "-s"])
        ka.update(self.cfg("roku"), power=True)
        self.assertEqual(len(procs), 1)
        self.assertFalse(ka.update(self.cfg("roku"), power=False))
        self.assertTrue(procs[0][1].terminated)

    def test_linux_command(self):
        self.assertEqual(keepawake.command("linux")[0], "systemd-inhibit")


class Remove(unittest.TestCase):
    def test_removes_files_and_folders_and_the_login_item(self):
        data = tempfile.mkdtemp()
        cache = Path(data, "cache")
        cache.mkdir()
        os.environ["COUCHTV_SETUP_HOME"] = data   # Setup's own folder and its cache folder
        Path(data, "helper.json").write_text("{}")
        Path(data, "adbkey").write_text("k")
        Path(data, "helper-data").mkdir()
        Path(data, "helper-data", "token").write_text("t")
        Path(cache, "apk").write_text("a")
        Path(cache, ".couchtv-setup").write_text("")
        stopped = []
        gone = remove.everything(data, cache, disable=lambda: True, stop=lambda: stopped.append(1))
        self.assertEqual(stopped, [1])
        self.assertEqual(list(Path(data).iterdir()), [])   # the cache folder inside it goes too
        self.assertIn("start with this computer", gone)
        self.assertIn("helper-data", gone)

    def test_refuses_a_folder_that_is_not_setups_own(self):
        os.environ.pop("COUCHTV_SETUP_HOME")
        try:
            d = Path(tempfile.mkdtemp(), "Documents")
            d.mkdir()
            (d / "mine.txt").write_text("keep")
            remove.everything(d, d, disable=lambda: False)
            self.assertTrue((d / "mine.txt").exists())
        finally:
            os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

    def test_refuses_the_home_folder_and_a_link_even_with_the_home_variable_set(self):
        home = Path(tempfile.mkdtemp())
        (home / "mine.txt").write_text("keep")
        os.environ["COUCHTV_SETUP_HOME"] = str(home)
        remove.everything(home, home, disable=lambda: False)   # a folder holding none of Setup's files
        self.assertTrue((home / "mine.txt").exists())
        target = Path(tempfile.mkdtemp())
        (target / "mine.txt").write_text("keep")
        link = Path(tempfile.mkdtemp(), "couch-tv Setup")
        link.symlink_to(target)
        remove.everything(link, link, disable=lambda: False)
        self.assertTrue((target / "mine.txt").exists())

    def test_a_cache_folder_without_a_marker_is_left_alone(self):
        home = Path(tempfile.mkdtemp())
        (home / "helper.json").write_text("{}")
        cache = home / "cache"
        cache.mkdir()
        (cache / "mine.txt").write_text("keep")
        os.environ["COUCHTV_SETUP_HOME"] = str(home)
        self.assertFalse(remove._own_folder(cache))
        remove.everything(cache, cache, disable=lambda: False)
        self.assertTrue((cache / "mine.txt").exists())
        (cache / "helper-update").mkdir()   # the helper's own folder is a marker too
        self.assertTrue(remove._own_folder(cache))

    def test_paths_cache_leaves_the_marker(self):
        os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()
        from couchtv_setup import paths
        self.assertTrue((paths.cache() / ".couchtv-setup").exists())
        self.assertTrue(remove._own_folder(paths.cache()))

    def test_words(self):
        self.assertLessEqual(len(remove.FORGET.split(".")[0].split()), 14)


class ControllerPhase2(unittest.TestCase):
    def make(self, check, stage=None, apply=None, kind="roku"):
        from couchtv_setup.helper import config as hconfig, control
        d = tempfile.mkdtemp()
        hconfig.turn_on(False, d)
        hconfig.add_tv("192.0.2.20", kind, "TV", d)
        held = []

        class Awake:
            def update(self, cfg): held.append(("update", cfg["allow_sleep"]))
            def release(self): held.append("release")
        updater = type("U", (), {"check": staticmethod(check), "stage": staticmethod(stage or (lambda r: None)),
                                 "apply": staticmethod(apply or (lambda: True))})
        ctl = control.Controller(d, None, {}, awake=Awake(), updater=updater, knock=lambda *a, **k: True)
        ctl.sup = type("S", (), {"alive": lambda s: True, "paused": False, "stop": lambda s: None})()
        return ctl, held

    def test_update_flow(self):
        ctl, _ = self.make(lambda: {"state": "available", "tag": "v9.9.9", "release": {}})
        ctl.check_updates()
        self.assertEqual(ctl.update_state, {"state": "ready", "version": "9.9.9"})
        self.assertTrue([i for i in ctl.items() if i["id"] == "update"][0]["enabled"])
        ctl.act("update")
        self.assertTrue(ctl.quit_event.is_set())

    def test_update_failures_never_raise(self):
        def boom(r):
            raise TvError("bad", "bad_signature")
        ctl, _ = self.make(lambda: {"state": "available", "tag": "v9.9.9", "release": {}}, stage=boom)
        ctl.check_updates()
        self.assertEqual(ctl.update_state["state"], "error")
        ctl.act("update")
        self.assertFalse(ctl.quit_event.is_set())
        ctl2, _ = self.make(lambda: {"state": "error"})
        ctl2.check_updates()
        self.assertEqual(ctl2.update_state["state"], "error")

    def test_updates_off_means_no_check(self):
        called = []
        ctl, _ = self.make(lambda: called.append(1) or {"state": "error"})
        ctl.cfg["updates"] = False
        ctl.check_updates()
        self.assertEqual(called, [])

    def test_sleep_toggle_and_tick(self):
        ctl, held = self.make(lambda: {"state": "up_to_date"})
        ctl.tick()
        ctl.act("sleep")
        self.assertTrue(ctl.cfg["allow_sleep"])
        self.assertEqual(held, [("update", False), ("update", True)])
        self.assertIn("Let this computer sleep", [i["label"] for i in ctl.items() if i["id"] == "sleep"])

    def test_remove_everything_from_the_menu(self):
        ctl, held = self.make(lambda: {"state": "up_to_date"})
        Path(os.environ["COUCHTV_SETUP_HOME"], "helper.json").write_text("{}")
        ctl.act("remove")
        self.assertEqual([p.name for p in Path(os.environ["COUCHTV_SETUP_HOME"]).iterdir() if p.is_file()], [])
        self.assertTrue(ctl.quit_event.is_set())
        self.assertIn("release", held)


if __name__ == "__main__":
    unittest.main()
