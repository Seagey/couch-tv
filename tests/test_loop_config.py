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
    """variants and blur only: the version mark, loop.json and the cut-outs have their own tests below"""
    return {k: v for k, v in d.items() if k not in ("version", "meta", "fg")}

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


GOOD = {"still": True, "seconds": 34, "fps": 30, "zoom": 0.06, "sway": 0.3, "fg": {"x": 480, "y": 162, "w": 960, "h": 318}}


class LoopMeta(unittest.TestCase):
    """loop.json and the cut-outs (docs/LOOP.md, the depth effect): meta when sound, fg only when complete."""

    def setUp(self):
        import tempfile, shutil
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        config._loop_json_told.clear()

    def write(self, obj):
        import json
        with open(os.path.join(self.folder, "loop.json"), "w", encoding="utf-8") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj))

    def test_no_loop_json_no_meta_and_no_fg(self):
        touch(self.folder, "day.mp4", "day-fg.png")
        out = config.loop_files(self.folder)
        self.assertIsNone(out["meta"])
        self.assertIs(out["fg"], False)

    def test_a_sound_loop_json_is_passed_on(self):
        touch(self.folder, "day.mp4", "night.mp4")
        self.write(GOOD)
        self.assertEqual(config.loop_files(self.folder)["meta"], GOOD)
        self.write(dict(GOOD, fg=None, still=False, zoom=0, sway=0, seconds=15))
        self.assertEqual(config.loop_files(self.folder)["meta"]["fg"], None)

    def test_fg_only_when_meta_has_a_rectangle_and_every_variant_its_png(self):
        touch(self.folder, "day.mp4", "night.mp4", "day-fg.png")
        self.write(GOOD)
        self.assertIs(config.loop_files(self.folder)["fg"], False, "night has no cut-out")
        touch(self.folder, "night-fg.png")
        self.assertIs(config.loop_files(self.folder)["fg"], True)
        self.write(dict(GOOD, fg=None))
        self.assertIs(config.loop_files(self.folder)["fg"], False, "a run without --matte: no depth")
        # a cut-out with no video is not a variant and does not count
        self.write(GOOD)
        touch(self.folder, "dusk-fg.png")
        self.assertIs(config.loop_files(self.folder)["fg"], True)

    def test_fg_needs_variants(self):
        touch(self.folder, "day-fg.png")
        self.write(GOOD)
        self.assertIs(config.loop_files(self.folder)["fg"], False)

    def test_anything_out_of_range_is_ignored_with_one_log_line(self):
        touch(self.folder, "day.mp4", "day-fg.png")
        bad = [
            "not json", "[1, 2]", dict(GOOD, seconds=14), dict(GOOD, seconds=61), dict(GOOD, seconds="34"),
            dict(GOOD, fps=60), dict(GOOD, fps=True), dict(GOOD, zoom=0.3), dict(GOOD, zoom=-0.01),
            dict(GOOD, sway=1.01), dict(GOOD, sway=-0.1), dict(GOOD, still="yes"),
            {k: v for k, v in GOOD.items() if k != "sway"}, dict({k: v for k, v in GOOD.items() if k != "sway"}, drift=0.006), {k: v for k, v in GOOD.items() if k != "still"},
            dict(GOOD, fg={"x": 480, "y": 162, "w": 960}), dict(GOOD, fg={"x": 480.5, "y": 162, "w": 960, "h": 318}),
            dict(GOOD, fg={"x": 1000, "y": 162, "w": 960, "h": 318}), dict(GOOD, fg={"x": 0, "y": 900, "w": 960, "h": 318}),
            dict(GOOD, fg={"x": -3, "y": 162, "w": 960, "h": 318}), dict(GOOD, fg={"x": 0, "y": 0, "w": 0, "h": 318}),
            dict(GOOD, fg={"x": True, "y": 162, "w": 960, "h": 318}), dict(GOOD, fg=[480, 162, 960, 318]),
        ]
        import time
        for i, b in enumerate(bad):
            self.write(b)
            t = time.time() + i + 1
            os.utime(os.path.join(self.folder, "loop.json"), (t, t))   # each a new version of the file
            with self.assertLogs("config", level="WARNING") as logs:
                out = config.loop_files(self.folder)
            self.assertIsNone(out["meta"], b)
            self.assertIs(out["fg"], False, b)
            self.assertEqual(len(logs.output), 1, b)
            self.assertIn("loop.json", logs.output[0])
            # the same file read again (every config.js request): no second line
            with self.assertNoLogs("config", level="WARNING"):
                config.loop_files(self.folder)

    def test_the_edges_of_the_ranges_are_accepted(self):
        touch(self.folder, "day.mp4")
        for ok in (dict(GOOD, seconds=15), dict(GOOD, seconds=60), dict(GOOD, zoom=0, sway=0), dict(GOOD, zoom=0.2, sway=1),
                   dict(GOOD, fg={"x": 0, "y": 0, "w": 1920, "h": 1080})):
            self.write(ok)
            self.assertEqual(config.loop_files(self.folder)["meta"], ok)

    def test_unknown_keys_are_left_out(self):
        touch(self.folder, "day.mp4")
        self.write(dict(GOOD, extra="x", fg=dict(GOOD["fg"], z=1)))
        self.assertEqual(config.loop_files(self.folder)["meta"], GOOD)

    def test_the_version_follows_loop_json_and_the_cut_outs(self):
        import time
        touch(self.folder, "day.mp4")
        v0 = config.loop_files(self.folder)["version"]
        self.write(GOOD)
        v1 = config.loop_files(self.folder)["version"]
        self.assertNotEqual(v1, v0, "loop.json counts")
        touch(self.folder, "day-fg.png")
        v2 = config.loop_files(self.folder)["version"]
        self.assertNotEqual(v2, v1, "a cut-out counts")
        with open(os.path.join(self.folder, "day-fg.png"), "ab") as f:
            f.write(b"x")
        os.utime(os.path.join(self.folder, "day-fg.png"), (time.time() + 5, time.time() + 5))
        self.assertNotEqual(config.loop_files(self.folder)["version"], v2, "a new cut-out gives a new mark")

    def test_public_carries_meta_and_fg(self):
        from unittest.mock import patch
        touch(self.folder, "night.mp4", "night-fg.png")
        self.write(GOOD)
        with patch.object(config, "LOOP_DIR", self.folder):
            loop = config.public()["home"]["loop"]
        self.assertEqual(loop["meta"], GOOD)
        self.assertIs(loop["fg"], True)


