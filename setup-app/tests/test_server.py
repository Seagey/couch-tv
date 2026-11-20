"""The page server's locks: the per run secret, the Host check (DNS rebinding) and the Origin check."""
import json
import os
import re
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from http.server import ThreadingHTTPServer  # noqa: E402

from couchtv_setup import server  # noqa: E402


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.S.httpd, server.S.port = cls.httpd, cls.httpd.server_address[1]
        cls.base = f"http://127.0.0.1:{server.S.port}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def call(self, path, headers=None, body=b"{}", method="POST"):
        req = urllib.request.Request(self.base + path, data=body if method == "POST" else None, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def test_page_has_the_secret_and_a_csp(self):
        code, raw, headers = self.call("/", method="GET")
        self.assertEqual(code, 200)
        self.assertIn(server.SECRET.encode(), raw)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_api_needs_the_secret(self):
        self.assertEqual(self.call("/api/info")[0], 403)
        self.assertEqual(self.call("/api/info", {"X-Setup-Key": "wrong"})[0], 403)
        code, raw, _ = self.call("/api/info", {"X-Setup-Key": server.SECRET})
        self.assertEqual(code, 200)
        self.assertFalse(json.loads(raw)["connected"])

    def test_dns_rebinding_host_is_refused(self):
        self.assertEqual(self.call("/", {"Host": f"evil.example:{server.S.port}"}, method="GET")[0], 403)
        self.assertEqual(self.call("/api/info", {"Host": f"evil.example:{server.S.port}", "X-Setup-Key": server.SECRET})[0], 403)

    def test_other_origin_is_refused(self):
        h = {"X-Setup-Key": server.SECRET, "Origin": "http://evil.example"}
        self.assertEqual(self.call("/api/info", h)[0], 403)

    def test_no_traversal(self):
        self.assertEqual(self.call("/../server.py", method="GET")[0], 404)
        self.assertEqual(self.call("/%2e%2e/server.py", method="GET")[0], 404)

    def test_only_home_addresses(self):
        code, raw, _ = self.call("/api/look", {"X-Setup-Key": server.SECRET}, json.dumps({"ip": "8.8.8.8"}).encode())
        self.assertEqual(code, 400)
        self.assertEqual(json.loads(raw)["code"], "bad_ip")

    def test_page_never_uses_innerhtml(self):
        js = open(os.path.join(os.path.dirname(server.__file__), "web", "app.js")).read()
        self.assertIsNone(re.search(r"innerHTML|outerHTML|insertAdjacentHTML|document\.write", js))

    def test_no_dashes_in_the_words(self):
        for f in ("index.html", "app.js"):
            text = open(os.path.join(os.path.dirname(server.__file__), "web", f), encoding="utf-8").read()
            self.assertNotIn("—", text, f)
            self.assertNotIn("–", text, f)


class RemoteCode(unittest.TestCase):
    """Show a code: when the TV's pairing is locked (429), the page says the TV's own words."""

    def setUp(self):
        self.tv, self.ip = server.S.tv, server.S.ip
        server.S.tv, server.S.ip = object(), "192.0.2.9"

    def tearDown(self):
        server.S.tv, server.S.ip = self.tv, self.ip

    def answer(self, code, raw):
        import io
        from unittest import mock

        err = urllib.error.HTTPError("http://192.0.2.9:5400/api/pair/start", code, "x", {}, io.BytesIO(raw))
        with mock.patch.object(server.urllib.request, "urlopen", side_effect=err):
            with self.assertRaises(server.TvError) as c:
                server.api("POST", "/api/remote/code", {})
        return c.exception

    def test_locked_says_the_tvs_words(self):
        e = self.answer(429, json.dumps({"error": "Wait 10 min, then try again.", "retry_after": 600}).encode())
        self.assertEqual(str(e), "Wait 10 min, then try again.")
        self.assertEqual(e.code, "remote_locked")

    def test_other_answer_with_words(self):
        e = self.answer(403, b'{"error": "Pairing is off on this TV."}')
        self.assertEqual((str(e), e.code), ("Pairing is off on this TV.", "remote_said"))

    def test_answer_with_no_words_is_not_answering(self):
        e = self.answer(500, b"<html>oops</html>")
        self.assertEqual(e.code, "remote_down")


if __name__ == "__main__":
    unittest.main()
