"""Kids mode (docs/CONFIG.md, "Kids mode"): the shelf shows only the chosen titles, the parent PIN
gates leaving it, the PIN is never in plain text in what the TV or the phone are served, shows open
by the right link, and grown up profiles are unchanged. No TV and no network: JustWatch and the TV
are stood in for."""
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import kids  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

PIN = "7319"
PEOPLE = [
    {"id": "mum", "name": "Mum"},
    {"id": "ruby", "name": "Ruby", "kid": True, "kids_mode": {
        "pin": PIN,
        "shows": [{"title": "Bluey", "service": "abc-iview"},
                  {"title": "Peppa Pig", "season": 1, "episode": 3},
                  "Octonauts"],
        "apps": ["abc-iview", "com.google.android.youtube.tv", "com.android.tv.settings"]}},
]


class KidsBase:
    """config.json with a grown up and a kids profile, kids.json in a temporary folder."""

    def set_up_kids(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [
            patch.object(kids, "KIDS_FILE", os.path.join(self.tmp, "kids.json")),
            patch.dict(config.CONFIG, {"people": json.loads(json.dumps(PEOPLE))}),
        ]
        for p in self.patches:
            p.start()
        self.old_people = list(config.PEOPLE)
        self.old_ids = list(config.PEOPLE_IDS)
        config.PEOPLE[:] = config.clean_people(PEOPLE)
        config.PEOPLE_IDS[:] = [p["id"] for p in config.PEOPLE]
        kids._wrong.clear()
        kids.art.clear()

    def tear_down_kids(self):
        for p in self.patches:
            p.stop()
        config.PEOPLE[:] = self.old_people
        config.PEOPLE_IDS[:] = self.old_ids
        shutil.rmtree(self.tmp, ignore_errors=True)

    def assert_no_pin(self, text):
        # the PIN is never a value anywhere, and nothing is keyed "pin"
        self.assertNotRegex(text, r'"pin"\s*:')
        self.assertNotIn(f'"{PIN}"', text)
        self.assertNotIn(f": {PIN}", text)


class KidsConfigTests(KidsBase, unittest.TestCase):
    def setUp(self):
        self.set_up_kids()

    def tearDown(self):
        self.tear_down_kids()

    def test_shelf_holds_only_the_chosen_titles(self):
        m = kids.mode("ruby")
        self.assertEqual([s["title"] for s in m["shows"]], ["Bluey", "Peppa Pig", "Octonauts"])
        self.assertEqual(m["shows"][1]["season"], 1)
        self.assertEqual(m["shows"][1]["episode"], 3)
        # app ids become packages; the TV's Settings is never an allowed app
        self.assertEqual(m["apps"], ["au.net.abc.iview", "com.google.android.youtube.tv"])

    def test_grown_ups_are_unchanged(self):
        self.assertIsNone(kids.mode("mum"))
        pub = {p["id"]: p for p in config.public()["people"]}
        self.assertEqual(pub["mum"], {"id": "mum", "name": "Mum"})
        self.assertIn("kids_mode", pub["ruby"])
        self.assertFalse(kids.is_kid("mum"))

    def test_no_kids_mode_is_exactly_as_before(self):
        # opt in: with no kids_mode anywhere nobody is a kids profile, the people are served as they
        # were, and no kids file or salt is made
        plain = [{"id": "mum", "name": "Mum"}, {"id": "ruby", "name": "Ruby", "kid": True}]
        with patch.dict(config.CONFIG, {"people": plain}):
            config.PEOPLE[:] = config.clean_people(plain)
            self.assertEqual(kids.modes(), {})
            self.assertEqual(config.public()["people"], config.clean_people(plain))
            self.assertNotIn("kids_mode", server._config_js())
            self.assertFalse(os.path.exists(kids.KIDS_FILE))

    def test_setup_page_asks_and_only_acts_on_a_yes(self):
        with open(os.path.join(ROOT, "on-tv", "web", "setup.html")) as f:
            page = f.read()
        self.assertIn("Kids mode (optional, off unless you say yes)", page)
        self.assertIn('id="kids-form" style="display:none"', page)
        self.assertEqual(page.count("'/api/kids'"), 1)   # only the Turn on button sends anything
        with open(os.path.join(ROOT, "AGENTS.md")) as f:
            self.assertIn("Any young kids who should only see shows you've\n  picked? I can set up a kids mode with a PIN.", f.read())

    def test_kids_mode_needs_a_good_pin(self):
        for bad in (None, "", "12", "123456789", "12ab", True, 12):
            with self.subTest(pin=bad):
                people = json.loads(json.dumps(PEOPLE))
                people[1]["kids_mode"]["pin"] = bad
                with patch.dict(config.CONFIG, {"people": people}):
                    self.assertIsNone(kids.mode("ruby"))

    def test_pin_is_hashed_and_checked(self):
        m = kids.mode("ruby")
        self.assertRegex(m["pin_hash"], r"^[0-9a-f]{64}$")
        self.assertEqual(m["pin_hash"], kids.pin_hash(PIN, m["pin_salt"]))
        self.assertTrue(kids.verify("ruby", PIN))
        self.assertFalse(kids.verify("ruby", "0000"))
        self.assertFalse(kids.verify("ruby", None))
        self.assertFalse(kids.verify("mum", PIN))
        # the same salt every time, so the TV's copy of the home does not change on each restart
        self.assertEqual(kids.mode("ruby")["pin_salt"], m["pin_salt"])

    def test_pin_never_in_what_the_tv_is_given(self):
        text = server._config_js() + json.dumps(config.public())
        self.assert_no_pin(text)
        self.assertIn('"pin_hash"', text)

    def test_home_config_for_a_tv_with_no_computer_has_no_pin(self):
        cfg = os.path.join(self.tmp, "config.json")
        with open(cfg, "w") as f:
            json.dump({"tvs": [{"id": "living-room", "name": "Living room", "ip": "192.0.2.10"}], "people": PEOPLE}, f)
        env = {**os.environ, "COUCH_CONFIG": cfg, "COUCH_DATA": os.path.join(self.tmp, "data")}
        out = subprocess.run([sys.executable, os.path.join(ROOT, "tv-home", "tools", "home-config.py"), "--json", "--no-lookup"],
                             env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assert_no_pin(out.stdout)
        ruby = next(p for p in json.loads(out.stdout)["people"] if p["id"] == "ruby")
        self.assertEqual(len(ruby["kids_mode"]["shows"]), 3)

    def test_phone_edits_win_over_config(self):
        kids.set_shows("ruby", [{"title": "Hey Duggee", "service": "abc-iview"}])
        self.assertEqual([s["title"] for s in kids.mode("ruby")["shows"]], ["Hey Duggee"])
        kids.set_pin("ruby", "246810")
        self.assertTrue(kids.verify("ruby", "246810"))
        self.assertFalse(kids.verify("ruby", PIN))
        kids.turn_off("ruby")
        self.assertIsNone(kids.mode("ruby"))
        kids.turn_on("mum", "1357")
        self.assertTrue(kids.verify("mum", "1357"))
        with open(kids.KIDS_FILE) as f:
            self.assertNotIn("1357", json.dumps(json.load(f)).replace(kids.mode("mum")["pin_hash"], ""))

    def test_show_and_link_cleaning(self):
        self.assertIsNone(kids.clean_show({"title": "  "}))
        s = kids.clean_show({"title": "Bluey", "service": "not-an-app", "season": 0, "poster": "javascript:alert(1)",
                             "link": "intent://video/ZW2653A001S00#Intent;scheme=iview;end"})
        self.assertNotIn("service", s)
        self.assertNotIn("season", s)
        self.assertNotIn("poster", s)
        self.assertTrue(s["link"].startswith("intent://"))
        self.assertIsNone(kids.clean_show({"title": "x", "link": "intent://a b\"<script>"}).get("link"))
        self.assertEqual(len(kids.clean_shows(["Show %d" % i for i in range(40)])), kids.MAX_SHOWS)

    def test_deep_links_for_a_tv_with_no_computer(self):
        best = {"providers": [
            {"service": "prime-video", "kind": "rent", "deeplink": "intent://rent"},
            {"service": "abc-iview", "kind": "free", "deeplink": "intent://video/SHOW#Intent;scheme=iview;end"},
            {"service": "netflix", "kind": "subscription", "deeplink": "https://www.netflix.com/title/1"},
            {"service": "sbs-on-demand", "kind": "free", "deeplink": "intent://sbs",
             "web": "https://www.sbs.com.au/ondemand/tv-series/bluey/season-1"},
            {"service": "binge", "kind": "subscription", "deeplink": "intent://binge"},
        ]}
        # never a rent or buy offer; the first free or subscription app
        self.assertEqual(kids.link_for(best, {"title": "Bluey"}),
                         {"service": "abc-iview", "package": "au.net.abc.iview", "link": "intent://video/SHOW#Intent;scheme=iview;end"})
        # the app the parent named
        self.assertEqual(kids.link_for(best, {"title": "Bluey", "service": "netflix"})["link"], "https://www.netflix.com/title/1")
        # an app that opens a show by its web page (bridge/apps.py use_web)
        self.assertEqual(kids.link_for(best, {"title": "Bluey", "service": "sbs-on-demand"})["link"],
                         "https://www.sbs.com.au/ondemand/tv-series/bluey")
        # an app that takes no show links: just the app
        self.assertEqual(kids.link_for(best, {"title": "Bluey", "service": "binge"}),
                         {"service": "binge", "package": "au.com.streamotion.ares.tv", "link": None})
        # an episode: its own link
        ep = {"providers": [{"service": "abc-iview", "deeplink": "intent://video/EP3#Intent;scheme=iview;end"}]}
        self.assertEqual(kids.link_for(best, {"title": "Peppa Pig", "season": 1, "episode": 3}, ep)["link"],
                         "intent://video/EP3#Intent;scheme=iview;end")
        self.assertIsNone(kids.link_for({"providers": [best["providers"][0]]}, {"title": "Bluey"}))

    def test_js_and_python_hash_the_same(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        js = ("global.window={};global.document={documentElement:{classList:{add(){},remove(){}}}};"
              "require(%s);process.stdout.write(window.KidsMode.pinHash('%s','abc123',4000))"
              % (json.dumps(os.path.join(ROOT, "tv-home", "web", "kids.js")), PIN))
        out = subprocess.run([node, "-e", js], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.stdout, kids.pin_hash(PIN, "abc123"))


class KidsTvHomeTests(unittest.TestCase):
    """kids.js on a stand-in page (tests/kids-mode-sim.js)."""

    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if not node:
            raise unittest.SkipTest("node is not installed")
        out = subprocess.run([node, os.path.join(HERE, "kids-mode-sim.js")], capture_output=True, text=True, timeout=120)
        if out.returncode:
            raise AssertionError(out.stderr)
        cls.r = json.loads(out.stdout)

    def test_shelf_shows_only_allowed_titles(self):
        self.assertTrue(self.r["kidActive"])
        self.assertTrue(self.r["htmlClass"])
        self.assertEqual(self.r["titles"], ["Bluey", "Peppa Pig"])
        self.assertEqual(self.r["apps"], 1)   # an allowed app that is not on the TV is left off

    def test_grown_up_profile_has_no_kids_mode(self):
        self.assertFalse(self.r["grownActive"])

    def test_shows_open_straight_into_the_show(self):
        self.assertEqual(self.r["playOnline"], [{"title": "Bluey", "who": "ruby", "service": "abc-iview"}])
        self.assertEqual(self.r["offline"]["openLink"], [["intent://video/ZW2653A001S00#Intent;scheme=iview;end", "au.net.abc.iview"]])
        self.assertEqual(self.r["offline"]["launch"], ["au.net.abc.iview"])   # no link: its app

    def test_pin_gate(self):
        self.assertTrue(self.r["afterBack"])
        self.assertTrue(self.r["afterHome"])
        self.assertTrue(self.r["padOpen"])
        self.assertTrue(self.r["dotsOnly"])
        self.assertEqual(self.r["afterWrong"], {"active": True, "unlocked": 0, "msg": True})
        self.assertEqual(self.r["afterRight"], {"active": False, "unlocked": [["ruby", "4826"]]})
        self.assertTrue(self.r["reentered"])

    def test_app_js_hands_every_key_to_kids_mode(self):
        with open(os.path.join(ROOT, "tv-home", "web", "app.js")) as f:
            app = f.read()
        self.assertRegex(app, r'if \(kidsOn\(\)\) \{ okReset\(\); if \(window\.KidsMode\.key\(e\)\) e\.preventDefault\(\); return; \}\n\s*if \(idlePhotoInput\(e\)\) return;')
        self.assertIn('if (kidsOn()) { window.KidsMode.home(); return; }', app)
        self.assertIn('if (kidsOn()) { window.KidsMode.askPin(); return; }', app)
        self.assertIn('api("POST", "/api/who", { who: who, pin: code })', app)
        with open(os.path.join(ROOT, "tv-home", "web", "index.html")) as f:
            self.assertIn('<script src="kids.js"></script>', f.read())


class KidsBridgeTests(KidsBase, AioHTTPTestCase):
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])
        for method, path, h in (("GET", "/api/kids", server.h_kids_get), ("POST", "/api/kids", server.h_kids_set),
                                ("GET", "/api/who", server.h_who_get), ("POST", "/api/who", server.h_who_set),
                                ("GET", "/api/config", server.h_config), ("GET", "/tv/config.js", server.h_tv_config_js),
                                ("POST", "/api/ask", server.h_ask)):
            app.router.add_route(method, path, h)
        return app

    async def asyncSetUp(self):
        self.set_up_kids()
        self.who = {}
        self.more = [
            patch.object(store, "current_who", lambda tv_id=None: self.who.get(tv_id)),
            patch.object(store, "save_who", lambda w, tv_id=None: self.who.__setitem__(tv_id, w)),
            patch.object(server, "push_now", lambda: None),
            patch.object(server.finder, "find", AsyncMock(return_value=(None, []))),
            patch.object(config, "PAIRING_KEY", ""),
            patch.object(config, "ASK_ENABLED", True),
            patch.object(server.claude, "ask", AsyncMock(return_value={"reply": "ok"})),
        ]
        for p in self.more:
            p.start()
        await super().asyncSetUp()

    async def asyncTearDown(self):
        await super().asyncTearDown()
        for p in self.more:
            p.stop()
        self.tear_down_kids()

    async def post(self, path, data):
        return await self.client.post(path, data=json.dumps(data), headers={"Content-Type": "application/json"})

    @unittest_run_loop
    async def test_served_pages_never_carry_the_pin(self):
        for path in ("/tv/config.js", "/api/config", "/api/kids"):
            with self.subTest(path=path):
                r = await self.client.get(path)
                self.assertEqual(r.status, 200)
                self.assert_no_pin(await r.text())
        j = await (await self.client.get("/api/kids")).json()
        self.assertEqual([k["id"] for k in j["kids"]], ["ruby"])
        self.assertEqual([s["title"] for s in j["kids"][0]["shows"]], ["Bluey", "Peppa Pig", "Octonauts"])
        self.assertEqual({p["id"]: p["kids"] for p in j["people"]}, {"mum": False, "ruby": True})

    @unittest_run_loop
    async def test_changing_the_shelf_needs_the_pin(self):
        r = await self.post("/api/kids", {"who": "ruby", "action": "add", "show": {"title": "Hey Duggee"}})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/kids", {"who": "ruby", "pin": "0000", "action": "add", "show": {"title": "Hey Duggee"}})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/kids", {"who": "ruby", "pin": PIN, "action": "add", "show": {"title": "Hey Duggee", "service": "abc-iview"}})
        self.assertEqual(r.status, 200)
        j = await r.json()
        self.assertEqual([s["title"] for s in j["kids"][0]["shows"]][-1], "Hey Duggee")
        r = await self.post("/api/kids", {"who": "ruby", "pin": PIN, "action": "remove", "id": "bluey-abc-iview"})
        self.assertNotIn("Bluey", [s["title"] for s in (await r.json())["kids"][0]["shows"]])
        self.assert_no_pin(json.dumps(await r.json()))

    @unittest_run_loop
    async def test_wrong_pins_are_limited(self):
        for _ in range(kids.WRONG_MAX):
            await self.post("/api/kids", {"who": "ruby", "pin": "0000", "action": "check"})
        r = await self.post("/api/kids", {"who": "ruby", "pin": PIN, "action": "check"})
        self.assertEqual(r.status, 429)

    @unittest_run_loop
    async def test_leaving_a_kids_profile_needs_the_pin(self):
        self.assertEqual((await self.post("/api/who", {"who": "ruby"})).status, 200)   # going in: no PIN
        self.assertEqual((await self.post("/api/who", {"who": "mum"})).status, 403)
        self.assertEqual((await self.post("/api/who", {"who": "mum", "pin": "1111"})).status, 403)
        self.assertEqual(self.who.get(server.DEFAULT_TV), "ruby")
        self.assertEqual((await self.post("/api/who", {"who": "mum", "pin": PIN})).status, 200)
        # a grown up switching between grown ups needs nothing
        self.assertEqual((await self.post("/api/who", {"who": "both"})).status, 200)

    @unittest_run_loop
    async def test_no_ask_for_a_kids_profile(self):
        r = await self.post("/api/ask", {"text": "put on something", "who": "ruby"})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/ask", {"text": "put on something", "who": "mum"})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_phone_can_make_a_kids_profile(self):
        r = await self.post("/api/kids", {"who": "mum", "action": "on", "new_pin": "12"})
        self.assertEqual(r.status, 400)
        r = await self.post("/api/kids", {"who": "mum", "action": "on", "new_pin": "5555"})
        self.assertEqual(r.status, 200)
        self.assertEqual(sorted(k["id"] for k in (await r.json())["kids"]), ["mum", "ruby"])
        r = await self.post("/api/kids", {"who": "mum", "action": "on", "new_pin": "6666"})
        self.assertEqual(r.status, 409)
        r = await self.post("/api/kids", {"who": "mum", "pin": "5555", "action": "off"})
        self.assertEqual([k["id"] for k in (await r.json())["kids"]], ["ruby"])


if __name__ == "__main__":
    unittest.main()