class Staging(unittest.TestCase):
    """make-loop.sh makes a run's files in <folder>/.staging-<pid>/, every name there starting with a dot,
    and moves them in at the end: nothing there, and no dotfile or temp name, is listed, versioned or read."""

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder, True)
        config._loop_json_told.clear()

    def stage(self):
        stage = os.path.join(self.folder, ".staging-4242")
        names = [v + s for v in config.LOOP_VARIANTS for s in (".mp4", "-blur.mp4", ".jpg", "-blur.jpg", "-fg.png")]
        touch(stage, *names, *["." + n for n in names])
        import json
        for name in ("loop.json", ".loop.json"):
            with open(os.path.join(stage, name), "w", encoding="utf-8") as f:
                json.dump(GOOD, f)
        return stage

    def test_a_run_under_way_is_not_listed(self):
        empty = config.loop_files(self.folder)
        self.stage()
        self.assertEqual(config.loop_files(self.folder), empty)
        self.assertEqual(config.loop_files(self.folder),
                         {"variants": [], "blur": False, "version": "", "meta": None, "fg": False})

    def test_dotfiles_and_temp_names_are_not_variants(self):
        touch(self.folder, ".dawn.mp4", ".dawn-blur.mp4", "dawn.mp4.part", "dawn.part.mp4", ".new-day.mp4",
              "day.mp4.tmp", "dusk.mp4~", ".night.mp4", ".night-fg.png", ".loop.json")
        out = config.loop_files(self.folder)
        self.assertEqual((out["variants"], out["blur"], out["meta"], out["fg"], out["version"]), ([], False, None, False, ""))

    def test_staged_files_do_not_change_the_version_or_the_meta_of_the_files_in_place(self):
        import json
        touch(self.folder, "day.mp4", "day-blur.mp4", "day-fg.png")
        with open(os.path.join(self.folder, "loop.json"), "w", encoding="utf-8") as f:
            json.dump(dict(GOOD, seconds=20), f)
        before = config.loop_files(self.folder)
        self.stage()
        touch(self.folder, ".day.mp4", ".loop.json")
        after = config.loop_files(self.folder)
        self.assertEqual(after, before)
        self.assertEqual(after["meta"]["seconds"], 20, "the loop.json in place, not the staged one")


if __name__ == "__main__":
    unittest.main()
