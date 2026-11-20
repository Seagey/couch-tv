"""The Apple TV's six digit codes across every address (20 Nov 2026, the bridge's half of S1): 15 wrong
codes at /api/appletv/claim within 10 minutes, while a code is live, answer 429 there for 10 minutes, with
Retry-After. The long pairing key (/api/pair) and the VIDAA and Panasonic claim are never locked, so one
caller can't shut the owner out. Calls that carry the right key are never locked."""
import json
import os
import sys
import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import server  # noqa: E402


class PairLockRules(unittest.TestCase):
    def setUp(self):
        server.pair_lock_reset()

    def tearDown(self):
        server.pair_lock_reset()

    def test_fourteen_stay_open_the_fifteenth_locks_for_ten_minutes(self):
        for i in range(14):
            self.assertFalse(server.pair_wrong(1000.0 + i))
        self.assertEqual(server.pair_locked_for(1014.0), 0)
        self.assertTrue(server.pair_wrong(1014.0))
        self.assertEqual(server.pair_locked_for(1014.0), 600)
        self.assertEqual(server.pair_locked_for(1613.5), 1)
        self.assertEqual(server.pair_locked_for(1614.0), 0)

    def test_old_tries_fall_out_of_the_window(self):
        for i in range(14):
            server.pair_wrong(1000.0)
        self.assertFalse(server.pair_wrong(1600.0))
        self.assertEqual(server.pair_locked_for(1600.0), 0)


class PairLockEndpoints(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._p = [patch.object(config, "PAIRING_KEY", "couchpass123")]
        for p in self._p:
            p.start()
        server._failed_attempts.clear()
        server.appletv_codes.clear()
        server.pair_lock_reset()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_post("/api/pair", server.h_pair)
        app.router.add_post("/api/appletv/claim", server.h_appletv_claim)
        app.router.add_post("/api/vidaa/claim", server.h_vidaa_claim)

        async def h_now(request):
            return server.ok(state="playing")
        app.router.add_get("/api/now", h_now)
        self.client = TestClient(TestServer(app, host="127.0.0.1"))
        await self.client.start_server()
        self.sleep = patch.object(server.asyncio, "sleep", new=self._nosleep)
        self.sleep.start()

    async def _nosleep(self, *_a, **_k):
        return None

    async def asyncTearDown(self):
        self.sleep.stop()
        await self.client.close()
        for p in reversed(self._p):
            p.stop()
        server._failed_attempts.clear()
        server.appletv_codes.clear()
        server.pair_lock_reset()

    def post(self, path, data):
        return self.client.post(path, headers={"Content-Type": "application/json"}, data=json.dumps(data))

    def live_code(self):
        server.appletv_codes["999999"] = (server.time.monotonic() + 600, "living-room")

    async def test_wrong_apple_tv_codes_lock_the_claim_while_a_code_is_live(self):
        self.live_code()
        for i in range(14):
            r = await self.post("/api/appletv/claim", {"code": f"{100000 + i}"})
            self.assertEqual(r.status, 401)
        self.assertEqual(server.pair_locked_for(), 0)
        r = await self.post("/api/appletv/claim", {"code": "123456"})
        self.assertEqual(r.status, 401)          # the 15th is still answered, and locks
        self.assertGreater(server.pair_locked_for(), 590)
        r = await self.post("/api/appletv/claim", {"code": "999999"})
        self.assertEqual(r.status, 429)
        j = await r.json()
        self.assertEqual(j.get("error_key"), "err_pairing_locked")
        self.assertIn("Wait 10 min", j.get("error", ""))
        self.assertGreater(j.get("retry_after", 0), 590)
        self.assertGreater(int(r.headers.get("Retry-After", "0")), 590)
        # a phone already holding the key keeps working
        r = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
        self.assertEqual(r.status, 200)

    async def test_no_live_code_no_lock(self):
        for i in range(30):
            r = await self.post("/api/appletv/claim", {"code": f"{100000 + i}"})
            self.assertIn(r.status, (401, 429))
            self.assertNotEqual((await r.json()).get("error_key"), "err_pairing_locked")
        self.assertEqual(server.pair_locked_for(), 0)

    async def test_the_same_wrong_key_never_locks_the_owner_out(self):
        # one caller repeating one wrong key: the owner's right key still pairs (the key is long, no lock)
        for i in range(40):
            await self.post("/api/pair", {"key": "wrong-key"})
        self.assertEqual(server.pair_locked_for(), 0)
        r = await self.post("/api/pair", {"key": "couchpass123"})
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json()).get("token"), "couchpass123")

    async def test_vidaa_claim_is_never_locked(self):
        for i in range(30):
            r = await self.post("/api/vidaa/claim", {"code": f"c{i}"})
            self.assertNotEqual((await r.json()).get("error_key"), "err_pairing_locked")
        self.assertEqual(server.pair_locked_for(), 0)


if __name__ == "__main__":
    unittest.main()
