"""bridge/tivo.py against a stand-in TiVo OS TV (tests/tivo_standin.py): reading the TV, the key format the
real TV wants, typing, opening only apps the TV said it knows, the keys that open couch-tv's page in the
browser, the power on hook and the watcher, and the bridge endpoints with the pairing key. The stand-in
copies what one real JVC answered, see its notes for what is still a guess: docs/TIVO.md."""
import asyncio
import contextlib
import importlib.util
import io
import json
import logging
import shutil
import socket
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
import server  # noqa: E402
import tivo  # noqa: E402
from tv import TVUnavailable  # noqa: E402
from tivo_standin import StandIn  # noqa: E402

FAST = dict(tivo.PROTOCOL, browser_wait=0, key_gap=0, text_gap=0)
NETFLIX = apps.BY_ID["netflix"]["package"]
PRIME = apps.BY_ID["prime-video"]["package"]
YOUTUBE = apps.BY_ID["youtube"]["package"]


def closed_port():
    """A port nothing listens on: the TV switched off."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Base(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="tivo-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self._proto = patch.object(tivo, "PROTOCOL", FAST)
        self._proto.start()
        self.s = await StandIn().__aenter__()
        self.tv = self.s.tv()
        self.extra = []

    async def asyncTearDown(self):
        for t in [self.tv] + self.extra:
            for task in t._tasks:
                task.cancel()
            await t.close()
        await self.s.__aexit__()
        self._proto.stop()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def other(self, **cfg):
        t = self.s.tv(**cfg)
        self.extra.append(t)
        return t

    async def settle(self):
        for _ in range(10):
            await asyncio.sleep(0.02)


class Reading(Base):
    async def test_the_tv_says_who_it_is(self):
        self.assertEqual(await self.tv.detect(), "running")
        self.assertEqual(self.tv.model, "VESTEL MB180 JVC_")
        self.assertIsNone(self.tv.last_error)

    async def test_reading_presses_nothing(self):
        await self.tv.detect()
        await self.tv.refresh_installed()
        self.assertEqual(self.s.bodies, [])
        self.assertTrue(all(method == "GET" for method, _ in self.s.requests))

    async def test_a_missing_description_is_not_an_error(self):
        t = self.other(description_port=closed_port())
        self.assertEqual(await t.detect(), "running")
        self.assertIsNone(t.model)

    async def test_no_volume_level_and_no_way_to_set_one(self):
        self.assertFalse(self.tv.volume["known"])
        self.assertFalse(hasattr(self.tv, "set_volume"))   # the bridge then answers "use up and down"
        self.assertFalse(hasattr(self.tv, "set_mute"))

    async def test_what_tivo_os_does_not_have(self):
        self.assertFalse(await self.tv.adb_ready())
        self.assertFalse(self.tv.can_deeplink(apps.BY_ID["netflix"]))
        with self.assertRaises(TVUnavailable):
            await self.tv.screenshot()
        with self.assertRaises(TVUnavailable):
            await self.tv.adb("shell", "true")


class Keys(Base):
    async def test_a_key_goes_inside_remote(self):
        self.assertEqual(await self.tv.key("volume_up"), "1016")
        self.assertEqual(self.s.bodies, ["<remote><key code=1016/></remote>"])
        self.assertEqual((self.s.keys, self.s.ignored), ([1016], []))

    async def test_the_names_the_real_tv_confirmed(self):
        for name, code in (("volume_down", 1017), ("right", 1022), ("ok", 1053), ("yellow", 1050), ("browser", 1065)):
            self.assertEqual(tivo.resolve_key(name), code)

    async def test_a_code_can_be_given_as_it_is(self):
        self.assertEqual(await self.tv.key("1043"), "1043")
        self.assertEqual(tivo.resolve_key(1043), 1043)

    async def test_what_is_not_a_key(self):
        for name in ("", "  ", "1500", "999", "10431", "hdmi1", "1016/></remote><x", None, True, 3.5, ["up"]):
            self.assertIsNone(tivo.resolve_key(name), name)
        with self.assertRaises(ValueError):
            await self.tv.key("hdmi1")
        self.assertEqual(self.s.bodies, [])

    async def test_a_key_needs_the_tv_on_the_network(self):
        self.tv.connected = False
        with self.assertRaises(TVUnavailable):
            await self.tv.key("up")
        self.assertEqual(self.s.bodies, [])

    async def test_virtual_remote_switched_off(self):
        self.s.virtual_remote = False
        with self.assertRaises(tivo.TivoError) as e:
            await self.tv.key("up")
        self.assertIn("Virtual Remote", str(e.exception))

    async def test_power_on_a_tv_that_is_gone_sends_no_key(self):
        self.tv.connected = False
        self.assertEqual(await self.tv.key("power"), "1012")
        self.assertEqual(self.s.bodies, [])
        self.assertGreater(self.tv.home_on_wake_until, time.monotonic())

    async def test_a_key_quiets_the_hook_and_power_does_not(self):
        await self.tv.key("up")
        self.assertGreater(self.tv.quiet_until, time.monotonic())
        await self.tv.key("power")
        self.assertEqual(self.tv.quiet_until, 0.0)

    async def test_a_tv_that_stops_answering(self):
        t = self.other(port=closed_port())
        with self.assertRaises(TVUnavailable):
            await t.key("up")


class Typing(Base):
    async def test_signs_as_characters_digits_as_number_keys(self):
        await self.tv.text("a.b:42")
        self.assertEqual(self.s.typed, "a.b:")        # the stand-in's field is not on a web page
        self.assertEqual(self.s.keys, [1004, 1002])   # the digits went as the remote's 4 and 2
        self.assertEqual(self.s.dropped, [])          # and never as characters the TV would drop

    async def test_number_keys_reach_a_field_on_couch_tvs_page(self):
        await self.tv.open_home()
        await self.tv.text("7.5")
        self.assertEqual(self.s.typed, "7.5")

    async def test_what_cannot_be_typed(self):
        for text in ("", "x" * 201, "a\nb", "tab\there", "\U0001F600", None, 12):
            with self.assertRaises(ValueError):
                await self.tv.text(text)
        self.assertEqual(self.s.bodies, [])

    async def test_typed_characters_stay_out_of_the_trace(self):
        t = self.other(trace=True)
        with self.assertLogs("tivo.lounge", level=logging.INFO) as logs:
            await t.text("s3cret!")
        out = "\n".join(logs.output)
        for value in (ord("s"), ord("c"), ord("!")):
            self.assertNotIn(f"value='{value}'", out)
        self.assertNotIn("1003", out)   # the 3 went as a number key, and that stays out too
        self.assertIn("hidden", out)
        self.assertEqual(self.s.keys, [1003])


class Apps(Base):
    async def test_only_apps_the_tv_said_yes_to(self):
        listed = await self.tv.apps_on_tv()
        self.assertEqual({a["package"] for a in listed}, {NETFLIX, PRIME})   # YouTube answered 403
        self.assertEqual(await self.tv.installed_packages(), {NETFLIX, PRIME})

    async def test_opening_an_app_by_package_or_catalogue_id(self):
        self.assertEqual(await self.tv.launch_package(PRIME), "remote")
        self.assertEqual(self.s.apps["AmazonInstantVideo"], "running")
        self.assertEqual(await self.tv.front_package(), PRIME)
        await self.tv.launch_package("netflix")
        self.assertEqual(self.s.screen, "Netflix")

    async def test_an_app_the_tv_does_not_know_is_never_asked_for(self):
        for package in (YOUTUBE, "com.example.unknown", "../SmartCenter", "Netflix/run"):
            with self.assertRaises(TVUnavailable):
                await self.tv.launch_package(package)
        self.assertEqual([r for r in self.s.requests if r[0] == "POST"], [])

    async def test_a_link_opens_the_app_only(self):
        self.assertEqual(await self.tv.start_intent("https://www.netflix.com/title/1", package=NETFLIX), "app")
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://example.com/")

    async def test_more_dial_names_from_config(self):
        self.s.apps["DisneyPlus"] = "stopped"
        t = self.other(dial_apps={"disney-plus": "DisneyPlus", "stan": "../x", "not-an-app": "Whatever", "binge": 7})
        self.assertEqual(t.dial_names["disney-plus"], "DisneyPlus")
        self.assertEqual(set(t.dial_names), set(tivo.DIAL_NAMES) | {"disney-plus"})
        self.assertIn(apps.BY_ID["disney-plus"]["package"], await t.installed_packages())

    async def test_dial_apps_that_is_not_a_table_is_ignored(self):
        self.assertEqual(self.other(dial_apps=["Netflix"]).dial_names, tivo.DIAL_NAMES)

    async def test_waiting_for_an_app_counts_the_one_just_opened(self):
        await self.tv.launch_package(NETFLIX)
        self.assertEqual(await self.tv.wait_for_app([NETFLIX, PRIME]), NETFLIX)
        self.assertIsNone(await self.tv.wait_for_app([PRIME]))


class Home(Base):
    async def test_the_browser_key_then_the_path_to_the_tile(self):
        await self.tv.open_home()
        self.assertEqual(self.s.keys, [1065, 1050, 1022, 1053, 1053])
        self.assertEqual(self.s.screen, "couch-tv")
        self.assertEqual(await self.tv.front_package(), tivo.HOME_PACKAGE)

    async def test_home_on_the_phone_opens_couch_tv(self):
        self.assertEqual(await self.tv.key("home"), "couch-tv")
        self.assertEqual(self.s.screen, "couch-tv")
        self.assertEqual(await self.tv.launch_package(tivo.HOME_PACKAGE), "remote")

    async def test_from_inside_the_browser_it_starts_over(self):
        await self.tv.open_home()
        await self.tv.key("up")
        await self.tv.open_home()
        self.assertEqual(self.s.screen, "couch-tv")

    async def test_a_different_path_from_config(self):
        t = self.other(browser_path=["yellow", "right", "right", "ok", "down", "ok"])
        await t.open_home()
        self.assertEqual(self.s.keys, [1065, 1050, 1022, 1022, 1053, 1019, 1053])

    async def test_a_path_with_something_that_is_not_a_key_is_not_used(self):
        for path in (["yellow", "nonsense"], [], "yellow", ["ok"] * 13, [None]):
            self.assertEqual(self.other(browser_path=path).browser_path, ("yellow", "right", "ok", "ok"), path)

    async def test_waits_from_config_are_kept_sane(self):
        t = self.other(browser_wait="12", key_gap=-4)
        self.assertEqual((t.browser_wait, t.key_gap), (12.0, 0.0))
        t = self.other(browser_wait="soon", key_gap=900)
        self.assertEqual((t.browser_wait, t.key_gap), (0.0, 60.0))   # FAST's browser_wait is the default here

    async def test_a_second_run_does_not_press_into_the_first(self):
        t = self.other(key_gap=0.05)
        await asyncio.gather(t.open_home(), t.open_home())
        self.assertEqual(self.s.keys, [1065, 1050, 1022, 1053, 1053])

    async def test_the_address_for_the_tile(self):
        with patch.dict(config.BRIDGE, {"port": 5400}), patch.dict("os.environ", {"PORT": ""}):
            self.assertEqual(self.tv.home_url(), "http://127.0.0.1:5400/titan/")
            self.assertEqual(self.other(id="bedroom").home_url(), "http://127.0.0.1:5400/titan/?tv=bedroom")
        self.assertEqual(self.other(home_url="http://couch.example/titan/").home_url(), "http://couch.example/titan/")

    async def test_the_address_never_carries_the_pairing_key(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            self.assertNotIn("couchpass123", self.tv.home_url())


class Hook(Base):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tv.settle = 0

    async def test_the_tv_coming_on_opens_couch_tv(self):
        await self.tv._hook()
        self.assertEqual(self.s.screen, "couch-tv")
        self.assertIn("pressed the keys", self.tv.hook_log[-1][1])

    async def test_left_alone_right_after_a_command_from_the_phone(self):
        await self.tv.key("volume_up")
        await self.tv._hook()
        self.assertEqual(self.s.keys, [1016])
        self.assertIn("left alone", self.tv.hook_log[-1][1])

    async def test_switched_on_from_the_phone_wins_over_the_quiet_time(self):
        self.tv.quiet_until = time.monotonic() + 20
        self.tv.home_on_wake_until = time.monotonic() + 90
        await self.tv._hook()
        self.assertEqual(self.s.screen, "couch-tv")

    async def test_open_on_power_on_can_be_switched_off(self):
        t = self.other(open_on_power_on=False, settle=0)
        await t._hook()
        self.assertEqual(self.s.keys, [])

    async def test_a_tv_that_went_off_again_is_left_alone(self):
        self.tv.connected = False
        await self.tv._hook()
        self.assertEqual(self.s.keys, [])

    async def test_a_failed_run_is_noted_not_raised(self):
        self.s.virtual_remote = False
        await self.tv._hook()
        self.assertIn("could not open couch-tv", self.tv.hook_log[-1][1])

    async def test_the_watcher_sees_the_tv_come_on(self):
        t = self.other(port=closed_port(), settle=0)
        t.connected, t._checked, t._last_answer = False, False, 0.0
        changes = []
        t.on_change(lambda: changes.append(t.connected))
        with patch.object(tivo, "WATCH_EVERY", 0.05):
            await t.start()
            for _ in range(60):
                await asyncio.sleep(0.05)
                if t._checked:
                    break
            self.assertIs(t.is_on, False)
            t.port = self.s.port          # the TV is switched on
            for _ in range(100):
                await asyncio.sleep(0.05)
                if self.s.screen == "couch-tv":
                    break
        self.assertEqual(self.s.screen, "couch-tv")
        self.assertEqual(t.smart_center_state, "running")
        self.assertIn(True, changes)

    async def test_a_tv_that_is_busy_for_a_moment_is_not_switched_off(self):
        """The real TV stopped answering while Netflix started. Read as off and on again, that set the
        hook off in the middle of Netflix."""
        self.tv.port = closed_port()
        await self.tv._read_power()
        self.assertTrue(self.tv.connected)
        with patch.object(tivo, "PROTOCOL", dict(FAST, off_after=0)):
            await self.tv._read_power()
        self.assertFalse(self.tv.connected)

    async def test_any_answer_from_the_tv_counts_as_there(self):
        self.tv._last_answer = 0.0
        await self.tv.key("up")
        self.assertGreater(self.tv._last_answer, 0.0)

    async def test_a_tv_that_never_answered_is_off(self):
        t = self.other(port=closed_port())
        t._last_answer = 0.0
        await t._read_power()
        self.assertIs(t.is_on, False)

    async def test_the_watcher_does_not_take_a_busy_tv_for_a_power_on(self):
        t = self.other(settle=0)
        with patch.object(tivo, "WATCH_EVERY", 0.05):
            await t.start()
            await asyncio.sleep(0.3)
            real_port, t.port = t.port, closed_port()    # the TV goes silent, as it does starting Netflix
            await asyncio.sleep(1.5)
            self.assertTrue(t.connected)
            t.port = real_port
            await asyncio.sleep(0.5)
        self.assertEqual(self.s.keys, [])
        self.assertEqual(t.hook_log, [])

    async def test_reconnect_now_reads_the_tv_again(self):
        self.tv.connected = False
        self.assertTrue(await self.tv.reconnect_now())
        self.assertEqual(self.tv.smart_center_state, "running")


class Endpoints(Base):
    """The bridge's own endpoints for a TiVo OS TV, behind its real middleware, with a pairing key set."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tvs = patch.multiple(server, TVS={"lounge": self.tv}, DEFAULT_TV="lounge")
        self._tvs.start()
        self._key = patch.object(config, "PAIRING_KEY", "couchpass123")
        self._key.start()
        server._failed_attempts.clear()
        app = web.Application(middlewares=[server.middleware])
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

    async def test_tvs_shows_the_tivo_status(self):
        r = await self.client.get("/api/tvs", headers={"Authorization": "Bearer couchpass123"})
        row = (await r.json())["tvs"][0]
        self.assertEqual(row["kind"], "tivo")
        self.assertEqual(set(row["tivo"]), {"port", "model", "smart_center", "apps", "home_url", "error"})
        self.assertTrue(row["tivo"]["home_url"].endswith("/titan/"))
        self.assertEqual(row["hook"], [])

    async def test_tvs_needs_the_key(self):
        r = await self.client.get("/api/tvs")
        self.assertEqual(r.status, 401)

    async def test_a_volume_level_is_refused_in_plain_words(self):
        r = await self.post("/api/volume", {"level": 35})
        self.assertEqual(r.status, 409)
        self.assertEqual(self.s.bodies, [])

    async def test_make_tv_builds_a_tivo(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "tivo", "ip": "192.0.2.9"}), tivo.TivoTV)


class CheckTv(unittest.TestCase):
    """scripts/check-tv.py points a TV that answers Smart Center at docs/TIVO.md."""

    def run_check(self, open_ports):
        spec = importlib.util.spec_from_file_location("check_tv", Path(__file__).parents[1] / "scripts" / "check-tv.py")
        check_tv = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(check_tv)
        out = io.StringIO()
        with patch.object(check_tv, "knock", lambda ip, port, timeout=1.0: port in open_ports), \
                patch.object(check_tv, "wireless_debugging_port", lambda ip: None), \
                patch.object(sys, "argv", ["check-tv.py", "192.0.2.9"]), contextlib.redirect_stdout(out):
            check_tv.main()
        return out.getvalue()

    def test_smart_center_alone_is_the_tivo_path(self):
        out = self.run_check({56789})
        self.assertIn("docs/TIVO.md", out)
        self.assertIn("scripts/tivo-check.py", out)

    def test_an_android_tv_that_also_answers_there_stays_android(self):
        self.assertNotIn("docs/TIVO.md", self.run_check({56789, 6466, 6467}))


if __name__ == "__main__":
    unittest.main()
