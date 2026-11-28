"""N13b (28 Nov 2026): the Matter controller installed into the Helper's own folder on first use (couchtv_setup/mattersrv.py).
npm is pretended: a fake `run` writes what npm ci and npm install would write, so no registry is touched here.
(The real npm ci was run once on the MacBook; see coord/RESUME-p2-join.md.)"""
import json
import os
import stat
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()
from couchtv_setup import mattersrv as ms, nodejs, smarthome as sh  # noqa: E402
from couchtv_setup.helper import config as hconfig, control  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402

INTEGRITY = "sha512-AAAA"


def write_src(version="0.18.0", integrity=INTEGRITY):
    d = tempfile.mkdtemp()
    json.dump({"name": "couch-tv-matter", "dependencies": {"matter-server": "1.6.0"}}, open(os.path.join(d, "package.json"), "w"))
    json.dump({"packages": {"": {}, "node_modules/@matter/nodejs": {"version": version, "integrity": integrity, "optional": True}}},
              open(os.path.join(d, "package-lock.json"), "w"))
    return d


class FakeNpm:
    """Stands in for `node npm-cli.js ...` and `node bin.js --version`."""

    def __init__(self, fail_ci=None, fail_install=None, wrong_sum=False, crash_in=None):
        self.calls, self.envs = [], []
        self.fail_ci, self.fail_install, self.wrong_sum, self.crash_in = fail_ci, fail_install, wrong_sum, crash_in

    def __call__(self, cmd, env, cwd, timeout):
        self.calls.append(list(cmd))
        self.envs.append(dict(env))
        sub = cmd[2] if len(cmd) > 2 and cmd[1].endswith("npm-cli.js") else "run"
        if cmd[1].endswith("bin.js"):
            return 0, "1.6.0"
        stage = cmd[cmd.index("--prefix") + 1]
        nm = os.path.join(stage, "node_modules")
        if sub == "ci":
            if self.crash_in == "ci":
                os.makedirs(os.path.join(nm, "half"))
                raise KeyboardInterrupt()
            if self.fail_ci:
                os.makedirs(os.path.join(nm, "half"))
                return 1, self.fail_ci
            os.makedirs(os.path.join(nm, "matter-server", "dist", "esm"))
            open(os.path.join(nm, "matter-server", "dist", "esm", "bin.js"), "w").write("// pretend\n")
            json.dump({"version": "1.6.0"}, open(os.path.join(nm, "matter-server", "package.json"), "w"))
            json.dump({"packages": {}}, open(os.path.join(nm, ".package-lock.json"), "w"))
            return 0, ""
        if sub == "install":
            if self.fail_install:
                return 1, self.fail_install
            json.dump({"packages": {"node_modules/@matter/nodejs": {"version": "0.18.0", "integrity": "sha512-WRONG" if self.wrong_sum else INTEGRITY}}},
                      open(os.path.join(nm, ".package-lock.json"), "w"))
            return 0, ""
        return 1, "unknown"


class Base(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"COUCHTV_SETUP_HOME": self.home, "NPM_TOKEN": "secret-token-123", "npm_config_registry": "https://evil.example/"})
        self.env.start()
        self.src = write_src()
        self.runner = ("/fake/node", "/fake/npm-cli.js")
        self.said = []

    def tearDown(self):
        self.env.stop()

    def ensure(self, run, **kw):
        return ms.ensure(lambda f, m=None: self.said.append((f, m)), src=self.src, run=run, runner=self.runner, **kw)


