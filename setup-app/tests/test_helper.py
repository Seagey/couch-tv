"""Couch TV Helper: its config, the login item written to a temp folder, the menu as data, the deep link,
the bridge supervisor and the Setup page's helper API. No TV, no tray library, nothing real touched."""
import json
import os
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()
os.environ["COUCHTV_SETUP_NO_HELPER_START"] = "1"

from couchtv_setup import server  # noqa: E402
from couchtv_setup.helper import autostart, bridge_proc, control, deeplink, menu, status  # noqa: E402
from couchtv_setup.helper import config as hconfig  # noqa: E402


class FakeReg:
    HKEY_CURRENT_USER, REG_SZ, KEY_SET_VALUE, KEY_READ = "HKCU", 1, 2, 3

    def __init__(self):
        self.values = {}

    def CreateKey(self, root, path):
        return self

    OpenKey = lambda self, root, path, res=0, acc=0: self  # noqa: E731

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def SetValueEx(self, k, name, res, typ, val):
        self.values[name] = val

    def DeleteValue(self, k, name):
        if name not in self.values:
            raise OSError("missing")
        del self.values[name]

    def QueryValueEx(self, k, name):
        if name not in self.values:
            raise OSError("missing")
        return (self.values[name], 1)


class Config(unittest.TestCase):
    def test_default_is_once_and_bad_files_fall_back(self):
        d = tempfile.mkdtemp()
        self.assertEqual(hconfig.load(d)["mode"], "once")
        Path(d, "helper.json").write_text("not json")
        self.assertEqual(hconfig.load(d)["mode"], "once")
        Path(d, "helper.json").write_text(json.dumps({"mode": "helper", "port": 80, "pairing_key": "short"}))
        c = hconfig.load(d)
        self.assertEqual((c["mode"], c["port"], c["pairing_key"]), ("helper", 5400, ""))

    def test_turn_on_makes_a_key_once_and_off_keeps_it(self):
        d = tempfile.mkdtemp()
        key = hconfig.turn_on(True, d)["pairing_key"]
        self.assertRegex(key, r"^[A-Za-z0-9_-]{12,128}$")
        self.assertEqual(hconfig.turn_on(False, d)["pairing_key"], key)
        off = hconfig.turn_off(d)
        self.assertEqual((off["mode"], off["autostart"], off["pairing_key"]), ("once", False, key))
        if os.name != "nt":   # Windows has no owner only file mode
            self.assertEqual(oct(os.stat(Path(d, "helper.json")).st_mode & 0o777), "0o600")

    def test_tvs_are_checked(self):
        d = tempfile.mkdtemp()
        hconfig.add_tv("192.0.2.20", "samsung", "Lounge", d)
        hconfig.add_tv("192.0.2.20", "samsung", "Lounge 2", d)
        hconfig.add_tv("not an ip", "lg", "x", d)
        hconfig.add_tv("192.0.2.21", "vizio", "x", d)
        self.assertEqual(hconfig.load(d)["tvs"], [{"ip": "192.0.2.20", "kind": "samsung", "name": "Lounge 2"}])

    def test_bridge_config_merges_known_and_helper_tvs(self):
        cfg = dict(hconfig.default(), pairing_key="k" * 18, tvs=[{"ip": "192.0.2.20", "kind": "roku", "name": "Roku"}])
        known = {"192.0.2.10": {"room": "Living room", "route": "tcp", "kind": "google"},
                 "192.0.2.11": {"name": "Stick", "kind": "fire"}, "192.0.2.12": {}}
        c = hconfig.bridge_config(known, cfg)
        ids = [t["id"] for t in c["tvs"]]
        self.assertEqual(ids, ["living-room", "stick", "roku"])
        self.assertTrue(c["tvs"][1]["adb_only"])
        self.assertEqual(c["tvs"][2]["kind"], "roku")
        self.assertEqual(c["bridge"]["pairing_key"], "k" * 18)
        self.assertFalse(c["ask"]["enabled"])
        self.assertTrue(hconfig.bridge_config({}, hconfig.default())["tvs"])   # never an empty list


