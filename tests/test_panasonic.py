"""bridge/panasonic.py against a stand-in Panasonic Viera (tests/panasonic_standin.py): reading the TV, keys,
power, volume, opening apps only from the TV's own list, opening couch-tv's page in the browser with a one
time code, the power on hook and the watcher, pairing and the sealed commands of an encrypted set, error
paths, and the bridge endpoints with the pairing key. NOT a real TV: see docs/PANASONIC.md."""
import asyncio
import base64
import importlib.util
import json
import logging
import os
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import apps  # noqa: E402
import config  # noqa: E402
import panasonic  # noqa: E402
import server  # noqa: E402
from tv import TVUnavailable  # noqa: E402
from panasonic_standin import APP_ID, KEYWORD, PIN, SESSION, StandIn  # noqa: E402

FAST = dict(panasonic.PROTOCOL, browser_wait=0, connect_timeout=1.0)


class Base(unittest.IsolatedAsyncioTestCase):
    encrypted = False

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="panasonic-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self._proto = patch.object(panasonic, "PROTOCOL", FAST)
        self._proto.start()
        self.s = await StandIn().__aenter__()
        self.s.encrypted = self.encrypted
        self.tv = self.s.tv()
        self.extra = []

    async def asyncTearDown(self):
        for t in [self.tv] + self.extra:
            await t.close()
        await self.s.__aexit__()
        self._proto.stop()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def other(self, **cfg):
        t = self.s.tv(**cfg)
        self.extra.append(t)
        return t

    def keys(self):
        return [a.replace("<X_KeyEvent>", "").replace("</X_KeyEvent>", "") for a in self.s.sent("X_SendKey")]

    def launches(self):
        return [a.split("<X_LaunchKeyword>")[1].split("<")[0] for a in self.s.sent("X_LaunchApp")]

    async def settle(self):
        for _ in range(10):
            await asyncio.sleep(0.02)

    def pair_store(self):
        os.makedirs(self.data, exist_ok=True)
        with open(os.path.join(self.data, "panasonic-lounge.json"), "w") as f:
            json.dump({"app_id": APP_ID, "keyword": KEYWORD}, f)


class Reading(Base):
    async def test_device_description_and_plain_set(self):
        self.assertFalse(await self.tv.detect())
        self.assertIn("TX-55STANDIN", self.tv.model)
        self.assertEqual(self.tv.services["pac/control_0"], "urn:panasonic-com:service:p00PanaControl:1")
        st = self.tv.panasonic_status()
        self.assertEqual((st["encrypted"], st["paired"]), (False, False))

    async def test_encrypted_set_is_recognised_by_its_action_list(self):
        self.s.encrypted = True
        self.assertTrue(await self.tv.detect())

    async def test_config_can_say_encrypted_or_not(self):
        self.s.encrypted = True
        t = self.other(encrypted=False)
        self.assertFalse(await t.detect())

    async def test_app_list_and_package_names(self):
        await self.tv.refresh_installed()
        by = {a["name"]: a["package"] for a in await self.tv.apps_on_tv()}
        self.assertEqual(by["Netflix"], "com.netflix.ninja")
        self.assertEqual(by["YouTube"], apps.BY_ID["youtube"]["package"])
        self.assertEqual(by["Some Local App"], "panasonic.product_id=0076010507000001")
        self.assertIn("com.netflix.ninja", await self.tv.installed_packages())

    async def test_power_state_is_the_port(self):
        self.assertTrue(self.tv.is_on)
        await self.s.__aexit__()
        await self.tv._read_power()
        self.assertFalse(self.tv.is_on)
        self.s = await StandIn().__aenter__()   # for tearDown

    async def test_unknown_before_the_first_look(self):
        t = panasonic.PanasonicTV({"id": "x", "name": "X", "kind": "panasonic", "ip": "192.0.2.9"})
        self.assertIsNone(t.is_on)


