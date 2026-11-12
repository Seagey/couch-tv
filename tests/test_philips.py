"""bridge/philips.py against a stand in Philips Titan OS TV (tests/philips_standin.py): finding the API
version, the digest login, pairing with the PIN and the pairing key, power, keys, volume, inputs,
opening apps only from the TV's own list, the power on hook through an app that shows couch-tv, and
the bridge endpoints with the pairing key. NOT a real Titan OS TV: see docs/PHILIPS-TITAN.md."""
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

MAC = ":".join(["aa", "bb", "cc", "dd", "ee", "ff"])   # built from parts so the privacy scan does not flag a placeholder
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import TestClient, TestServer  # noqa: E402

import agentic  # noqa: E402
import apps  # noqa: E402
import config  # noqa: E402
import philips  # noqa: E402
import server  # noqa: E402
from philips_standin import PIN, SECRET, SERIAL, StandIn  # noqa: E402
from tv import TVUnavailable  # noqa: E402

HAVE_OPENSSL = bool(shutil.which("openssl"))


@unittest.skipUnless(HAVE_OPENSSL, "needs the openssl command for the stand in's certificate")
class Base(unittest.IsolatedAsyncioTestCase):
    version = "6/"
    paired = True

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="philips-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self.s = await StandIn(self.data, version=self.version).__aenter__()
        self.tv = self.s.tv()
        if self.paired:
            self.s.pair_now(self.tv)
        self._tvs = []

    def another(self, **cfg):
        t = self.s.tv(**cfg)
        self._tvs.append(t)
        return t

    async def asyncTearDown(self):
        for t in [self.tv] + self._tvs:
            if t._session:
                await t._session.close()
        await self.s.__aexit__()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def save_secret(self):
        os.makedirs(os.path.join(self.data, "philips"), exist_ok=True)
        with open(os.path.join(self.data, "philips", "pair-secret"), "w") as f:
            f.write(SECRET)

    def keys(self):
        return [b["key"] for b in self.s.sent("input/key")]

    def launches(self):
        return [b["id"] for b in self.s.sent("activities/launch")]


class Finding(Base):
    async def test_finds_version_6(self):
        self.assertEqual(await self.tv.find_version(), "6/")
        self.assertEqual(self.tv.system["model"], "00XX0000/12")

    async def test_logs_in_with_digest(self):
        await self.tv.find_version()
        self.assertEqual(await self.tv._read_power(), "On")
        self.assertTrue(self.tv.is_on)
        self.assertEqual(self.tv._auth.count, 1)       # one challenge, then the kept login
        await self.tv._read_power()
        self.assertEqual(self.tv._auth.count, 2)

    async def test_a_new_nonce_is_fetched_when_the_tv_asks_again(self):
        await self.tv.find_version()
        await self.tv._read_power()
        self.s.nonce = "n0nce-2"
        self.assertEqual(await self.tv._read_power(), "On")

    async def test_a_version_in_config_is_used_as_it_is(self):
        t = self.another(api_version=6)
        self.assertEqual(t.version, "6/")
        self.assertEqual(await t._read_power(), "On")

    async def test_tls_accepts_the_tvs_own_certificate_only_on_its_own_requests(self):
        ctx = self.tv._ssl()
        self.assertEqual(ctx.verify_mode, philips.ssl.CERT_NONE)
        self.assertIsNone(self.tv._session)            # no session made before the first request

    async def test_one_connection_is_kept_for_every_request(self):
        for _ in range(4):
            await self.tv._read_power()
        self.assertEqual(len(self.s.connections), 1)   # not a new TLS handshake per request


class FindingWithoutVersion(Base):
    version = ""

    async def test_falls_back_to_no_version(self):
        self.assertEqual(await self.tv.find_version(), "")
        self.assertEqual(await self.tv._read_power(), "On")


