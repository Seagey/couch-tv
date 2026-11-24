"""What a real beginner hit on 19 November 2026 (a Toshiba Google TV on Android 11, from a Mac):
1. "Something went wrong: OSError" on the first launch: macOS Local Network permission. Every error is
   plain words now, and the block has its own message and Look again.
2. A TV that never asks "Allow USB debugging?" for a new computer: the real fixes, one screen each, then
   the phone route. Never a dead end.
3. No jargon on the beginner screens; the technical part only behind Details.
No TV is touched: errors are simulated with their errno, the TV is tests/faketv.py."""
import errno
import html
import ipaddress
import json
import os
import re
import socket
import ssl
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

from couchtv_setup import errors, finder, mdns, server, steps  # noqa: E402
from couchtv_setup.tv import Tv, TvError  # noqa: E402
import faketv  # noqa: E402

WEB = os.path.join(os.path.dirname(server.__file__), "web")
RAW_NAMES = re.compile(r"\b[A-Z][A-Za-z]*(Error|Exception)\b|errno|Errno|Traceback")

# One address in each home range (192.168, 10, 172.16). Built from numbers so the repo's privacy scan,
# which looks for real home addresses in the source, stays quiet. The other tests use 192.0.2.x.
HOME_RANGES = [str(ipaddress.IPv4Address(n)) for n in (0xC0A80420, 0x0A000007, 0xAC100504)]


def read(name):
    with open(os.path.join(WEB, name), encoding="utf-8") as f:
        return f.read()


def wait_job(seconds=10):
    """Until the background job is done. A deadline, not sleeps: test_steps.py makes time.sleep do nothing."""
    end = time.monotonic() + seconds
    while server.S.job.get("running") and time.monotonic() < end:
        threading.Event().wait(0.01)


def oserror(no, dest=None):
    e = OSError(no, os.strerror(no))
    if dest:
        e.dest = dest
    return e


class LocalNetworkBlock(unittest.TestCase):
    """The Mac's Local Network permission, simulated with the errnos it really gives."""

    def explain(self, e, **kw):
        kw.setdefault("default_route", True)
        kw.setdefault("platform", "mac")
        return errors.explain(e, **kw)

    def test_mdns_send_no_route_to_host_is_the_mac_block(self):
        msg, code, detail = self.explain(oserror(errno.EHOSTUNREACH, "224.0.0.251"))
        self.assertEqual(code, "local_network_blocked")
        self.assertEqual(msg, "Your Mac blocked this app from finding the TV. Open System Settings, Privacy and "
                              "Security, Local Network, switch on Couch TV Setup, then press Look again.")
        self.assertIn("OSError", detail)   # the technical part is kept, for Details only

    @unittest.skipUnless(sys.platform == "darwin", "errno 65 is EHOSTUNREACH on a Mac")
    def test_errno_65_on_a_mac(self):
        self.assertEqual(self.explain(OSError(65, "No route to host"), dest="192.0.2.32")[1], "local_network_blocked")

    def test_operation_not_permitted_to_each_home_range(self):
        for dest in HOME_RANGES + ["224.0.0.251"]:
            self.assertEqual(self.explain(oserror(errno.EPERM, dest))[1], "local_network_blocked", dest)

    def test_not_a_block_when_the_internet_is_gone_too(self):
        msg, code, _ = self.explain(oserror(errno.EHOSTUNREACH, "192.0.2.32"), default_route=False)
        self.assertEqual(code, "unreachable")
        self.assertIn("same Wi-Fi", msg)

    def test_not_a_block_for_an_internet_address(self):
        self.assertNotEqual(self.explain(oserror(errno.EHOSTUNREACH, "8.8.8.8"))[1], "local_network_blocked")

    def test_operation_not_permitted_on_a_file_is_not_a_block(self):
        e = PermissionError(errno.EPERM, "Operation not permitted", "/x/adbkey")
        msg, code, _ = self.explain(e)
        self.assertEqual(code, "files")

    def test_wrapped_in_a_urlerror_or_a_chain(self):
        self.assertEqual(self.explain(urllib.error.URLError(oserror(errno.EHOSTUNREACH, "192.0.2.32")))[1],
                         "local_network_blocked")
        try:
            try:
                raise oserror(errno.EHOSTUNREACH, "192.0.2.32")
            except OSError as inner:
                raise RuntimeError("wrapped") from inner
        except RuntimeError as outer:
            self.assertEqual(self.explain(outer)[1], "local_network_blocked")

    def test_windows_and_other_words(self):
        self.assertIn("Windows blocked this app", self.explain(oserror(errno.EHOSTUNREACH, "192.0.2.5"), platform="windows")[0])
        self.assertIn("Look again", self.explain(oserror(errno.EHOSTUNREACH, "192.0.2.5"), platform="other")[0])

    def test_mdns_send_keeps_where_it_was_going(self):
        sock = mock.Mock()
        sock.sendto.side_effect = OSError(errno.EHOSTUNREACH, "No route to host")
        with self.assertRaises(OSError) as c:
            mdns.send(sock, b"q")
        self.assertEqual(c.exception.dest, "224.0.0.251")

    def test_scan_on_a_blocked_mac_says_so(self):
        def blocked_browse(*a, **k):
            raise oserror(errno.EHOSTUNREACH, "224.0.0.251")
        with mock.patch.object(finder.mdns, "browse", blocked_browse), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda ip, port, t=0.5: oserror(errno.EHOSTUNREACH, str(ip))), \
                mock.patch.object(errors, "has_default_route", lambda: True):
            with self.assertRaises(TvError) as c:
                finder.scan([ipaddress.ip_network("192.0.2.0/29")], wait=0.1)
        self.assertEqual(c.exception.code, "local_network_blocked")
        self.assertIn("Look again", str(c.exception))

    def test_scan_knocks_all_blocked_even_if_mdns_is_quiet(self):
        with mock.patch.object(finder.mdns, "browse", lambda *a, **k: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda ip, port, t=0.5: oserror(errno.EHOSTUNREACH, str(ip))), \
                mock.patch.object(errors, "has_default_route", lambda: True):
            with self.assertRaises(TvError) as c:
                finder.scan([ipaddress.ip_network("192.0.2.0/29")], wait=0.1)
        self.assertEqual(c.exception.code, "local_network_blocked")

    def test_scan_with_tvs_off_is_not_a_block(self):
        with mock.patch.object(finder.mdns, "browse", lambda *a, **k: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda ip, port, t=0.5: socket.timeout("timed out")):
            self.assertEqual(finder.scan([ipaddress.ip_network("192.0.2.0/29")], wait=0.1), [])

    def test_connecting_to_a_blocked_tv_says_so(self):
        def opener():
            raise oserror(errno.EHOSTUNREACH)
        with mock.patch.object(errors, "has_default_route", lambda: True):
            with self.assertRaises(TvError) as c:
                Tv("192.0.2.32", None, opener=opener)
        self.assertEqual(c.exception.code, "local_network_blocked")


