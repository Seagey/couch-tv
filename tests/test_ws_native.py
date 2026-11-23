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
            w("small", "energy", 1600, 0, 180, 180),
            w("tiny", "commute", 1600, 300, 150, 120),
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
        # the width DesignLib.brs reckons with (dlTextWidth: characters x size x 0.54 for Inter Medium,
        # 0.52 for Inter Regular) is inside each label's box, and every size is one a TV can read
        k = {"Inter-Medium": 0.54, "Inter-Regular": 0.52, "Antonio-Light": 0.4}
        notes = [i for i in self.labels if "not on this TV" in i["text"] or i["text"].startswith("Shows on")
                 or i["text"] in ("not on this TV", "Android TV and Fire TV")]
        self.assertGreater(len(notes), 6)
        for i in notes:
            widest = max(len(l) for l in i["text"].split("\n"))
            self.assertLessEqual(widest * i["size"] * k[i["font"]], i["w"] + 1, i)
            self.assertGreaterEqual(i["size"], 12, i)

    def test_a_small_box_has_the_title_and_the_line_only_when_it_reads(self):
        small = " ".join(self.inside(1600, 0, 180, 180))
        self.assertIn("Solar and energy", small)
        for i in self.labels:
            if i["text"].startswith("Shows on") or i["text"] == "Android TV and Fire TV":
                self.assertGreaterEqual(i["size"], 18, i)
        tiny = self.inside(1600, 300, 150, 120)
        self.assertTrue(tiny and "Commute" in " ".join(tiny))

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
        self.assertEqual(len(native_kinds_roku()), 25)

    def test_family_note_is_not_on_a_roku(self):
        # it used to draw the word "Note": the note lives in the web home's own store, which a Roku lacks
        self.assertNotIn("note", native_kinds_roku())
        lay = rd.run_brs([("layout", [design([w("n", "note", 0, 0, 480, 360)]), rd.CTX])])[0]["layout"]
        t = " ".join(i["text"] for i in rd.items(lay) if i["k"] == "label")
        self.assertIn("Family note: not on this TV", t)


@unittest.skipUnless(rd.BRS.exists(), "the BrightScript interpreter is not installed: npm ci --prefix roku")
class RokuStack(unittest.TestCase):
    """A smart stack on a Roku takes turns: the next widget each minute, counted from midnight."""
    def layout(self, mi):
        ctx = dict(rd.CTX, now=dict(rd.NOW, mi=mi))
        st = {"id": "st", "type": "widget", "kind": "stack", "x": 0, "y": 0, "w": 900, "h": 300,
              "items": [{"kind": "welcome", "opts": {"text": "First words"}}, {"kind": "welcome", "opts": {"text": "Second words"}}]}
        r = rd.run_brs([("layout", [design([st]), ctx])])[0]
        return " ".join(i["text"] for i in rd.items(r["layout"]) if i["k"] == "label"), r["time"]

    def test_it_moves_on_each_minute(self):
        a, time_a = self.layout(5)     # 21:05 is minute 1265 of the day: the second widget
        b, _ = self.layout(6)
        self.assertIn("Second words", a)
        self.assertNotIn("First words", a)
        self.assertIn("First words", b)
        self.assertTrue(time_a, "a stack of two is drawn again each minute")


ORIGINAL = {"v": 1, "home": {"dock": "classic"}, "elements": {"clock": {"at": "scene", "behind": True}}}


class AppleTvSceneClock(unittest.TestCase):
    """The Couch Original template (clock.at "scene", behind, no background): the Apple TV draws the built in
    scenes themselves (SceneBackdrop: the clock behind the hills, on the water of the Waterline scene), and
    the design's home.scenes picks one scene or several taking turns. Checked through the gate on
    COUCHTV_SWIFT_HOST, plus the view's source."""
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("appletv_design_tests", Path(__file__).parent / "test_appletv_design.py")
        at = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(at)
        cls.out = at.checker({"designs": {
            "original": ORIGINAL,
            "one": dict(ORIGINAL, home={"scenes": ["water"]}),
            "bad": dict(ORIGINAL, home={"scenes": ["night", "../x", "Fog", "__proto__x" * 9, 3]}),
            "photo": dict(ORIGINAL, background={"image": "backgrounds/scene-night.jpg"}),
            "plain": {"v": 1, "elements": {"clock": {"at": "somewhere", "behind": "yes"}}},
            "hidden": {"v": 1, "elements": {"clock": {"at": "scene", "hidden": True}}}}})

    def setUp(self):
        if self.out is None:
            self.skipTest("no working Swift compiler here; set COUCHTV_SWIFT_HOST to a Mac with one")

    def d(self, name):
        return self.out["designs"][name]

    def test_the_original_keeps_at_and_behind_and_uses_the_scenes(self):
        c = self.d("original")["elements"]["clock"]
        self.assertEqual((c["at"], c["behind"]), ("scene", True))
        self.assertTrue(self.d("original")["home"]["sceneClock"])
        self.assertEqual(self.d("original")["home"]["scenes"], [])

    def test_one_scene_or_several(self):
        self.assertEqual(self.d("one")["home"]["scenes"], ["water"])
        self.assertEqual(self.d("bad")["home"]["scenes"], ["night"])

    def test_a_background_or_another_at_keeps_the_designs_own_clock(self):
        self.assertFalse(self.d("photo")["home"]["sceneClock"])
        self.assertFalse(self.d("plain")["home"]["sceneClock"])
        self.assertIsNone(self.d("plain")["elements"]["clock"]["at"])
        self.assertIsNone(self.d("plain")["elements"]["clock"]["behind"])
        self.assertFalse(self.d("hidden")["home"]["sceneClock"])

    def test_the_view_draws_the_scene_and_no_second_clock(self):
        src = VIEW.read_text()
        self.assertRegex(src, r"if d\.sceneClock \{[^}]*SceneBackdrop\(look: look")
        self.assertIn('if d.shows("clock") && !d.sceneClock {', src)
        self.assertIn("design.home.scenes.filter", src)
        self.assertIn("mine[model.sceneTurn % mine.count]", src)
        self.assertIn("DesignBackdrop(background: d.background, look: sceneLook)", src)
        self.assertRegex(src, r"if d\.sceneClock && d\.shows\(\"date\"\) \{\s*\n[^\n]*\n\s*DateLine\(look: sceneLook, date: date\)")
        model = (ROOT / "tvos" / "CouchTV" / "HomeModel.swift").read_text()
        self.assertRegex(model, r"self\.sceneTurn &\+= 1 \}\s*\n\s*guard self\.scenes\.count > 1")

    def test_the_not_here_card_shows_its_line_only_where_it_reads(self):
        body = re.search(r"struct DesignNotHereCard: View \{(.*?)\n\}", VIEW.read_text(), re.S).group(1)
        self.assertIn("if g.size.height >= 160 && g.size.width >= 240 {", body)
        self.assertIn("g.size.width < 200 ? 3 : 2", body)


if __name__ == "__main__":
    unittest.main()
