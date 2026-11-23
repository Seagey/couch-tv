"""The bridge serves the Loop look's footage under /tv/loop/ with HTTP Range, and keeps the video
out of the launcher's offline copy, which still gets the posters, the cut-outs and loop.json
(docs/LOOP.md, bridge/API.md).

aiohttp's FileResponse answers Range by itself; these tests pin that behaviour, so a change of
aiohttp or of static_handler that loses it fails here rather than on the TV.
"""
import gzip
import json
import os
import shutil
import sys
import tempfile
import unittest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

# A data folder of its own when this module is the first to import config, so nothing here can
# reach the bridge's real bridge/data.
os.environ.setdefault("COUCH_DATA", tempfile.mkdtemp(prefix="couchtv-loop-serving-"))
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
    async def test_offline_manifest_skips_the_loop_video_and_keeps_the_posters_and_cut_outs(self):
        with open(os.path.join(self.web, "loop", "day-blur.mp4"), "wb") as f:
            f.write(BODY[:64])
        with open(os.path.join(self.web, "loop", "day-blur.jpg"), "wb") as f:
            f.write(b"\xff\xd8\xff" + b"\x00" * 50)
        # the cut-out and loop.json are small: they stay, so the offline home keeps the clock
        # behind the peak over the poster instead of dropping it and jumping back up
        with open(os.path.join(self.web, "loop", "day-fg.png"), "wb") as f:
            f.write(b"\x89PNG" + b"\x00" * 40)
        with open(os.path.join(self.web, "loop", "loop.json"), "w", encoding="utf-8") as f:
            f.write('{"fg": true}')
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
        self.assertEqual(sorted(p for p in paths if p.startswith("loop/")),
                         ["loop/day-blur.jpg", "loop/day-fg.png", "loop/day.jpg", "loop/loop.json"])
        self.assertTrue(server.offline_skips("loop/night.mp4"))
        self.assertTrue(server.offline_skips("loop/night-blur.mp4"))
        self.assertTrue(server.offline_skips("mock.js"))
        self.assertFalse(server.offline_skips("loop/night.jpg"))
        self.assertFalse(server.offline_skips("loop/night-fg.png"))
        self.assertFalse(server.offline_skips("loop/loop.json"))
        self.assertFalse(server.offline_skips("app.js"))


class SettingsLook(unittest.TestCase):
    def test_home_settings_accept_the_loop_look(self):
        import config
        self.assertIn("loop", config.LOOKS)
        self.assertEqual(server.clean_settings({"look": "loop"}).get("look"), "loop")
        self.assertNotIn("look", server.clean_settings({"look": "disco"}))


ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
GOOD_META = {"still": True, "seconds": 34, "fps": 30, "zoom": 0.06, "sway": 0.3,
             "fg": {"x": 480, "y": 162, "w": 960, "h": 318}}


def fake_web(folder):
    """A tv-home/web with a made loop in it (footage, posters, cut-out, loop.json), a background
    whose name starts with loop, a nested folder called loop, and the person's own photos."""
    files = ["index.html", "app.js", "mock.js", "loop/day.mp4", "loop/day-blur.mp4", "loop/day.jpg",
             "loop/day-blur.jpg", "loop/day-fg.png", "backgrounds/loop-fire.jpg",
             "backgrounds/mine/home.jpg", "fonts/loop/keep.txt"]
    for rel in files:
        os.makedirs(os.path.dirname(os.path.join(folder, rel)), exist_ok=True)
        with open(os.path.join(folder, rel), "w") as f:
            f.write("<!doctype html>" if rel == "index.html" else rel)
    with open(os.path.join(folder, "loop", "loop.json"), "w") as f:
        f.write(json.dumps(GOOD_META))


def copied(folder):
    return sorted(os.path.relpath(os.path.join(d, n), folder).replace(os.sep, "/")
                  for d, _, names in os.walk(folder) for n in names)


