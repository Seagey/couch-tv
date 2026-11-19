"""home.app_keys: remote buttons that open an app (KeyWatch.kt), checked on the way through the home config."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "bridge"))
import config  # noqa: E402


class AppKeysConfig(unittest.TestCase):
    def test_keeps_the_three_forms(self):
        keys = ["KEYCODE_BUTTON_3:org.smarttube.stable", "190:com.google.android.youtube.tv", "scan384:com.stremio.one"]
        self.assertEqual(config._home({"app_keys": keys})["app_keys"], keys)

    def test_gear_is_a_target_too(self):
        keys = ["scan66:gear", "KEYCODE_F8:gear", "138:gear"]
        self.assertEqual(config._home({"app_keys": keys})["app_keys"], keys)
        self.assertNotIn("app_keys", config._home({"app_keys": ["scan66:Gear", "scan66:gear.x;y", "scan66:gears"]}))

    def test_drops_bad_entries(self):
        out = config._home({"app_keys": ["KEYCODE_F4:ok.pkg", "F4:ok.pkg", "KEYCODE_F4:", "KEYCODE_F4:bad pkg; rm", 7, "x"]})
        self.assertEqual(out["app_keys"], ["KEYCODE_F4:ok.pkg"])

    def test_leaves_it_out_when_empty_or_not_a_list(self):
        self.assertNotIn("app_keys", config._home({}))
        self.assertNotIn("app_keys", config._home({"app_keys": []}))
        self.assertNotIn("app_keys", config._home({"app_keys": "KEYCODE_F4:ok.pkg"}))
        self.assertNotIn("app_keys", config._home({"app_keys": ["nope"]}))


if __name__ == "__main__":
    unittest.main()