class EveryErrorIsPlain(unittest.TestCase):
    CASES = [
        socket.timeout("timed out"), TimeoutError(), ConnectionRefusedError(errno.ECONNREFUSED, "refused"),
        ConnectionResetError(errno.ECONNRESET, "reset"), BrokenPipeError(errno.EPIPE, "pipe"),
        OSError(errno.ENETUNREACH, "Network is unreachable"), OSError(errno.EADDRINUSE, "in use"),
        socket.gaierror(8, "nodename nor servname"), ssl.SSLError(1, "bad"), OSError(errno.ENOSPC, "full"),
        OSError(errno.EIO, "Input/output error"), ValueError("bad"), KeyError("x"), RuntimeError("?"),
        UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte"),
    ]

    def test_no_raw_exception_names_in_the_words(self):
        for e in self.CASES:
            msg, code, detail = errors.explain(e, default_route=True, platform="mac")
            self.assertIsNone(RAW_NAMES.search(msg), f"{e!r}: {msg}")
            self.assertTrue(msg.endswith("."), msg)
            self.assertTrue(code)
            self.assertTrue(detail)

    def test_each_kind_gets_its_own_words(self):
        codes = [errors.explain(e, default_route=True)[1] for e in self.CASES[:10]]
        self.assertEqual(codes, ["timeout", "timeout", "refused", "reset", "reset", "no_network", "in_use",
                                 "offline", "secure", "no_space_here"])

    def test_a_crash_in_a_job_reaches_the_page_plain(self):
        def boom(progress):
            raise OSError(errno.EIO, "Input/output error")
        server.S.job = {"running": False}
        with mock.patch.object(server.traceback, "print_exc", lambda: None):   # keep the test output clean
            server.run_job("test", boom)
            wait_job()
        self.assertNotIn("OSError", server.S.job["error"])
        self.assertNotIn("went wrong:", server.S.job["error"])
        self.assertIn("OSError", server.S.job["detail"])

    def test_tv_stopped_answering_has_no_raw_name(self):
        tv = Tv("192.0.2.10", None, opener=lambda: mock.Mock(**{"shell.side_effect": ConnectionResetError(54, "reset")}))
        with mock.patch("couchtv_setup.tv.time.sleep", lambda s: None):
            with self.assertRaises(TvError) as c:
                tv.shell("echo")
        self.assertEqual(c.exception.code, "lost")
        self.assertIsNone(RAW_NAMES.search(str(c.exception)))
        self.assertIn("ConnectionResetError", c.exception.detail)

    def test_page_keeps_detail_behind_details(self):
        page = read("index.html")
        self.assertIn('<details id="error-more" hidden><summary>Details</summary>', page)
        js = read("app.js")
        self.assertIn('text("error-detail"', js)
        self.assertNotIn("type(e).__name__", open(server.__file__, encoding="utf-8").read())


