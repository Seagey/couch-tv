"""The setup and undo steps against a pretend TV (faketv.py). They check what apply.sh promises:
the TV's own home and setup app are never switched off, ambient mode only with a yes, Undo
switches everything back on before it removes anything."""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import steps  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import AMBIENT, GOOGLE_HOME, WIZARD, FakeTv  # noqa: E402

steps.time.sleep = lambda s: None
APK = "/x/couch-tv-home.apk"


def disables(tv):
    return [c for c in tv.log if c.startswith("pm disable")]


class Setup(unittest.TestCase):
    def test_google_tv_fresh(self):
        tv = FakeTv("google")
        r = steps.make_home(tv, APK)
        self.assertIn("INSTALL " + APK, tv.log)
        self.assertEqual(disables(tv), ["pm disable-user --user 0 " + AMBIENT])
        self.assertEqual(tv.chosen, steps.HOME_ACT)
        self.assertIn("app.couchtv.launcher/.FireWatch", tv.a11y)
        self.assertIn("settings put secure accessibility_enabled 1", tv.log)
        self.assertTrue(r["front"])
        # the record for Undo, on the TV
        self.assertEqual(tv.files["/data/local/tmp/couchtv-setup/home"].strip(), GOOGLE_HOME + "/.home.HomeActivity")
        self.assertEqual(tv.files["/data/local/tmp/couchtv-setup/disabled"].split(), [AMBIENT])
        # the settings go to the home, with option A's "no bridge"
        start = next(c for c in tv.log if c.startswith("am force-stop app.couchtv.launcher"))
        self.assertIn("--es bridge none", start)

    def test_never_switches_off_home_or_setup(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK)
        for c in disables(tv):
            self.assertNotIn(GOOGLE_HOME, c)
            self.assertNotIn(WIZARD, c)
            self.assertNotIn("tvlauncher", c)

    def test_needed_refuses_homes_setup_and_system(self):
        tv = FakeTv("google")
        homes = {GOOGLE_HOME}
        for p in (GOOGLE_HOME, WIZARD, "com.google.android.tvlauncher", "com.android.systemui", "com.google.android.gms",
                  "com.sony.dtv.tvx", "com.example.setupwizard", "com.google.android.katniss"):
            self.assertTrue(steps.needed(tv, p, homes), p)
        tv.packages.add("com.android.phone")
        self.assertTrue(steps.needed(tv, "com.android.phone", homes))
        self.assertFalse(steps.needed(tv, AMBIENT, homes))

    def test_ambient_kept_when_asked(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK, ambient_off=False)
        self.assertEqual(disables(tv), [])
        self.assertNotIn("/data/local/tmp/couchtv-setup/disabled", tv.files)

    def test_older_couch_tv_damage_is_repaired(self):
        tv = FakeTv("google", disabled={GOOGLE_HOME, WIZARD})
        r = steps.make_home(tv, APK)
        self.assertIn("pm enable " + GOOGLE_HOME, tv.log)
        self.assertIn("pm enable " + WIZARD, tv.log)
        self.assertNotIn(GOOGLE_HOME, tv.disabled)
        self.assertTrue(any("switched back on" in c for c in r["changed"]))

    def test_home_refused_stops_before_switching_off(self):
        tv = FakeTv("google")
        tv.refuse_home = True
        with self.assertRaises(TvError) as e:
            steps.make_home(tv, APK)
        self.assertEqual(e.exception.code, "home_refused")
        self.assertEqual(disables(tv), [])

    def test_second_run_changes_nothing_new(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK)
        first_home = tv.files["/data/local/tmp/couchtv-setup/home"]
        tv.log.clear()
        steps.make_home(tv, APK)
        self.assertEqual(disables(tv), [])                       # already off
        self.assertEqual(tv.files["/data/local/tmp/couchtv-setup/home"], first_home)   # original home kept
        self.assertEqual(tv.a11y.count("FireWatch"), 1)        # taken out and put back, never twice

    def test_other_accessibility_services_kept(self):
        tv = FakeTv("google", a11y="com.example.reader/.Svc")
        steps.make_home(tv, APK)
        self.assertEqual(tv.a11y, "com.example.reader/.Svc:app.couchtv.launcher/.FireWatch")

    def test_fire_tv(self):
        tv = FakeTv("fire")
        steps.make_home(tv, APK)
        self.assertEqual(disables(tv), [])                       # nothing of Amazon's is switched off
        self.assertIn("app.couchtv.launcher/.FireWatch", tv.a11y)
        f = steps.facts(tv)
        self.assertTrue(f["fire"])
        self.assertEqual(f["kind"], "fire")

    def test_tcl_gets_auto_start(self):
        tv = FakeTv("google", maker="TCL")
        steps.make_home(tv, APK)
        self.assertIn("appops set app.couchtv.launcher AUTO_START allow", tv.log)
        other = FakeTv("google")
        steps.make_home(other, APK)
        self.assertFalse(any("AUTO_START" in c for c in other.log))

    def test_plan_words(self):
        tv = FakeTv("google")
        items = steps.plan(tv, steps.facts(tv))
        self.assertTrue(any("ambient mode" in i for i in items))
        self.assertFalse(any("ambient mode" in i for i in steps.plan(tv, steps.facts(tv), ambient_off=False)))
        for i in items:
            self.assertNotIn("—", i)
            self.assertNotIn("–", i)

    def test_config_names_and_weather(self):
        import base64
        import json
        cfg = json.loads(base64.b64decode(steps.home_config(["Sam", " ", "Alex"], {"lat": -28.8, "lon": 153.3, "place": "Lismore", "timezone": "Australia/Sydney"})))
        self.assertEqual([p["name"] for p in cfg["people"]], ["Sam", "Alex"])
        self.assertEqual(cfg["weather"]["place"], "Lismore")
        self.assertFalse(cfg["ask"]["enabled"])
        cfg = json.loads(base64.b64decode(steps.home_config()))
        self.assertNotIn("weather", cfg)
        self.assertEqual(len(cfg["people"]), 1)


