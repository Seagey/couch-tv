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

    def test_hidden_watch_next_simulation(self):
        """Simulate Watch Next dismissal using ID and composite (pkg|title) signature."""
        cursor_rows = [
            {"id": "101", "pkg": "com.netflix.ninja", "title": "Stranger Things"},
            {"id": "102", "pkg": "com.netflix.ninja", "title": "The Crown"},
            {"id": "103", "pkg": "in.startv.hotstar", "title": "Special Ops"},
        ]

        # User dismissed row 101 by ID, and Special Ops by composite key
        hidden_ids = {"101", "in.startv.hotstar|Special Ops"}

        remaining = []
        for r in cursor_rows:
            composite = f"{r['pkg']}|{r['title']}"
            if r["id"] in hidden_ids or composite in hidden_ids:
                continue
            remaining.append(r)

        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["title"], "The Crown")


if __name__ == "__main__":
    unittest.main()
