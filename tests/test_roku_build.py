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


class BrightScript(unittest.TestCase):
    @unittest.skipUnless((ROKU / "node_modules" / ".bin" / "bsc").exists(), "run `npm install` in roku/ for the BrightScript check")
    def test_compiles_and_lints_clean(self):
        r = subprocess.run([str(ROKU / "node_modules" / ".bin" / "bsc")], cwd=ROKU, capture_output=True, text=True, timeout=120)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 0, out)
        self.assertNotRegex(out, r"\b(error|warning) BS")


if __name__ == "__main__":
    unittest.main()
