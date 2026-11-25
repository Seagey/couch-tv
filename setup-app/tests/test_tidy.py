"""The Tidy up your TV step against a pretend TV (faketv.py). No real TV, adb or network is used.
Checks: each switch, a TV that refuses, a crash half way, Undo all, removal, unset values, packages
the TV does not have, the protected list, and arguments that could be used to inject shell."""
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import steps, tidy  # noqa: E402
from couchtv_setup.privacylist import PRIVACY  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import AMBIENT, GOOGLE_HOME, WIZARD, FakeTv  # noqa: E402

# Only while this file's tests run: this is the one time.sleep every module shares, and left patched it made the
# other files' fakes answer at once (test_ui's "partial first look" failed in a full run and passed alone).
_SLEEP = mock.patch.object(steps.time, "sleep", lambda s: None)
setUpModule, tearDownModule = _SLEEP.start, _SLEEP.stop
APK = "/x/couch-tv-home.apk"
ANIM = list(tidy.SETTINGS)
ROOT = Path(HERE).parents[1]


def tv_with(*extra, kind="google", **kw):
    tv = FakeTv(kind, **kw)
    tv.packages |= set(extra)
    return tv


def sony():
    return tv_with("tv.samba.ssm", "com.sony.dtv.promos", "com.google.android.feedback")


def result(tv, **wants):
    return tidy.apply(tv, wants)["results"]


def disables(tv):
    return [c for c in tv.log if c.startswith("pm disable")]


def words_ok(test, text):
    test.assertLessEqual(len(text.split()), 14, text)
    test.assertNotIn("—", text)
    test.assertNotIn("–", text)
    test.assertNotRegex(text.lower(), r"faster|no ads|no tracking|google|samsung|sony|amazon|fire tv|alphonso|samba|tcl")


class Ads(unittest.TestCase):
    def test_off_until_asked_and_skipping_changes_nothing(self):
        tv = sony()
        before = list(tv.log)
        s = tidy.state(tv)
        self.assertTrue(all(not x["on"] for x in s["switches"]))
        self.assertEqual(result(tv), {})
        self.assertEqual(disables(tv), [])
        self.assertFalse([c for c in tv.log[len(before):] if c.startswith(("settings put", "settings delete", "pm enable", "pm disable"))])
        self.assertFalse(tidy.has_record(tv))

    def test_switches_off_only_what_the_tv_has_and_reads_back(self):
        tv = sony()
        r = result(tv, ads=True)["ads"]
        self.assertEqual(r["status"], "done")
        self.assertEqual(r["count"], 3)
        self.assertEqual(sorted(disables(tv)), sorted("pm disable-user --user 0 " + p for p in
                         ("tv.samba.ssm", "com.sony.dtv.promos", "com.google.android.feedback")))
        self.assertTrue({"tv.samba.ssm", "com.sony.dtv.promos"} <= tv.disabled)
        words_ok(self, r["words"])

    def test_packages_absent_means_no_switch_and_no_command(self):
        tv = FakeTv("android")
        tv.packages.discard("com.google.android.feedback")
        ids = [x["id"] for x in tidy.state(tv)["switches"]]
        self.assertNotIn("ads", ids)
        r = result(tv, ads=True)["ads"]
        self.assertEqual(r["status"], "unchanged")
        self.assertEqual(disables(tv), [])

    def test_never_uninstalls_and_uses_pm_disable_user_only(self):
        tv = sony()
        result(tv, ads=True, anim=True, idle=True)
        result(tv, ads=False, anim=False, idle=False)
        self.assertFalse([c for c in tv.log if "uninstall" in c or "pm clear" in c or "pm disable " in c or "rm -rf" in c])
        for c in disables(tv):
            self.assertTrue(c.startswith("pm disable-user --user 0 "), c)

    def test_a_refused_package_is_reported_and_not_recorded(self):
        tv = sony()
        tv.refuse_disable = {"tv.samba.ssm", "com.sony.dtv.promos", "com.google.android.feedback"}
        r = result(tv, ads=True)["ads"]
        self.assertEqual(r["status"], "refused")
        words_ok(self, r["words"])
        self.assertFalse(tidy.has_record(tv))
        self.assertEqual(tv.disabled, set())

    def test_partly_refused(self):
        tv = sony()
        tv.refuse_disable = {"tv.samba.ssm"}
        r = result(tv, ads=True)["ads"]
        self.assertEqual(r["status"], "partial")
        self.assertEqual((r["count"], r["refused"]), (2, 1))
        self.assertEqual(tidy.load(tv)["pkgs"].count("tv.samba.ssm"), 0)
        words_ok(self, r["words"])

    def test_off_switches_them_back_on(self):
        tv = sony()
        result(tv, ads=True)
        r = result(tv, ads=False)["ads"]
        self.assertEqual(r["status"], "off")
        self.assertEqual(tv.disabled, set())
        self.assertFalse(tidy.has_record(tv))

    def test_an_app_the_person_switched_on_again_is_not_touched(self):
        tv = sony()
        result(tv, ads=True)
        tv.disabled.discard("tv.samba.ssm")
        tv.log.clear()
        result(tv, ads=False)
        self.assertNotIn("pm enable tv.samba.ssm", tv.log)

    def test_an_app_already_off_before_is_not_ours(self):
        tv = sony()
        tv.disabled.add("tv.samba.ssm")
        result(tv, ads=True)
        result(tv, ads=False)
        self.assertIn("tv.samba.ssm", tv.disabled)    # was off before, stays off
        self.assertNotIn("com.sony.dtv.promos", tv.disabled)


