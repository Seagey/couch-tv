"""bridge/roku.py against a stand-in Roku (tests/roku_standin.py): power, keys, typing, launching with and
without a deep link, the app list, the app in front, the power on hook and Control by mobile apps."""
import asyncio
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import apps
import roku
import server
from roku_standin import PNG, StandIn
from tv import TVUnavailable


def keys(s):
    return [p.split("/", 1)[1] for m, p in s.log if p.startswith("keypress/")]


def launches(s):
    return [p.split("/", 1)[1] for m, p in s.log if p.startswith("launch/")]


class Base(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.s = await StandIn().__aenter__()
        self.tv = self.s.tv()

    async def asyncTearDown(self):
        if self.tv._session:
            await self.tv._session.close()
        await self.s.__aexit__()


class Power(Base):
    async def test_power_mode_decides_on_and_off(self):
        await self.tv._read_power()
        self.assertTrue(self.tv.is_on)
        self.assertEqual(self.tv.device["model-name"], "Stand-in Roku TV")
        self.s.power = "Ready"
        await self.tv._read_power()
        self.assertFalse(self.tv.is_on)
        self.s.power = "DisplayOff"
        await self.tv._read_power()
        self.assertFalse(self.tv.is_on)

    async def test_power_key_turns_off_then_on(self):
        await self.tv._read_power()
        await self.tv.key("power")
        self.assertEqual(keys(self.s), ["PowerOff"])
        await self.tv._read_power()
        self.assertFalse(self.tv.is_on)
        await self.tv.key("power")
        self.assertEqual(keys(self.s), ["PowerOff", "PowerOn"])
        self.assertGreater(self.tv.home_on_wake_until, time.monotonic())   # lands on couch-tv

    async def test_power_on_that_is_refused_ends_in_wake_on_lan(self):
        woke = []

        async def wake():
            woke.append(1)

        async def refused(key):
            raise TVUnavailable("no")

        self.tv.wake, self.tv._keypress = wake, refused
        await self.tv._turn_on()
        self.assertEqual(woke, [1])


class Keys(Base):
    async def test_remote_keys(self):
        for k in ("up", "down", "left", "right", "ok", "back", "play_pause", "rewind", "fast_forward",
                  "volume_up", "volume_down", "mute", "roku_home", "InputHDMI1", "hdmi2"):
            await self.tv.key(k)
        self.assertEqual(keys(self.s), ["Up", "Down", "Left", "Right", "Select", "Back", "Play", "Rev", "Fwd",
                                        "VolumeUp", "VolumeDown", "VolumeMute", "Home", "InputHDMI1", "InputHDMI2"])

    async def test_unknown_key_is_refused_before_anything_is_sent(self):
        with self.assertRaises(ValueError):
            await self.tv.key("banana")
        self.assertEqual(self.s.log, [])

    async def test_home_opens_couch_tv_not_rokus_home(self):
        self.assertEqual(await self.tv.key("home"), "couch-tv")
        self.assertEqual(launches(self.s), ["dev"])
        self.assertEqual(keys(self.s), [])

    async def test_typing_sends_one_key_per_character(self):
        await self.tv.text("hi 2!")
        self.assertEqual(keys(self.s), ["Lit_h", "Lit_i", "Lit_%20", "Lit_2", "Lit_!"])

    async def test_volume_has_no_level(self):
        self.assertFalse(self.tv.volume["known"])


class Launching(Base):
    async def test_known_app_opens_by_its_id_with_no_deep_link(self):
        await self.tv.launch_package("com.netflix.ninja")
        self.assertEqual(launches(self.s), ["12"])

    async def test_app_found_by_its_name(self):
        await self.tv.launch_package("au.com.stan.and")        # Stan has no id in apps.ROKU, the Roku lists it as "Stan"
        await self.tv.launch_package("com.sbs.ondemand.tv")
        self.assertEqual(launches(self.s), ["99001", "99002"])

    async def test_app_not_installed(self):
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.launch_package("com.disney.disneyplus")
        self.assertIn("not installed", str(cm.exception))
        self.assertEqual(launches(self.s), [])

    async def test_app_with_no_known_name_opens_by_roku_id(self):
        await self.tv.launch_package("roku.5")
        self.assertEqual(launches(self.s), ["5"])

    async def test_netflix_title_deep_link(self):
        for kind in ("series", "movie"):
            await self.tv.start_intent("https://www.netflix.com/title/80057281", "com.netflix.ninja", media_type=kind)
        self.assertEqual(launches(self.s), ["12?contentId=80057281&mediaType=series",
                                            "12?contentId=80057281&mediaType=movie"])

    async def test_youtube_video_deep_link(self):
        await self.tv.start_intent("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "com.google.android.youtube.tv")
        self.assertEqual(launches(self.s), ["837?contentId=dQw4w9WgXcQ&mediaType=live"])

    async def test_other_apps_open_without_a_deep_link(self):
        r = await self.tv.start_intent("https://www.stan.com.au/watch/some-show", "au.com.stan.and")
        self.assertEqual((r, launches(self.s)), ("app", ["99001"]))

    async def test_a_link_with_no_app_is_refused(self):
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://example.org/x")

    async def test_can_deeplink_only_netflix_and_youtube(self):
        self.assertTrue(self.tv.can_deeplink(apps.BY_ID["netflix"]) and self.tv.can_deeplink(apps.BY_ID["youtube"]))
        self.assertFalse(self.tv.can_deeplink(apps.BY_ID["stan"]))

    async def test_bad_channel_id_is_not_sent(self):
        with self.assertRaises(ValueError):
            await self.tv._launch("12/../keypress/PowerOff")
        self.assertEqual(self.s.log, [])


class Reading(Base):
    async def test_app_list_and_package_names(self):
        points = await self.tv.apps_on_tv()
        self.assertEqual([p["title"] for p in points],
                         ["Netflix", "YouTube", "Prime Video", "Stan", "SBS On Demand", "Some Local App"])   # not couch-tv itself
        by = {p["title"]: p["package"] for p in points}
        self.assertEqual(by["Netflix"], "com.netflix.ninja")
        self.assertEqual(by["Stan"], "au.com.stan.and")
        self.assertEqual(by["Some Local App"], "roku.5")
        self.assertIn("com.netflix.ninja", await self.tv.installed_packages())

    async def test_app_in_front(self):
        self.assertEqual(await self.tv.front_package(), "com.netflix.ninja")
        self.s.active = ("", "Roku")
        self.assertIsNone(await self.tv.front_package())           # Roku's own home counts as nothing
        self.s.active = ("tvinput.hdmi1", "HDMI 1")
        self.assertIsNone(await self.tv.front_package())
        self.assertEqual(self.tv.visible, "tvinput.hdmi1")
        self.s.active = ("dev", "Couch TV")
        self.assertEqual(await self.tv.front_package(), roku.HOME_PACKAGE)

    async def test_wait_for_app(self):
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}, timeout=1), "com.netflix.ninja")
        self.assertIsNone(await self.tv.wait_for_app({"au.com.stan.and"}, timeout=0.3))

    async def test_what_is_playing(self):
        await self.tv._read_power()
        self.tv.visible = "12"
        self.s.player = ("play", 61000, 3600000)
        await self.tv._watch_media()
        m = self.tv.state["media_now"]
        self.assertEqual((m["state"], m["position_ms"], m["package"]), ("playing", 61000, "com.netflix.ninja"))
        self.s.player = ("pause", 61000, 3600000)
        await self.tv._watch_media()
        self.assertEqual(self.tv.state["media_now"]["state"], "paused")
        self.s.player = None
        await self.tv._watch_media()
        self.assertEqual(self.tv.state["media_now"], {})

    async def test_icon(self):
        self.assertEqual(await self.tv.icon("12"), (PNG, "image/png"))
        with self.assertRaises(ValueError):
            await self.tv.icon("../x")