class Autostart(unittest.TestCase):
    CMD = ["/Apps/couch-tv Setup", "--helper"]

    def test_mac_launch_agent(self):
        home = tempfile.mkdtemp()
        where = autostart.enable(self.CMD, "darwin", home)
        self.assertEqual(where, str(Path(home, "Library/LaunchAgents/app.couchtv.helper.plist")))
        p = plistlib.loads(Path(where).read_bytes())
        self.assertEqual((p["ProgramArguments"], p["RunAtLoad"], p["KeepAlive"]), (self.CMD, True, False))
        self.assertTrue(autostart.is_enabled("darwin", home))
        self.assertTrue(autostart.disable("darwin", home))
        self.assertFalse(autostart.is_enabled("darwin", home))
        self.assertFalse(autostart.disable("darwin", home))

    def test_linux_xdg_autostart(self):
        home = tempfile.mkdtemp()
        where = autostart.enable(["/opt/couch tv/app", "--helper"], "linux", home)
        self.assertTrue(Path(where).as_posix().endswith(".config/autostart/couch-tv-helper.desktop"))
        text = Path(where).read_text()
        self.assertIn('Exec="/opt/couch tv/app" "--helper"', text)
        self.assertIn("Type=Application", text)
        self.assertTrue(autostart.disable("linux", home))
        self.assertFalse(Path(where).exists())

    def test_windows_run_key(self):
        reg = FakeReg()
        autostart.enable(self.CMD, "win32", registry=reg)
        self.assertEqual(reg.values[autostart.RUN_VALUE], '"/Apps/couch-tv Setup" "--helper"')
        self.assertTrue(autostart.is_enabled("win32", registry=reg))
        self.assertTrue(autostart.disable("win32", registry=reg))
        self.assertFalse(autostart.is_enabled("win32", registry=reg))
        self.assertFalse(autostart.disable("win32", registry=reg))

    def test_command_from_the_built_app_and_from_source(self):
        self.assertEqual(autostart.command("/x/app", frozen=True), ["/x/app", "--helper"])
        self.assertEqual(autostart.command("/x/py", frozen=False)[-2:], ["couchtv_setup", "--helper"])


class Menu(unittest.TestCase):
    def state(self, **kw):
        return dict({"running": True, "paused": False, "port": 5400, "autostart": True,
                     "tvs": [{"name": "Living room TV", "kind": "samsung", "ready": True},
                             {"name": "Bedroom TV", "kind": "android", "ready": True}]}, **kw)

    def test_running_menu_matches_the_mockup(self):
        items = menu.build(self.state())
        self.assertEqual(menu.labels(items), [
            "Couch TV Helper", "Running. 2 TVs connected.", "Living room TV: Samsung, ready", "Bedroom TV: Google TV, ready",
            "Open Couch TV Studio", "Add or change a TV...", "Start with this computer", "Pause the helper",
            "Turn off extra features...", "Remove everything from this computer...", "Quit"])
        self.assertTrue([i for i in items if i["id"] == "autostart"][0]["checked"])
        self.assertEqual(menu.dot(self.state()), "green")

    def test_updates_and_sleep_lines(self):
        labels = menu.labels(menu.build(self.state(update={"state": "up_to_date", "version": "0.13.14"},
                                                   awake={"needed": True, "allow_sleep": False})))
        self.assertIn("Up to date, 0.13.14", labels)
        self.assertIn("Let this computer sleep", labels)
        for st, want in (("ready", "Update ready, restart"), ("downloading", "Downloading 0.13.15"), ("error", "Could not check for updates")):
            self.assertIn(want, menu.labels(menu.build(self.state(update={"state": st, "version": "0.13.15"}))))
        up = [i for i in menu.build(self.state(update={"state": "ready", "version": "1"})) if i["id"] == "update"][0]
        self.assertTrue(up["enabled"])
        self.assertNotIn("Let this computer sleep", menu.labels(menu.build(self.state())))

    def test_dots_and_headlines(self):
        down = self.state(tvs=[{"name": "A", "kind": "lg", "ready": False}])
        self.assertEqual((menu.dot(down), menu.headline(down)), ("amber", "Running. 0 of 1 TVs reachable."))
        self.assertEqual(menu.dot(self.state(paused=True)), "grey")
        self.assertEqual(menu.headline(self.state(paused=True)), "Paused")
        self.assertEqual(menu.headline(self.state(running=False)), "Starting")
        self.assertEqual(menu.headline(self.state(tvs=[])), "Running. No TV added yet.")
        self.assertIn("Resume the helper", menu.labels(menu.build(self.state(paused=True))))

    def test_every_line_is_short_and_has_no_dashes(self):
        for it in menu.build(self.state()):
            label = it.get("label") or ""
            self.assertLessEqual(len(label.split()), 14)
            self.assertNotIn("—", label)
            self.assertNotIn("–", label)


