import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import server


class IdlePhotoSettingsTests(unittest.TestCase):
    DELAYS = (0, 5, 10, 15, 30, 60)

    def test_home_config_keeps_supported_delays(self):
        for seconds in self.DELAYS:
            with self.subTest(seconds=seconds):
                self.assertEqual(config._home({"idle_photo_seconds": seconds})["idle_photo_seconds"], seconds)

    def test_home_config_ignores_unsupported_delays(self):
        for seconds in (True, False, "5", 1, 7, 120):
            with self.subTest(seconds=seconds):
                self.assertNotIn("idle_photo_seconds", config._home({"idle_photo_seconds": seconds}))

    def test_synced_settings_keep_supported_delays(self):
        for seconds in self.DELAYS:
            with self.subTest(seconds=seconds):
                self.assertEqual(server.clean_settings({"idle_photo_seconds": seconds})["idle_photo_seconds"], seconds)

    def test_synced_settings_ignore_unsupported_delays(self):
        for seconds in (True, False, "5", 1, 7, 120):
            with self.subTest(seconds=seconds):
                self.assertNotIn("idle_photo_seconds", server.clean_settings({"idle_photo_seconds": seconds}))


if __name__ == "__main__":
    unittest.main()

