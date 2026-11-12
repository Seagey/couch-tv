"""LG Developer Mode health: the warning sentences from the countdown and the last good Extend."""
import json
import re
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import lg

CFG = {"id": "test", "name": "Test", "kind": "lg", "ip": "192.0.2.1"}


def make_tv(left=None, devmode=None, installed=True):
    d = Path(tempfile.mkdtemp())
    t = lg.LGTV(dict(CFG))
    t.devleft_file, t.devmode_file = str(d / "left.json"), str(d / "devmode.json")
    if left is not None:
        (d / "left.json").write_text(json.dumps(left))
    if devmode is not None:
        (d / "devmode.json").write_text(json.dumps(devmode))
    t.launch_points = [{"id": t.app_id if installed else "netflix"}, {"id": "youtube.leanback.v4"}]
    return t


def iso(seconds_ago=0):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - seconds_ago))


class Warning(unittest.TestCase):
    def test_plenty_left_says_nothing(self):
        t = make_tv(left={"hours": 990.0, "hours_at": iso(3600), "at": iso(3600)})
        self.assertIsNone(t.devmode_warning())
        self.assertEqual(t.devmode_status()["hours_left"], 990.0)

    def test_not_installed_is_an_alert(self):
        t = make_tv(installed=False)
        self.assertEqual(t.devmode_warning()[0], "alert")

    def test_under_a_week_is_an_alert(self):
        t = make_tv(left={"hours": 100.0, "hours_at": iso(0), "at": iso(0)})
        level, text = t.devmode_warning()
        self.assertEqual(level, "alert")
        self.assertIn("4 days", text)

    def test_extends_not_working_is_a_warning(self):
        t = make_tv(left={"hours": 850.0, "hours_at": iso(0), "at": iso(0)})
        self.assertEqual(t.devmode_warning()[0], "warn")

    def test_countdown_keeps_running_since_it_was_read(self):
        t = make_tv(left={"hours": 200.0, "hours_at": iso(48 * 3600), "at": iso(48 * 3600)})
        self.assertEqual(t.devmode_warning()[0], "alert")   # 152 h left now

    def test_no_countdown_and_no_extend_for_days(self):
        t = make_tv(devmode={"ok": False, "at": iso(0), "last_ok_at": iso(4 * 86400)})
        self.assertEqual(t.devmode_warning()[0], "warn")

    def test_no_countdown_recent_extend_says_nothing(self):
        t = make_tv(devmode={"ok": True, "at": iso(3600)})
        self.assertIsNone(t.devmode_warning())

    def test_extend_switched_off_only_warns_about_the_app(self):
        t = make_tv(left={"hours": 10.0, "hours_at": iso(0), "at": iso(0)})
        t.extend_devmode = False
        self.assertIsNone(t.devmode_warning())


class Translatable(unittest.TestCase):
    """The warning also goes out as a key and numbers, and every language has the four sentences."""

    def test_status_has_the_key_and_numbers(self):
        t = make_tv(left={"hours": 100.0, "hours_at": iso(0), "at": iso(0)})
        st = t.devmode_status()
        self.assertEqual((st["level"], st["warning_key"], st["warning_vars"]), ("alert", "devmode_runs_out", {"days": 4}))
        self.assertIn("4 days", st["warning"])

    def test_no_warning_no_key(self):
        st = make_tv(devmode={"ok": True, "at": iso(3600)}).devmode_status()
        self.assertIsNone(st["warning"])
        self.assertIsNone(st["warning_key"])

    def test_every_language_has_the_sentences(self):
        root = Path(__file__).parents[1]
        for f in ("tv-home/web/i18n.js", "remote/src/i18n.js"):
            src = (root / f).read_text()
            for key, english in lg.LGTV.DEVMODE_WARNINGS.items():
                found = re.findall(r"\b%s: ['\"](.+?)['\"],\n" % key, src)
                langs = 10 if f.startswith("tv-home") else 7
                self.assertEqual(len(found), langs, (f, key))
                self.assertEqual(found[0], english, (f, key))   # en comes first, same words as the bridge
                for said in found:
                    self.assertEqual(set(re.findall(r"\{\w+\}", said)), set(re.findall(r"\{\w+\}", english)), (f, key, said))


if __name__ == "__main__":
    unittest.main()
