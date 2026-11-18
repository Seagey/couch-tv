"""Ask AI on the TV and the person's own AI agent through the bridge (bridge/say.py, /api/say*,
mcp_server.py show_message and set_home_design): plain bounded words, real design codes only, the
pairing key guards it like every other endpoint, and the phone's last ask shows on the TV."""
import os
import sys
import time
import unittest
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import say  # noqa: E402
import server  # noqa: E402
import claude  # noqa: E402


class SayRules(unittest.TestCase):
    def setUp(self):
        say.clear()

    def test_codes_like_the_tv(self):
        self.assertEqual(say.read_code(" abcde fghjk "), "ABCDE-FGHJK")
        self.assertEqual(say.read_code("ABCDE-FGHJ1"), "")
        self.assertEqual(say.read_code("https://evil.example/d.json"), "")
        self.assertEqual(say.read_code("ctv1-" + "A" * 43), "CTV1-" + "A" * 43)

    def test_message_plain_and_bounded(self):
        m = say.message("tv", "Dinner\x07   is ready" + "x" * 400, None, 9999)
        self.assertEqual(len(m["text"]), say.MAX_TEXT)
        self.assertTrue(m["text"].startswith("Dinner is ready"))
        self.assertEqual(m["from"], "Your AI")
        self.assertEqual(m["seconds"], 600)
        with self.assertRaises(ValueError):
            say.message("tv", "   ")
        with self.assertRaises(ValueError):
            say.message("tv", "hi", seconds="soon")

    def test_snapshot_reads_the_last_ask(self):
        s = say.snapshot("tv", {"text": "what's on", "reply": "Bluey", "ts": time.time()})
        self.assertEqual(s["ask"]["a"], "Bluey")
        self.assertIsNone(s["message"])


class SayHttp(AioHTTPTestCase):
    async def get_application(self):
        say.clear()
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/say", server.h_say)
        app.router.add_post("/api/say/message", server.h_say_message)
        app.router.add_post("/api/say/design", server.h_say_design)
        return app

    @unittest_run_loop
    async def test_message_design_and_last_ask(self):
        with patch.object(config, "PAIRING_KEY", ""):
            r = await self.client.post("/api/say/message", json={"text": "Dinner is ready", "from": "Claude", "seconds": 20})
            self.assertEqual(r.status, 200)
            r = await self.client.post("/api/say/design", json={"code": "abcde-fghjk"})
            j = await r.json()
            self.assertEqual(j["design"]["code"], "ABCDE-FGHJK")
            self.assertTrue(j["asks_first"])
            r = await self.client.post("/api/say/design", json={"code": "javascript:alert(1)"})
            self.assertEqual(r.status, 400)
            claude._last[server.DEFAULT_TV] = {"text": "what's on", "reply": "Bluey at 7", "ts": time.time()}
            try:
                j = await (await self.client.get("/api/say")).json()
            finally:
                claude._last.pop(server.DEFAULT_TV, None)
            self.assertEqual(j["message"]["text"], "Dinner is ready")
            self.assertEqual(j["design"]["code"], "ABCDE-FGHJK")
            self.assertEqual(j["ask"]["a"], "Bluey at 7")

    @unittest_run_loop
    async def test_pairing_key_guards_it(self):
        with patch.object(config, "PAIRING_KEY", "secretkey1234"):
            r = await self.client.post("/api/say/message", json={"text": "hi"})
            self.assertEqual(r.status, 401)
            r = await self.client.post("/api/say/message", json={"text": "hi"}, headers={"Authorization": "Bearer secretkey1234"})
            self.assertEqual(r.status, 200)


class AgentTools(unittest.TestCase):
    def test_mcp_has_the_agent_tools(self):
        src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge", "mcp_server.py")).read()
        for name in ("def show_message(", "def set_home_design(", "def tv_says("):
            self.assertIn(name, src)
        self.assertIn('"/api/say/message"', src)
        self.assertIn('"/api/say/design"', src)


if __name__ == "__main__":
    unittest.main()
