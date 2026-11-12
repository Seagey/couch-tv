"""bridge/vidaa.py and bridge/tinymqtt.py against a stand-in VIDAA TV (tests/vidaa_standin.py): logging in
(plain, refused, and with a client certificate over TLS), where the TV is, keys, opening apps only from
the TV's own list, pairing with the PIN, the tile, the power on hook, the one time codes and the
bridge endpoints with the pairing key. NOT a real VIDAA TV: see docs/VIDAA.md."""
import asyncio
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
import server  # noqa: E402
import tinymqtt  # noqa: E402
import vidaa  # noqa: E402
import vidaa_auth  # noqa: E402
from tv import TVUnavailable  # noqa: E402
from vidaa_standin import PIN, REFRESH, TOKEN, StandIn, server_tls, tls_pair  # noqa: E402


class Base(unittest.IsolatedAsyncioTestCase):
    tls = None

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="vidaa-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self.s = await StandIn(self.tls).__aenter__()
        self.tv = self.s.tv()

    async def asyncTearDown(self):
        await self.tv._drop()
        await self.s.__aexit__()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    async def settle(self):
        for _ in range(5):
            await asyncio.sleep(0.02)

    async def sent(self, name):
        """What the stand-in was sent, once it has read it (publishing does not wait for the broker)."""
        await self.settle()
        return self.s.sent(name)

    async def launches(self):
        return [json.loads(p) for p in await self.sent("launchapp")]

    async def keys(self):
        return await self.sent("sendkey")


class Connecting(Base):
    async def test_logs_in_and_keeps_its_client_id(self):
        await self.tv._connection()
        self.assertEqual(len(self.s.logins), 1)                             # the first (modern) scheme got in
        cid, user, password = self.s.logins[0]
        self.assertEqual(cid, self.tv.client_id)
        self.assertRegex(cid, r"^C8:F7:33(:[0-9A-F]{2}){3}\$his\$[0-9A-F]{6}_vidaacommon_001$")
        self.assertRegex(user, r"^his\$\d+$")                               # worked out from the clock
        self.assertRegex(password, r"^[0-9A-F]{32}$")
        kept = json.load(open(os.path.join(self.data, "vidaa-lounge.json")))
        self.assertEqual((kept["client_id"], kept["uuid"], kept["auth_method"]),
                         (self.tv.client_id, self.tv.uuid, vidaa_auth.MODERN))
        self.assertEqual(self.s.tv().client_id, self.tv.client_id)          # the next start uses the same one

    async def test_a_tester_login_is_tried_once_per_port(self):
        t = self.s.tv(mqtt_user="u", mqtt_password="p")
        self.s.refuse = 5
        with self.assertRaises(TVUnavailable):
            await t._connection()
        self.assertEqual(self.s.logins, [(t.client_id, "u", "p")])

    async def test_a_bad_uuid_or_auth_method_in_config_is_refused(self):
        for cfg in ({"uuid": "me/#"}, {"auth_method": "newest"}):
            with self.assertRaises(SystemExit):
                self.s.tv(**cfg)

    async def test_a_refused_login_is_explained_and_not_retried_at_once(self):
        self.s.refuse = 5
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv._connection()
        self.assertIn("not authorised", str(cm.exception))
        self.assertIn("certificate", str(cm.exception))
        self.assertIn("not authorised", self.tv.vidaa_status()["error"])
        with self.assertRaises(TVUnavailable):
            await self.tv._connection()
        self.assertEqual(len(self.s.logins), len(vidaa_auth.ORDER))        # each scheme once, then waits 30 s

    async def test_a_client_id_with_mqtt_wildcards_is_refused(self):
        with self.assertRaises(SystemExit):
            self.s.tv(client_id="me/#")

    async def test_nothing_sent_when_the_tv_is_off_the_network(self):
        self.tv.connected = False
        with self.assertRaises(TVUnavailable):
            await self.tv.key("up")
        self.assertEqual(self.s.log, [])


