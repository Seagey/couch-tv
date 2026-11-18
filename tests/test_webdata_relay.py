"""The bridge's relay for the web widgets (bridge/webdata.py, GET /api/webdata): it only knows the
news feeds and share price ids in its lists, never a link; it keeps an answer a few minutes; and its
lists match the TV's own (widget-web.js) and the two Android relays (WebData.kt). No live calls."""
import asyncio
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "bridge"))
import webdata


class UrlTests(unittest.TestCase):
    def test_every_feed_has_one_https_link(self):
        for k, u in webdata.FEEDS.items():
            with self.subTest(feed=k):
                self.assertEqual(webdata.url_for("news", k), u)
                self.assertTrue(u.startswith("https://"))

    def test_unknown_ids_and_links_are_refused(self):
        for src, ident in (("news", "https://evil.example/rss"), ("news", ""), ("news", "abc/../x"), ("weather", "abc"),
                           ("stocks", ""), ("stocks", "bhp.ax"), ("stocks", "BHP.AX&x=1"), ("stocks", "A,B,C,D,E,F,G,H,I"),
                           ("stocks", "http://x"), ("stocks", "BHP.AX,,../x"), ("", "")):
            with self.subTest(src=src, ident=ident):
                with self.assertRaises(webdata.BadSource):
                    webdata.url_for(src, ident)

    def test_symbols_make_one_yahoo_link(self):
        u = webdata.url_for("stocks", "^AXJO,BHP.AX,AUDUSD=X,BTC-AUD")
        self.assertTrue(u.startswith("https://query2.finance.yahoo.com/v7/finance/spark?symbols="))
        self.assertIn("%5EAXJO,BHP.AX,AUDUSD%3DX,BTC-AUD", u)
        self.assertTrue(u.endswith("&range=1d&interval=15m"))


class CacheTests(unittest.TestCase):
    def setUp(self):
        webdata._cache.clear()
        self.asked = []

    async def fetch(self, url):
        self.asked.append(url)
        return "<rss><item><title>One</title></item></rss>"

    def test_kept_a_few_minutes_then_asked_again(self):
        run = asyncio.run
        self.assertIn("One", run(webdata.get("news", "abc", fetch=self.fetch, now=1000)))
        run(webdata.get("news", "abc", fetch=self.fetch, now=1000 + 9 * 60))
        self.assertEqual(len(self.asked), 1)
        run(webdata.get("news", "abc", fetch=self.fetch, now=1000 + 11 * 60))
        self.assertEqual(len(self.asked), 2)

    def test_a_failure_is_raised_not_kept(self):
        async def down(url):
            raise OSError("down")
        with self.assertRaises(OSError):
            asyncio.run(webdata.get("news", "bbc", fetch=down, now=5))
        self.assertEqual(webdata._cache, {})


class SameListsTests(unittest.TestCase):
    """The TV page and both Android relays name the same feeds with the same links."""

    def read(self, *p):
        with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
            return f.read()

    def test_widget_web_js(self):
        js = self.read("tv-home", "web", "widget-web.js")
        for k, u in webdata.FEEDS.items():
            self.assertRegex(js, r'"?%s"?: \{ name: "[^"]+", url: "%s" \}' % (re.escape(k), re.escape(u)))

    def test_kotlin_relays(self):
        for p in (("tv-home", "android", "app", "src", "main", "java", "app", "couchtv", "launcher", "WebData.kt"),
                  ("on-tv", "android", "app", "src", "main", "java", "dev", "couchtv", "ontv", "WebData.kt")):
            kt = self.read(*p)
            with self.subTest(file=p[-4]):
                found = dict(re.findall(r'"([a-z-]+)" to "(https://[^"]+)"', kt))
                self.assertEqual(found, webdata.FEEDS)
                self.assertIn(webdata.SYMBOL.pattern.replace("\\", "\\\\"), kt)

    def test_design_js_allows_the_same_feeds(self):
        js = self.read("tv-home", "web", "design.js")
        m = re.search(r"var WEB_FEEDS = \[([^\]]+)\]", js)
        self.assertEqual(sorted(re.findall(r'"([a-z-]+)"', m.group(1))), sorted(webdata.FEEDS))


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    """GET /api/webdata through the bridge's own handler, with the source faked."""

    async def asyncSetUp(self):
        import server
        from aiohttp import web
        from aiohttp.test_utils import TestClient, TestServer
        webdata._cache.clear()
        self.real = webdata._fetch
        self.asked = []

        async def fake(url):
            self.asked.append(url)
            if "bbc" in url:
                raise OSError("down")
            return "<rss><item><title>One</title></item></rss>"
        webdata._fetch = fake
        app = web.Application()
        app.router.add_get("/api/webdata", server.h_webdata)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        webdata._fetch = self.real
        await self.client.close()

    async def test_answers(self):
        r = await self.client.get("/api/webdata?src=news&id=abc")
        j = await r.json()
        self.assertEqual((r.status, j["ok"], j["text"]), (200, True, "<rss><item><title>One</title></item></rss>"))
        r = await self.client.get("/api/webdata?src=news&id=https://evil.example/rss")
        self.assertEqual((r.status, (await r.json())["ok"]), (400, False))
        r = await self.client.get("/api/webdata?src=news&id=bbc")
        self.assertEqual((r.status, (await r.json())["ok"]), (502, False))
        self.assertEqual(len(self.asked), 2)   # the refused link was never asked for


class RouteTests(unittest.TestCase):
    def test_the_bridge_serves_it(self):
        src = self.read_server()
        self.assertIn('r.add_get("/api/webdata", h_webdata)', src)

    def read_server(self):
        with open(os.path.join(ROOT, "bridge", "server.py"), encoding="utf-8") as f:
            return f.read()


if __name__ == "__main__":
    unittest.main()
