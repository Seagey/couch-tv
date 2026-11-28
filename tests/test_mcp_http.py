"""The TV's MCP server in HTTP mode (COUCH_MCP_HTTP=1, for Home Assistant's MCP client), against a fake
bridge: the tool set (tv_ names, no screenshot, no uninstall), the pairing key reaching the bridge,
power off refused unless allowed, a slow tool answering "pending", and a foreign Host header refused.
Stdio mode keeps its own tool names.

  .venv/bin/python -m unittest tests/test_mcp_http.py
"""
import asyncio
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "bridge"))

from mcp import ClientSession  # noqa: E402
from mcp.client.streamable_http import streamablehttp_client  # noqa: E402

KEY = "test-key-mcp-http-0001"
SEEN = []


class FakeBridge(http.server.BaseHTTPRequestHandler):
    delay = 0
    done = []   # paths the fake has answered in full

    def log_message(self, *a):
        pass

    def reply(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        SEEN.append((self.command, self.path, body, self.headers.get("Authorization")))
        time.sleep(self.delay)
        FakeBridge.done.append(self.path)
        out = json.dumps({"ok": True}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    do_GET = do_POST = reply


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class HttpMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bridge = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeBridge)
        threading.Thread(target=cls.bridge.serve_forever, daemon=True).start()
        cls.port = free_port()
        env = dict(os.environ, COUCH_MCP_HTTP="1", COUCH_MCP_PORT=str(cls.port), COUCH_MCP_WAIT="1.5",
                   BRIDGE_URL="http://127.0.0.1:%d" % cls.bridge.server_address[1], BRIDGE_KEY=KEY,
                   COUCH_CONFIG=os.path.join(HERE, "no-such-config.json"))
        env.pop("COUCH_MCP_ALLOW_POWER_OFF", None)
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "bridge", "mcp_server.py")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", cls.port)) == 0:
                    return
            time.sleep(0.1)
        raise RuntimeError("the MCP server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.bridge.shutdown()

    def setUp(self):
        SEEN.clear()
        FakeBridge.done.clear()

    def run_tools(self, work):
        async def go():
            async with streamablehttp_client("http://127.0.0.1:%d/mcp" % self.port) as (r, w, _):
                async with ClientSession(r, w) as s:
                    await s.initialize()
                    return await work(s)
        return asyncio.run(go())

    def test_tool_set(self):
        names = {t.name for t in self.run_tools(lambda s: s.list_tools()).tools}
        self.assertTrue({"tv_play", "tv_list", "tv_key", "tv_now", "tv_ui", "tv_says"} <= names, names)
        self.assertFalse({"tv_uninstall_app", "tv_screenshot", "uninstall_app", "screenshot"} & names)
        self.assertTrue(all(n.startswith("tv_") for n in names), names)

    def test_key_reaches_the_bridge_with_the_key(self):
        r = self.run_tools(lambda s: s.call_tool("tv_key", {"key": "home"}))
        self.assertFalse(r.isError)
        self.assertEqual([x for x in SEEN if x[1] == "/api/key"], [("POST", "/api/key", {"key": "home", "hold": False}, "Bearer " + KEY)])

    def test_power_off_is_refused(self):
        r = self.run_tools(lambda s: s.call_tool("tv_power", {"state": "off"}))
        self.assertIn("switched off", r.content[0].text)
        r = self.run_tools(lambda s: s.call_tool("tv_off_after_episode", {}))
        self.assertIn("switched off", r.content[0].text)
        for k in ("power", "sleep", "POWER"):
            r = self.run_tools(lambda s: s.call_tool("tv_key", {"key": k}))
            self.assertIn("switched off", r.content[0].text)
        r = self.run_tools(lambda s: s.call_tool("tv_power", {"state": "toggle"}))
        self.assertIn("switched off", r.content[0].text)
        self.assertEqual(SEEN, [])

    def test_power_on_works(self):
        self.run_tools(lambda s: s.call_tool("tv_power", {"state": "on"}))
        self.assertEqual(SEEN[0][:3], ("POST", "/api/power", {"state": "on"}))

    def test_slow_tool_answers_pending(self):
        FakeBridge.delay = 4   # the server waits COUCH_MCP_WAIT=1.5 s, then answers pending
        try:
            t0 = time.time()
            r = self.run_tools(lambda s: s.call_tool("tv_now", {}))
            took = time.time() - t0
        finally:
            FakeBridge.delay = 0
        self.assertLess(took, 3.5)
        self.assertTrue(json.loads(r.content[0].text)["pending"])
        time.sleep(3)   # the request carries on in the background and the bridge finishes it
        self.assertIn(("GET", "/api/now"), [x[:2] for x in SEEN])
        self.assertIn("/api/now", FakeBridge.done)

    def test_foreign_host_is_refused(self):
        req = urllib.request.Request("http://127.0.0.1:%d/mcp" % self.port, method="POST", data=b"{}",
                                     headers={"Host": "evil.example", "Content-Type": "application/json",
                                              "Accept": "application/json, text/event-stream"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=5)
        e.exception.close()
        self.assertEqual(e.exception.code, 421)


class StdioMode(unittest.TestCase):
    def test_names_are_unchanged(self):
        import mcp_server
        self.assertFalse(mcp_server.HTTP)
        names = {t.name for t in mcp_server.mcp._tool_manager.list_tools()}
        for n in ("play", "find", "key", "now", "tvs", "screenshot", "uninstall_app", "power", "ui", "list_widgets", "tv_says"):
            self.assertIn(n, names)
        self.assertFalse([n for n in names if n.startswith("tv_") and n != "tv_says"])

    def test_power_off_still_reaches_the_bridge(self):
        import mcp_server
        seen = []
        with patch.object(mcp_server, "call", lambda *a, **k: seen.append(a) or {"ok": True}):
            mcp_server.power("off")
            mcp_server.key("power")
        self.assertEqual([a[1] for a in seen], ["/api/power", "/api/key"])


if __name__ == "__main__":
    unittest.main()
