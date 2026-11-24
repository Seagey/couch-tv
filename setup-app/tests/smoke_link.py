"""Release check on the BUILT Setup program: account linking must be switched on as shipped. (0.13.14 shipped with it off:
every test set the switch itself, so no test ever saw the program the way a person gets it.)

    python setup-app/tests/smoke_link.py "<path to the app's program>"

Every COUCHTV_SETUP_* setting is removed first. Then:
1. as shipped, the program says linking is live, at the real Studio address, and its page has the link boxes
   (only this computer is asked: nothing is sent to Studio);
2. pointed at a pretend Studio on 127.0.0.1, with the switch still not set, typing a code and starting the device
   sign in must really reach it, and the person must come out signed in.
"""
import http.server
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

STUDIO = "https://couchtv.joshuaseage.com"
CODE = "ABCD-EFGH"
got = []


class Pretend(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        got.append((self.path, body))
        ans = {"/v1/setup/who": {"account": {"name": "Sam", "email": "s***@example.test", "design": None}},
               "/v1/setup/handoff": {"token": "t" * 43, "account": {"name": "Sam", "email": "s***@example.test", "design": None}},
               "/v1/setup/device": {"device_code": "d" * 43, "user_code": CODE, "interval": 5}}.get(self.path)
        raw = json.dumps(ans or {"error": "not_found"}).encode()
        self.send_response(200 if ans else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


def clean_env(**extra):
    env = {k: v for k, v in os.environ.items() if not k.startswith("COUCHTV_SETUP_")}
    env.update(COUCHTV_SETUP_NO_BROWSER="1", COUCHTV_SETUP_HOME=tempfile.mkdtemp(), **extra)
    return env


class Running:
    """The built program, started, with its page key."""
    def __init__(self, program, port, **extra):
        self.base = f"http://127.0.0.1:{port}"
        self.p = subprocess.Popen([program], env=clean_env(COUCHTV_SETUP_PORT=str(port), **extra))

    def __enter__(self):
        try:
            for _ in range(60):
                try:
                    with urllib.request.urlopen(self.base + "/", timeout=10) as r:
                        self.page = r.read().decode()
                    break
                except OSError:
                    time.sleep(1)
            else:
                raise AssertionError("the page did not load")
            self.key = re.search(r'name="setup-key" content="([^"]+)"', self.page).group(1)
        except BaseException:
            self.p.kill()
            raise
        return self

    def api(self, path, body=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body or {}).encode(), method="POST",
                                     headers={"X-Setup-Key": self.key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            return json.loads(e.read().decode() or "{}")

    def __exit__(self, *a):
        try:
            self.api("/api/quit")
            self.p.wait(timeout=15)
        except Exception:
            self.p.kill()
            self.p.wait(timeout=15)


def main(program):
    with Running(program, 8797) as s:
        acct = s.api("/api/account")
        assert acct.get("mode") == "live", "this build ships with account linking switched off: " + json.dumps(acct)
        assert acct.get("studio") == STUDIO, "this build talks to the wrong Studio: " + json.dumps(acct)
        for el in ("acct-box", "acct-code", "acct-device", "fl-panel", "fl-go", "link-cta", "acct-out", "link-ask", "link-ask-yes", "link-ask-no"):
            assert f'id="{el}"' in s.page, "the page has no " + el
        said = s.api("/api/link-tv")
        assert said.get("started") == "link", "no link step in this build: " + json.dumps(said)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pretend)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with Running(program, 8796, COUCHTV_SETUP_STUDIO_URL=f"http://127.0.0.1:{srv.server_address[1]}") as s:
            dev = s.api("/api/device/start")
            assert dev.get("user_code") == CODE, "the device sign in did not work: " + json.dumps(dev)
            r = s.api("/api/handoff", {"code": CODE})
            ask = r.get("ask") or {}
            assert (ask.get("account") or {}).get("email") == "s***@example.test", "a typed code did not ask whose account: " + json.dumps(r)
            assert not s.api("/api/account").get("account"), "signed in before the Yes"
            r = s.api("/api/link-yes", {"id": ask["id"]})
            assert (r.get("account") or {}).get("name") == "Sam", "Yes did not sign in: " + json.dumps(r)
            assert (s.api("/api/account").get("account") or {}).get("name") == "Sam", "the sign in was not kept"
        assert [p for p, _ in got] == ["/v1/setup/device", "/v1/setup/who", "/v1/setup/handoff"], got
        assert got[1][1] == got[2][1] == {"handoff": CODE}, got
    finally:
        srv.shutdown()
        srv.server_close()
    print("link smoke test ok")


if __name__ == "__main__":
    main(sys.argv[1])