class Deeplink(unittest.TestCase):
    def test_helper_on(self):
        self.assertEqual(deeplink.parse("couchtv://helper/on"), "on")
        self.assertEqual(deeplink.parse("couchtv-setup://helper/on?x=1"), "on")
        for bad in ("couchtv://helper/off", "couchtv://setup?handoff=ABCD-EFGH", "https://helper/on", "", None):
            self.assertIsNone(deeplink.parse(bad))
        self.assertEqual(deeplink.find(["app", "couchtv://helper/on"]), "on")
        self.assertIsNone(deeplink.find(["app"]))


class FakeProc:
    def __init__(self):
        self.dead = False

    def poll(self):
        return 0 if self.dead else None

    def terminate(self):
        self.dead = True

    def wait(self, t=None):
        return 0

    kill = terminate


class Bridge(unittest.TestCase):
    def test_backoff_grows_and_stops_at_a_minute(self):
        self.assertEqual([bridge_proc.backoff(n) for n in (0, 1, 2, 3, 5, 9)], [2, 2, 4, 8, 32, 60])

    def test_child_command_and_env(self):
        self.assertEqual(bridge_proc.child_command(True, "/x/app"), ["/x/app", "--bridge"])
        self.assertEqual(bridge_proc.child_command(False, "/x/py")[1:], ["-m", "couchtv_setup", "--bridge"])
        env = bridge_proc.child_env("/c.json", "/d", 5400, base={})
        self.assertEqual((env["COUCH_CONFIG"], env["COUCH_DATA"], env["PORT"]), ("/c.json", "/d", "5400"))

    def test_bridge_folder_exists_from_source(self):
        self.assertTrue((bridge_proc.bridge_dir() / "server.py").is_file())

    def test_supervisor_restarts_pauses_and_stops(self):
        made, now = [], [0]
        sup = bridge_proc.Supervisor(["x"], {}, popen=lambda *a, **k: made.append(FakeProc()) or made[-1], clock=lambda: now[0])
        sup.start_once()
        self.assertTrue(sup.alive())
        sup.start_once()
        self.assertEqual(len(made), 1)
        made[0].dead = True
        sup.start_once()
        self.assertEqual((len(made), sup.failures), (2, 1))
        sup.pause()
        self.assertTrue(sup.paused and not sup.alive())
        sup.resume()
        self.assertEqual(sup.failures, 0)
        now[0] = 500
        made[-1].dead = True
        sup.start_once()
        self.assertEqual(sup.failures, 0)    # the last one ran a long time: a good start
        sup.stop()
        self.assertFalse(sup.alive())


class Status(unittest.TestCase):
    def test_snapshot_uses_each_tvs_own_port(self):
        asked = []
        cfg = dict(hconfig.default(), tvs=[{"ip": "192.0.2.20", "kind": "samsung", "name": "Lounge"}])
        known = {"192.0.2.10": {"room": "Bedroom", "route": "tcp"}}

        def knock(host, port, timeout=1.0):
            asked.append((host, port))
            return host != "192.0.2.20"
        sup = type("S", (), {"alive": lambda s: True, "paused": False})()
        st = status.snapshot(cfg, known, sup, True, knock)
        self.assertIn(("192.0.2.20", 8002), asked)
        self.assertIn(("192.0.2.10", 5555), asked)
        self.assertEqual([(t["name"], t["ready"]) for t in st["tvs"]], [("Bedroom", True), ("Lounge", False)])
        self.assertTrue(st["running"])
        self.assertEqual(menu.dot(st), "amber")