class ClientCertificate(unittest.IsolatedAsyncioTestCase):
    """Mutual TLS: a stand-in that, like newer VIDAA firmware, only lets in a client with the certificate."""

    async def test_needs_the_certificate_and_uses_it(self):
        if not shutil.which("openssl"):
            self.skipTest("needs the openssl command")
        # the stand-in turning away the first, certificate-less client is logged by asyncio: expected
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: None)
        data = tempfile.mkdtemp(prefix="vidaa-tls-")
        try:
            with patch.object(config, "DATA", data):
                cert, key = tls_pair(data)
                async with StandIn(server_tls(cert, key, client_cert=cert)) as s:
                    t = s.tv()
                    with self.assertRaises(TVUnavailable):
                        await t._connection()
                    self.assertFalse(t.vidaa_status()["certificate"])
                    os.makedirs(os.path.join(data, "vidaa"))
                    shutil.copy(cert, os.path.join(data, "vidaa", "client.pem"))
                    shutil.copy(key, os.path.join(data, "vidaa", "client.key"))
                    t = s.tv()
                    await t._connection()
                    self.assertTrue(t.vidaa_status()["mqtt"] and t.vidaa_status()["certificate"])
                    self.assertEqual(await t.read_state(), "remote_launcher")
                    await t._drop()
        finally:
            shutil.rmtree(data, ignore_errors=True)


class State(Base):
    async def test_where_the_tv_is_decides_on_and_off(self):
        self.assertEqual(await self.tv.read_state(), "remote_launcher")
        self.assertTrue(self.tv.is_on)
        self.s.statetype = "fake_sleep_0"
        await self.tv.read_state()
        self.assertFalse(self.tv.is_on)
        self.tv.connected = False
        self.assertIsNone(self.tv.is_on)

    async def test_a_broadcast_state_is_heard(self):
        await self.tv._connection()
        await self.s.broadcast_state("livetv")      # sent at QoS 1, so the client must acknowledge it
        await self.settle()
        self.assertEqual(self.tv.statetype, "livetv")
        await self.s.broadcast_state("fake_sleep_0")
        await self.settle()
        self.assertFalse(self.tv.is_on)

    async def test_no_answer_is_unknown_not_off(self):
        self.s.silent.add("gettvstate")
        self.assertIsNone(await self.tv.read_state(timeout=0.3))
        self.assertIsNone(self.tv.is_on)

    async def test_app_list_and_package_names(self):
        await self.tv.refresh_installed()
        by = {a["name"]: a["package"] for a in await self.tv.apps_on_tv()}
        self.assertEqual(by["Netflix"], "com.netflix.ninja")
        self.assertEqual(by["Prime Video"], apps.BY_ID["prime-video"]["package"])
        self.assertEqual(by["Stan"], "au.com.stan.and")
        self.assertEqual(by["Some Local App"], "vidaa.90")
        self.assertIn("com.netflix.ninja", await self.tv.installed_packages())

    async def test_an_app_list_entry_with_a_strange_id_is_dropped(self):
        self.s.apps.append({"appId": "x/../#", "name": "Odd", "url": "", "urlType": 1, "storeType": 0})
        await self.tv.refresh_installed()
        self.assertNotIn("Odd", [a["name"] for a in self.tv.applist])