class Protected(unittest.TestCase):
    def test_nothing_the_tv_or_couch_tv_needs(self):
        tv = tv_with()
        homes = {GOOGLE_HOME}
        for p in (GOOGLE_HOME, "com.google.android.tvlauncher", WIZARD, "app.couchtv.launcher", "dev.couchtv.ontv",
                  "com.google.android.tv.remote.service", "com.google.android.katniss", "com.google.android.apps.mediashell",
                  "com.google.android.gms", "com.android.vending", "com.google.android.tv.bluetooth", "com.tcl.update",
                  "com.vendor.ota", "com.example.systemupdater", "com.google.android.cast.thing", "com.android.phone",
                  "com.google.android.inputmethod.latin", "com.google.android.tvrecommendation", "bad name;reboot"):
            self.assertTrue(tidy.protected(tv, p, homes), p)

    def test_the_list_itself_has_none_of_them(self):
        tv = tv_with()
        homes = {GOOGLE_HOME}
        for p, kind in PRIVACY:
            self.assertFalse(tidy.protected(tv, p, homes), p)
            self.assertIn(kind, tidy.KIND_WORDS)
        self.assertNotIn(AMBIENT, [p for p, _ in PRIVACY])
        self.assertFalse(tidy.protected(tv, AMBIENT, homes))

    def test_a_listed_package_that_turns_out_to_be_a_home_or_persistent_is_skipped(self):
        tv = tv_with("com.sony.dtv.promos", "tv.samba.ssm")
        tv.other_homes = ["com.sony.dtv.promos"]        # this one is a home screen on this TV
        r = result(tv, ads=True)["ads"]
        self.assertNotIn("pm disable-user --user 0 com.sony.dtv.promos", tv.log)
        self.assertEqual(r["count"], 1)

    def test_never_a_package_with_the_persistent_flag(self):
        tv = tv_with("com.android.phone")
        self.assertTrue(tidy.protected(tv, "com.android.phone", set()))

    def test_list_matches_the_sourced_list_in_tv_home(self):
        f = ROOT / "tv-home" / "tools" / "privacy-list.txt"
        if not f.exists():
            self.skipTest("tv-home is not shipped with this copy")
        src = [l.split("|")[0].strip() for l in f.read_text().splitlines() if l.strip() and not l.lstrip().startswith("#")]
        self.assertEqual(src, [p for p, _ in PRIVACY])


