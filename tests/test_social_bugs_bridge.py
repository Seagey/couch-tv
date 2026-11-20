"""Bridge side of two social reports (coord/SOCIAL-BUILDLIST-0139.md).

g32  A Samsung smart monitor's owner wanted Esc and the other keys of the monitor's own remote on the
     phone remote. The phone's More keys sheet sends friendly names; each must reach the Samsung as
     its own KEY_ code (samsungtvws), and nothing else may be made up from them.
g34  "The clicker vanishes the second you want one of those five scenes": the phone remote now picks
     the next or the previous scene. POST /api/say/scene {"pick"} is kept for the TV home, which
     reads it with GET /api/say (ask.js), and only "next" or "prev" ever reaches the TV.
"""
import os
import sys
import time
import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

ROOT = os.environ.get("COUCHTV_ROOT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import say  # noqa: E402
import samsung  # noqa: E402
import server  # noqa: E402

# what remote/src/Sheets.jsx MORE_KEYS sends, and the Samsung key each must become
MORE_KEYS = {"return": "KEY_RETURN", "exit": "KEY_EXIT", "smart_hub": "KEY_HOME", "tools": "KEY_TOOLS", "info": "KEY_INFO",
             "guide": "KEY_GUIDE", "source": "KEY_SOURCE", "channel_list": "KEY_CH_LIST",
             "red": "KEY_RED", "green": "KEY_GREEN", "yellow": "KEY_YELLOW", "blue": "KEY_CYAN"}


class SamsungMoreKeys(unittest.TestCase):
    def test_every_sheet_key_maps(self):
        for name, code in MORE_KEYS.items():
            self.assertEqual(samsung.resolve_key(name), code, name)

    def test_the_sheet_lists_exactly_these(self):
        src = open(os.path.join(ROOT, "remote", "src", "Sheets.jsx"), encoding="utf-8").read()
        self.assertIn("MORE_KEYS", src)
        for name in MORE_KEYS:
            self.assertIn("'" + name + "'", src, name)

    def test_unknown_still_refused(self):
        self.assertIsNone(samsung.resolve_key("esc; rm"))
        self.assertIsNone(samsung.resolve_key(""))

    def test_key_sends_the_code(self):
        sent = []
        tv = samsung.SamsungTV.__new__(samsung.SamsungTV)
        tv.quiet_until = 0.0
        tv.app_id = "x"

        async def fake(code, cmd="Click"):
            sent.append((code, cmd))
        tv._key = fake
        tv._volume_soon = lambda: None
        import asyncio
        for name in ("return", "exit", "blue"):
            asyncio.run(tv.key(name))
        self.assertEqual(sent, [("KEY_RETURN", "Click"), ("KEY_EXIT", "Click"), ("KEY_CYAN", "Click")])


class SceneFromThePhone(unittest.TestCase):
    def setUp(self):
        say.clear()

    def test_only_next_or_prev(self):
        self.assertEqual(say.scene("tv", "next")["pick"], "next")
        self.assertEqual(say.scene("tv", "prev")["pick"], "prev")
        for bad in ("night", "", None, "<script>", 3):
            with self.assertRaises(ValueError):
                say.scene("tv", bad)

    def test_in_the_snapshot_the_home_reads(self):
        sc = say.scene("tv", "next")
        snap = say.snapshot("tv")
        self.assertEqual(snap["scene"], sc)
        self.assertGreater(snap["scene"]["at"], int(time.time() * 1000) - 5000)


class SceneHttp(AioHTTPTestCase):
    async def get_application(self):
        say.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/say", server.h_say)
        app.router.add_post("/api/say/scene", server.h_say_scene)
        return app

    @unittest_run_loop
    async def test_post_then_the_home_reads_it(self):
        with patch.object(config, "PAIRING_KEY", ""):
            j = await (await self.client.post("/api/say/scene", json={"pick": "next"})).json()
            self.assertEqual(j["scene"]["pick"], "next")
            self.assertFalse(j["listening"], "no home has asked yet")
            j = await (await self.client.get("/api/say?home=1")).json()
            self.assertEqual(j["scene"]["pick"], "next")
            j = await (await self.client.post("/api/say/scene", json={"pick": "prev"})).json()
            self.assertTrue(j["listening"], "the home asked just now")
            r = await self.client.post("/api/say/scene", json={"pick": "golden"})
            self.assertEqual(r.status, 400)

    @unittest_run_loop
    async def test_pairing_key_guards_it(self):
        with patch.object(config, "PAIRING_KEY", "secretkey1234"):
            r = await self.client.post("/api/say/scene", json={"pick": "next"})
            self.assertEqual(r.status, 401)

    def test_route_is_registered(self):
        src = open(os.path.join(ROOT, "bridge", "server.py"), encoding="utf-8").read()
        self.assertIn('r.add_post("/api/say/scene", h_say_scene)', src)


if __name__ == "__main__":
    unittest.main()
