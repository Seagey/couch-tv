"""home.loop, built by the bridge from tv-home/web/loop at load, and "loop" as a look (docs/LOOP.md)."""
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config


def touch(folder, *names):
    os.makedirs(folder, exist_ok=True)
    for n in names:
        with open(os.path.join(folder, n), "wb") as f:
            f.write(b"\x00" * 16)


class LoopLook(unittest.TestCase):
    def test_loop_is_a_look(self):
        self.assertEqual(config._home({"look": "loop"})["look"], "loop")
        self.assertIn("loop", config.LOOKS)

    def test_the_other_looks_and_the_default_are_unchanged(self):
        for look in ("night", "classic", "oled"):
            self.assertEqual(config._home({"look": look})["look"], look)
        self.assertEqual(config._home({})["look"], "night")
        self.assertEqual(config._home({"look": "disco"})["look"], "night")


class LoopFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.folder = os.path.join(self.tmp, "loop")

    def test_missing_folder_gives_an_empty_list_and_no_blur(self):
        self.assertEqual(config.loop_files(self.folder), {"variants": [], "blur": False})

    def test_empty_folder_is_the_same(self):
        os.makedirs(self.folder)
        self.assertEqual(config.loop_files(self.folder), {"variants": [], "blur": False})

    def test_variants_in_the_time_of_day_order_whatever_is_present(self):
        touch(self.folder, "night.mp4", "dawn.mp4", "night-blur.mp4", "dawn-blur.mp4", "dawn.jpg")
        self.assertEqual(config.loop_files(self.folder), {"variants": ["dawn", "night"], "blur": True})
        touch(self.folder, "day.mp4", "dusk.mp4", "day-blur.mp4", "dusk-blur.mp4")
        self.assertEqual(config.loop_files(self.folder)["variants"], ["dawn", "day", "dusk", "night"])

    def test_blur_only_when_every_present_variant_has_its_copy(self):
        touch(self.folder, "day.mp4", "day-blur.mp4", "night.mp4")
        self.assertEqual(config.loop_files(self.folder), {"variants": ["day", "night"], "blur": False})
        touch(self.folder, "night-blur.mp4")
        self.assertEqual(config.loop_files(self.folder)["blur"], True)
        # a blur copy with no sharp file is not a variant and does not count
        touch(self.folder, "dusk-blur.mp4")
        self.assertEqual(config.loop_files(self.folder), {"variants": ["day", "night"], "blur": True})

    def test_only_the_four_names_count(self):
        touch(self.folder, "noon.mp4", "day.mp4.bak", "day-blur.mp4", "day.mov")
        self.assertEqual(config.loop_files(self.folder), {"variants": [], "blur": False})

    def test_home_carries_it_whatever_the_look(self):
        old = config.LOOP_DIR
        config.LOOP_DIR = self.folder
        try:
            self.assertEqual(config._home({"look": "night"})["loop"], {"variants": [], "blur": False})
            touch(self.folder, "dusk.mp4", "dusk-blur.mp4")
            self.assertEqual(config._home({"look": "loop"})["loop"], {"variants": ["dusk"], "blur": True})
            # config.json cannot set it: the files decide
            self.assertEqual(config._home({"look": "loop", "loop": {"variants": ["day"], "blur": False}})["loop"],
                             {"variants": ["dusk"], "blur": True})
        finally:
            config.LOOP_DIR = old

    def test_the_real_folder_is_under_the_launcher(self):
        self.assertEqual(config.LOOP_DIR, os.path.join(config.ROOT, "tv-home", "web", "loop"))
        self.assertIn("loop", config.HOME)


if __name__ == "__main__":
    unittest.main()
