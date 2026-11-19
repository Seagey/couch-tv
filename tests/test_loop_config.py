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



def without_version(d):
    return {k: v for k, v in d.items() if k != "version"}

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
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": [], "blur": False})

    def test_empty_folder_is_the_same(self):
        os.makedirs(self.folder)
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": [], "blur": False})

    def test_variants_in_the_time_of_day_order_whatever_is_present(self):
        touch(self.folder, "night.mp4", "dawn.mp4", "night-blur.mp4", "dawn-blur.mp4", "dawn.jpg")
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": ["dawn", "night"], "blur": True})
        touch(self.folder, "day.mp4", "dusk.mp4", "day-blur.mp4", "dusk-blur.mp4")
        self.assertEqual(config.loop_files(self.folder)["variants"], ["dawn", "day", "dusk", "night"])

    def test_blur_only_when_every_present_variant_has_its_copy(self):
        touch(self.folder, "day.mp4", "day-blur.mp4", "night.mp4")
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": ["day", "night"], "blur": False})
        touch(self.folder, "night-blur.mp4")
        self.assertEqual(config.loop_files(self.folder)["blur"], True)
        # a blur copy with no sharp file is not a variant and does not count
        touch(self.folder, "dusk-blur.mp4")
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": ["day", "night"], "blur": True})

    def test_only_the_four_names_count(self):
        touch(self.folder, "noon.mp4", "day.mp4.bak", "day-blur.mp4", "day.mov")
        self.assertEqual(without_version(config.loop_files(self.folder)), {"variants": [], "blur": False})

    def test_home_carries_it_whatever_the_look(self):
        old = config.LOOP_DIR
        config.LOOP_DIR = self.folder
        try:
            self.assertEqual(without_version(config._home({"look": "night"})["loop"]), {"variants": [], "blur": False})
            touch(self.folder, "dusk.mp4", "dusk-blur.mp4")
            self.assertEqual(without_version(config._home({"look": "loop"})["loop"]), {"variants": ["dusk"], "blur": True})
            # config.json cannot set it: the files decide
            self.assertEqual(without_version(config._home({"look": "loop", "loop": {"variants": ["day"], "blur": False}})["loop"]),
                             {"variants": ["dusk"], "blur": True})
        finally:
            config.LOOP_DIR = old

    def test_the_real_folder_is_under_the_launcher(self):
        self.assertEqual(config.LOOP_DIR, os.path.join(config.ROOT, "tv-home", "web", "loop"))
        self.assertIn("loop", config.HOME)


if __name__ == "__main__":
    unittest.main()


class LoopVersion(unittest.TestCase):
    def setUp(self):
        import tempfile, shutil
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)

    def test_version_is_empty_with_no_variants_and_changes_with_the_files(self):
        import os, time
        self.assertEqual(config.loop_files(self.folder)["version"], "")
        touch(self.folder, "day.mp4", "day-blur.mp4")
        v1 = config.loop_files(self.folder)["version"]
        self.assertRegex(v1, r"^[0-9a-f]{10}$")
        self.assertEqual(config.loop_files(self.folder)["version"], v1, "the same files give the same mark")
        with open(os.path.join(self.folder, "day.mp4"), "a") as f:
            f.write("x")
        os.utime(os.path.join(self.folder, "day.mp4"), (time.time() + 5, time.time() + 5))
        self.assertNotEqual(config.loop_files(self.folder)["version"], v1, "a new file gives a new mark")

    def test_public_reads_the_loop_folder_afresh(self):
        from unittest.mock import patch
        with patch.object(config, "LOOP_DIR", self.folder):
            self.assertEqual(config.public()["home"]["loop"]["variants"], [])
            touch(self.folder, "night.mp4")
            self.assertEqual(config.public()["home"]["loop"]["variants"], ["night"], "no restart needed after make-loop.sh")