class Install(Base):
    def test_first_use_installs_from_the_lock_with_no_scripts_into_the_helpers_folder(self):
        npm = FakeNpm()
        r = self.ensure(npm)
        self.assertEqual(r["how"], "installed")
        d = ms.service_dir()
        self.assertEqual(r["dir"], str(d))
        self.assertTrue(os.path.isfile(ms.entry_of(d)))
        self.assertTrue(str(d).startswith(os.path.join(self.home, "helper-data", "matter-service")))
        ci, ins, ver = npm.calls
        self.assertEqual(ci[:3], ["/fake/node", "/fake/npm-cli.js", "ci"])
        for c in (ci, ins):
            for flag in ("--ignore-scripts", "--omit=optional", "--omit=dev", "--no-audit", "--no-fund"):
                self.assertIn(flag, c)
        self.assertEqual(ins[2:4], ["install", "--prefix"])
        self.assertEqual(ins[-1], "@matter/nodejs@0.18.0")
        self.assertIn("--no-save", ins)
        self.assertEqual(ver[1], ms.entry_of(os.path.join(str(d.parent), "app.part")), "the staged copy was started once before it was moved")
        self.assertEqual(r["version"], "1.6.0")
        self.assertEqual(ms.for_bridge(), str(d))

    def test_modes_markers_and_no_leftovers(self):
        self.ensure(FakeNpm())
        r = ms.root()
        self.assertEqual(sorted(os.listdir(r)), ["app", "npmrc-empty", "npmrc-empty-global"], "no staging folder, no lock, no npm cache left")
        if os.name != "nt":  # folder modes are POSIX only; Windows reports 0o777
            self.assertEqual(oct(os.stat(r).st_mode & 0o777), "0o700")
            self.assertEqual(oct(os.stat(r.parent).st_mode & 0o777), "0o700")
        m = json.load(open(ms.service_dir() / ms.MARKER))
        self.assertEqual(m["version"], "1.6.0")
        self.assertEqual(len(m["lock"]), 64)
        self.assertTrue(os.path.isfile(ms.service_dir() / "package-lock.json"), "the lock file used is kept with it")

    def test_npm_ignores_the_persons_own_settings_and_sends_no_secret(self):
        npm = FakeNpm()
        self.ensure(npm)
        for env in npm.envs:
            self.assertNotIn("NPM_TOKEN", env)
            self.assertNotIn("npm_config_registry", env)
            self.assertNotEqual(env["npm_config_userconfig"], env["npm_config_globalconfig"], "npm refuses one file as both (found on the MacBook)")
            self.assertEqual(os.path.getsize(env["npm_config_globalconfig"]), 0)
            self.assertEqual(os.path.getsize(env["npm_config_userconfig"]), 0)
            self.assertTrue(env["npm_config_cache"].startswith(str(ms.root())))
            self.assertEqual(env["npm_config_ignore_scripts"], "true")

    def test_plain_progress_words(self):
        self.ensure(FakeNpm())
        words = [m for f, m in self.said if m]
        self.assertEqual(words[0], "Getting Matter ready, about 2 minutes, one time only")
        self.assertEqual(words[-1], "Matter is ready")
        self.assertTrue(all(b >= a for (a, _), (b, _) in zip(self.said, self.said[1:])), "progress never goes backwards")
        self.assertLessEqual(self.said[-1][0], 1.0)
        for w in words:
            self.assertNotRegex(w, r"npm|ci\b|--")

    def test_a_second_call_does_nothing(self):
        self.ensure(FakeNpm())
        npm = FakeNpm()
        r = self.ensure(npm)
        self.assertEqual((r["how"], npm.calls), ("already", []))
        self.assertEqual(r["version"], "1.6.0")

    def test_a_changed_lock_file_installs_again_and_swaps_whole(self):
        self.ensure(FakeNpm())
        before = ms.for_bridge()
        json.dump({"packages": {"node_modules/@matter/nodejs": {"version": "0.19.0", "integrity": INTEGRITY}}}, open(os.path.join(self.src, "package-lock.json"), "w"))
        self.assertEqual(ms.installed(self.src), (True, False))
        self.assertEqual(ms.for_bridge(), before, "the old one stays in use until the new one is whole")
        # the pretend npm writes @matter/nodejs 0.18.0 but the new lock wants 0.19.0: refused, and the old one stays
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm())
        self.assertEqual(c.exception.code, "matter_checksum")
        self.assertEqual(ms.for_bridge(), before)
        self.assertFalse(os.path.exists(ms.root() / "app.part"))

    def test_a_changed_lock_that_installs_cleanly_replaces_the_old_one(self):
        self.ensure(FakeNpm())
        json.dump({"packages": {"node_modules/@matter/nodejs": {"version": "0.18.0", "integrity": INTEGRITY}}, "x": 1}, open(os.path.join(self.src, "package-lock.json"), "w"))
        self.assertEqual(ms.installed(self.src), (True, False))
        r = self.ensure(FakeNpm())
        self.assertEqual(r["how"], "installed")
        self.assertEqual(ms.installed(self.src), (True, True))
        self.assertEqual(sorted(n for n in os.listdir(ms.root()) if n.startswith("app")), ["app"], "no app.old or app.part left")