class Keys(Base):
    async def test_remote_keys(self):
        await self.tv.read_state()
        for k in ("up", "down", "left", "right", "ok", "back", "play_pause", "volume_up", "volume_down",
                  "mute", "vidaa_home", "KEY_RED", "7"):
            await self.tv.key(k)
        await self.settle()
        self.assertEqual(await self.keys(), ["KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT", "KEY_OK", "KEY_RETURNS",
                                        "KEY_PLAY", "KEY_VOLUMEUP", "KEY_VOLUMEDOWN", "KEY_MUTE", "KEY_HOME",
                                        "KEY_RED", "KEY_7"])
        self.assertTrue(all(t.endswith("/actions/sendkey") and "/remote_service/" in t
                            for t, _ in self.s.log if t.endswith("sendkey")))

    async def test_unknown_or_unsafe_key_is_refused_before_anything_is_sent(self):
        for bad in ("banana", "KEY_UP/../x", "KEY_UP#", "", None, "key_" + "A" * 40):
            with self.assertRaises(ValueError):
                await self.tv.key(bad)
        self.assertEqual(self.s.log, [])

    async def test_power_off_then_on_from_standby(self):
        await self.tv.read_state()
        await self.tv.key("power")
        await self.settle()
        await self.tv.read_state()
        self.assertFalse(self.tv.is_on)
        await self.tv.key("power")                     # standby: the broker still answers, so a key
        await self.settle()
        self.assertEqual(await self.keys(), ["KEY_POWER", "KEY_POWER"])
        self.assertGreater(self.tv.home_on_wake_until, time.monotonic())

    async def test_power_on_from_fully_off_is_wake_on_lan(self):
        woke = []

        async def wake():
            woke.append(1)

        self.tv.wake = wake
        self.tv.statetype = None                       # the broker is gone with the TV
        await self.tv.key("power")
        self.assertEqual((woke, await self.keys()), ([1], []))

    async def test_home_opens_couch_tv_in_the_browser_without_the_key(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            self.assertEqual(await self.tv.key("home"), "couch-tv")
        [l] = await self.launches()
        self.assertEqual((l["appId"], l["name"]), ("77", "Browser"))
        self.assertIn("/tv/?vidaa=", l["url"])
        self.assertNotIn("couchpass123", l["url"])
        self.assertNotIn("key=", l["url"])
        self.assertEqual(await self.keys(), [])

    async def test_typing_is_not_built(self):
        with self.assertRaises(TVUnavailable):
            await self.tv.text("hi")

    async def test_volume_has_no_level(self):
        self.assertFalse(self.tv.volume["known"])


class Launching(Base):
    async def test_known_app_opens_with_the_tvs_own_fields(self):
        await self.tv.launch_package("com.netflix.ninja")
        self.assertEqual(await self.launches(), [{"appId": "1", "name": "Netflix", "url": "netflix", "urlType": 37,
                                             "storeType": 0}])
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}, timeout=1), "com.netflix.ninja")
        await self.tv.read_state()
        self.assertEqual(self.tv.current_package, "com.netflix.ninja")

    async def test_found_by_its_name_and_by_catalogue_id(self):
        await self.tv.launch_package("au.com.stan.and")
        await self.tv.launch_package("prime-video")
        self.assertEqual([l["appId"] for l in await self.launches()], ["40", "3"])

    async def test_not_installed(self):
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.launch_package("com.disney.disneyplus")
        self.assertIn("not installed", str(cm.exception))
        self.assertEqual(await self.launches(), [])

    async def test_only_an_app_the_tv_listed_is_ever_sent(self):
        await self.tv.launch_package("vidaa.90")
        for bad in ("vidaa.999", "vidaa.1/../x", "vidaa.#", "com.evil.app", "vidaa."):
            with self.assertRaises(TVUnavailable):
                await self.tv.launch_package(bad)
        with self.assertRaises(ValueError):
            await self.tv._launch("not-listed")
        self.assertEqual([l["appId"] for l in await self.launches()], ["90"])

    async def test_links_only_open_the_app(self):
        r = await self.tv.start_intent("https://www.netflix.com/title/80057281", "com.netflix.ninja")
        self.assertEqual((r, [l["url"] for l in await self.launches()]), ("app", ["netflix"]))   # no title in it
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://example.org/x")
        self.assertFalse(self.tv.can_deeplink(apps.BY_ID["netflix"]))

    async def test_back_on_the_home_means_nothing_is_in_front(self):
        await self.tv.launch_package("com.netflix.ninja")
        await self.tv.read_state()
        self.assertEqual(self.tv.current_package, "com.netflix.ninja")
        self.s.statetype = "remote_launcher"
        await self.tv.read_state()
        self.assertIsNone(self.tv.current_package)