class FireTv(unittest.TestCase):
    """killy10o10's four points from his Fire TV Stick 4K (2nd gen, Fire OS 8.1.8.5) on PR #97."""

    def test_amazon_home_stays_chosen_but_setup_carries_on(self):
        tv = FakeTv("fire")                      # set-home-activity is ignored, as on Fire OS
        r = steps.make_home(tv, APK)
        self.assertIn("app.couchtv.launcher/.FireWatch", tv.a11y)
        self.assertTrue(r["fire"])
        self.assertTrue(r["watch_bound"])
        self.assertTrue(r["front"])              # the watch brings couch-tv back

    def test_google_tv_that_refuses_still_stops(self):
        tv = FakeTv("google")
        tv.refuse_home = True
        with self.assertRaises(TvError):
            steps.make_home(tv, APK)

    def test_fire_os_version_from_build_name(self):
        f = steps.facts(FakeTv("fire"))
        self.assertEqual(f["fire_os"], "8.1.8.5")    # ro.build.version.fireos says 8.0 on that stick

    def test_watch_found_in_a_bound_list_over_several_lines(self):
        tv = FakeTv("fire", installed={"com.spocky.projengmenu"})
        tv.other_bound = ["Projectivy Launcher"]
        steps.make_home(tv, APK)
        out = tv.shell("dumpsys accessibility")
        first = out.split("Bound services:", 1)[1].splitlines()[0]
        self.assertNotIn("Home button watch", first)  # only a reader of the whole list sees it
        self.assertTrue(steps.watch_bound(tv))

    def test_not_bound_until_a_restart(self):
        tv = FakeTv("fire")
        tv.binds = False
        r = steps.make_home(tv, APK)
        self.assertFalse(r["watch_bound"])
        self.assertFalse(r["front"])
        self.assertFalse(steps.check_home(tv)["watch_bound"])
        tv.binds = True                          # after the restart
        c = steps.check_home(tv)
        self.assertTrue(c["watch_bound"])
        self.assertTrue(c["ok"])

    def test_other_launcher_watch_is_warned_about(self):
        tv = FakeTv("fire", installed={"com.spocky.projengmenu"}, a11y="com.spocky.projengmenu/.services.Watch")
        tv.other_homes = ["com.spocky.projengmenu"]
        items = steps.plan(tv, steps.facts(tv))
        self.assertTrue(any("Projectivy Launcher" in i and "fight" in i for i in items))
        r = steps.make_home(tv, APK)
        self.assertIn("Projectivy Launcher", r["warning"])
        self.assertIn("com.spocky.projengmenu/.services.Watch", tv.a11y)   # kept, never switched off

    def test_unknown_launcher_with_a_watch_is_warned_about_by_package(self):
        tv = FakeTv("google", installed={"com.example.launcher"}, a11y="com.example.launcher/.Svc")
        tv.other_homes = ["com.example.launcher"]
        self.assertEqual(steps.other_watches(tv), ["com.example.launcher"])
        plain = FakeTv("google", a11y="com.example.reader/.Svc")      # a screen reader is not a launcher
        self.assertEqual(steps.other_watches(plain), [])