class Trouble(Base):
    def test_offline_says_so_and_leaves_nothing_the_bridge_could_start(self):
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm(fail_ci="npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/x failed"))
        self.assertEqual(c.exception.code, "matter_offline")
        self.assertIn("online", str(c.exception))
        self.assertIsNone(ms.for_bridge())
        self.assertFalse(os.path.exists(ms.root() / "app.part"))
        self.assertFalse(os.path.exists(ms.root() / "app"))
        self.assertFalse(os.path.exists(ms.root() / "install.lock"), "the lock is let go")

    def test_after_offline_the_next_try_just_works(self):
        with self.assertRaises(TvError):
            self.ensure(FakeNpm(fail_ci="ETIMEDOUT"))
        self.assertEqual(self.ensure(FakeNpm())["how"], "installed")

    def test_other_failures_say_try_again_and_the_log_has_no_secrets(self):
        out = "npm error 401\n//registry.example.com/:_authToken=abc123SECRET\nAuthorization: Bearer xyz789SECRET\nnpm_" + "a" * 36 + "\n"
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm(fail_install=out))
        self.assertEqual(c.exception.code, "matter_install")
        for secret in ("abc123SECRET", "xyz789SECRET", "a" * 36):
            self.assertNotIn(secret, str(c.exception))
        log = open(ms.root() / "install.log").read()
        for secret in ("abc123SECRET", "xyz789SECRET", "a" * 36):
            self.assertNotIn(secret, log)
        self.assertIn("[hidden]", log)
        if os.name != "nt":  # file modes are POSIX only; Windows reports 0o666
            self.assertEqual(oct(os.stat(ms.root() / "install.log").st_mode & 0o777), "0o600")

    def test_an_install_stopped_half_way_is_redone_clean_and_only_in_helper_data(self):
        with self.assertRaises(KeyboardInterrupt):
            self.ensure(FakeNpm(crash_in="ci"))
        self.assertIsNone(ms.for_bridge())
        self.assertFalse(os.path.exists(ms.root() / "app.part"))
        # a crash that could not clean up (power cut): leftovers sit in the staging folder, and a link in it is never followed
        stage = ms.root() / "app.part"
        os.makedirs(stage / "node_modules" / "half")
        outside = tempfile.mkdtemp()
        open(os.path.join(outside, "keep.txt"), "w").write("mine")
        os.symlink(outside, stage / "node_modules" / "link")
        self.assertEqual(self.ensure(FakeNpm())["how"], "installed")
        self.assertTrue(os.path.isfile(os.path.join(outside, "keep.txt")), "nothing outside helper-data was touched")
        self.assertFalse(os.path.exists(ms.service_dir() / "node_modules" / "half"))

    def test_a_marker_less_app_folder_is_not_trusted(self):
        e = ms.entry_of(ms.service_dir())
        os.makedirs(os.path.dirname(e))
        open(e, "w").write("// half")
        self.assertIsNone(ms.for_bridge())
        npm = FakeNpm()
        self.assertEqual(self.ensure(npm)["how"], "installed")
        self.assertEqual(len(npm.calls), 3)
        self.assertTrue(os.path.isfile(ms.service_dir() / ms.MARKER))

    def test_wrong_checksum_for_the_package_installed_by_name_keeps_nothing(self):
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm(wrong_sum=True))
        self.assertEqual(c.exception.code, "matter_checksum")
        self.assertIsNone(ms.for_bridge())
        self.assertFalse(os.path.exists(ms.root() / "app.part"))

    def test_one_install_at_a_time_and_a_stale_lock_is_thrown_away(self):
        r = ms.root()
        os.makedirs(r)
        lock = r / "install.lock"
        lock.write_text("1")
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm())
        self.assertEqual(c.exception.code, "matter_busy_install")
        old = os.path.getmtime(lock) - 3600
        os.utime(lock, (old, old))
        self.assertEqual(self.ensure(FakeNpm())["how"], "installed")

    def test_no_lock_file_in_the_build_is_said_plainly(self):
        os.unlink(os.path.join(self.src, "package-lock.json"))
        with self.assertRaises(TvError) as c:
            self.ensure(FakeNpm())
        self.assertEqual(c.exception.code, "matter_nolock")

    def test_not_enough_space_is_said_before_anything_is_fetched(self):
        npm = FakeNpm()
        with mock.patch.object(ms, "_free_mb", return_value=100):
            with self.assertRaises(TvError) as c:
                self.ensure(npm)
        self.assertEqual((c.exception.code, npm.calls), ("matter_space", []))

    def test_removal_never_leaves_helper_datas_matter_folder(self):
        os.makedirs(ms.root())
        outside = tempfile.mkdtemp()
        with self.assertRaises(TvError):
            ms._remove(outside)
        self.assertTrue(os.path.isdir(outside))
        ms._remove(ms.root() / "does-not-exist")

    def test_a_program_that_cannot_run_is_a_plain_failure(self):
        r = ms.run_default(["/definitely/not/here"], {}, None, 5)
        self.assertEqual(r[0], -1)

    def test_the_checksum_is_found_when_npm_names_the_entry_by_a_roundabout_path(self):
        stage = tempfile.mkdtemp()
        os.makedirs(os.path.join(stage, "node_modules"))
        lock = os.path.join(self.src, "package-lock.json")
        json.dump({"packages": {"../../../private/x/app.part/node_modules/@matter/nodejs": {"version": "0.18.0", "integrity": INTEGRITY}}},
                  open(os.path.join(stage, "node_modules", ".package-lock.json"), "w"))
        self.assertEqual(ms._verify(stage, lock)[0], True)

    def test_scrub(self):
        self.assertNotIn("SECRET", ms.scrub("_authToken=SECRET and https://user:SECRET@host/x and Bearer SECRET"))


