"""Home settings, Look, Show the clock (g17) and Sharp pictures on a 4K TV (g30) ride /api/settings, and
home.show_clock comes through config.json; the phone page's stand-in (tv-home/web/mock.js) keeps the same keys."""
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import server  # noqa: E402


class LookSwitchesBridge(unittest.TestCase):
    def test_show_clock_is_kept(self):
        for v in (True, False):
            self.assertIs(server.clean_settings({"show_clock": v})["show_clock"], v)
            self.assertIs(config._home({"show_clock": v})["show_clock"], v)

    def test_show_clock_anything_else_is_dropped(self):
        for v in ("no", 0, 1, None, "false"):
            self.assertNotIn("show_clock", server.clean_settings({"show_clock": v}))
            self.assertNotIn("show_clock", config._home({"show_clock": v}))

    def test_hi_res_setting_is_kept(self):
        for v in ("auto", "always", "off"):
            self.assertEqual(server.clean_settings({"hi_res": v})["hi_res"], v)

    def test_hi_res_setting_anything_else_is_dropped(self):
        for v in (True, False, "sometimes", 2, None):
            self.assertNotIn("hi_res", server.clean_settings({"hi_res": v}))

    def test_mock_keeps_the_same_keys(self):
        js = open(os.path.join(ROOT, "tv-home", "web", "mock.js"), encoding="utf8").read()
        keys = re.search(r"var BRIDGE_KEYS = \[([^\]]*)\]", js).group(1)
        self.assertIn('"show_clock"', keys)
        self.assertIn('"hi_res"', keys)


if __name__ == "__main__":
    unittest.main()
