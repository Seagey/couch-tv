"""The TV's own MCP tools for a design's widgets (bridge/mcp_server.py list_widgets, set_widget_setting),
against the bridge's real handlers (tests/phone_page_standin.py) and a stand-in TV home that answers the
way app.js does (atHomeView, designEdit): list, then change one setting, then list again. Only settings
in widget-caps.js a phone may change are sent (bridge/widget_settings.json, which must match it), the
pairing key guards it like every other tool, and a TV home that is not open gets plain words.

  .venv/bin/python -m unittest tests/test_mcp_widgets.py
"""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import mcp_server  # noqa: E402

KEY = "test-key-widgets-0139"
VIEW = {"note": None, "lists": [], "design": {"on": True, "hide": [], "widgets": [
    {"key": "wx|0", "kind": "weather", "name": "Weather", "title": "Weather, top right", "settings": [
        {"key": "town", "label": "Place", "type": "place", "value": None, "words": "Home town"},
        {"key": "hilo", "label": "Show the high and low", "type": "toggle", "value": True},
        {"key": "degrees", "label": "Temperature in", "type": "choice", "value": "c", "options": [["c", "Celsius"], ["f", "Fahrenheit"]]}]},
    {"key": "ck|0", "kind": "clock", "name": "Digital clock", "title": "Digital clock, top left", "settings": [
        {"key": "seconds", "label": "Show seconds", "type": "toggle", "value": False}]}]}}


class TvHome(threading.Thread):
    """Asks the bridge for the phone's changes as the TV home does (GET /api/phone/inbox), applies a
    widget_set to its view (checking the setting is on the widget, as designEdit does) and answers."""
    def __init__(self, base):
        super().__init__(daemon=True)
        self.base, self.view, self.stop, self.seen = base, copy.deepcopy(VIEW), threading.Event(), []

    def req(self, method, path, payload=None):
        r = urllib.request.Request(self.base + path, method=method, data=json.dumps(payload).encode() if payload is not None else None)
        r.add_header("Authorization", "Bearer " + KEY)
        if payload is not None:
            r.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(r, timeout=10) as f:
            return json.loads(f.read())

    def run(self):
        self.req("POST", "/api/phone/view", {"athome": self.view})
        while not self.stop.is_set():
            for e in self.req("GET", "/api/phone/inbox").get("edits", []):
                self.seen.append(e["edit"])
                ws = e["edit"].get("widget_set") or {}
                w = next((x for x in self.view["design"]["widgets"] if x["key"] == ws.get("key")), None)
                result = {"ok": False, "error": "That widget is not on the home now."}
                if w:
                    for k, v in (ws.get("values") or {}).items():
                        s = next((x for x in w["settings"] if x["key"] == k), None)
                        if s is None:
                            result = {"ok": False, "error": "That setting is not on this widget."}
                            break
                        if s["type"] == "choice" and v not in [o[0] for o in s.get("options", [])]:
                            result = {"ok": False, "error": "That choice is not one of the choices."}
                            break
                        s["value"] = v
                    else:
                        result = {"ok": True, "athome": self.view}
                self.req("POST", "/api/phone/view", {"athome": self.view})
                self.req("POST", "/api/phone/done", {"id": e["id"], "result": result})
            time.sleep(0.1)