class Pairing(Base):
    async def test_pin_pairs_this_uuid_and_keeps_a_token_if_one_is_sent(self):
        await self.tv.pair_start()
        await self.settle()
        self.assertTrue(self.s.pin_shown)
        self.assertEqual(json.loads(self.s.sent("vidaa_app_connect")[-1]), vidaa.PROTOCOL["app_connect"])
        self.assertFalse(self.tv.paired)
        await self.tv.pair_finish(PIN)
        self.assertEqual(json.loads(self.s.sent("authenticationcode")[-1]), {"authNum": int(PIN)})
        self.assertTrue(self.tv.paired)
        self.assertEqual(self.tv.token, TOKEN)            # older firmware sends one: it is kept
        path = os.path.join(self.data, "vidaa-lounge.json")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertTrue(self.tv.vidaa_status()["token"])
        t = self.s.tv()                                   # the next start: same uuid, still paired
        self.assertTrue(t.paired)
        self.assertEqual((t.uuid, t.client_id), (self.tv.uuid, self.tv.client_id))
        await t.read_state()
        cid, user, _ = self.s.logins[-1]
        self.assertEqual(cid, t.client_id)
        self.assertRegex(user, r"^his\$\d+$")             # fresh clock credentials, not the token
        await t._drop()

    async def test_a_wrong_pin_keeps_no_token(self):
        await self.tv.pair_start()
        with self.assertRaises(vidaa.VidaaError):
            await self.tv.pair_finish("0000")
        self.assertIsNone(self.tv.token)

    async def test_pin_shape_checked_before_anything_is_sent(self):
        for bad in ("123", "12345", "12a4", "", None, "1234\n/x"):
            with self.assertRaises(ValueError):
                await self.tv.pair_finish(bad)
        self.assertEqual(self.s.log, [])

    async def test_trace_never_logs_the_pin_or_the_token(self):
        t = self.s.tv(trace=True)
        with self.assertLogs("vidaa.lounge", logging.INFO) as cm:
            await t.pair_start()
            await t.pair_finish(PIN)
        out = "\n".join(cm.output)
        self.assertIn("trace out", out)
        self.assertIn('"authNum":"(hidden)"', out)        # the PIN goes as a number and is still hidden
        self.assertNotIn(PIN, out)
        self.assertNotIn(TOKEN, out)
        await t._drop()

    async def test_trace_hides_the_refresh_token_from_tokenissuance(self):
        # a 43A6N (VIDAA Q0707) sends accesstoken and refreshtoken on tokenissuance (#145)
        self.s.issue_token = True
        t = self.s.tv(trace=True)
        with self.assertLogs("vidaa.lounge", logging.INFO) as cm:
            await t.pair_start()
            await t.pair_finish(PIN)
        out = "\n".join(cm.output)
        self.assertIn("tokenissuance", out)
        self.assertRegex(out, r'"refreshtoken": ?"\(hidden\)"')
        self.assertNotIn(REFRESH, out)
        self.assertNotIn(TOKEN, out)
        self.assertNotIn(PIN, out)
        await t._drop()

    def test_trace_pattern_hides_every_token_like_key(self):
        hide = lambda txt: vidaa.TRACE_HIDE.sub(r'\1"(hidden)"', txt)
        out = hide('{"accesstoken":"a1","refresh_token":"r\\"2","RefreshToken":"r3","id_token":7,'
                   '"client_secret":"s","password":"p","authNum":1234,"name":"tokenissuance","result":1}')
        for secret in ('"a1"', 'r\\"2', '"r3"', ':7', '"s"', '"p"', '1234'):
            self.assertNotIn(secret, out)
        self.assertIn('"name":"tokenissuance"', out)    # a value that merely says token stays
        self.assertIn('"result":1', out)

    async def test_a_token_on_tokenissuance_is_kept(self):
        # the TV pushes tokenissuance right after the PIN and never answers gettoken: still a token
        self.s.issue_token = True
        await self.tv.pair_start()
        with self.assertLogs("vidaa.lounge", logging.INFO) as cm:
            await self.tv.pair_finish(PIN)
        self.assertEqual(self.tv.token, TOKEN)
        self.assertIn("with a token", "\n".join(cm.output))
        self.assertNotIn("no token on this firmware", "\n".join(cm.output))


