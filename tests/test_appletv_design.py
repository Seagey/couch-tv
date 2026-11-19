"""Couch TV on the Apple TV draws a couch-tv Studio design natively (tvos/CouchTV/DesignModel.swift, DesignView.swift,
DesignStore.swift). These check that the Xcode project has the files, that the app builds for the tvOS Simulator
(skipped without Xcode), and the design gate itself: tvos/Tests/DesignCheck.swift is compiled with DesignModel.swift
into a small checker that prints what the gate made of each case as JSON.

The checker needs a working Swift compiler. Without one here (no Xcode, or command line tools that cannot build
Foundation), set COUCHTV_SWIFT_HOST to a Mac reachable by ssh that has one, and the two files are compiled there;
otherwise those tests skip and say why."""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TVOS = ROOT / "tvos"
APP = TVOS / "CouchTV"
MODEL = APP / "DesignModel.swift"
CHECK = TVOS / "Tests" / "DesignCheck.swift"
PRESETS = ROOT / "tests" / "fixtures" / "design-presets.json"
SHOWCASE = ROOT / "tests" / "fixtures" / "designs-tvos" / "showcase.json"
NEW_FILES = ["DesignModel.swift", "DesignView.swift", "DesignStore.swift"]
BANNED = re.compile(r"coming soon|not supported|unsupported|\bbeta\b|untested", re.I)


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def local_swiftc_works(tmp):
    if not shutil.which("xcrun"):
        return False
    probe = Path(tmp) / "probe.swift"
    probe.write_text('import Foundation\nprint(Date() > Date.distantPast)\n')
    r = run(["xcrun", "swiftc", "-o", str(Path(tmp) / "probe"), str(probe)])
    return r.returncode == 0