class Animations(unittest.TestCase):
    def test_sets_all_three_to_half_and_reads_back(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        r = result(tv, anim=True)["anim"]
        self.assertEqual(r["status"], "done")
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "0.5" for n in ANIM})
        words_ok(self, r["words"])
        self.assertTrue(next(x for x in tidy.state(tv)["switches"] if x["id"] == "anim")["on"])

    def test_the_old_value_is_on_the_computer_before_the_change(self):
        tv = FakeTv("google")
        tv.settings = {"window_animation_scale": "1.5"}
        seen = {}
        real = tv.shell

        def spy(cmd, timeout_s=60):
            if cmd.startswith("settings put global window_animation_scale") and not seen:
                seen.update(json.loads((Path(os.environ["COUCHTV_SETUP_HOME"]) / "tidy.json").read_text())[steps.serial(tv)])
            return real(cmd, timeout_s)
        tv.shell = spy
        result(tv, anim=True)
        self.assertEqual(seen["settings"]["window_animation_scale"], {"prev": "1.5", "set": "0.5"})
        self.assertEqual(seen["settings"]["animator_duration_scale"], {"prev": "UNSET", "set": "0.5"})

    def test_unset_values_are_deleted_again_not_set_to_one(self):
        tv = FakeTv("google")
        tv.settings = {"window_animation_scale": "1.0"}      # the other two are unset
        result(tv, anim=True)
        result(tv, anim=False)
        self.assertEqual(tv.settings, {"window_animation_scale": "1.0"})
        self.assertIn("settings delete global animator_duration_scale", tv.log)
        self.assertNotIn("settings put global animator_duration_scale 1.0", tv.log)

    def test_previous_value_not_one_is_restored_exactly(self):
        tv = FakeTv("google")
        tv.settings = {"window_animation_scale": "1.5", "transition_animation_scale": "0", "animator_duration_scale": "2.0"}
        result(tv, anim=True)
        result(tv, anim=False)
        self.assertEqual(tv.settings, {"window_animation_scale": "1.5", "transition_animation_scale": "0", "animator_duration_scale": "2.0"})

    def test_a_setting_changed_since_is_never_overwritten(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        result(tv, anim=True)
        tv.settings["transition_animation_scale"] = "0.0"       # the person changed this one
        r = result(tv, anim=False)["anim"]
        self.assertEqual(tv.settings["transition_animation_scale"], "0.0")
        self.assertEqual(tv.settings["window_animation_scale"], "1.0")
        self.assertEqual(tv.settings["animator_duration_scale"], "1.0")
        words_ok(self, r["words"])
        self.assertFalse(tidy.has_record(tv))

    def test_a_tv_that_ignores_the_write_is_reported_and_nothing_stays_recorded(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        tv.refuse_settings = set(ANIM)
        r = result(tv, anim=True)["anim"]
        self.assertEqual(r["status"], "refused")
        words_ok(self, r["words"])
        self.assertFalse(tidy.has_record(tv))
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})

    def test_one_refused_puts_the_others_back(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        tv.refuse_settings = {"animator_duration_scale"}
        r = result(tv, anim=True)["anim"]
        self.assertEqual(r["status"], "refused")
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})
        self.assertFalse(tidy.has_record(tv))

    def test_already_half_is_not_offered_and_not_ours(self):
        tv = FakeTv("google")
        tv.settings = {n: "0.5" for n in ANIM}
        self.assertNotIn("anim", [x["id"] for x in tidy.state(tv)["switches"]])
        self.assertEqual(result(tv, anim=True)["anim"]["status"], "unchanged")
        self.assertFalse(tidy.has_record(tv))

    def test_a_tv_that_does_not_answer_settings_is_not_offered_the_switch(self):
        tv = FakeTv("google")
        tv.settings = {"window_animation_scale": "Error: nope"}
        self.assertNotIn("anim", [x["id"] for x in tidy.state(tv)["switches"]])
        self.assertEqual(result(tv, anim=True)["anim"]["status"], "unsupported")
        self.assertFalse([c for c in tv.log if c.startswith("settings put global")])

    def test_turning_on_twice_keeps_the_first_old_value(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        result(tv, anim=True)
        self.assertEqual(result(tv, anim=True)["anim"]["status"], "unchanged")
        result(tv, anim=False)
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})