class Tile(Base):
    async def test_tile_added_then_home_opens_the_tile(self):
        self.assertTrue(await self.tv.install_tile(wait=0.05))
        [ev] = [json.loads(p) for p in await self.sent("uievent")]
        self.assertEqual(ev["type"], "app_install")
        self.assertEqual((ev["app_info"]["Id"], ev["app_info"]["Title"], ev["app_info"]["StoreType"]),
                         (vidaa.TILE_ID, "Couch TV", 99))
        self.assertTrue(ev["app_info"]["Image"].endswith("/vidaa/icon.png"))
        self.assertNotIn("vidaa=", ev["app_info"]["URL"])            # a tile's address is kept: no code in it
        await self.tv.open_home()
        self.assertEqual((await self.launches())[-1]["appId"], vidaa.TILE_ID)
        self.assertNotIn("Couch TV", [a["name"] for a in await self.tv.apps_on_tv()])

    async def test_newer_firmware_refuses_and_the_browser_stays(self):
        self.s.tile_allowed = False
        self.assertFalse(await self.tv.install_tile(wait=0.05))
        await self.tv.open_home()
        self.assertEqual((await self.launches())[-1]["appId"], "77")

    async def test_no_tile_and_no_browser(self):
        self.s.apps = [a for a in self.s.apps if a["name"] != "Browser"]
        with self.assertRaises(TVUnavailable) as cm:
            await self.tv.open_home()
        self.assertIn("browser", str(cm.exception))
        self.assertEqual(await self.launches(), [])

    async def test_browser_by_its_name_in_config(self):
        self.s.apps = [dict(a, name="Opera TV Browser") if a["name"] == "Browser" else a for a in self.s.apps]
        t = self.s.tv(browser="Opera TV Browser")
        await t.open_home()
        self.assertEqual((await self.launches())[-1]["appId"], "77")
        await t._drop()

    async def test_home_url_from_config_and_other_tvs(self):
        t = self.s.tv(home_url="http://192.0.2.20:5400/tv/", id="bedroom")
        self.assertEqual(t.home_url(), "http://192.0.2.20:5400/tv/?tv=bedroom")
        self.assertEqual(t.home_url("abc"), "http://192.0.2.20:5400/tv/?tv=bedroom&vidaa=abc")

    async def test_pointer_is_opt_in(self):
        # "pointer": true lets the page take the TV Browser's mouse clicks (#145); off, nothing changes
        self.assertNotIn("pointer", self.s.tv(home_url="http://192.0.2.20:5400/tv/").home_url("abc"))
        t = self.s.tv(home_url="http://192.0.2.20:5400/tv/", pointer=True)
        self.assertEqual(t.home_url("abc"), "http://192.0.2.20:5400/tv/?pointer=1&vidaa=abc")
        self.assertFalse(self.s.tv(pointer="yes").pointer)   # only a real true turns it on


class OneTimeCodes(Base):
    async def test_a_code_works_once(self):
        c = self.tv.new_code()
        self.assertTrue(self.tv.claim(c))
        self.assertFalse(self.tv.claim(c))
        self.assertFalse(self.tv.claim("made-up-code"))
        self.assertFalse(self.tv.claim(None))

    async def test_a_code_runs_out(self):
        c = self.tv.new_code()
        self.tv._codes[c] = time.monotonic() - 1
        self.assertFalse(self.tv.claim(c))


