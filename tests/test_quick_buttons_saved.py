"""Quick buttons picked in Home settings stay picked (social report g31, a Google TV Streamer).

The TV home offers every button in QUICK_ALL (tv-home/web/app.js). With a computer at home the TV
hands its Home settings to the bridge and, on the next refresh, takes the bridge's copy back.
clean_settings kept only the ids in config.QUICK_IDS, which lacked "bluetooth" and "network", so
those two buttons were dropped by the bridge and vanished from the TV a moment after they were
picked, and after every restart. Every button the home offers must survive the bridge's copy.
"""
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import server  # noqa: E402


def home_quick_all():
    src = open(os.path.join(ROOT, "tv-home", "web", "app.js"), encoding="utf-8").read()
    m = re.search(r"var QUICK_ALL = \[([^\]]*)\]", src)
    return re.findall(r'"([a-z_]+)"', m.group(1))


class QuickButtonsSaved(unittest.TestCase):
    def test_every_home_button_is_known_to_the_bridge(self):
        missing = [q for q in home_quick_all() if q not in config.QUICK_IDS]
        self.assertEqual(missing, [], "the bridge would drop these quick buttons")

    def test_whole_pick_survives_the_bridge_copy(self):
        pick = ["bluetooth", "network", "sleep", "look", "input"]
        self.assertEqual(server.clean_settings({"quick": pick})["quick"], pick)

    def test_every_button_round_trips(self):
        allq = home_quick_all()
        self.assertEqual(server.clean_settings({"quick": allq})["quick"], allq)

    def test_unknown_and_repeated_still_dropped(self):
        self.assertEqual(server.clean_settings({"quick": ["sleep", "sleep", "rm -rf", 3]})["quick"], ["sleep"])

    def test_empty_pick_is_kept(self):
        # taking every button off is a choice too: an empty list, not the defaults back
        self.assertEqual(server.clean_settings({"quick": []})["quick"], [])


if __name__ == "__main__":
    unittest.main()