class Keys(Base):
    async def test_remote_keys(self):
        for k in ("up", "down", "left", "right", "ok", "back", "viera_home", "apps", "menu", "input",
                  "play", "pause", "NRC_RED-ONOFF", "7"):
            await self.tv.key(k)
        self.assertEqual(self.keys(), ["NRC_UP-ONOFF", "NRC_DOWN-ONOFF", "NRC_LEFT-ONOFF", "NRC_RIGHT-ONOFF",
                                       "NRC_ENTER-ONOFF", "NRC_RETURN-ONOFF", "NRC_HOME-ONOFF", "NRC_APPS-ONOFF",
                                       "NRC_MENU-ONOFF", "NRC_CHG_INPUT-ONOFF", "NRC_PLAY-ONOFF",
                                       "NRC_PAUSE-ONOFF", "NRC_RED-ONOFF", "NRC_D7-ONOFF"])
        soap = [b for b in self.s.raw if "X_SendKey" in b][0]
        self.assertIn('<u:X_SendKey xmlns:u="urn:panasonic-com:service:p00NetworkControl:1">', soap)

    async def test_unknown_or_unsafe_key_is_refused_before_anything_is_sent(self):
        for bad in ("banana", "NRC_UP-ONOFF</X_KeyEvent><x>", "NRC_UP", "", None, "NRC_" + "A" * 40 + "-ONOFF"):
            with self.assertRaises(ValueError):
                await self.tv.key(bad)
        self.assertEqual(self.s.raw, [])

    async def test_nothing_sent_when_the_tv_is_off_the_network(self):
        self.tv.connected = False
        with self.assertRaises(TVUnavailable):
            await self.tv.key("up")
        self.assertEqual(self.s.raw, [])

    async def test_a_refused_key_is_reported(self):
        self.s.refuse["X_SendKey"] = 401
        with self.assertRaises(panasonic.PanasonicError) as cm:
            await self.tv.key("up")
        self.assertIn("401", str(cm.exception))

    async def test_hdmi_keys_switch_the_input(self):
        await self.tv.detect()
        self.assertEqual(await self.tv.key("hdmi2"), "hdmi2")
        self.assertEqual(self.s.sent("X_SendCtrlCmd"), ["<X_CtrlCmd>PAC_IMS:2</X_CtrlCmd>"])
        with self.assertRaises(ValueError):
            await self.tv.select_input("2</X_CtrlCmd>")

    async def test_typing_is_not_built(self):
        with self.assertRaises(TVUnavailable):
            await self.tv.text("hi")


class Power(Base):
    async def test_power_off_is_the_power_key(self):
        await self.tv.key("power")
        self.assertEqual(self.keys(), ["NRC_POWER-ONOFF"])

    async def test_power_on_from_off_is_wake_on_lan(self):
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

        t = self.other(mac="020000000001")   # the plain hex form, which the driver also takes
        t.connected = False
        with patch.object(panasonic.socket, "socket", Sock):
            self.assertEqual(await t.key("power"), "NRC_POWER-ONOFF")
        self.assertEqual(self.keys(), [])
        self.assertTrue(sent)
        self.assertEqual(sent[0][0], b"\xff" * 6 + bytes.fromhex("020000000001") * 16)
        self.assertGreater(t.home_on_wake_until, time.monotonic())

    async def test_no_mac_no_packet(self):
        t = self.other()
        t.connected = False
        with patch.object(panasonic.socket, "socket", side_effect=AssertionError("no socket")):
            await t.wake()


class Volume(Base):
    async def test_reads_level_and_mute(self):
        self.s.volume, self.s.muted = 31, True
        v = await self.tv._read_volume()
        self.assertEqual((v["level"], v["max"], v["muted"], v["known"]), (31, 100, True, True))

    async def test_set_volume_and_mute(self):
        await self.tv.set_volume(140)
        self.assertEqual(self.s.volume, 100)
        await self.tv.set_volume(12)
        await self.tv.set_mute(True)
        self.assertEqual((self.s.volume, self.s.muted), (12, True))
        self.assertEqual(self.tv.volume["level"], 12)
        self.assertTrue(any("<DesiredVolume>12</DesiredVolume>" in b for b in self.s.sent("SetVolume")))

    async def test_volume_keys_read_the_level_after(self):
        await self.tv.key("volume_up")
        await asyncio.sleep(0.5)
        self.assertEqual(self.keys(), ["NRC_VOLUP-ONOFF"])
        self.assertTrue(self.tv.volume["known"])

    async def test_volume_is_unknown_when_off(self):
        await self.tv._read_volume()
        self.tv.connected = False
        self.assertFalse(self.tv.volume["known"])