class ControlByMobileApps(Base):
    async def test_a_limited_roku_is_explained_not_called_dead(self):
        self.s.limited = True
        with self.assertRaises(roku.ECPLimited) as cm:
            await self.tv.key("up")
        self.assertIn("Control by mobile apps", str(cm.exception))
        self.assertTrue(self.tv.ecp_status()["limited"])
        self.assertIn("Permissive", self.tv.ecp_status()["message"])
        with self.assertRaises(roku.ECPLimited):
            await self.tv.launch_package("com.netflix.ninja")

    async def test_it_clears_when_the_setting_is_changed(self):
        self.s.limited = True
        with self.assertRaises(roku.ECPLimited):
            await self.tv.key("up")
        self.s.limited = False
        await self.tv.key("up")
        self.assertFalse(self.tv.ecp_status()["limited"])

    async def test_reading_still_works_when_commands_are_refused(self):
        self.s.limited = True
        await self.tv._read_power()
        self.assertTrue(self.tv.is_on)


class Hook(Base):
    async def run_hook(self, front, **cfg):
        t = self.s.tv(**cfg)
        self.s.active = front
        real_sleep = asyncio.sleep
        with patch("asyncio.sleep", new=lambda *_: real_sleep(0)):
            await t._hook()
        await t._session.close()
        return launches(self.s), t

    async def test_comes_on_at_the_home_opens_couch_tv(self):
        got, t = await self.run_hook(("", "Roku"))
        self.assertEqual(got, ["dev"])
        self.assertIn("opened couch-tv", t.hook_log[-1][1])

    async def test_comes_on_in_live_tv_opens_couch_tv(self):
        self.assertEqual((await self.run_hook(("tvinput.dtv", "Live TV")))[0], ["dev"])

    async def test_comes_on_in_an_app_is_left_alone(self):
        self.assertEqual((await self.run_hook(("12", "Netflix")))[0], [])

    async def test_couch_tv_already_open_is_left_alone(self):
        self.assertEqual((await self.run_hook(("dev", "Couch TV")))[0], [])

    async def test_an_input_in_use_is_left_alone_with_leave_inputs(self):
        self.assertEqual((await self.run_hook(("tvinput.hdmi1", "HDMI 1"), leave_inputs=True))[0], [])
        self.assertEqual((await self.run_hook(("tvinput.hdmi1", "HDMI 1")))[0], ["dev"])

    async def test_hook_can_be_switched_off(self):
        self.assertEqual((await self.run_hook(("", "Roku"), open_on_power_on=False))[0], [])

    async def test_a_command_just_run_keeps_the_hook_quiet_but_a_phone_wake_does_not(self):
        t = self.s.tv()
        t.quiet_until = time.monotonic() + 20
        real_sleep = asyncio.sleep
        self.s.active = ("", "Roku")
        with patch("asyncio.sleep", new=lambda *_: real_sleep(0)):
            await t._hook()
            self.assertEqual(launches(self.s), [])
            t.home_on_wake_until = time.monotonic() + 90
            await t._hook()
        self.assertEqual(launches(self.s), ["dev"])
        await t._session.close()

    async def test_the_watcher_fires_the_hook_when_the_tv_comes_on(self):
        self.s.power, self.s.active = "Ready", ("", "Roku")
        t = self.s.tv()
        fired = []

        async def hook():
            fired.append(1)

        t._hook = hook
        real_sleep = asyncio.sleep
        ticks = 0

        async def sleep(_):
            nonlocal ticks
            ticks += 1
            if ticks == 2:
                self.s.power = "PowerOn"
            if ticks > 4:
                raise asyncio.CancelledError
            await real_sleep(0)

        with patch("asyncio.sleep", new=sleep):
            with self.assertRaises(asyncio.CancelledError):
                await t._watch()
        self.assertEqual(fired, [1])
        await t._session.close()


class ServerEndpoints(Base):
    async def test_apps_endpoint_orders_and_gives_icons(self):
        class Req:
            query = {}

        with patch.object(server, "tv", self.tv):
            r = await server.h_roku_apps(Req())
        import json
        j = json.loads(r.text)
        titles = [a["title"] for a in j["apps"]]
        self.assertEqual(titles[:2], ["Netflix", "YouTube"])           # known apps in the catalogue's order
        self.assertEqual(j["apps"][0]["icon"], "/api/roku/icon/12")
        self.assertEqual(titles[-1], "Some Local App")

    async def test_icon_endpoint(self):
        class Req:
            match_info = {"id": "12"}

        with patch.object(server, "tv", self.tv):
            r = await server.h_roku_icon(Req())
        self.assertEqual((r.body, r.content_type), (PNG, "image/png"))

    async def test_make_tv_builds_a_roku(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "roku", "ip": "192.0.2.9"}), roku.RokuTV)


if __name__ == "__main__":
    unittest.main()