class OnTvIsHome(unittest.TestCase):
    """A stick that already has the on-TV app as its home (killy10o10, 12 Nov 2026)."""
    ONTV_WATCH = "dev.couchtv.ontv/dev.couchtv.ontv.WatchService"

    def stick(self):
        tv = FakeTv("fire", installed={"dev.couchtv.ontv"}, a11y=self.ONTV_WATCH)
        tv.ontv_alias = True
        return tv

    def test_detected_from_alias_or_watch(self):
        self.assertTrue(steps.facts(self.stick())["ontv_home"]["takes_home"])
        only_watch = FakeTv("fire", installed={"dev.couchtv.ontv"}, a11y=self.ONTV_WATCH)
        self.assertTrue(steps.ontv_home(only_watch)["watch"])
        plain = FakeTv("fire", installed={"dev.couchtv.ontv"})          # installed for the phone remote only
        self.assertFalse(steps.ontv_home(plain)["takes_home"])
        self.assertFalse(steps.facts(FakeTv("fire"))["ontv_home"]["installed"])

    def test_plan_names_it_and_offers_both_ways(self):
        tv = self.stick()
        google = FakeTv("google", installed={"dev.couchtv.ontv"}, a11y=self.ONTV_WATCH)
        google.ontv_alias = True
        off = steps.plan(google, steps.facts(google))
        self.assertTrue(any("on-TV app" in i and "switches its home and watch off" in i for i in off))
        keep = steps.plan(tv, steps.facts(tv), ontv_home_off=False)
        self.assertTrue(any("keeping it" in i for i in keep))
        self.assertFalse(any("Put the couch-tv home" in i for i in keep))

    def test_setup_switches_it_off_first_and_couch_tv_wins(self):
        tv = self.stick()
        r = steps.make_home(tv, APK)
        self.assertFalse(tv.ontv_alias)
        self.assertNotIn("dev.couchtv.ontv", tv.a11y)
        self.assertIn("dev.couchtv.ontv", tv.packages)               # stays installed
        self.assertIn("app.couchtv.launcher/.FireWatch", tv.a11y)
        self.assertTrue(r["front"])
        self.assertFalse(steps.ontv_home(tv)["takes_home"])
        # Undo goes back to Amazon's home, never to the on-TV app it then removes
        self.assertTrue(steps.record(tv)["home"].startswith("com.amazon.tv.launcher/"))
        steps.undo(tv)
        self.assertNotIn("dev.couchtv.ontv", tv.packages)
        self.assertNotIn("app.couchtv.launcher", tv.packages)

    def test_fire_plan_is_honest_about_the_home_entry(self):
        tv = self.stick()
        item = steps.plan(tv, steps.facts(tv))[0]
        self.assertIn("Fire OS won't let a computer switch its home entry off", item)
        self.assertIn("without its watch it stays in the background", item)
        self.assertNotIn("switches its home and watch off", item)

    def test_refused_alias_disable_is_not_a_failure(self):
        tv = self.stick()
        tv.refuse_alias = True
        r = steps.make_home(tv, APK)
        self.assertTrue(r["front"])
        self.assertTrue(r["ontv_alias_left"])
        self.assertNotIn("dev.couchtv.ontv", tv.a11y)                 # watch still taken out
        self.assertIn("pm revoke dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS", tv.log)

    def test_refused_alias_asks_the_app_over_its_api_when_it_has_a_token(self):
        import http.server, threading, json as _json
        seen = {}

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                seen["path"] = self.path
                seen["auth"] = self.headers.get("Authorization")
                seen["body"] = _json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(200); self.end_headers(); self.wfile.write(b"{}")

            def log_message(self, *a):
                pass
        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.handle_request, daemon=True).start()
        real = steps.urllib.request.Request
        port = srv.server_address[1]

        def local(url, **kw):
            return real(url.replace(":5400", f":{port}"), **kw)
        tv = self.stick()
        tv.refuse_alias = True
        tv.ip, tv.ontv_token = "127.0.0.1", "tok"
        steps.urllib.request.Request = local
        try:
            off = steps.ontv_home_off(tv)
        finally:
            steps.urllib.request.Request = real
            srv.server_close()
        self.assertTrue(off["alias_off_via_api"])
        self.assertFalse(off["alias_left"])
        self.assertEqual((seen["path"], seen["auth"], seen["body"]), ("/api/home", "Bearer tok", {"on": False}))

    def test_keeping_it_installs_nothing(self):
        tv = self.stick()
        r = steps.make_home(tv, APK, ontv_home_switch_off=False)
        self.assertTrue(r["kept_ontv"])
        self.assertNotIn("app.couchtv.launcher", tv.packages)
        self.assertTrue(tv.ontv_alias)
        self.assertEqual(tv.a11y, self.ONTV_WATCH)

    def test_check_names_the_other_app_when_it_is_in_front(self):
        tv = self.stick()
        tv.packages.add("app.couchtv.launcher")
        c = steps.check_home(tv)
        self.assertFalse(c["ok"])
        self.assertEqual(c["other_front"], "ontv")
        self.assertIsNone(steps.check_home(FakeTv("fire"))["other_front"])