class Launching(Base):
    async def test_known_app_opens_with_the_tvs_own_keyword(self):
        await self.tv.launch_package("com.netflix.ninja")
        self.assertEqual(self.launches(), ["product_id=0010000200000001"])
        self.assertIn("<X_AppType>vc_app</X_AppType>", self.s.sent("X_LaunchApp")[0])
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}), "com.netflix.ninja")
        self.assertEqual(self.tv.current_package, "com.netflix.ninja")

    async def test_found_by_catalogue_id(self):
        await self.tv.launch_package("prime-video")
        self.assertEqual(self.launches(), ["product_id=0387878700000032"])

    async def test_not_installed(self):
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.launch_package("com.disney.disneyplus")
        self.assertIn("not installed", str(cm.exception))
        self.assertEqual(self.launches(), [])

    async def test_only_an_app_the_tv_listed_is_ever_sent(self):
        await self.tv.launch_package("panasonic.product_id=0076010507000001")
        for bad in ("panasonic.product_id=9999999999999999", "panasonic.resource_id=1</X>", "com.evil.app",
                    "panasonic."):
            with self.assertRaises(TVUnavailable):
                await self.tv.launch_package(bad)
        with self.assertRaises(ValueError):
            await self.tv._launch("product_id=0000000000000000")
        self.assertEqual(self.launches(), ["product_id=0076010507000001"])

    async def test_links_only_open_the_app(self):
        r = await self.tv.start_intent("https://www.netflix.com/title/80057281", "com.netflix.ninja")
        self.assertEqual((r, self.launches()), ("app", ["product_id=0010000200000001"]))
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://example.org/x")
        self.assertFalse(self.tv.can_deeplink(apps.BY_ID["netflix"]))

    async def test_an_odd_app_list_entry_is_dropped(self):
        with patch("panasonic_standin.APPS", "vc_app'product_id=12</x>'Odd''vc_app'product_id=0010000200000001'Netflix''"):
            await self.tv.refresh_installed(force=True)
        self.assertEqual([a["name"] for a in self.tv.applist], ["Netflix"])

    async def test_no_app_list_is_said_plainly(self):
        self.s.refuse["X_GetAppList"] = 401
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.launch_package("com.netflix.ninja")
        self.assertIn("not said which apps", str(cm.exception))


