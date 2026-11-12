"""bridge/philips.py on an older Philips Linux TV (Saphi), against the stand in's Saphi mode
(tests/philips_standin.py): plain port 1925 with no login, the hand over to the paired path on 1926,
a TV with no powerstate or app list, couch-tv's page opened in the TV's browser at power on only when
the TV lists a browser, Wake on LAN for a silent TV, and scripts/philips-check.py and check-tv.py
reading only. NOT a real Saphi TV: see docs/PHILIPS-SAPHI.md."""
import argparse
import asyncio
import contextlib
import importlib.util
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import config  # noqa: E402
import philips  # noqa: E402
import server  # noqa: E402
from philips_standin import SECRET, StandIn  # noqa: E402
from tv import TVUnavailable  # noqa: E402

HAVE_OPENSSL = bool(shutil.which("openssl"))
ROOT = Path(__file__).parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_")[:-3], ROOT / "scripts" / name)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def closed_port():
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Base(unittest.IsolatedAsyncioTestCase):
    standin = {}

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="saphi-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self.s = await StandIn.saphi(self.data, **self.standin).__aenter__()
        self._tvs = []
        self.tv = self.another()

    def another(self, **cfg):
        t = self.s.tv(**cfg)
        self._tvs.append(t)
        return t

    async def asyncTearDown(self):
        for t in self._tvs:
            if t._session:
                await t._session.close()
        await self.s.__aexit__()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def posts(self):
        return [(p, b) for m, p, b in self.s.log if m == "POST"]

    async def hook(self, t, front=""):
        self.s.front = front
        with patch.object(philips, "SETTLE", 0):
            await t._hook()
        return t.hook_log[-1][1]


class NoLogin(Base):
    async def test_answers_on_the_plain_port_with_no_login(self):
        self.assertTrue(self.tv.saphi)
        self.assertEqual(await self.tv.find_version(), "1/")
        self.assertTrue(self.tv.open_api)
        self.assertTrue(self.tv.has_browser)
        self.assertEqual(await self.tv._read_power(), "On")       # no powerstate: on while it answers
        self.assertFalse(self.tv.has_powerstate)
        await self.tv.key("up")
        await self.tv.read_volume()
        self.assertEqual(self.tv.volume["level"], 12)
        self.assertEqual(set(self.s.authorization), {None})      # never a login header
        self.assertFalse(self.tv.paired)

    async def test_nothing_to_pair(self):
        os.makedirs(os.path.join(self.data, "philips"), exist_ok=True)
        with open(os.path.join(self.data, "philips", "pair-secret"), "w") as f:
            f.write(SECRET)
        with self.assertRaises(philips.PhilipsError) as cm:
            await self.tv.pair_start()
        self.assertIn("nothing to pair", str(cm.exception))
        self.assertFalse(self.s.pin_on_screen)
        self.assertEqual(self.posts(), [])

    async def test_power_off_without_powerstate_is_the_standby_key(self):
        await self.tv.find_version()
        await self.tv._read_power()
        await self.tv.key("power")
        self.assertEqual(self.posts(), [("input/key", '{"key":"Standby"}')])

    async def test_no_app_list_is_asked_again_only_every_five_minutes(self):
        await self.tv.refresh_installed()
        await self.tv.refresh_installed()
        self.assertEqual([p for m, p, _ in self.s.log if p == "applications"], ["applications"])

    async def test_status_says_no_login_and_browser(self):
        await self.tv.find_version()
        st = self.tv.philips_status()
        self.assertEqual((st["no_login"], st["browser"], st["home"], st["port"]), (True, True, "browser", self.s.port))


