"""scripts/check-tv.py on a Fire TV: it says, before anyone installs, that current Fire OS blocks the TV's own
ADB (so option C's phone remote cannot press keys or type) and points to option B. The builds named are the
ones docs/FIRE-TV-STICK.md and on-tv/README.md list. Nothing here touches a TV."""
import contextlib
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("check_tv", ROOT / "scripts" / "check-tv.py")
check_tv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_tv)


def facts(fire_os="", maker="Amazon", model="AFTMM"):
    return {"android": "9", "sdk": "28", "maker": maker, "model": model, "fire_os": fire_os, "tv": True,
            "home": "", "homes": [], "adb_wifi": "", "remote_service": ""}


def run_check(adb_facts):
    out = io.StringIO()
    with patch.object(check_tv, "knock", lambda ip, port, timeout=1.0: port == 5555), \
            patch.object(check_tv, "adb_facts", lambda ip: adb_facts), \
            patch.object(check_tv, "wireless_debugging_port", lambda ip: None), \
            patch.object(sys, "argv", ["check-tv.py", "192.0.2.9", "--adb"]), contextlib.redirect_stdout(out):
        check_tv.main()
    return out.getvalue()


class Blocks(unittest.TestCase):
    def test_the_builds_that_block_and_the_ones_just_before(self):
        for version, want in (("6.7.1.1", True), ("6.7.1.0", False), ("6.5.0.0", False),
                              ("7.6.6.9", True), ("7.7.1.7", True), ("7.6.6.8", False), ("7.3.2.0", False),
                              ("8.1.0.3", True), ("8.1.0.2", False), ("8.2.0.0", True), ("9.0.0.0", True)):
            self.assertIs(check_tv.fire_adb_blocks(version), want, version)

    def test_a_version_it_cannot_read_is_not_a_guess(self):
        for version in ("", "7", "junk", None, "7.6"):
            self.assertIsNone(check_tv.fire_adb_blocks(version), version)


class Verdict(unittest.TestCase):
    def test_a_build_that_blocks_says_so_and_points_to_option_b(self):
        text = run_check(facts("7.6.6.9"))
        self.assertIn("blocks the TV's own ADB", text)
        self.assertIn("option B", text)
        self.assertIn("C. Lives on the TV:         yes, but the phone remote cannot press keys or type", text)

    def test_an_older_build_may_still_allow_it(self):
        text = run_check(facts("7.3.2.0"))
        self.assertNotIn("blocks the TV's own ADB", text)
        self.assertIn("may still allow", text)
        self.assertIn("C. Lives on the TV:         yes\n", text)

    def test_an_unreadable_version_warns_that_recent_builds_block(self):
        text = run_check(facts(""))     # an Amazon TV that does not give the Fire OS version
        self.assertIn("Recent Fire OS builds block", text)
        self.assertIn("option B", text)

    def test_other_android_tvs_hear_nothing_about_fire(self):
        text = run_check(facts("", maker="Sony", model="BRAVIA"))
        self.assertNotIn("Fire", text)
        self.assertNotIn("option B", text.split("A. TV home only")[0])


if __name__ == "__main__":
    unittest.main()
