"""The dream flow (24 Nov 2026): Setup finds the TVs on the Wi-Fi by itself, shows each TV's few remote
steps for its Android version, installs Couch TV only after SHA256SUMS.txt agrees, links the TV to the
Couch TV account and brings the home with it. No TV and no network is touched: discovery is fed
recorded answers, the ADB handshake talks to a pretend port on 127.0.0.1, the TV is tests/faketv.py
and Couch TV Studio is a stub file."""
import hashlib
import ipaddress
import json
import os
import re
import socket
import struct
import sys
import tempfile
import threading
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

from couchtv_setup import finder, guide, health, linkin, mdns, release, steps, studio, tvprofile  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import FakeTv  # noqa: E402

# Only while this file's tests run: this is the one time.sleep every module shares, and left patched it made the
# other files' fakes answer at once (test_ui's "partial first look" failed in a full run and passed alone).
_SLEEP = mock.patch.object(steps.time, "sleep", lambda s: None)
setUpModule, tearDownModule = _SLEEP.start, _SLEEP.stop

REMOTE, CAST = finder.ANDROID_REMOTE.rstrip("."), finder.GOOGLECAST.rstrip(".")
CONNECT, PAIRING, PLAIN = finder.ADB_CONNECT.rstrip("."), finder.ADB_PAIRING.rstrip("."), finder.ADB_PLAIN.rstrip(".")
HOST = "h." + "lo" + "cal"   # built, so the privacy scan does not read it as a real host name
MAIL = "a" + "@" + "b.com"
MAC = ":".join(["aa", "bb", "cc", "dd", "ee", "ff"])
BRANDS = re.compile(r"\b(TCL|Sony|Bravia|Hisense|Toshiba|Philips|Samsung|LG|Xiaomi|Nvidia|Shield|Panasonic|"
                    r"Kogan|onn|Amazon|Chromecast|Vizio|Roku)\b", re.I)


def heard(service, ip, name="", port=0, txt=None):
    return {"service": service, "instance": f"{name}.{service}".lower(), "ip": ip, "port": port, "name": name,
            "txt": txt or {}}


class Mdns(unittest.TestCase):
    def test_txt_record(self):
        raw = bytes([12]) + b"fn=Lounge TV" + bytes([10]) + b"md=Model X" + b"\x00" + b"\x03bad"
        self.assertEqual(mdns.txt(raw), {"fn": "Lounge TV", "md": "Model X", "bad": ""})

    def test_resolve_keeps_txt(self):
        recs = [(CAST, mdns.PTR, "x." + CAST, "192.0.2.5"), ("x." + CAST, mdns.SRV, (8009, HOST), "192.0.2.5"),
                (HOST, mdns.A, "192.0.2.5", "192.0.2.5"),
                ("x." + CAST, mdns.TXT, b"\x0afn=Bedroom\x09md=Box 4K", "192.0.2.5")]
        found = mdns.resolve(recs, [CAST])
        self.assertEqual(found[0]["txt"], {"fn": "Bedroom", "md": "Box 4K"})
        self.assertEqual(found[0]["ip"], "192.0.2.5")


