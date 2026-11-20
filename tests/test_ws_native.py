"""Widget settings, Group 5 (20 Nov 2026): Roku and Apple TV honesty.

A widget kind the Roku channel (roku/channel/components/DesignLib.brs) or the Apple TV app
(tvos/CouchTV/DesignView.swift) does not draw shows "<Widget name>: not on this TV" with the line "Shows on
Google TV, Android TV and Fire TV", never a label from the design (a surf widget's beach, an aircon's room).
The welcome widget drops couch-tv Studio's starter sample words, as the web home does (widgets.js
WELCOME_SAMPLE and WELCOME_SAMPLE_LINES).

The Roku part runs DesignLib.brs for real in the off-Roku interpreter (`npm ci --prefix roku`; skipped
without it). The Apple TV part reads DesignView.swift (its view cannot run off an Apple TV); the build is
tests/test_appletv_design.py's Build test, on the MacBook (COUCHTV_SWIFT_HOST)."""
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "roku" / "channel" / "components" / "DesignLib.brs"
VIEW = ROOT / "tvos" / "CouchTV" / "DesignView.swift"
MODEL = ROOT / "tvos" / "CouchTV" / "DesignModel.swift"
CAPS = ROOT / "tv-home" / "web" / "widget-caps.js"
WIDGETS = ROOT / "tv-home" / "web" / "widgets.js"
LINE = "Shows on Google TV, Android TV and Fire TV"

_spec = importlib.util.spec_from_file_location("roku_design_tests", Path(__file__).parent / "test_roku_design.py")
rd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rd)


def caps_names():
    """kind -> name, from widget-caps.js (the names Studio and the TV home use)."""
    src = CAPS.read_text()
    return dict(re.findall(r'^\s{4}([a-z]+): \{ name: "([^"]+)"', src, re.M))


def web_welcome_sample():
    src = WIDGETS.read_text()
    m = re.search(r"var WELCOME_SAMPLE = \{(.*?)\};", src)
    pairs = dict(re.findall(r'"([^"]+)": "([^"]+)"', m.group(1)))
    lines = re.findall(r'"([^"]+)"', re.search(r"var WELCOME_SAMPLE_LINES = \[(.*?)\];", src).group(1))
    return pairs, lines


def brs_list(name):
    m = re.search(r"function " + name + r"\(.*?\n(.*?)\nend function", LIB.read_text(), re.S)
    return m.group(1)


def native_kinds_roku():
    body = brs_list("dlWNative")
    return re.findall(r'"([a-z]+)"', body)


def swift_native():
    m = re.search(r"static let native: Set<String> = \[(.*?)\]", MODEL.read_text(), re.S)
    return re.findall(r'"([a-z]+)"', m.group(1))


def design(objects):
    return {"v": 1, "objects": objects}


def w(oid, kind, x, y, ww, hh, **opts):
    o = {"id": oid, "type": "widget", "kind": kind, "x": x, "y": y, "w": ww, "h": hh}
    if opts:
        o["opts"] = opts
    return o


class Words(unittest.TestCase):
    def test_roku_names_are_the_caps_names(self):
        names = caps_names()
        self.assertGreater(len(names), 60)
        body = brs_list("dlWName")
        roku = dict(re.findall(r'([a-z]+): "([^"]+)"', body))
        for kind, name in names.items():
            self.assertEqual(roku.get(kind), name, kind)

    def test_apple_tv_names_are_the_caps_names(self):
        names = caps_names()
        src = VIEW.read_text()
        m = re.search(r"enum DesignNotHere \{(.*?)\n\}", src, re.S)
        self.assertIsNotNone(m, "DesignNotHere in DesignView.swift")
        swift = dict(re.findall(r'"([a-z]+)": "([^"]+)"', m.group(1)))
        for kind, name in names.items():
            self.assertEqual(swift.get(kind), name, kind)
        self.assertIn('"' + LINE + '"', m.group(1))
        self.assertIn('": not on this TV"', m.group(1))

    def test_apple_tv_card_for_a_kind_not_drawn_never_takes_the_design_label(self):
        src = VIEW.read_text()
        body = re.search(r"struct DesignNotHereCard: View \{(.*?)\n\}", src, re.S).group(1)
        self.assertNotIn("label", body.replace("DesignNotHere", ""))
        call = re.search(r"if !DesignWidgets\.drawsNatively\(kind\) \{\s*\n\s*(.*)", src).group(1)
        self.assertTrue(call.startswith("DesignNotHereCard(kind: kind,"), call)
        self.assertNotIn("label", call)

    def test_welcome_samples_match_the_web_home(self):
        pairs, lines = web_welcome_sample()
        roku_text = dict(re.findall(r'"([^"]+)": "([^"]+)"', brs_list("dlWelcomeText")))
        roku_lines = re.findall(r'"([^"]+)"', brs_list("dlWelcomeLine").split("for each s in [", 1)[1].split("]", 1)[0])
        # every sample the web home strips is stripped here too (a greeting or a line)
        roku_all = set(roku_text) | set(roku_lines)
        for t in pairs:
            self.assertIn(t, roku_all)
        for t in lines + ["Headland House, North Point", "Three sleeps till the beach"]:
            self.assertIn(t, roku_lines)
        src = VIEW.read_text()
        m = re.search(r"enum DesignWelcomeSample \{(.*?)\n\}", src, re.S)
        self.assertIsNotNone(m)
        sw_text = dict(re.findall(r'"([^"]+)": "([^"]+)"', m.group(1).split("static let lines", 1)[0]))
        sw_lines = re.findall(r'"([^"]+)"', m.group(1).split("static let lines: [String] = [", 1)[1].split("]", 1)[0])
        self.assertEqual(sw_text, roku_text)
        self.assertEqual(sw_lines, roku_lines)

    def test_no_dashes_or_hedges_in_the_new_words(self):
        for t in [LINE, "not on this TV"]:
            self.assertIsNone(re.search(r"[–—]|coming soon|beta|experimental", t, re.I))


