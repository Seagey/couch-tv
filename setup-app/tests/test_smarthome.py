"""The Smart home step in Couch TV Setup (couchtv_setup/smarthome.py, lane B 28 Nov 2026), against a pretend Home Assistant (its own
sign in page flow, the token swap, the websocket that makes a long-lived token and lists areas) and a pretend Hue Bridge, both on this
computer. No TV and no real device is touched. The real Home Assistant run is tests/real_ha_smarthome.py on the MacBook."""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())
from couchtv_setup import smarthome as sh, studio  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402

FIX = os.path.join(HERE, "..", "..", "tests", "fixtures")
LLAT = "llat." + "L" * 60
ACCESS = "access." + "A" * 40

STATES = [
    {"entity_id": "climate.lounge", "attributes": {"friendly_name": "Lounge air con"}},
    {"entity_id": "climate.guest", "attributes": {"friendly_name": "Guest air con"}},
    {"entity_id": "light.lounge", "attributes": {"friendly_name": "Lounge lamp"}},
    {"entity_id": "media_player.lounge", "attributes": {"friendly_name": "Lounge speaker"}},
    {"entity_id": "cover.garage_door", "attributes": {"friendly_name": "Garage door", "device_class": "garage"}},
    {"entity_id": "switch.relay_1", "attributes": {"friendly_name": "Garagentor"}},
    {"entity_id": "lock.front", "attributes": {"friendly_name": "Front"}},
    {"entity_id": "scene.movie", "attributes": {"friendly_name": "Movie night"}},
    {"entity_id": "sensor.pool", "attributes": {"friendly_name": "Pool", "unit_of_measurement": "°C"}},
]


class FakeHA(BaseHTTPRequestHandler):
    log = []
    codes = {}

    def log_message(self, *a):
        pass

    def _json(self, code, o):
        raw = json.dumps(o).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self):
        return self.headers.get("Authorization") == "Bearer " + LLAT

    def do_GET(self):
        FakeHA.log.append(("GET", self.path))
        if self.path == "/auth/providers":
            return self._json(200, {"providers": [{"type": "homeassistant"}]})
        if self.path == "/api/websocket":
            return self.ws()
        if not self._auth():
            return self._json(401, {"message": "401: Unauthorized"})
        if self.path == "/api/":
            return self._json(200, {"message": "API running."})
        if self.path == "/api/states":
            return self._json(200, STATES)
        if self.path == "/api/config":
            return self._json(200, {"version": "2026.11.0"})
        self._json(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        form = urllib.parse.parse_qs(self.rfile.read(n).decode())
        FakeHA.log.append(("POST", self.path, {k: v[0] for k, v in form.items()}))
        if self.path == "/auth/token":
            if form.get("code", [""])[0] in FakeHA.codes and form.get("client_id", [""])[0] == FakeHA.codes[form["code"][0]]:
                return self._json(200, {"access_token": ACCESS, "refresh_token": "refresh." + "R" * 40, "token_type": "Bearer", "expires_in": 1800})
            return self._json(400, {"error": "invalid_request"})
        if self.path == "/auth/revoke":
            return self._json(200, {})
        self._json(404, {})

    # a websocket server, just enough for Home Assistant's auth, long-lived token and the three registries
    def ws(self):
        key = self.headers.get("Sec-WebSocket-Key")
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % acc).encode())
        self.wfile.flush()
        s = self.connection

        def send(o):
            d = json.dumps(o).encode()
            head = bytes([0x81]) + (bytes([len(d)]) if len(d) < 126 else bytes([126]) + struct.pack(">H", len(d)))
            s.sendall(head + d)

        def recv():
            a, b = s.recv(1)[0], s.recv(1)[0]
            n = b & 0x7F
            if n == 126:
                n = struct.unpack(">H", s.recv(2))[0]
            mask = s.recv(4)
            data = b""
            while len(data) < n:
                data += s.recv(n - len(data))
            return json.loads(bytes(c ^ mask[i % 4] for i, c in enumerate(data)))
        send({"type": "auth_required", "ha_version": "2026.11.0"})
        a = recv()
        if a.get("access_token") not in (ACCESS, LLAT):
            return send({"type": "auth_invalid"})
        send({"type": "auth_ok", "ha_version": "2026.11.0"})
        try:
            while True:
                m = recv()
                FakeHA.log.append(("WS", m.get("type"), m.get("client_name", "")))
                if m["type"] == "auth/long_lived_access_token":
                    send({"id": m["id"], "type": "result", "success": True, "result": LLAT})
                elif m["type"] == "config/area_registry/list":
                    send({"id": m["id"], "type": "result", "success": True, "result": [{"area_id": "guest", "name": "Guest room"}]})
                elif m["type"] == "config/device_registry/list":
                    send({"id": m["id"], "type": "result", "success": True, "result": [{"id": "d1", "area_id": "guest"}]})
                elif m["type"] == "config/entity_registry/list":
                    send({"id": m["id"], "type": "result", "success": True, "result": [{"entity_id": "climate.guest", "device_id": "d1"}]})
        except (OSError, IndexError, ValueError):
            pass


