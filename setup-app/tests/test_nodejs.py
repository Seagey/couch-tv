"""N13 (28 Nov 2026): Node.js for Matter on the Helper's bridge, fetched once into the Helper's own folder (couchtv_setup/nodejs.py).
A pretend nodejs.org on this computer serves a small archive with a script standing in for node; nothing real is downloaded here.
(The real release was fetched and checked once by hand; see coord/RESUME-p2-join.md.)"""
import hashlib
import io
import json
import os
import stat
import sys
import tarfile
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()
from couchtv_setup import nodejs, smarthome as sh  # noqa: E402
from couchtv_setup.helper import config as hconfig, control  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402

V = nodejs.NODE_VERSION
FAKE_NODE = ("#!/bin/sh\necho v%s\n" % V).encode()
FAKE_OLD = b"#!/bin/sh\necho v20.1.0\n"


def tgz(name, payload, extra=()):
    base = name[:-len(".tar.gz")]
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode="w:gz") as t:
        for member, data in [(base + "/bin/node", payload)] + list(extra):
            i = tarfile.TarInfo(member)
            i.size = len(data)
            i.mode = 0o755
            t.addfile(i, io.BytesIO(data))
    return b.getvalue()


class Dist(BaseHTTPRequestHandler):
    files = {}
    hits = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        Dist.hits.append(self.path)
        raw = Dist.files.get(self.path)
        if raw is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def serve(files, key="linux-x64", payload=FAKE_NODE, pin=True, sums_ok=True):
    """A pretend dist folder for one platform key, and the module's pin pointed at it."""
    name = nodejs.PINNED[key][0]
    data = tgz(name, payload)
    h = hashlib.sha256(data).hexdigest()
    sums = ("%s  %s\n" % (h if sums_ok else "0" * 64, name)).encode()
    Dist.files = {"/v%s/%s" % (V, name): data, "/v%s/SHASUMS256.txt" % V: sums}
    Dist.hits = []
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Dist)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pins = dict(nodejs.PINNED, **{key: (name, h if pin else "1" * 64)})
    return srv, "http://127.0.0.1:%d" % srv.server_address[1], pins


class Pins(unittest.TestCase):
    def test_pins_are_nodejs_orgs_own_for_the_exact_version(self):
        self.assertEqual(V, "22.23.5")
        for key, (name, h) in nodejs.PINNED.items():
            self.assertTrue(name.startswith("node-v%s-%s." % (V, key)), name)
            self.assertRegex(h, r"^[0-9a-f]{64}$")
        self.assertEqual(nodejs.PINNED["darwin-arm64"][1], "e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d")
        self.assertEqual(nodejs.PINNED["win-x64"][1], "4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3")
        self.assertTrue(nodejs.NODE_MIN <= tuple(int(x) for x in V.split("."))[:2])

    def test_platform_keys(self):
        self.assertEqual(nodejs.platform_key("darwin", "arm64"), "darwin-arm64")
        self.assertEqual(nodejs.platform_key("darwin", "x86_64"), "darwin-x64")
        self.assertEqual(nodejs.platform_key("win32", "AMD64"), "win-x64")
        self.assertEqual(nodejs.platform_key("linux", "aarch64"), "linux-arm64")
        self.assertIsNone(nodejs.platform_key("freebsd", "x86_64"))
        self.assertIsNone(nodejs.platform_key("linux", "armv7l"))