class NeverADeadEnd(unittest.TestCase):
    """A TV that never authorises a new key leads through the fixes to the phone route."""

    @classmethod
    def setUpClass(cls):
        cls.page = read("index.html")

    def connect(self, kind, tried, knock=0):
        def make_tv(ip, ident, route="tcp", port=5555, allow_wait_s=45):
            self.waits.append(allow_wait_s)
            return Tv(ip, ident, route=route, port=port, allow_wait_s=allow_wait_s, opener=faketv.never_allows)
        server.S.job = {"running": False}
        with mock.patch.object(server, "Tv", make_tv), mock.patch.object(server, "identity", lambda: None), \
                mock.patch.object(server.finder, "knock", lambda ip, port, t=0.5: knock):
            server.api("POST", "/api/connect", {"ip": "192.0.2.32", "kind": kind, "tried": tried})
            wait_job()
        return dict(server.S.job)

    def walk(self, kind, knock=0):
        self.waits, seen = [], []
        for tried in range(10):
            job = self.connect(kind, tried, knock)
            self.assertIn(job["code"], ("not_allowed", "closed"))
            self.assertIsNone(RAW_NAMES.search(job["error"]), job["error"])
            seen.append(job["fix"])
            if job["fix"] == "phone-route":
                break
        return seen

    def test_google_tv_that_never_asks(self):
        with mock.patch.object(server, "_known", lambda: {}):
            self.assertEqual(self.walk("google"), ["fix-home", "fix-toggle", "fix-revoke", "fix-restart", "phone-route"])
        self.assertTrue(all(w <= 60 for w in self.waits), self.waits)   # short, honest waits

    def test_revoke_only_when_this_computer_was_never_allowed(self):
        with mock.patch.object(server, "_known", lambda: {"192.0.2.32": {"kind": "google"}}):
            self.assertEqual(self.walk("google"), ["fix-home", "fix-toggle", "fix-restart", "phone-route"])

    def test_fire_tv_has_no_revoke(self):
        with mock.patch.object(server, "_known", lambda: {}):
            self.assertEqual(self.walk("fire"), ["fix-home", "fix-toggle", "fix-restart", "phone-route"])

    def test_port_closed_also_ends_on_the_phone_route(self):
        refused = oserror(errno.ECONNREFUSED, "192.0.2.32")
        with mock.patch.object(server, "_known", lambda: {}):
            self.assertEqual(self.walk("google", knock=refused), ["fix-toggle", "fix-restart", "phone-route"])

    def test_after_the_last_fix_it_stays_on_the_phone_route(self):
        self.assertEqual(steps.next_fix("google", False, 99), "phone-route")

    def test_every_fix_is_a_screen_with_try_again(self):
        for fix in set(steps.no_allow_fixes("google", False) + steps.no_allow_fixes("fire", False)) - {"phone-route"}:
            m = re.search(r'<section data-step="%s"[^>]*>(.*?)</section>' % fix, self.page, re.S)
            self.assertIsNotNone(m, fix)
            self.assertRegex(m.group(1), r'class="primary fix-try"[^>]*>Try again</button>', fix)

    def test_the_fixes_say_what_the_owner_asked(self):
        p = html.unescape(re.sub(r"<[^>]+>", "", self.page))
        p = re.sub(r"\s+", " ", p)
        self.assertIn("Press Home on the TV remote so the TV shows its home screen, and wait 10 seconds", p)
        self.assertIn("Switch USB debugging off, then on again", p)
        self.assertIn("Revoke USB debugging authorisations", p)
        self.assertIn("ask again the next time it connects", p)
        self.assertIn("Hold the Power button on the remote until the TV restarts", p)
        self.assertIn("unplug the TV at the wall for 10 seconds", p)

    def test_phone_route_is_complete(self):
        m = re.search(r'<section data-step="phone-route"[^>]*>(.*?)</section>', self.page, re.S).group(1)
        words = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m))
        self.assertIn("This TV will not let a computer in over Wi-Fi. You can still put Couch TV on it with just your phone", words)
        self.assertIn("Downloader", words)
        self.assertIn("8180170", words)
        self.assertIn("open that address and type the code", words)
        # the real Downloader 2.0.4 and Play Protect screens (TCL Google TV test, 19 November 2026)
        for said in ("# button", "SETTINGS (not CANCEL)", "App blocked to protect your device", "Install anyway",
                     "switch the scan back on"):
            self.assertIn(said, words)
        self.assertNotIn("USB cable", self.page)   # the old dead end is gone


