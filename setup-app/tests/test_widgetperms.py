"""Widget permissions (lane F, 28 Nov 2026) against a pretend TV: every switch starts off, each is given and taken back for
Couch TV's own home app only, a refusal is reported and undone, Android 11 and older asks nothing for Batteries, the doorbell card
survives Setup's home install, Undo puts every default back, and nothing from the page reaches the TV's shell."""
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import steps, widgetperms  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import FakeTv  # noqa: E402

PKG = steps.HOME_PKG


class PermTv(FakeTv):
    """FakeTv that keeps app ops, runtime grants and the record file for the home app."""

    def __init__(self, *a, refuse=(), installed=True, **kw):
        super().__init__(*a, **kw)
        if installed:
            self.packages.add(PKG)
        self.ops = {}
        self.grants = set()
        self.refuse = set(refuse)
        self.record = None

    def _one(self, c):
        m = re.match(r"appops get (\S+) (\S+)$", c)
        if m:
            return f"{m.group(2)}: {self.ops.get((m.group(1), m.group(2)), 'default')}; time=+1d"
        m = re.match(r"appops set (\S+) (\S+) (\S+)$", c)
        if m:
            if m.group(2) not in self.refuse:
                self.ops[(m.group(1), m.group(2))] = m.group(3)
            return ""
        m = re.match(r"pm (grant|revoke) (\S+) (\S+)$", c)
        if m:
            if m.group(3) not in self.refuse:
                (self.grants.add if m.group(1) == "grant" else self.grants.discard)((m.group(2), m.group(3)))
            return ""
        m = re.match(r"dumpsys package (\S+) \| grep (\S+)$", c)
        if m:
            return f"      {m.group(2)}: granted={'true' if (m.group(1), m.group(2)) in self.grants else 'false'}"
        if c == "getprop ro.build.version.sdk":
            return str(self.sdk)
        if c.startswith("pm list packages " + PKG):
            return "package:" + PKG if PKG in self.packages else ""
        if c.startswith("cat " + widgetperms.RECORD_FILE):
            return self.record or ""
        if c.startswith("mkdir -p"):
            return ""
        if c.startswith("printf") and widgetperms.RECORD_FILE in c:
            self.record = " ".join(re.search(r"printf '%s\\n' (.*) >", c).group(1).split())
            return ""
        if c == "rm -f " + widgetperms.RECORD_FILE:
            self.record = None
            return ""
        return super()._one(c)


def changes(tv):
    return [c for c in tv.log if c.startswith(("appops set", "pm grant", "pm revoke"))]


class WidgetPerms(unittest.TestCase):
    def test_all_off_until_asked_and_nothing_asked_changes_nothing(self):
        tv = PermTv()
        s = widgetperms.state(tv)
        self.assertTrue(s["installed"])
        self.assertEqual([x["id"] for x in s["switches"]], ["doorbell", "screentime", "battery"])
        self.assertTrue(all(not x["on"] for x in s["switches"]))
        r = widgetperms.apply(tv, {})
        self.assertEqual(r["results"], {})
        self.assertEqual(changes(tv), [])

    def test_each_is_given_to_the_home_app_only_and_read_back(self):
        tv = PermTv()
        r = widgetperms.apply(tv, {"doorbell": True, "screentime": True, "battery": True})
        self.assertEqual({k: v["status"] for k, v in r["results"].items()}, {"doorbell": "done", "screentime": "done", "battery": "done"})
        self.assertEqual(tv.ops[(PKG, "SYSTEM_ALERT_WINDOW")], "allow")
        self.assertEqual(tv.ops[(PKG, "GET_USAGE_STATS")], "allow")
        self.assertIn((PKG, "android.permission.BLUETOOTH_CONNECT"), tv.grants)
        self.assertTrue(all(PKG in c for c in changes(tv)), "never another app")
        self.assertTrue(all(x["on"] for x in r["state"]["switches"]))
        self.assertEqual(tv.record, "doorbell screentime battery")

    def test_off_puts_androids_default_back(self):
        tv = PermTv()
        widgetperms.apply(tv, {"doorbell": True, "battery": True})
        widgetperms.apply(tv, {"doorbell": False, "battery": False})
        self.assertEqual(tv.ops[(PKG, "SYSTEM_ALERT_WINDOW")], "default")
        self.assertNotIn((PKG, "android.permission.BLUETOOTH_CONNECT"), tv.grants)
        self.assertIsNone(tv.record)

    def test_a_tv_that_refuses_says_so_and_is_left_as_it_was(self):
        tv = PermTv(refuse={"GET_USAGE_STATS"})
        r = widgetperms.apply(tv, {"screentime": True})
        self.assertEqual(r["results"]["screentime"]["status"], "refused")
        self.assertNotRegex(r["results"]["screentime"]["words"], "[–—]")
        self.assertFalse(r["state"]["switches"][1]["on"])

    def test_android_11_asks_nothing_for_batteries(self):
        tv = PermTv(sdk=30)
        s = widgetperms.state(tv)
        bat = [x for x in s["switches"] if x["id"] == "battery"][0]
        self.assertFalse(bat["needed"])
        r = widgetperms.apply(tv, {"battery": True})
        self.assertEqual(r["results"]["battery"]["status"], "not_needed")
        self.assertFalse([c for c in tv.log if "BLUETOOTH" in c and c.startswith("pm")])

    def test_not_installed_is_a_plain_error(self):
        tv = PermTv(installed=False)
        self.assertFalse(widgetperms.state(tv)["installed"])
        with self.assertRaises(TvError):
            widgetperms.apply(tv, {"doorbell": True})

    def test_the_doorbell_card_survives_the_home_install_and_undo_clears_all(self):
        tv = PermTv()
        widgetperms.apply(tv, {"doorbell": True, "screentime": True})
        tv.ops[(PKG, "SYSTEM_ALERT_WINDOW")] = "default"          # what the home install step does
        self.assertEqual(widgetperms.keep_after_install(tv), ["doorbell", "screentime"])
        self.assertEqual(tv.ops[(PKG, "SYSTEM_ALERT_WINDOW")], "allow")
        widgetperms.all_off(tv)
        self.assertEqual(tv.ops[(PKG, "SYSTEM_ALERT_WINDOW")], "default")
        self.assertEqual(tv.ops[(PKG, "GET_USAGE_STATS")], "default")
        self.assertIsNone(tv.record)
        self.assertEqual(widgetperms.keep_after_install(tv), [], "nothing turned on: nothing given back")

    def test_page_values_never_reach_the_shell(self):
        tv = PermTv()
        jobs = []
        run = lambda name, fn: jobs.append(fn(lambda *a: None)) or {"started": True}
        widgetperms.route("apply", {"doorbell": "x; reboot", "battery; reboot": True, "screentime": True}, tv, run)
        self.assertFalse([c for c in tv.log if "reboot" in c])
        self.assertEqual(list(jobs[0]["results"]), ["screentime"])
        with self.assertRaises(TvError):
            widgetperms.route("nope", {}, tv, run)

    def test_words_are_short_and_plain(self):
        for label, what in widgetperms.WORDS.values():
            for t in (label, what):
                self.assertNotRegex(t, "[–—]")
                self.assertLessEqual(len(t.split()), 14)


if __name__ == "__main__":
    unittest.main()
