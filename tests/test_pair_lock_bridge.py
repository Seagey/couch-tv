"""The Apple TV's six digit codes (21 Nov 2026), the same rules as the on-TV app's Auth.kt and the phone page:
at /api/appletv/claim, while a code is live, one address may make 5 different wrong tries in 10 minutes, then
it waits (429, Wait N min, Retry-After) and nobody else does; the same wrong code again from it is not a new
try; 15 across every address (3 or more) lock the claim for everyone for 10 minutes. The long pairing key
(/api/pair) and the VIDAA and Panasonic claim are never locked, so one caller can't shut the owner out. Calls
that carry the right key are never locked."""
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

    def test_fourteen_stay_open_the_fifteenth_locks_everyone_for_ten_minutes(self):
        for i in range(14):   # 3 addresses, at most 5 each
            self.assertFalse(server.pair_wrong(1000.0 + i, ip=f"192.0.2.{i // 5 + 1}", guess=f"{i:06d}"))
        self.assertEqual(server.pair_locked_for(1014.0, ip="192.0.2.9"), 0)
        self.assertTrue(server.pair_wrong(1014.0, ip="192.0.2.3", guess="999999"))
        self.assertEqual(server.pair_locked_for(1014.0, ip="192.0.2.9"), 600)
        self.assertEqual(server.pair_locked_for(1613.5, ip="192.0.2.9"), 1)
        self.assertEqual(server.pair_locked_for(1614.0, ip="192.0.2.9"), 0)

    def test_old_tries_fall_out_of_the_window(self):
        for i in range(14):
            server.pair_wrong(1000.0, ip=f"192.0.2.{i // 5 + 1}", guess=f"{i:06d}")
        self.assertFalse(server.pair_wrong(1600.0, ip="192.0.2.9", guess="1"))
        self.assertEqual(server.pair_locked_for(1600.0, ip="192.0.2.1"), 0)

    # coordinator 21 Nov (2): one address may make 5 different wrong tries in 10 minutes, then it waits
    def test_one_address_is_limited_after_five_different_wrong_codes(self):
        for i in range(5):
            server.pair_wrong(1000.0 + i, ip="192.0.2.5", guess=f"{i:06d}")
        self.assertEqual(server.pair_locked_for(1005.0, ip="192.0.2.5"), 595)
        self.assertEqual(server.pair_locked_for(1005.0, ip="192.0.2.6"), 0)
        self.assertEqual(server.pair_locked_for(1600.0, ip="192.0.2.5"), 0)

    # coordinator 21 Nov, at merge: callers that pass no address (nl-phonepage's check_pair_lock()/pair_wrong())
    # never share one "" address, so they never lock anyone alone; they still count toward the 15
    def test_tries_with_no_address_lock_nobody_and_count_toward_fifteen(self):
        for i in range(5):
            self.assertFalse(server.pair_wrong(1000.0 + i))
        self.assertEqual(server.pair_locked_for(1005.0), 0)
        self.assertEqual(server.pair_locked_for(1005.0, ip="192.0.2.5"), 0)
        self.assertEqual(len(server._pair_all.tries), 5)
        self.assertEqual(len(server._pair_by_address), 0)
        for i in range(9):
            server.pair_wrong(1006.0 + i)
        self.assertTrue(server.pair_wrong(1015.0))      # the 15th, no address at all: locks everyone
        self.assertGreater(server.pair_locked_for(1015.0), 590)
        self.assertGreater(server.pair_locked_for(1015.0, ip="192.0.2.5"), 590)

    # coordinator 21 Nov (1): the same wrong code again from one address is not a new try
    def test_the_same_wrong_code_six_times_counts_once(self):
        for _ in range(6):
            server.pair_wrong(1000.0, ip="192.0.2.5", guess="123456")
        self.assertEqual(server.pair_locked_for(1000.0, ip="192.0.2.5"), 0)
        self.assertEqual(len(server._pair_all.tries), 1)

    def test_ipv6_counts_by_its_slash_64_and_mapped_ipv4_is_the_same(self):
        k = server.pair_address_key
        self.assertEqual(k("2001:db8:1:2::5"), k("2001:db8:1:2:aaaa:bbbb:cccc:9"))
        self.assertNotEqual(k("2001:db8:1:2::5"), k("2001:db8:1:3::5"))
        self.assertEqual(k("::ffff:192.0.2.5"), "192.0.2.5")
        for i in range(5):
            server.pair_wrong(1000.0 + i, ip=f"2001:db8:1:2::{i + 1:x}", guess=f"{i:06d}")
        self.assertGreater(server.pair_locked_for(1005.0, ip="2001:db8:1:2::abc"), 590)

    def test_at_most_1000_addresses_are_kept(self):
        for i in range(1200):
            server.pair_wrong(1000.0 + i * 0.1, ip=f"198.51.{100 + i // 250}.{i % 250}", guess="1")
            server._pair_all.tries, server._pair_all.until = [], 0.0
        self.assertEqual(len(server._pair_by_address), server.PAIR_LOCK_ADDRESSES)


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
        with patch.object(server, "client_ip", lambda r: r.headers.get("X-Test-Ip")), \
                patch.object(server, "is_rate_limited", lambda ip: False):
            for i in range(14):   # 5, 5 and 4 from three addresses
                r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": f"192.0.2.{i // 5 + 1}"}, json={"code": f"{100000 + i}"})
                self.assertEqual(r.status, 401)
            self.assertEqual(server.pair_locked_for(ip="192.0.2.9"), 0)
            r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.3"}, json={"code": "123456"})
            self.assertEqual(r.status, 401)          # the 15th is still answered, and locks everyone
            self.assertGreater(server.pair_locked_for(ip="192.0.2.9"), 590)
            r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.9"}, json={"code": "999999"})
            self.assertEqual(r.status, 429)
            j = await r.json()
            self.assertEqual(j.get("error_key"), "err_pairing_locked")
            self.assertIn("Wait 10 min", j.get("error", ""))
            self.assertGreater(j.get("retry_after", 0), 590)
            self.assertGreater(int(r.headers.get("Retry-After", "0")), 590)
        # a phone already holding the key keeps working
        r = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
        self.assertEqual(r.status, 200)

    async def test_one_guessing_address_never_shuts_out_the_apple_tv(self):
        self.live_code()
        with patch.object(server, "client_ip", lambda r: r.headers.get("X-Test-Ip")), \
                patch.object(server, "is_rate_limited", lambda ip: False), \
                patch.dict(server.TVS, {"living-room": __import__("types").SimpleNamespace(name="Living room")}):
            for i in range(6):   # the same wrong code six times: one try
                r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.66"}, json={"code": "100000"})
                self.assertEqual(r.status, 401)
            for i in range(4):   # 4 more different ones: 5 in all
                r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.66"}, json={"code": f"{100001 + i}"})
                self.assertEqual(r.status, 401)
            r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.66"}, json={"code": "999999"})
            self.assertEqual(r.status, 429)          # the guesser waits, even with the right code
            self.assertIn("Wait 10 min", (await r.json()).get("error", ""))
            r = await self.client.post("/api/appletv/claim", headers={"X-Test-Ip": "192.0.2.20"}, json={"code": "999999"})
            self.assertEqual(r.status, 200)          # the Apple TV at another address: pairs
            self.assertEqual((await r.json()).get("key"), "couchpass123")

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