class Idle(unittest.TestCase):
    def test_on_off_and_only_where_the_tv_has_it(self):
        tv = FakeTv("google")
        self.assertEqual(result(tv, idle=True)["idle"]["status"], "done")
        self.assertIn(AMBIENT, tv.disabled)
        self.assertEqual(result(tv, idle=False)["idle"]["status"], "off")
        self.assertNotIn(AMBIENT, tv.disabled)
        tcl = FakeTv("android")
        self.assertNotIn("idle", [x["id"] for x in tidy.state(tcl)["switches"]])
        self.assertEqual(result(tcl, idle=True)["idle"]["status"], "unsupported")
        self.assertEqual(disables(tcl), [])

    def test_old_plan_checkbox_path_still_works(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK, ambient_off=True)              # an older caller
        self.assertIn(AMBIENT, tv.disabled)
        s = tidy.state(tv)
        self.assertTrue(next(x for x in s["switches"] if x["id"] == "idle")["on"])
        self.assertEqual(result(tv, idle=False)["idle"]["status"], "off")      # the new screen can undo it
        self.assertNotIn(AMBIENT, tv.disabled)
        self.assertNotIn(AMBIENT, steps.record(tv)["disabled"])
        tv2 = FakeTv("google")
        steps.make_home(tv2, APK, ambient_off=False)            # and the new default leaves it alone
        self.assertEqual(disables(tv2), [])

    def tcl_android_11(self, **kw):
        """The owner's TCL: Android TV 11, no dreamx, Backdrop is the idle screen. (The basic screen saver off here
        stands for an app somebody else switched off; nothing was off on the real TCL.)"""
        tv = FakeTv("android", disabled={"com.android.dreams.basic"}, **kw)
        tv.packages |= {tidy.steps.BACKDROP, "com.android.dreams.basic"}
        tv.secure = {"screensaver_enabled": "1", "screensaver_components": "com.google.android.backdrop/com.google.android.backdrop.DreamActivity"}
        return tv

    def test_backdrop_on_android_tv_is_offered_switched_off_and_read_back(self):
        tv = self.tcl_android_11()
        self.assertIn("idle", [x["id"] for x in tidy.state(tv)["switches"]])
        r = result(tv, idle=True)["idle"]
        self.assertEqual(r["status"], "done")
        self.assertIn(tidy.steps.BACKDROP, tv.disabled)
        self.assertIn("com.android.dreams.basic", tv.disabled)              # not ours: never touched
        self.assertEqual(r["report"]["off"], [tidy.steps.BACKDROP])
        # the real TCL (25 Nov 2026): pm disable-user is taken and listed, but the component setting still names Backdrop
        # and the screen saver setting stays on. That is done, and the words are for a person (the names are in report).
        self.assertIn("backdrop/com.google.android.backdrop.DreamActivity", r["report"]["components"])
        self.assertNotIn("com.", r["words"])
        self.assertTrue(next(x for x in tidy.state(tv)["switches"] if x["id"] == "idle")["on"])
        self.assertEqual([c.split()[-1] for c in disables(tv)], [tidy.steps.BACKDROP])
        self.assertEqual(tv.secure["screensaver_enabled"], "1")             # the setting is left alone when the app went off
        self.assertEqual(result(tv, idle=False)["idle"]["status"], "off")
        self.assertNotIn(tidy.steps.BACKDROP, tv.disabled)
        self.assertIn("com.android.dreams.basic", tv.disabled)

    def test_backdrop_refused_falls_back_to_the_setting_and_says_so(self):
        tv = self.tcl_android_11()
        tv.refuse_disable = {tidy.steps.BACKDROP}
        r = result(tv, idle=True)["idle"]
        self.assertEqual(r["status"], "partial")
        self.assertEqual(tv.secure["screensaver_enabled"], "0")
        self.assertIn("would not switch", r["words"])
        self.assertIn("tell us", r["words"])
        self.assertEqual(result(tv, idle=False)["idle"]["status"], "off")
        self.assertEqual(tv.secure["screensaver_enabled"], "1")             # put back as it was

    def test_backdrop_and_the_setting_both_refused_is_refused_and_leaves_no_record(self):
        tv = self.tcl_android_11()
        tv.refuse_disable = {tidy.steps.BACKDROP}
        tv.refuse_secure = {"screensaver_enabled"}
        r = result(tv, idle=True)["idle"]
        self.assertEqual(r["status"], "refused")
        self.assertIn("refused", r["words"])
        self.assertFalse(tidy.has_record(tv))
        self.assertEqual(tv.secure["screensaver_enabled"], "1")

    def test_setup_plan_names_backdrop_too(self):
        tv = self.tcl_android_11()
        steps.make_home(tv, APK, ambient_off=True)
        self.assertIn(tidy.steps.BACKDROP, tv.disabled)

    def test_refused_idle(self):
        tv = FakeTv("google")
        tv.refuse_disable = {AMBIENT}
        tv.refuse_secure = {"screensaver_enabled"}     # and the TV ignores the screen saver setting too
        r = result(tv, idle=True)["idle"]
        self.assertEqual(r["status"], "refused")
        self.assertFalse(tidy.has_record(tv))

    def test_already_off_by_someone_else_is_not_offered_or_ours(self):
        tv = FakeTv("google", disabled={AMBIENT})
        self.assertNotIn("idle", [x["id"] for x in tidy.state(tv)["switches"]])
        result(tv, idle=False)
        self.assertIn(AMBIENT, tv.disabled)