class BrowserHome(Base):
    async def test_comes_on_opens_couch_tv_in_the_browser(self):
        await self.tv.find_version()
        note = await self.hook(self.tv)
        self.assertIn("in the TV's browser", note)
        self.assertEqual(len(self.s.pages), 1)
        self.assertRegex(self.s.pages[0], r"^http://127\.0\.0\.1:\d+/titan/$")
        self.assertEqual(self.tv.visible, philips.BROWSER_FRONT)
        self.assertEqual(self.tv._package_of(self.tv.visible), philips.HOME_PACKAGE)

    async def test_another_tv_id_goes_in_the_address_and_home_url_wins(self):
        t = self.another(id="bedroom", home_url="http://192.0.2.20:5400/titan/")
        await t.find_version()
        await self.hook(t)
        self.assertEqual(self.s.pages, ["http://192.0.2.20:5400/titan/?tv=bedroom"])

    async def test_a_bad_home_url_is_refused_at_start(self):
        for bad in ("javascript:alert(1)", "file:///etc/passwd", "http://x/\"><script>"):
            with self.assertRaises(SystemExit):
                self.s.tv(home_url=bad)

    async def test_open_page_only_takes_a_plain_address(self):
        await self.tv.find_version()
        for bad in ("javascript:alert(1)", "http://x y", None, "ftp://192.0.2.1/"):
            with self.assertRaises(ValueError):
                await self.tv.open_page(bad)
        self.assertEqual(self.s.pages, [])

    async def test_the_browser_already_in_front_is_left_alone(self):
        await self.tv.find_version()
        note = await self.hook(self.tv, front="browser")
        self.assertIn("left alone", note)
        self.assertEqual(self.s.pages, [])

    async def test_an_app_in_front_is_left_alone(self):
        await self.tv.find_version()
        self.assertIn("left alone", await self.hook(self.tv, front="netflix"))
        self.assertEqual(self.s.pages, [])

    async def test_front_unknown_opens_the_page(self):
        await self.tv.find_version()
        await self.hook(self.tv, front=None)
        self.assertEqual(len(self.s.pages), 1)

    async def test_home_key_opens_the_page(self):
        await self.tv.find_version()
        self.assertEqual(await self.tv.key("home"), "couch-tv")
        self.assertEqual(len(self.s.pages), 1)

    async def test_browser_home_can_be_switched_off(self):
        t = self.another(browser_home=False)
        await t.find_version()
        self.assertIn("remote only", await self.hook(t))
        self.assertEqual(await t.key("home"), "Home")
        self.assertEqual(self.s.pages, [])


class NoBrowser(Base):
    standin = {"browser": False}

    async def test_no_browser_listed_means_remote_only(self):
        await self.tv.find_version()
        self.assertFalse(self.tv.has_browser)
        self.assertIn("remote only", await self.hook(self.tv))
        self.assertEqual(await self.tv.key("home"), "Home")
        with self.assertRaises(TVUnavailable):
            await self.tv.open_page("http://192.0.2.20:5400/titan/")
        self.assertEqual(self.posts(), [("input/key", '{"key":"Home"}')])


class Unreliable(Base):
    """sources/current and activities/current fail on some sets: the watcher carries on."""
    standin = {"powerstate": True}

    async def test_the_watcher_survives_broken_reads_and_still_opens_the_page(self):
        self.s.power = "Standby"
        self.s.broken = {"activities/current", "sources/current"}
        t = self.another()
        with patch.object(philips, "WATCH_EVERY", 0.02), patch.object(philips, "SETTLE", 0):
            task = asyncio.create_task(t._watch())
            await asyncio.sleep(0.3)
            self.s.power = "On"
            await asyncio.sleep(0.6)
            self.assertFalse(task.done())
            task.cancel()
        self.assertTrue(t.is_on)
        self.assertFalse(t.front_readable)
        self.assertEqual(len(self.s.pages), 1)

    async def test_a_broken_input_switch_is_an_error_not_a_crash(self):
        self.s.broken = {"sources/current"}
        await self.tv.find_version()
        with self.assertRaises(philips.PhilipsError):
            await self.tv.switch_source("HDMI 1")