class OpeningThePage(Base):
    async def test_home_opens_the_browser_and_hands_it_the_page_with_a_code(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            self.assertEqual(await self.tv.key("home"), "couch-tv")
        await self.settle()
        self.assertEqual(self.launches(), ["resource_id=1063"])
        [(head, n, url, tail)] = self.s.urls
        self.assertEqual((head, tail), (bytes([0xF4, 1, 1, 0, 0, 0, 0]), b"\x00"))
        self.assertEqual(n, len(url))
        self.assertIn("/tv/?once=", url)
        self.assertNotIn("couchpass123", url)
        self.assertNotIn("key=", url)
        code = url.split("once=")[1]
        self.assertTrue(self.tv.claim(code))
        self.assertFalse(self.tv.claim(code))
        self.assertIn("127.0.0.1:", self.s.sent("X_ConnectApp")[0])
        self.assertEqual(self.tv.current_package, panasonic.HOME_PACKAGE)

    async def test_tv_that_never_comes_for_the_address(self):
        self.s.connect_back = False
        with self.assertRaises(panasonic.PanasonicError) as cm:
            await self.tv.open_home()
        self.assertIn("never came", str(cm.exception))

    async def test_only_short_plain_addresses(self):
        for bad in ("javascript:alert(1)", "http://x/" + "a" * 300, "http://x/\x00y", "file:///etc/passwd", None):
            with self.assertRaises(ValueError):
                await self.tv.open_url(bad)
        self.assertEqual(self.s.raw, [])

    async def test_home_url_from_config_and_other_tvs(self):
        t = self.other(home_url="http://192.0.2.20:5400/tv/", id="bedroom")
        self.assertEqual(t.home_url(), "http://192.0.2.20:5400/tv/?tv=bedroom")
        self.assertEqual(t.home_url("abc"), "http://192.0.2.20:5400/tv/?tv=bedroom&once=abc")

    async def test_a_code_runs_out(self):
        c = self.tv.new_code()
        self.tv._codes[c] = time.monotonic() - 1
        self.assertFalse(self.tv.claim(c))
        self.assertFalse(self.tv.claim(None))


class Hook(Base):
    async def run_hook(self, **cfg):
        t = self.other(settle=0, **cfg)
        await t._hook()
        await self.settle()
        return t

    async def test_comes_on_opens_couch_tv(self):
        t = await self.run_hook()
        self.assertEqual(self.launches(), ["resource_id=1063"])
        self.assertEqual(len(self.s.urls), 1)
        self.assertIn("opened couch-tv", t.hook_log[-1][1])

    async def test_hook_can_be_switched_off(self):
        await self.run_hook(open_on_power_on=False)
        self.assertEqual(self.launches(), [])

    async def test_off_again_before_it_settled(self):
        t = self.other(settle=0.05)
        task = asyncio.create_task(t._hook())
        t.connected = False
        await task
        self.assertEqual(self.launches(), [])
        self.assertIn("off again", t.hook_log[-1][1])

    async def test_a_command_just_run_keeps_the_hook_quiet_but_a_phone_wake_does_not(self):
        t = self.other(settle=0)
        t.quiet_until = time.monotonic() + 20
        await t._hook()
        self.assertEqual(self.launches(), [])
        t.home_on_wake_until = time.monotonic() + 90
        await t._hook()
        await self.settle()
        self.assertEqual(self.launches(), ["resource_id=1063"])

    async def test_a_failure_is_noted_not_raised(self):
        self.s.refuse["X_LaunchApp"] = 401
        t = await self.run_hook()
        self.assertIn("could not open couch-tv", t.hook_log[-1][1])

    async def test_the_watcher_fires_the_hook_when_the_tv_comes_on(self):
        t = self.other()
        up = {"on": False}
        fired = []

        async def port_open(*a, **k):
            return up["on"]

        async def hook():
            fired.append(1)

        t.port_open, t._hook = port_open, hook
        with patch.object(panasonic, "WATCH_EVERY", 0.02):
            task = asyncio.create_task(t._watch())
            await asyncio.sleep(0.2)
            self.assertEqual((fired, t.is_on), ([], False))
            up["on"] = True
            await asyncio.sleep(0.3)
            task.cancel()
        self.assertEqual(fired, [1])
        self.assertTrue(t.is_on)
        self.assertTrue(t.volume["known"])     # read once when the TV came back


class Encrypted(Base):
    encrypted = True

    async def test_commands_need_pairing_first(self):
        with self.assertRaises(panasonic.PanasonicError) as cm:
            await self.tv.key("up")
        self.assertIn("pairing", str(cm.exception))
        self.assertEqual(self.s.log, [])

    async def test_pin_then_keys_then_sealed_commands(self):
        self.assertTrue(await self.tv.pair_start())
        self.assertTrue(self.s.pin_shown)
        await self.tv.pair_finish(PIN)
        path = os.path.join(self.data, "panasonic-lounge.json")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(self.tv.credentials, (APP_ID, KEYWORD))
        self.assertTrue(self.tv.panasonic_status()["paired"])
        await self.tv.key("up")
        await self.tv.key("down")
        self.assertEqual(self.keys(), ["NRC_UP-ONOFF", "NRC_DOWN-ONOFF"])
        self.assertEqual(self.s.sequences, ["00000001", "00000002"])
        # nothing readable on the wire: the key travels sealed
        self.assertFalse(any("NRC_UP-ONOFF" in b for b in self.s.raw))
        self.assertTrue(self.tv.panasonic_status()["session"])

    async def test_volume_stays_plain_on_an_encrypted_set(self):
        self.pair_store()
        await self.tv.set_volume(40)
        self.assertEqual(self.s.volume, 40)
        self.assertEqual(self.s.sequences, [])

    async def test_a_wrong_pin_keeps_nothing(self):
        await self.tv.pair_start()
        with self.assertRaises(panasonic.PanasonicError) as cm:
            await self.tv.pair_finish("0000")
        self.assertEqual(cm.exception.code, 600)
        self.assertIn("wrong", str(cm.exception))
        self.assertIsNone(self.tv.credentials)
        self.assertFalse(os.path.exists(os.path.join(self.data, "panasonic-lounge.json")))

    async def test_pin_shape_checked_before_anything_is_sent(self):
        await self.tv.pair_start()
        n = len(self.s.raw)
        for bad in ("123", "12345", "12a4", "", None, "1234\n</X>"):
            with self.assertRaises(ValueError):
                await self.tv.pair_finish(bad)
        self.assertEqual(len(self.s.raw), n)

    async def test_pin_before_a_challenge_is_refused(self):
        with self.assertRaises(panasonic.PanasonicError):
            await self.tv.pair_finish(PIN)

    async def test_a_session_that_ran_out_is_renewed_once(self):
        self.pair_store()
        await self.tv.key("up")
        self.s.session_ok = False
        await self.tv.key("down")
        self.assertEqual(self.keys(), ["NRC_UP-ONOFF", "NRC_DOWN-ONOFF"])
        self.assertEqual(self.s.sequences, ["00000001", "00000001"])   # a new session starts at 1 again

    async def test_open_page_on_an_encrypted_set(self):
        self.pair_store()
        await self.tv.open_home()
        await self.settle()
        self.assertEqual(self.launches(), ["resource_id=1063"])
        self.assertEqual(len(self.s.urls), 1)

    async def test_trace_never_logs_the_pin_keys_or_session(self):
        t = self.other(trace=True)
        with self.assertLogs("panasonic.lounge", logging.INFO) as cm:
            await t.pair_start()
            await t.pair_finish(PIN)
            await t.key("up")
        out = "\n".join(cm.output)
        self.assertIn("trace out", out)
        self.assertIn("NRC_UP-ONOFF", out)   # the command itself is shown, decrypted
        for secret in (PIN, KEYWORD, APP_ID, SESSION, base64.b64encode(bytes(range(200, 216))).decode()):
            self.assertNotIn(secret, out)


class Cipher(unittest.TestCase):
    def test_seal_and_unseal_round_trip_with_zero_padding(self):
        iv, key, hk = panasonic.session_keys(KEYWORD)
        for text in ("", "x" * 16, "<X_SessionId>1</X_SessionId>" * 5):
            sealed = panasonic.seal(text, key, hk, iv)
            raw = base64.b64decode(sealed)
            self.assertEqual((len(raw) - 32) % 16, 0)
            self.assertEqual(panasonic.unseal(sealed, key, hk, iv), text)

    def test_session_key_shuffle(self):
        iv, key, hk = panasonic.session_keys(base64.b64encode(bytes(range(16))).decode())
        self.assertEqual(list(key[:8]), [2, 3, 0, 1, 6, 7, 4, 5])
        self.assertEqual(hk, iv + iv)

    def test_pairing_key_from_the_challenge(self):
        key, hk = panasonic.pairing_keys(bytes(range(16)))
        self.assertEqual(list(key[:4]), [0xFC, 0xFD, 0xFE, 0xFF])
        self.assertEqual(hk[0], 0x15 ^ 2)
        self.assertEqual(len(hk), 32)

    def test_bad_input_is_an_error_not_a_crash(self):
        iv, key, hk = panasonic.session_keys(KEYWORD)
        for bad in ("not base64!", base64.b64encode(b"short").decode()):
            with self.assertRaises(panasonic.PanasonicError):
                panasonic.unseal(bad, key, hk, iv)
        with self.assertRaises(panasonic.PanasonicError):
            panasonic.session_keys(base64.b64encode(b"short").decode())

    def test_hide(self):
        self.assertEqual(panasonic.hide("<X_PinCode>1234</X_PinCode><X_KeyEvent>NRC_UP-ONOFF</X_KeyEvent>"),
                         "<X_PinCode>(hidden)</X_PinCode><X_KeyEvent>NRC_UP-ONOFF</X_KeyEvent>")


class CheckTV(unittest.TestCase):
    def test_check_tv_knows_port_55000(self):
        spec = importlib.util.spec_from_file_location("check_tv", Path(__file__).parents[1] / "scripts" / "check-tv.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertIn("Panasonic", mod.PORTS[55000])


class Endpoints(Base):
    """The bridge's Panasonic endpoints behind its real middleware, with a pairing key set."""
    encrypted = True

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tvs = patch.multiple(server, TVS={"lounge": self.tv}, DEFAULT_TV="lounge")
        self._tvs.start()
        self._key = patch.object(config, "PAIRING_KEY", "couchpass123")
        self._key.start()
        server._failed_attempts.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_post("/api/panasonic/pair", server.h_panasonic_pair)
        app.router.add_post("/api/vidaa/claim", server.h_vidaa_claim)
        app.router.add_post("/api/volume", server.h_volume)
        app.router.add_get("/api/tvs", server.h_tvs)
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
        r = await self.post("/api/panasonic/pair", {}, key=False)
        self.assertEqual(r.status, 401)
        self.assertFalse(self.s.pin_shown)

    async def test_pairing_through_the_bridge(self):
        r = await self.post("/api/panasonic/pair", {})
        self.assertEqual((r.status, (await r.json())["step"]), (200, "pin"))
        r = await self.post("/api/panasonic/pair", {"pin": "12a4"})
        self.assertEqual(r.status, 400)
        r = await self.post("/api/panasonic/pair", {"pin": "0000"})
        self.assertEqual(r.status, 409)
        r = await self.post("/api/panasonic/pair", {})
        r = await self.post("/api/panasonic/pair", {"pin": PIN})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.tv.credentials, (APP_ID, KEYWORD))

    async def test_a_plain_set_needs_no_pairing(self):
        self.s.encrypted = False
        self.tv.encrypted = None
        r = await self.post("/api/panasonic/pair", {})
        self.assertEqual((await r.json())["step"], "none")

    async def test_claim_swaps_a_panasonic_code_for_the_key_once(self):
        code = self.tv.new_code()
        r = await self.post("/api/vidaa/claim", {"code": code}, key=False)
        self.assertEqual((r.status, (await r.json())["key"]), (200, "couchpass123"))
        r = await self.post("/api/vidaa/claim", {"code": code}, key=False)
        self.assertEqual(r.status, 401)

    async def test_volume_level_is_set_in_one_step(self):
        r = await self.post("/api/volume", {"level": 35})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.s.volume, 35)
        self.assertEqual(self.s.sent("X_SendKey"), [])

    async def test_tvs_shows_the_panasonic_status(self):
        r = await self.client.get("/api/tvs", headers={"Authorization": "Bearer couchpass123"})
        row = (await r.json())["tvs"][0]
        self.assertEqual(row["kind"], "panasonic")
        self.assertEqual(set(row["panasonic"]), {"port", "model", "encrypted", "paired", "session", "volume",
                                                 "apps", "error"})

    async def test_make_tv_builds_a_panasonic(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "panasonic", "ip": "192.0.2.9"}),
                              panasonic.PanasonicTV)


if __name__ == "__main__":
    unittest.main()
