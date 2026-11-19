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