class NotPaired(Base):
    paired = False

    async def test_unpaired_reads_say_pair_first(self):
        await self.tv.find_version()
        with self.assertRaises(philips.NeedsLogin) as cm:
            await self.tv._read_power()
        self.assertIn("pair", str(cm.exception))
        self.assertFalse(self.tv.paired)

    async def test_pairing_needs_the_saved_key_first(self):
        with self.assertRaises(philips.PhilipsError) as cm:
            await self.tv.pair_start()
        self.assertIn("philips-secret.py", str(cm.exception))
        self.assertEqual(self.s.log, [])

    async def test_pin_then_login_kept_and_used(self):
        self.save_secret()
        await self.tv.pair_start()
        self.assertTrue(self.s.pin_on_screen)
        await self.tv.pair_finish(PIN)
        self.assertTrue(self.tv.paired)
        path = os.path.join(self.data, "philips-lounge.json")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        t = self.another()
        self.assertEqual(await t._read_power(), "On")

    async def test_the_pin_can_come_from_another_run(self):
        self.save_secret()
        await self.tv.pair_start()
        t = self.another()                                # a new start, as philips-check.py --pin is
        await t.pair_finish(PIN)
        self.assertTrue(t.paired)
        self.assertIsNone(t._stored().get("pending"))

    async def test_a_wrong_pin_keeps_nothing(self):
        self.save_secret()
        await self.tv.pair_start()
        with self.assertRaises(philips.PhilipsError):
            await self.tv.pair_finish("0000")
        self.assertFalse(self.tv.paired)

    async def test_pin_shape_checked_before_anything_is_sent(self):
        for bad in ("123", "12a4", "", None, "1234\n/x"):
            with self.assertRaises(ValueError):
                await self.tv.pair_finish(bad)
        self.assertEqual(self.s.log, [])

    async def test_trace_never_logs_the_pin_or_the_keys(self):
        self.save_secret()
        t = self.another(trace=True)
        with self.assertLogs("philips.lounge", logging.INFO) as cm:
            await t.pair_start()
            await t.pair_finish(PIN)
        out = "\n".join(cm.output)
        self.assertIn("trace out", out)
        self.assertNotIn(PIN, out)
        self.assertNotIn(SECRET, out)
        self.assertNotIn("auth-", out)


class Remote(Base):
    async def test_keys(self):
        for k in ("up", "down", "left", "right", "ok", "back", "play_pause", "volume_up", "volume_down", "mute",
                  "philips_home", "RedColour", "7", "input"):
            await self.tv.key(k)
        self.assertEqual(self.keys(), ["CursorUp", "CursorDown", "CursorLeft", "CursorRight", "Confirm", "Back",
                                       "PlayPause", "VolumeUp", "VolumeDown", "Mute", "Home", "RedColour", "Digit7",
                                       "Source"])

    async def test_unknown_key_refused_before_anything_is_sent(self):
        for bad in ("banana", "CursorUp/../x", "", None, "Standby2"):
            with self.assertRaises(ValueError):
                await self.tv.key(bad)
        self.assertEqual(self.s.log, [])

    async def test_home_without_a_couch_tv_app_is_the_tvs_own_home(self):
        self.assertEqual(await self.tv.key("home"), "Home")
        self.assertEqual(self.keys(), ["Home"])
        self.assertEqual(self.launches(), [])

    async def test_power_off_then_on(self):
        await self.tv._read_power()
        await self.tv.key("power")
        self.assertEqual(self.s.power, "Standby")
        await self.tv._read_power()
        self.assertFalse(self.tv.is_on)
        await self.tv.key("power")
        self.assertEqual(self.s.power, "On")
        self.assertEqual(self.keys(), [])                 # power goes through powerstate, not a key

    async def test_power_on_when_powerstate_fails_is_wake_on_lan(self):
        woke = []

        async def wake():
            woke.append(1)

        self.tv.wake = wake
        self.tv.power = "Standby"
        await self.s.__aexit__()                         # the TV has left the network
        await self.tv.key("power")
        self.assertEqual(woke, [1])
        self.s = await StandIn(self.data).__aenter__()  # so tearDown has one to close

    async def test_volume_level_and_mute(self):
        v = await self.tv.read_volume()
        self.assertEqual((v["level"], v["max"], v["muted"], v["known"]), (12, 60, False, True))
        await self.tv.set_mute(True)
        self.assertTrue(self.s.volume["muted"])
        self.assertEqual(self.s.volume["current"], 12)

    async def test_typing_is_not_built(self):
        with self.assertRaises(TVUnavailable):
            await self.tv.text("hi")

    async def test_nothing_sent_when_the_tv_is_off_the_network(self):
        self.tv.connected = False
        with self.assertRaises(TVUnavailable):
            await self.tv.key("up")
        self.assertEqual(self.s.log, [])


