"""bridge/vizio.py against a stand in VIZIO SmartCast TV (tests/vizio_standin.py): finding the port
(7345, then 9000), pairing with the PIN and keeping the token at 0600, keys, power, volume, opening
apps, inputs, what is in front, the errors (a wrong PIN, a bad token, the TV off, something else on the
port), and the bridge endpoints behind the pairing key. NOT a real VIZIO: see docs/VIZIO.md."""
import asyncio
import json
import logging
import os
import shutil
import socket
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import agentic  # noqa: E402
import config  # noqa: E402
import server  # noqa: E402
import vizio  # noqa: E402
from tv import TVUnavailable  # noqa: E402
from vizio_standin import PIN, REQ_TOKEN, TOKEN, NotAVizio, StandIn  # noqa: E402

KEY = "/key_command/"


def free_port():
    """A port nothing listens on (bound, then let go)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Base(unittest.IsolatedAsyncioTestCase):
    tls = False
    paired = True

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="vizio-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self.s = await StandIn(self.tls).__aenter__()
        self.tv = self.s.tv()
        if self.paired:
            self.s.token = TOKEN
            self.tv._keep(token=TOKEN)

    async def asyncTearDown(self):
        await self.tv.close()
        await self.s.__aexit__()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def keys(self):
        return [(k["CODESET"], k["CODE"], k["ACTION"]) for b in self.s.sent(KEY) for k in b["KEYLIST"]]


class Ports(Base):
    async def test_the_configured_port_is_used(self):
        self.assertEqual(await self.tv.find_port(), self.s.port)

    async def test_7345_then_9000(self):
        self.assertEqual(vizio.VizioTV({"id": "x", "name": "X", "ip": "192.0.2.9"}).ports, [7345, 9000])

    async def test_falls_back_to_the_second_port(self):
        t = self.s.tv()
        t.ports, t.port = [free_port(), self.s.port], None
        try:
            self.assertEqual(await t.find_port(), self.s.port)
            self.assertEqual(await t._read_power(), 1)
        finally:
            await t.close()

    async def test_something_else_on_the_first_port_is_passed_over(self):
        async with NotAVizio() as other:
            t = self.s.tv()
            t.ports, t.port = [other.port, self.s.port], None
            try:
                self.assertEqual(await t.find_port(), self.s.port)
            finally:
                await t.close()

    async def test_nothing_answers(self):
        t = self.s.tv()
        t.ports, t.port = [free_port(), free_port()], None
        try:
            with self.assertRaises(TVUnavailable) as cm:
                await t.find_port()
            self.assertIn("no SmartCast answer", str(cm.exception))
        finally:
            await t.close()


class TLS(Base):
    """HTTPS with the TV's own self signed certificate, made at test time."""
    tls = True

    async def asyncSetUp(self):
        if not shutil.which("openssl"):
            self.skipTest("needs the openssl command")
        await super().asyncSetUp()

    async def test_self_signed_certificate_is_accepted_for_this_tv(self):
        self.assertTrue(self.tv.tls)
        self.assertEqual(await self.tv._read_power(), 1)
        ctx = self.tv._ssl()
        self.assertEqual(ctx.verify_mode, vizio.ssl.CERT_NONE)

    async def test_plain_http_to_an_https_tv_is_not_an_answer(self):
        # the stand in turning away a plain request is logged by asyncio: expected
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: None)
        t = self.s.tv(tls=False)
        try:
            with self.assertRaises(TVUnavailable):
                await t._call("GET", vizio.PROTOCOL["power"])
        finally:
            await t.close()


