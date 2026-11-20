"""Smart home for a web TV through the bridge (bridge/smarthome.py), against a pretend Home Assistant:
set up from the TV (check, save, forget), the token never handed back, only ticked things read or
changed, nothing switched before it is read, and nothing that opens the house."""
import asyncio
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import smarthome  # noqa: E402

TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789"
STATES = {
    "climate.lounge": {"entity_id": "climate.lounge", "state": "cool", "attributes": {"friendly_name": "Lounge", "min_temp": 16, "max_temp": 30,
                       "hvac_modes": ["off", "cool", "heat"], "temperature": 22, "current_temperature": 24.5, "fan_modes": ["low", "high"]}},
    "light.lamp": {"entity_id": "light.lamp", "state": "on", "attributes": {"friendly_name": "Lamp", "brightness": 128}},
    "cover.blinds": {"entity_id": "cover.blinds", "state": "closed", "attributes": {"device_class": "garage"}},
    "sensor.pool": {"entity_id": "sensor.pool", "state": "26.4", "attributes": {"unit_of_measurement": "°C", "friendly_name": "Pool"}},
    "media_player.kitchen": {"entity_id": "media_player.kitchen", "state": "playing", "attributes": {"supported_features": 4 | 1, "volume_level": 0.35}},
    "lock.front": {"entity_id": "lock.front", "state": "locked", "attributes": {}},
}


def run(c):
    return asyncio.run(c)


class SmartHomeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.calls = []
        self.unit = "°C"
        self.home = smarthome.Home(self.dir)

        async def fake(base, token, method, path, body=None, limit=0):
            self.calls.append((base, method, path, body))
            if token != TOKEN:
                return 401, None
            if path == "/api/":
                return 200, b'{"message": "API running."}'
            if path == "/api/states":
                return 200, json.dumps(list(STATES.values())).encode()
            if path.startswith("/api/states/"):
                st = STATES.get(path.split("/")[-1])
                return (200, json.dumps(st).encode()) if st else (404, None)
            if path.startswith("/api/services/"):
                return 200, b"[]"
            if path.startswith("/api/camera_proxy/"):
                return 200, b"\xff\xd8\xff\xe0jpeg"
            if path == "/api/config":
                return 200, json.dumps({"unit_system": {"temperature": self.unit}}).encode()
            return 404, None
        self.home.call = fake

    def test_check_save_and_forget(self):
        self.assertEqual(run(self.home.check("ftp://ha", TOKEN))["error"], "address")
        self.assertEqual(run(self.home.check("http://homeassistant.local:8123", "wrong-token-but-long-enough"))["error"], "token")
        r = run(self.home.check("http://homeassistant.local:8123/", TOKEN))
        self.assertTrue(r["ok"])
        ids = [e["entity"] for e in r["entities"]]
        self.assertNotIn("lock.front", ids)
        self.assertNotIn("cover.blinds", ids, "a garage door is never offered")
        self.assertNotIn(TOKEN, json.dumps(r))
        self.assertEqual(self.home.save({"picks": 1, "controls": [{"entity": "light.lamp"}, {"entity": "lock.front"}]}), {"ok": True})
        self.assertEqual(oct(os.stat(os.path.join(self.dir, smarthome.FILE)).st_mode & 0o777), "0o600")
        st = self.home.status()
        self.assertEqual((st["set"], st["host"], st["controls"]), (True, "homeassistant.local", ["light.lamp"]))
        self.assertNotIn(TOKEN, json.dumps(st) + json.dumps(self.home.info()))
        # a later check with no token uses the kept one
        self.assertTrue(run(self.home.check("http://homeassistant.local:8123", ""))["ok"])
        self.assertEqual(self.home.forget(), {"ok": True})
        self.assertEqual(self.home.status(), {"set": False})

    def test_the_kept_token_never_goes_to_a_new_host(self):
        run(self.home.check("http://homeassistant.local:8123", TOKEN))
        self.home.save({"controls": [{"entity": "light.lamp"}]})
        self.calls.clear()
        # a blank token with any other address is refused before anything is sent
        for other in ["http://attacker.example:8123", "http://homeassistant.local:9999", "https://homeassistant.local:8123", "ftp://x"]:
            self.assertEqual(run(self.home.check(other, ""))["error"], "token", other)
        self.assertEqual(self.calls, [], "nothing was sent anywhere")
        # a blank token with no address, or the kept one, uses the kept pair and only the kept host
        self.assertTrue(run(self.home.check("", ""))["ok"])
        self.assertTrue(run(self.home.check("http://homeassistant.local:8123/", " "))["ok"])
        self.assertEqual({c[0] for c in self.calls}, {"http://homeassistant.local:8123"})
        # with nothing kept, a blank token is simply wrong
        self.home.forget()
        self.calls.clear()
        self.assertEqual(run(self.home.check("http://homeassistant.local:8123", ""))["error"], "token")
        self.assertEqual(self.calls, [])

    def test_only_ticked_things_and_read_first(self):
        self.home.pending = ("http://homeassistant.local:8123", TOKEN)
        self.home.save({"climate": [{"entity": "climate.lounge"}], "controls": [{"entity": "light.lamp"}], "sensors": [{"entity": "sensor.pool"}],
                        "speakers": [{"entity": "media_player.kitchen"}], "cameras": [{"entity": "camera.door"}]})
        self.assertEqual(run(self.home.answer("set", "light.lamp", "off"))["error"], "refused", "read first")
        c = run(self.home.answer("controls"))
        self.assertEqual(c["controls"][0]["level"], 50)
        self.assertTrue(run(self.home.answer("set", "light.lamp", "off"))["ok"])
        self.assertEqual(self.calls[-1][2:], ("/api/services/light/turn_off", {"entity_id": "light.lamp"}))
        self.assertEqual(run(self.home.answer("set", "light.other", "on"))["error"], "refused")
        self.assertEqual(run(self.home.answer("temp", "climate.lounge", "21"))["error"], "refused", "read the room first")
        rooms = run(self.home.answer("climate"))["rooms"]
        self.assertEqual((rooms[0]["target"], rooms[0]["current"]), (22, 24.5))
        self.assertTrue(run(self.home.answer("temp", "climate.lounge", "40"))["ok"])
        self.assertEqual(self.calls[-1][3], {"entity_id": "climate.lounge", "temperature": 30.0}, "kept inside the room's limits")
        self.assertEqual(run(self.home.answer("mode", "climate.lounge", "dry"))["error"], "refused", "a mode the room does not have")
        self.assertEqual(run(self.home.answer("sensors"))["sensors"][0]["unit"], "°C")
        self.assertEqual(run(self.home.answer("speakers"))["speakers"][0]["volume"], 35)
        self.assertTrue(run(self.home.answer("volume", "media_player.kitchen", "60"))["ok"])
        self.assertTrue(run(self.home.answer("still", "camera.door", "640"))["src"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(run(self.home.answer("still", "camera.other", "640"))["error"], "refused")
        self.assertEqual(run(self.home.answer("unlock", "lock.front"))["error"], "refused")

    def test_climate_rooms_carry_home_assistants_own_unit(self):
        # the aircon widget draws a room in the home's unit only when the room says its own (widgets.js roomUnit)
        self.home.pending = ("http://homeassistant.local:8123", TOKEN)
        self.home.listed = {k: "" for k in STATES}   # what a check listed (a later save keeps only those)
        self.home.save({"climate": [{"entity": "climate.lounge"}]})
        self.unit = "°F"
        rooms = run(self.home.answer("climate"))["rooms"]
        self.assertEqual(rooms[0]["unit"], "°F")
        asked = [c[2] for c in self.calls if c[2] == "/api/config"]
        run(self.home.answer("climate"))
        self.assertEqual(len([c for c in self.calls if c[2] == "/api/config"]), len(asked), "the unit is read once, not every time")
        # a Home Assistant that says nothing: no unit, never a guess
        self.home.save({"climate": [{"entity": "climate.lounge"}]})
        self.unit = "kelvin"
        self.assertNotIn("unit", run(self.home.answer("climate"))["rooms"][0])

    def test_a_failed_unit_read_is_asked_again(self):
        # Home Assistant's /api/config down, then up: no unit while it is down, and it is asked again
        self.home.pending = ("http://homeassistant.local:8123", TOKEN)
        self.home.listed = {k: "" for k in STATES}
        self.home.save({"climate": [{"entity": "climate.lounge"}]})
        real, down = self.home.call, [True]

        async def flaky(base, token, method, path, body=None, limit=0):
            if path == "/api/config" and down[0]:
                self.calls.append((base, method, path, body))
                return -1, None
            return await real(base, token, method, path, body, limit)
        self.home.call = flaky
        self.unit = "°F"
        self.assertNotIn("unit", run(self.home.answer("climate"))["rooms"][0], "no unit while Home Assistant does not say")
        down[0] = False
        self.assertEqual(run(self.home.answer("climate"))["rooms"][0]["unit"], "°F", "asked again once it answers")
        run(self.home.answer("climate"))
        self.assertEqual(len([c for c in self.calls if c[2] == "/api/config"]), 2, "asked twice (failed, then answered), then kept")

    def test_scenes_and_scripts_that_open_the_house(self):
        # the owner's rule: locks, alarms, garage doors and gates never show on the TV, so no scene or
        # script named for one is kept, and no scene that sets one is listed or run
        more = {
            "scene.movie": {"entity_id": "scene.movie", "state": "x", "attributes": {"entity_id": ["light.lamp"]}},
            "scene.leaving": {"entity_id": "scene.leaving", "state": "x", "attributes": {"entity_id": ["light.lamp", "lock.front"]}},
            "scene.away": {"entity_id": "scene.away", "state": "x", "attributes": {"entity_id": ["alarm_control_panel.house"]}},
            "scene.home": {"entity_id": "scene.home", "state": "x", "attributes": {"entity_id": ["cover.blinds"]}},   # cover.blinds is a garage door
            "scene.disarm_alarm": {"entity_id": "scene.disarm_alarm", "state": "x", "attributes": {}},
            "script.open_garage": {"entity_id": "script.open_garage", "state": "off", "attributes": {}},
            "script.unlock_front_door": {"entity_id": "script.unlock_front_door", "state": "off", "attributes": {}},
            "script.morning": {"entity_id": "script.morning", "state": "off", "attributes": {}},
            "switch.alarm_siren": {"entity_id": "switch.alarm_siren", "state": "off", "attributes": {}},
            "switch.garagedoor": {"entity_id": "switch.garagedoor", "state": "off", "attributes": {}},
        }
        STATES.update(more)
        try:
            ids = [e["entity"] for e in smarthome.pickable(list(STATES.values()))]
            for bad in ("scene.leaving", "scene.away", "scene.home", "scene.disarm_alarm", "script.open_garage", "script.unlock_front_door",
                        "switch.alarm_siren", "switch.garagedoor", "cover.blinds", "lock.front"):
                self.assertNotIn(bad, ids, bad + " is never offered")
            self.assertIn("scene.movie", ids)
            self.assertIn("script.morning", ids)
            # config.json (or an older set up) naming them: the named ones are never kept
            s = smarthome.parse({"url": "http://ha:8123", "token": TOKEN, "scenes": [{"entity": e} for e in
                                 ("scene.movie", "script.open_garage", "scene.disarm_alarm", "script.unlock_front_door", "scene.leaving", "scene.home", "script.morning")],
                                 "controls": [{"entity": e} for e in ("switch.alarm_siren", "switch.garagedoor", "cover.frontgate", "switch.doorlock", "cover.garage2", "light.lamp")]})
            self.assertEqual([n["entity"] for n in s["scenes"]], ["scene.movie", "scene.leaving", "scene.home", "script.morning"])
            self.assertEqual([n["entity"] for n in s["controls"]], ["light.lamp"])
            h = smarthome.Home(self.dir, {"url": "http://homeassistant.local:8123", "scenes": s and [{"entity": n["entity"]} for n in s["scenes"]]}, TOKEN)
            h.call = self.home.call
            self.assertEqual([n["entity"] for n in h.info()["scenes"]], ["scene.movie", "scene.leaving", "scene.home", "script.morning"])
            self.calls.clear()
            # a scene that sets a lock or a garage door: refused, and nothing is switched
            for bad in ("scene.leaving", "scene.home", "script.open_garage"):
                self.assertEqual(run(h.answer("scene", bad))["error"], "refused", bad)
            self.assertFalse([c for c in self.calls if c[1] == "POST"], "nothing was run")
            self.assertTrue(run(h.answer("scene", "scene.movie"))["ok"])
            self.assertEqual(self.calls[-1][2], "/api/services/scene/turn_on")
            self.assertTrue(run(h.answer("scene", "script.morning"))["ok"])
            self.assertEqual(self.calls[-1][2], "/api/services/script/turn_on")
        finally:
            for k in more:
                STATES.pop(k, None)

    def test_a_garage_door_by_its_class_reads_blocked_and_never_opens(self):
        # cover.blinds is a garage door to Home Assistant: kept from config.json by its id, read "blocked"
        # (the TV then leaves it out of every list, smarthome.js houseSafe), and never switched
        h = smarthome.Home(self.dir, {"url": "http://homeassistant.local:8123", "controls": [{"entity": "cover.blinds"}, {"entity": "light.lamp"}]}, TOKEN)
        h.call = self.home.call
        c = {x["entity"]: x for x in run(h.answer("controls"))["controls"]}
        self.assertTrue(c["cover.blinds"]["blocked"])
        self.assertNotIn("blocked", c["light.lamp"])
        for v in ("open", "close", "on", "off", "toggle"):
            self.assertEqual(run(h.answer("set", "cover.blinds", v))["error"], "refused", v)
        self.assertFalse([x for x in self.calls if x[1] == "POST"])

    def test_config_section_with_env_token(self):
        h = smarthome.Home(self.dir, {"url": "http://ha:8123", "scenes": [{"entity": "scene.movie"}]}, TOKEN)
        self.assertEqual(h.info()["scenes"], [{"entity": "scene.movie", "name": "Movie"}])
        self.assertEqual(smarthome.Home(self.dir, {"enabled": False, "url": "http://ha:8123"}, TOKEN).info(), {})

    def test_energy_hours_match_the_tv(self):
        start = 0
        p = [(start + 30 * 60000, "1.0"), (start + 90 * 60000, "2.5"), (start + 150 * 60000, "0.5")]
        self.assertEqual(smarthome.series(smarthome.energy_hours(p, start, start + 3 * 3600000, "kWh"))[:3], [0.0, 1.5, 0.5])


if __name__ == "__main__":
    unittest.main()