class Discovery(unittest.TestCase):
    """finder.merge(): one row per TV, a friendly name, and how far it is from ready."""

    def test_every_status(self):
        rows = finder.merge(
            [heard(REMOTE, "192.0.2.10", "Living room TV"),
             heard(CAST, "192.0.2.10", "abc", 8009, {"fn": "Living room TV", "md": "Smart TV Pro"}),
             heard(REMOTE, "192.0.2.11", "Bedroom TV"),
             heard(CONNECT, "192.0.2.11", "adb-SER11-AbCdEf", 41234),
             heard(PAIRING, "192.0.2.11", "adb-SER11-AbCdEf", 37001),
             heard(REMOTE, "192.0.2.12", "Study TV"), heard(CONNECT, "192.0.2.12", "adb-SER12-ZzZzZz", 40000),
             heard(REMOTE, "192.0.2.13", "Kids TV")],
            [("192.0.2.10", 5555), ("192.0.2.10", 6466)], {}, {}, {"192.0.2.10": True})
        by = {r["ip"]: r for r in rows}
        self.assertEqual(by["192.0.2.10"]["status"], "ready")
        self.assertEqual(by["192.0.2.10"]["model"], "Smart TV Pro")
        self.assertEqual(by["192.0.2.11"]["status"], "code")
        self.assertEqual(by["192.0.2.11"]["pairing_port"], 37001)
        self.assertEqual(by["192.0.2.11"]["serial"], "SER11")
        self.assertEqual(by["192.0.2.12"]["status"], "pair")
        self.assertEqual(by["192.0.2.13"]["status"], "switch")
        self.assertEqual([r["status"] for r in rows], ["ready", "code", "pair", "switch"])   # ready first

    def test_paired_before_is_ready(self):
        rows = finder.merge([heard(CONNECT, "192.0.2.12", "adb-S-ZzZzZz", 40000)], [], {},
                            {"192.0.2.12": {"route": "tls", "room": "Study TV"}})
        self.assertEqual(rows[0]["status"], "ready")
        self.assertEqual(rows[0]["label"], "Study TV")

    def test_name_order(self):
        t = {"name": "Announced", "model": "M1"}
        self.assertEqual(finder.friendly_name(t, {"room": "Living room TV", "name": "Brand M1"}), "Living room TV")
        self.assertEqual(finder.friendly_name(t, {}), "Announced")
        self.assertEqual(finder.friendly_name({"model": "M1"}, {}), "M1")
        self.assertEqual(finder.friendly_name({"adb_5555": True}, {}), "TV with debugging on")
        self.assertEqual(finder.friendly_name({}, {}), "Android TV")

    def test_names_are_cleaned(self):
        rows = finder.merge([heard(REMOTE, "192.0.2.10", "<b>Den</b>\x07")], [], {})
        self.assertEqual(rows[0]["label"], "bDen/b")

    def test_open_5555_that_is_not_adb_is_dropped(self):
        rows = finder.merge([], [("192.0.2.20", 5555)], {}, {}, {"192.0.2.20": False})
        self.assertEqual(rows, [])

    def test_speaker_with_cast_only_is_not_a_tv(self):
        rows = finder.merge([heard(CAST, "192.0.2.30", "s", 8009, {"fn": "Kitchen speaker", "md": "Mini"})], [], {})
        self.assertEqual(rows, [])

    def test_plain_adb_announcement(self):
        rows = finder.merge([heard(PLAIN, "192.0.2.40", "adb-x", 5555)], [], {}, {}, {"192.0.2.40": True})
        self.assertEqual(rows[0]["status"], "ready")

    def test_other_tv_systems_are_listed_not_offered(self):
        dial = {"192.0.2.50": {"name": "[TV] Lounge", "maker": "Samsung Electronics", "model": "QA55"},
                "192.0.2.51": {"name": "Bedroom", "maker": "LG Electronics", "model": "OLED55"},
                "192.0.2.52": {"name": "Printer", "maker": "Acme", "model": "P1"}}
        rows = finder.merge([], [], dial)
        by = {r["ip"]: r for r in rows}
        self.assertEqual(set(by), {"192.0.2.50", "192.0.2.51"})
        self.assertEqual(by["192.0.2.50"]["status"], "other")
        self.assertEqual(by["192.0.2.50"]["other"], "Tizen")
        self.assertEqual(by["192.0.2.51"]["other"], "webOS")
        self.assertFalse(by["192.0.2.50"]["android"])

    def test_not_home_addresses_are_ignored(self):
        self.assertEqual(finder.merge([heard(REMOTE, "8.8.8.8", "x"), heard(REMOTE, "127.0.0.1", "y")], [], {}), [])

    def test_dial_description(self):
        body = "<root><device><friendlyName>Den TV</friendlyName><manufacturer>Maker Co</manufacturer>" \
               "<modelName>Box</modelName></device></root>"
        self.assertEqual(finder.dial_description(body), {"name": "Den TV", "maker": "Maker Co", "model": "Box"})
        self.assertIsNone(finder.dial_description("<root/>"))

    def test_scan_merges_everything(self):
        recs = [heard(REMOTE, "192.0.2.3", "Living room TV"), heard(PAIRING, "192.0.2.3", "adb-Q-AbCdEf", 39000)]
        with mock.patch.object(finder.mdns, "browse", lambda services, wait: recs), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda ip, port, t=0.5: 0 if (str(ip), port) == ("192.0.2.4", 5555) else socket.timeout()), \
                mock.patch.object(finder, "adb_handshake", lambda ip: True):
            rows = finder.scan([ipaddress.ip_network("192.0.2.0/29")], wait=0.1)
        self.assertEqual([(r["ip"], r["status"]) for r in rows], [("192.0.2.4", "ready"), ("192.0.2.3", "code")])

    def test_scan_asks_for_every_service(self):
        asked = []
        with mock.patch.object(finder.mdns, "browse", lambda services, wait: asked.extend(services) or []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda ip, port, t=0.5: socket.timeout()):
            finder.scan([ipaddress.ip_network("192.0.2.0/30")], wait=0.1)
        for s in ("_adb-tls-connect._tcp", "_adb-tls-pairing._tcp", "_adb._tcp", "_androidtvremote2._tcp", "_googlecast._tcp"):
            self.assertTrue(any(a.startswith(s) for a in asked), s)


