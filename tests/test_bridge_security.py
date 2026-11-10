"""couch-tv#73: Bridge pairing key, origin filtering, and POST body Content-Type enforcement."""
import json
import os
import sys
import unittest
from unittest.mock import patch, AsyncMock
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop, make_mocked_request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import config  # noqa: E402
import server  # noqa: E402


class TestOriginAndAuthHelpers(unittest.TestCase):
    def test_allowed_origins_bridge_own_and_tv_homes(self):
        req = make_mocked_request("GET", "/api/now", headers={"Host": "192.0.2.10:5400"})

        # Bridge's own origin
        with patch.object(server, "lan_ipv4", return_value="192.0.2.10"):
            self.assertTrue(server.is_allowed_origin(req, "http://192.0.2.10:5400"))
            self.assertTrue(server.is_allowed_origin(req, "http://127.0.0.1:5400"))
            self.assertTrue(server.is_allowed_origin(req, "http://localhost:5400"))
            self.assertTrue(server.is_allowed_origin(req, "http://localhost:5173"))  # Vite dev server

        # Host header spoofing / DNS rebinding must NOT be allowed
        req_spoofed = make_mocked_request("GET", "/api/now", headers={"Host": "evil.com:5400"})
        self.assertFalse(server.is_allowed_origin(req_spoofed, "http://evil.com:5400"))

        # TV home origins
        self.assertTrue(server.is_allowed_origin(req, "null"))  # file:// WebView in browser standard
        self.assertTrue(server.is_allowed_origin(req, "file://"))
        self.assertTrue(server.is_allowed_origin(req, "http://home.tvos.invalid"))
        self.assertTrue(server.is_allowed_origin(req, "widget://CouchTVApp.Home"))

        # Arbitrary / malicious origins must be refused
        self.assertFalse(server.is_allowed_origin(req, "http://evil.com"))
        self.assertFalse(server.is_allowed_origin(req, "https://attacker.org"))
        self.assertFalse(server.is_allowed_origin(req, "http://192.0.2.10:9999"))
        self.assertFalse(server.is_allowed_origin(req, ""))
        self.assertFalse(server.is_allowed_origin(req, None))

    def test_extract_auth_key(self):
        # Bearer header
        req1 = make_mocked_request("GET", "/api/now", headers={"Authorization": "Bearer mysecret"})
        self.assertEqual(server.extract_auth_key(req1), "mysecret")

        # X-API-Key header
        req2 = make_mocked_request("GET", "/api/now", headers={"X-API-Key": "mysecret2"})
        self.assertEqual(server.extract_auth_key(req2), "mysecret2")

        # Query param ?key=
        req3 = make_mocked_request("GET", "/api/now?key=mysecret3")
        self.assertEqual(server.extract_auth_key(req3), "mysecret3")

        # Query param ?token=
        req4 = make_mocked_request("GET", "/api/now?token=mysecret4")
        self.assertEqual(server.extract_auth_key(req4), "mysecret4")

        # Missing
        req5 = make_mocked_request("GET", "/api/now")
        self.assertIsNone(server.extract_auth_key(req5))

    def test_is_authed_when_pairing_key_disabled(self):
        with patch.object(config, "PAIRING_KEY", ""):
            req = make_mocked_request("GET", "/api/now")
            self.assertTrue(server.is_authed(req))

    def test_is_authed_when_pairing_key_enabled(self):
        with patch.object(config, "PAIRING_KEY", "secretkey123"):
            req_good = make_mocked_request("GET", "/api/now", headers={"Authorization": "Bearer secretkey123"})
            self.assertTrue(server.is_authed(req_good))

            req_bad = make_mocked_request("GET", "/api/now", headers={"Authorization": "Bearer wrong"})
            self.assertFalse(server.is_authed(req_bad))

            req_none = make_mocked_request("GET", "/api/now")
            self.assertFalse(server.is_authed(req_none))


