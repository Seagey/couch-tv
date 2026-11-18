"""home.render_height: the home is drawn at a lower resolution and scaled up by the TV.

Seen on an XGIMI Elfin Flip Plus (MediaTek, Mali-G52, 1.7 GB, Android 11): the 1080p WebView reached
the screen at 30 fps in every look, and at 720p at 60 fps.
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "bridge"))
import config  # noqa: E402


class RenderHeightConfig(unittest.TestCase):
    def test_passes_a_sensible_height_through(self):
        self.assertEqual(config._home({"render_height": 720})["render_height"], 720)
        self.assertEqual(config._home({"render_height": 360})["render_height"], 360)

    def test_leaves_anything_else_out(self):
        for bad in (None, True, "720", 720.5, 0, 100, 5000, -1):
            self.assertNotIn("render_height", config._home({"render_height": bad}), repr(bad))
        self.assertNotIn("render_height", config._home({}))


if __name__ == "__main__":
    unittest.main()
