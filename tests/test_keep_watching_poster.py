# home.keep_watching_style (#192): the Night look's Keep watching as wide cards or poster tiles.
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import server


class KeepWatchingStyleTests(unittest.TestCase):
    def test_not_set_by_default(self):
        self.assertNotIn("keep_watching_style", config._home({}))
        self.assertNotIn("keep_watching_style", server.clean_settings({}))

    def test_home_config_keeps_card_and_poster(self):
        for style in ("card", "poster"):
            with self.subTest(style=style):
                self.assertEqual(config._home({"keep_watching_style": style})["keep_watching_style"], style)

    def test_synced_settings_keep_card_and_poster(self):
        for style in ("card", "poster"):
            with self.subTest(style=style):
                self.assertEqual(server.clean_settings({"keep_watching_style": style})["keep_watching_style"], style)

    def test_other_values_are_dropped(self):
        for bad in ("Poster", "posters", "", True, 1, None, ["poster"]):
            with self.subTest(bad=bad):
                self.assertNotIn("keep_watching_style", config._home({"keep_watching_style": bad}))
                self.assertNotIn("keep_watching_style", server.clean_settings({"keep_watching_style": bad}))


if __name__ == "__main__":
    unittest.main()