class Wiring(Base):
    def test_the_bridge_config_names_the_service_only_once_installed(self):
        cfg = hconfig.default()
        with mock.patch.object(nodejs, "for_bridge", return_value=None):
            self.assertNotIn("matter", hconfig.bridge_config({}, cfg))
            self.ensure(FakeNpm())
            self.assertEqual(hconfig.bridge_config({}, cfg)["matter"], {"service_dir": str(ms.service_dir())})

    def test_the_helper_restarts_the_bridge_once_when_the_service_appears(self):
        class Sup:
            killed = 0

            def _kill(self):
                Sup.killed += 1
        data = tempfile.mkdtemp()
        c = control.Controller(data=data, sup=Sup(), known={}, awake=mock.Mock())
        c.follow_node()
        self.assertEqual(Sup.killed, 0)
        self.ensure(FakeNpm())
        c.follow_node()
        c.follow_node()
        self.assertEqual(Sup.killed, 1)
        self.assertEqual(json.load(open(os.path.join(data, hconfig.BRIDGE_FILE)))["matter"]["service_dir"], str(ms.service_dir()))

    def test_setup_installs_matter_then_waits_for_the_restart(self):
        waited, said = [], []
        with mock.patch.object(sh, "node_ok", return_value=(True, "v24.0.0")), \
                mock.patch.object(ms, "ensure", side_effect=lambda p, *a, **k: (p(0.5, "Getting Matter ready, about 2 minutes, one time only") or {"how": "installed", "dir": "x", "version": "1"})), \
                mock.patch.object(sh, "_wait_matter_ready", side_effect=lambda *a, **k: waited.append(1)), \
                mock.patch("urllib.request.urlopen", side_effect=OSError("no helper")):
            with self.assertRaises(TvError) as c:
                sh.matter_add("12345678901", lambda f, m=None: said.append((f, m)))
        self.assertEqual((waited, c.exception.code), ([1], "matter_helper"))
        self.assertIn("Getting Matter ready, about 2 minutes, one time only", [m for f, m in said])

    def test_setup_does_not_wait_when_it_was_already_installed(self):
        waited = []
        with mock.patch.object(sh, "node_ok", return_value=(True, "v24.0.0")), \
                mock.patch.object(ms, "ensure", return_value={"how": "already", "dir": "x", "version": "1"}), \
                mock.patch.object(sh, "_wait_matter_ready", side_effect=lambda *a, **k: waited.append(1)), \
                mock.patch("urllib.request.urlopen", side_effect=OSError("no helper")):
            with self.assertRaises(TvError):
                sh.matter_add("12345678901")
        self.assertEqual(waited, [])

    def test_setup_stops_with_plain_words_when_matter_cannot_be_set_up(self):
        with mock.patch.object(sh, "node_ok", return_value=(True, "v24.0.0")), \
                mock.patch.object(ms, "ensure", side_effect=TvError("Could not reach the internet to get Matter.", "matter_offline")), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("must not call the Helper")):
            with self.assertRaises(TvError) as c:
                sh.matter_add("12345678901")
        self.assertEqual(c.exception.code, "matter_offline")


