import json
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config


class TestWatchNextLogic(unittest.TestCase):
    def test_home_config_serialization(self):
        """Verify home-config.py emits skip_watch_next and watch_next_per_app."""
        root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
        env = dict(os.environ, COUCH_CONFIG=os.path.join(root, "config.example.json"))
        res = subprocess.run(
            [sys.executable, os.path.join(root, "tv-home", "tools", "home-config.py"), "--json"],
            capture_output=True,
            text=True,
            check=True,
            env=env
        )
        data = json.loads(res.stdout)
        home = data.get("home", {})
        self.assertIn("skip_watch_next", home)
        self.assertEqual(home["skip_watch_next"], [])   # empty unless config.json lists packages
        self.assertIn("watch_next_per_app", home)
        self.assertEqual(home["watch_next_per_app"], 5)

    def test_skip_watch_next_default_empty_and_sanitization(self):
        """Verify skip_watch_next is empty by default, and sanitizes package names."""
        # Default is empty
        res_default = config._home({})
        self.assertEqual(res_default["skip_watch_next"], [])

        # User-configured list with duplicates and invalid characters
        res_custom = config._home({
            "skip_watch_next": ["com.tcl.browser", "com.example.spam", "com.tcl.browser", "invalid;pkg!", 123]
        })
        self.assertEqual(res_custom["skip_watch_next"], ["com.tcl.browser", "com.example.spam"])

    def test_keep_watching_toggle_validation(self):
        """Verify home.keep_watching is only emitted for a real boolean."""
        self.assertNotIn("keep_watching", config._home({}))
        self.assertIs(config._home({"keep_watching": False})["keep_watching"], False)
        self.assertIs(config._home({"keep_watching": True})["keep_watching"], True)
        self.assertNotIn("keep_watching", config._home({"keep_watching": "no"}))
        self.assertNotIn("keep_watching", config._home({"keep_watching": 0}))

    def test_watch_next_per_app_default_and_bounds(self):
        """Verify watch_next_per_app defaults to 5 and is clamped between 1 and 20."""
        self.assertEqual(config._home({})["watch_next_per_app"], 5)
        self.assertEqual(config._home({"watch_next_per_app": 8})["watch_next_per_app"], 8)
        self.assertEqual(config._home({"watch_next_per_app": -1})["watch_next_per_app"], 1)
        self.assertEqual(config._home({"watch_next_per_app": 50})["watch_next_per_app"], 20)


if __name__ == "__main__":
    unittest.main()