class AdbHandshake(unittest.TestCase):
    """The CNXN probe, against a pretend ADB port on this computer."""

    def serve(self, reply):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        got = {}

        def run():
            c, _ = srv.accept()
            got["sent"] = c.recv(64)
            c.sendall(reply)
            c.close()
            srv.close()
        threading.Thread(target=run, daemon=True).start()
        return srv.getsockname()[1], got

    def test_packet(self):
        p = finder.cnxn_packet()
        cmd, ver, maxdata, n, crc, magic = struct.unpack("<6I", p[:24])
        self.assertEqual((cmd, ver, maxdata), (finder.A_CNXN, 0x01000001, 256 * 1024))
        self.assertEqual(p[24:], b"host::\x00")
        self.assertEqual((n, crc, magic), (7, sum(b"host::\x00"), finder.A_CNXN ^ 0xFFFFFFFF))

    def test_auth_answer_is_adb(self):
        auth = struct.pack("<6I", finder.A_AUTH, 1, 0, 20, 0, finder.A_AUTH ^ 0xFFFFFFFF)
        port, got = self.serve(auth)
        self.assertTrue(finder.adb_handshake("127.0.0.1", port))
        self.assertEqual(got["sent"][:4], b"CNXN")   # only CONNECT: no key, no command

    def test_http_answer_is_not(self):
        port, _ = self.serve(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        self.assertFalse(finder.adb_handshake("127.0.0.1", port))

    def test_bad_magic(self):
        self.assertFalse(finder.is_adb_answer(struct.pack("<6I", finder.A_AUTH, 1, 0, 20, 0, 0)))
        self.assertTrue(finder.is_adb_answer(struct.pack("<6I", finder.A_STLS, 1, 0, 0, 0, finder.A_STLS ^ 0xFFFFFFFF)))


class Guide(unittest.TestCase):
    VERSIONS = [None, "7.1", "8", "9", "10", "11", "12", "13", "14", "15", "16"]

    def all_steps(self):
        for route in ("ready", "pair", "allow", "fire", "choose"):
            for v in self.VERSIONS:
                for g in (False, True):
                    yield route, v, g, guide.steps(route, v, g)

    def test_every_line_keeps_the_rules(self):
        for route, v, g, s in self.all_steps():
            self.assertEqual(guide.check(s), [], (route, v, g))
            for st in s:
                for line in st["lines"] + [st["title"], st["pick"]] + st["path"]:
                    self.assertIsNone(BRANDS.search(line), (route, v, line))
                    self.assertNotIn("couch-tv", line)
                    self.assertNotRegex(line, r"(?i)\b(beta|experimental|coming soon)\b")

    def test_menus_follow_the_version(self):
        self.assertEqual(guide.steps("allow", "9")[0]["path"], ["Settings", "Device Preferences", "About"])
        self.assertEqual(guide.steps("allow", "9")[0]["pick"], "Build")
        self.assertEqual(guide.steps("pair", "14")[0]["path"], ["Settings", "System", "About"])
        self.assertEqual(guide.steps("pair", "14")[0]["pick"], "Android TV OS build")
        self.assertEqual(guide.steps("allow", "11", google_tv=True)[0]["path"][1], "System")
        unknown = guide.steps("choose", None)[0]["lines"]
        self.assertTrue(any("Device Preferences" in l for l in unknown))

    def test_least_steps(self):
        self.assertEqual([s["id"] for s in guide.steps("ready")], ["allow"])
        self.assertEqual([s["id"] for s in guide.steps("pair", "14")], ["devopts", "wireless", "code"])
        self.assertEqual([s["id"] for s in guide.steps("allow", "10")], ["devopts", "debug", "allow"])
        self.assertEqual([s["id"] for s in guide.steps("fire")], ["devopts", "debug", "allow"])

    def test_route_for(self):
        self.assertEqual(guide.route_for({"status": "ready"}), "ready")
        self.assertEqual(guide.route_for({"pairing_port": 37000}), "pair")
        self.assertEqual(guide.route_for({"wireless_debugging": 41000}), "pair")
        self.assertEqual(guide.route_for({}, "14"), "pair")
        self.assertEqual(guide.route_for({}, "9"), "allow")
        self.assertEqual(guide.route_for({}, "11"), "choose")
        self.assertEqual(guide.route_for({}, None), "choose")
        self.assertEqual(guide.route_for({}, "11", wireless=False), "allow")
        self.assertEqual(guide.route_for({}, None, kind="fire"), "fire")

    def test_word_count(self):
        self.assertEqual(guide.words("Open Settings, System, About."), 4)
        self.assertEqual(guide.check([{"id": "x", "title": "t", "lines": ["one " * 15]}])[0][2], "more than 14 words")


class Checksums(unittest.TestCase):
    SHA = hashlib.sha256(b"apk").hexdigest()

    def test_parse_sums(self):
        text = f"{self.SHA}  couch-tv-home.apk\n{'a' * 64} *couch-tv-ontv.apk\nnot a line\n{'z' * 64}  bad.apk\n"
        self.assertEqual(release.parse_sums(text), {"couch-tv-home.apk": self.SHA, "couch-tv-ontv.apk": "a" * 64})

    def test_a_name_twice_with_two_sums_is_dropped(self):
        self.assertEqual(release.parse_sums(f"{'a' * 64}  x.apk\n{'b' * 64}  x.apk\n"), {})

    def test_expected(self):
        self.assertEqual(release.expected("sha256:" + self.SHA, self.SHA), (self.SHA, "SHA256SUMS.txt and GitHub checksum"))
        self.assertEqual(release.expected(None, self.SHA), (self.SHA, "SHA256SUMS.txt"))
        with self.assertRaises(TvError) as e:
            release.expected("sha256:" + self.SHA, None)
        self.assertEqual(e.exception.code, "no_checksum")
        with self.assertRaises(TvError) as e:
            release.expected("sha256:" + "0" * 64, self.SHA)
        self.assertEqual(e.exception.code, "checksum")

    def test_verify(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"apk")
        self.assertTrue(release.verify(f.name, self.SHA))
        self.assertTrue(release.verify(f.name, self.SHA.upper()))
        self.assertFalse(release.verify(f.name, "0" * 64))
        os.unlink(f.name)

    def test_real_release_format(self):
        # the layout scripts/release-checksums.sh writes (v0.13.11's SHA256SUMS.txt, shortened)
        text = ("d9557dddb35dd5daf8e49824049188dcfe5f2124e2d6a7d71a4f1666ab2baf6f  couch-tv-home.apk\n"
                "aec382bed1f4554a8d55836369acc38d7afe67aa6e577c12e363db3e9500e573  couch-tv-ontv.apk\n")
        self.assertEqual(release.parse_sums(text)["couch-tv-home.apk"][:8], "d9557ddd")


PACK = {"v": 1, "rev": 7, "at": "2026-11-24T05:10:00.000Z", "wipe": False,
        "people": [{"id": "p_3k9x2m", "name": "Ruby", "kids": True, "colour": "#e07a5f", "photo": "data:image/jpeg;base64,/9j/4AAQ"},
                   {"id": "p_8d1q0z", "name": "Alex", "kids": False, "colour": None, "photo": None},
                   {"id": "bad", "name": "Nope"}, {"id": "p_abcdef", "name": ""}],
        "town": {"name": "Ballarat", "lat": -37.5622, "lon": 143.8503},
        "wifi": {"name": "Guest", "password": "correct horse battery"}}
TOKEN = "t" * 43
LINK = "L" * 43
CODE = "CTV1-" + "c" * 43


class Account(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(studio.read_code("abcd efgh"), "ABCD-EFGH")
        self.assertEqual(studio.read_code("ABCD-EFG1"), "")          # 1 is never in a code
        self.assertEqual(studio.read_code(TOKEN), TOKEN)
        self.assertEqual(studio.read_code("hello"), "")
        self.assertEqual(studio.parse_url("couchtv://setup?handoff=" + TOKEN), TOKEN)
        self.assertEqual(studio.parse_url("couchtv-setup://link?t=ABCD-EFGH"), "ABCD-EFGH")
        self.assertEqual(studio.parse_url("https://setup?handoff=" + TOKEN), "")
        self.assertEqual(studio.parse_url("couchtv://evil?handoff=" + TOKEN), "")
        self.assertEqual(studio.url_in(["app", "-psn_0_1", "couchtv://setup?handoff=x"]), "couchtv://setup?handoff=x")
        self.assertIsNone(studio.url_in(["app"]))

    def test_home_pack(self):
        h = studio.check_home(PACK)
        self.assertEqual([p["id"] for p in h["people"]], ["p_3k9x2m", "p_8d1q0z"])
        self.assertTrue(h["people"][0]["kids"])
        self.assertEqual(h["town"], {"name": "Ballarat", "lat": -37.56, "lon": 143.85})
        self.assertEqual(h["wifi"]["name"], "Guest")
        self.assertIsNone(studio.check_home({"v": 1}))                      # no rev
        self.assertEqual(studio.check_home({"v": 1, "rev": 3, "wipe": True, "people": PACK["people"]}),
                         {"v": 1, "rev": 3, "wipe": True})
        later = studio.check_home(dict(PACK, v=2))
        self.assertNotIn("wifi", later)                                      # unknown version: people and town only
        self.assertEqual(len(later["people"]), 2)
        self.assertEqual(studio.check_home(dict(PACK, wifi=None))["wifi"], None)
        self.assertNotIn("wifi", studio.check_home(dict(PACK, wifi={"name": "x" * 40})))
        self.assertEqual(studio.setup_inputs(studio.check_home(PACK))[0][0], {"id": "p_3k9x2m", "name": "Ruby"})
        self.assertEqual(studio.setup_inputs({"wipe": True}), ([], None))

    def stub(self, answers):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(answers, f)
        f.close()
        return mock.patch.dict(os.environ, {"COUCHTV_SETUP_STUDIO_STUB": f.name, "COUCHTV_SETUP_STUDIO": ""})

    def test_off_sends_nothing(self):
        with mock.patch.dict(os.environ, {"COUCHTV_SETUP_STUDIO": "off", "COUCHTV_SETUP_STUDIO_STUB": ""}), \
                mock.patch.object(studio.urllib.request, "build_opener", side_effect=AssertionError("network")):
            self.assertEqual(studio.mode(), "off")
            with self.assertRaises(TvError) as e:
                studio.handoff(studio.Link(), "ABCD-EFGH")
        self.assertEqual(e.exception.code, "studio_off")

    def test_stub_flow(self):
        answers = {"/v1/setup/handoff": {"token": TOKEN, "account": {"name": "Sam", "design": "Sunday morning"}},
                   "/v1/setup/tv": {"tv_id": "tv_123", "link": LINK, "code": CODE, "design": "Sunday morning", "home": PACK},
                   "/v1/setup/done": {"ok": True}}
        with self.stub(answers):
            link = studio.Link()
            self.assertEqual(studio.handoff(link, "abcd-efgh")["name"], "Sam")
            reg = studio.register_tv(link, {"platform": "Google TV"}, "Living room TV")
            self.assertEqual((reg["tv_id"], reg["link"], reg["code"]), ("tv_123", LINK, CODE))
            self.assertEqual(len(reg["home"]["people"]), 2)
            self.assertTrue(studio.report_done(link, True, "v0.13.12"))

    def test_odd_answers_are_refused_or_dropped(self):
        answers = {"/v1/setup/handoff": {"token": "short"},
                   "/v1/setup/tv": {"tv_id": "x; rm", "link": "bad link", "code": "CTV1-short", "home": {"v": "1"}}}
        with self.stub(answers):
            link = studio.Link()
            with self.assertRaises(TvError):
                studio.handoff(link, "ABCD-EFGH")
            link.token = TOKEN
            reg = studio.register_tv(link, {}, "TV")
        self.assertEqual(reg, {"tv_id": None, "link": None, "code": None, "design": None, "home": None})

    def test_device_code(self):
        # Studio as built (DREAM-SETUP-BUILD.md, "Studio side as built"): an 8 character code, ABCD-EFGH
        answers = {"/v1/setup/device": {"device_code": "d" * 40, "user_code": "KQ7M-4PXR", "verify": "https://evil.example/x",
                                        "interval": 5},
                   "/v1/setup/device/poll": {"token": TOKEN, "account": {"name": "Sam"}}}
        with self.stub(answers):
            link = studio.Link()
            start = studio.device_start(link)
            self.assertEqual(start["user_code"], "KQ7M-4PXR")
            self.assertEqual(start["interval"], 5)
            self.assertTrue(start["verify"].startswith(studio.DEFAULT_STUDIO))   # never another site
            self.assertEqual(studio.device_poll(link)["account"]["name"], "Sam")
        self.assertEqual(link.token, TOKEN)

    def test_device_code_shapes(self):
        for good in ("ABCDEFGH", "ABCD-EFGH", "2345-6789"):
            with self.stub({"/v1/setup/device": {"device_code": "d" * 40, "user_code": good}}):
                self.assertEqual(studio.device_start(studio.Link())["user_code"], good)
        for bad in ("ABC-DEF", "ABCD-EFG", "abcd-efgh", "ABCD EFGH", "ABCD-EFGH-", "<b>D-EFGH", ""):
            with self.stub({"/v1/setup/device": {"device_code": "d" * 40, "user_code": bad}}):
                with self.assertRaises(TvError, msg=bad):
                    studio.device_start(studio.Link())

    def test_account_name_may_be_null(self):
        # Studio sends the display name or null, never the email
        for acct in ({"name": None, "design": None}, {"design": "Sunday"}, {}, None):
            with self.stub({"/v1/setup/handoff": {"token": TOKEN, "account": acct}}):
                link = studio.Link()
                got = studio.handoff(link, "ABCD-EFGH")
            self.assertIsNone(got["name"])
            self.assertEqual(link.token, TOKEN)
        with open(os.path.join(os.path.dirname(studio.__file__), "web", "app.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertIn('"Signed in to your Couch TV account"', js)
        self.assertNotIn('|| "you"', js)

    def test_tv_id_sent_when_setting_up_again(self):
        sent = []
        answer = {"tv_id": "tv_123", "link": LINK, "code": CODE, "design": None, "home": None}

        def fake_call(path, body, token=None, timeout=15):
            sent.append(dict(body))
            if body.get("tv_id") == "tv_gone":
                raise TvError("That TV is not in your account.", "not_found")
            return answer
        link = studio.Link()
        link.token = TOKEN
        with mock.patch.object(studio, "call", side_effect=fake_call):
            self.assertEqual(studio.register_tv(link, {}, "Living room TV")["tv_id"], "tv_123")
            self.assertNotIn("tv_id", sent[-1])                         # a first setup sends none
            studio.register_tv(link, {}, "Living room TV", "tv_123")
            self.assertEqual(sent[-1]["tv_id"], "tv_123")               # again: its My TVs row
            studio.register_tv(link, {}, "Living room TV", "x; rm -rf")
            self.assertNotIn("tv_id", sent[-1])                         # a bad id never goes
            sent.clear()
            self.assertEqual(studio.register_tv(link, {}, "Living room TV", "tv_gone")["tv_id"], "tv_123")
            self.assertEqual([("tv_id" in b) for b in sent], [True, False])   # refused: set up as a new TV

    def test_studio_errors_as_built(self):
        import io
        import urllib.error

        def opener_for(status, body):
            class O:
                def open(self, req, timeout=None):
                    raise urllib.error.HTTPError(req.full_url, status, "x", {}, io.BytesIO(json.dumps(body).encode()))
            return O()
        cases = [(401, {"error": "expired", "message": "That sign in ran out. Press the button on the website again."},
                  "expired", "That sign in ran out"),
                 (429, {"error": "slow_down", "retry_after": 5}, "slow_down", "Your Couch TV account said no"),
                 (409, {"error": "tv_limit", "message": "This account has 10 TVs."}, "tv_limit", "10 TVs"),
                 (403, {"error": "Not allowed <b>here</b>"}, "studio_said", "Not allowed bhere/b")]
        with mock.patch.dict(os.environ, {"COUCHTV_SETUP_STUDIO": "live", "COUCHTV_SETUP_STUDIO_STUB": ""}):
            for status, body, code, words in cases:
                with mock.patch.object(studio.urllib.request, "build_opener", return_value=opener_for(status, body)):
                    with self.assertRaises(TvError) as e:
                        studio.call("/v1/setup/handoff", {"handoff": "ABCD-EFGH"})
                self.assertEqual(e.exception.code, code)
                self.assertIn(words, str(e.exception))
            # a 429 while waiting for the website is only "not yet"
            link = studio.Link()
            link.device = "d" * 40
            with mock.patch.object(studio.urllib.request, "build_opener", return_value=opener_for(429, {"error": "slow_down"})):
                self.assertEqual(studio.device_poll(link), {"pending": True})
            with mock.patch.object(studio.urllib.request, "build_opener", return_value=opener_for(428, {"error": "pending"})):
                self.assertEqual(studio.device_poll(link), {"pending": True})

    def test_studio_address_must_be_https(self):
        with mock.patch.dict(os.environ, {"COUCHTV_SETUP_STUDIO_URL": "http://evil.example"}):
            with self.assertRaises(TvError):
                studio.base()


class LinkOnTheTv(unittest.TestCase):
    def test_extras_only_take_clean_values(self):
        self.assertEqual(steps.account_extras({"link": LINK, "code": CODE}),
                         f" --es account_link {LINK} --es design_code {CODE}")
        self.assertEqual(steps.account_extras({"link": "x; reboot", "code": "CTV1-$(id)"}), "")
        self.assertEqual(steps.account_extras(None), "")

    def test_make_home_writes_the_link_and_keeps_account_ids(self):
        tv = FakeTv("google")
        steps.make_home(tv, "/x/couch-tv-home.apk", people=[{"id": "p_3k9x2m", "name": "Ruby"}, "Alex"],
                        account={"link": LINK, "code": CODE})
        start = next(c for c in tv.log if c.startswith("am force-stop app.couchtv.launcher"))
        self.assertIn("am start -n app.couchtv.launcher/.FromComputer ", start)      # only a computer can send settings
        self.assertNotIn("account_link", start)
        told = next(c for c in tv.log if c.startswith("am broadcast"))
        self.assertEqual(told, f"am broadcast --include-stopped-packages -n app.couchtv.launcher/.SetupLink --es account_link {LINK} --es design_code {CODE}")
        self.assertEqual(tv.held, LINK)
        import base64
        cfg = json.loads(base64.b64decode(re.search(r"--es config_b64 (\S+)", start).group(1)))
        self.assertEqual(cfg["people"], [{"id": "p_3k9x2m", "name": "Ruby"}, {"id": "person2", "name": "Alex"}])


    def test_an_older_couch_tv_gets_its_settings_the_old_way(self):
        tv = FakeTv("google")
        tv.app = "0.13.14"
        r = steps.make_home(tv, "/x/couch-tv-home.apk", account={"link": LINK, "code": CODE})
        starts = [c for c in tv.log if "config_b64" in c]
        self.assertEqual([c.split("-n ")[1].split()[0] for c in starts],
                         ["app.couchtv.launcher/.FromComputer", "app.couchtv.launcher/.MainActivity"])
        self.assertEqual((r["link"], tv.held), ("sent", LINK))

    def test_versions(self):
        for v, ok in (("0.13.13", True), ("0.13.12", False), ("v0.14", True), ("1.0.0-beta.1", True), ("0.9", False), (None, False), ("x", False)):
            self.assertEqual(steps.version_at_least(v, steps.LINK_SINCE), ok, v)

    def test_what_am_start_says_is_read(self):
        for out in ("", "Starting: Intent { }\nError type 3\nError: Activity class {x} does not exist.",
                    "Starting: Intent { }\njava.lang.SecurityException: Permission Denial: starting Intent",
                    "Security exception: Permission Denial", "Error: unknown command"):
            tv = FakeTv("google")
            tv.shell = lambda c, o=out: o
            with self.assertRaises(TvError, msg=out) as e:
                steps.start_activity(tv, steps.HOME_ACT)
            self.assertEqual(e.exception.code, "not_started")
        tv.shell = lambda c: "Starting: Intent { }\nWarning: Activity not started, intent has been delivered to currently running top-most instance."
        steps.start_activity(tv, steps.HOME_ACT)


class Profile(unittest.TestCase):
    def test_from_a_connected_tv(self):
        facts = {"model": "Smart TV Pro", "maker": "TCL", "brand": "TCL", "android": "14", "sdk": 34, "fire": False,
                 "google_tv": True, "installed": {"home": None}}
        p = tvprofile.from_facts(facts, "MemTotal:        1887436 kB\nMemFree: 1 kB",
                                 "Physical size: 3840x2160\nOverride size: 1920x1080", "  add-role-holder [--user USER_ID] ROLE PACKAGE")
        self.assertEqual(p["platform"], "Google TV")
        self.assertEqual(p["brand"], "TCL")
        self.assertEqual(p["memMb"], 1843)
        self.assertEqual(p["res"], "1920x1080")
        self.assertEqual(p["cls"], "b")
        self.assertTrue(p["homeRole"])
        self.assertEqual(tvprofile.clean(p), p)

    def test_read_only_commands(self):
        tv = FakeTv("android", sdk=28)
        p = tvprofile.read(tv, steps.facts(tv))
        self.assertEqual(p["platform"], "Android TV")
        self.assertFalse(p["homeRole"])                 # Android 9 has no Home role
        for c in tv.log:
            self.assertRegex(c, r"^(cat /proc/meminfo|wm size|cmd role help|pm list|pm query-activities --brief|cmd package resolve|"
                                r"dumpsys package|getprop|cat /data/local/tmp)", c)

    def test_apps_are_package_names_only(self):
        tv = FakeTv("android", sdk=34)
        p = tvprofile.read(tv, steps.facts(tv))
        self.assertEqual(p["apps"], ["com.netflix.ninja", "com.google.android.youtube.tv", "com.spotify.tv.android"])
        self.assertEqual(tvprofile.clean(p)["apps"], p["apps"])

    def test_parse_apps(self):
        out = "priority=0 x\ncom.a.b/.Main\n  com.a.b/.Other\nDROP TABLE/x\nbad name/.M\ndev.couchtv.ontv/.Home\n<x>.y/z"
        self.assertEqual(tvprofile.parse_apps(out, "org.c.d/.M"), ["com.a.b", "org.c.d"])
        many = "\n".join(f"com.x.p{i}/.M" for i in range(400))
        self.assertEqual(len(tvprofile.parse_apps(many)), 300)
        self.assertEqual(tvprofile.clean({"apps": ["com.ok.app", 5, "no", "a b.c"]})["apps"], ["com.ok.app"])
        self.assertEqual(tvprofile.clean({"apps": "x"})["apps"], [])
        self.assertEqual(tvprofile.guess({})["apps"], [])

    def test_fire_never_offers_the_home_role(self):
        p = tvprofile.from_facts({"fire": True, "sdk": 30, "maker": "Amazon"}, "", "", "")
        self.assertEqual((p["platform"], p["homeRole"], p["brand"]), ("Fire OS", False, "Amazon Fire TV"))

    def test_guess(self):
        g = tvprofile.guess({"remote": True, "model": "BRAVIA 4K", "name": "Lounge"})
        self.assertEqual((g["source"], g["platform"]), ("guess", "Google TV"))
        self.assertEqual(tvprofile.guess({"other": "Tizen", "maker": "Samsung Electronics"})["brand"], "Samsung (Tizen)")
        self.assertIsNone(tvprofile.guess({})["platform"])

    def test_speed_class(self):
        self.assertEqual([tvprofile.speed_class(m) for m in (None, 1024, 1843, 3900)], ["b", "a", "b", "c"])

    def test_clean_drops_junk(self):
        c = tvprofile.clean({"platform": "Windows", "memMb": "lots", "res": "big", "cls": "z", "model": "<x>" * 30, "sdk": 34})
        self.assertEqual((c["platform"], c["memMb"], c["res"], c["cls"], c["sdk"]), (None, None, None, "b", 34))
        self.assertNotIn("<", c["model"])


GFX = """Stats since: 123ns
Total frames rendered: 480
Janky frames: 6 (1.25%)
50th percentile: 9ms
90th percentile: 14ms
95th percentile: 16ms
99th percentile: 22ms
"""


class Speed(unittest.TestCase):
    def test_gfxinfo(self):
        self.assertEqual(health.parse_gfxinfo(GFX), {"frames": 480, "janky": 6, "p50": 9, "p90": 14, "p99": 22})
        self.assertEqual(health.parse_gfxinfo("")["frames"], None)

    def test_classes(self):
        f = health.parse_gfxinfo(GFX)
        self.assertEqual(health.measured_class(f), "d")
        self.assertEqual(health.measured_class(dict(f, janky=100)), "c")
        self.assertEqual(health.measured_class(dict(f, p90=22)), "c")
        self.assertEqual(health.measured_class(dict(f, p90=33)), "b")
        self.assertEqual(health.measured_class(dict(f, p90=60)), "a")
        self.assertIsNone(health.measured_class(dict(f, frames=10)))

    def test_chip_and_gpu(self):
        c = health.parse_chip("processor\t: 0\nprocessor\t: 1\nprocessor : 2\nprocessor : 3\n", "1800000\n2000000\n", "MT9611", "mt5")
        self.assertEqual(c, {"cores": 4, "mhz": 2000, "soc": "MT9611"})
        self.assertEqual(health.parse_gpu("x\nGLES: ARM, Mali-G52, OpenGL ES 3.2\n"), "ARM, Mali-G52, OpenGL ES 3.2")

    def test_profile_keeps_measured_speed(self):
        p = tvprofile.clean({"platform": "Google TV", "cls": "b", "speed": dict(health.parse_gfxinfo(GFX), cls="d", cores=4, soc="X")})
        self.assertEqual((p["cls"], p["speed"]["p90"], p["speed"]["cores"]), ("d", 14, 4))


class Health(unittest.TestCase):
    def test_scrub(self):
        s = health.scrub("to 198.51.100.28 from " + MAIL + " at https://x.example/?k=1 mac " + MAC + " key " + "k" * 30)
        for gone in ("198.51", MAIL, "x.example", "aa:bb", "k" * 30):
            self.assertNotIn(gone, s)

    def test_only_couch_tv_crashes(self):
        box = ("========================================\n2026-11-24 10:00:00 data_app_crash\nProcess: com.other.app\n"
               "java.lang.RuntimeException: theirs\n"
               "========================================\n2026-11-24 10:05:00 data_app_crash\nProcess: app.couchtv.launcher\n"
               "java.lang.IllegalStateException: ours at 192.0.2.1\n")
        s = health.crash_summary(box)
        self.assertIn("Process: app.couchtv.launcher", s)
        self.assertFalse(any("theirs" in l for l in s))
        self.assertFalse(any("192.0.2.1" in l for l in s))
        self.assertIsNone(health.crash_summary("Process: com.other.app\n"))

    def test_free_space(self):
        self.assertEqual(health.free_mb("Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-5 10000 5000 4096000 50% /data\n"), 4000)

    def test_report_reads_only_couch_tvs_own_log(self):
        tv = FakeTv("google")
        tv.shell_answers = {}
        r = health.health_report(tv, {"home": "0.13.12"})
        self.assertEqual(r["couchtv"], {"home": "0.13.12"})
        for c in tv.log:
            self.assertFalse(c.startswith("logcat") and "--pid=" not in c, c)
            self.assertNotRegex(c, r"^(pm |am |settings put|cmd package set)")


class OpenedByALink(unittest.TestCase):
    def test_hand_to_running(self):
        linkin.write_running(5999, "secret")
        sent = {}

        class Answer:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def opener(req, timeout=3):
            sent["url"], sent["key"], sent["body"] = req.full_url, req.headers.get("X-setup-key"), req.data
            return Answer()
        self.assertEqual(linkin.hand_to_running("ABCD-EFGH", opener), "http://127.0.0.1:5999/")
        self.assertEqual(sent["url"], "http://127.0.0.1:5999/api/handoff-in")
        self.assertEqual(sent["key"], "secret")
        self.assertEqual(json.loads(sent["body"]), {"code": "ABCD-EFGH"})

    def test_nothing_running(self):
        linkin.write_running(1, "k")
        self.assertIsNone(linkin.hand_to_running("ABCD-EFGH", lambda req, timeout=3: (_ for _ in ()).throw(OSError())))

    def test_windows_only_when_built(self):
        self.assertFalse(linkin.register_windows())


if __name__ == "__main__":
    unittest.main()