class FakeHue(BaseHTTPRequestHandler):
    presses = 0

    def log_message(self, *a):
        pass

    def _json(self, o):
        raw = json.dumps(o).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        FakeHue.presses += 1
        if FakeHue.presses < 2:
            return self._json([{"error": {"type": 101, "description": "link button not pressed"}}])
        self._json([{"success": {"username": "hueuser" + "x" * 30}}])

    def do_GET(self):
        self._json({"1": {"name": "Lounge lamp"}, "4": {"name": "Guest lamp"}})


def serve(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class RulesTest(unittest.TestCase):
    def test_house_ids_names_and_rooms_agree_with_every_copy(self):
        ids = json.load(open(os.path.join(FIX, "opens_house_ids.json")))
        for e in ids["refuse"]:
            self.assertTrue(sh.opens_house(e), e)
        for e in ids["pass"]:
            self.assertFalse(sh.opens_house(e), e)
        names = json.load(open(os.path.join(FIX, "opens_house_names.json")))
        for c in names["refuse"]:
            self.assertTrue(sh.opens_house(c["entity"], {"friendly_name": c["name"]}), c)
        for c in names["pass"]:
            self.assertFalse(sh.opens_house(c["entity"], {"friendly_name": c["name"]}), c)
        rooms = json.load(open(os.path.join(FIX, "room_caps.json")))
        for c in rooms["cases"]:
            self.assertEqual(sh.room_allows(c["room"], c["entity"]), c["ok"], c)

    def test_word_list_is_matters(self):
        sys.path.insert(0, os.path.join(HERE, "..", "..", "bridge"))
        import matter
        self.assertEqual(sh.NAME_WORDS[:len(matter.OPENS_HOUSE_WORDS)], matter.OPENS_HOUSE_WORDS)

    def test_pickable_leaves_openers_out(self):
        ents = [e["entity"] for e in sh.pickable(STATES)]
        for bad in ("cover.garage_door", "switch.relay_1", "lock.front"):
            self.assertNotIn(bad, ents)
        self.assertIn("climate.guest", ents)

    def test_only_home_addresses(self):
        self.assertIsNone(sh.clean_base("http://8.8.8.8:8123"))
        self.assertEqual(sh.clean_base("http://homeassistant.local:8123/"), "http://homeassistant.local:8123")
        with self.assertRaises(TvError):
            sh.http("GET", "http://example.com/")

    def test_room_of(self):
        r = sh.room_of({"air": ["climate.guest", "airtouch_3", "bad"], "lights": ["light.hue_4"], "speakers": []}, "Guest room")
        self.assertEqual(r, {"label": "Guest room", "only": True, "climate": ["climate.guest"], "zones": ["airtouch_3"], "lights": ["light.hue_4"]})


class FlowTest(unittest.TestCase):
    def setUp(self):
        sh.SM.reset()
        FakeHA.log = []
        self.ha = serve(FakeHA)
        self.base = "http://127.0.0.1:%d" % self.ha.server_address[1]

    def tearDown(self):
        self.ha.shutdown()

    def test_sign_in_in_the_browser_makes_a_long_lived_token(self):
        url = sh.ha_start(self.base, 51234)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(q["client_id"], ["http://127.0.0.1:51234/"])
        self.assertEqual(q["redirect_uri"], ["http://127.0.0.1:51234/ha/back"])
        # a made up state is refused, and nothing is swapped
        ok, _ = sh.ha_back("state=nope&code=abcdefgh")
        self.assertFalse(ok)
        FakeHA.codes = {"goodcode123": "http://127.0.0.1:51234/"}
        url = sh.ha_start(self.base, 51234)
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)["state"][0]
        ok, words = sh.ha_back("state=%s&code=goodcode123" % state)
        self.assertTrue(ok, words)
        self.assertEqual(sh.SM.ha["token"], LLAT)
        self.assertTrue(any(x[0] == "WS" and x[1] == "auth/long_lived_access_token" and x[2].startswith("Couch TV") for x in FakeHA.log), "a long-lived token named Couch TV")
        self.assertTrue(any(x[0] == "POST" and x[1] == "/auth/revoke" for x in FakeHA.log), "the short sign in is let go")
        guest = [e for e in sh.SM.ha["entities"] if e["entity"] == "climate.guest"][0]
        self.assertEqual(guest["area"], "Guest room", "Home Assistant's own area names")
        v = json.dumps(sh.view())
        self.assertNotIn(LLAT, v)
        self.assertNotIn("L" * 20, v, "the page never sees the token")
        # the same state cannot be used twice
        self.assertFalse(sh.ha_back("state=%s&code=goodcode123" % state)[0])

    def test_pasted_token(self):
        with self.assertRaises(TvError):
            sh.ha_use(self.base, "short")
        with self.assertRaises(TvError):
            sh.ha_use(self.base, "wrong." + "W" * 40)
        sh.ha_use(self.base, LLAT)
        self.assertEqual(len(sh.choices()["air"]), 2)

    def test_hue_button(self):
        hue = serve(FakeHue)
        try:
            FakeHue.presses = 0
            with mock.patch.object(sh, "home_host", return_value=True), mock.patch("time.sleep"):
                # the pretend bridge listens on a port: talk to it there
                with mock.patch.object(sh, "http", side_effect=lambda m, u, *a, **k: sh.__dict__["_real_http"](m, u.replace("http://127.0.0.1/", "http://127.0.0.1:%d/" % hue.server_address[1]), *a, **k)):
                    sh.hue_pair("127.0.0.1", wait=5)
            self.assertEqual([x["id"] for x in sh.SM.hue["lights"]], ["1", "4"])
            self.assertEqual(FakeHue.presses, 2, "it kept asking until the button was pressed")
        finally:
            hue.shutdown()

    def test_save_to_the_account(self):
        sh.ha_use(self.base, LLAT)
        sh.SM.hue = {"address": "192.0.2.20", "user": "hueuser" + "x" * 30, "lights": [{"id": "4", "name": "Guest lamp"}]}
        sh.SM.airtouch = {"address": "192.0.2.30", "zones": [{"id": "airtouch_3", "name": "Guest"}]}
        calls = []

        def call(path, body, token=None, timeout=15):
            calls.append((path, body, token))
            return {"ok": True, "rev": 5}
        link = studio.Link()
        link.token = "setup-token"
        helper = tempfile.mkdtemp()
        with mock.patch.object(studio, "call", side_effect=call), mock.patch.object(sh, "helper_dir", return_value=helper):
            sh.report(link)
            r = sh.save(link, [
                {"tv_id": "22222222-2222-4222-8222-222222222222", "label": "Lounge", "picks": {"air": ["climate.lounge", "climate.guest"], "lights": ["light.lounge"], "speakers": ["media_player.lounge"]}},
                {"tv_id": "33333333-3333-4333-8333-333333333333", "label": "Guest room", "picks": {"air": ["airtouch_3"], "lights": ["light.hue_4"], "speakers": []}},
                {"tv_id": "44444444-4444-4444-8444-444444444444", "label": "Nothing", "picks": {}},
            ])
        found = [c for c in calls if c[0] == "/v1/setup/found"][0][1]
        self.assertNotIn(LLAT, json.dumps(found), "names only to the account")
        self.assertNotIn("switch.relay_1", json.dumps(found))
        keys = {c[1]["kind"]: c[1]["key"] for c in calls if c[0] == "/v1/setup/keys"}
        self.assertEqual(keys["ha"], {"token": LLAT, "url": self.base})
        self.assertEqual(keys["hue"]["url"], "http://192.0.2.20")
        rooms = [c for c in calls if c[0] == "/v1/setup/rooms"][0][1]["tvs"]
        self.assertEqual(rooms[0]["allow"], ["ha"])
        self.assertEqual(rooms[1]["allow"], ["hue", "airtouch"])
        self.assertEqual(rooms[1]["room"], {"label": "Guest room", "only": True, "zones": ["airtouch_3"], "lights": ["light.hue_4"]})
        self.assertEqual(rooms[2]["allow"], [], "nothing ticked, no key")
        # the Helper on this computer: Hue, AirTouch and (H3) Home Assistant, each mode 600
        for f in ("direct.json", "home-assistant.json"):
            self.assertEqual(oct(os.stat(os.path.join(helper, f)).st_mode & 0o777), "0o600")
        hs = json.load(open(os.path.join(helper, "home-assistant.json")))
        self.assertEqual(hs["token"], LLAT)
        self.assertEqual([x["entity"] for x in hs["climate"]], ["climate.guest", "climate.lounge"])
        self.assertNotIn("switch.relay_1", json.dumps(hs))
        self.assertTrue(r["helper"] and r["helper_ha"])
        sys.path.insert(0, os.path.join(HERE, "..", "..", "bridge"))
        import smarthome as bridge_sh
        self.assertIsNotNone(bridge_sh.parse(hs), "the bridge reads what Setup wrote")

    def test_helper_never_replaces_a_tv_sign_in(self):
        sh.ha_use(self.base, LLAT)
        d = tempfile.mkdtemp()
        mine = {"url": "http://homeassistant.local:8123", "refresh_token": "r" * 30, "client_id": "http://192.0.2.5:5400/"}
        json.dump(mine, open(os.path.join(d, "home-assistant.json"), "w"))
        self.assertFalse(sh.write_helper_ha(set(), d))
        self.assertEqual(json.load(open(os.path.join(d, "home-assistant.json"))), mine)