class McpWidgets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = tempfile.mkdtemp(prefix="couch-mcp-widgets-")
        cls.proc = subprocess.Popen([sys.executable, os.path.join(HERE, "phone_page_standin.py"), cls.data, KEY],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        line = cls.proc.stdout.readline()
        if not line.startswith("PORT"):
            cls.proc.kill()
            raise RuntimeError("the stand-in bridge did not start: " + line)
        cls.base = "http://127.0.0.1:" + line.split()[1]
        mcp_server.BRIDGE, mcp_server.KEY, mcp_server.TV_ID, mcp_server.ASK_ID = cls.base, KEY, None, None

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait()
        shutil.rmtree(cls.data, ignore_errors=True)

    def setUp(self):
        mcp_server.KEY = KEY

    def test_1_tv_home_closed_says_what_to_do(self):
        # before the TV home has asked: plain words and what to do, and nothing is queued for later
        r = mcp_server.list_widgets()
        self.assertEqual(r, {"ok": False, "error": mcp_server.TV_CLOSED})
        self.assertIn("Open Couch TV on the TV, then try again", r["error"])
        self.assertEqual(mcp_server.set_widget_setting("wx|0", "hilo", False)["error"], mcp_server.TV_CLOSED)

    def test_2_list_set_list(self):
        tv = TvHome(self.base)
        tv.start()
        try:
            for _ in range(50):
                if mcp_server.list_widgets().get("ok"):
                    break
                time.sleep(0.1)
            r = mcp_server.list_widgets()
            self.assertTrue(r["ok"], r)
            self.assertEqual([w["key"] for w in r["widgets"]], ["wx|0", "ck|0"])
            wx = r["widgets"][0]
            self.assertEqual((wx["kind"], wx["where"]), ("weather", "Weather, top right"))
            self.assertEqual([s["key"] for s in wx["settings"]], ["town", "hilo", "degrees"])
            self.assertEqual(wx["settings"][2]["choices"], [{"value": "c", "words": "Celsius"}, {"value": "f", "words": "Fahrenheit"}])

            place = {"name": "Byron Bay", "area": "New South Wales, Australia", "lat": -28.64, "lon": 153.61}
            s = mcp_server.set_widget_setting("wx|0", "town", place)
            self.assertTrue(s["ok"], s)
            self.assertEqual(s["setting"]["value"], place)
            self.assertEqual(tv.seen[-1], {"widget_set": {"key": "wx|0", "values": {"town": place}}})
            self.assertTrue(mcp_server.set_widget_setting("ck|0", "seconds", True)["ok"])

            again = {w["key"]: {x["key"]: x["value"] for x in w["settings"]} for w in mcp_server.list_widgets()["widgets"]}
            self.assertEqual(again["wx|0"]["town"], place)
            self.assertIs(again["ck|0"]["seconds"], True)

            # the TV's own check: a value that is not one of the choices is refused in its words
            bad = mcp_server.set_widget_setting("wx|0", "degrees", "kelvin")
            self.assertEqual(bad, {"ok": False, "error": "That choice is not one of the choices."})

            # never sent: a setting widget-caps.js does not have, or one the phone may not change
            n = len(tv.seen)
            for setting in ("colour", "image", "__proto__"):
                no = mcp_server.set_widget_setting("wx|0", setting, "x")
                self.assertFalse(no["ok"])
                self.assertIn("Weather has no setting called " + setting + ". Its settings: town, place, hilo, degrees.", no["error"])
            missing = mcp_server.set_widget_setting("surf|9", "place", "x")
            self.assertIn("not on the TV home now", missing["error"])
            self.assertEqual(len(tv.seen), n)
        finally:
            tv.stop.set()
            tv.join(5)

    def test_3_the_pairing_key_guards_it(self):
        mcp_server.KEY = "wrong-key-wrong-key"
        for r in (mcp_server.list_widgets(), mcp_server.set_widget_setting("wx|0", "hilo", False)):
            self.assertFalse(r["ok"])
            self.assertEqual(r.get("error_key"), "err_invalid_pairing_key", r)

    def test_settings_file_matches_widget_caps(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        p = subprocess.run([node, os.path.join(ROOT, "scripts", "widget-settings-json.mjs"), "--check"], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        kinds = mcp_server.widget_settings()
        self.assertNotIn("image", [s["key"] for s in kinds["photo"]["settings"]])
        self.assertIn("town", [s["key"] for s in kinds["weather"]["settings"]])


if __name__ == "__main__":
    unittest.main()
