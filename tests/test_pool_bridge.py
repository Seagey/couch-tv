"""AstralPool Connect 10 through the home computer (bridge/pool.py, POST /api/pool) for web TVs. A pretend ConnectMyPool only:
the approval code comes from .env, never from config.json, never back to a TV; one status read a minute; three switches only."""
import json
import os
import sys
import unittest
from unittest.mock import patch

from aiohttp.test_utils import AioHTTPTestCase

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import pool  # noqa: E402
import server  # noqa: E402

CODE = "ABCD-1234-EFGH-5678"
CONFIG = {"pool_spa_selection_enabled": False, "heaters": [{"heater_ number": 1}],
          "channels": [{"channel_ number": 1, "function": 1, "name": "Filter Pump"}],
          "lighting_zones": [{"lighting_zone_number": 1, "name": "Pool lights", "color_enabled": True}]}
STATUS = {"temperature": 27, "heaters": [{"heater_number": 1, "mode": 1, "set_temperature": 29}], "channels": [{"channel_number": 1, "mode": 2}],
          "lighting_zones": [{"lighting_zone_number": 1, "mode": 2, "color": 5}]}


class FakeCmp:
    def __init__(self):
        self.calls = []
        self.throttle = False

    async def __call__(self, path, body, timeout=15):
        self.calls.append((path, body))
        if body.get("pool_api_code") != CODE:
            return 200, json.dumps({"failure_code": 3, "failure_description": "Invalid API Code"})
        if path == "/api/poolconfig":
            return 200, json.dumps(CONFIG)
        if path == "/api/poolstatus":
            if self.throttle:
                self.throttle = False
                return 200, json.dumps({"failure_code": 6})
            return 200, json.dumps(STATUS)
        return 200, json.dumps({"action_number": 9, "execution_status": 1})


class Module(unittest.IsolatedAsyncioTestCase):
    async def test_off_without_code_or_brand(self):
        self.assertFalse(pool.Pool({"brand": "connect10"}, None).enabled)
        self.assertFalse(pool.Pool({"brand": "connect10"}, "bad code!").enabled)
        self.assertFalse(pool.Pool({}, CODE).enabled)
        with self.assertRaises(pool.PoolError):
            await pool.Pool({}, CODE).status()

    async def test_readings_once_a_minute(self):
        t = [100.0]
        cmp = FakeCmp()
        p = pool.Pool({"brand": "connect10"}, CODE, post=cmp, clock=lambda: t[0])
        v = await p.status()
        self.assertEqual(v, {"ok": True, "unit": "c", "temp": 27, "pump": {"n": 1, "name": "Filter Pump", "mode": 2},
                             "heater": {"n": 1, "mode": 1, "set": 29}, "light": {"n": 1, "name": "Pool lights", "mode": 2, "colour": "Blue"}})
        t[0] += 30
        await p.status()
        self.assertEqual(len([c for c in cmp.calls if c[0] == "/api/poolstatus"]), 1)
        t[0] += 31
        cmp.throttle = True
        self.assertEqual((await p.status())["temp"], 27, "ConnectMyPool said wait: the last readings")

    async def test_three_switches_only(self):
        cmp = FakeCmp()
        p = pool.Pool({"brand": "connect10"}, CODE, post=cmp)
        await p.act({"kind": "heater", "dev": 1, "value": 0})
        sent = [c for c in cmp.calls if c[0] == "/api/poolaction"][-1][1]
        self.assertEqual((sent["action_code"], sent["device_number"], sent["value"]), (4, 1, "0"))
        for bad in ({"kind": "valve", "dev": 1, "value": 1}, {"kind": "pump", "dev": 9}, {"kind": "light", "dev": 1, "value": 7}, None):
            with self.assertRaises(pool.PoolError):
                await p.act(bad)

    async def test_wrong_code(self):
        p = pool.Pool({"brand": "connect10"}, "WRONG-CODE-0000", post=FakeCmp())
        with self.assertRaises(pool.PoolError) as e:
            await p.status()
        self.assertEqual(e.exception.code, "no_key")


class Route(AioHTTPTestCase):
    async def get_application(self):
        self.cmp = FakeCmp()
        self.p1 = patch.object(server, "POOL", pool.Pool({"brand": "connect10"}, CODE, post=self.cmp))
        self.p1.start()
        self.p2 = patch.object(config, "PAIRING_KEY", "")
        self.p2.start()
        return server.make_app()

    async def tearDownAsync(self):
        self.p1.stop()
        self.p2.stop()

    async def test_readings_and_a_switch_never_the_code(self):
        r = await self.client.post("/api/pool", json={})
        text = await r.text()
        self.assertEqual(json.loads(text)["pool"]["temp"], 27)
        self.assertNotIn(CODE, text)
        r = await self.client.post("/api/pool", json={"action": {"kind": "light", "dev": 1, "value": 0}})
        self.assertTrue((await r.json())["pool"]["ok"])
        r = await self.client.post("/api/pool", json={"action": {"kind": "gate", "dev": 1}})
        self.assertEqual((await r.json())["pool"], {"ok": False, "error": "refused"})

    async def test_no_code_on_this_computer(self):
        with patch.object(server, "POOL", pool.Pool({"brand": "connect10"}, None)):
            r = await self.client.post("/api/pool", json={})
            self.assertEqual((await r.json())["pool"], {"ok": False, "error": "computer_key"})


if __name__ == "__main__":
    unittest.main()
