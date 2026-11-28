"""Ask through a Home Assistant conversation agent (ask.engine "home_assistant", bridge/claude.py run_ha):
what is posted, how the reply is split, plain words when Home Assistant says no, and when Ask is on."""
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import claude  # noqa: E402

TOKEN = "test-token-not-real"
AGENT = "conversation.couch_tv"
REPLY = 'Putting on Bluey.\nOPTIONS: [{"label": "Next one", "text": "Play the next episode"}]'


class FakeHA(BaseHTTPRequestHandler):
    posted = []
    mode = "ok"

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path != "/api/conversation/process" or self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.send(401, {"message": "401: Unauthorized"})
        FakeHA.posted.append(body)
        if body.get("agent_id") != AGENT:
            return self.send(404, {"message": "not found"})
        if FakeHA.mode == "slow":
            threading.Event().wait(1.5)
        if FakeHA.mode == "html":
            raw = b"<html>log in</html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            return self.wfile.write(raw)
        failed = FakeHA.mode == "error"
        text = "Sorry, I had a problem talking to the AI" if failed else REPLY
        self.send(200, {"response": {"response_type": "error" if failed else "action_done",
                                     "speech": {"plain": {"speech": text}}}})

    def send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class HAEngine(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), FakeHA)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.root = f"http://127.0.0.1:{cls.srv.server_port}/api"

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        FakeHA.posted, FakeHA.mode = [], "ok"
        claude._last.clear()
        self.token = TOKEN
        for p in (patch.object(config, "ASK_ENGINE", "home_assistant"),
                  patch.object(config, "ASK_AGENT_ID", AGENT),
                  patch.object(config, "ha_location", lambda env=None: (self.root, self.token)),
                  patch.object(claude.taste, "summary", return_value="")):
            p.start()
            self.addCleanup(p.stop)

    async def say(self, text="hi"):
        return (await claude.ask(text, None, {}))["say"]

    async def test_reply_split_and_context_posted(self):
        res = await claude.ask("put on Bluey", None, {}, lang="pl")
        self.assertEqual(res["say"], "Putting on Bluey.")
        self.assertEqual(res["options"], [{"label": "Next one", "text": "Play the next episode"}])
        post = FakeHA.posted[0]
        self.assertEqual((post["agent_id"], post["language"]), (AGENT, "pl"))
        self.assertIn(f"[TV: {config.DEFAULT_TV}]", post["text"])
        self.assertIn("Polish", post["text"])
        self.assertIn(config.COUNTRY_NAME, post["text"])
        self.assertNotIn("conversation_id", post)
        self.assertNotIn("Last ask", post["text"])
        await claude.ask("yes", None, {}, lang="pl")
        self.assertIn("Last ask on this TV", FakeHA.posted[1]["text"])
        self.assertIn("put on Bluey", FakeHA.posted[1]["text"])

    async def test_failures_are_plain_words(self):
        self.token = "wrong"
        self.assertIn("did not accept the token", await self.say())
        self.token = TOKEN
        with patch.object(config, "ASK_AGENT_ID", "conversation.nope"):
            self.assertIn("no conversation agent conversation.nope", await self.say())
        FakeHA.mode = "html"
        asks = {}
        said = (await claude.ask("hi", None, asks))["say"]
        self.assertIn("did not answer the way", said)
        self.assertEqual(asks, {})
        FakeHA.mode = "error"
        self.assertIn("problem talking", await self.say())
        FakeHA.mode = "slow"
        with self.assertRaises(RuntimeError) as cm:
            await claude.run_ha("x", timeout=0.3)
        self.assertIn("too long", str(cm.exception))
        FakeHA.mode = "ok"
        with patch.object(config, "ha_location", lambda env=None: ("http://127.0.0.1:9/api", TOKEN)):
            said = await self.say()
        self.assertIn("could not reach Home Assistant", said)
        self.assertNotIn(TOKEN, said)


class Settings(unittest.TestCase):
    def test_enabled_rules(self):
        with patch.object(config, "ha_location", lambda env=None: ("http://x/api", "t")):
            self.assertTrue(config._ask_enabled({}, "home_assistant", AGENT))
            self.assertFalse(config._ask_enabled({}, "home_assistant", ""))
            self.assertFalse(config._ask_enabled({"enabled": False}, "home_assistant", AGENT))
        with patch.object(config, "ha_location", lambda env=None: None):
            self.assertFalse(config._ask_enabled({}, "home_assistant", AGENT))
        with patch.object(config, "_claude_present", lambda: True):
            self.assertTrue(config._ask_enabled({}, "claude_cli", ""))
        with patch.object(config, "_claude_present", lambda: False):
            self.assertFalse(config._ask_enabled({}, "claude_cli", ""))
            self.assertTrue(config._ask_enabled({"enabled": True}, "claude_cli", ""))

    def test_engine_config_wins_then_env(self):
        env = {"ASK_ENGINE": "home_assistant", "ASK_AGENT_ID": "conversation.a"}
        self.assertEqual(config._ask_engine({}, env), ("home_assistant", "conversation.a"))
        self.assertEqual(config._ask_engine({"engine": "claude_cli", "agent_id": "conversation.b"}, env),
                         ("claude_cli", "conversation.b"))
        self.assertEqual(config._ask_engine({"engine": "bogus"}, {}), ("claude_cli", ""))

    def test_where_home_assistant_is(self):
        self.assertEqual(config.ha_location({"SUPERVISOR_TOKEN": "s"}), ("http://supervisor/core/api", "s"))
        with patch.object(config, "CONFIG", {"home_assistant": {"url": "http://ha.example:8123/"}}):
            self.assertEqual(config.ha_location({"HOME_ASSISTANT_TOKEN": "t"}), ("http://ha.example:8123/api", "t"))
            self.assertIsNone(config.ha_location({}))


if __name__ == "__main__":
    unittest.main()
