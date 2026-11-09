"""lg/build.py downloads the TV's own icon for a baked app with no bundled logo (#56)."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "lg"))
import build

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32


class Icons(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"<html>not an icon</html>" if self.path == "/page.html" else PNG
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@unittest.skipUnless(shutil.which("openssl"), "needs openssl to make a self-signed certificate")
class FetchTvIcons(unittest.TestCase):
    """A server with a self-signed certificate, like the LG's secure port 3001."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        cert, key = os.path.join(cls.dir, "cert.pem"), os.path.join(cls.dir, "key.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=lg-tv", "-keyout", key, "-out", cert],
                       check=True, capture_output=True)
        cls.server = HTTPServer(("127.0.0.1", 0), Icons)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        cls.server.socket = ctx.wrap_socket(cls.server.socket, server_side=True)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"https://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.dir)

    def setUp(self):
        self.logos_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.logos_dir)

    def test_saves_icons_under_the_name_the_app_looks_for(self):
        logos = {"com.netflix.ninja"}
        baked = [
            # known to couch-tv, no bundled logo: saved under its Android package
            {"id": "cdp-30", "title": "Plex", "icon": self.base + "/Plex_80x80.png"},
            # unknown to couch-tv: saved under its LG id
            {"id": "com.example.weather", "title": "Weather", "icon": self.base + "/w.png"},
            # has a bundled logo: left alone
            {"id": "netflix", "title": "Netflix", "icon": self.base + "/n.png"},
            # LG's own part, not shown on the home
            {"id": "com.webos.app.livetv", "title": "Live TV", "icon": self.base + "/tv.png"},
            # no address to fetch
            {"id": "com.example.local", "title": "Local", "icon": "/usr/palm/applications/x/icon.png"},
        ]
        got = build.fetch_tv_icons(baked, self.logos_dir, logos)
        self.assertEqual(got, 2)
        self.assertEqual(sorted(os.listdir(self.logos_dir)), ["com.example.weather.png", "com.plexapp.android.png"])
        self.assertEqual(logos, {"com.netflix.ninja", "com.plexapp.android", "com.example.weather"})
        with open(os.path.join(self.logos_dir, "com.plexapp.android.png"), "rb") as f:
            self.assertEqual(f.read(), PNG)

    def test_skips_what_is_not_an_icon_or_does_not_answer(self):
        logos = set()
        baked = [
            {"id": "com.example.page", "title": "Page", "icon": self.base + "/page.html"},
            {"id": "com.example.gone", "title": "Gone", "icon": "https://127.0.0.1:9/icon.png"},
        ]
        self.assertEqual(build.fetch_tv_icons(baked, self.logos_dir, logos), 0)
        self.assertEqual(os.listdir(self.logos_dir), [])
        self.assertEqual(logos, set())


if __name__ == "__main__":
    unittest.main()