def checker(cases):
    """Compile the checker (here, or on COUCHTV_SWIFT_HOST) and run it on the cases. None when no compiler works."""
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "cases.json").write_text(json.dumps(cases))
        if local_swiftc_works(tmp):
            out = Path(tmp) / "design-check"
            r = run(["xcrun", "swiftc", "-parse-as-library", "-o", str(out), str(MODEL), str(CHECK)])
            if r.returncode:
                raise AssertionError("DesignModel.swift did not compile:\n" + r.stderr[-4000:])
            r = run([str(out), str(Path(tmp) / "cases.json")])
        else:
            host = os.environ.get("COUCHTV_SWIFT_HOST")
            if not host:
                return None
            remote = "couchtv-design-check"
            ssh = ["ssh", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes", host]
            if run(ssh + ["mkdir", "-p", remote]).returncode:
                return None
            r = run(["scp", "-q", str(MODEL), str(CHECK), str(Path(tmp) / "cases.json"), f"{host}:{remote}/"])
            if r.returncode:
                return None
            r = run(ssh + [f"cd {remote} && xcrun swiftc -parse-as-library -o design-check DesignModel.swift DesignCheck.swift"
                           " && ./design-check cases.json"], timeout=600)
        if r.returncode:
            raise AssertionError("the checker failed:\n" + (r.stderr or r.stdout)[-4000:])
        return json.loads(r.stdout)


JPEG = "data:image/jpeg;base64," + base64.b64encode(bytes([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]) + b"JFIF").decode()
PNG_AS_JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()

CASES = {
    "designs": {
        "clamped": {
            "background": {"image": "backgrounds/scene-night.jpg", "darken": 5, "zoom": 0.2, "blur": 99, "x": "30", "scrim": "sideways"},
            "elements": {"clock": {"scale": 50, "x": 99999, "format": "25h", "colour": "red"},
                         "dock": {"scale": 0.1, "opacity": 0.01},
                         "date": {"format": "full", "colour": "#ffe9c7", "font": "comic"},
                         "toaster": {"x": 1}},
            "objects": [
                {"id": "w1", "type": "widget", "kind": "clock", "x": -9999, "y": 10, "w": 5000, "h": 2, "scale": 4, "rotate": 90},
                {"id": "t1", "type": "text", "text": "Hello there", "size": 400, "scale": 5},
                {"id": "s1", "type": "shape", "variant": "glass", "w": 99999, "h": 0, "radius": -4, "colour": "rgb(10, 20, 30)"},
            ],
        },
        "kinds": {
            "objects": [
                {"id": "nat", "type": "widget", "kind": "analog", "x": 0, "y": 0, "w": 300, "h": 300},
                {"id": "fall", "type": "widget", "kind": "nowplaying", "x": 0, "y": 0, "w": 300, "h": 300},
                {"id": "made-up", "type": "widget", "kind": "teleporter", "x": 0, "y": 0, "w": 300, "h": 300},
                {"id": "smart1", "type": "smart", "kind": "fridge"},
                {"id": "stack1", "type": "widget", "kind": "stack", "items": [{"kind": "clock"}, {"kind": "stack"}, {"kind": "nope"}, {"kind": "news"}], "turn": 10},
                {"id": "stack2", "type": "widget", "kind": "stack", "items": [{"kind": "nope"}]},
                {"id": "wc", "type": "widget", "kind": "worldclock", "opts": {"cities": ["Europe/London", "javascript:alert(1)", "../etc"], "label": "Family 2"}},
                {"id": "cd", "type": "widget", "kind": "countdown", "opts": {"month": 13, "label": "Christmas"}},
                {"id": "fold", "type": "widget", "kind": "folder", "opts": {"apps": ["netflix", "__proto__", "x" * 40, "has space"]}},
            ],
        },
        "hostile": {
            "background": {"image": "https://evil.example/x.jpg", "colour": "url(javascript:1)"},
            "look": {"ink": "expression(1)", "panel": "rgba(10, 20, 30, 0.5)"},
            "texts": [{"text": "Ring 1800 123 456"}, {"text": "Line one\nCall 1300 000 000\nLine three"}, {"text": "Visit evil.com/x"}],
            "objects": [{"id": "__proto__", "type": "text", "text": "x"}, {"id": "ok", "type": "text", "text": "Fine words"},
                        {"id": "ok", "type": "text", "text": "Same id twice"}, {"id": "n", "type": "text", "text": 42},
                        {"id": "bad", "type": "bogus"}, "not an object", None, 7]
                       + [{"id": f"o{i}", "type": "shape"} for i in range(60)],
            "apps": {"order": ["c", "a", "zz", 3], "hidden": ["b"]},
        },
        "gradient": {"background": {"colour": "#ff7a59", "colour2": "#7b5cff", "angle": 999, "radial": "yes"}},
        "not-a-dict": [1, 2, 3],
    },
    "codes": ["abcde-fghjk", "ABCDE FGHJK", "ABCDEFGHJK", "ABCDE-FGHJ1", "ABCDE-FGHJKL", "CTV1-" + "A" * 43, "a" * 43,
              "CTV1-" + "A" * 42 + "!", "", "  23456-789AB  "],
    "colours": ["#fff", "#ff000080", "rgb(255, 0, 0)", "rgba(0, 0, 0, 0.5)", "rgb(100%, 0%, 0%)", "red", "#ggg",
                "url(x)", "  #123456  ", 12, None],
    "words": ["Hello world", "Happy 4th birthday", "Line one\nLine 2\nLine three", "email me@home", "Café crème",
              "ＦＵＬＬ width", "tab\there", 5],
    "stores": [{}, {"design_store": ""}, {"design_store": "https://store.example.com/"}, {"design_store": "http://evil.example"},
               {"design_store": "http://127.0.0.1:5490"}, {"design_store": "https://x.example/path"}, None],
    "answers": [
        json.dumps({"design": {"background": {"image": JPEG}}}),
        json.dumps({"design": {"background": {"image": PNG_AS_JPEG}}}),
        json.dumps({"design": {"background": {"image": "backgrounds/scene-fog.jpg", "video": "store:abc"}}}),
        json.dumps({"design": {"background": {"image": "https://evil.example/a.jpg"}}}),
        json.dumps({"nodesign": {}}),
        json.dumps({"design": [1]}),
        "not json",
    ],
    "dates": ["short", "numeric", "weekday", "day_month", "full", "nonsense"],
}


class Project(unittest.TestCase):
    def test_project_has_every_swift_file(self):
        pbx = (TVOS / "CouchTV.xcodeproj" / "project.pbxproj").read_text()
        for f in NEW_FILES:
            self.assertIn(f, pbx, f"{f} is missing from the project: run python3 tvos/make-project.py")
            self.assertTrue((APP / f).exists())
        for f in APP.glob("*.swift"):
            self.assertIn(f.name, pbx, f"{f.name} is not in the project: run python3 tvos/make-project.py")

    def test_the_checker_is_not_in_the_app(self):
        self.assertNotIn("DesignCheck.swift", (TVOS / "CouchTV.xcodeproj" / "project.pbxproj").read_text())

    def test_the_model_has_no_ui(self):
        src = MODEL.read_text()
        self.assertNotIn("import SwiftUI", src)
        self.assertNotIn("import UIKit", src)
        self.assertIn("import Foundation", src)

    def test_the_app_shows_a_design_and_settings_has_the_choices(self):
        app = (APP / "CouchTVApp.swift").read_text()
        self.assertIn("DesignHomeView()", app)
        self.assertIn("DesignAskView", app)
        settings = (APP / "SettingsView.swift").read_text()
        self.assertIn('"Get a design"', settings)
        self.assertIn('"Plain home"', settings)
        view = (APP / "DesignView.swift").read_text()
        self.assertIn("Use this design?", view)
        self.assertIn('answer("Yes"', view)
        self.assertIn('answer("No"', view)
        self.assertIn("GeometryReader", view)
        self.assertIn("DesignLayout.factor(width:", view)

    def test_the_bridge_config_design_is_read(self):
        model = (APP / "HomeModel.swift").read_text()
        self.assertIn("readDesign(config: cfg)", model)
        store = (APP / "DesignStore.swift").read_text()
        self.assertIn('"/v1/designs/fetch"', store)
        self.assertIn("UserDefaults", store)
        self.assertIn("cachesDirectory", store)

    def test_the_default_store_matches_the_web_home(self):
        gate = (ROOT / "tv-home" / "web" / "designer-gate.js").read_text()
        web = re.search(r'DEFAULT_STORE = "([^"]+)"', gate).group(1)
        self.assertIn(f'defaultStore = "{web}"', MODEL.read_text())

    def test_the_widget_kinds_match_the_web_gate(self):
        js = (ROOT / "tv-home" / "web" / "design.js").read_text()
        block = re.search(r"var WKINDS = \[(.*?)\];", js, re.S).group(1)
        web = re.findall(r'"([a-z]+)"', block)
        swift = re.search(r"static let kinds = \[(.*?)\]\n", MODEL.read_text(), re.S).group(1)
        self.assertEqual(web, re.findall(r'"([a-z]+)"', swift))

    def test_no_placeholder_words(self):
        for f in NEW_FILES:
            self.assertIsNone(BANNED.search((APP / f).read_text()), f)
        doc = (ROOT / "docs" / "APPLE-TV.md").read_text()
        part = doc.split("## A design from couch-tv Studio", 1)[1].split("\n## ", 1)[0]
        self.assertIsNone(BANNED.search(part))
        self.assertNotIn("—", part)
        self.assertNotIn("–", part)


@unittest.skipUnless(shutil.which("xcodebuild") and run(["xcodebuild", "-version"]).returncode == 0,
                     "xcodebuild (full Xcode) is not installed here")
class Build(unittest.TestCase):
    def test_builds_for_the_tvos_simulator(self):
        with tempfile.TemporaryDirectory() as dd:
            r = run(["xcodebuild", "-project", str(TVOS / "CouchTV.xcodeproj"), "-scheme", "CouchTV",
                     "-destination", "generic/platform=tvOS Simulator", "-derivedDataPath", dd,
                     "CODE_SIGNING_ALLOWED=NO", "build"], timeout=1800)
            self.assertEqual(r.returncode, 0, r.stdout[-4000:] + r.stderr[-2000:])
            self.assertIn("BUILD SUCCEEDED", r.stdout)


class Gate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cases = json.loads(json.dumps(CASES))
        for name, path in (("preset", PRESETS), ("showcase", SHOWCASE)):
            if path.exists():
                for p in json.loads(path.read_text()):
                    cases["designs"][f"{name}:{p['id']}"] = p["design"]
        cls.out = checker(cases)

    def setUp(self):
        if self.out is None:
            self.skipTest("no working Swift compiler here; set COUCHTV_SWIFT_HOST to a Mac with one")

    def obj(self, design, oid):
        return next((o for o in self.out["designs"][design]["objects"] if o["id"] == oid), None)

    def test_numbers_are_clamped(self):
        d = self.out["designs"]["clamped"]
        bg = d["background"]
        self.assertEqual((bg["darken"], bg["zoom"], bg["blur"]), (0.9, 1, 16))
        self.assertIsNone(bg["scrim"])
        clock = d["elements"]["clock"]
        self.assertEqual(clock["scale"], 3)                 # the home's parts can grow, not cover the screen
        self.assertEqual(clock["x"], 3840)
        self.assertIsNone(clock["format"])
        self.assertIsNone(clock["colour"])
        self.assertEqual(d["elements"]["dock"]["scale"], 0.5)     # the dock stays usable
        self.assertEqual(d["elements"]["dock"]["opacity"], 0.4)
        self.assertIsNone(d["elements"]["date"]["font"])
        self.assertEqual(d["elements"]["date"]["format"], "full")
        self.assertNotIn("toaster", d["elements"])
        w = self.obj("clamped", "w1")
        self.assertEqual((w["x"], w["w"], w["h"], w["scale"], w["rotate"]), (-3840, 1760, 40, 1, 0))
        self.assertEqual(self.obj("clamped", "t1")["scale"], 0.75)  # 400 px words cut to 300 px
        s = self.obj("clamped", "s1")
        self.assertEqual((s["w"], s["h"], s["colour"]), (3840, 1, "rgb(10, 20, 30)"))

    def test_unknown_kinds_get_a_plain_card_and_known_ones_without_live_data_get_a_titled_card(self):
        self.assertTrue(self.obj("kinds", "nat")["native"])
        fall = self.obj("kinds", "fall")
        self.assertFalse(fall["native"])
        self.assertEqual(fall["title"], "Now playing")
        made_up = self.obj("kinds", "made-up")   # keeps its place, its own name is never drawn
        self.assertEqual((made_up["kind"], made_up["native"], made_up["title"]), ("other", False, "Widget"))
        self.assertEqual(self.obj("kinds", "smart1")["kind"], "light")
        self.assertEqual(self.obj("kinds", "stack1")["items"], ["clock", "news"])
        self.assertIsNone(self.obj("kinds", "stack2"))
        for kind, title in self.out["fallback"]:
            self.assertTrue(title and not BANNED.search(title), kind)

    def test_options_are_checked(self):
        wc = self.obj("kinds", "wc")["opts"]
        self.assertEqual(wc["cities"], ["Europe/London"])
        self.assertEqual(wc["label"], "")                 # a label with a digit is dropped
        self.assertEqual(self.obj("kinds", "cd")["opts"]["month"], 12)
        self.assertEqual(self.obj("kinds", "fold")["opts"]["apps"], ["netflix"])

    def test_hostile_design(self):
        d = self.out["designs"]["hostile"]
        self.assertNotIn("background", d)
        self.assertIsNone(d["look"]["ink"])
        self.assertEqual(d["look"]["panel"], "rgba(10, 20, 30, 0.5)")
        # a line with a number goes; words with a web address go whole (design.js scam)
        self.assertEqual([t["text"] for t in d["texts"]], ["Line one\nLine three"])
        self.assertNotIn("1800", json.dumps(d))
        ids = [o["id"] for o in d["objects"]]
        self.assertNotIn("__proto__", ids)
        self.assertEqual(ids.count("ok"), 1)
        self.assertNotIn("n", ids)
        self.assertLessEqual(len(ids), 40)
        self.assertEqual(d["apps"]["order"], ["c", "a", "zz"])
        self.assertEqual(d["order"], ["c", "a", "d"])     # the design's order first, hidden apps gone

    def test_gradient(self):
        bg = self.out["designs"]["gradient"]["background"]
        self.assertEqual((bg["colour"], bg["colour2"], bg["angle"]), ("#ff7a59", "#7b5cff", 360))

    def test_not_a_design(self):
        self.assertIsNone(self.out["designs"]["not-a-dict"])

    def test_every_preset_reads(self):
        names = [k for k in self.out["designs"] if k.startswith(("preset:", "showcase:"))]
        if not names:
            self.skipTest("no design fixtures")
        for k in names:
            self.assertIsNotNone(self.out["designs"][k], k)
            self.assertTrue(self.out["designs"][k]["objects"], k)

    def test_codes(self):
        self.assertEqual(self.out["codes"], ["ABCDE-FGHJK", "ABCDE-FGHJK", "ABCDE-FGHJK", None, None, "CTV1-" + "A" * 43,
                                             "CTV1-" + "a" * 43, None, None, "23456-789AB"])

    def test_colours(self):
        c = self.out["colours"]
        self.assertEqual(c[0], ["#fff", 1, 1, 1, 1])
        self.assertEqual(c[1][4], 0.502)
        self.assertEqual(c[2], ["rgb(255, 0, 0)", 1, 0, 0, 1])
        self.assertEqual(c[3][4], 0.5)
        self.assertEqual(c[4], ["rgb(100%, 0%, 0%)", 1, 0, 0, 1])
        self.assertEqual(c[5:8], [None, None, None])
        self.assertEqual(c[8][0], "#123456")
        self.assertEqual(c[9:], [None, None])

    def test_words(self):
        self.assertEqual(self.out["words"], ["Hello world", "", "Line one\nLine three", "", "Café crème", "FULL width", "tab here", None])

    def test_store(self):
        self.assertEqual(self.out["stores"], ["https://tvdesigner.sites.underseage.studio", "", "https://store.example.com", "",
                                              "http://127.0.0.1:5490", "", "https://tvdesigner.sites.underseage.studio"])

    def test_only_the_design_and_a_real_jpeg_are_kept(self):
        a = self.out["answers"]
        self.assertEqual(a[0], {"image": JPEG})
        self.assertEqual(a[1], {"image": None})
        self.assertEqual(a[2], {"image": "backgrounds/scene-fog.jpg"})
        self.assertEqual(a[3], {"image": None})
        self.assertEqual(a[4:], [None, None, None])

    def test_messages(self):
        m = self.out["messages"]
        self.assertIn("did not work", m[0])
        self.assertIn("Too many tries", m[1])
        self.assertIn("paused", m[2])
        self.assertIn("Could not reach", m[3])

    def test_dates_and_times(self):
        self.assertEqual(self.out["dates"], ["Tue 27 Oct", "27/10/2026", "Tuesday", "27 October", "Tuesday 27 October 2026",
                                             "Tuesday 27 October"])
        self.assertEqual((self.out["time12"], self.out["time24"]), ("8:05", "20:05"))
        self.assertEqual(self.out["words_time"], "Five past eight")
        self.assertEqual(self.out["countdown"], 59)

    def test_scale_to_the_view(self):
        self.assertEqual(self.out["factor"], [1, 0.5, 2])

    def test_native_kinds(self):
        for k in ["clock", "analog", "date", "month", "weather", "bigtemp", "photo", "keep", "app", "folder", "dock", "people",
                  "quick", "card", "quote", "welcome", "countdown", "worldclock", "stack"]:
            self.assertIn(k, self.out["native"])


if __name__ == "__main__":
    unittest.main()
