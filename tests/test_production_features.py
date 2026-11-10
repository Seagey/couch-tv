import os
import sys
import unittest

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


if __name__ == "__main__":
    unittest.main()
