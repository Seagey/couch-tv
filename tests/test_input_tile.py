"""home.input_tile: an Inputs tile first in the dock (#154), checked on the way through the home config."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "bridge"))
import config  # noqa: E402


class InputTileConfig(unittest.TestCase):
    def test_a_boolean_reaches_the_tv(self):
        self.assertIs(config._home({"input_tile": True})["input_tile"], True)
        self.assertIs(config._home({"input_tile": False})["input_tile"], False)

    def test_off_unless_set_and_junk_is_dropped(self):
        self.assertNotIn("input_tile", config._home({}))
        for junk in ("yes", 1, None, [], {}):
            self.assertNotIn("input_tile", config._home({"input_tile": junk}))


if __name__ == "__main__":
    unittest.main()
