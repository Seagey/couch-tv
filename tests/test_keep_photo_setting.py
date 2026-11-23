import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge"))
import config
import server


class KeepPhotoSettingTests(unittest.TestCase):
    def test_off_by_default(self):
        self.assertNotIn("keep_photo", config._home({}))
        self.assertNotIn("keep_photo", server.clean_settings({}))

    def test_home_config_keeps_booleans_only(self):
        self.assertIs(config._home({"keep_photo": True})["keep_photo"], True)
        self.assertIs(config._home({"keep_photo": False})["keep_photo"], False)
        for bad in ("yes", 1, None):
            with self.subTest(bad=bad):
                self.assertNotIn("keep_photo", config._home({"keep_photo": bad}))

    def test_synced_settings_keep_flag_and_pick(self):
        out = server.clean_settings({"keep_photo": True, "keep_photo_pick": "backgrounds/mine/a.jpg"})
        self.assertIs(out["keep_photo"], True)
        self.assertEqual(out["keep_photo_pick"], "backgrounds/mine/a.jpg")

    def test_synced_settings_drop_bad_values(self):
        out = server.clean_settings({"keep_photo": "yes", "keep_photo_pick": 5})
        self.assertNotIn("keep_photo", out)
        self.assertNotIn("keep_photo_pick", out)
        self.assertNotIn("keep_photo_pick", server.clean_settings({"keep_photo_pick": "x" * 301}))


if __name__ == "__main__":
    unittest.main()