class Hook(Base):
    async def run_hook(self, front, **cfg):
        t = self.s.tv(**cfg)
        self.s.statetype = front
        with patch.object(vidaa, "SETTLE", 0):
            await t._hook()
        await t._drop()
        return [l["appId"] for l in await self.launches()], t

    async def test_comes_on_at_the_vidaa_home_opens_couch_tv(self):
        got, t = await self.run_hook("remote_launcher")
        self.assertEqual(got, ["77"])
        self.assertIn("opened couch-tv", t.hook_log[-1][1])

    async def test_comes_on_in_live_tv_opens_couch_tv(self):
        self.assertEqual((await self.run_hook("livetv"))[0], ["77"])

    async def test_anything_else_is_left_alone(self):
        for st in ("app", "remote_setting", "something_new"):
            self.assertEqual((await self.run_hook(st))[0], [])

    async def test_an_input_is_left_alone_with_leave_inputs(self):
        self.assertEqual((await self.run_hook("sourceswitch", leave_inputs=True))[0], [])
        self.assertEqual((await self.run_hook("sourceswitch"))[0], ["77"])

    async def test_hook_can_be_switched_off(self):
        self.assertEqual((await self.run_hook("remote_launcher", open_on_power_on=False))[0], [])

    async def test_a_state_that_cannot_be_read_is_left_alone(self):
        self.s.silent.add("gettvstate")
        got, t = await self.run_hook("remote_launcher")
        self.assertEqual(got, [])
        self.assertIn("could not read", t.hook_log[-1][1])

    async def test_a_command_just_run_keeps_the_hook_quiet_but_a_phone_wake_does_not(self):
        t = self.s.tv()
        t.quiet_until = time.monotonic() + 20
        with patch.object(vidaa, "SETTLE", 0):
            await t._hook()
            self.assertEqual(await self.launches(), [])
            t.home_on_wake_until = time.monotonic() + 90
            await t._hook()
        self.assertEqual([l["appId"] for l in await self.launches()], ["77"])
        await t._drop()

    async def test_the_watcher_fires_the_hook_when_the_tv_comes_on(self):
        self.s.statetype = "fake_sleep_0"
        t = self.s.tv()
        fired = []

        async def hook():
            fired.append(1)

        t._hook = hook
        with patch.object(vidaa, "WATCH_EVERY", 0.02):
            task = asyncio.create_task(t._watch())
            await asyncio.sleep(0.3)
            self.assertEqual((fired, t.is_on), ([], False))
            self.s.statetype = "remote_launcher"
            await asyncio.sleep(0.4)
            task.cancel()
        self.assertTrue(fired)        # the state answer and the watcher may both call it: _hook keeps it to one
        self.assertTrue(t.is_on)
        await t._drop()

    async def test_two_calls_to_the_hook_open_couch_tv_once(self):
        t = self.s.tv()
        with patch.object(vidaa, "SETTLE", 0):
            await asyncio.gather(t._hook(), t._hook())
        self.assertEqual([l["appId"] for l in await self.launches()], ["77"])
        await t._drop()


class KeepHome(Base):
    async def watch(self, **cfg):
        t = self.s.tv(**cfg)
        await t._connection()
        await self.s.broadcast_state("livetv")
        await self.settle()
        return t

    async def test_off_unless_asked_for(self):
        self.assertFalse(self.s.tv().keep_home)
        t = await self.watch()
        await self.s.broadcast_state("remote_launcher")
        await asyncio.sleep(0.3)
        self.assertEqual(await self.launches(), [])
        await t._drop()

    async def test_vidaa_home_bounces_back_to_couch_tv(self):
        t = await self.watch(keep_home=True)
        await self.s.broadcast_state("remote_launcher")
        await asyncio.sleep(0.3)
        self.assertEqual([l["appId"] for l in await self.launches()], ["77"])
        await t._drop()

    async def test_the_phone_remotes_vidaa_home_key_is_not_bounced(self):
        t = await self.watch(keep_home=True)
        await t.key("vidaa_home")
        await self.s.broadcast_state("remote_launcher")
        await asyncio.sleep(0.3)
        self.assertEqual(await self.launches(), [])
        await t._drop()

    async def test_the_input_key_holds_the_bounce_until_a_source_is_picked(self):
        # VIDAA's source picker sits on its own home: keep_home must not pull couch-tv over it (#145)
        t = await self.watch(keep_home=True)
        await t.key("input")
        await self.s.broadcast_state("remote_launcher")
        await asyncio.sleep(0.3)
        self.assertEqual(await self.launches(), [])
        await self.s.broadcast_state("sourceswitch")      # an input was picked: the hold ends
        await self.settle()
        self.assertEqual(t._input_until, 0.0)
        await self.s.broadcast_state("remote_launcher")    # Home from the input bounces as usual
        await asyncio.sleep(0.3)
        self.assertEqual([l["appId"] for l in await self.launches()], ["77"])
        await t._drop()

    async def test_the_input_hold_runs_out(self):
        t = await self.watch(keep_home=True)
        with patch.object(vidaa, "INPUT_PAUSE", 0.1):
            await t.key("input")
        await asyncio.sleep(0.2)
        await self.s.broadcast_state("remote_launcher")
        await asyncio.sleep(0.3)
        self.assertEqual([l["appId"] for l in await self.launches()], ["77"])
        await t._drop()