@unittest.skipIf(sys.platform == "win32", "the pretend node is a shell script")
class Fetch(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"COUCHTV_SETUP_HOME": self.home})
        self.env.start()
        self.nosys = mock.patch.object(nodejs, "system_node", return_value=None)
        self.nosys.start()

    def tearDown(self):
        self.nosys.stop()
        self.env.stop()

    def run_ensure(self, key="linux-x64", **kw):
        srv, base, pins = serve(**dict({"files": None, "key": key}, **kw))
        try:
            with mock.patch.dict(nodejs.PINNED, pins):
                return nodejs.ensure(dist=base, key=key)
        finally:
            srv.shutdown()

    def test_fetches_checks_and_keeps_it_in_the_helpers_own_folder(self):
        said = []
        srv, base, pins = serve(None)
        try:
            with mock.patch.dict(nodejs.PINNED, pins):
                r = nodejs.ensure(lambda f, m=None: said.append((f, m)), dist=base, key="linux-x64")
        finally:
            srv.shutdown()
        self.assertEqual(r["how"], "downloaded")
        self.assertEqual(r["version"], V)
        dest = os.path.join(self.home, "helper-data", "node", "v" + V, "node")
        self.assertEqual(r["path"], dest)
        self.assertEqual(oct(os.stat(dest).st_mode & 0o777), "0o700")
        self.assertEqual(sorted(os.listdir(os.path.dirname(dest))), ["node"], "no leftovers")
        self.assertIn("about 57 MB", " ".join(m for f, m in said if m))
        self.assertEqual(Dist.hits, ["/v%s/SHASUMS256.txt" % V, "/v%s/node-v%s-linux-x64.tar.gz" % (V, V)])
        self.assertEqual(str(nodejs.helper_node("linux-x64")), dest)

    def test_a_second_ask_downloads_nothing(self):
        self.run_ensure()
        again = self.run_ensure()
        self.assertEqual(again["how"], "helper")
        self.assertEqual(Dist.hits, [], "the pretend nodejs.org was not asked again")

    def test_the_computers_own_node_comes_first(self):
        self.nosys.stop()
        with mock.patch.object(nodejs, "system_node", return_value=("/usr/local/bin/node", (24, 1, 0))), \
                mock.patch.object(nodejs, "version_of", return_value=(24, 1, 0)):
            r = nodejs.ensure(dist="http://127.0.0.1:1")
        self.assertEqual((r["how"], r["path"]), ("computer", "/usr/local/bin/node"))
        self.nosys.start()

    def test_a_download_that_is_not_the_pinned_file_is_thrown_away(self):
        with self.assertRaises(TvError) as c:
            self.run_ensure(pin=False)
        self.assertEqual(c.exception.code, "node_checksum")
        self.assertIsNone(nodejs.helper_node("linux-x64"))
        self.assertFalse(os.path.exists(os.path.join(self.home, "helper-data", "node", "v" + V)), "nothing was made")

    def test_nodejs_orgs_own_list_must_agree_too(self):
        with self.assertRaises(TvError) as c:
            self.run_ensure(sums_ok=False)
        self.assertEqual(c.exception.code, "node_checksum")
        self.assertIsNone(nodejs.helper_node("linux-x64"))

    def test_a_program_that_will_not_say_the_pinned_version_is_not_kept(self):
        with self.assertRaises(TvError) as c:
            self.run_ensure(payload=FAKE_OLD)
        self.assertEqual(c.exception.code, "node_run")
        self.assertIsNone(nodejs.helper_node("linux-x64"))
        d = os.path.join(self.home, "helper-data", "node", "v" + V)
        self.assertEqual(os.listdir(d) if os.path.isdir(d) else [], [])

    def test_too_big_is_refused(self):
        with mock.patch.object(nodejs, "MAX_BYTES", 100):
            with self.assertRaises(TvError) as c:
                self.run_ensure()
        self.assertEqual(c.exception.code, "node_big")

    def test_offline_says_so_in_plain_words(self):
        with mock.patch.dict(nodejs.PINNED):
            with self.assertRaises(TvError) as c:
                nodejs.ensure(dist="http://127.0.0.1:1", key="linux-x64")
        self.assertEqual(c.exception.code, "node_download")
        self.assertIn("online", str(c.exception))

    def test_an_unknown_computer_type_is_told_to_use_nodejs_org(self):
        with mock.patch.object(nodejs, "platform_key", return_value=None):
            with self.assertRaises(TvError) as c:
                nodejs.ensure()
        self.assertEqual(c.exception.code, "node_platform")

    def test_the_real_host_is_the_only_one_allowed(self):
        self.assertTrue(nodejs.DIST.startswith("https://nodejs.org/"))

    def test_only_the_one_member_is_read(self):
        name = nodejs.PINNED["linux-x64"][0]
        data = tgz(name, FAKE_NODE, extra=[("../../escape", b"x"), (name[:-7] + "/lib/other", b"y")])
        self.assertEqual(nodejs._take(data, name, "linux-x64"), FAKE_NODE)

    def test_windows_zip(self):
        name = nodejs.PINNED["win-x64"][0]
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr(name[:-4] + "/node.exe", b"MZfake")
            z.writestr(name[:-4] + "/npm.cmd", b"x")
        self.assertEqual(nodejs._take(b.getvalue(), name, "win-x64"), b"MZfake")


