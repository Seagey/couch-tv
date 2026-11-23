import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import server


class StartFocusSettingsTests(unittest.TestCase):
    VALID_CHOICES = ("people", "apps", "keep_watching")

    def test_home_config_keeps_valid_choices(self):
        for choice in self.VALID_CHOICES:
            with self.subTest(choice=choice):
                self.assertEqual(config._home({"start_focus": choice})["start_focus"], choice)

    def test_home_config_ignores_invalid_choices(self):
        for choice in (True, False, 0, 1, "profile", "dock", "home", "", None):
            with self.subTest(choice=choice):
                self.assertNotIn("start_focus", config._home({"start_focus": choice}))

    def test_synced_settings_keep_valid_choices(self):
        for choice in self.VALID_CHOICES:
            with self.subTest(choice=choice):
                self.assertEqual(server.clean_settings({"start_focus": choice})["start_focus"], choice)

    def test_synced_settings_ignore_invalid_choices(self):
        for choice in (True, False, 0, 1, "profile", "dock", "home", "", None):
            with self.subTest(choice=choice):
                self.assertNotIn("start_focus", server.clean_settings({"start_focus": choice}))


if __name__ == "__main__":
    unittest.main()