class Pairing(Base):
    paired = False

    async def test_pin_then_token_then_the_token_is_used(self):
        await self.tv.pair_start()
        self.assertTrue(self.s.pin_shown)
        start = self.s.sent("/pairing/start")[0]
        self.assertEqual(start["DEVICE_ID"], self.tv.device_id)
        self.assertTrue(start["DEVICE_NAME"])
        await self.tv.pair_finish(PIN)
        sent = self.s.sent("/pairing/pair")[0]
        self.assertEqual((sent["RESPONSE_VALUE"], sent["PAIRING_REQ_TOKEN"], sent["CHALLENGE_TYPE"]), (PIN, REQ_TOKEN, 1))
        self.assertEqual(self.tv.token, TOKEN)
        self.assertTrue(self.tv.paired)
        self.assertEqual(await self.tv._read_power(), 1)
        self.assertEqual(self.s.log[-1][3], TOKEN)                  # the AUTH header

    async def test_token_file_is_0600_and_keeps_the_device_id(self):
        await self.tv.pair_start()
        await self.tv.pair_finish(PIN)
        mode = stat.S_IMODE(os.stat(self.tv.store_file).st_mode)
        self.assertEqual(mode, 0o600)
        kept = json.load(open(self.tv.store_file))
        self.assertEqual(kept["token"], TOKEN)
        self.assertNotIn("pending", kept)
        self.assertEqual(self.s.tv().device_id, self.tv.device_id)  # the next start is the same device

    async def test_the_pin_can_come_from_another_run(self):
        await self.tv.pair_start()
        other = self.s.tv()
        await other.pair_finish(PIN)
        self.assertEqual(other.token, TOKEN)
        await other.close()

    async def test_a_wrong_pin_keeps_no_token(self):
        await self.tv.pair_start()
        with self.assertRaises(vizio.VizioError) as cm:
            await self.tv.pair_finish("0000")
        self.assertIn("refused the PIN", str(cm.exception))
        self.assertIsNone(self.tv.token)
        with self.assertRaises(vizio.VizioError):              # the PIN request is used up: ask again
            await self.tv.pair_finish(PIN)

    async def test_too_many_wrong_pins(self):
        self.s.wrong_pins = 3
        await self.tv.pair_start()
        with self.assertRaises(vizio.VizioError) as cm:
            await self.tv.pair_finish(PIN)
        self.assertIn("too many", str(cm.exception))

    async def test_tv_already_pairing(self):
        self.s.busy = True
        with self.assertRaises(vizio.VizioError) as cm:
            await self.tv.pair_start()
        self.assertIn("already", str(cm.exception))

    async def test_pin_shape_checked_before_anything_is_sent(self):
        await self.tv.pair_start()
        for bad in ("12a4", "123", "12345", ""):
            with self.assertRaises(ValueError):
                await self.tv.pair_finish(bad)
        self.assertEqual(self.s.sent("/pairing/pair"), [])

    async def test_finish_without_start(self):
        with self.assertRaises(vizio.VizioError):
            await self.tv.pair_finish(PIN)

    async def test_unpaired_reads_say_pair_first(self):
        with self.assertRaises(vizio.NeedsPairing) as cm:
            await self.tv._read_power()
        self.assertIn("pairing first", str(cm.exception))

    async def test_trace_never_logs_the_pin_or_the_tokens(self):
        t = self.s.tv(trace=True)
        with self.assertLogs("vizio.lounge", logging.INFO) as logs:
            await t.pair_start()
            await t.pair_finish(PIN)
            await t._read_power()
        text = "\n".join(logs.output)
        self.assertIn("trace", text)
        for secret in (PIN, TOKEN, str(REQ_TOKEN)):
            self.assertNotIn(secret, text)
        await t.close()


class BadToken(Base):
    async def test_a_token_the_tv_no_longer_takes(self):
        self.s.token = "a-different-one"
        with self.assertRaises(vizio.NeedsPairing) as cm:
            await self.tv._read_power()
        self.assertIn("pair again", str(cm.exception))
        with self.assertRaises(vizio.NeedsPairing):
            await self.tv.key("up")

    async def test_the_watcher_reports_it_plainly(self):
        self.s.token = "a-different-one"
        await self.tv.poll()
        self.assertTrue(self.tv.connected)
        self.assertIsNone(self.tv.is_on)
        self.assertIn("pair again", self.tv.vizio_status()["error"])


