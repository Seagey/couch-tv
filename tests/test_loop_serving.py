"""The bridge serves the Loop look's footage under /tv/loop/ with HTTP Range, and keeps it out of
the launcher's offline copy (docs/LOOP.md, bridge/API.md).

aiohttp's FileResponse answers Range by itself; these tests pin that behaviour, so a change of
aiohttp or of static_handler that loses it fails here rather than on the TV.
"""
import gzip
import os
import shutil
import sys
import tempfile
import unittest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import server

BODY = bytes(range(256)) * 8   # 2048 bytes, every byte known by its position


class LoopServing(AioHTTPTestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.web = os.path.join(self.tmp, "web")
        os.makedirs(os.path.join(self.web, "loop"))
        with open(os.path.join(self.web, "index.html"), "w", encoding="utf-8") as f:
            f.write("<!doctype html><html><head><title>Home</title></head><body>Home</body></html>")
        with open(os.path.join(self.web, "app.js"), "w", encoding="utf-8") as f:
            f.write("var x = 1;\n" * 100)
        with open(os.path.join(self.web, "mock.js"), "w", encoding="utf-8") as f:
            f.write("mock")
        with open(os.path.join(self.web, "loop", "day.mp4"), "wb") as f:
            f.write(BODY)
        with open(os.path.join(self.web, "loop", "day.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff" + b"\x00" * 100)
        with open(os.path.join(self.tmp, "secret.mp4"), "wb") as f:
            f.write(b"outside")
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    async def get_application(self):
        app = web.Application()
        app.router.add_get("/tv/manifest.json", server.h_tv_manifest)
        app.router.add_get("/tv/{path:.*}", server.static_handler(self.web, "TV home screen"))
        return app

    async def get(self, rng=None, **headers):
        h = {"Accept-Encoding": "gzip", **headers}
        if rng:
            h["Range"] = rng
        return await self.client.get("/tv/loop/day.mp4", headers=h, auto_decompress=False)

    @unittest_run_loop
    async def test_whole_file_with_the_media_caching_headers_and_no_gzip(self):
        r = await self.get()
        self.assertEqual(r.status, 200)
        self.assertEqual(await r.read(), BODY)
        self.assertEqual(r.headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(r.headers.get("Content-Type"), "video/mp4")
        self.assertEqual(r.headers.get("Cache-Control"), "public, max-age=3600")
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertEqual(r.headers.get("Content-Length"), str(len(BODY)))
        self.assertTrue(r.headers.get("ETag"))

    @unittest_run_loop
    async def test_partial_range(self):
        r = await self.get("bytes=256-511")
        self.assertEqual(r.status, 206)
        self.assertEqual(r.headers.get("Content-Range"), "bytes 256-511/2048")
        self.assertEqual(r.headers.get("Content-Length"), "256")
        self.assertEqual(r.headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(r.headers.get("Cache-Control"), "public, max-age=3600")
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertEqual(await r.read(), BODY[256:512])

    @unittest_run_loop
    async def test_open_ended_range_is_the_seek_at_the_wrap(self):
        r = await self.get("bytes=2000-")
        self.assertEqual(r.status, 206)
        self.assertEqual(r.headers.get("Content-Range"), "bytes 2000-2047/2048")
        self.assertEqual(await r.read(), BODY[2000:])

    @unittest_run_loop
    async def test_suffix_range_is_the_moov_probe(self):
        r = await self.get("bytes=-100")
        self.assertEqual(r.status, 206)
        self.assertEqual(r.headers.get("Content-Range"), "bytes 1948-2047/2048")
        self.assertEqual(await r.read(), BODY[-100:])

    @unittest_run_loop
    async def test_range_past_the_end_or_malformed_is_416(self):
        for rng in ("bytes=5000-6000", "bytes=2048-", "bytes=abc", "bytes=0-9,20-29"):
            r = await self.get(rng)
            self.assertEqual(r.status, 416, rng)
            self.assertEqual(r.headers.get("Content-Range"), "bytes */2048", rng)
            self.assertEqual(await r.read(), b"", rng)

    @unittest_run_loop
    async def test_head_answers_the_headers_and_no_body(self):
        r = await self.client.head("/tv/loop/day.mp4")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers.get("Content-Length"), "2048")
        self.assertEqual(r.headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(r.headers.get("Content-Type"), "video/mp4")
        self.assertEqual(await r.read(), b"")
        r = await self.client.head("/tv/loop/day.mp4", headers={"Range": "bytes=0-9"})
        self.assertEqual(r.status, 206)
        self.assertEqual(r.headers.get("Content-Range"), "bytes 0-9/2048")
        self.assertEqual(await r.read(), b"")

    @unittest_run_loop
    async def test_poster_is_media_too(self):
        r = await self.client.get("/tv/loop/day.jpg", headers={"Accept-Encoding": "gzip"}, auto_decompress=False)
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers.get("Cache-Control"), "public, max-age=3600")
        self.assertIsNone(r.headers.get("Content-Encoding"))
        self.assertEqual(r.headers.get("Accept-Ranges"), "bytes")

    @unittest_run_loop
    async def test_text_next_to_it_is_still_compressed_and_revalidated(self):
        r = await self.client.get("/tv/app.js", headers={"Accept-Encoding": "gzip"}, auto_decompress=False)
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        self.assertEqual(r.headers.get("Cache-Control"), "no-cache")
        self.assertEqual(gzip.decompress(await r.read()).decode(), "var x = 1;\n" * 100)

    @unittest_run_loop
    async def test_unchanged_video_answers_304_from_its_etag(self):
        r = await self.get()
        etag = r.headers.get("ETag")
        again = await self.get(**{"If-None-Match": etag})
        self.assertEqual(again.status, 304)
        self.assertEqual(await again.read(), b"")

    @unittest_run_loop
    async def test_nothing_outside_the_launcher_folder_is_reachable(self):
        from aiohttp.test_utils import make_mocked_request
        handler = server.static_handler(self.web, "TV home screen")
        for rel in ("loop/../../secret.mp4", "../secret.mp4", "loop/../../../../../etc/passwd"):
            req = make_mocked_request("GET", "/tv/" + rel, match_info={"path": rel})
            with self.assertRaises(web.HTTPForbidden, msg=rel):
                await handler(req)
        # and over the wire: the client normalises the dots away, and what is left is not there
        r = await self.client.get("/tv/loop/%2e%2e/%2e%2e/secret.mp4")
        self.assertIn(r.status, (403, 404))
        r = await self.client.get("/tv/loop/missing.mp4", headers={"Range": "bytes=0-9"})
        self.assertEqual(r.status, 404)

    @unittest_run_loop
    async def test_offline_manifest_skips_the_loop_video_and_keeps_the_posters(self):
        with open(os.path.join(self.web, "loop", "day-blur.mp4"), "wb") as f:
            f.write(BODY[:64])
        with open(os.path.join(self.web, "loop", "day-blur.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff" + b"\x00" * 50)
        old = server.LAUNCHER_DIR
        server.LAUNCHER_DIR = self.web
        try:
            r = await self.client.get("/tv/manifest.json")
            self.assertEqual(r.status, 200)
            paths = [f["path"] for f in (await r.json())["files"]]
        finally:
            server.LAUNCHER_DIR = old
        self.assertIn("app.js", paths)
        self.assertIn("index.html", paths)
        self.assertIn("config.js", paths)
        self.assertNotIn("mock.js", paths)
        self.assertEqual(sorted(p for p in paths if p.startswith("loop/")), ["loop/day-blur.jpg", "loop/day.jpg"])
        self.assertTrue(server.offline_skips("loop/night.mp4"))
        self.assertTrue(server.offline_skips("loop/night-blur.mp4"))
        self.assertTrue(server.offline_skips("mock.js"))
        self.assertFalse(server.offline_skips("loop/night.jpg"))
        self.assertFalse(server.offline_skips("app.js"))


class SettingsLook(unittest.TestCase):
    def test_home_settings_accept_the_loop_look(self):
        import config
        self.assertIn("loop", config.LOOKS)
        self.assertEqual(server.clean_settings({"look": "loop"}).get("look"), "loop")
        self.assertNotIn("look", server.clean_settings({"look": "disco"}))


if __name__ == "__main__":
    unittest.main()
