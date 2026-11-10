"""home.hi_res false: a 4K screen keeps the 1080 pictures, and the LG app leaves the 4K copies out.

Seen on an LG 43SQ700S monitor (webOS 22): a 4K panel with a chip that struggles with the
3840x2160 copies of every photo.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "bridge"))
import config  # noqa: E402

BUILD = """
import sys
sys.path.insert(0, {lg!r})
import build
build.OUT = {out!r}
sys.argv = ["build.py", "--bridge", "http://192.0.2.20:5400"]
build.main()
"""


class HiResConfig(unittest.TestCase):
    def test_passes_a_boolean_through(self):
        self.assertIs(config._home({"hi_res": False})["hi_res"], False)
        self.assertIs(config._home({"hi_res": True})["hi_res"], True)

    def test_leaves_anything_else_out(self):
        self.assertNotIn("hi_res", config._home({}))
        self.assertNotIn("hi_res", config._home({"hi_res": "no"}))
        self.assertNotIn("hi_res", config._home({"hi_res": 0}))


class LgPackage(unittest.TestCase):
    def build(self, home):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        with open(ROOT / "config.example.json") as f:
            cfg = json.load(f)
        cfg["tvs"] = [{"id": "lounge", "name": "Lounge", "kind": "lg", "ip": "192.0.2.10"}]
        cfg["home"] = dict(cfg.get("home") or {}, **home)
        path = os.path.join(tmp, "config.json")
        with open(path, "w") as f:
            json.dump(cfg, f)
        out = os.path.join(tmp, "out")
        env = dict(os.environ, COUCH_CONFIG=path)
        subprocess.run([sys.executable, "-c", BUILD.format(lg=str(ROOT / "lg"), out=out)],
                       env=env, check=True, capture_output=True, cwd=str(ROOT))
        app = os.path.join(out, "app", "backgrounds")
        return [n for n in os.listdir(app) if "@2x" in n]

    def test_4k_copies_are_packed_by_default(self):
        self.assertTrue(self.build({}))

    def test_4k_copies_are_left_out_with_hi_res_false(self):
        self.assertEqual(self.build({"hi_res": False}), [])


if __name__ == "__main__":
    unittest.main()
