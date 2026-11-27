"""Rooms per TV on the home computer (bridge/rooms.py, direct.py rooms, server.py /api/ha and /api/ha/room), lane B 28 Nov 2026.
The guest room TV sees and controls only its own AirTouch zone, Hue light and speaker, even when it asks for another one by name;
the lounge TV (no room) sees everything. The rule is the shared one in tests/fixtures/room_caps.json."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, AsyncMock

from aiohttp.test_utils import make_mocked_request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
sys.path.insert(0, HERE)
import rooms  # noqa: E402
import direct  # noqa: E402
import smarthome  # noqa: E402
from test_direct_bridge import Pretend, ADDR  # noqa: E402

FIX = json.load(open(os.path.join(HERE, "fixtures", "room_caps.json")))
GUEST = {"label": "Guest room", "only": True, "zones": ["airtouch_1"], "lights": ["light.hue_2"]}


def run(c):
    return asyncio.run(c)


class RuleTest(unittest.TestCase):
    def test_the_shared_cases(self):
        for c in FIX["cases"]:
            self.assertEqual(rooms.allows(c["room"], c["entity"]), c["ok"], c)

    def test_clean(self):
        self.assertIsNone(rooms.clean(None))
        self.assertIsNone(rooms.clean({"label": "Name only"}), "a name alone caps nothing")
        self.assertEqual(rooms.clean({"only": True}), {"only": True})
        c = rooms.clean({"label": "x" * 50, "only": "yes", "zones": ["airtouch_1", "airtouch_1", "bad zone!"], "lights": ["light.a", 5, "nope"]})
        self.assertEqual(c, {"label": "x" * 30, "zones": ["airtouch_1"], "lights": ["light.a"]})


class DirectRoomsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = Pretend()
        self.p.button = True
        self.p.zones.append({"id": 2, "name": "Guest", "on": True, "temp": 22.0, "setpoint": 21, "can_set": True})
        self.d = direct.Direct(self.dir, {}, env={})
        self.d.http = self.p.http
        self.d.airtouch_session = self.p.airtouch
        self.d.airtouch_ready = lambda: True
        self.home = smarthome.Home(self.dir)
        self.home.direct = self.d
        run(self.d.hue_pair(ADDR))
        self.d.hue_save(["1", "2"])
        run(self.d.airtouch_save(ADDR))

    def test_kept_per_tv_and_private(self):
        self.assertIsNone(self.d.room("guest"))
        self.assertEqual(self.d.set_room("guest", GUEST)["zones"], ["airtouch_1"])
        self.assertEqual(self.d.room("guest")["lights"], ["light.hue_2"])
        self.assertIsNone(self.d.room("lounge"), "another TV keeps every zone")
        self.assertIsNone(self.d.room(None))
        self.assertEqual(oct(os.stat(os.path.join(self.dir, "direct.json")).st_mode & 0o777), "0o600")
        self.assertTrue(self.d.hue(), "the Hue set up is untouched")
        self.d.set_room("guest", None)
        self.assertIsNone(self.d.room("guest"))
        self.assertNotIn("rooms", json.load(open(os.path.join(self.dir, "direct.json"))))

    def test_answers_filtered_and_asks_refused(self):
        room = self.d.set_room("guest", GUEST)
        all_rooms = run(self.home.answer("climate"))["rooms"]
        self.assertEqual(len(all_rooms), 3)
        mine = rooms.answer(room, "climate", run(self.home.answer("climate")))["rooms"]
        self.assertEqual([r["entity"] for r in mine], ["climate.airtouch_1"])
        ctl = rooms.answer(room, "controls", run(self.home.answer("controls")))["controls"]
        self.assertEqual([c["entity"] for c in ctl], ["light.hue_2"])
        self.assertFalse(rooms.ask_ok(room, "on", "climate.airtouch_0"))
        self.assertFalse(rooms.ask_ok(room, "set", "light.hue_1"))
        self.assertTrue(rooms.ask_ok(room, "on", "climate.airtouch_1"))
        self.assertTrue(rooms.ask_ok(room, "scene", "scene.movie"))
        info = rooms.info(room, self.home.info())
        self.assertEqual([x["entity"] for x in info["climate"]], ["climate.airtouch_1"])
        self.assertEqual([x["entity"] for x in info["controls"]], ["light.hue_2"])


class ServerTest(unittest.TestCase):
    """Through server.py's own handlers: the TV is told apart by its address."""
    def setUp(self):
        import server
        self.server = server
        self.dir = tempfile.mkdtemp()
        p = Pretend()
        p.button = True
        d = direct.Direct(self.dir, {}, env={})
        d.http, d.airtouch_session, d.airtouch_ready = p.http, p.airtouch, (lambda: True)
        home = smarthome.Home(self.dir)
        home.direct = d
        run(d.hue_pair(ADDR))
        d.hue_save(["1", "2"])
        run(d.airtouch_save(ADDR))
        self.p, self.d, self.home = p, d, home

    def call(self, handler, data, tv):
        s = self.server
        req = make_mocked_request("POST", "/api/ha")
        with patch.object(s, "HA", self.home), patch.object(s, "tv_id_of", return_value=tv), patch.object(s, "body", AsyncMock(return_value=data)):
            r = run(handler(req))
        return json.loads(r.text)["result"]

    def test_guest_tv_reaches_only_its_room(self):
        s = self.server
        self.assertTrue(self.call(s.h_ha_room, {"room": GUEST}, "guest")["ok"])
        r = self.call(s.h_ha, {"action": "climate"}, "guest")
        self.assertEqual([x["entity"] for x in r["rooms"]], ["climate.airtouch_1"])
        self.assertEqual(self.call(s.h_ha, {"action": "on", "entity": "climate.airtouch_0"}, "guest"), {"ok": False, "error": "refused"})
        self.assertEqual(len(self.p.changes), 0, "nothing was sent to the console")
        self.assertEqual(self.call(s.h_ha, {"action": "set", "entity": "light.hue_1", "value": "off"}, "guest"), {"ok": False, "error": "refused"})
        self.assertTrue(self.p.lights["1"]["state"]["on"], "the lounge lamp stayed on")
        self.assertEqual(self.call(s.h_ha, {"action": "on", "entity": "climate.airtouch_1"}, "guest"), {"ok": True})
        # the lounge TV has no room: it sees all three zones
        self.assertEqual(len(self.call(s.h_ha, {"action": "climate"}, "lounge")["rooms"]), 2)

    def test_room_only_for_the_tv_itself(self):
        s = self.server
        # an address that is not a TV, with no pairing key and not this computer: refused
        req = make_mocked_request("POST", "/api/ha/room")
        with patch.object(s, "HA", self.home), patch.object(s, "tv_id_of", return_value=None), patch.object(s, "client_ip", return_value="192.0.2.99"), \
                patch.object(s.config, "PAIRING_KEY", ""), patch.object(s, "body", AsyncMock(return_value={"room": None, "tv": "guest"})):
            from server import ApiError
            with self.assertRaises(ApiError):
                run(s.h_ha_room(req))


if __name__ == "__main__":
    unittest.main()