def load_builder(name):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name.replace("/", "_"), os.path.join(ROOT, name))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class BuildersLeaveTheLoopOut(unittest.TestCase):
    """Only the bridge (and the launcher's offline copy of it) ever shows the Loop look's files, so
    every other build of tv-home/web leaves loop/ out: up to 80 MB of footage nobody plays, and, in
    a release, stills of the maker's own photo."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.web = os.path.join(self.tmp, "web")
        fake_web(self.web)

    def build(self, mod, ignore):
        out = os.path.join(self.tmp, "out")
        old = mod.WEB
        mod.WEB = self.web
        try:
            shutil.copytree(self.web, out, ignore=ignore())
        finally:
            mod.WEB = old
        return copied(out)

    def test_lg(self):
        lg = load_builder("lg/build.py")
        files = self.build(lg, lambda: lg.web_ignore("mock.js", ".*"))
        self.assertFalse([f for f in files if f.startswith("loop/")], files)
        self.assertNotIn("mock.js", files)
        # only the top folder called loop goes
        self.assertIn("backgrounds/loop-fire.jpg", files)
        self.assertIn("fonts/loop/keep.txt", files)
        self.assertIn("backgrounds/mine/home.jpg", files)

    def test_samsung(self):
        samsung = load_builder("samsung/build.py")
        files = self.build(samsung, lambda: samsung.web_ignore(False))
        self.assertFalse([f for f in files if f.startswith("loop/")], files)
        self.assertNotIn("mock.js", files)
        self.assertIn("backgrounds/loop-fire.jpg", files)
        self.assertIn("fonts/loop/keep.txt", files)
        self.assertIn("backgrounds/mine/home.jpg", files, "a build for this home keeps its own photos")
        shutil.rmtree(os.path.join(self.tmp, "out"))
        files = self.build(samsung, lambda: samsung.web_ignore(True))
        self.assertFalse([f for f in files if f.startswith("loop/")], files)
        self.assertNotIn("backgrounds/mine/home.jpg", files, "a release never carries this computer's photos")
        self.assertIn("backgrounds/loop-fire.jpg", files)

    def test_the_on_tv_app_leaves_it_out(self):
        with open(os.path.join(ROOT, "on-tv", "android", "app", "build.gradle.kts")) as f:
            gradle = f.read()
        self.assertIn('val tvLoop = File(tvHomeWeb, "loop").absoluteFile.normalize()', gradle)
        self.assertIn("exclude { it.file.absoluteFile.normalize().startsWith(tvLoop) }", gradle)

    @unittest.skipUnless(shutil.which("rsync"), "needs rsync")
    def test_the_standalone_site_keeps_only_the_posters_and_turns_the_cut_out_off(self):
        import config
        made = config.loop_files(os.path.join(self.web, "loop"))
        self.assertIs(made["fg"], True, "the bridge would turn the cut-out on for this loop")
        self.assertTrue(made["meta"])
        # the real script, run in a copy of the repo's layout around the fake web folder
        root = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(root, "scripts"))
        shutil.copy(os.path.join(ROOT, "scripts", "build-standalone.sh"), os.path.join(root, "scripts"))
        os.makedirs(os.path.join(root, "tv-home"))
        shutil.copytree(self.web, os.path.join(root, "tv-home", "web"))
        os.symlink(os.path.realpath(os.path.join(ROOT, "bridge")), os.path.join(root, "bridge"))
        shutil.copytree(os.path.join(ROOT, "standalone", "api"), os.path.join(root, "standalone", "api"))
        os.makedirs(os.path.join(root, "lg", "app"))
        shutil.copy(os.path.join(ROOT, "lg", "app", "largeIcon.png"), os.path.join(root, "lg", "app"))
        os.makedirs(os.path.join(root, ".venv", "bin"))
        os.symlink(sys.executable, os.path.join(root, ".venv", "bin", "python"))
        out = os.path.join(self.tmp, "site")
        env = dict(os.environ, COUCH_CONFIG=os.path.realpath(os.path.join(ROOT, "config.example.json")),
                   COUCH_DATA=os.path.join(self.tmp, "data"))
        import subprocess
        run = subprocess.run(["bash", os.path.join(root, "scripts", "build-standalone.sh"), out],
                             env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr)
        files = copied(out)
        self.assertEqual([f for f in files if f.startswith("loop/")], ["loop/day-blur.jpg", "loop/day.jpg"])
        self.assertIn("backgrounds/loop-fire.jpg", files)
        with open(os.path.join(out, "config.js")) as f:
            text = f.read()
        loop = json.loads(text.split("window.COUCH_CONFIG = ", 1)[1].split(";\n", 1)[0])["home"]["loop"]
        self.assertEqual(loop["variants"], ["day"], "the poster still shows")
        self.assertIs(loop["fg"], False)
        self.assertIsNone(loop["meta"])
        self.assertIn("loop/", run.stdout.splitlines()[-1], "the closing warning names loop/")

if __name__ == "__main__":
    unittest.main()