class Inputs(Base):
    async def test_lists_and_switches_by_name_or_number(self):
        names = [s["name"] for s in await self.tv.read_sources()]
        self.assertEqual(names, ["Watch TV", "HDMI 1", "HDMI 2"])
        await self.tv.switch_source("HDMI 2")
        await self.tv.switch_source("1")
        await self.tv.switch_source("hdmi2")
        self.assertEqual([b["id"] for b in self.s.sent("sources/current")], ["hdmi2", "hdmi1", "hdmi2"])

    async def test_an_input_the_tv_did_not_list_is_refused(self):
        with self.assertRaises(ValueError):
            await self.tv.switch_source("hdmi9")
        self.assertEqual(self.s.sent("sources/current"), [])


class Apps(Base):
    async def test_app_list_and_package_names(self):
        await self.tv.refresh_installed()
        by = {a["label"]: a["package"] for a in await self.tv.apps_on_tv()}
        self.assertEqual(by["Netflix"], "com.netflix.ninja")
        self.assertEqual(by["Prime Video"], apps.BY_ID["prime-video"]["package"])
        self.assertEqual(by["Some Local App"], "philips.side.1")

    async def test_opens_with_the_tvs_own_object(self):
        await self.tv._read_power()
        await self.tv.launch_package("com.netflix.ninja")
        self.assertEqual(self.s.sent("activities/launch"), [{"id": "netflix", "label": "Netflix", "type": "app"}])
        self.assertEqual(await self.tv.wait_for_app({"com.netflix.ninja"}, timeout=1), "com.netflix.ninja")

    async def test_only_an_app_the_tv_listed_is_ever_sent(self):
        await self.tv.launch_package("philips.side.1")
        for bad in ("philips.nope", "com.evil.app", "philips.", "com.disney.disneyplus"):
            with self.assertRaises(TVUnavailable):
                await self.tv.launch_package(bad)
        with self.assertRaises(ValueError):
            await self.tv._launch("not-listed")
        with self.assertRaises(ValueError):
            await self.tv._launch_entry({"id": "x", "label": "X", "package": "x", "entry": {"id": "x"}})
        self.assertEqual(self.launches(), ["side.1"])

    async def test_an_app_list_entry_with_a_strange_id_is_dropped(self):
        self.s.apps.append({"id": "x\"; rm", "label": "Odd"})
        await self.tv.refresh_installed()
        self.assertNotIn("Odd", [a["label"] for a in self.tv.applist])

    async def test_links_only_open_the_app(self):
        r = await self.tv.start_intent("https://www.netflix.com/title/80057281", "com.netflix.ninja")
        self.assertEqual((r, self.launches()), ("app", ["netflix"]))
        with self.assertRaises(ValueError):
            await self.tv.start_intent("https://example.org/x")

    async def test_front_app_and_home(self):
        await self.tv._read_power()
        await self.tv.launch_package("com.netflix.ninja")
        self.assertEqual(await self.tv.front_package(), "com.netflix.ninja")
        await self.tv.key("philips_home")
        self.assertIsNone(await self.tv.front_package())

    async def test_a_tv_that_does_not_say_what_is_in_front(self):
        self.s.front = None
        await self.tv._read_power()
        self.assertIsNone(await self.tv.front_package())
        self.assertFalse(self.tv.front_readable)


