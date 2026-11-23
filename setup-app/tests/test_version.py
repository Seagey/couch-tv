"""The Setup app said version 0.0.0 (PyInstaller's default) in Finder and in Windows' file details.
Its version is the couch-tv release it comes with, and the build stamps it in (stamp_version.py)."""
import os
import plistlib
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)

import couchtv_setup  # noqa: E402
import stamp_version  # noqa: E402


class VersionTests(unittest.TestCase):
    def test_a_real_version_not_zero(self):
        self.assertRegex(couchtv_setup.__version__, r"^\d+\.\d+\.\d+$")
        self.assertNotEqual(couchtv_setup.__version__, "0.0.0")

    def test_same_as_the_tv_home_release(self):
        gradle = os.path.join(APP, "..", "tv-home", "android", "app", "build.gradle.kts")
        if not os.path.exists(gradle):
            self.skipTest("not in the couch-tv repo")
        with open(gradle) as f:
            name = re.search(r'versionName = "([^"]+)"', f.read()).group(1)
        self.assertEqual(couchtv_setup.__version__, name)

    def test_mac_plist_is_stamped(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "Info.plist")
            with open(p, "wb") as f:
                plistlib.dump({"CFBundleShortVersionString": "0.0.0", "CFBundleVersion": "0.0.0", "LSUIElement": True}, f)
            stamp_version.mac_plist(p)
            with open(p, "rb") as f:
                info = plistlib.load(f)
        self.assertEqual(info["CFBundleShortVersionString"], couchtv_setup.__version__)
        self.assertEqual(info["CFBundleVersion"], couchtv_setup.__version__)
        self.assertTrue(info["LSUIElement"])

    def test_windows_file_details(self):
        text = stamp_version.windows_file("0.13.5")
        self.assertIn("filevers=(0, 13, 5, 0)", text)
        self.assertIn("StringStruct('ProductVersion', '0.13.5')", text)
        compile(text.split("\n", 1)[1], "version.txt", "eval")   # PyInstaller reads it as one Python expression

    def test_the_build_stamps_it(self):
        with open(os.path.join(APP, "..", ".github", "workflows", "setup-app.yml")) as f:
            wf = f.read()
        self.assertIn("--version-file version.txt", wf)
        self.assertLess(wf.index("stamp_version.py mac-plist"), wf.index("codesign --force"))


if __name__ == "__main__":
    unittest.main()