@unittest.skipIf(sys.platform == "win32", "the pretend node is a shell script")
class Hand(unittest.TestCase):
    """The Helper learns about it: bridge config, a restart once, and Setup's Matter step asks for it only when needed."""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"COUCHTV_SETUP_HOME": self.home})
        self.env.start()
        self.nosys = mock.patch.object(nodejs, "system_node", return_value=None)
        self.nosys.start()
        key = nodejs.platform_key() or "linux-x64"
        d = nodejs.node_dir()
        d.mkdir(parents=True)
        self.exe = d / ("node.exe" if key.startswith("win") else "node")

    def tearDown(self):
        self.nosys.stop()
        self.env.stop()

    def put(self, body=FAKE_NODE):
        self.exe.write_bytes(body)
        self.exe.chmod(stat.S_IRWXU)

    def test_the_bridge_config_names_it_only_when_it_is_needed(self):
        cfg = hconfig.default()
        self.assertNotIn("matter", hconfig.bridge_config({}, cfg), "nothing fetched yet")
        self.put()
        self.assertEqual(hconfig.bridge_config({}, cfg)["matter"], {"node": str(self.exe)})
        self.put(FAKE_OLD)
        self.assertNotIn("matter", hconfig.bridge_config({}, cfg), "a program that is too old is never named")
        self.put()
        self.nosys.stop()
        with mock.patch.object(nodejs, "system_node", return_value=("/usr/bin/node", (22, 14, 0))):
            self.assertNotIn("matter", hconfig.bridge_config({}, cfg), "the computer's own is found by the bridge itself")
        self.nosys.start()

    def test_the_helper_restarts_the_bridge_once_when_it_appears(self):
        class Sup:
            killed = 0
            def _kill(self):
                Sup.killed += 1
        data = tempfile.mkdtemp()
        c = control.Controller(data=data, sup=Sup(), known={}, awake=mock.Mock())
        c.follow_node()
        self.assertEqual(Sup.killed, 0)
        self.put()
        c.follow_node()
        c.follow_node()
        self.assertEqual(Sup.killed, 1)
        with open(os.path.join(data, hconfig.BRIDGE_FILE), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["matter"], {"node": str(self.exe)})

    def test_already_there_at_start_means_no_restart(self):
        self.put()

        class Sup:
            killed = 0
            def _kill(self):
                Sup.killed += 1
        c = control.Controller(data=tempfile.mkdtemp(), sup=Sup(), known={}, awake=mock.Mock())
        c.follow_node()
        self.assertEqual(Sup.killed, 0)

    def test_setup_fetches_node_only_when_the_computer_has_none(self):
        calls = []
        with mock.patch.object(sh, "node_ok", return_value=(True, "v24.0.0")), \
                mock.patch.object(nodejs, "ensure", side_effect=lambda *a, **k: calls.append(1)), \
                mock.patch("urllib.request.urlopen", side_effect=OSError("no helper")):
            with self.assertRaises(TvError) as c:
                sh.matter_add("12345678901")
        self.assertEqual((calls, c.exception.code), ([], "matter_helper"))
        with mock.patch.object(sh, "node_ok", return_value=(False, "")), \
                mock.patch.object(nodejs, "ensure", side_effect=lambda *a, **k: calls.append(1) or {"how": "helper", "path": "x", "version": V}), \
                mock.patch("urllib.request.urlopen", side_effect=OSError("no helper")):
            with self.assertRaises(TvError):
                sh.matter_add("12345678901")
        self.assertEqual(calls, [1])

    def test_setup_waits_for_the_restart_after_a_fresh_fetch(self):
        waited = []
        with mock.patch.object(sh, "node_ok", return_value=(False, "")), \
                mock.patch.object(nodejs, "ensure", return_value={"how": "downloaded", "path": "x", "version": V}), \
                mock.patch.object(sh, "_wait_matter_ready", side_effect=lambda *a, **k: waited.append(1)), \
                mock.patch("urllib.request.urlopen", side_effect=OSError("no helper")):
            with self.assertRaises(TvError):
                sh.matter_add("12345678901")
        self.assertEqual(waited, [1])


if __name__ == "__main__":
    unittest.main()
