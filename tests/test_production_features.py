import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config


class TestProductionFeatures(unittest.TestCase):
    def test_inputs_validation(self):
        """Verify _inputs correctly parses valid items and ignores malformed ones."""
        raw = [
            {"port": 1, "label": "PS5", "icon": "ps5"},
            {"match": "HDMI 2", "label": "Switch", "icon": "switch"},
            {"id": "HW5", "label": "Xbox Series X", "icon": "xbox"},
            {"device": "Apple TV", "label": "Apple TV", "icon": "hdmi"},
            {"label": "Invalid because no selector"},
            {"port": 99, "label": "Invalid port"},
            "not a dict",
            {"port": 3, "label": "", "icon": "hdmi"},  # empty label
            {"port": 4, "label": "Generic", "icon": "invalid_icon_fallback"},
        ]
        parsed = config._inputs(raw)
        self.assertEqual(len(parsed), 5)
        self.assertEqual(parsed[0], {"port": 1, "label": "PS5", "icon": "ps5"})
        self.assertEqual(parsed[1], {"match": "HDMI 2", "label": "Switch", "icon": "switch"})
        self.assertEqual(parsed[2], {"id": "HW5", "label": "Xbox Series X", "icon": "xbox"})
        self.assertEqual(parsed[3], {"device": "Apple TV", "label": "Apple TV", "icon": "hdmi"})
        # Fallback icon check
        self.assertEqual(parsed[4]["icon"], "hdmi")
        self.assertEqual(parsed[4]["label"], "Generic")

    def test_home_integration_inputs(self):
        """Verify _home includes sanitized inputs."""
        h = {
            "inputs": [
                {"port": 1, "label": "PlayStation 5", "icon": "ps5"}
            ]
        }
        res = config._home(h)
        self.assertIn("inputs", res)
        self.assertEqual(len(res["inputs"]), 1)
        self.assertEqual(res["inputs"][0]["label"], "PlayStation 5")

    def test_bedtime_dim_is_off_unless_asked_for(self):
        self.assertIs(config._home({})["bedtime_dim"], False)
        self.assertIs(config._home({"bedtime_dim": "yes"})["bedtime_dim"], False)
        self.assertIs(config._home({"bedtime_dim": True})["bedtime_dim"], True)

    def test_oled_look_option(self):
        self.assertEqual(config._home({"look": "oled"})["look"], "oled")
        self.assertEqual(config._home({"look": "night"})["look"], "night")
        self.assertEqual(config._home({"look": "classic"})["look"], "classic")
        self.assertEqual(config._home({"look": "invalid"})["look"], "night")

    def test_soundscape_validation(self):
        # String shorthand
        res = config._home({"soundscape": "rain"})
        self.assertEqual(res["soundscape"], {"type": "rain", "volume": 0.5, "fade_with_sleep": True})

        # Detailed dict
        res2 = config._home({"soundscape": {"type": "waves", "volume": 0.75, "fade_with_sleep": False}})
        self.assertEqual(res2["soundscape"], {"type": "waves", "volume": 0.75, "fade_with_sleep": False})

        # Clamped volume
        res3 = config._home({"soundscape": {"type": "fire", "volume": 1.5}})
        self.assertEqual(res3["soundscape"]["volume"], 1.0)

        # Invalid type ignored
        self.assertNotIn("soundscape", config._home({"soundscape": "invalid_ambient"}))
        self.assertNotIn("soundscape", config._home({"soundscape": {"type": "invalid"}}))

    def test_soundscape_quick_button(self):
        q = config.quick_for({"quick": ["sleep", "soundscape", "look"]})
        self.assertEqual(q, ["sleep", "soundscape", "look"])

    def test_screen_off_quick_button(self):
        q = config.quick_for({"quick": ["sleep", "soundscape", "screen_off", "look"]})
        self.assertEqual(q, ["sleep", "soundscape", "screen_off", "look"])
        import server
        cleaned = server.clean_settings({"quick": ["screen_off", "sleep", "invalid"]})
        self.assertEqual(cleaned["quick"], ["screen_off", "sleep"])

    def test_photo_limit_is_fifty_and_trims(self):
        import server
        self.assertEqual(server.MAX_PHOTOS, 50)
        many = [{"id": "p%d" % i, "url": "https://example.org/%d.jpg" % i} for i in range(80)]
        cleaned = server.clean_settings({"photos": many})
        self.assertEqual(len(cleaned["photos"]), 50)
        self.assertEqual(cleaned["photos"][-1]["id"], "p49")
        fifty = server.clean_settings({"photos": many[:50]})
        self.assertEqual(len(fifty["photos"]), 50)

    def test_photo_validation_still_drops_bad_entries(self):
        import server
        mixed = [{"id": "a", "file": "p1.jpg"}, {"id": "b", "file": "../x.jpg"}, {"id": "c", "url": "ftp://x"},
                 {"id": "d", "url": "https://example.org/d.jpg"}, "junk", {"url": "https://example.org/e.jpg"}]
        cleaned = server.clean_settings({"photos": mixed})
        self.assertEqual([p["id"] for p in cleaned["photos"]], ["a", "d"])

    def test_home_settings_keep_oled_and_soundscape(self):
        # what the TV saves from Home settings must survive the bridge's check
        import server
        self.assertEqual(server.clean_settings({"look": "oled"})["look"], "oled")
        self.assertNotIn("look", server.clean_settings({"look": "black"}))
        got = server.clean_settings({"soundscape": {"type": "rain", "volume": 7, "fade_with_sleep": False}, "quick": ["soundscape", "x"]})
        self.assertEqual(got["soundscape"], {"type": "rain", "volume": 1.0, "fade_with_sleep": False})
        self.assertEqual(got["quick"], ["soundscape"])
        self.assertNotIn("soundscape", server.clean_settings({"soundscape": {"type": "thunder"}}))
        self.assertIs(server.clean_settings({"ambient_music": True})["ambient_music"], True)
        self.assertIs(server.clean_settings({"ambient_music": False})["ambient_music"], False)
        self.assertIs(server.clean_settings({"ambient_weather": True})["ambient_weather"], True)
        self.assertIs(server.clean_settings({"ambient_weather": False})["ambient_weather"], False)
        self.assertNotIn("ambient_weather", server.clean_settings({"ambient_weather": "yes"}))
        self.assertIs(server.clean_settings({"ambient_sun_grade": True})["ambient_sun_grade"], True)
        self.assertIs(server.clean_settings({"ambient_sun_grade": False})["ambient_sun_grade"], False)
        self.assertNotIn("ambient_sun_grade", server.clean_settings({"ambient_sun_grade": 123}))

    def test_ambient_weather_config_validation(self):
        self.assertIs(config._home({"ambient_weather": True})["ambient_weather"], True)
        self.assertIs(config._home({"ambient_weather": False})["ambient_weather"], False)
        self.assertNotIn("ambient_weather", config._home({"ambient_weather": "yes"}))
        self.assertIs(config._home({"ambient_sun_grade": True})["ambient_sun_grade"], True)
        self.assertIs(config._home({"ambient_sun_grade": False})["ambient_sun_grade"], False)
        self.assertNotIn("ambient_sun_grade", config._home({"ambient_sun_grade": 1}))

    def test_no_soundscape_or_oled_by_default(self):
        h = config._home({})
        self.assertNotIn("soundscape", h)
        self.assertEqual(h["look"], "night")
        self.assertNotIn("soundscape", config.quick_for({}))

    def test_headphones_quick_button(self):
        q = config.quick_for({"quick": ["sleep", "headphones", "bluetooth_audio", "invalid"]})
        self.assertEqual(q, ["sleep", "headphones"])
        self.assertNotIn("headphones", config.quick_for({}))

    def test_clean_settings_quick_headphones(self):
        import server
        got = server.clean_settings({"quick": ["headphones", "bluetooth_audio", "invalid_btn"]})
        self.assertEqual(got["quick"], ["headphones"])


if __name__ == "__main__":
    unittest.main()