class Request(Base):
    """N13b: the code left by the bridge, and the Helper installing Matter and adding the device with it."""

    def leave(self, code="12345678901", at=None, **extra):
        p = ms.request_path()
        os.makedirs(p.parent, exist_ok=True)
        import time
        json.dump(dict({"code": code, "address": None, "at": at or int(time.time())}, **extra), open(p, "w"))
        return p

    def test_take_request_reads_and_deletes_and_checks(self):
        p = self.leave()
        self.assertEqual(ms.take_request(), {"code": "12345678901", "address": None})
        self.assertFalse(p.exists())
        self.assertIsNone(ms.take_request())
        self.leave(code="not a code")
        self.assertIsNone(ms.take_request())
        self.leave(at=1)
        self.assertIsNone(ms.take_request(), "an hour old: the code ran out")
        p = ms.request_path()
        p.write_text("{broken")
        self.assertIsNone(ms.take_request())
        self.assertFalse(p.exists())

    def test_child_env_names_the_request_file(self):
        from couchtv_setup.helper import bridge_proc
        env = bridge_proc.child_env("/c.json", "/d", 5400, base={})
        self.assertEqual(os.path.normpath(env["COUCH_MATTER_REQUEST"]), os.path.normpath(os.path.join("/d", "matter-install-request.json")))

    def run_job(self, installer_raises=None, node_usable=True):
        said, posts, waits = [], [], []
        c = control.Controller(data=tempfile.mkdtemp(), sup=None, known={}, awake=mock.Mock())
        npm = FakeNpm()
        real = ms.ensure

        def ensure(progress=lambda f, m=None: None, **kw):
            if installer_raises:
                raise installer_raises
            return real(progress, src=self.src, run=npm, runner=self.runner)
        with mock.patch.object(ms, "ensure", side_effect=ensure), \
                mock.patch.object(nodejs, "usable", return_value=("/fake/node", "computer") if node_usable else None), \
                mock.patch.object(nodejs, "ensure", side_effect=lambda *a, **k: said.append("node fetched")), \
                mock.patch.object(c, "follow_node", side_effect=lambda: said.append("bridge restarted")), \
                mock.patch.object(sh, "_wait_matter_ready", side_effect=lambda *a, **k: waits.append(1)), \
                mock.patch.object(sh, "commission_post", side_effect=lambda base, hdr, code, address=None: posts.append((base, code, address)) or {"ok": True}):
            c._matter_busy = True
            c._matter_job()
        return c, said, posts, waits, npm

    def test_the_helper_installs_restarts_and_adds_the_device_with_the_kept_code(self):
        self.leave()
        c, said, posts, waits, npm = self.run_job()
        self.assertEqual(len(npm.calls), 3)
        self.assertEqual(said, ["bridge restarted"])
        self.assertEqual(waits, [1])
        self.assertEqual([(b, code, a) for b, code, a in posts], [("http://127.0.0.1:%d" % c.cfg["port"], "12345678901", None)])
        self.assertFalse(ms.request_path().exists(), "the code is not kept")
        self.assertEqual((c._matter_busy, c.matter_words), (False, ""))
        self.assertIsNotNone(ms.for_bridge())

    def test_it_fetches_node_first_when_the_computer_has_none(self):
        self.leave()
        c, said, posts, waits, npm = self.run_job(node_usable=False)
        self.assertEqual(said[0], "node fetched")
        self.assertEqual(len(posts), 1)

    def test_a_failure_is_said_in_plain_words_the_code_is_gone_and_nothing_is_sent(self):
        self.leave()
        c, said, posts, waits, npm = self.run_job(installer_raises=TvError("Could not reach the internet to get Matter.", "matter_offline"))
        self.assertEqual(posts, [])
        self.assertEqual(c.matter_words, "Could not reach the internet to get Matter.")
        self.assertNotIn("12345678901", c.matter_words)
        self.assertFalse(ms.request_path().exists())
        c.sup = mock.Mock(alive=lambda: False, paused=False)
        self.assertEqual(c.state()["matter"], c.matter_words)

    def test_an_unexpected_error_does_not_leak_and_frees_the_job(self):
        self.leave()
        c, said, posts, waits, npm = self.run_job(installer_raises=RuntimeError("boom 12345678901"))
        self.assertNotIn("12345678901", c.matter_words)
        self.assertFalse(c._matter_busy)

    def test_the_tick_starts_one_job_only_when_a_request_is_waiting(self):
        c = control.Controller(data=tempfile.mkdtemp(), sup=None, known={}, awake=mock.Mock())
        started = []
        with mock.patch("threading.Thread", side_effect=lambda **k: started.append(k) or mock.Mock()):
            c.follow_matter_request()
            self.assertEqual(started, [], "no request, no job")
            self.leave()
            c.follow_matter_request()
            c.follow_matter_request()
        self.assertEqual(len(started), 1, "one at a time")

    def test_words_shown_while_it_works(self):
        self.leave()
        c = control.Controller(data=tempfile.mkdtemp(), sup=None, known={}, awake=mock.Mock())
        seen = []
        orig = ms.ensure
        with mock.patch.object(ms, "ensure", side_effect=lambda say, **k: (seen.append(c.matter_words), orig(say, src=self.src, run=FakeNpm(), runner=self.runner))[1]), \
                mock.patch.object(nodejs, "usable", return_value=("/fake/node", "computer")), \
                mock.patch.object(c, "follow_node"), mock.patch.object(sh, "_wait_matter_ready"), \
                mock.patch.object(sh, "commission_post", return_value={"ok": True}):
            c._matter_busy = True
            c._matter_job()
        self.assertEqual(seen, ["Getting Matter ready, about 2 minutes, one time only"])


if __name__ == "__main__":
    unittest.main()
