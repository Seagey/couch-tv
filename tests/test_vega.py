"""bridge/vega.py against a stand-in Fire TV on Vega OS (tests/vega_standin.py): keys through the page, opening
couch-tv with Amazon's CLI and with DIAL, Netflix and YouTube, the power on hook and what it refuses."""
import asyncio
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
sys.path.insert(0, str(Path(__file__).parents[1] / "vega"))
import server
import vega
from vega_standin import StandIn
from tv import TVUnavailable

import importlib.util
_spec = importlib.util.spec_from_file_location("make_config", Path(__file__).parents[1] / "vega" / "make-config.py")
make_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(make_config)


class Base(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["VEGA_STANDIN_LOG"] = str(Path(self.tmp.name) / "cli.log")
        os.environ.pop("VEGA_STANDIN_FAIL", None)
        self.s = await StandIn(self.tmp.name).__aenter__()
        self.tv = self.s.tv()

    async def asyncTearDown(self):
        if self.tv._session:
            await self.tv._session.close()
        await self.s.__aexit__()
        self.tmp.cleanup()


class Keys(Base):
    async def test_keys_wait_for_the_page_in_front(self):
        with self.assertRaises(TVUnavailable) as c:
            await self.tv.key("ok")
        self.assertIn("not in front", str(c.exception))

    async def test_keys_reach_the_page_in_order(self):
        poll = asyncio.create_task(self.tv.next_keys(0, timeout=3))   # the page asking
        await asyncio.sleep(0.05)
        for k in ("right", "ok", "back"):
            await self.tv.key(k)
        keys, last = await poll
        self.assertTrue(self.tv.page_in_front())
        again, last2 = await self.tv.next_keys(last, timeout=0.1)
        self.assertEqual(again, [])
        self.assertEqual(last2, last)
        more, _ = await self.tv.next_keys(0, timeout=0.1)
        self.assertEqual([k["key"] for k in more], ["ArrowRight", "Enter", "Escape"])

    async def test_a_poll_waits_then_returns_empty(self):
        t = time.monotonic()
        keys, last = await self.tv.next_keys(0, timeout=0.3)
        self.assertEqual(keys, [])
        self.assertGreaterEqual(time.monotonic() - t, 0.25)

    async def test_stick_owned_keys_are_refused_plainly(self):
        await self.tv.next_keys(0, timeout=0.01)
        for k in ("volume_up", "mute", "input"):
            with self.assertRaises(TVUnavailable) as c:
                await self.tv.key(k)
            self.assertIn("stick's own", str(c.exception))
        with self.assertRaises(ValueError):
            await self.tv.key("nonsense")

    async def test_power_off_is_refused_and_power_on_wakes(self):
        with self.assertRaises(TVUnavailable):
            await self.tv.key("power")
        self.tv.power = False
        woke = []

        async def wake():
            woke.append(1)

        self.tv.wake = wake
        await self.tv.key("power")
        self.assertEqual(woke, [1])
        self.assertGreater(self.tv.home_on_wake_until, time.monotonic())


class Opening(Base):
    async def test_home_uses_amazons_cli_first(self):
        await self.tv.key("home")
        calls = self.s.cli_calls()
        self.assertEqual(calls[0][:3], ["exec", "vda", "connect"])
        self.assertEqual(calls[1][:3], ["device", "launch-app", "--appName"])
        self.assertEqual(calls[1][3], vega.COUCH_APP)
        self.assertEqual(self.s.dial_log, [])

    async def test_home_falls_back_to_dial_when_the_cli_fails(self):
        os.environ["VEGA_STANDIN_FAIL"] = "1"
        await self.tv.key("home")
        self.assertEqual([(m, p) for m, p, _ in self.s.dial_log], [("POST", "/apps/CouchTV")])

    async def test_home_with_no_cli_uses_dial_only(self):
        tv = self.s.tv(cli=str(Path(self.tmp.name) / "nope"))
        try:
            await tv.key("home")
            self.assertEqual(self.s.cli_calls(), [])
            self.assertEqual(len(self.s.dial_log), 1)
            self.assertIn("urn:dial-multiscreen-org:service:dial:1", self.s.ssdp[0])
        finally:
            await tv._session.close()

    async def test_both_failing_says_so_in_one_sentence(self):
        os.environ["VEGA_STANDIN_FAIL"] = "1"
        self.s.dial_on = False
        self.tv.dial_url = f"http://127.0.0.1:{self.s.port}/nothing"   # DIAL answers 404 for it
        with self.assertRaises(TVUnavailable) as c:
            await self.tv.key("home")
        self.assertIn("could not open couch-tv", str(c.exception))

    async def test_youtube_and_netflix_open_through_dial(self):
        await self.tv.start_intent("https://www.youtube.com/watch?v=abc123DEF45", package="com.google.android.youtube.tv")
        self.assertEqual(self.s.dial_log[-1][1:], ("/apps/YouTube", "v=abc123DEF45"))
        await self.tv.start_intent("https://www.netflix.com/title/81234567")
        self.assertEqual(self.s.dial_log[-1][1], "/apps/Netflix")
        self.assertIn("81234567", self.s.dial_log[-1][2])

    async def test_other_apps_cannot_be_opened_and_it_says_which_can(self):
        with self.assertRaises(TVUnavailable) as c:
            await self.tv.launch_package("au.com.stan.and")
        self.assertIn("Netflix and YouTube", str(c.exception))

    async def test_dial_address_that_is_not_the_stick_is_refused(self):
        self.s.base_override = "http://203.0.113.9/apps"
        with self.assertRaises(TVUnavailable) as c:
            await self.tv.launch_package("com.netflix.ninja")
        self.assertIn("did not match", str(c.exception))
        self.assertEqual(self.s.dial_log, [])

    async def test_bad_app_ids_never_reach_the_cli(self):
        with self.assertRaises(ValueError):
            await self.tv._cli_launch("x; rm -rf /")
        self.assertEqual(self.s.cli_calls(), [])

    async def test_no_cli_and_no_dial_names_both(self):
        self.s.dial_on = False
        tv = self.s.tv(cli=str(Path(self.tmp.name) / "nope"))
        with patch.object(vega.VegaTV, "_discover", side_effect=TVUnavailable("the stick did not answer DIAL discovery")):
            with self.assertRaises(TVUnavailable) as c:
                await tv.key("home")
        self.assertIn("could not open couch-tv", str(c.exception))


class Hook(Base):
    async def test_the_stick_coming_up_opens_couch_tv(self):
        self.s.cli_log.write_text("")
        real_sleep = asyncio.sleep

        async def quick(t):
            await real_sleep(0)

        with patch.object(vega.asyncio, "sleep", quick):
            await self.tv._hook()
        self.assertTrue(any(c[:2] == ["device", "launch-app"] for c in self.s.cli_calls()))
        self.assertIn("opened couch-tv", self.tv.hook_log[-1][1])

    async def test_a_command_just_run_keeps_the_hook_quiet(self):
        self.tv.quiet_until = time.monotonic() + 10
        await self.tv._hook()
        self.assertEqual(self.s.cli_calls(), [])
        self.assertIn("left alone", self.tv.hook_log[-1][1])

    async def test_watch_sees_the_port_close_and_open(self):
        self.s.stop_port()
        self.assertFalse(await self.tv.port_open())
        await self.tv.reconnect_now()
        self.assertFalse(self.tv.is_on)


class Server(Base):
    async def test_make_tv_and_the_key_endpoint(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "vega", "ip": "192.0.2.9"}), vega.VegaTV)
        server.TVS["bed"] = self.tv
        tok = server._current.set("bed")

        class Req:
            query = {"after": "0"}

        try:
            self.tv.push_key("Enter")
            r = await server.h_vega_keys(Req())
            import json
            j = json.loads(r.text)
            self.assertEqual(j["keys"], [{"n": 1, "key": "Enter"}])
            Req.query = {"after": "x"}
            with self.assertRaises(server.ApiError):
                await server.h_vega_keys(Req())
        finally:
            server._current.reset(tok)
            del server.TVS["bed"]

    async def test_wrong_kind_is_refused(self):
        class Req:
            query = {}

        with self.assertRaises(server.ApiError):
            await server.h_vega_keys(Req())   # the default TV is not a Vega stick


class MakeConfig(unittest.TestCase):
    def test_builds_and_refuses(self):
        fake = "x" * 12
        self.assertEqual(make_config.build("http://192.0.2.20:5400", fake, "bed"),
                         {"url": "http://192.0.2.20:5400", "key": fake, "tv": "bed"})
        for bad in ("https://x:1", "http://x:1/path", "192.0.2.20"):
            with self.assertRaises(SystemExit):
                make_config.build(bad)
        with self.assertRaises(SystemExit):
            make_config.build("http://x:1", "bad key!")


if __name__ == "__main__":
    unittest.main()