@unittest.skipUnless(rd.BRS.exists(), "the BrightScript interpreter is not installed: npm ci --prefix roku")
class RokuDraws(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        objs = [
            w("surf", "surf", 0, 0, 480, 360, label="North Point"),
            w("air", "aircon", 500, 0, 240, 160, label="Lounge"),
            w("news", "news", 760, 0, 200, 160),
            w("pill", "sports", 0, 400, 600, 40, label="NRL"),
            w("hi", "welcome", 0, 500, 900, 300, kicker="Headland House, North Point", text="Welcome, Ella and friends",
              sub="Three sleeps till the beach"),
            w("hi2", "welcome", 0, 820, 900, 200, kicker="Hello", text="Hi Ruby!", sub="Make yourselves at home"),
            w("own", "welcome", 1000, 500, 900, 300, text="Welcome, Smith family", sub="Tuesday to Sunday. Night two of five"),
            w("asText", "welcome", 1000, 820, 900, 200, text="Headland House, North Point"),
            w("clock", "clock", 1000, 0, 480, 240),
        ]
        cls.lay = rd.run_brs([("layout", [design(objs), rd.CTX])])[0]["layout"]
        cls.labels = [i for i in rd.items(cls.lay) if i["k"] == "label"]
        cls.t = [i["text"] for i in cls.labels]

    def inside(self, x, y, ww, hh):
        return [i["text"] for i in self.labels if x <= i["x"] and i["x"] + i["w"] <= x + ww and y <= i["y"] < y + hh]

    def test_a_kind_not_drawn_says_so_by_name(self):
        surf = " ".join(self.inside(0, 0, 480, 360))
        self.assertIn("Surf: not on this TV", surf)
        self.assertIn(LINE, surf)
        air = " ".join(self.inside(500, 0, 240, 160))
        self.assertIn("Aircon:", air)
        self.assertIn("not on this TV", air)
        news = " ".join(self.inside(760, 0, 200, 160))
        self.assertIn("Headlines:", news)

    def test_never_a_label_from_the_design(self):
        for word in ("North Point", "Lounge", "NRL"):
            self.assertFalse([t for t in self.t if word in t], word)

    def test_a_short_pill_has_the_title_alone_inside_its_box(self):
        pill = [i for i in self.labels if i["y"] >= 400 and i["y"] < 440 and i["x"] < 600]
        self.assertEqual([i["text"] for i in pill], ["Scores: not on this TV"])
        self.assertLessEqual(pill[0]["y"] + pill[0]["h"], 441)

    def test_words_fit_their_boxes(self):
        for i in self.labels:
            self.assertGreaterEqual(i["size"], 12)

    def test_welcome_starter_words_never_show(self):
        joined = " | ".join(self.t)
        for word in ("Ella", "Ruby", "Headland House", "Three sleeps", "Night two of five"):
            self.assertNotIn(word, joined)
        self.assertIn("Welcome", self.t)
        self.assertIn("Hi!", self.t)
        self.assertIn("HELLO", self.t)                       # a kicker of the person's own stays
        self.assertIn("Make yourselves at home", self.t)
        self.assertIn("Welcome, Smith family", self.t)       # a greeting typed in Studio stays as typed

    def test_kinds_drawn_here_are_unchanged(self):
        self.assertTrue([t for t in self.t if re.match(r"^\d{1,2}:\d\d$", t)])   # the clock
        self.assertEqual(len(native_kinds_roku()), 26)


if __name__ == "__main__":
    unittest.main()