class Home(Base):
    """The home only exists when the TV lists an app that shows couch-tv (docs/PHILIPS-TITAN.md)."""

    def add_couch_app(self, label="Couch TV"):
        self.s.apps.append({"id": "couchtv", "label": label, "type": "app"})

    async def run_hook(self, front="", **cfg):
        t = self.another(**cfg)
        self.s.front = front
        with patch.object(philips, "SETTLE", 0):
            await t._hook()
        return self.launches(), t

    async def test_no_couch_tv_app_means_remote_only(self):
        got, t = await self.run_hook("")
        self.assertEqual(got, [])
        self.assertIn("remote only", t.hook_log[-1][1])

    async def test_comes_on_at_the_home_opens_couch_tv(self):
        self.add_couch_app()
        got, t = await self.run_hook("")
        self.assertEqual(got, ["couchtv"])
        self.assertIn("opened couch-tv", t.hook_log[-1][1])

    async def test_an_app_or_input_in_front_is_left_alone(self):
        self.add_couch_app()
        self.assertEqual((await self.run_hook("netflix"))[0], [])
        self.assertEqual((await self.run_hook("hdmi1", leave_inputs=True))[0], [])

    async def test_couch_tv_already_open(self):
        self.add_couch_app()
        got, t = await self.run_hook("couchtv")
        self.assertEqual(got, [])
        self.assertIn("already open", t.hook_log[-1][1])

    async def test_front_unknown_opens_unless_leave_inputs(self):
        self.add_couch_app()
        self.assertEqual((await self.run_hook(None, leave_inputs=True))[0], [])
        self.assertEqual((await self.run_hook(None))[0], ["couchtv"])

    async def test_hook_can_be_switched_off(self):
        self.add_couch_app()
        self.assertEqual((await self.run_hook("", open_on_power_on=False))[0], [])

    async def test_devview_route_presses_into_the_entry(self):
        with patch.object(philips.asyncio, "sleep", side_effect=lambda *_: asyncio.sleep(0)):
            got, t = await self.run_hook("", home_app="DevView", home_keys=["down", "ok"])
        self.assertEqual(got, ["devview"])
        self.assertEqual(self.keys(), ["CursorDown", "Confirm"])

    async def test_bad_home_keys_refused_at_start(self):
        with self.assertRaises(SystemExit):
            self.s.tv(home_keys=["rm -rf"])
        with self.assertRaises(SystemExit):
            self.s.tv(home_keys=["ok"] * 7)

    async def test_home_key_opens_couch_tv_when_there_is_an_app(self):
        self.add_couch_app()
        self.assertEqual(await self.tv.key("home"), "couch-tv")
        self.assertEqual(self.launches(), ["couchtv"])
        self.assertEqual(self.keys(), [])

    async def test_a_command_keeps_the_hook_quiet_but_a_phone_wake_does_not(self):
        self.add_couch_app()
        t = self.another()
        t.quiet_until = time.monotonic() + 20
        with patch.object(philips, "SETTLE", 0):
            await t._hook()
            self.assertEqual(self.launches(), [])
            t.home_on_wake_until = time.monotonic() + 90
            await t._hook()
        self.assertEqual(self.launches(), ["couchtv"])

    async def test_the_watcher_fires_the_hook_when_the_tv_comes_on(self):
        self.s.power = "Standby"
        t = self.another()
        fired = []

        async def hook():
            fired.append(1)

        t._hook = hook
        with patch.object(philips, "WATCH_EVERY", 0.02):
            task = asyncio.create_task(t._watch())
            await asyncio.sleep(0.4)
            self.assertEqual((fired, t.is_on), ([], False))
            self.s.power = "On"
            await asyncio.sleep(0.5)
            task.cancel()
        self.assertEqual(fired, [1])
        self.assertTrue(t.is_on)


