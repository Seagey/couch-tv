"""roku/build.py: the zip it makes, and the sideload against a stand-in developer installer that asks for
HTTP digest sign in as rokudev, as a Roku in Developer Mode does. The BrightScript is checked with
BrighterScript and its linter when `npm install` has been run in roku/."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

ROKU = Path(__file__).parents[1] / "roku"
# loaded by path: a plain `import build` finds the repo's build/ folder first when the tests run from the repo root
_spec = importlib.util.spec_from_file_location("roku_build", ROKU / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

PASSWORD = "not-a-real-password"


class Installer(BaseHTTPRequestHandler):
    """POST /plugin_install with digest auth (RFC 2617, qop=auth, MD5), form field archive and mysubmit."""
    received = []

    def log_message(self, *a):
        pass

    def _challenge(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Digest realm="rokudev", qop="auth", nonce="abc123", opaque="xyz", algorithm=MD5')
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Digest "):
            return self._challenge()
        f = dict(p.strip().split("=", 1) for p in auth[7:].split(","))
        f = {k: v.strip('"') for k, v in f.items()}
        ha1 = hashlib.md5(f"rokudev:rokudev:{PASSWORD}".encode()).hexdigest()
        ha2 = hashlib.md5(f"POST:{f['uri']}".encode()).hexdigest()
        want = hashlib.md5(f"{ha1}:{f['nonce']}:{f['nc']}:{f['cnonce']}:{f['qop']}:{ha2}".encode()).hexdigest()
        if f.get("username") != "rokudev" or f.get("response") != want or self.path != "/plugin_install":
            return self._challenge()
        Installer.received.append(body)
        page = b'<html><body><font color="red">Install Success.</font></body></html>'
        if b'name="mysubmit"\r\n\r\nReplace' not in body or b'name="archive"' not in body:
            page = b'<html><body><font color="red">Missing fields</font></body></html>'
        self.send_response(200)
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)


class Build(unittest.TestCase):
    def make(self, **kw):
        return build.build(out=tempfile.mkdtemp(), **kw)

    def test_zip_has_the_manifest_first_and_the_config(self):
        path = self.make(bridge="http://192.0.2.20:5400/", tv="lounge")
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            self.assertEqual(names[0], "manifest")
            for need in ("source/main.brs", "components/HomeScene.xml", "components/HomeScene.brs", "scenes.json",
                         "images/icon_focus_fhd.png", "images/splash_fhd.jpg", "fonts/Antonio-Light.ttf"):
                self.assertIn(need, names)
            self.assertEqual(json.loads(z.read("config.json")), {"bridge": "http://192.0.2.20:5400", "tv": "lounge"})
            self.assertFalse([n for n in names if n.split("/")[-1].startswith(".") or "node_modules" in n])
        self.assertLess(os.path.getsize(path), build.SIZE_LIMIT)

    def test_no_bridge_is_allowed(self):
        with zipfile.ZipFile(self.make()) as z:
            self.assertEqual(json.loads(z.read("config.json")), {"bridge": "", "tv": ""})

    def test_odd_addresses_are_refused(self):
        for bad in ("my-computer", "http://x y:5400", "ftp://192.0.2.1"):
            with self.assertRaises(SystemExit):
                build.check_bridge(bad)
        with self.assertRaises(SystemExit):
            self.make(tv="a b")

    def test_every_scene_picture_the_scenes_file_names_is_in_the_zip(self):
        with zipfile.ZipFile(self.make()) as z:
            names = set(z.namelist())
            for s in json.loads(z.read("scenes.json"))["scenes"]:
                self.assertIn(s["photo"].replace("pkg:/", ""), names)
                if s["fg"]:
                    self.assertIn(s["fg"]["uri"].replace("pkg:/", ""), names)

    def test_manifest_has_what_a_channel_needs(self):
        text = (ROKU / "channel" / "manifest").read_text()
        for key in ("title=", "major_version=", "minor_version=", "build_version=", "mm_icon_focus_hd=", "mm_icon_focus_fhd=", "ui_resolutions=fhd"):
            self.assertIn(key, text)


class Sideload(unittest.TestCase):
    def setUp(self):
        Installer.received = []
        self.server = HTTPServer(("127.0.0.1", 0), Installer)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.zip = build.build(out=tempfile.mkdtemp())

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_install_signs_in_with_digest_and_uploads_the_zip(self):
        ok, said = build.install(self.zip, "127.0.0.1", PASSWORD, port=self.server.server_port)
        self.assertTrue(ok, said)
        self.assertEqual(len(Installer.received), 1)   # only the signed in try got as far as the installer
        self.assertIn(b"PK", Installer.received[-1][:2000] + Installer.received[-1][-200:])   # the zip went up

    def test_wrong_password_is_said_plainly(self):
        ok, said = build.install(self.zip, "127.0.0.1", "wrong", port=self.server.server_port)
        self.assertFalse(ok)
        self.assertIn("developer password", said)

    def test_nothing_listening_says_developer_mode(self):
        s = HTTPServer(("127.0.0.1", 0), Installer)
        port = s.server_port
        s.server_close()
        ok, said = build.install(self.zip, "127.0.0.1", PASSWORD, port=port)
        self.assertFalse(ok)
        self.assertIn("Developer Mode", said)


PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 40
APPS_XML = (
    '<?xml version="1.0" encoding="UTF-8" ?><apps>'
    '<app id="dev" type="appl" version="1.0.1">Couch TV</app>'
    '<app id="837" type="appl" version="1.0">YouTube</app>'
    '<app id="12" type="appl" version="4.1">Netflix &amp; Co</app>'
    '<app id="tvinput.hdmi1" type="tvin" version="1.0">HDMI 1</app>'
    '<app id="../../evil" type="appl" version="1">Bad</app>'
    '<app id="a/b" type="appl" version="1">Bad</app>'
    '<app id="12" type="appl" version="1">Netflix again</app>'
    '<app id="plex_2" type="appl" version="1">Plex</app>'
    '</apps>'
)


class AppSnapshot(unittest.TestCase):
    """--apps-from: a fake ECP, no network. A hostile device on the LAN must not write outside images/roku-icons/."""

    def fake(self, icons, xml=APPS_XML):
        def get(url):
            if url.endswith("/query/apps"):
                return "text/xml", xml.encode()
            return icons.get(url.rsplit("/", 1)[1], ("text/plain", b""))
        return get

    def test_parses_apps_and_skips_the_rest(self):
        apps = build.parse_app_list(APPS_XML)
        self.assertEqual([a["id"] for a in apps], ["837", "12", "plex_2"])
        self.assertEqual(apps[1]["title"], "Netflix & Co")

    def test_unsafe_ids_are_refused(self):
        for bad in ("", "../x", "a/b", "a.b", "a-b", "a b", "x" * 41, "..", "C:\\x", "a\x00b"):
            self.assertFalse(build.safe_app_id(bad), bad)
        for good in ("837", "plex_2", "ABC"):
            self.assertTrue(build.safe_app_id(good), good)

    def test_icon_file_name_comes_from_the_id_and_a_fixed_extension(self):
        self.assertEqual(build.icon_file("837", "image/png", PNG), "images/roku-icons/837.png")
        self.assertEqual(build.icon_file("837", "image/png; charset=x", PNG), "images/roku-icons/837.png")
        self.assertEqual(build.icon_file("837", "image/jpeg", b"\xff\xd8\xff" + b"x" * 9), "images/roku-icons/837.jpg")
        self.assertIsNone(build.icon_file("../evil", "image/png", PNG))

    def test_icon_content_type_size_and_bytes_are_checked(self):
        self.assertIsNone(build.icon_file("837", "image/svg+xml", PNG))
        self.assertIsNone(build.icon_file("837", "text/html", PNG))
        self.assertIsNone(build.icon_file("837", "image/png", b"<html>not a png</html>"))
        self.assertIsNone(build.icon_file("837", "image/png", b""))
        self.assertIsNone(build.icon_file("837", "image/png", PNG + b"x" * build.ICON_MAX))

    def test_snapshot_keeps_good_icons_only(self):
        icons = {"837": ("image/png", PNG), "12": ("image/svg+xml", b"<svg/>")}
        apps, files = build.snapshot_apps("192.0.2.30", get=self.fake(icons))
        self.assertEqual(list(files), ["images/roku-icons/837.png"])
        self.assertEqual(apps[0]["icon"], "pkg:/images/roku-icons/837.png")
        self.assertNotIn("icon", apps[1])
        for name in files:
            self.assertRegex(name, r"^images/roku-icons/[A-Za-z0-9_]+\.(png|jpg|webp)$")

    def test_hostile_ids_never_reach_a_file_name(self):
        evil = APPS_XML + '<app id="..%2f..%2fx" type="appl">x</app>'
        icons = {"../../evil": ("image/png", PNG)}
        _, files = build.snapshot_apps("192.0.2.30", get=self.fake(icons, evil))
        self.assertTrue(all(n.startswith("images/roku-icons/") and ".." not in n for n in files))

    def test_oversized_list_is_refused(self):
        big = "<apps>" + " " * (build.LIST_MAX + 10) + "</apps>"
        with self.assertRaises(SystemExit):
            build.snapshot_apps("192.0.2.30", get=self.fake({}, big))

    def test_odd_roku_addresses_are_refused(self):
        for bad in ("", "x/y", "a b", "192.0.2.30/../x", "http://192.0.2.30"):
            with self.assertRaises(SystemExit):
                build.check_host(bad)
        self.assertEqual(build.check_host("192.0.2.30"), "192.0.2.30")

    def test_zip_carries_apps_in_the_config_and_icons_under_the_icon_folder(self):
        icons = {"837": ("image/png", PNG)}
        orig = build.snapshot_apps
        build.snapshot_apps = lambda host: orig(host, get=self.fake(icons))
        try:
            with tempfile.TemporaryDirectory() as d:
                path = build.build(out=d, apps_from="192.0.2.30")
                with zipfile.ZipFile(path) as z:
                    cfg = json.loads(z.read("config.json"))
                    self.assertEqual([a["id"] for a in cfg["apps"]], ["837", "12", "plex_2"])
                    self.assertEqual(z.read("images/roku-icons/837.png"), PNG)
                    extra = [n for n in z.namelist() if n.startswith("images/roku-icons/")]
                    self.assertEqual(extra, ["images/roku-icons/837.png"])
                path = build.build(out=d)
                with zipfile.ZipFile(path) as z:
                    self.assertNotIn("apps", json.loads(z.read("config.json")))
        finally:
            build.snapshot_apps = orig


class Password(unittest.TestCase):
    def test_password_option_is_taken_without_a_prompt(self):
        argv = [str(ROKU / "build.py"), "--install", "192.0.2.30", "--password", "pw"]
        seen = {}
        orig = (build.build, build.install, build.getpass.getpass, sys.argv)
        build.build = lambda *a, **k: "x.zip"
        build.install = lambda path, host, pw: (seen.update(pw=pw) or True, "installed")
        build.getpass.getpass = lambda *a: self.fail("asked for a password")
        sys.argv = argv
        try:
            with self.assertRaises(SystemExit) as e:
                build.main()
            self.assertEqual(e.exception.code, 0)
        finally:
            build.build, build.install, build.getpass.getpass, sys.argv = orig
        self.assertEqual(seen["pw"], "pw")


class BrightScript(unittest.TestCase):
    @unittest.skipUnless((ROKU / "node_modules" / ".bin" / "bsc").exists(), "run `npm install` in roku/ for the BrightScript check")
    def test_compiles_and_lints_clean(self):
        r = subprocess.run([str(ROKU / "node_modules" / ".bin" / "bsc")], cwd=ROKU, capture_output=True, text=True, timeout=120)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 0, out)
        self.assertNotRegex(out, r"\b(error|warning) BS")


if __name__ == "__main__":
    unittest.main()