class MatterTest(unittest.TestCase):
    def test_code_to_the_tv_over_adb(self):
        said = iter(['Broadcast completed: result=1, data="couchtv-matter started"', 'result=1, data="couchtv-matter running"', 'result=1, data="couchtv-matter ok 1,2"'])

        class TV:
            cmds = []

            def shell(self, c, timeout_s=60):
                TV.cmds.append(c)
                return next(said)
        with mock.patch("time.sleep"):
            r = sh.matter_add_tv(TV(), "3497-011-2332")
        self.assertEqual(r, {"ok": True, "on": "tv", "devices": ["1", "2"]})
        self.assertIn("--es matter_code 34970112332", TV.cmds[0])
        self.assertIn("dev.couchtv.ontv/.matter.MatterFromComputer", TV.cmds[0])

    def test_refused_lock_and_bad_code(self):
        said = iter(['data="couchtv-matter started"', 'data="couchtv-matter no not_allowed"'])

        class TV:
            def shell(self, c, timeout_s=60):
                return next(said)
        with mock.patch("time.sleep"), self.assertRaises(TvError) as e:
            sh.matter_add_tv(TV(), "34970112332")
        self.assertIn("lock", str(e.exception))
        with self.assertRaises(TvError):
            sh.matter_code("1234")

    def test_computer_needs_node(self):
        # N13: with no usable Node, Setup fetches the official one into the Helper's folder (tests/test_nodejs.py); only a computer type it
        # cannot fetch for is told to get Node itself
        from couchtv_setup import nodejs
        boom = TvError("Matter needs Node.js 22.13 or newer, and this computer type cannot fetch it by itself.", "node_platform")
        with mock.patch.object(sh, "node_ok", return_value=(False, "v20.1.0")), mock.patch.object(nodejs, "ensure", side_effect=boom), \
                self.assertRaises(TvError) as e:
            sh.matter_add("34970112332")
        self.assertIn("22.13", str(e.exception))
        self.assertIn("v20.1.0", str(e.exception))
        self.assertEqual(e.exception.code, "matter_node")


sh._real_http = sh.http

if __name__ == "__main__":
    unittest.main()