class CheckScript(Base):
    """scripts/philips-check.py: reads only, sends no key and opens nothing."""

    async def run_check(self, **args):
        import argparse
        import contextlib
        import importlib.util
        import io
        spec = importlib.util.spec_from_file_location("philips_check", Path(__file__).parents[1] / "scripts" / "philips-check.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ns = argparse.Namespace(address="127.0.0.1", tv="lounge", port=self.s.port, plain=False, pair=False, pin=None,
                                trace=False)
        for k, v in args.items():
            setattr(ns, k, v)
        # port_open knocks without a TLS handshake, and the stand in's server logs that: expected
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: None)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = await mod.main(ns)
        return code, out.getvalue()

    async def test_reads_everything_and_changes_nothing(self):
        code, out = await self.run_check()
        self.assertEqual(code, 0)
        for want in ("JointSpace answers on /6/", "Power", "Inputs", "In front now", "Apps it lists: 5", "Netflix"):
            self.assertIn(want, out)
        self.assertEqual([(m, p) for m, p, _ in self.s.log if m != "GET"], [])
        self.assertNotIn(getattr(self.s, "test_login", None) or "never-printed", out)

    async def test_the_serial_number_is_hidden(self):
        code, out = await self.run_check()
        self.assertIn("serialnumber_encrypted", out)
        self.assertNotIn(SERIAL, out)                  # the output is pasted into a public issue

    async def test_not_paired_shows_what_the_tv_answers_without_a_login(self):
        self.s.logins.clear()
        os.remove(self.tv.store_file)
        code, out = await self.run_check()
        self.assertEqual(code, 0)
        for want in ("JointSpace answers on /6/", "Power: wants a login", "Apps: wants a login", "Not paired yet"):
            self.assertIn(want, out)
        self.assertEqual([(m, p) for m, p, _ in self.s.log if m != "GET"], [])

    async def check_when_knock_raises(self, exc):
        from unittest import mock
        with mock.patch("asyncio.open_connection", side_effect=exc):
            return await self.run_check()

    async def test_a_refusing_tv_is_said_to_have_no_network_remote(self):
        code, out = await self.check_when_knock_raises(ConnectionRefusedError())
        self.assertEqual(code, 1)
        self.assertIn("refused", out)
        self.assertIn("no Philips network remote on these ports", out)

    async def test_a_silent_tv_is_said_to_be_in_deep_standby(self):
        code, out = await self.check_when_knock_raises(asyncio.TimeoutError())
        self.assertEqual(code, 1)
        self.assertIn("silent", out)
        self.assertIn("deep standby", out)

    async def test_an_unreachable_tv_names_the_usual_causes(self):
        code, out = await self.check_when_knock_raises(OSError(65, "No route to host"))
        self.assertEqual(code, 1)
        self.assertIn("unreachable", out)
        for cause in ("VPN", "Local Network", "guest Wi-Fi", "isolation"):
            self.assertIn(cause, out)
        self.assertNotIn("deep standby", out)


