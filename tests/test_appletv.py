"""bridge/appletv.py against a stand-in Apple TV (tests/appletv_standin.py): OPACK and TLV8, pairing with a
PIN (right and wrong), the sealed session, keys, power, app list, opening apps and the wake hook."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import appletv as A
import apps
from appletv_standin import StandIn
from tv import TVUnavailable


def hids(s):
    return [(c, d) for k, *r in s.log if k == "hid" for c, d in [tuple(r)]]


class Codec(unittest.TestCase):
    def test_opack_round_trip(self):
        for v in [None, True, False, 0, 39, 40, 255, 256, 70000, 2 ** 40, 1.5, "", "hi", "x" * 40, "x" * 300,
                  b"", b"\0\1", b"y" * 40, [], [1, "a"], list(range(20)), {}, {"_i": "a", "_c": {"k": [1, 2]}},
                  {str(i): i for i in range(20)}]:
            self.assertEqual(A.opack_decode(A.opack_encode(v)), v)

    def test_opack_known_bytes(self):
        self.assertEqual(A.opack_encode({"a": 1}), b"\xe1\x41a\x09")
        self.assertEqual(A.opack_decode(b"\xd2\x41a\xa0"), ["a", "a"])  # a back reference

    def test_opack_garbage_is_an_error_not_a_crash(self):
        for bad in (b"", b"\xd5\x08", b"\x61", b"\xff"):
            with self.assertRaises(A.AppleTVError):
                A.opack_decode(bad)

    def test_tlv_splits_and_joins_long_values(self):
        raw = A.tlv_encode([(A.T_SEQ, b"\1"), (A.T_PUBLIC_KEY, b"k" * 600)])
        out = A.tlv_decode(raw)
        self.assertEqual(out[A.T_PUBLIC_KEY], b"k" * 600)
        self.assertEqual(out[A.T_SEQ], b"\1")

    def test_srp_prime_is_a_safe_prime(self):
        import random
        for n in (A.SRP_N, (A.SRP_N - 1) // 2):
            d, s = n - 1, 0
            while d % 2 == 0:
                d //= 2
                s += 1
            for _ in range(8):
                a = random.randrange(2, n - 1)
                x = pow(a, d, n)
                if x in (1, n - 1):
                    continue
                for _ in range(s - 1):
                    x = x * x % n
                    if x == n - 1:
                        break
                else:
                    self.fail("not prime")
        self.assertEqual(A.SRP_N.bit_length(), 3072)


class Base(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.s = await StandIn().__aenter__()
        self.tv = self.s.tv(self.d.name)

    async def asyncTearDown(self):
        await self.tv._drop()
        await self.s.__aexit__()
        self.d.cleanup()

    async def pair(self):
        await self.tv.pair_start()
        await self.tv.pair_finish(self.s.pin)


class Pairing(Base):
    async def test_unpaired_says_so(self):
        self.assertFalse(self.tv.paired)
        with self.assertRaises(TVUnavailable):
            await self.tv._ask("FetchAttentionState")

    async def test_pairing_with_the_right_pin_keeps_a_private_file(self):
        await self.pair()
        self.assertTrue(self.tv.paired)
        self.assertEqual(oct(os.stat(self.tv.store_file).st_mode & 0o777), "0o600")
        self.assertEqual(len(self.s.paired), 1)
        self.assertEqual(await self.tv._read_attention(), A.AWAKE)

    async def test_wrong_pin_is_refused_and_keeps_nothing(self):
        await self.tv.pair_start()
        with self.assertRaises(A.PairingError):
            await self.tv.pair_finish("9999")
        self.assertFalse(self.tv.paired)
        self.assertEqual(self.s.paired, {})

    async def test_finish_without_start(self):
        with self.assertRaises(A.PairingError):
            await self.tv.pair_finish("1234")

    async def test_an_apple_tv_that_forgot_us_asks_to_pair_again(self):
        await self.pair()
        self.s.paired.clear()
        with self.assertRaises(A.PairingError):
            await self.tv._ask("FetchAttentionState")

    async def test_a_different_apple_tv_is_not_trusted(self):
        await self.pair()
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        self.s.ltsk = Ed25519PrivateKey.generate()      # someone else answering on the same address
        with self.assertRaises(A.PairingError):
            await self.tv._ask("FetchAttentionState")

    async def test_credentials_are_never_in_the_status(self):
        await self.pair()
        text = json.dumps(self.tv.status())
        with open(self.tv.store_file) as f:
            cred = json.load(f)
        for secret in (cred["ltsk"], cred["atv_ltpk"]):
            self.assertNotIn(secret, text)


class Remote(Base):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.pair()

    async def test_keys_send_down_then_up(self):
        for name, code in (("up", 1), ("ok", 6), ("back", 5), ("play_pause", 14), ("volume_up", 8), ("apple_home", 7)):
            self.s.log.clear()
            await self.tv.key(name)
            await asyncio.sleep(0.2)
            self.assertEqual(hids(self.s), [(code, "down"), (code, "up")], name)

    async def test_hold_waits_between_down_and_up(self):
        t0 = time.monotonic()
        await self.tv.key("select", hold=True)
        await asyncio.sleep(0.1)
        self.assertGreater(time.monotonic() - t0, 0.9)

    async def test_unknown_key(self):
        with self.assertRaises(ValueError):
            await self.tv.key("banana")

    async def test_home_without_an_app_explains(self):
        with self.assertRaisesRegex(ValueError, "apple_home"):
            await self.tv.key("home")

    async def test_home_with_an_app_opens_it(self):
        tv = self.s.tv(self.d.name, app_id="app.couchtv.tvos")
        try:
            self.assertEqual(await tv.key("home"), "couch-tv")
            self.assertIn(("launch", "app.couchtv.tvos"), self.s.log)
        finally:
            await tv._drop()

    async def test_sleep_and_wake_from_power(self):
        await self.tv._read_attention()
        await self.tv.key("power")
        await asyncio.sleep(0.2)
        self.assertEqual(self.s.attention, A.ASLEEP)
        await self.tv._read_attention()
        await self.tv.key("power")
        await asyncio.sleep(0.2)
        self.assertEqual(self.s.attention, A.AWAKE)

    async def test_typing_is_not_supported_and_says_so(self):
        with self.assertRaisesRegex(TVUnavailable, "not supported"):
            await self.tv.text("bluey")

    async def test_attention_decides_on_and_off(self):
        self.s.attention = A.SCREENSAVER
        await self.tv._read_attention()
        self.assertFalse(self.tv.is_on)
        self.s.attention = A.AWAKE
        await self.tv._read_attention()
        self.assertTrue(self.tv.is_on)

    async def test_the_session_survives_a_dropped_connection(self):
        await self.tv._read_attention()
        await self.tv._link.close()          # the Apple TV went away mid session
        self.tv._link.w = None
        self.assertEqual(await self.tv._read_attention(), A.AWAKE)   # reconnects and verifies again
        self.assertGreaterEqual(self.s.connections, 2)


class Apps(Base):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.pair()

    async def test_app_list_maps_known_apps(self):
        await self.tv.refresh_installed(force=True)
        self.assertEqual(self.tv.ids["com.netflix.Netflix"], "com.netflix.ninja")
        self.assertIn("com.example.other", {c["id"] for c in self.tv.channels})
        stan = [c for c in self.tv.channels if c["title"] == "Stan"][0]
        self.assertEqual(stan["package"], apps.BY_ID["stan"]["package"])      # by display name

    async def test_launch_by_android_package_opens_the_bundle(self):
        await self.tv.launch_package("com.netflix.ninja")
        self.assertIn(("launch", "com.netflix.Netflix"), self.s.log)

    async def test_launch_unknown_bundle_and_not_installed(self):
        await self.tv.launch_package("appletv.com.example.other")
        self.assertIn(("launch", "com.example.other"), self.s.log)
        with self.assertRaises(TVUnavailable):
            await self.tv.launch_package("com.disney.disneyplus")             # known, not on this Apple TV
        with self.assertRaises(ValueError):
            await self.tv.launch_package("not.an.app.we.know")

    async def test_refused_launch_is_reported(self):
        self.s.fail_launch.add("com.netflix.Netflix")
        with self.assertRaisesRegex(TVUnavailable, "would not open"):
            await self.tv.launch_package("com.netflix.ninja")

    async def test_bad_bundle_ids_never_reach_the_wire(self):
        for bad in ("", "a b", "x;y", "a" * 200, None):
            with self.assertRaises(ValueError):
                await self.tv._launch(bad)
        self.assertNotIn("launch", [k for k, *_ in self.s.log])

    async def test_a_show_link_opens_the_app_only(self):
        self.assertEqual(await self.tv.start_intent("https://www.netflix.com/title/80057281", "com.netflix.ninja"), "app")
        self.assertIn(("launch", "com.netflix.Netflix"), self.s.log)


class Hook(Base):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.pair()

    async def test_wake_opens_couch_tv_when_an_app_is_named(self):
        tv = self.s.tv(self.d.name, app_id="app.couchtv.tvos")
        try:
            await tv._hook()
            self.assertIn(("launch", "app.couchtv.tvos"), self.s.log)
        finally:
            await tv._drop()

    async def test_wake_does_nothing_without_an_app(self):
        await self.tv._hook()
        self.assertNotIn("launch", [k for k, *_ in self.s.log])
        self.assertIn("no couch-tv app", self.tv.hook_log[-1][1])

    async def test_a_command_just_run_wins(self):
        tv = self.s.tv(self.d.name, app_id="app.couchtv.tvos")
        tv.quiet_until = time.monotonic() + 20
        await tv._hook()
        self.assertNotIn("launch", [k for k, *_ in self.s.log])

    async def test_watcher_fires_the_hook_on_a_wake_edge(self):
        tv = self.s.tv(self.d.name, app_id="app.couchtv.tvos")
        self.s.attention = A.ASLEEP
        await tv.start()
        try:
            await asyncio.sleep(0.5)
            self.assertFalse(tv.is_on)
            self.s.attention = A.AWAKE
            for _ in range(80):
                await asyncio.sleep(0.1)
                if ("launch", "app.couchtv.tvos") in self.s.log:
                    break
            self.assertIn(("launch", "app.couchtv.tvos"), self.s.log)
        finally:
            for t in tv._tasks:
                t.cancel()
            await tv._drop()


MINE = "dev.couchtv.appletv.example"


class OwnApp(Base):
    """couch-tv's own tvOS app (tvos/): found by its bundle id without app_id, opened on wake and by Home."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.pair()
        self.s.apps[MINE] = "Couch TV"

    async def test_found_by_its_bundle_id(self):
        await self.tv.refresh_installed(force=True)
        self.assertEqual(self.tv.home_bundle(), MINE)
        self.assertNotIn(MINE, {c["id"] for c in await self.tv.apps_on_tv()})

    async def test_app_id_wins(self):
        tv = self.s.tv(self.d.name, app_id="app.couchtv.tvos")
        try:
            await tv.refresh_installed(force=True)
            self.assertEqual(tv.home_bundle(), "app.couchtv.tvos")
        finally:
            await tv._drop()

    async def test_a_lookalike_id_is_not_couch_tv(self):
        del self.s.apps[MINE]
        self.s.apps["dev.couchtv.appletvx"] = "Not us"
        await self.tv.refresh_installed(force=True)
        self.assertIsNone(self.tv.home_bundle())

    async def test_wake_opens_it_without_app_id(self):
        await self.tv._hook()
        self.assertIn(("launch", MINE), self.s.log)
        self.assertIn("opened couch-tv", self.tv.hook_log[-1][1])

    async def test_wake_left_alone_when_switched_off(self):
        tv = self.s.tv(self.d.name, open_on_power_on=False)
        try:
            await tv._hook()
            self.assertNotIn(("launch", MINE), self.s.log)
            self.assertIn("open_on_power_on is off", tv.hook_log[-1][1])
        finally:
            await tv._drop()

    async def test_home_key_opens_it(self):
        self.assertEqual(await self.tv.key("home"), "couch-tv")
        self.assertIn(("launch", MINE), self.s.log)

    async def test_open_bundle_only_opens_listed_apps(self):
        await self.tv.open_bundle("com.netflix.Netflix")
        self.assertIn(("launch", "com.netflix.Netflix"), self.s.log)
        with self.assertRaises(TVUnavailable):
            await self.tv.open_bundle("com.example.notinstalled")
        with self.assertRaises(ValueError):
            await self.tv.open_bundle("x;y")


