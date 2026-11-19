"""Philips Hue and AirTouch 5 with no Home Assistant (bridge/direct.py), against a pretend Hue bridge and
a pretend AirTouch console: pairing by the link button, only ticked lights read or switched, the Hue
key never handed to the page, AirTouch zones as rooms (on, off, temperature, never the unit's mode),
and both merged into the same answers as Home Assistant's (bridge/smarthome.py)."""
import asyncio
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import direct  # noqa: E402
import smarthome  # noqa: E402

USER = "pretendhueuser0123456789abcdef"
ADDR = "192.0.2.40"   # documentation address range, not a real home


def run(c):
    return asyncio.run(c)


class Pretend:
    def __init__(self):
        self.button = False
        self.calls = []
        self.lights = {"1": {"name": "Lounge lamp", "state": {"on": True, "bri": 127, "reachable": True}},
                       "2": {"name": "Hall", "state": {"on": False, "bri": 254, "reachable": True}},
                       "3": {"name": "Porch", "state": {"on": False, "reachable": False}}}
        self.zones = [{"id": 0, "name": "Living", "on": True, "temp": 24.5, "setpoint": 22, "can_set": True},
                      {"id": 1, "name": "Bed 1", "on": False, "temp": 21.0, "setpoint": None, "can_set": False}]
        self.power = True
        self.changes = []

    async def http(self, method, url, body=None, limit=0):
        self.calls.append((method, url, body))
        if url == "http://%s/api" % ADDR and method == "POST":
            return [{"success": {"username": USER}}] if self.button else [{"error": {"type": 101, "description": "link button not pressed"}}]
        if url == "http://%s/api/%s/lights" % (ADDR, USER):
            return json.loads(json.dumps(self.lights))
        if method == "PUT" and url.startswith("http://%s/api/%s/lights/" % (ADDR, USER)):
            lid = url.split("/")[-2]
            self.lights[lid]["state"]["on"] = body["on"]
            return [{"success": {"/lights/%s/state/on" % lid: body["on"]}}]
        return None

    async def airtouch(self, address, change=None):
        if address != ADDR:
            raise OSError("no console")
        if change:
            self.changes.append(change)
        return {"power": self.power, "mode": "cool", "setpoint": 23, "zones": json.loads(json.dumps(self.zones))}


class DirectTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.p = Pretend()
        self.d = direct.Direct(self.dir, {}, env={})
        self.d.http = self.p.http
        self.d.airtouch_session = self.p.airtouch
        self.d.airtouch_ready = lambda: True
        self.home = smarthome.Home(self.dir)
        self.home.direct = self.d

    def test_addresses(self):
        self.assertEqual(direct.clean_host("http://192.0.2.30/"), "192.0.2.30")
        self.assertEqual(direct.clean_host("8.8.8.8"), "")          # never a public address
        self.assertEqual(direct.clean_host("127.0.0.1"), "")        # never this computer
        self.assertEqual(direct.clean_host("a/b"), "")

    def test_hue_pairs_only_with_the_button(self):
        self.assertEqual(run(self.d.hue_pair(ADDR)), {"ok": False, "error": "button"})
        self.assertIsNone(self.d.hue())
        self.p.button = True
        r = run(self.d.hue_pair(ADDR))
        self.assertTrue(r["ok"])
        self.assertEqual([x["id"] for x in r["lights"]], ["1", "2", "3"])
        self.assertEqual(oct(os.stat(os.path.join(self.dir, "direct.json")).st_mode & 0o777), "0o600")
        # the key never reaches the page
        self.assertNotIn(USER, json.dumps(self.home.info()) + json.dumps(self.home.status()))

    def test_only_ticked_lights_show_and_switch(self):
        self.p.button = True
        run(self.d.hue_pair(ADDR))
        self.assertEqual(self.home.info()["controls"], [])  # nothing ticked yet: nothing to show
        self.assertTrue(self.d.hue_save(["1", "3", "x", "../9"])["ok"])
        self.assertEqual(self.d.hue()["lights"], ["1", "3"])
        c = run(self.home.answer("controls"))["controls"]
        self.assertEqual(c[0], {"entity": "light.hue_1", "name": "Lounge lamp", "kind": "light", "ok": True, "state": "on", "on": True, "level": 50})
        self.assertEqual(c[1]["ok"], False)   # unreachable
        self.assertEqual(run(self.home.answer("set", "light.hue_1", "off")), {"ok": True})
        self.assertFalse(self.p.lights["1"]["state"]["on"])
        self.assertEqual(run(self.home.answer("set", "light.hue_2", "on"))["error"], "refused")   # not ticked
        self.assertEqual(run(self.home.answer("set", "light.hue_1", "dim"))["error"], "refused")
        names = [x["entity"] for x in self.home.info()["controls"]]
        self.assertEqual(names, ["light.hue_1", "light.hue_3"])

    def test_airtouch_zones_as_rooms(self):
        self.assertEqual(run(self.d.airtouch_save("8.8.4.4"))["error"], "address")
        r = run(self.d.airtouch_save(ADDR))
        self.assertEqual(r, {"ok": True, "zones": ["Living", "Bed 1"]})
        rooms = run(self.home.answer("climate"))["rooms"]
        self.assertEqual(rooms[0]["entity"], "climate.airtouch_0")
        self.assertEqual(rooms[0]["state"], "cool")
        self.assertEqual(rooms[0]["target"], 22.0)
        self.assertEqual(rooms[1]["state"], "off")
        self.assertEqual(rooms[1]["modes"], [])   # the unit's mode is never changed from a TV
        self.assertEqual(run(self.home.answer("mode", "climate.airtouch_0", "heat"))["error"], "refused")
        self.assertEqual(run(self.home.answer("temp", "climate.airtouch_1", "20"))["error"], "refused")   # percentage zone
        self.assertEqual(run(self.home.answer("temp", "climate.airtouch_0", "40")), {"ok": True})
        self.assertEqual(run(self.home.answer("on", "climate.airtouch_1")), {"ok": True})
        self.assertEqual(len(self.p.changes), 2)
        self.assertEqual(run(self.home.answer("off", "climate.airtouch_7"))["error"], "refused")
        self.assertEqual([x["entity"] for x in self.home.info()["climate"]], ["climate.airtouch_0", "climate.airtouch_1"])

    def test_zones_can_be_limited_and_forgotten(self):
        run(self.d.airtouch_save(ADDR, ["living"]))
        self.assertEqual([r["name"] for r in run(self.home.answer("climate"))["rooms"]], ["Living"])
        self.d.forget("airtouch")
        self.assertIsNone(self.d.airtouch())
        self.assertEqual(run(self.home.answer("climate")), {"ok": False, "error": "off"})

    def test_from_config_json(self):
        d = direct.Direct(self.dir, {"hue": {"bridge": ADDR, "lights": [2]}, "airtouch": {"ip": ADDR}}, env={"HUE_USERNAME": USER})
        self.assertEqual(d.hue(), {"address": ADDR, "user": USER, "lights": ["2"]})
        self.assertEqual(d.airtouch(), {"address": ADDR, "zones": []})
        self.assertIsNone(direct.Direct(self.dir, {"hue": {"bridge": ADDR}}, env={}).hue())   # no key: off

    def test_home_assistant_answers_unchanged_without_direct(self):
        h = smarthome.Home(tempfile.mkdtemp())
        self.assertEqual(h.info(), {})
        self.assertEqual(run(h.answer("climate")), {"ok": False, "error": "off"})


if __name__ == "__main__":
    unittest.main()