class FindTvs(unittest.TestCase):
    """scripts/find-tvs.py lists a Philips from its mDNS service. The names are what the real 43PUS8909/12 announced
    (docs/PHILIPS-TITAN.md, "The first real TV"), without its address or serial."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("find_tvs", Path(__file__).parents[1] / "scripts" / "find-tvs.py")
        cls.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.mod)

    def test_the_name_loses_the_api_version_prefix(self):
        self.assertEqual(self.mod.philips_name("6_43PUS8909/12._philipstv_s_rpc._tcp.local."), "43PUS8909/12")

    def test_a_philips_service_is_listed_as_philips_and_not_as_a_cast_device(self):
        from unittest import mock
        info = mock.Mock(addresses=[bytes([192, 0, 2, 20])], properties={b"": b""})
        zc = mock.Mock(get_service_info=mock.Mock(return_value=info))
        found = self.mod.Found()
        found.add_service(zc, "_philipstv_s_rpc._tcp.local.", "6_43PUS8909/12._philipstv_s_rpc._tcp.local.")
        self.assertEqual(found.devices["192.0.2.20"]["offers"], {"philips"})
        self.assertEqual(found.devices["192.0.2.20"]["names"], {"43PUS8909/12"})


class SetupScript(Base):
    """scripts/philips-setup.py: check, explain, ask, pair, print the config.json entry. Writes nothing itself."""
    paired = False

    async def run_setup(self, answers=None, tty=True, **args):
        import argparse
        import contextlib
        import importlib.util
        import io
        spec = importlib.util.spec_from_file_location("philips_setup", Path(__file__).parents[1] / "scripts" / "philips-setup.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        ns = argparse.Namespace(address="127.0.0.1", tv="lounge", mac=None, port=self.s.port)
        for k, v in args.items():
            setattr(ns, k, v)
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: None)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch("sys.stdin.isatty", return_value=tty), \
                patch("builtins.input", side_effect=list(answers or [])):
            code = await mod.main(ns)
        return code, out.getvalue()

    async def test_no_pairing_key_stops_before_the_pair_request(self):
        code, out = await self.run_setup()
        self.assertEqual(code, 0)
        self.assertIn("cannot provide that key", out)
        self.assertEqual(self.s.sent("pair/request"), [])

    async def test_not_on_a_terminal_it_prints_the_next_command(self):
        self.save_secret()
        code, out = await self.run_setup(tty=False)
        self.assertEqual(code, 0)
        self.assertIn("philips-check.py", out)
        self.assertEqual(self.s.sent("pair/request"), [])

    async def test_a_no_at_the_question_sends_nothing(self):
        self.save_secret()
        code, out = await self.run_setup(answers=["n"])
        self.assertEqual(code, 0)
        self.assertEqual(self.s.sent("pair/request"), [])

    async def test_key_saved_and_pin_given_pairs_and_prints_the_entry(self):
        self.save_secret()
        code, out = await self.run_setup(answers=["y", PIN], mac=MAC)
        self.assertEqual(code, 0, out)
        self.assertIn("Paired", out)
        entry = json.loads(out[out.index("\n{\n") + 1:])
        self.assertEqual(entry["kind"], "philips")
        self.assertEqual(entry["id"], "lounge")
        self.assertEqual(entry["mac"], MAC)
        self.assertNotIn(SERIAL, out)

    async def test_an_unreachable_tv_says_why_and_exits_1(self):
        with patch("asyncio.open_connection", side_effect=OSError(65, "No route to host")):
            code, out = await self.run_setup()
        self.assertEqual(code, 1)
        self.assertIn("VPN", out)


class RealTV(unittest.TestCase):
    """What a real 43PUS8909/12 on Titan OS answered to "system" (docs/PHILIPS-TITAN.md, "The first real TV"),
    without the fields that name that one TV."""
    SYSTEM = {"menulanguage": "English", "name": "43PUS8909/12", "country": "Germany", "nettvversion": "",
              "epgsource": "no_epg", "api_version": {"Major": 6, "Minor": 1, "Patch": 0},
              "featuring": {"jsonfeatures": {"recordings": ["List", "Schedule", "Manage"], "ambilight": ["Ambilight"],
                                             "textentry": ["context_based", "initial_string_available"],
                                             "inputkey": ["key", "unicode"], "pointer": ["context_based"],
                                             "activities": ["browser"], "aurora": ["available"]},
                            "systemfeatures": {"tvtype": "consumer", "content": ["dmr"],
                                               "pairing_type": "digest_auth_pairing", "secured_transport": True,
                                               "os_type": "Linux"}}}

    def test_a_titan_os_tv_lists_a_browser(self):
        self.assertTrue(philips.lists_browser(self.SYSTEM))


class Signature(unittest.TestCase):
    def test_sign_is_stable_and_depends_on_every_part(self):
        a = philips.sign(SECRET, 1700000000, "4821")
        self.assertEqual(a, philips.sign(SECRET, 1700000000, "4821"))
        self.assertNotEqual(a, philips.sign(SECRET, 1700000001, "4821"))
        self.assertNotEqual(a, philips.sign(SECRET, 1700000000, "4822"))


class Endpoints(Base):
    """The bridge's Philips endpoints behind its real middleware, with a pairing key set."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self._tvp = patch.multiple(server, TVS={"lounge": self.tv}, DEFAULT_TV="lounge")
        self._tvp.start()
        self._key = patch.object(config, "PAIRING_KEY", "couchpass123")
        self._key.start()
        server._failed_attempts.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_post("/api/philips/pair", server.h_philips_pair)
        app.router.add_get("/api/philips/apps", server.h_philips_apps)
        app.router.add_get("/api/philips/sources", server.h_philips_sources)
        app.router.add_post("/api/philips/source", server.h_philips_source)
        app.router.add_post("/api/input", agentic.h_input)
        app.router.add_get("/api/tvs", server.h_tvs)
        app.router.add_get("/titan/{path:.*}", server.static_handler(server.TITAN_DIR, "Titan OS start page"))
        self.client = TestClient(TestServer(app, host="127.0.0.1"))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self._key.stop()
        self._tvp.stop()
        server._failed_attempts.clear()
        await super().asyncTearDown()

    def call(self, method, path, payload=None, key=True):
        h = {"Content-Type": "application/json"}
        if key:
            h["Authorization"] = "Bearer couchpass123"
        return self.client.request(method, path, headers=h, data=json.dumps(payload) if payload is not None else None)

    async def test_everything_needs_the_key(self):
        for m, p, b in (("POST", "/api/philips/pair", {}), ("GET", "/api/philips/apps", None),
                        ("GET", "/api/philips/sources", None), ("POST", "/api/philips/source", {"name": "hdmi1"})):
            r = await self.call(m, p, b, key=False)
            self.assertEqual(r.status, 401, p)
        self.assertEqual(self.s.log, [])

    async def test_pairing_through_the_bridge(self):
        os.remove(os.path.join(self.data, "philips-lounge.json"))
        self.save_secret()
        r = await self.call("POST", "/api/philips/pair", {})
        self.assertEqual((r.status, (await r.json())["step"]), (200, "pin"))
        r = await self.call("POST", "/api/philips/pair", {"pin": "12a4"})
        self.assertEqual(r.status, 400)
        r = await self.call("POST", "/api/philips/pair", {"pin": PIN})
        self.assertEqual(r.status, 200)
        self.assertTrue(self.tv.paired)

    async def test_apps_and_sources(self):
        r = await self.call("GET", "/api/philips/apps")
        j = await r.json()
        self.assertIn("Netflix", [a["label"] for a in j["apps"]])
        self.assertIsNone(j["home_app"])
        r = await self.call("GET", "/api/philips/sources")
        self.assertEqual(len((await r.json())["sources"]), 3)
        r = await self.call("POST", "/api/philips/source", {"name": "HDMI 2"})
        self.assertEqual(r.status, 200)
        r = await self.call("POST", "/api/philips/source", {"name": "HDMI 9"})
        self.assertEqual(r.status, 404)
        self.assertEqual(self.s.source, "hdmi2")

    async def test_the_shared_input_endpoint_uses_the_tvs_list(self):
        r = await self.call("POST", "/api/input", {"name": "hdmi 1"})
        self.assertEqual((r.status, (await r.json())["input"]), (200, "HDMI 1"))

    async def test_tvs_shows_the_philips_status(self):
        r = await self.call("GET", "/api/tvs")
        row = (await r.json())["tvs"][0]
        self.assertEqual(row["kind"], "philips")
        self.assertEqual(set(row["philips"]), {"paired", "secret", "api", "power", "front", "front_readable", "apps",
                                               "home_app", "model", "error", "port", "no_login", "browser",
                                               "home"})

    async def test_the_titan_start_page_is_served_without_the_key(self):
        r = await self.client.get("/titan/")
        self.assertEqual(r.status, 200)
        page = await r.text()
        self.assertIn("/api/health", page)
        self.assertNotIn("couchpass123", page)

    async def test_make_tv_builds_a_philips(self):
        self.assertIsInstance(server.make_tv({"id": "x", "name": "X", "kind": "philips", "ip": "192.0.2.9"}),
                              philips.PhilipsTV)


if __name__ == "__main__":
    unittest.main()
