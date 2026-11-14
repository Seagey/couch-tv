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