class FriendlyNames(unittest.TestCase):
    def test_homes_in_words(self):
        self.assertEqual(steps.friendly_home("com.amazon.tv.launcher/.ui.HomeActivity_vNext"), "Amazon's home")
        self.assertEqual(steps.friendly_home("com.google.android.apps.tv.launcherx/.home.HomeActivity"), "Google TV's home")
        self.assertEqual(steps.friendly_home("com.vendor.home/.Main"), "the TV's own home")
        self.assertEqual(steps.friendly_home(""), "the TV's own home")

    def test_undo_plan_has_friendly_name_and_raw_detail(self):
        tv = FakeTv("fire")
        steps.make_home(tv, APK)
        p = steps.undo_plan(tv)
        self.assertEqual(p["home_name"], "Amazon's home")
        self.assertIn("com.amazon.tv.launcher/", p["home"])


class Remote(unittest.TestCase):
    def test_phone_remote_grants_and_home_again(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK)
        tv.log.clear()
        r = steps.phone_remote(tv, "/x/couch-tv-ontv.apk", steps.facts(tv))
        self.assertIn("pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS", tv.log)
        self.assertNotIn("appops set dev.couchtv.ontv GET_USAGE_STATS allow", tv.log)
        self.assertEqual(tv.log[-1], "cmd package set-home-activity " + steps.HOME_ACT)
        self.assertEqual(r["address"], "http://192.0.2.10:5400")
        fire = FakeTv("fire")
        steps.phone_remote(fire, "/x/couch-tv-ontv.apk", steps.facts(fire))
        self.assertIn("appops set dev.couchtv.ontv GET_USAGE_STATS allow", fire.log)


class Undo(unittest.TestCase):
    def test_undo_puts_everything_back(self):
        tv = FakeTv("google", a11y="com.example.reader/.Svc")
        steps.make_home(tv, APK)
        steps.phone_remote(tv, "/x/couch-tv-ontv.apk", steps.facts(tv))
        tv.log.clear()
        r = steps.undo(tv)
        self.assertNotIn(AMBIENT, tv.disabled)
        self.assertNotIn("app.couchtv.launcher", tv.packages)
        self.assertNotIn("dev.couchtv.ontv", tv.packages)
        self.assertEqual(tv.a11y, "com.example.reader/.Svc")
        self.assertIn("cmd package set-home-activity " + GOOGLE_HOME + "/.home.HomeActivity", tv.log)
        # switched back on BEFORE anything is removed, so the TV is never left without a home
        first_uninstall = next(i for i, c in enumerate(tv.log) if c.startswith("pm uninstall"))
        last_enable = max(i for i, c in enumerate(tv.log) if c.startswith("pm enable"))
        self.assertLess(last_enable, first_uninstall)
        self.assertEqual(tv.files, {})
        self.assertTrue(r["home_now"].startswith(GOOGLE_HOME))

    def test_undo_without_a_record_uses_apply_sh_defaults(self):
        # A TV set up from the repo's apply.sh by another computer: no record from this app.
        tv = FakeTv("google", disabled={AMBIENT, WIZARD}, installed={"app.couchtv.launcher"})
        steps.undo(tv)
        self.assertNotIn(AMBIENT, tv.disabled)
        self.assertNotIn(WIZARD, tv.disabled)
        self.assertNotIn("app.couchtv.launcher", tv.packages)

    def test_undo_stops_before_removing_when_the_tv_fails(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK)
        tv.fail_on = "set-home-activity com.google"
        with self.assertRaises(TvError):
            steps.undo(tv)
        self.assertIn("app.couchtv.launcher", tv.packages)     # the home stays, so the TV keeps a home screen

    def test_record_on_tv_works_from_another_computer(self):
        tv = FakeTv("google")
        steps.make_home(tv, APK)
        steps._save_local(steps.serial(tv), None)              # this computer forgot
        self.assertEqual(steps.record(tv)["disabled"], [AMBIENT])

    def test_bad_record_lines_are_ignored(self):
        tv = FakeTv("google")
        tv.files["/data/local/tmp/couchtv-setup/disabled"] = "com.ok.pkg\n$(reboot)\ncom.x; rm -rf /\n"
        tv.files["/data/local/tmp/couchtv-setup/home"] = "evil; reboot\n"
        rec = steps.record(tv)
        self.assertEqual(rec["disabled"], ["com.ok.pkg"])
        self.assertEqual(rec["home"], "")


if __name__ == "__main__":
    unittest.main()