@unittest.skipUnless(HAVE_OPENSSL, "needs the openssl command for the stand in's certificate")
class HandOver(unittest.IsolatedAsyncioTestCase):
    """"saphi": true with no "tls" or "port": plain 1925 first, the paired path on 1926 when plain wants a
    login or is silent, and back to plain while both are silent."""

    async def asyncSetUp(self):
        self.data = tempfile.mkdtemp(prefix="saphi-test-")
        self._p = patch.multiple(config, DATA=self.data, DEFAULT_TV="lounge")
        self._p.start()
        self.tvs, self.ins = [], []

    async def asyncTearDown(self):
        for t in self.tvs:
            if t._session:
                await t._session.close()
        for s in self.ins:
            await s.__aexit__()
        self._p.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    async def standin(self, **kw):
        s = await StandIn(self.data, **kw).__aenter__()
        self.ins.append(s)
        return s

    def make(self, plain, tls, **cfg):
        with patch.multiple(philips, PORT_PLAIN=plain, PORT_TLS=tls):
            t = philips.PhilipsTV({"id": "lounge", "name": "Lounge", "kind": "philips", "ip": "127.0.0.1",
                                   "saphi": True, **cfg})
        t.ip, t.connected = "127.0.0.1", True
        self.tvs.append(t)
        return t

    async def find(self, t, plain, tls):
        with patch.multiple(philips, PORT_PLAIN=plain, PORT_TLS=tls):
            return await t.find_version()

    async def test_plain_wants_a_login_so_the_paired_path_on_1926(self):
        plain = await self.standin(tls=False)
        secure = await self.standin()
        t = self.make(plain.port, secure.port)
        self.assertEqual((t.tls, t.port, t.may_switch), (False, plain.port, True))
        self.assertEqual(await self.find(t, plain.port, secure.port), "6/")
        self.assertEqual((t.tls, t.port, t.open_api), (True, secure.port, False))
        secure.pair_now(t)
        self.assertEqual(await t._read_power(), "On")
        self.assertEqual(set(plain.authorization), {None})       # the plain port never saw a login

    async def test_plain_wants_a_login_and_1926_is_silent_keeps_plain(self):
        plain = await self.standin(tls=False)
        t = self.make(plain.port, closed_port())
        self.assertEqual(await self.find(t, plain.port, closed_port()), "6/")
        self.assertEqual((t.tls, t.port, t.open_api), (False, plain.port, False))

    async def test_plain_silent_and_1926_answers(self):
        secure = await self.standin()
        t = self.make(closed_port(), secure.port)
        self.assertEqual(await self.find(t, closed_port(), secure.port), "6/")
        self.assertTrue(t.tls)

    async def test_both_silent_goes_back_to_plain_for_the_next_try(self):
        plain_port = closed_port()
        t = self.make(plain_port, closed_port())
        with self.assertRaises(TVUnavailable):
            await self.find(t, plain_port, closed_port())
        self.assertEqual((t.tls, t.port, t.version), (False, plain_port, None))

    async def test_plain_with_no_login_stays_plain(self):
        plain = await self.standin(tls=False, login=False)
        secure = await self.standin()
        t = self.make(plain.port, secure.port)
        self.assertEqual(await self.find(t, plain.port, secure.port), "6/")
        self.assertEqual((t.tls, t.open_api), (False, True))
        self.assertEqual(secure.log, [])

    async def test_tls_false_is_plain_only_with_the_login_over_it(self):
        plain = await self.standin(tls=False)
        t = plain.tv()          # "tls": false, a fixed port: never hands over
        self.tvs.append(t)
        self.assertFalse(t.may_switch)
        await t.find_version()
        self.assertFalse(t.open_api)
        plain.pair_now(t)
        self.assertEqual(await t._read_power(), "On")

    async def test_a_kept_login_does_not_hide_a_tv_that_wants_one(self):
        plain = await self.standin(tls=False)
        t = plain.tv()
        self.tvs.append(t)
        plain.pair_now(t)
        await t.find_version()
        self.assertFalse(t.open_api)


class WakeOnLan(Base):
    async def test_the_magic_packet_goes_to_the_stored_mac(self):
        sent = []

        class Sock:
            def __init__(self, *a):
                pass

            def setsockopt(self, *a):
                pass

            def sendto(self, data, addr):
                sent.append((data, addr))

            def close(self):
                pass

        t = self.another(mac="aabbcc001122")
        with patch.object(philips.socket, "socket", Sock):
            await t.wake()
        self.assertTrue(sent)
        self.assertEqual(sent[0][0], b"\xff" * 6 + bytes.fromhex("aabbcc001122") * 16)

    async def test_a_silent_tv_gets_wake_on_lan_from_the_bridge(self):
        t = self.another(mac="aabbcc001122")
        t.connected = False
        woke = []

        async def wake():
            woke.append(1)

        async def closed(*a, **k):
            return False

        t.wake, t.port_open = wake, closed
        with patch.multiple(server, TVS={server._current.get(): t}, POWER_ON_BUDGET=2.5):
            with self.assertRaises(TVUnavailable):
                await server.power_on()
        self.assertGreaterEqual(len(woke), 1)

    async def test_no_mac_sends_nothing(self):
        with patch.object(philips.socket, "socket") as sock:
            await self.tv.wake()
        sock.assert_not_called()


