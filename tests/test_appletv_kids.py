"""Kids mode in couch-tv's Apple TV app (docs/APPLE-TV.md, "Kids mode"): the bridge endpoints the app uses,
behind the real middleware, against the stand-in Apple TV (tests/appletv_standin.py). /api/appletv/kids
gives only the child's shelf, their allowed apps as Apple TV apps and the PIN's salted hash, never the PIN;
/api/appletv/kids/open opens only a shelf show, into the show where the app takes a link, else its app; and
while a kids profile is watching, /api/appletv/open opens only that child's apps. No network: JustWatch is
stood in for."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import appletv as A  # noqa: E402
from appletv_standin import StandIn  # noqa: E402

PIN = "7319"
MINE = "dev.couchtv.appletv.test"
PEOPLE = [
    {"id": "mum", "name": "Mum"},
    {"id": "ruby", "name": "Ruby", "kid": True, "kids_mode": {
        "pin": PIN,
        "shows": [{"title": "Bluey", "service": "abc-iview"},
                  {"title": "Peppa Pig", "season": 1, "episode": 3},
                  {"title": "Puffin Rock", "service": "netflix"},
                  {"title": "Bandit Time", "link": "https://tv.apple.com/au/show/bandit-time/umc.cmc.123"},
                  "Not Anywhere"],
        "apps": ["abc-iview", "youtube", "com.apple.TVSettings", "com.apple.TVAppStore", MINE, "disney-plus"]}},
]


def found(title):
    """JustWatch, stood in for: where each test show streams."""
    t = title.lower()
    if t == "bluey":
        provs = [{"service": "abc-iview", "kind": "free", "playable": True, "deeplink": "iview://show/bluey",
                  "web": "https://iview.abc.net.au/show/bluey"}]
    elif t == "peppa pig":
        provs = [{"service": "stan", "kind": "rent", "playable": True, "deeplink": None, "web": "https://stan.com.au/x"},
                 {"service": "netflix", "kind": "flatrate", "playable": True,
                  "deeplink": "https://www.netflix.com/watch/80000001", "web": "http://www.netflix.com/au/title/80000001"}]
    elif t == "puffin rock":
        provs = [{"service": "netflix", "kind": "flatrate", "playable": True, "deeplink": None,
                  "web": "http://www.netflix.com/title/80091742"}]
    else:
        return None, []
    return {"title": title, "type": "show", "jw_id": "ts1", "poster": f"https://images.example/{t}.jpg",
            "backdrop": None, "providers": provs}, []


class KidsOnAppleTV(unittest.IsolatedAsyncioTestCase):
    KEY = {"Authorization": "Bearer couchpass123"}

    async def asyncSetUp(self):
        self.d = tempfile.TemporaryDirectory()
        self.s = await StandIn().__aenter__()
        self.s.apps.update({MINE: "Couch TV", "au.net.abc.iview.tv": "ABC iview",
                            "com.apple.TVSettings": "Settings", "com.apple.TVAppStore": "App Store"})
        self.tv = self.s.tv(self.d.name)
        await self.tv.pair_start()
        await self.tv.pair_finish(self.s.pin)
        import config
        import kids
        import server
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        self.server, self.kids, self.config = server, kids, config
        self.other = server.make_tv({"id": "den", "name": "Den", "ip": "192.0.2.77"})      # an Android TV
        self._p = [patch.multiple(server, TVS={"lounge": self.tv, "den": self.other}, DEFAULT_TV="den"),
                   patch.object(A.config, "PAIRING_KEY", "couchpass123"),
                   patch.object(server.store, "DATA", self.d.name),
                   patch.object(server.store, "WHO_FILE", os.path.join(self.d.name, "who.json")),
                   patch.object(kids, "KIDS_FILE", os.path.join(self.d.name, "kids.json")),
                   patch.dict(config.CONFIG, {"people": json.loads(json.dumps(PEOPLE))}),
                   patch.object(server.finder, "find", AsyncMock(side_effect=found)),
                   patch.object(server.finder, "episode_providers", AsyncMock(return_value=None))]
        for p in self._p:
            p.start()
        self.old_people, self.old_ids = list(config.PEOPLE), list(config.PEOPLE_IDS)
        config.PEOPLE[:] = config.clean_people(PEOPLE)
        config.PEOPLE_IDS[:] = [p["id"] for p in config.PEOPLE]
        kids._wrong.clear()
        kids.art.clear()
        server._failed_attempts.clear()
        server.store.save_who("ruby", "lounge")
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/appletv/kids", server.h_appletv_kids)
        for path, h in (("/api/appletv/kids/open", server.h_appletv_kids_open), ("/api/appletv/open", server.h_appletv_open),
                        ("/api/who", server.h_who_set)):
            app.router.add_post(path, h)
        self.client = TestClient(TestServer(app, host="127.0.0.1"))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        for p in reversed(self._p):
            p.stop()
        self.config.PEOPLE[:] = self.old_people
        self.config.PEOPLE_IDS[:] = self.old_ids
        self.kids._wrong.clear()
        self.kids.art.clear()
        self.server._failed_attempts.clear()
        await self.tv._drop()
        await self.s.__aexit__()
        self.d.cleanup()

    def post(self, path, data, key=True):
        h = {"Content-Type": "application/json", **(self.KEY if key else {})}
        return self.client.post(path, headers=h, data=json.dumps(data))

    async def shelf(self, query=""):
        r = await self.client.get("/api/appletv/kids?tv=lounge" + query, headers=self.KEY)
        return r.status, await r.text()

    def launches(self):
        return [r[0] for k, *r in self.s.log if k == "launch"]

    def links(self):
        return [r[0] for k, *r in self.s.log if k == "url"]

    # ---------- what the app is given ----------
    async def test_needs_the_key_and_an_apple_tv(self):
        r = await self.client.get("/api/appletv/kids?tv=lounge")
        self.assertEqual(r.status, 401)
        r = await self.client.get("/api/appletv/kids?tv=den", headers=self.KEY)
        self.assertEqual(r.status, 400)
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "bluey-abc-iview"}, key=False)
        self.assertEqual(r.status, 401)
        self.assertEqual((self.launches(), self.links()), ([], []))

    async def test_the_shelf_and_the_hash_never_the_pin(self):
        status, text = await self.shelf()
        self.assertEqual(status, 200)
        j = json.loads(text)
        self.assertTrue(j["kids"])
        self.assertEqual((j["who"], j["name"]), ("ruby", "Ruby"))
        self.assertEqual([s["title"] for s in j["shows"]], ["Bluey", "Peppa Pig", "Puffin Rock", "Bandit Time", "Not Anywhere"])
        # the PIN is nowhere: no value, no "pin" key; only its salted hash, which a typed PIN is checked against
        self.assertNotRegex(text, r'"pin"\s*:')
        self.assertNotIn(PIN, text.replace(j["pin_hash"], "").replace(j["pin_salt"], ""))
        h = f"{j['pin_salt']}:{PIN}".encode()
        for _ in range(j["pin_rounds"]):
            h = hashlib.sha256(h).digest()
        self.assertEqual(h.hex(), j["pin_hash"])
        self.assertEqual(j["grown_ups"], ["mum"])
        # only the shelf: no links, no other people's things, nothing beyond what the app draws
        self.assertEqual(set(j), {"ok", "kids", "who", "name", "shows", "apps", "pin_hash", "pin_salt", "pin_rounds", "grown_ups"})
        for s in j["shows"]:
            self.assertLessEqual(set(s), {"id", "title", "season", "episode", "poster", "backdrop", "app"})
        bluey = j["shows"][0]
        self.assertEqual(bluey["app"]["bundle"], "au.net.abc.iview.tv")              # found by its name on the Apple TV
        self.assertEqual(bluey["poster"], "https://images.example/bluey.jpg")

    async def test_allowed_apps_are_apple_tv_apps_never_settings_store_or_couch_tv(self):
        j = json.loads((await self.shelf())[1])
        self.assertEqual([a["id"] for a in j["apps"]], ["au.net.abc.iview.tv", "com.google.ios.youtube"])
        self.assertEqual(j["apps"][0]["package"], "au.net.abc.iview")                # names couch-tv's logo
        # Disney+ is on the list but not on this Apple TV: left out

    async def test_a_grown_up_gets_no_shelf(self):
        self.server.store.save_who("mum", "lounge")
        status, text = await self.shelf()
        self.assertEqual((status, json.loads(text)), (200, {"ok": True, "kids": False, "who": "mum"}))
        status, text = await self.shelf("&who=mum")
        self.assertFalse(json.loads(text)["kids"])
        self.assertNotIn("pin_hash", text)

    async def test_a_pin_changed_on_the_phone_reaches_the_app(self):
        old = json.loads((await self.shelf())[1])["pin_hash"]
        self.kids.set_pin("ruby", "2468")
        j = json.loads((await self.shelf())[1])
        self.assertNotEqual(j["pin_hash"], old)
        self.assertNotIn("2468", json.dumps(j).replace(j["pin_hash"], "").replace(j["pin_salt"], ""))

    # ---------- opening a show ----------
    async def test_netflix_opens_the_show_by_its_link(self):
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "puffin-rock-netflix"})
        j = await r.json()
        self.assertEqual((r.status, j["opened"]), (200, "show"))
        self.assertEqual(self.links(), ["https://www.netflix.com/title/80091742"])
        self.assertEqual(self.launches(), [])

    async def test_no_rent_or_buy_and_an_episode_named_but_not_reached(self):
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "peppa-pig-1-3"})
        j = await r.json()
        self.assertEqual(r.status, 200)
        self.assertEqual(self.links(), ["https://www.netflix.com/title/80000001"])   # Netflix, not the Stan rental
        self.assertIn("Pick season 1 episode 3 there", j["note"])                     # said plainly

    async def test_an_app_with_no_show_links_opens_on_its_own_page(self):
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "bluey-abc-iview"})
        j = await r.json()
        self.assertEqual((r.status, j["opened"]), (200, "app"))
        self.assertEqual(self.links(), [])
        self.assertEqual(self.launches(), ["au.net.abc.iview.tv"])
        self.assertIn("Pick Bluey there", j["note"])

    async def test_a_parents_own_link_is_used_first(self):
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "bandit-time"})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.links(), ["https://tv.apple.com/au/show/bandit-time/umc.cmc.123"])

    async def test_a_refused_link_falls_back_to_the_app(self):
        self.s.fail_url.add("netflix.com")
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "puffin-rock-netflix"})
        j = await r.json()
        self.assertEqual((r.status, j["opened"]), (200, "app"))
        self.assertEqual(self.launches(), ["com.netflix.Netflix"])

    async def test_only_shows_on_the_shelf_and_only_for_a_kids_profile(self):
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "the-wire-hbo"})
        self.assertEqual(r.status, 404)
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "mum", "id": "bluey-abc-iview"})
        self.assertEqual(r.status, 404)
        r = await self.post("/api/appletv/kids/open?tv=lounge", {"who": "ruby", "id": "not-anywhere"})
        self.assertEqual(r.status, 404)                                                # nowhere to open it
        self.assertEqual((self.launches(), self.links()), ([], []))

    # ---------- the apps, and leaving ----------
    async def test_while_a_kid_watches_only_their_apps_open(self):
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix"})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.apple.TVSettings"})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.google.ios.youtube"})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.launches(), ["com.google.ios.youtube"])
        self.server.store.save_who("mum", "lounge")
        r = await self.post("/api/appletv/open?tv=lounge", {"bundle": "com.netflix.Netflix"})
        self.assertEqual(r.status, 200)

    async def test_leaving_the_kids_profile_needs_the_pin_on_the_bridge_too(self):
        r = await self.post("/api/who?tv=lounge", {"who": "mum"})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/who?tv=lounge", {"who": "mum", "pin": "0000"})
        self.assertEqual(r.status, 403)
        r = await self.post("/api/who?tv=lounge", {"who": "mum", "pin": PIN})
        self.assertEqual(r.status, 200)
        self.assertEqual(self.server.store.current_who("lounge"), "mum")


class ShowLinks(unittest.TestCase):
    def test_links_become_the_forms_tvos_apps_are_reported_to_take(self):
        self.assertEqual(A.show_link("netflix", None, "http://www.netflix.com/au/title/80117470"),
                         "https://www.netflix.com/title/80117470")
        self.assertEqual(A.show_link("apple-tv", "https://tv.apple.com/au/show/bluey/umc.cmc.1"),
                         "https://tv.apple.com/show/bluey/umc.cmc.1")
        self.assertEqual(A.show_link("disney-plus", "https://www.disneyplus.com/en-au/series/bluey/abc"),
                         "https://www.disneyplus.com/series/bluey/abc")
        self.assertEqual(A.show_link("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube://watch/dQw4w9WgXcQ")
        self.assertIsNone(A.show_link("abc-iview", "https://iview.abc.net.au/show/bluey"))      # no reported link
        self.assertIsNone(A.show_link("netflix", "https://www.netflix.com/watch/1234567", episode=True))
        self.assertIsNone(A.show_link("netflix", "https://evil.example/?u=netflix.com"))

    def test_bad_links_never_reach_the_wire(self):
        for bad in ("", "no scheme", "https://a b", "javascript:alert(1)", "x" * 2000):
            self.assertFalse(A.URL_RE.fullmatch(bad))


if __name__ == "__main__":
    unittest.main()