class Keys(Base):
    async def test_remote_keys(self):
        for k in ("up", "down", "left", "right", "ok", "back", "menu", "home", "input", "exit"):
            await self.tv.key(k)
        self.assertEqual([(a, b) for a, b, _c in self.keys()],
                         [(3, 8), (3, 0), (3, 1), (3, 7), (3, 2), (4, 0), (4, 8), (4, 15), (7, 1), (9, 0)])
        self.assertTrue(all(c == "KEYPRESS" for _a, _b, c in self.keys()))

    async def test_raw_codeset_and_code(self):
        self.assertEqual(await self.tv.key("8:2"), "8:2")
        self.assertEqual(self.keys(), [(8, 2, "KEYPRESS")])

    async def test_unknown_or_unsafe_key_is_refused_before_anything_is_sent(self):
        for bad in ("teleport", "99:1", "4:999", "", "4:15; rm", None):
            with self.assertRaises(ValueError):
                await self.tv.key(bad)
        self.assertEqual(self.s.sent(KEY), [])

    async def test_play_pause_alternates(self):
        for _ in range(3):
            await self.tv.key("play_pause")
        self.assertEqual([(a, b) for a, b, _c in self.keys()], [(2, 3), (2, 2), (2, 3)])

    async def test_a_hold_is_down_then_up(self):
        with patch.object(vizio.asyncio, "sleep", return_value=None):
            await self.tv.key("right", hold=True)
        self.assertEqual(self.keys(), [(3, 7, "KEYDOWN"), (3, 7, "KEYUP")])

    async def test_typing_is_not_built(self):
        with self.assertRaises(TVUnavailable):
            await self.tv.text("bluey")

    async def test_nothing_sent_when_the_tv_is_off_the_network(self):
        self.tv.connected = False
        with self.assertRaises(TVUnavailable):
            await self.tv.key("up")
        self.assertEqual(self.s.sent(KEY), [])

    async def test_home_page_cannot_open(self):
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.open_home()
        self.assertIn("cannot open on a VIZIO", str(cm.exception))


class Power(Base):
    async def test_on_off_and_unknown(self):
        await self.tv.poll()
        self.assertTrue(self.tv.is_on)
        await self.tv.key("power")
        self.assertEqual(self.keys()[-1][:2], (11, 0))
        self.assertEqual(self.s.power, 0)
        await self.tv.poll()
        self.assertIs(self.tv.is_on, False)
        await self.tv.key("power")
        self.assertEqual(self.keys()[-1][:2], (11, 1))
        self.assertEqual(self.s.power, 1)
        self.tv.power = None
        await self.tv.key("power")
        self.assertEqual(self.keys()[-1][:2], (11, 2))

    async def test_tv_off_the_network_is_unknown_then_wake_on_lan(self):
        self.tv.ports, self.tv.port = [free_port()], None
        await self.tv.poll()
        self.assertFalse(self.tv.connected)
        self.assertIsNone(self.tv.is_on)
        self.tv.mac = "aabbccddeeff"   # written without separators, as config allows
        sent = []

        class Sock:
            def __init__(self, *a):
                pass

            def setsockopt(self, *a):
                pass

            def sendto(self, packet, addr):
                sent.append((packet, addr))

            def close(self):
                pass
        with patch.object(vizio.socket, "socket", Sock):
            self.assertEqual(await self.tv.key("power"), "wake")
        self.assertTrue(sent)
        self.assertEqual(sent[0][0], b"\xff" * 6 + bytes.fromhex("AABBCCDDEEFF") * 16)
        self.assertEqual(self.s.sent(KEY), [])

    async def test_no_wake_without_a_mac(self):
        self.tv.connected = False
        with patch.object(vizio.socket, "socket") as sock:
            await self.tv.key("power")
        sock.assert_not_called()

    async def test_change_is_announced(self):
        seen = []
        self.tv.on_change(lambda: seen.append(self.tv.is_on))
        await self.tv.poll()
        self.s.power = 0
        await self.tv.poll()
        self.assertEqual(seen, [True, False])


class Volume(Base):
    async def test_level_read_and_keys_move_it(self):
        await self.tv.read_volume()
        self.assertEqual(self.tv.volume, {"level": 20, "max": 100, "muted": None, "known": True})
        await self.tv.key("volume_up")
        await self.tv.key("volume_up")
        await self.tv.key("volume_down")
        await self.tv.key("mute")
        self.assertEqual([(a, b) for a, b, _c in self.keys()], [(5, 1), (5, 1), (5, 0), (5, 4)])
        await self.tv.read_volume()
        self.assertEqual(self.tv.volume["level"], 21)

    async def test_no_level_when_the_tv_does_not_say(self):
        self.s.token = "x"   # every read refused
        await self.tv.read_volume()
        self.assertFalse(self.tv.volume["known"])