class CheckScript(Base):
    """scripts/philips-check.py reads only: no key, no login, nothing opened."""

    async def run_check(self, **args):
        mod = load_script("philips-check.py")
        ns = argparse.Namespace(address="127.0.0.1", tv="lounge", port=None, plain=False, pair=False, pin=None,
                                trace=False)
        for k, v in args.items():
            setattr(ns, k, v)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.multiple(philips, PORT_PLAIN=self.s.port, PORT_TLS=closed_port()):
            code = await mod.main(ns)
        return code, out.getvalue()

    async def test_finds_the_plain_port_by_itself_and_reads_everything(self):
        code, out = await self.run_check()
        self.assertEqual(code, 0, out)
        for want in ("(plain): open", "(encrypted): closed", "JointSpace answers on /1/", "Browser activity listed: yes",
                     "Login: none needed", "Volume", "In front now", "Input in front"):
            self.assertIn(want, out)
        self.assertEqual(self.posts(), [])                       # no key, no page, no pairing
        self.assertEqual(set(self.s.authorization), {None})
        self.assertEqual(self.s.pages, [])

    async def test_pair_on_a_tv_that_needs_none_shows_nothing(self):
        code, out = await self.run_check(pair=True)
        self.assertEqual(code, 0)
        self.assertIn("Nothing to pair", out)
        self.assertEqual(self.posts(), [])
        self.assertFalse(self.s.pin_on_screen)

    async def test_plain_flag_and_port(self):
        code, out = await self.run_check(plain=True, port=self.s.port)
        self.assertEqual(code, 0, out)
        self.assertIn("Login: none needed", out)
        self.assertEqual(self.posts(), [])


class CheckTv(Base):
    """scripts/check-tv.py on a TV that answers only plain port 1925."""

    async def test_hello_reads_the_api_and_the_browser(self):
        mod = load_script("check-tv.py")
        got = await asyncio.get_running_loop().run_in_executor(None, mod.philips_hello, "127.0.0.1", self.s.port)
        self.assertEqual((got["api"], got["browser"]), ("/1/", True))
        self.assertEqual(self.posts(), [])

    def test_verdict_for_port_1925_only(self):
        mod = load_script("check-tv.py")
        out = io.StringIO()
        with patch.object(mod, "knock", lambda ip, port, timeout=1.0: port == 1925), \
                patch.object(mod, "philips_hello", lambda ip: {"api": "/1/", "model": "x", "browser": True}), \
                patch.object(mod, "wireless_debugging_port", lambda ip: None), \
                patch.object(sys, "argv", ["check-tv.py", "192.0.2.9"]), contextlib.redirect_stdout(out):
            mod.main()
        text = out.getvalue()
        self.assertIn("Philips Saphi path, New (Beta)", text)
        self.assertIn("opens in the TV's browser", text)
        self.assertIn("browser listed: yes", text)
        self.assertNotIn("untested", text)


    def test_titan_verdict_says_what_has_been_tried_on_a_real_tv(self):
        mod = load_script("check-tv.py")
        out = io.StringIO()
        with patch.object(mod, "knock", lambda ip, port, timeout=1.0: port == 1926), \
                patch.object(mod, "wireless_debugging_port", lambda ip: None), \
                patch.object(sys, "argv", ["check-tv.py", "192.0.2.9"]), contextlib.redirect_stdout(out):
            mod.main()
        text = out.getvalue()
        self.assertIn("Philips Titan OS path", text)
        self.assertIn("read only check has run on one real TV, pairing has not", text)
        self.assertNotIn("not yet tried on a real Titan OS TV", text)


if __name__ == "__main__":
    unittest.main()