class HomeEndpoints(Base):
    """The bridge endpoints couch-tv's Apple TV app uses, behind the real middleware, with a pairing key."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.pair()
        self.s.apps[MINE] = "Couch TV"
        import server
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        from unittest.mock import patch
        self.server = server
        self.other = server.make_tv({"id": "den", "name": "Den", "ip": "192.0.2.77"})      # an Android TV
        self._p = [patch.multiple(server, TVS={"lounge": self.tv, "den": self.other}, DEFAULT_TV="den"),
                   patch.object(A.config, "PAIRING_KEY", "couchpass123"),
                   patch.object(server.store, "DATA", self.d.name)]
        for p in self._p:
            p.start()
        server._failed_attempts.clear()
        server.appletv_codes.clear()
        app = web.Application(middlewares=[server.middleware])
        for path, h in (("/api/appletv/hello", server.h_appletv_hello), ("/api/appletv/apps", server.h_appletv_apps)):
            app.router.add_get(path, h)
        for path, h in (("/api/appletv/open", server.h_appletv_open), ("/api/appletv/code", server.h_appletv_code),
                        ("/api/appletv/claim", server.h_appletv_claim)):
            app.router.add_post(path, h)
        self.client = TestClient(TestServer(app, host="127.0.0.1"))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        for p in reversed(self._p):
            p.stop()
        self.server._failed_attempts.clear()
        self.server.appletv_codes.clear()
        await super().asyncTearDown()

    KEY = {"Authorization": "Bearer couchpass123"}

    def post(self, path, data, key=True):
        h = {"Content-Type": "application/json", **(self.KEY if key else {})}
        return self.client.post(path, headers=h, data=json.dumps(data))

    async def test_everything_but_claim_needs_the_key(self):
        for r in (await self.client.get("/api/appletv/hello"), await self.client.get("/api/appletv/apps?tv=lounge"),
                  await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix"}, key=False),
                  await self.post("/api/appletv/code?tv=lounge", {}, key=False)):
            self.assertEqual(r.status, 401)
        self.assertNotIn("launch", [k for k, *_ in self.s.log])

    async def test_hello_finds_the_apple_tv_by_its_address(self):
        r = await self.client.get("/api/appletv/hello", headers=self.KEY)      # the stand-in is at 127.0.0.1
        j = await r.json()
        self.assertEqual((r.status, j["tv"], j["name"]), (200, "lounge", "Lounge"))

    async def test_apps_leave_out_couch_tv_and_keep_bundle_ids(self):
        r = await self.client.get("/api/appletv/apps?tv=lounge", headers=self.KEY)
        j = await r.json()
        ids = [a["id"] for a in j["apps"]]
        self.assertNotIn(MINE, ids)
        self.assertIn("com.netflix.Netflix", ids)
        netflix = [a for a in j["apps"] if a["id"] == "com.netflix.Netflix"][0]
        self.assertEqual(netflix["package"], "com.netflix.ninja")                # names the bundled logo
        self.assertEqual(ids[-1], "com.example.other")                          # unknown apps after known ones

    async def test_apps_follow_the_order_from_the_phone(self):
        with open(os.path.join(self.d.name, "app-order.lounge.json"), "w") as f:
            json.dump({"order": ["appletv.com.example.other", "com.netflix.ninja"], "line": 2}, f)
        with open(os.path.join(self.d.name, "home-apps.lounge.json"), "w") as f:
            json.dump({"apps": [{"package": "com.netflix.ninja", "name": "Netflix"},
                                {"package": "appletv.com.example.other", "name": "Some Other App"}]}, f)
        j = await (await self.client.get("/api/appletv/apps?tv=lounge", headers=self.KEY)).json()
        self.assertEqual([a["id"] for a in j["apps"]][:2], ["com.example.other", "com.netflix.Netflix"])
        self.assertEqual(j["line"], 2)

    async def test_open_by_bundle_id(self):
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix"})
        self.assertEqual(r.status, 200)
        self.assertIn(("launch", "com.netflix.Netflix"), self.s.log)

    async def test_open_refuses_bad_and_missing_apps(self):
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix; rm"})
        self.assertEqual(r.status, 400)
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.example.gone"})
        self.assertEqual(r.status, 503)
        self.s.fail_launch.add("com.netflix.Netflix")
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix"})
        self.assertEqual(r.status, 502)

    async def test_not_for_other_tvs(self):
        r = await self.post("/api/appletv/open?tv=den", {"bundle": "com.netflix.Netflix"})
        self.assertEqual(r.status, 400)
        r = await self.client.get("/api/appletv/apps", headers=self.KEY)      # the default TV is the Android one
        self.assertEqual(r.status, 400)

    async def test_code_is_swapped_for_the_key_once(self):
        j = await (await self.post("/api/appletv/code?tv=lounge", {})).json()
        self.assertRegex(j["code"], r"^\d{6}$")
        r = await self.post("/api/appletv/claim", {"code": j["code"]}, key=False)
        got = await r.json()
        self.assertEqual((r.status, got["key"], got["tv"]), (200, "couchpass123", "lounge"))
        r = await self.post("/api/appletv/claim", {"code": j["code"]}, key=False)
        self.assertEqual(r.status, 401)

    async def test_codes_run_out(self):
        j = await (await self.post("/api/appletv/code?tv=lounge", {})).json()
        exp, tv_id = self.server.appletv_codes[j["code"]]
        self.server.appletv_codes[j["code"]] = (time.monotonic() - 1, tv_id)
        r = await self.post("/api/appletv/claim", {"code": j["code"]}, key=False)
        self.assertEqual(r.status, 401)

    async def test_wrong_codes_are_rate_limited(self):
        from unittest.mock import patch
        good = (await (await self.post("/api/appletv/code?tv=lounge", {})).json())["code"]
        with patch.object(self.server, "client_ip", return_value="192.0.2.50"):
            for guess in [g for g in ("111111", "222222", "333333", "444444", "555555", "666666") if g != good][:5]:
                r = await self.post("/api/appletv/claim", {"code": guess}, key=False)
                self.assertEqual(r.status, 401)
            r = await self.post("/api/appletv/claim", {"code": good}, key=False)
            self.assertEqual(r.status, 429)


class Bonjour(unittest.IsolatedAsyncioTestCase):
    async def test_only_with_an_apple_tv_and_never_the_key(self):
        import server
        from unittest.mock import AsyncMock, patch
        android = server.make_tv({"id": "den", "name": "Den", "ip": "192.0.2.77"})
        with patch.multiple(server, TVS={"den": android}):
            self.assertIsNone(await server.advertise_for_appletv())
        atv = server.make_tv({"id": "x", "name": "X", "kind": "appletv", "ip": "192.0.2.9"})
        zc = AsyncMock()
        with patch.multiple(server, TVS={"x": atv}), patch.object(server, "_lan_address", return_value="192.0.2.10"), \
                patch("zeroconf.asyncio.AsyncZeroconf", return_value=zc), patch.object(A.config, "PAIRING_KEY", "couchpass123"), \
                patch.dict(os.environ, {}, clear=False):
            os.environ.pop("COUCHTV_NO_BONJOUR", None)
            got = await server.advertise_for_appletv()
        self.assertIsNotNone(got)
        info = zc.async_register_service.call_args[0][0]
        self.assertEqual(info.type, "_couchtv._tcp.local.")
        props = {k.decode(): (v or b"").decode() for k, v in info.properties.items()}
        self.assertEqual(props["ip"], "192.0.2.10")
        self.assertNotIn("couchpass123", json.dumps(props))


class Shape(unittest.TestCase):
    def test_server_builds_the_driver(self):
        import server
        tv = server.make_tv({"id": "x", "name": "X", "kind": "appletv", "ip": "127.0.0.1"})
        self.assertEqual(tv.kind, "appletv")
        self.assertIsNone(tv.is_on)


if __name__ == "__main__":
    unittest.main()
