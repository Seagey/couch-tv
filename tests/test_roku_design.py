"""couch-tv Studio designs on a Roku (roku/channel/components/DesignLib.brs and DesignDraw.brs).

The pure part, DesignLib.brs, is run for real in an off-Roku BrightScript interpreter (@rokucommunity/brs,
a dev dependency in roku/package.json): the code format, the gate that rebuilds a design from an allow list,
the store's answer, the dates and the layout of the fixture designs in tests/fixtures/designs. The channel
package must carry the new files, and BrighterScript with bslint must pass. The interpreter and the linter
come from `npm ci --prefix roku`; without them those tests are skipped."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).parents[1]
ROKU = ROOT / "roku"
LIB = ROKU / "channel" / "components" / "DesignLib.brs"
FIX = Path(__file__).parent / "fixtures" / "designs"
BRS = ROKU / "node_modules" / ".bin" / "brs"
BSC = ROKU / "node_modules" / ".bin" / "bsc"

_spec = importlib.util.spec_from_file_location("roku_build", ROKU / "build.py")
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

# Runs each case in pkg:/cases.json through DesignLib and prints the answers as one JSON line.
DRIVER = r'''
sub Main()
    cases = ParseJson(ReadAsciiFile("pkg:/cases.json"))
    out = []
    for each c in cases
        k = c.kind
        a = c.args
        r = invalid
        if k = "code"
            r = dlReadCode(a[0])
        else if k = "colour"
            r = dlColour(a[0])
        else if k = "words"
            r = dlWords(a[0], a[1])
        else if k = "num"
            r = dlNum(a[0], a[1], a[2], a[3])
        else if k = "store"
            r = dlStoreFor(a[0])
        else if k = "problem"
            r = dlFetchProblem(a[0])
        else if k = "accept"
            r = dlAccept(a[0])
        else if k = "sanitize"
            r = dlSanitize(a[0], a[1])
        else if k = "layout"
            clean = dlSanitize(a[0], false)
            r = { clean: clean, layout: dlLayout(clean, a[1]), apps: dlOrderApps(a[1].apps, clean), time: dlHasTime(clean) }
        else if k = "date"
            r = dlDateText(a[0], a[1])
        else if k = "time"
            r = dlTimeText(a[0], a[1], a[2])
        else if k = "wordclock"
            r = dlWordClock(a[0], a[1])
        else if k = "countdown"
            r = dlCountdown(a[0], a[1], a[2], a[3])
        else if k = "moon"
            r = dlMoon(a[0])
        else if k = "xf"
            r = dlXf(a[0], a[1], a[2])
        else if k = "image"
            r = dlImageUri(a[0], a[1], a[2])
        else if k = "gradient"
            r = dlGradient(a[0], a[1], a[2], 0, 0, 1920, 1080, a[3])
        else if k = "weekday"
            r = dlWeekday(a[0], a[1], a[2])
        else if k = "scam"
            r = dlScam(a[0])
        end if
        if r = invalid then r = "<invalid>"
        out.push(r)
    end for
    print "RESULT " + FormatJson(out)
end sub
'''

# Thursday 19 November 2026, 9:05 pm
NOW = {"y": 2026, "mo": 11, "d": 19, "wd": 4, "h": 21, "mi": 5}
APPS = [{"id": "12", "title": "Netflix", "package": "com.netflix.ninja"},
        {"id": "837", "title": "YouTube", "package": "com.google.android.youtube.tv"},
        {"id": "13", "title": "Prime Video", "package": "com.amazon.amazonvideo.livingroom"},
        {"id": "99001", "title": "Stan", "package": ""}]
CTX = {"now": NOW, "c24": False, "fahrenheit": False, "bridge": "http://192.0.2.20:5400", "key": "",
       "weather": {"place": "Springfield", "temp": 23, "text": "Partly cloudy", "high": 27, "low": 16},
       "apps": APPS, "people": ["Ella", "Sam"],
       "shelf": [{"title": "Bluey", "poster": "http://192.0.2.20:5400/p/1.jpg"}, {"title": "Slow Horses", "poster": ""}]}


def fixture(name):
    return json.loads((FIX / name).read_text())


def run_brs(cases):
    """Each case is (kind, [args]); returns the list of answers from DesignLib."""
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "source").mkdir()
        (Path(d) / "source" / "main.brs").write_text(DRIVER)
        (Path(d) / "cases.json").write_text(json.dumps([{"kind": k, "args": a} for k, a in cases]))
        r = subprocess.run([str(BRS), "-r", d, str(Path(d) / "source" / "main.brs"), str(LIB)],
                           capture_output=True, text=True, timeout=180)
    out = r.stdout + r.stderr
    at = r.stdout.find("RESULT ")
    line = r.stdout[at:].rstrip("\n") if at >= 0 else None
    if r.returncode != 0 or line is None:
        raise AssertionError("brs failed:\n" + out[-4000:])
    # brs prints a new line inside a string as it is, so the JSON is read with strict=False
    return json.loads(line[len("RESULT "):], strict=False)


def one(kind, *args):
    return run_brs([(kind, list(args))])[0]


def items(layout):
    return layout["bg"] + layout["back"] + layout["front"]


def texts(layout):
    return [i["text"] for i in items(layout) if i["k"] == "label"]


class Package(unittest.TestCase):
    def test_zip_carries_the_design_files(self):
        path = build.build(out=tempfile.mkdtemp())
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
        for n in ("components/DesignLib.brs", "components/DesignDraw.brs", "components/HomeScene.xml",
                  "images/ui/round.9.png", "images/ui/line.9.png", "images/ui/disc.png"):
            self.assertIn(n, names)
        self.assertLess(os.path.getsize(path), build.SIZE_LIMIT)

    def test_the_scene_loads_the_design_scripts(self):
        xml = (ROKU / "channel" / "components" / "HomeScene.xml").read_text()
        self.assertIn('uri="pkg:/components/DesignLib.brs"', xml)
        self.assertIn('uri="pkg:/components/DesignDraw.brs"', xml)
        for node in ('id="dBg"', 'id="dBack"', 'id="dFront"'):
            self.assertIn(node, xml)

    def test_the_library_makes_no_nodes_and_reads_nothing(self):
        # what makes DesignLib testable off a Roku: no node, no file, no network, no registry
        src = LIB.read_text()
        for bad in ('"roSGNode"', "ReadAsciiFile", "WriteFile", "roUrlTransfer", "roRegistrySection", "m.top"):
            self.assertNotIn(bad, src)


@unittest.skipUnless(BSC.exists(), "run `npm ci --prefix roku` for the BrightScript check")
class Lint(unittest.TestCase):
    def test_compiles_and_lints_clean(self):
        r = subprocess.run([str(BSC)], cwd=ROKU, capture_output=True, text=True, timeout=180)
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 0, out)
        self.assertNotRegex(out, r"\b(error|warning) BS")


@unittest.skipUnless(BRS.exists(), "run `npm ci --prefix roku` for the BrightScript interpreter")
class Code(unittest.TestCase):
    def test_codes_as_typed_with_the_remote(self):
        long = "A" * 43
        got = run_brs([("code", ["abcde-fghjk"]), ("code", [" ab cde fghjk "]), ("code", ["ABCDEFGHJK"]),
                       ("code", ["ABCDE-FGHJI"]), ("code", ["ABCDE-FGHJ"]), ("code", ["ABCDE-FGHJK1"]),
                       ("code", ["ctv1-" + long]), ("code", [long]), ("code", ["CTV1-" + long[:-1]]),
                       ("code", [""]), ("code", [12345]), ("code", ["0BCDE-FGHJK"])])
        self.assertEqual(got, ["ABCDE-FGHJK", "ABCDE-FGHJK", "ABCDE-FGHJK", "", "", "", "CTV1-" + long,
                               "CTV1-" + long, "", "", "", ""])

    def test_store_and_its_answers(self):
        got = run_brs([("store", [{}]), ("store", [{"design_store": ""}]),
                       ("store", [{"design_store": "https://Designs.Example/"}]),
                       ("store", [{"design_store": "http://evil.example"}]),
                       ("store", [{"design_store": "https://designs.example/path"}]),
                       ("store", [{"design_store": "http://127.0.0.1:5490"}]),
                       ("problem", [200]), ("problem", [404]), ("problem", [429]), ("problem", [503]),
                       ("problem", [500]), ("problem", [-1])])
        self.assertEqual(got[:6], ["https://tvdesigner.sites.underseage.studio", "", "https://designs.example", "", "",
                                   "http://127.0.0.1:5490"])
        self.assertEqual(got[6], "")
        self.assertIn("30 minutes", got[7])
        self.assertIn("Too many tries", got[8])
        self.assertIn("paused", got[9])
        self.assertIn("Could not reach", got[10])
        self.assertEqual(got[10], got[11])

    def test_store_answer_keeps_only_the_design_and_a_real_jpeg(self):
        ans = fixture("store-answer-gradient.json")
        every = fixture("every-object.json")
        fake = dict(every, background={"image": "data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUg=="})
        got = run_brs([("accept", [json.dumps(ans)]), ("accept", [json.dumps({"design": every})]),
                       ("accept", [json.dumps({"design": fake})]), ("accept", ["not json"]),
                       ("accept", [json.dumps({"design": [1, 2]})]), ("accept", [json.dumps({"nodesign": {}})])])
        d = got[0]
        self.assertNotIn("extra", d)
        self.assertEqual(set(d["background"]), {"colour", "colour2", "angle"})   # the link, cut out and video go
        self.assertTrue(got[1]["background"]["image"].startswith("data:image/jpeg;base64,/9j/"))
        self.assertNotIn("image", got[2]["background"])   # says JPEG, is a PNG: refused by its bytes
        self.assertEqual(got[3:], ["<invalid>"] * 3)


@unittest.skipUnless(BRS.exists(), "run `npm ci --prefix roku` for the BrightScript interpreter")
class Gate(unittest.TestCase):
    def test_colours_are_hex_only(self):
        got = run_brs([("colour", [c]) for c in ("#fff", "#FFF8", "#102030", "#10203040", "#12345", "red",
                                                 "rgba(1,2,3,0.5)", " #abcdef ", 7, "#ggg")])
        self.assertEqual(got, ["0xFFFFFFFF", "0xFFFFFF88", "0x102030FF", "0x10203040", "", "", "", "0xABCDEFFF", "", ""])

    def test_numbers_are_clamped(self):
        got = run_brs([("num", [9999, -3840, 3840, False]), ("num", [-1.23456, -10, 10, False]),
                       ("num", ["12", 0, 100, True]), ("num", ["12px", 0, 100, True]), ("num", [True, 0, 1, False]),
                       ("num", [2.5, 0, 10, True]), ("num", [None, 0, 1, False]), ("num", [30000000000, 0, 4, False])])
        self.assertEqual(got, [3840, -1.235, 12, "<invalid>", "<invalid>", 3, "<invalid>", 4])

    def test_words_line_by_line_like_san_w(self):
        got = run_brs([("words", ["Hello there", 120]), ("words", ["Happy 40th\nbirthday", 120]),
                       ("words", ["Ｈｅｌｌｏ  world  ", 120]), ("words", ["a\n\n\n\nb", 120]),
                       ("words", ["Café, crème brûlée!", 120]), ("words", ["mail me @home", 120]),
                       ("words", ["x" * 50, 40]), ("words", [42, 40]), ("words", ["tab\there", 40])])
        self.assertEqual(got, ["Hello there", "birthday", "Hello world", "a\n\nb", "Café, crème brûlée!", "",
                               "x" * 40, "<invalid>", "tab here"])

    def test_words_that_point_somewhere_are_caught(self):
        got = run_brs([("scam", ["visit evil.example now"]), ("scam", ["see www.stuff"]),
                       ("scam", ["oh four one two three four five"]), ("scam", ["Welcome home. Relax"])])
        self.assertEqual(got, [True, True, True, False])

    def test_every_object_fixture_is_rebuilt_from_the_allow_list(self):
        d = one("sanitize", fixture("every-object.json"), False)
        self.assertEqual(set(d), {"v", "home", "elements", "background", "apps", "texts", "objects", "look"})
        self.assertEqual(d["home"], {"clock": "24h", "keep_watching": True, "scene_seconds": 5})
        self.assertNotIn("spaceship", d["elements"])
        self.assertEqual(d["elements"]["dock"], {"y": 20, "scale": 0.5, "opacity": 0.4})   # never gone
        self.assertEqual(d["elements"]["clock"]["colour"], "0xFFEEDDFF")
        self.assertEqual(d["elements"]["date"]["colour"], "0xAABBCCFF")
        self.assertEqual(d["background"]["darken"], 0.9)
        self.assertNotIn("blur", d["background"])
        self.assertEqual(d["apps"], {"order": ["com.netflix.ninja", "roku.837"], "hidden": ["roku.13"]})
        self.assertEqual([t["text"] for t in d["texts"]], ["Good evening"])   # a number and a web address go
        self.assertEqual(d["look"], {"accent": "0xFF8800FF"})
        ids = [o["id"] for o in d["objects"]]
        for gone in ("t2", "w-hologram-0", "bad id with spaces", "x1"):
            self.assertNotIn(gone, ids)
        by = {o["id"]: o for o in d["objects"]}
        self.assertNotIn("colour", by["s-outline"])   # "red" is not a #hex colour
        self.assertEqual(by["s-solid"]["layer"], "back")
        photos = [o for o in d["objects"] if o.get("kind") == "photo"]
        self.assertTrue(photos[0]["opts"]["image"].startswith("data:image/jpeg"))
        self.assertNotIn("image", photos[1]["opts"])   # a link is never a picture
        stack = next(o for o in d["objects"] if o.get("kind") == "stack")
        self.assertEqual([i["kind"] for i in stack["items"]], ["moon", "weather"])   # never a stack in a stack
        self.assertEqual(by["g1"]["layer"], "back")

    def test_bad_input_never_crashes(self):
        got = run_brs([("sanitize", [x, False]) for x in (None, 5, "text", [], {"objects": "x", "elements": [],
                       "background": 3, "texts": {"a": 1}, "apps": {"order": "x", "hidden": [1, None]}})])
        for d in got:
            self.assertEqual(d["v"], 1)
        self.assertNotIn("objects", got[4])

    def test_kept_pictures_only_for_a_design_this_roku_saved(self):
        d = {"background": {"image": "kept:0.jpg"}}
        got = run_brs([("sanitize", [d, False]), ("sanitize", [d, True])])
        self.assertNotIn("background", got[0])
        self.assertEqual(got[1]["background"]["image"], "kept:0.jpg")


@unittest.skipUnless(BRS.exists(), "run `npm ci --prefix roku` for the BrightScript interpreter")
class Time(unittest.TestCase):
    def test_clock_and_dates(self):
        got = run_brs([("time", [21, 5, False]), ("time", [9, 5, True]), ("time", [0, 0, False]), ("time", [0, 7, True]),
                       ("date", [None, NOW]), ("date", ["short", NOW]), ("date", ["numeric", NOW]),
                       ("date", ["weekday", NOW]), ("date", ["day_month", NOW]), ("date", ["full", NOW]),
                       ("weekday", [2026, 11, 19]), ("weekday", [2000, 1, 1]), ("weekday", [2024, 2, 29])])
        self.assertEqual(got, ["9:05", "09:05", "12:00", "00:07", "Thursday 19 November", "Thu 19 Nov", "19/11/2026",
                               "Thursday", "19 November", "Thursday 19 November 2026", 4, 6, 4])

    def test_word_clock_countdown_and_moon(self):
        got = run_brs([("wordclock", [21, 5]), ("wordclock", [21, 30]), ("wordclock", [23, 58]), ("wordclock", [12, 0]),
                       ("countdown", [12, 25, "sleeps", NOW]), ("countdown", [11, 19, "days", NOW]),
                       ("countdown", [11, 20, "days", NOW]), ("countdown", [1, 1, "weeks", NOW]),
                       ("countdown", [2, 29, "days", NOW]), ("moon", [{"y": 2026, "mo": 11, "d": 24}]),
                       ("moon", [{"y": 2026, "mo": 12, "d": 9}])])
        self.assertEqual(got[:4], ["It's five past nine", "It's half past nine", "It's twelve o'clock", "It's twelve o'clock"])
        self.assertEqual(got[4], {"days": 36, "n": 36, "word": "sleeps"})
        self.assertEqual(got[5], {"days": 0, "n": 0, "word": "days"})
        self.assertEqual(got[6], {"days": 1, "n": 1, "word": "day"})
        self.assertEqual(got[7], {"days": 43, "n": 6, "word": "weeks"})
        self.assertEqual(got[8]["days"], 101)   # 2027 has no 29 February: the 28th
        self.assertEqual(got[9]["name"], "Full moon")      # 24 November 2026 is a full moon
        self.assertEqual(got[10]["name"], "New moon")      # 9 December 2026 is a new moon


@unittest.skipUnless(BRS.exists(), "run `npm ci --prefix roku` for the BrightScript interpreter")
class Layout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.every, cls.grad, cls.scene = run_brs([
            ("layout", [fixture("every-object.json"), CTX]),
            ("layout", [fixture("store-answer-gradient.json")["design"], CTX]),
            ("layout", [fixture("built-in-background.json"), CTX])])

    def test_every_item_is_on_the_drawing_list_with_whole_pixels(self):
        lay = self.every["layout"]
        for it in items(lay):
            self.assertIn(it["k"], ("rect", "nine", "label", "poster", "disc", "app"))
            for k in ("x", "y", "w", "h"):
                self.assertIsInstance(it[k], int, it)
            self.assertGreaterEqual(it["w"], 0)
            if it["k"] in ("rect", "nine", "disc"):
                self.assertRegex(it["c"], r"^0x[0-9A-F]{8}$")
            if it["k"] == "nine":
                self.assertIn(it["u"], ("round", "line", "panel"))

    def test_background_photo_with_zoom_place_and_bottom_shade(self):
        bg = self.every["layout"]["bg"]
        self.assertEqual(bg[0]["k"], "poster")
        self.assertTrue(bg[0]["u"].startswith("data:image/jpeg"))
        self.assertEqual((bg[0]["x"], bg[0]["y"], bg[0]["w"], bg[0]["h"]), (-115, -151, 2304, 1296))
        shade = bg[1:]
        self.assertEqual(len(shade), 24)
        self.assertTrue(all(abs(b["o"] - 0.9) < 1e-6 for b in shade))
        self.assertLess(int(shade[0]["c"][-2:], 16), int(shade[-1]["c"][-2:], 16))   # darkest at the bottom

    def test_two_colour_background_is_bands_left_to_right(self):
        bg = self.grad["layout"]["bg"]
        self.assertEqual(len(bg), 48)
        self.assertEqual(bg[0]["x"], 0)
        self.assertEqual(bg[-1]["x"] + bg[-1]["w"], 1920)
        self.assertTrue(all(b["h"] == 1080 for b in bg))
        self.assertLess(int(bg[0]["c"][2:4], 16), 0x20)      # #102040 at the left
        self.assertGreater(int(bg[-1]["c"][2:4], 16), 0x98)   # #a04060 at the right

    def test_built_in_background_comes_from_the_bridge(self):
        bg = self.scene["layout"]["bg"]
        self.assertEqual(bg[0]["u"], "http://192.0.2.20:5400/tv/backgrounds/albury-storm.jpg")
        got = run_brs([("image", ["backgrounds/scene-night.jpg", "", ""]),
                       ("image", ["backgrounds/scene-fog" + "@" + "2x.jpg", "http://b:5400", ""]),
                       ("image", ["backgrounds/mine/me.jpg", "http://b:5400", "k1"]),
                       ("image", ["backgrounds/scene-dawn-fg.webp", "http://b:5400", ""]),
                       ("image", ["backgrounds/grose-valley.jpg", "", ""]),
                       ("image", ["kept:1.jpg", "", ""])])
        self.assertEqual(got, ["pkg:/images/scenes/night.jpg", "pkg:/images/scenes/fog.jpg",
                               "http://b:5400/tv/backgrounds/mine/me.jpg?key=k1", "", "", "cachefs:/couchtv-design-1.jpg"])

    def test_text_shapes_clock_and_weather(self):
        t = texts(self.every["layout"])
        self.assertIn("Good evening", t)
        self.assertIn("Welcome home\nRelax", t)
        self.assertIn("21:05", t)                  # the clock object says 24h
        self.assertIn("Thu 19 Nov", t)
        self.assertIn("Springfield  23°  Partly cloudy", t)
        self.assertIn("9:05 pm", t)                # the clock widget: 12h with am or pm
        self.assertIn("23°", t)
        self.assertIn("Partly cloudy   H 27°  L 16°", t)
        self.assertIn("19 November", t)
        self.assertIn("36", t)                     # sleeps until Christmas
        self.assertIn("sleeps until Christmas", t)
        self.assertIn("“Be kind”", t)
        self.assertIn("Welcome, guests", t)
        self.assertIn("It's five past nine", t)
        self.assertIn("November 2026", t)
        lay = self.every["layout"]
        back = [i for i in lay["back"]]
        self.assertTrue(any(i["k"] == "rect" and i["c"] == "0x11223344" for i in back))   # the solid shape, behind
        line = next(i for i in lay["front"] if i["k"] == "rect" and i["y"] == 950)
        self.assertEqual((line["w"], line["h"]), (1700, 40))   # a line is at most 40 high
        rotated = [i for i in lay["front"] if i.get("rot") == 10]
        self.assertTrue(rotated)

    def test_widgets_drawn_or_shown_as_a_titled_card(self):
        t = texts(self.every["layout"])
        self.assertIn("Lounge", t)                 # the aircon widget: its own label
        self.assertIn("Air conditioning", t)       # and its kind, in plain words
        self.assertIn("News", t)
        self.assertIn("Bedroom", t)                # the smart object
        self.assertIn("Smart home", t)             # the section
        self.assertIn("Waxing gibbous", t)         # the stack shows its first widget
        self.assertNotIn("hologram", " ".join(t).lower())
        self.assertIn("Photo", t)                  # a photo whose picture was refused: its card

    def test_app_tiles_from_the_rokus_apps(self):
        apps = [i for i in self.every["layout"]["front"] if i["k"] == "app"]
        self.assertEqual([a["i"] for a in apps[:3]], [0, 1, 2])   # the grid: Netflix, YouTube, Prime Video
        self.assertEqual(apps[-1]["i"], 1)                         # the single app tile: YouTube
        self.assertTrue(all(a["w"] == a["h"] for a in apps))
        self.assertEqual([a["title"] for a in self.every["apps"]], ["Netflix", "YouTube", "Stan"])   # ordered, Prime hidden

    def test_design_with_a_clock_is_redrawn_each_minute(self):
        self.assertTrue(self.every["time"])
        self.assertFalse(self.scene["time"])

    def test_keep_watching_and_people_widgets(self):
        lay = self.scene["layout"]
        t = texts(lay)
        self.assertIn("Bluey", t)
        self.assertIn("Slow Horses", t)
        self.assertIn("Ella", t)
        self.assertTrue(any(i["k"] == "poster" and i["u"].endswith("/p/1.jpg") for i in lay["front"]))

    def test_home_parts_move_and_grow(self):
        got = run_brs([("xf", [{"x": 10, "y": -100, "scale": 0.8}, 960, 1034]), ("xf", [{}, 80, 636]),
                       ("xf", [{"hidden": True, "opacity": 0.5}, 0, 0])])
        self.assertAlmostEqual(got[0]["tx"], 960 + 10 - 0.8 * 960, places=3)
        self.assertAlmostEqual(got[0]["ty"], 1034 - 100 - 0.8 * 1034, places=3)
        self.assertEqual(got[1]["tx"], 0)
        self.assertTrue(got[2]["hidden"])
        self.assertEqual(got[2]["o"], 0.5)


# The whole HomeScene in the interpreter. brs has no Animation node, no registry and no dialogs, so the
# copy swaps the fade for a plain Node, the registry for an object that keeps values in memory, and a dialog
# is skipped (the channel checks the node was made). Everything else is the channel's own code.
HOOK = r'''
function testRegistry() as Object
    r = { data: {} }
    r.read = trRead
    r.write = trWrite
    r.exists = trExists
    r.delete = trDelete
    r.flush = trFlush
    return r
end function
function trRead(k as String) as String
    if m.data.doesExist(k) then return m.data[k]
    return ""
end function
function trWrite(k as String, v as String) as Boolean
    m.data[k] = v
    return true
end function
function trExists(k as String) as Boolean
    return m.data.doesExist(k)
end function
function trDelete(k as String) as Boolean
    m.data.delete(k)
    return true
end function
function trFlush() as Boolean
    return true
end function
function testFs() as Object
    return { exists: trNo }
end function
function trNo(p as String) as Boolean
    return false
end function

sub testWalk(n as Object, out as Object)
    t = n.subtype()
    if out.count.doesExist(t) then out.count[t] = out.count[t] + 1 else out.count[t] = 1
    if t = "Label" and n.text <> "" then out.text.push(n.text)
    if t = "Poster" and n.uri <> "" then out.uris.push(n.uri)
    for i = 0 to n.getChildCount() - 1
        testWalk(n.getChild(i), out)
    end for
end sub

function testDump() as Object
    d = {}
    for each g in ["dBg", "dBack", "dFront", "dock", "top", "shelf"]
        o = { count: {}, text: [], uris: [] }
        testWalk(m.top.findNode(g), o)
        d[g] = o
    end for
    d.zones = { people: m.zones.people.count(), shelf: m.zones.shelf.count(), wapps: m.zones.wapps.count(), dock: m.zones.dock.count() }
    d.scenes = m.top.findNode("bgA").visible
    d.clock = { text: m.clock.text, visible: m.clock.visible, x: m.clock.translation[0] }
    d.focus = { zone: m.focusZone, x: m.focusRing.translation[0], y: m.focusRing.translation[1], name: m.status.text }
    d.dockxf = m.top.findNode("dock").scale[0]
    return d
end function

sub testKey(k as String)
    onKeyEvent(k, true)
end sub

sub testHook()
    c = ParseJson(ReadAsciiFile("pkg:/cases.json"))
    m.weather = c.weather
    m.people = c.people
    m.shelf = c.shelf
    m.apps = c.apps
    drawDate()
    drawTop()
    drawShelf()
    drawDock()
    out = {}
    out.plain = testDump()
    m.cfgDesign = c.design
    designRefresh()
    out.config = testDump()
    testKey("up")
    out.up = testDump().focus
    testKey("right")
    out.right = testDump().focus
    testKey("down")
    out.down = testDump().focus
    designFetched(404, "")
    out.notfound = m.status.text
    designFetched(200, "nonsense")
    out.bad = m.status.text
    designFetched(200, c.answer)
    out.kept = m.reg.exists("fetched")
    out.asked_first = m.reg.read("ok") <> "1"
    m.reg.write("ok", "1")
    designRefresh()
    out.code = testDump()
    m.reg.write("off", "1")
    designRefresh()
    out.off = testDump()
    getDesign("not a code")
    out.nocode = m.status.text
    print "RESULT " + FormatJson(out)
end sub
'''


def run_scene(design, answer):
    import re
    import shutil
    with tempfile.TemporaryDirectory() as d:
        ch = Path(d) / "ch"
        shutil.copytree(ROKU / "channel", ch)
        xml = (ch / "components" / "HomeScene.xml").read_text()
        xml = re.sub(r"<Animation.*?</Animation>", '<Node id="fade" />', xml, flags=re.S)
        xml = xml.replace('<script type="text/brightscript" uri="pkg:/components/DesignDraw.brs" />',
                          '<script type="text/brightscript" uri="pkg:/components/DesignDraw.brs" />\n'
                          '    <script type="text/brightscript" uri="pkg:/components/TestHook.brs" />')
        (ch / "components" / "HomeScene.xml").write_text(xml)
        (ch / "components" / "TestHook.brs").write_text(HOOK)
        draw = (ch / "components" / "DesignDraw.brs").read_text()
        draw = draw.replace('CreateObject("roRegistrySection", "couchtv-design")', "testRegistry()")
        (ch / "components" / "DesignDraw.brs").write_text(draw)
        home = (ch / "components" / "HomeScene.brs").read_text()
        home = home.replace("    loadAll()\nend sub", "    loadAll()\n    testHook()\nend sub", 1)
        home = home.replace('CreateObject("roFileSystem")', "testFs()")
        (ch / "components" / "HomeScene.brs").write_text(home)
        (ch / "config.json").write_text(json.dumps({"bridge": "http://192.0.2.20:5400", "tv": ""}))
        cases = dict(CTX, design=design, answer=json.dumps(answer))
        cases["people"] = [{"id": "ella", "name": "Ella"}, {"id": "sam", "name": "Sam"}]
        (ch / "cases.json").write_text(json.dumps(cases))
        (ch / "source" / "main.brs").write_text(
            'sub Main()\n    screen = CreateObject("roSGScreen")\n    port = CreateObject("roMessagePort")\n'
            '    screen.setMessagePort(port)\n    screen.CreateScene("HomeScene")\n    screen.show()\nend sub\n')
        r = subprocess.run([str(BRS), "-r", str(ch), str(ch / "source" / "main.brs")],
                           capture_output=True, text=True, timeout=180)
    at = r.stdout.find("RESULT ")
    # expected from brs: the bad answer it was handed on purpose, and the dialogs it does not have
    known = ("ParseJSON: Unexpected token", "Failed to create roSGNode with type Standard")
    errors = [l for l in (r.stdout + r.stderr).splitlines()
              if ("ERROR" in l or "attempted" in l or "rror" in l) and not any(k in l for k in known)]
    if at < 0 or errors:
        raise AssertionError("the scene did not run:\n" + (r.stdout + r.stderr)[-4000:])
    return json.loads(r.stdout[at + len("RESULT "):].strip(), strict=False)


@unittest.skipUnless(BRS.exists(), "run `npm ci --prefix roku` for the BrightScript interpreter")
class Scene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_scene(fixture("every-object.json"), fixture("store-answer-gradient.json"))

    def test_plain_home_is_as_before_with_settings_at_the_end_of_the_apps(self):
        p = self.r["plain"]
        self.assertTrue(p["scenes"])
        self.assertEqual(p["dBg"]["count"], {"Group": 1})
        self.assertEqual(p["zones"]["dock"], 5)          # four apps and Settings
        self.assertEqual(p["zones"]["wapps"], 0)
        self.assertIn("Thursday 19 November", p["top"]["text"])
        self.assertIn("23°C  Partly cloudy", p["top"]["text"])
        self.assertIn("Netflix", p["focus"]["name"])

    def test_design_from_config_draws_over_the_home(self):
        c = self.r["config"]
        self.assertFalse(c["scenes"])                    # its own background hides the scene
        self.assertTrue(any(u.startswith("tmp:/couchtv-design-") and u.endswith(".jpg") for u in c["dBg"]["uris"]))
        for words in ("Good evening", "Welcome home\nRelax", "Lounge", "Air conditioning", "“Be kind”", "Bedroom"):
            self.assertIn(words, c["dFront"]["text"] + c["dBack"]["text"])
        self.assertGreater(c["zones"]["wapps"], 3)       # the design's app tiles are stops for the remote
        self.assertEqual(c["zones"]["dock"], 4)          # Prime Video hidden, Settings still there
        self.assertEqual(c["zones"]["people"], 0)        # the design hides the people
        self.assertAlmostEqual(c["dockxf"], 0.5)         # made small, never gone
        self.assertIn("Thursday 19 November 2026", c["top"]["text"])   # the full format
        self.assertIn("Springfield  23°C", c["top"]["text"])            # with its place, without words

    def test_remote_reaches_the_design_apps_and_back_to_the_dock(self):
        self.assertEqual(self.r["up"]["zone"], "wapps")
        self.assertNotEqual(self.r["right"]["x"], self.r["up"]["x"])
        self.assertEqual(self.r["down"]["zone"], "dock")

    def test_design_by_code_asks_first_and_is_kept(self):
        self.assertIn("30 minutes", self.r["notfound"])
        self.assertEqual(self.r["bad"], "That design could not be used.")
        self.assertTrue(self.r["kept"])
        self.assertTrue(self.r["asked_first"])
        code = self.r["code"]
        self.assertEqual(code["dBg"]["count"].get("Rectangle"), 48)   # the two colour background
        self.assertIn("Hello", code["dFront"]["text"])
        self.assertFalse(code["clock"]["visible"])

    def test_plain_home_again_from_settings(self):
        off = self.r["off"]
        self.assertTrue(off["scenes"])
        self.assertEqual(off["dFront"]["count"], {"Group": 1})
        self.assertTrue(off["clock"]["visible"])
        self.assertEqual(off["zones"]["dock"], 5)
        self.assertIn("not a design code", self.r["nocode"])


if __name__ == "__main__":
    unittest.main()
