"""/api/health says phone_page only when this computer serves the phone's Home settings page (/setup),
so the phone remote shows Home settings on this phone and Widgets on this TV for a bridge TV exactly
then (remote/src/phonePage.js hasPhonePage)."""
import os
import sys
import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import server  # noqa: E402


class PhonePageFlag(unittest.IsolatedAsyncioTestCase):
    async def health(self, with_page):
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/health", server.h_health)
        if with_page:
            async def page(request):
                return web.Response(text="<html></html>", content_type="text/html")
            app.router.add_get("/setup", page)
        c = TestClient(TestServer(app, host="127.0.0.1"))
        await c.start_server()
        try:
            with patch.object(config, "PAIRING_KEY", ""):
                r = await c.get("/api/health")
                return r.status, await r.json()
        finally:
            await c.close()

    async def test_no_page_no_flag(self):
        st, j = await self.health(False)
        self.assertEqual(st, 200)
        self.assertIs(j.get("phone_page"), False)

    async def test_page_served_flag_on(self):
        st, j = await self.health(True)
        self.assertEqual(st, 200)
        self.assertIs(j.get("phone_page"), True)

    def test_helper_reads_the_routes(self):
        a = web.Application()
        self.assertFalse(server.serves_phone_page(a))
        a.router.add_get("/setup/", lambda r: None)
        self.assertFalse(server.serves_phone_page(a), "only /setup itself counts")
        a.router.add_get("/setup", lambda r: None)
        self.assertTrue(server.serves_phone_page(a))


if __name__ == "__main__":
    unittest.main()