class Apps(Base):
    async def test_catalogue_apps_open_with_vizios_ids(self):
        await self.tv.launch_package("com.netflix.ninja")
        await self.tv.launch_package("youtube")
        await self.tv.launch_package("hulu")
        sent = [b["VALUE"] for b in self.s.sent("/app/launch")]
        self.assertEqual([(v["NAME_SPACE"], v["APP_ID"]) for v in sent], [(3, "1"), (5, "1"), (2, "3")])
        self.assertEqual(set(sent[0]), {"NAME_SPACE", "APP_ID", "MESSAGE"})

    async def test_raw_name_space_and_id(self):
        await self.tv.launch_package("vizio.2.61")
        self.assertEqual(self.s.sent("/app/launch")[0]["VALUE"]["APP_ID"], "61")

    async def test_unknown_app_or_unsafe_id_sends_nothing(self):
        for bad in ("au.com.stan.and", "vizio.2.6 1", "vizio.x.1", "vizio.2.", "../../x"):
            with self.assertRaises(TVUnavailable):
                await self.tv.launch_package(bad)
        self.assertEqual(self.s.sent("/app/launch"), [])

    async def test_what_is_in_front(self):
        await self.tv.poll()
        self.assertIsNone(self.tv.current_package)                 # VIZIO's own home
        await self.tv.launch_package("netflix")
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}, timeout=2), "com.netflix.ninja")
        self.s.current_app = {"NAME_SPACE": 4, "APP_ID": "3", "MESSAGE": None}   # Hulu, under name space 4
        self.assertEqual(await self.tv.front_package(), "com.hulu.livingroomplus")
        self.s.current_app = {"NAME_SPACE": 2, "APP_ID": "999", "MESSAGE": None}
        self.assertEqual(await self.tv.front_package(), "vizio.2.999")
        self.s.current_app = None
        self.assertIsNone(await self.tv.front_package())

    async def test_tv_that_does_not_say_what_is_in_front(self):
        self.s.app_readable = False
        await self.tv.poll()
        self.assertIs(self.tv.front_readable, False)
        await self.tv.launch_package("netflix")
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}, timeout=1), "com.netflix.ninja")

    async def test_links_only_open_the_app_and_nothing_is_read_as_media(self):
        self.assertFalse(self.tv.can_read_media)
        self.assertFalse(self.tv.can_deeplink({"id": "netflix"}))
        self.assertEqual(await self.tv.start_intent("https://www.netflix.com/title/1", "com.netflix.ninja"), "app")
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://www.netflix.com/title/1")

    async def test_app_table_lists_known_ids(self):
        listed = {a["id"]: (a["name_space"], a["app_id"]) for a in await self.tv.apps_on_tv()}
        self.assertEqual(listed["netflix"], (3, "1"))
        self.assertIsNone(await self.tv.installed_packages())


class Inputs(Base):
    async def test_inputs_listed_with_the_owners_labels(self):
        got = await self.tv.read_sources()
        self.assertEqual(got[1], {"id": "HDMI-1", "name": "Xbox"})
        self.assertEqual(got[2], {"id": "HDMI-2", "name": "HDMI-2"})

    async def test_switch_by_label_number_or_name(self):
        self.assertEqual((await self.tv.switch_source("xbox"))["id"], "HDMI-1")
        self.assertEqual(self.s.current_input, "HDMI-1")
        self.assertEqual((await self.tv.switch_source("hdmi 2"))["id"], "HDMI-2")
        self.assertEqual((await self.tv.switch_source("1"))["id"], "HDMI-1")
        put = [b for m, p, b, _a in self.s.log if m == "PUT" and p == vizio.PROTOCOL["current_input"]][0]
        self.assertEqual(put, {"REQUEST": "MODIFY", "VALUE": "HDMI-1", "HASHVAL": 1000})   # HASHVAL from current_input

    async def test_unknown_input_sends_nothing(self):
        with self.assertRaises(ValueError):
            await self.tv.switch_source("playstation 9")
        self.assertFalse([1 for m, p, _b, _a in self.s.log if m == "PUT"])

    async def test_stale_hashval_is_an_error(self):
        self.tv.sources = [{"id": "HDMI-1", "name": "Xbox"}]
        with patch.object(self.tv, "current_input", return_value=("CAST", 1)):
            with self.assertRaises(vizio.VizioError):
                await self.tv.switch_source("xbox")
        self.assertEqual(self.s.current_input, "CAST")


