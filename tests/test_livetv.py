"""The Live TV tile's channel list (bridge/livetv.py, /api/livetv/channels) and its build setting.

Samsung's own TV Plus app froze couch-tv behind it (a QN90F in India, Nov 2026), so couch-tv plays
Samsung TV Plus's free channels itself (samsung/app/livetv.js). The bridge reads the 2 MB list of
every region at most every 6 hours and hands the TV its own region, in channel number order, with
what is on now.

Run: python3 -m unittest tests/test_livetv.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import config  # noqa: E402
import livetv  # noqa: E402

NOW = 1_800_000_000
LIST = {
    "slug": "stvp-{id}",
    "regions": {
        "in": {"name": "India", "channels": {
            "IN3800001ZH": {"name": "News One HD", "chno": 1007, "group": "Hindi News", "logo": "https://x.example/a.png",
                            "programs": [[NOW - 7200, "Morning"], [NOW - 600, "Halla Bol"], [NOW + 600, "Later"]]},
            "IN4600012BD": {"name": "ABP News", "chno": 1004, "group": "Hindi News", "programs": []},
            "IN38000072R": {"name": "The Movie Club", "chno": 1002, "group": "Movies"},
            "INNOCHNO": {"name": "No Number", "group": "English News",
                         "programs": [[NOW + 60, "Not yet"]]},
            "INDRM": {"name": "Locked", "chno": 5, "group": "Movies", "license_url": "https://lic.example/"},
            "bad id!": {"name": "Broken", "chno": 1},
        }},
        "us": {"name": "USA", "channels": {"US1": {"name": "Other", "chno": 1, "group": "News"}}},
    },
}


class RegionTests(unittest.TestCase):
    def test_one_region_in_number_order_with_what_is_on_now(self):
        out = livetv.region_channels(LIST, "in", now=NOW)
        self.assertEqual([c["id"] for c in out], ["IN38000072R", "IN4600012BD", "IN3800001ZH", "INNOCHNO"])
        news = out[2]
        self.assertEqual(news, {"id": "IN3800001ZH", "name": "News One HD", "chno": 1007, "group": "Hindi News",
                               "logo": "https://x.example/a.png", "now": "Halla Bol"})
        self.assertEqual(out[1]["now"], "")
        self.assertEqual(out[3]["now"], "", "a programme that has not started is not on now")
        self.assertIsNone(out[3]["chno"])
        self.assertNotIn("US1", [c["id"] for c in out])
        self.assertNotIn("INDRM", [c["id"] for c in out], "a channel with a licence only Samsung's app plays")

    def test_another_country_comes_by_group_under_its_name(self):
        out = livetv.region_channels(LIST, "us", now=NOW, abroad=True)
        self.assertEqual([(c["id"], c["group"], c["region"]) for c in out], [("US1", "USA · News", "us")])
        self.assertNotIn("region", livetv.region_channels(LIST, "in", now=NOW)[0])

    def test_unknown_region_is_empty(self):
        self.assertEqual(livetv.region_channels(LIST, "zz", now=NOW), [])
        self.assertEqual(livetv.region_channels(None, "in", now=NOW), [])


class CacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        livetv._cache.update(at=0.0, data=None)
        self.reads = 0

    async def fetch(self):
        self.reads += 1
        return LIST

    async def test_read_once_for_six_hours_and_region_from_the_country(self):
        with patch.object(livetv, "_fetch", self.fetch), patch.object(config, "COUNTRY", "IN"):
            first = await livetv.channels()
            self.assertEqual(len(first), 4)
            self.assertEqual(await livetv.channels("IN"), await livetv.channels("in"))
            self.assertEqual(self.reads, 1, "one read serves every ask")
            self.assertEqual([c["id"] for c in await livetv.channels("us")], ["US1"])
            self.assertEqual(await livetv.channels("../x"), [])
            both = await livetv.channels("in", ["US", "us", "in", "zz", "../"])
            self.assertEqual([c["id"] for c in both][-2:], ["INNOCHNO", "US1"], "the other region last, once")
            self.assertEqual((both[-1]["group"], both[-1]["region"]), ("USA · News", "us"))
            livetv._cache["at"] -= livetv.EVERY
            await livetv.channels()
            self.assertEqual(self.reads, 2, "read again after 6 hours")

    async def test_a_failed_read_keeps_the_older_list(self):
        async def broken():
            raise OSError("no network")
        with patch.object(livetv, "_fetch", self.fetch):
            await livetv.channels("in")
        livetv._cache["at"] -= livetv.EVERY
        with patch.object(livetv, "_fetch", broken):
            self.assertEqual(len(await livetv.channels("in")), 4)
        livetv._cache.update(at=0.0, data=None)
        with patch.object(livetv, "_fetch", broken):
            with self.assertRaises(OSError):
                await livetv.channels("in")

    async def test_the_route_answers_and_says_so_when_there_is_no_list(self):
        import server

        class Req:
            query = {"region": "in"}
        with patch.object(livetv, "_fetch", self.fetch):
            resp = await server.h_livetv_channels(Req())
        body = json.loads(resp.text)
        self.assertTrue(body["ok"])
        self.assertEqual(body["channels"][0]["id"], "IN38000072R")

        async def broken():
            raise OSError("no network")
        livetv._cache.update(at=0.0, data=None)
        with patch.object(livetv, "_fetch", broken):
            with self.assertRaises(server.ApiError) as e:
                await server.h_livetv_channels(Req())
        self.assertEqual((e.exception.status, e.exception.key), (503, "err_something_wrong"))
        routes = {(r.method, r.resource.canonical) for r in server.make_app().router.routes()}
        self.assertIn(("GET", "/api/livetv/channels"), routes)


MASTER = """#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="und",DEFAULT=YES,URI="../audio/4.m3u8"
#EXT-X-STREAM-INF:CODECS="avc1.42c00d",RESOLUTION=320x180,BANDWIDTH=200000
../low/0.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=9000000,RESOLUTION=1920x1080,BANDWIDTH=2500000,AUDIO="a"
../hd/5.m3u8
#EXT-X-STREAM-INF:RESOLUTION=1280x720,BANDWIDTH=4000000
../mid/4.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,URI="../iframe.m3u8"
"""


class SharpTests(unittest.IsolatedAsyncioTestCase):
    BASE = "https://cdn.example/v1/master/abc/samsung_athd.m3u8?ads.x=1"

    def test_only_the_sharpest_picture_with_whole_addresses(self):
        out = livetv.best_master(MASTER, self.BASE).splitlines()
        self.assertEqual(out, [
            "#EXTM3U", "#EXT-X-VERSION:6", "#EXT-X-INDEPENDENT-SEGMENTS",
            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="und",DEFAULT=YES,URI="https://cdn.example/v1/master/audio/4.m3u8"',
            '#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=9000000,RESOLUTION=1920x1080,BANDWIDTH=2500000,AUDIO="a"',
            "https://cdn.example/v1/master/hd/5.m3u8"])

    def test_not_a_master_playlist(self):
        self.assertIsNone(livetv.best_master("#EXTM3U\n#EXTINF:6.0,\nseg.ts\n", self.BASE))
        self.assertIsNone(livetv.best_master("<html>", self.BASE))
        self.assertIsNone(livetv.best_master("", self.BASE))

    async def test_the_route_hands_the_playlist_or_sends_the_tv_to_the_stream(self):
        import server
        from aiohttp import web

        class Req:
            match_info = {"id": "IN3800001ZH"}

        async def sharp(cid):
            return livetv.best_master(MASTER, self.BASE)
        with patch.object(livetv, "sharp", sharp):
            resp = await server.h_livetv_play(Req())
        self.assertEqual(resp.content_type, "application/vnd.apple.mpegurl")
        self.assertIn("https://cdn.example/v1/master/hd/5.m3u8", resp.text)

        async def broken(cid):
            raise OSError("no network")
        with patch.object(livetv, "sharp", broken):
            with self.assertRaises(web.HTTPFound) as e:
                await server.h_livetv_play(Req())
        self.assertEqual(e.exception.location, "https://jmp2.uk/stvp-IN3800001ZH")
        routes = {(r.method, r.resource.canonical) for r in server.make_app().router.routes()}
        self.assertIn(("GET", "/api/livetv/play/{id}.m3u8"), routes)


class RegionsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        livetv._cache.update(at=0.0, data=None)
        livetv._plays.clear()

    async def test_other_countries_with_sports_and_whether_they_play_here(self):
        data = json.loads(json.dumps(LIST))
        data["regions"]["gb"] = {"name": "UK", "channels": {
            "GB1": {"name": "Premier Football TV", "chno": 3, "group": "Entertainment"},
            "GB2": {"name": "Fight Night", "chno": 4, "group": "Sports"},
            "GB3": {"name": "Cooking", "chno": 1, "group": "Food"},
            "GBDRM": {"name": "Locked Sport", "chno": 2, "group": "Sports", "license_url": "x"}}}
        tried = []

        async def fetch():
            return data

        async def plays(session, cid):
            tried.append(cid)
            return cid != "GB2"
        with patch.object(livetv, "_fetch", fetch), patch.object(livetv, "_plays_here", plays), \
                patch.object(config, "COUNTRY", "IN"):
            out = await livetv.regions()
            self.assertEqual([r["code"] for r in out], ["us", "gb"], "best played first, home left out")
            gb = out[1]
            self.assertEqual((gb["channels"], gb["sports"], gb["played"], gb["tried"]), (3, 2, 1, 2))
            self.assertEqual(gb["examples"], ["Premier Football TV", "Fight Night"], "sports first, no DRM")
            self.assertEqual(sorted(tried), ["GB1", "GB2", "US1"])
            await livetv.regions()
            self.assertEqual(len(tried), 3, "tried at most every 6 hours")

    async def test_the_choice_is_kept_by_the_bridge_and_used_for_the_channels(self):
        import server
        saved = {}

        class TV:
            kind, open_on_power_on, live_regions = "samsung", True, []

            def set_behaviour(self, open_on_power_on=None, live_regions=None):
                saved.update(regions=live_regions, power=open_on_power_on)
                if live_regions is not None:
                    self.live_regions = live_regions

        class Req:
            method, query = "POST", {}

            def __init__(self, data):
                self.data = data

        async def body(request):
            return request.data

        async def fetch():
            return LIST
        with patch.object(server, "tv", TV()), patch.object(server, "body", body), \
                patch.object(livetv, "_fetch", fetch), patch.object(config, "COUNTRY", "IN"):
            j = json.loads((await server.h_tizen_behaviour(Req({"live_regions": ["us", "us"]}))).text)
            self.assertEqual((j["live_regions"], saved), (["us"], {"regions": ["us"], "power": None}))
            for bad in ({"live_regions": ["USA"]}, {"live_regions": "us"}, {}, {"open_on_power_on": "yes"}):
                with self.assertRaises(server.ApiError):
                    await server.h_tizen_behaviour(Req(bad))
            chans = json.loads((await server.h_livetv_channels(Req({}))).text)["channels"]
            self.assertEqual(chans[-1]["id"], "US1")


class BuildTests(unittest.TestCase):
    def build(self, tv):
        cfg = os.path.join(tempfile.mkdtemp(), "config.json")
        with open(cfg, "w") as f:
            json.dump({"default_tv": "lounge", "tvs": [dict({"id": "lounge", "name": "Lounge", "kind": "samsung",
                                                             "ip": "192.0.2.5"}, **tv)]}, f)
        out = subprocess.run([sys.executable, os.path.join(ROOT, "samsung", "build.py"), "--bridge", "http://192.0.2.1:5400"],
                             capture_output=True, text=True, cwd=ROOT, env=dict(os.environ, COUCH_CONFIG=cfg))
        if out.returncode:
            return out, None, None
        with zipfile.ZipFile(os.path.join(ROOT, "build", "samsung", "CouchTV.wgt")) as z:
            return out, z.read("settings.js").decode(), z.read("index.html").decode()

    def settings(self, text):
        return json.loads(text.split("=", 1)[1].strip().rstrip(";"))

    def test_live_tv_reaches_the_app(self):
        out, settings, index = self.build({"live_tv": {"groups": ["Hindi News"]}, "app_names": {"local.livetv": "News"}})
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(self.settings(settings)["live_tv"], {"groups": ["Hindi News"], "name": "News"})
        self.assertIn('<script src="tizen.js"></script>\n<script src="livetv.js"></script>', index)
        _, settings, _ = self.build({"live_tv": True})
        self.assertEqual(self.settings(settings)["live_tv"], {"groups": [], "name": "Live TV"})
        _, settings, _ = self.build({})
        self.assertIsNone(self.settings(settings)["live_tv"])

    def test_bad_live_tv_is_refused(self):
        for bad in ("yes", {"groups": "Hindi News"}, {"start": "IN3800001ZH"}, {"groups": [""]}, {"channel": "x"},
                    {"more_regions": ["us"]}):
            out, _, _ = self.build({"live_tv": bad})
            self.assertNotEqual(out.returncode, 0, bad)
            self.assertIn("live_tv", out.stderr + out.stdout)


if __name__ == "__main__":
    unittest.main()