class MQTTFraming(unittest.TestCase):
    def test_remaining_length_edges(self):
        for n, enc in ((0, b"\x00"), (127, b"\x7f"), (128, b"\x80\x01"), (16383, b"\xff\x7f"),
                       (16384, b"\x80\x80\x01"), (268435455, b"\xff\xff\xff\x7f")):
            self.assertEqual(tinymqtt._length(n), enc)
        with self.assertRaises(ValueError):
            tinymqtt._length(268435456)

    def test_connect_packet_flags(self):
        p = tinymqtt.connect_packet("cid", "u", "p", keepalive=30)
        self.assertEqual(p[0], 0x10)
        self.assertEqual(p[2:8], b"\x00\x04MQTT")
        self.assertEqual((p[8], p[9]), (4, 0xC2))   # level 4; user, password, clean session


class Endpoints(Base):
    """The bridge's VIDAA endpoints behind its real middleware, with a pairing key set."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tvs = patch.multiple(server, TVS={"lounge": self.tv}, DEFAULT_TV="lounge")
        self._tvs.start()
        self._key = patch.object(config, "PAIRING_KEY", "couchpass123")
        self._key.start()
        server._failed_attempts.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_post("/api/vidaa/pair", server.h_vidaa_pair)
        app.router.add_post("/api/vidaa/tile", server.h_vidaa_tile)
        app.router.add_post("/api/vidaa/claim", server.h_vidaa_claim)
        app.router.add_get("/api/tvs", server.h_tvs)
        app.router.add_get("/vidaa/icon.png", server.h_vidaa_icon)
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
        r = await self.post("/api/vidaa/pair", {}, key=False)
        self.assertEqual(r.status, 401)
        self.assertFalse(self.s.pin_shown)

    async def test_pairing_through_the_bridge(self):
        r = await self.post("/api/vidaa/pair", {})
        self.assertEqual((r.status, (await r.json())["step"]), (200, "pin"))
        r = await self.post("/api/vidaa/pair", {"pin": "12a4"})
        self.assertEqual(r.status, 400)
        r = await self.post("/api/vidaa/pair", {"pin": PIN})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.tv.token, TOKEN)

    async def test_tile_needs_the_key(self):
        r = await self.post("/api/vidaa/tile", {}, key=False)
        self.assertEqual(r.status, 401)
        self.assertEqual(await self.sent("uievent"), [])

    async def test_claim_swaps_a_code_for_the_key_once(self):
        code = self.tv.new_code()
        r = await self.post("/api/vidaa/claim", {"code": code}, key=False)
        self.assertEqual((r.status, (await r.json())["key"]), (200, "couchpass123"))
        r = await self.post("/api/vidaa/claim", {"code": code}, key=False)
        self.assertEqual(r.status, 401)

    async def test_wrong_codes_are_rate_limited(self):
        with patch.object(server, "client_ip", return_value="192.0.2.50"):
            for i in range(5):
                r = await self.post("/api/vidaa/claim", {"code": f"guess-{i}"}, key=False)
                self.assertEqual(r.status, 401)
            good = self.tv.new_code()
            r = await self.post("/api/vidaa/claim", {"code": good}, key=False)
            self.assertEqual(r.status, 429)

    async def test_tvs_shows_the_vidaa_status(self):
        r = await self.client.get("/api/tvs", headers={"Authorization": "Bearer couchpass123"})
        row = (await r.json())["tvs"][0]
        self.assertEqual(row["kind"], "vidaa")
        self.assertEqual(set(row["vidaa"]), {"mqtt", "statetype", "token", "certificate", "tile", "browser", "error"})

    async def test_tile_icon_is_served(self):
        r = await self.client.get("/vidaa/icon.png")
        self.assertEqual(r.status, 200)

    async def test_make_tv_builds_a_vidaa(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "vidaa", "ip": "192.0.2.9"}),
                              vidaa.VidaaTV)


if __name__ == "__main__":
    unittest.main()
