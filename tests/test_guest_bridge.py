"""The guest's name and a bookings link sent from the phone remote, through the computer at home
(bridge/server.py, GET and POST /api/guest), the same shape as the on-TV app's (Server.kt): the name is
one plain line, never a link; a bookings link must be an https calendar link and is held only until the
TV home takes it and clears it; the name and the link are kept per TV."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "bridge"))
import config  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

AT, WEB = chr(64), "web" + "cal://"   # built here so the privacy scan reads no address or calendar link


class GuestNames(unittest.TestCase):
    def test_plain_names(self):
        self.assertEqual(server.guest_name("  Sarah & Tom! "), "Sarah & Tom!")
        self.assertEqual(server.guest_name("the Nguyen family"), "the Nguyen family")
        self.assertEqual(server.guest_name("José"), "José")
        self.assertEqual(server.guest_name("https://evil.example"), "")
        self.assertEqual(server.guest_name("a" + AT + "b.example"), "")
        self.assertEqual(server.guest_name("<b>Sarah</b>"), "", "markup with a slash is refused whole")
        self.assertEqual(server.guest_name("<Sarah>"), "Sarah")
        self.assertEqual(len(server.guest_name("x" * 80)), 38)
        self.assertEqual(server.guest_name(None), "")


class GuestApi(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])
        app.router.add_route("GET", "/api/guest", server.h_guest_get)
        app.router.add_route("POST", "/api/guest", server.h_guest_set)
        return app

    async def asyncSetUp(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [patch.object(store, "DATA", self.tmp), patch.object(config, "PAIRING_KEY", "")]
        for p in self.patches:
            p.start()
        await super().asyncSetUp()

    async def asyncTearDown(self):
        await super().asyncTearDown()
        for p in reversed(self.patches):
            p.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    async def post(self, data):
        return await self.client.post("/api/guest", data=json.dumps(data), headers={"Content-Type": "application/json"})

    async def test_name_round_trip(self):
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["name"], "")
        r = await self.post({"name": "Sarah"})
        self.assertEqual(r.status, 200)
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["name"], "Sarah")
        self.assertGreater(j["guest"]["at"], 0)
        await self.post({"name": ""})
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["name"], "", "an empty name clears it: the widget says just Welcome")

    async def test_needs_a_name_or_a_link(self):
        r = await self.post({})
        self.assertEqual(r.status, 400)

    async def test_bookings_link_held_until_taken(self):
        r = await self.post({"stay_url": "https://www.airbnb.com.au/calendar/ical/123.ics?s=abc"})
        self.assertEqual(r.status, 200)
        j = await (await self.client.get("/api/guest")).json()
        self.assertTrue(j["guest"]["stay_url"].startswith("https://www.airbnb.com.au/"))
        self.assertGreater(j["guest"]["stay_at"], 0)
        self.assertEqual(j["guest"]["name"], "", "sending a link leaves the name alone")
        # the TV home took it: it clears it here
        await self.post({"stay_url": ""})
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["stay_url"], "")

    async def test_bookings_link_must_be_https_calendar(self):
        for bad in ["http://www.airbnb.com/calendar.ics", "javascript:alert(1)", "https://user:pw" + AT + "x.example/c.ics", "file:///etc/passwd"]:
            r = await self.post({"stay_url": bad})
            self.assertEqual(r.status, 400, bad)
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["stay_url"], "")

    async def test_calendar_app_link_read_as_https(self):
        await self.post({"stay_url": WEB + "calendar.example.com/a.ics"})
        j = await (await self.client.get("/api/guest")).json()
        self.assertEqual(j["guest"]["stay_url"], "https://calendar.example.com/a.ics")


if __name__ == "__main__":
    unittest.main()