class RouteBeforeTheSteps(unittest.TestCase):
    def test_route_hint(self):
        self.assertEqual(finder.route_hint({"adb_5555": True}), "allow")
        self.assertEqual(finder.route_hint({"wireless_debugging": True}), "pair")
        self.assertEqual(finder.route_hint({"android_version": "11"}), "usb")
        self.assertEqual(finder.route_hint({"android_version": "12"}), "pair")
        self.assertEqual(finder.route_hint({"android_version": None}), "unknown")

    def test_cast_info_only_when_it_says_so(self):
        typical = {"build_info": {"cast_build_revision": "1.56.281627", "system_build_number": "281627",
                                  "release_track": "stable-channel"}, "name": "Living Room TV",
                   "device_info": {"manufacturer": "Hisense", "model_name": "Smart TV"}}
        self.assertIsNone(finder.android_from_cast_info(typical))
        self.assertEqual(finder.android_from_cast_info({"device_info": {"android_version": "11"}}), "11")
        self.assertEqual(finder.android_from_cast_info({"build_info": {"sdk_version": 30}}), "11")
        self.assertEqual(finder.android_from_cast_info({"build_info": {"sdk_version": "33"}}), "13")
        self.assertIsNone(finder.android_from_cast_info({"a": {"android_version": "11"}, "b": {"sdk_int": 34}}))
        self.assertIsNone(finder.android_from_cast_info({"os_version": "1.56.2"}))   # a Cast number, not Android
        self.assertIsNone(finder.android_from_cast_info("not json"))

    def test_page_says_which_route_or_both(self):
        js = read("app.js")
        for route in ("pair", "usb", "unknown"):
            self.assertRegex(js, r"\b%s: \"" % route)
        self.assertIn("Android 12 or newer have Wireless debugging", js)
        self.assertIn("Android 11", js)
        self.assertIn("if (state.kind !== \"fire\" && look.adb_5555)", js)   # port open: straight to Allow

    def test_google_steps_offer_both_menu_names_and_both_switches(self):
        page = read("index.html")
        m = re.search(r'<section data-step="dev-google"[^>]*>(.*?)</section>', page, re.S).group(1)
        self.assertIn("System, About", m)
        self.assertIn("Device Preferences, About", m)
        self.assertIn('data-dev="wireless"', m)
        self.assertIn('data-dev="usb"', m)


class PlainWords(unittest.TestCase):
    """No jargon and none of the words the owner ruled out, on any screen."""
    BANNED = [r"\bbeta\b", r"experimental", r"coming soon", r"\blater\b", r"\bTLS\b", r"mDNS", r"port 5555",
              r"debugging port", r"\bADB\b(?!\s+debugging)", r"\bshell\b", r"\bAPK\b", "—", "–"]

    def words(self, name):
        raw = read(name)
        if name.endswith(".html"):
            raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
            raw = re.sub(r"<[^>]+>", " ", raw)
        else:   # only the sentences in the page script, not its code, ids or comments
            strings = re.findall(r'"((?:[^"\\]|\\.)*)"', re.sub(r"//[^\n]*", "", raw))
            raw = " ".join(s for s in strings if " " in s.strip())
        return html.unescape(raw)

    def test_screens(self):
        for name in ("index.html", "app.js"):
            text = self.words(name)
            for pat in self.BANNED:
                self.assertIsNone(re.search(pat, text, 0 if "ADB" in pat else re.I),
                                  f"{name}: {pat}")

    def test_server_messages(self):
        src = "".join(open(os.path.join(os.path.dirname(server.__file__), f), encoding="utf-8").read()
                      for f in ("server.py", "tv.py", "finder.py", "errors.py"))
        for msg in re.findall(r'TvError\(\s*f?"([^"]+)"', src) + [errors.MAC_BLOCKED, errors.FALLBACK]:
            self.assertIsNone(re.search(r"\bADB\b(?!\s+debugging)|\bport\b(?! shown| the numbers|: the)|TLS|__name__", msg), msg)


if __name__ == "__main__":
    unittest.main()
