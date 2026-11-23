"""Tests for static_handler: path traversal defense, SPA fallback, and metadata injection."""
import os
import shutil
import sys
import tempfile
import unittest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import server


class TestStaticHandler(AioHTTPTestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.static_dir = os.path.join(self.tmp_dir, "web")
        os.makedirs(self.static_dir)

        # Create a sibling directory with a name starting with the same prefix
        self.sibling_dir = os.path.join(self.tmp_dir, "web_sibling")
        os.makedirs(self.sibling_dir)
        with open(os.path.join(self.sibling_dir, "secret.txt"), "w", encoding="utf-8") as f:
            f.write("topsecret")

        # Create index.html and a subfile in static_dir
        with open(os.path.join(self.static_dir, "index.html"), "w", encoding="utf-8") as f:
            f.write("<!doctype html><html><head><title>Home</title></head><body>Home</body></html>")
        with open(os.path.join(self.static_dir, "style.css"), "w", encoding="utf-8") as f:
            f.write("body { background: #000; }")

        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    async def get_application(self):
        app = web.Application()
        app.router.add_get("/static/{path:.*}", server.static_handler(self.static_dir, "TestApp"))
        return app

    async def get_server(self, app):
        return await super().get_server(app)

    @unittest_run_loop
    async def test_text_is_compressed_when_the_page_accepts_it(self):
        # a Fire TV Cube on weak Wi-Fi reloaded 920 KB of uncompressed script and style per Look switch
        big = "body { background: #000; }\n" * 200
        with open(os.path.join(self.static_dir, "big.css"), "w", encoding="utf-8") as f:
            f.write(big)
        resp = await self.client.get("/static/big.css", headers={"Accept-Encoding": "gzip"}, auto_decompress=False)
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Content-Encoding"), "gzip")
        self.assertEqual(resp.headers.get("Vary"), "Accept-Encoding")
        self.assertEqual(resp.headers.get("Cache-Control"), "no-cache")
        import gzip
        self.assertEqual(gzip.decompress(await resp.read()).decode("utf-8"), big)
        # and plain when it does not
        resp = await self.client.get("/static/big.css", headers={"Accept-Encoding": "identity"}, auto_decompress=False)
        self.assertEqual(resp.status, 200)
        self.assertIsNone(resp.headers.get("Content-Encoding"))
        self.assertEqual(await resp.text(), big)

    @unittest_run_loop
    async def test_unchanged_text_answers_304_from_its_etag(self):
        resp = await self.client.get("/static/style.css")
        etag = resp.headers.get("ETag")
        self.assertTrue(etag)
        again = await self.client.get("/static/style.css", headers={"If-None-Match": etag, "Accept-Encoding": "gzip"})
        self.assertEqual(again.status, 304)
        self.assertEqual(await again.read(), b"")

    @unittest_run_loop
    async def test_pictures_and_fonts_are_cached_for_an_hour_and_not_compressed(self):
        with open(os.path.join(self.static_dir, "scene.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff" + b"\x00" * 2000)
        resp = await self.client.get("/static/scene.jpg", headers={"Accept-Encoding": "gzip"}, auto_decompress=False)
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Cache-Control"), "public, max-age=3600")
        self.assertIsNone(resp.headers.get("Content-Encoding"))
        self.assertTrue(resp.headers.get("ETag"))

    def test_cache_control_rules(self):
        # the phone remote's built files carry a content hash in the name: those never change
        self.assertEqual(server.static_cache_control(server.REMOTE_DIR, "assets/index-DZCN_EVo.js", "application/javascript"), "no-cache")
        self.assertEqual(server.static_cache_control(server.REMOTE_DIR, "icons/amazon.alexa.view-DZCN_EVo.png", "image/png"),
                         "public, max-age=31536000, immutable")
        # the TV home's pictures keep plain names: an hour, then the ETag says whether they changed
        self.assertEqual(server.static_cache_control(server.LAUNCHER_DIR, "backgrounds/scene-night.jpg", "image/jpeg"), "public, max-age=3600")
        self.assertEqual(server.static_cache_control(server.LAUNCHER_DIR, "fonts/inter.woff2", "font/woff2"), "public, max-age=3600")
        self.assertEqual(server.static_cache_control(server.LAUNCHER_DIR, "app.js", "application/javascript"), "no-cache")
        self.assertEqual(server.static_cache_control(server.LAUNCHER_DIR, "manifest.webmanifest", "application/manifest+json"), "no-cache")

    @unittest_run_loop
    async def test_serves_existing_file(self):
        resp = await self.client.get("/static/style.css")
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn("background: #000", text)

    @unittest_run_loop
    async def test_serves_index_html_with_lan_ip_tag(self):
        resp = await self.client.get("/static/")
        self.assertEqual(resp.status, 200)
        html = await resp.text()
        self.assertIn("<title>Home</title>", html)

    @unittest_run_loop
    async def test_blocks_parent_directory_traversal(self):
        handler = server.static_handler(self.static_dir, "TestApp")
        from aiohttp.test_utils import make_mocked_request
        req = make_mocked_request("GET", "/static/../web_sibling/secret.txt",
                                  match_info={"path": "../web_sibling/secret.txt"})
        with self.assertRaises(web.HTTPForbidden):
            await handler(req)

    @unittest_run_loop
    async def test_blocks_absolute_or_deep_traversal(self):
        handler = server.static_handler(self.static_dir, "TestApp")
        from aiohttp.test_utils import make_mocked_request
        req = make_mocked_request("GET", "/static/deep",
                                  match_info={"path": "../../../../../../etc/passwd"})
        with self.assertRaises(web.HTTPForbidden):
            await handler(req)

    @unittest_run_loop
    async def test_missing_asset_with_extension_returns_404(self):
        resp = await self.client.get("/static/nonexistent.png")
        self.assertEqual(resp.status, 404)


if __name__ == "__main__":
    unittest.main()