class Controller(unittest.TestCase):
    def make(self):
        d = tempfile.mkdtemp()
        hconfig.turn_on(True, d)
        home = tempfile.mkdtemp()
        calls = []

        class Auto:
            enable = staticmethod(lambda: autostart.enable(["a", "--helper"], "linux", home))
            disable = staticmethod(lambda: autostart.disable("linux", home))
            is_enabled = staticmethod(lambda: autostart.is_enabled("linux", home))
        sup = bridge_proc.Supervisor(["x"], {}, popen=lambda *a, **k: FakeProc())
        ctl = control.Controller(d, sup, {}, Auto, opener=calls.append, spawn=calls.append, knock=lambda *a, **k: True)
        return ctl, d, home, calls, sup

    def test_actions(self):
        ctl, d, home, calls, sup = self.make()
        ctl.act("studio")
        ctl.act("setup")
        self.assertEqual(calls[0], menu.STUDIO_URL)
        ctl.act("autostart")
        self.assertTrue(autostart.is_enabled("linux", home))
        self.assertTrue(hconfig.load(d)["autostart"])
        ctl.act("autostart")
        self.assertFalse(autostart.is_enabled("linux", home))
        ctl.act("pause")
        self.assertTrue(sup.paused)
        ctl.act("pause")
        self.assertFalse(sup.paused)
        self.assertFalse(ctl.act("nope"))

    def test_turn_off_stops_everything_and_quits(self):
        ctl, d, home, calls, sup = self.make()
        autostart.enable(["a"], "linux", home)
        sup.start_once()
        ctl.act("off")
        self.assertFalse(sup.alive())
        self.assertFalse(autostart.is_enabled("linux", home))
        self.assertEqual(hconfig.load(d)["mode"], "once")
        self.assertTrue(ctl.quit_event.is_set())

    def test_setup_command(self):
        self.assertEqual(control.setup_command(True, "/x/app"), ["/x/app"])


class FallbackPage(unittest.TestCase):
    def test_the_browser_page_has_locks_and_the_same_menu(self):
        import threading
        import urllib.error
        import urllib.request
        from couchtv_setup.helper import fallback
        acted = []
        ctl = type("C", (), {"state": lambda s: {"running": True, "tvs": [], "paused": False},
                             "act": lambda s, i: acted.append(i) or True})()
        httpd, secret = fallback.make_server(ctl)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]

        def post(path, key=None, host=None):
            req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=b'{"id": "quit"}', method="POST")
            if key:
                req.add_header("X-Helper-Key", key)
            if host:
                req.add_header("Host", host)
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, None
        try:
            self.assertEqual(post("/api/state")[0], 403)
            self.assertEqual(post("/api/state", "wrong")[0], 403)
            self.assertEqual(post("/api/state", secret, "evil.example")[0], 403)
            code, body = post("/api/state", secret)
            self.assertEqual((code, body["dot"]), (200, "green"))
            self.assertIn("Quit", menu.labels(body["items"]))
            self.assertEqual(post("/api/act", secret)[0], 200)
            self.assertEqual(acted, ["quit"])
            page = urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=5).read().decode()
            self.assertIn(secret, page)
        finally:
            httpd.shutdown()


class PageApi(unittest.TestCase):
    def test_turn_on_and_off_through_the_page_api(self):
        server.S.intent = None
        home = tempfile.mkdtemp()
        old = (autostart.file_path, )
        # the page API writes through the real autostart module: point it at a temp home
        real_enable, real_disable, real_is = autostart.enable, autostart.disable, autostart.is_enabled
        autostart.enable = lambda *a, **k: real_enable(["a", "--helper"], "linux", home)
        autostart.disable = lambda *a, **k: real_disable("linux", home)
        autostart.is_enabled = lambda *a, **k: real_is("linux", home)
        try:
            st = server.api("POST", "/api/helper/on", {"autostart": True})
            self.assertEqual((st["mode"], st["autostart"]), ("helper", True))
            self.assertTrue(server.api("POST", "/api/info", {})["helper"]["autostart"])
            st = server.api("POST", "/api/helper/off", {})
            self.assertEqual((st["mode"], st["autostart"]), ("once", False))
        finally:
            autostart.enable, autostart.disable, autostart.is_enabled = real_enable, real_disable, real_is

    def test_add_tv_only_for_samsung_lg_roku(self):
        server.api("POST", "/api/helper/add-tv", {"ip": "192.0.2.50", "kind": "lg", "name": "LG"})
        self.assertEqual(hconfig.load()["tvs"][-1]["kind"], "lg")
        with self.assertRaises(server.TvError):
            server.api("POST", "/api/helper/add-tv", {"ip": "192.0.2.50", "kind": "vizio"})
        with self.assertRaises(server.TvError):
            server.api("POST", "/api/helper/add-tv", {"ip": "8.8.8.8", "kind": "lg"})

    def test_intent_from_the_deep_link(self):
        server.api("POST", "/api/helper/intent", {"intent": "helper"})
        self.assertEqual(server.api("POST", "/api/info", {})["helper"]["intent"], "helper")
        server.S.intent = None


if __name__ == "__main__":
    unittest.main()