class TestBridgeSecurityApp(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])
        app.router.add_get("/api/health", server.h_health)
        app.router.add_post("/api/pair", server.h_pair)
        app.router.add_get("/bridge/shim.js", server.h_bridge_shim)

        async def h_dummy_now(request):
            return server.ok(state="playing")

        async def h_dummy_power(request):
            b = await server.body(request)
            return server.ok(power=b.get("state"))

        app.router.add_get("/api/now", h_dummy_now)
        app.router.add_post("/api/power", h_dummy_power)
        app.router.add_route("OPTIONS", "/api/{tail:.*}", server.h_options)
        return app

    async def get_server(self, app):
        from aiohttp.test_utils import TestServer
        import socket
        for _ in range(5):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("127.0.0.1", 0))
                return TestServer(app, sock=sock)
            except OSError:
                sock.close()
                await asyncio.sleep(0.05)
        return await super().get_server(app)

    async def tearDownAsync(self):
        await super().tearDownAsync()
        import asyncio
        await asyncio.sleep(0.05)

    @unittest_run_loop
    async def test_cors_origin_allowlist_and_rejection(self):
        # 1. Allowed origin gets Access-Control-Allow-Origin matching origin and Vary: Origin
        resp = await self.client.get("/api/health", headers={"Origin": "http://127.0.0.1:5400"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5400")
        self.assertEqual(resp.headers.get("Vary"), "Origin")
        self.assertIn("Authorization", resp.headers.get("Access-Control-Allow-Headers", ""))

        # 2. TV origin "null" is allowed
        resp_null = await self.client.get("/api/health", headers={"Origin": "null"})
        self.assertEqual(resp_null.status, 200)
        self.assertEqual(resp_null.headers.get("Access-Control-Allow-Origin"), "null")

        # 3. Disallowed origin (e.g. evil.com) is rejected with 403 Forbidden (couch-tv#73)
        resp_evil = await self.client.get("/api/health", headers={"Origin": "http://evil.com"})
        self.assertEqual(resp_evil.status, 403)
        self.assertIsNone(resp_evil.headers.get("Access-Control-Allow-Origin"))

        # 4. Disallowed origin POST request is rejected before handler execution (couch-tv#73)
        resp_evil_post = await self.client.post("/api/power",
                                                headers={"Origin": "http://evil.com", "Content-Type": "application/json"},
                                                data=json.dumps({"state": "off"}))
        self.assertEqual(resp_evil_post.status, 403)

        # 5. Preflight OPTIONS from disallowed origin returns 403 Forbidden
        resp_opt_bad = await self.client.options("/api/now", headers={"Origin": "http://evil.com"})
        self.assertEqual(resp_opt_bad.status, 403)
        self.assertIsNone(resp_opt_bad.headers.get("Access-Control-Allow-Origin"))

        # 6. Preflight OPTIONS from allowed origin returns 204 No Content with CORS headers
        resp_opt_good = await self.client.options("/api/now", headers={"Origin": "http://127.0.0.1:5400"})
        self.assertEqual(resp_opt_good.status, 204)
        self.assertEqual(resp_opt_good.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5400")

    @unittest_run_loop
    async def test_post_content_type_enforcement(self):
        # 1. application/json is accepted
        resp_json = await self.client.post("/api/power",
                                           headers={"Content-Type": "application/json"},
                                           data=json.dumps({"state": "off"}))
        self.assertEqual(resp_json.status, 200)
        data = await resp_json.json()
        self.assertEqual(data.get("power"), "off")

        # 2. application/x-www-form-urlencoded is rejected with 415
        resp_form = await self.client.post("/api/power",
                                           headers={"Content-Type": "application/x-www-form-urlencoded"},
                                           data="state=off")
        self.assertEqual(resp_form.status, 415)
        err = await resp_form.json()
        self.assertIn("Content-Type must be application/json", err.get("error", ""))

        # 3. text/plain is rejected with 415
        resp_text = await self.client.post("/api/power",
                                           headers={"Content-Type": "text/plain"},
                                           data='{"state":"off"}')
        self.assertEqual(resp_text.status, 415)

        # 4. POST with no Content-Type header is rejected with 415
        resp_no_ct = await self.client.post("/api/power")
        self.assertEqual(resp_no_ct.status, 415)

    @unittest_run_loop
    async def test_pairing_key_flow_when_configured(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            # 1. Unauthenticated request to protected endpoint returns 401
            resp_no_auth = await self.client.get("/api/now")
            self.assertEqual(resp_no_auth.status, 401)
            err1 = await resp_no_auth.json()
            self.assertEqual(err1.get("error"), "pairing key required")

            # 2. Invalid key returns 401
            resp_bad_auth = await self.client.get("/api/now", headers={"Authorization": "Bearer wrongpassword"})
            self.assertEqual(resp_bad_auth.status, 401)
            err2 = await resp_bad_auth.json()
            self.assertEqual(err2.get("error"), "invalid pairing key")

            # 3. Valid key via Authorization Bearer succeeds
            resp_bearer = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
            self.assertEqual(resp_bearer.status, 200)
            data_bearer = await resp_bearer.json()
            self.assertEqual(data_bearer.get("state"), "playing")

            # 4. Valid key via X-API-Key succeeds
            resp_hdr = await self.client.get("/api/now", headers={"X-API-Key": "couchpass123"})
            self.assertEqual(resp_hdr.status, 200)

            # 5. Valid key via ?key= query param succeeds
            resp_q = await self.client.get("/api/now?key=couchpass123")
            self.assertEqual(resp_q.status, 200)

            # 6. /api/health is open without auth, but indicates auth: "required"
            resp_health = await self.client.get("/api/health")
            self.assertEqual(resp_health.status, 200)
            health_data = await resp_health.json()
            self.assertEqual(health_data.get("auth"), "required")
            self.assertFalse(health_data.get("paired"))

            # 7. /api/health with auth indicates auth: "ok", paired: True
            resp_health_authed = await self.client.get("/api/health", headers={"Authorization": "Bearer couchpass123"})
            self.assertEqual(resp_health_authed.status, 200)
            health_authed_data = await resp_health_authed.json()
            self.assertEqual(health_authed_data.get("auth"), "ok")
            self.assertTrue(health_authed_data.get("paired"))

            # 8. POST /api/pair with wrong key returns 401
            resp_pair_bad = await self.client.post("/api/pair",
                                                   headers={"Content-Type": "application/json"},
                                                   data=json.dumps({"key": "wrong"}))
            self.assertEqual(resp_pair_bad.status, 401)

            # 9. POST /api/pair with correct key returns 200 ok
            resp_pair_good = await self.client.post("/api/pair",
                                                    headers={"Content-Type": "application/json"},
                                                    data=json.dumps({"key": "couchpass123"}))
            self.assertEqual(resp_pair_good.status, 200)
            pair_data = await resp_pair_good.json()
            self.assertTrue(pair_data.get("ok"))
            self.assertTrue(pair_data.get("paired"))
            self.assertEqual(pair_data.get("token"), "couchpass123")

            # 10. /bridge/shim.js is open without auth
            resp_shim = await self.client.get("/bridge/shim.js")
            self.assertEqual(resp_shim.status, 200)
            self.assertIn("application/javascript", resp_shim.headers.get("Content-Type", ""))

    @unittest_run_loop
    async def test_pairing_key_flow_when_disabled(self):
        with patch.object(config, "PAIRING_KEY", ""):
            # When disabled (default), endpoints work with no authentication
            resp = await self.client.get("/api/now")
            self.assertEqual(resp.status, 200)

            resp_health = await self.client.get("/api/health")
            self.assertEqual(resp_health.status, 200)
            h = await resp_health.json()
            self.assertEqual(h.get("auth"), "ok")
            self.assertTrue(h.get("paired"))

            resp_pair = await self.client.post("/api/pair",
                                               headers={"Content-Type": "application/json"},
                                               data=json.dumps({}))
            self.assertEqual(resp_pair.status, 200)
            p = await resp_pair.json()
            self.assertTrue(p.get("paired"))

    @unittest_run_loop
    async def test_non_ascii_key_is_wrong_not_a_crash(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            resp = await self.client.get("/api/now", headers={"X-API-Key": "café".encode().decode("latin-1")})
            self.assertEqual(resp.status, 401)
            resp = await self.client.post("/api/pair", headers={"Content-Type": "application/json"},
                                          data=json.dumps({"key": "café"}))
            self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_host_header_allowlist_against_dns_rebinding(self):
        # 1. Allowed host header (127.0.0.1) succeeds
        resp_good = await self.client.get("/api/health", headers={"Host": "127.0.0.1:5400"})
        self.assertEqual(resp_good.status, 200)

        # 2. Host header spoofing / DNS rebinding hostname is rejected with 403 Forbidden
        resp_rebind = await self.client.get("/api/health", headers={"Host": "attacker.com:5400"})
        self.assertEqual(resp_rebind.status, 403)
        body = await resp_rebind.text()
        self.assertIn("forbidden host", body)

        # 3. DNS rebinding on POST endpoint is also rejected
        resp_rebind_post = await self.client.post("/api/pair",
                                                 headers={"Host": "evil.org", "Content-Type": "application/json"},
                                                 data=json.dumps({"key": "anything"}))
        self.assertEqual(resp_rebind_post.status, 403)

    @unittest_run_loop
    async def test_rate_limiting_wrong_keys_across_endpoints(self):
        # The test client is on 127.0.0.1, which is never limited, so pretend to be a phone.
        with patch.object(config, "PAIRING_KEY", "couchpass123"), \
                patch.object(server, "client_ip", return_value="192.0.2.77"):
            server._failed_attempts.clear()

            # Wrong keys 1 to 4 on /api/now give 401
            for i in range(4):
                r = await self.client.get("/api/now", headers={"Authorization": f"Bearer wrong_{i}"})
                self.assertEqual(r.status, 401)

            # Wrong key 5 on /api/pair gives 401
            r5 = await self.client.post("/api/pair",
                                        headers={"Content-Type": "application/json"},
                                        data=json.dumps({"key": "wrong_pair"}))
            self.assertEqual(r5.status, 401)

            # The sixth try is refused without looking at the key, even the right one
            r6 = await self.client.get("/api/now", headers={"Authorization": "Bearer wrong_6"})
            self.assertEqual(r6.status, 429)
            err = await r6.json()
            self.assertIn("Too many wrong pairing keys", err.get("error", ""))
            r_right = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
            self.assertEqual(r_right.status, 429)
            r_pair_blocked = await self.client.post("/api/pair",
                                                    headers={"Content-Type": "application/json"},
                                                    data=json.dumps({"key": "couchpass123"}))
            self.assertEqual(r_pair_blocked.status, 429)

            # A minute later it works again
            later = server.time.time() + server.RATE_LIMIT_WINDOW + 1
            with patch.object(server.time, "time", return_value=later):
                r_restored = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
                self.assertEqual(r_restored.status, 200)

    @unittest_run_loop
    async def test_same_old_key_repeated_never_locks_out(self):
        # A phone or TV still holding the old key after it changed polls every few seconds.
        with patch.object(config, "PAIRING_KEY", "couchpass123"), \
                patch.object(server, "client_ip", return_value="192.0.2.78"):
            server._failed_attempts.clear()
            for _ in range(12):
                r = await self.client.get("/api/now", headers={"Authorization": "Bearer the_old_key_1"})
                self.assertEqual(r.status, 401)
            r_pair = await self.client.post("/api/pair",
                                            headers={"Content-Type": "application/json"},
                                            data=json.dumps({"key": "couchpass123"}))
            self.assertEqual(r_pair.status, 200)

    @unittest_run_loop
    async def test_the_bridge_computer_itself_is_never_limited(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"):
            server._failed_attempts.clear()
            for i in range(8):
                r = await self.client.get("/api/now", headers={"Authorization": f"Bearer wrong_{i}"})
                self.assertEqual(r.status, 401)
            r = await self.client.get("/api/now", headers={"Authorization": "Bearer couchpass123"})
            self.assertEqual(r.status, 200)
            self.assertEqual(server._failed_attempts, {})

    @unittest_run_loop
    async def test_parallel_pair_guesses_are_still_limited(self):
        import asyncio
        with patch.object(config, "PAIRING_KEY", "couchpass123"), \
                patch.object(server, "client_ip", return_value="192.0.2.79"):
            server._failed_attempts.clear()
            rs = await asyncio.gather(*[
                self.client.post("/api/pair", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"key": f"parallel_{i}"})) for i in range(15)])
            codes = sorted(r.status for r in rs)
            self.assertEqual(codes.count(401), server.RATE_LIMIT_MAX)
            self.assertEqual(codes.count(429), 15 - server.RATE_LIMIT_MAX)

    @unittest_run_loop
    async def test_unauthenticated_request_does_not_count_towards_rate_limit(self):
        with patch.object(config, "PAIRING_KEY", "couchpass123"), \
                patch.object(server, "client_ip", return_value="192.0.2.80"):
            server._failed_attempts.clear()

            # 10 requests with NO key at all (e.g. unopened remote polling)
            for _ in range(10):
                r = await self.client.get("/api/now")
                self.assertEqual(r.status, 401)
                err = await r.json()
                self.assertEqual(err.get("error"), "pairing key required")

            # Still not rate-limited because no wrong key guess was submitted
            r_pair = await self.client.post("/api/pair",
                                            headers={"Content-Type": "application/json"},
                                            data=json.dumps({"key": "couchpass123"}))
            self.assertEqual(r_pair.status, 200)

    def test_rate_limit_memory_is_bounded(self):
        server._failed_attempts.clear()
        with patch.object(server, "RATE_LIMIT_ADDRESSES", 50):
            for i in range(200):
                server.record_failed_attempt(f"203.0.113.{i}", f"k{i}")
            self.assertLessEqual(len(server._failed_attempts), 50)
        server._failed_attempts.clear()

class TestReviewFixes(unittest.TestCase):
    ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

    def _config_with_key(self, key):
        import subprocess
        import tempfile
        with open(os.path.join(self.ROOT, "config.example.json")) as f:
            cfg = json.load(f)
        cfg["bridge"]["pairing_key"] = key
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(cfg, f)
        try:
            return subprocess.run([sys.executable, "-c", "import config; print(len(config.PAIRING_KEY))"],
                                  cwd=os.path.join(self.ROOT, "bridge"), capture_output=True, text=True,
                                  env=dict(os.environ, COUCH_CONFIG=f.name))
        finally:
            os.unlink(f.name)

    def test_pairing_key_shape(self):
        self.assertEqual(self._config_with_key("Abc123-long_key").returncode, 0)
        for bad in ("short", 'has"quote;rm -rf x', "spaces in the key", "cafécafécafé"):
            r = self._config_with_key(bad)
            self.assertNotEqual(r.returncode, 0, bad)
            self.assertIn("pairing_key", r.stderr)

    def test_events_stream_is_not_open_to_every_origin(self):
        with open(os.path.join(self.ROOT, "bridge", "server.py")) as f:
            self.assertNotIn('"Access-Control-Allow-Origin": "*"', f.read())

    def test_mcp_tools_send_the_key(self):
        import mcp_server
        seen = {}

        class Answer:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"ok": true}'

        def fake_urlopen(req, data=None, timeout=None):
            seen.update(req.header_items())
            return Answer()

        with patch.object(mcp_server, "KEY", "couchpass123"), \
             patch.object(mcp_server.urllib.request, "urlopen", fake_urlopen):
            mcp_server.call("POST", "/api/key", {"key": "home"})
        self.assertEqual(seen.get("Authorization"), "Bearer couchpass123")

    def test_cookie_couchtv_key_dropped(self):
        # couchtv_key cookie must NOT be set in bridge/web/shim.js or remote/src/api.js (couch-tv#73)
        with open(os.path.join(self.ROOT, "bridge", "web", "shim.js")) as f:
            shim_src = f.read()
        self.assertNotIn("document.cookie = 'couchtv_key='", shim_src)
        self.assertNotIn('document.cookie = "couchtv_key="', shim_src)

        with open(os.path.join(self.ROOT, "remote", "src", "api.js")) as f:
            api_src = f.read()
        self.assertNotIn("document.cookie = 'couchtv_key='", api_src)
        self.assertNotIn('document.cookie = "couchtv_key="', api_src)

    def test_is_allowed_host_helper(self):
        req_local = make_mocked_request("GET", "/api/health", headers={"Host": "127.0.0.1:5400"})
        self.assertTrue(server.is_allowed_host(req_local))

        req_localhost = make_mocked_request("GET", "/api/health", headers={"Host": "localhost:5400"})
        self.assertTrue(server.is_allowed_host(req_localhost))

        req_ipv6 = make_mocked_request("GET", "/api/health", headers={"Host": "[::1]:5400"})
        self.assertTrue(server.is_allowed_host(req_ipv6))

        with patch.object(server, "lan_ipv4", return_value="192.0.2.50"):
            req_lan = make_mocked_request("GET", "/api/health", headers={"Host": "192.0.2.50:5400"})
            self.assertTrue(server.is_allowed_host(req_lan))

        req_evil = make_mocked_request("GET", "/api/health", headers={"Host": "evil.com:5400"})
        self.assertFalse(server.is_allowed_host(req_evil))

        req_rebind = make_mocked_request("GET", "/api/health", headers={"Host": "attacker.dnsrebinding.com"})
        self.assertFalse(server.is_allowed_host(req_rebind))

        class DummyRequest:
            def __init__(self, headers=None, host=""):
                self.headers = headers or {}
                self.host = host

        # No Host header at all: a script, never a browser, so no rebinding risk
        self.assertTrue(server.is_allowed_host(DummyRequest(host="")))

        with patch.object(server, "lan_ipv4", return_value="192.0.2.50"):
            # Any address passes: a second network connection, Docker, a phone opened by number
            for h in ("192.0.2.51:5400", "198.51.100.7", "[fe80::1]:5400", "localhost.:5400"):
                self.assertTrue(server.is_allowed_host(make_mocked_request("GET", "/", headers={"Host": h})), h)
            # Any .local name passes (only the home network answers for those)
            self.assertTrue(server.is_allowed_host(make_mocked_request("GET", "/", headers={"Host": "my-computer.local:5400"})))
            # A name nobody configured does not, until it is added to fallback_hosts
            req_lan = make_mocked_request("GET", "/", headers={"Host": "box.home:5400"})
            self.assertFalse(server.is_allowed_host(req_lan))
            with patch.dict(config.BRIDGE, {"fallback_hosts": ["box.home"]}):
                self.assertTrue(server.is_allowed_host(req_lan))

    def test_same_origin_is_allowed_by_any_address(self):
        # The phone remote opened by the computer's second address posts with that origin
        req = make_mocked_request("POST", "/api/key", headers={"Host": "192.0.2.99:5400"})
        with patch.object(server, "lan_ipv4", return_value="192.0.2.50"):
            self.assertTrue(server.is_allowed_origin(req, "http://192.0.2.99:5400"))
            self.assertFalse(server.is_allowed_origin(req, "http://evil.example"))
            evil = make_mocked_request("POST", "/api/key", headers={"Host": "evil.example:5400"})
            self.assertFalse(server.is_allowed_origin(evil, "http://evil.example:5400"))


if __name__ == "__main__":
    unittest.main()