class Crash(unittest.TestCase):
    def test_crash_between_two_settings_is_recoverable_later(self):
        tv = FakeTv("google")
        tv.settings = {"window_animation_scale": "1.5", "transition_animation_scale": "1.0"}
        tv.fail_on = "settings put global transition_animation_scale"
        with self.assertRaises(TvError):
            tidy.apply(tv, {"anim": True})
        self.assertEqual(tv.settings["window_animation_scale"], "0.5")       # half done
        # the next session: a new look at the same TV, nothing in memory
        tv.fail_on = None
        self.assertTrue(tidy.has_record(tv))
        r = tidy.restore_all(tv)["results"]["anim"]
        self.assertEqual(r["status"], "off")
        self.assertEqual(tv.settings, {"window_animation_scale": "1.5", "transition_animation_scale": "1.0"})
        self.assertFalse(tidy.has_record(tv))

    def test_crash_before_the_record_means_no_change(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        tv.fail_on = "mkdir -p"                      # the record cannot be written
        with self.assertRaises(TvError):
            tidy.apply(tv, {"anim": True})
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})

    def test_crash_while_switching_apps_off(self):
        tv = sony()
        tv.fail_on = "pm disable-user --user 0 com.sony.dtv.promos"
        with self.assertRaises(TvError):
            tidy.apply(tv, {"ads": True})
        tv.fail_on = None
        tidy.restore_all(tv)
        self.assertEqual(tv.disabled, set())
        self.assertFalse(tidy.has_record(tv))

    def test_record_from_an_earlier_session_on_another_computer_is_read_from_the_tv(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        result(tv, anim=True)
        p = Path(os.environ["COUCHTV_SETUP_HOME"]) / "tidy.json"
        p.write_text("{}")                           # this computer knows nothing
        self.assertTrue(tidy.has_record(tv))         # the TV's copy does
        tidy.restore_all(tv)
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})

    def test_record_from_an_earlier_session_is_read_from_this_computer(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        result(tv, anim=True)
        tv.files.clear()                             # a TV copy lost (factory reset of /data/local/tmp)
        tidy.restore_all(tv)
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})