class Endpoints(Base):
    """The bridge's VIZIO endpoints behind its real middleware, with a pairing key set."""
    paired = False

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tvs = patch.multiple(server, TVS={"lounge": self.tv}, DEFAULT_TV="lounge")
        self._tvs.start()
        self._key = patch.object(config, "PAIRING_KEY", "couchpass123")
        self._key.start()
        server._failed_attempts.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_post("/api/vizio/pair", server.h_vizio_pair)
        app.router.add_get("/api/vizio/apps", server.h_vizio_apps)
        app.router.add_get("/api/tvs", server.h_tvs)
        app.router.add_post("/api/key", server.h_key)
        app.router.add_get("/api/inputs", agentic.h_inputs)
        app.router.add_post("/api/input", agentic.h_input)
        self.client = TestClient(TestServer(app, host="127.0.0.1"))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self._key.stop()
        self._tvs.stop()
        server._failed_attempts.clear()
        await super().asyncTearDown()

    def post(self, path, body, key=True):
        h = {"Content-Type": "application/json"}
        if key:
            h["Authorization"] = "Bearer couchpass123"
        return self.client.post(path, headers=h, data=json.dumps(body))

    async def test_pairing_needs_the_key(self):
        r = await self.post("/api/vizio/pair", {}, key=False)
        self.assertEqual(r.status, 401)
        self.assertFalse(self.s.pin_shown)

    async def test_pairing_then_keys_and_inputs_through_the_bridge(self):
        r = await self.post("/api/vizio/pair", {})
        self.assertEqual((r.status, (await r.json())["step"]), (200, "pin"))
        r = await self.post("/api/vizio/pair", {"pin": "12a4"})
        self.assertEqual(r.status, 400)
        r = await self.post("/api/vizio/pair", {"pin": "9999"})
        self.assertEqual(r.status, 409)
        await self.post("/api/vizio/pair", {})
        r = await self.post("/api/vizio/pair", {"pin": PIN})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.tv.token, TOKEN)
        r = await self.post("/api/key", {"key": "up"})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.keys(), [(3, 8, "KEYPRESS")])
        r = await self.client.get("/api/inputs", headers={"Authorization": "Bearer couchpass123"})
        self.assertIn({"id": "HDMI-1", "name": "Xbox"}, (await r.json())["inputs"])
        r = await self.post("/api/input", {"name": "xbox"})
        self.assertEqual((r.status, (await r.json())["input"]), (200, "Xbox"))

    async def test_apps_and_tvs_status(self):
        r = await self.client.get("/api/vizio/apps", headers={"Authorization": "Bearer couchpass123"})
        self.assertTrue(any(a["id"] == "netflix" for a in (await r.json())["apps"]))
        r = await self.client.get("/api/tvs", headers={"Authorization": "Bearer couchpass123"})
        row = (await r.json())["tvs"][0]
        self.assertEqual(row["kind"], "vizio")
        self.assertEqual(set(row["vizio"]), {"port", "paired", "power", "app", "app_readable", "volume", "error"})
        self.assertFalse(row["paired"])

    async def test_make_tv_builds_a_vizio(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "vizio", "ip": "192.0.2.9"}),
                              vizio.VizioTV)

    async def test_a_device_id_with_odd_characters_is_refused(self):
        with self.assertRaises(SystemExit):
            vizio.VizioTV({"id": "x", "name": "X", "ip": "192.0.2.9", "device_id": "me/../x"})


if __name__ == "__main__":
    unittest.main()