class UndoAndRemoval(unittest.TestCase):
    def test_undo_all_puts_everything_back(self):
        tv = sony()
        tv.settings = {"window_animation_scale": "1.0"}
        result(tv, ads=True, anim=True, idle=True)
        out = tidy.restore_all(tv)
        self.assertEqual(tv.disabled, set())
        self.assertEqual(tv.settings, {"window_animation_scale": "1.0"})
        self.assertFalse(out["state"]["undo"])
        for r in out["results"].values():
            words_ok(self, r["words"])

    def test_removal_restores_the_tidy_changes_too(self):
        tv = sony()
        tv.settings = {"window_animation_scale": "1.25", "transition_animation_scale": "1.0"}
        steps.make_home(tv, APK)
        result(tv, ads=True, anim=True)
        r = steps.undo(tv)
        self.assertEqual(tv.disabled, set())
        self.assertEqual(tv.settings, {"window_animation_scale": "1.25", "transition_animation_scale": "1.0"})
        self.assertNotIn("app.couchtv.launcher", tv.packages)
        self.assertEqual(r["tidy"]["anim"]["status"], "off")
        self.assertFalse(tidy.has_record(tv))
        self.assertFalse([f for f in tv.files if f.startswith("/data/local/tmp/couchtv-setup")])

    def test_removal_leaves_a_setting_the_person_changed_since(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        steps.make_home(tv, APK)
        result(tv, anim=True)
        tv.settings["window_animation_scale"] = "3.0"
        steps.undo(tv)
        self.assertEqual(tv.settings["window_animation_scale"], "3.0")
        self.assertEqual(tv.settings["animator_duration_scale"], "1.0")

    def test_removal_with_a_record_from_an_earlier_session(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        steps.make_home(tv, APK)
        result(tv, anim=True)
        (Path(os.environ["COUCHTV_SETUP_HOME"]) / "tidy.json").write_text("{}")
        steps.undo(tv)
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})

    def test_a_tv_that_refuses_the_restore_keeps_the_record_for_next_time(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        result(tv, anim=True)
        tv.refuse_settings = set(ANIM)
        r = tidy.restore_all(tv)["results"]["anim"]
        self.assertEqual(r["status"], "refused")
        self.assertTrue(tidy.has_record(tv))
        tv.refuse_settings = set()
        tidy.restore_all(tv)
        self.assertEqual({n: tv.settings[n] for n in ANIM}, {n: "1.0" for n in ANIM})

    def test_nothing_recorded_means_undo_all_changes_nothing(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        tv.log.clear()
        tidy.restore_all(tv)
        self.assertFalse([c for c in tv.log if c.startswith(("settings put", "settings delete", "pm enable", "pm disable"))])


class Injection(unittest.TestCase):
    def test_a_record_file_on_the_tv_cannot_carry_a_command(self):
        tv = FakeTv("google")
        tv.settings = {n: "1.0" for n in ANIM}
        tv.files[tidy.RECORD_FILE] = "\n".join([
            "P:evil;reboot", "P:$(reboot)", "P:ok.pkg.name;rm", "P:com.good.app", "S:window_animation_scale:1.0;reboot:0.5",
            "S:not_a_setting:1.0:0.5", "S:animator_duration_scale:1.0:0.5;reboot", "S:animator_duration_scale:$(id):0.5", ""])
        rec = tidy.load(tv)
        self.assertEqual(rec["pkgs"], ["com.good.app"])
        self.assertEqual(rec["settings"], {})
        tv.log.clear()
        tidy.restore_all(tv)
        for c in tv.log:
            self.assertNotRegex(c, r"reboot|\$\(|evil|not_a_setting|; ?rm")

    def test_only_booleans_and_fixed_names_reach_the_shell(self):
        tv = sony()
        tv.settings = {n: "1.0" for n in ANIM}
        tidy.route("apply", {"ads": "yes; reboot", "anim": ["x"], "idle": {"a": 1}, "evil;rm": True}, tv,
                   lambda name, fn: fn(lambda f, m=None: None))
        self.assertFalse([c for c in tv.log if c.startswith(("settings put", "settings delete", "pm disable"))])
        self.assertFalse([c for c in tv.log if "reboot" in c or "evil" in c])

    def test_every_shell_line_this_step_sends_is_one_of_the_known_shapes(self):
        tv = sony()
        tv.settings = {"window_animation_scale": "1.0"}
        tv.log.clear()
        result(tv, ads=True, anim=True, idle=True)
        result(tv, ads=False, anim=False, idle=False)
        shapes = re.compile(
            r"^(pm list packages( -d)?|pm query-activities .*|settings (get|delete) global [a-z_]+|settings (get|put|delete) secure screensaver_[a-z_]+( [0-9]+)?|dumpsys dreams|settings put global [a-z_]+ [0-9.]+|"
            r"pm (disable-user --user 0|enable) [A-Za-z0-9_.]+|dumpsys package [A-Za-z0-9_.]+|cat /data/local/tmp/couchtv-setup/\w+ 2>/dev/null|"
            r"mkdir -p /data/local/tmp/couchtv-setup; printf '%s\\n' [A-Za-z0-9_.:]+( [A-Za-z0-9_.:]+)* > /data/local/tmp/couchtv-setup/tidy|"
            r"rm -f /data/local/tmp/couchtv-setup/\w+|mkdir -p /data/local/tmp/couchtv-setup; echo .*|"
            r"mkdir -p /data/local/tmp/couchtv-setup; printf .*)$")
        for c in tv.log:
            self.assertRegex(c, shapes)


class Speed(unittest.TestCase):
    GFX = "Total frames rendered: 400\nJanky frames: 4 (1.00%)\n50th percentile: 8ms\n90th percentile: 12ms\n99th percentile: 20ms\n"

    def test_read_only_and_honest_words(self):
        tv = FakeTv("google", installed={"app.couchtv.launcher"})
        tv.gfxinfo = self.GFX
        tv.log.clear()
        r = tidy.speed(tv, sleep=lambda s: None)
        self.assertFalse([c for c in tv.log if c.startswith(("settings put", "settings delete", "pm enable", "pm disable", "am ", "rm ", "mkdir"))])
        self.assertEqual(r["speed"]["p90"], 12)
        again = tidy.speed(tv, sleep=lambda s: None)
        for w in r["words"] + again["words"]:
            words_ok(self, w)
        self.assertIn("About the same", " ".join(again["words"]))

    def test_too_few_frames_says_so(self):
        tv = FakeTv("google", installed={"app.couchtv.launcher"})
        r = tidy.speed(tv, sleep=lambda s: None)
        self.assertIn("Not enough frames", r["words"][0])

    def test_needs_couch_tv_on_the_tv(self):
        with self.assertRaises(TvError):
            tidy.speed(FakeTv("google"), sleep=lambda s: None)
        self.assertFalse(tidy.state(FakeTv("google"))["speed"])


class Routes(unittest.TestCase):
    def test_server_routes(self):
        from couchtv_setup import server
        tv = sony()
        tv.settings = {n: "1.0" for n in ANIM}
        old = server.S.tv, server.S.facts
        server.S.tv, server.S.facts = tv, steps.facts(tv)
        try:
            s = server.api("POST", "/api/tidy/state", {})
            self.assertEqual({x["id"] for x in s["switches"]}, {"ads", "anim", "idle"})
            with self.assertRaises(TvError):
                server.api("POST", "/api/tidy/nope", {})
            # the old plan checkbox path: plan and setup still take ambient_off, and now default to off
            self.assertFalse(any("ambient" in i for i in server.api("POST", "/api/plan", {})["items"]))
            self.assertTrue(any("ambient" in i for i in server.api("POST", "/api/plan", {"ambient_off": True})["items"]))
        finally:
            server.S.tv, server.S.facts = old

    def test_words_on_the_screen_have_no_dashes_or_forbidden_claims(self):
        web = ROOT / "setup-app" / "couchtv_setup" / "web"
        for f in ("tidy.js", "tidy.css"):
            text = (web / f).read_text(encoding="utf-8")
            self.assertNotIn("—", text)
            self.assertNotIn("–", text)
            self.assertIsNone(re.search(r"innerHTML|outerHTML|insertAdjacentHTML|document\.write", text), f)
        js = (web / "tidy.js").read_text(encoding="utf-8")
        for m in re.findall(r'"([^"\n]{12,})"', js):
            if " " in m and not m.startswith(("/api", "application", "tidy")):
                words_ok(self, m)


if __name__ == "__main__":
    unittest.main()
