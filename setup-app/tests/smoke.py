"""Runs the built app's pairing self test, then starts it, checks it serves the page, answers the API only with the page's secret, and
stops on Close setup. Used by the build workflow on each computer type; no TV needed.

    python setup-app/tests/smoke.py "<path to the app's program>"
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PORT = 8799


def call(path, key=None, method="POST"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=b"{}" if method == "POST" else None, method=method)
    if key:
        req.add_header("X-Setup-Key", key)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode()


def main(program):
    env = dict(os.environ, COUCHTV_SETUP_PORT=str(PORT), COUCHTV_SETUP_NO_BROWSER="1", COUCHTV_SETUP_HOME=tempfile.mkdtemp())
    out = subprocess.run([program, "--self-test"], env=env, capture_output=True, text=True, timeout=120)
    assert "self test ok" in out.stdout, "pairing self test failed: " + out.stdout[-400:] + out.stderr[-1200:]
    p = subprocess.Popen([program], env=env)
    try:
        page = None
        for _ in range(60):
            try:
                page = call("/", method="GET")
                break
            except OSError:
                time.sleep(1)
        assert page and "couch-tv" in page, "the page did not load"
        key = re.search(r'name="setup-key" content="([^"]+)"', page).group(1)
        try:
            call("/api/info")
            raise AssertionError("the API answered without the secret")
        except urllib.error.HTTPError as e:
            assert e.code == 403
        assert json.loads(call("/api/info", key))["connected"] is False
        for f in ("app.js", "style.css"):
            assert call("/" + f, method="GET"), f
        call("/api/quit", key)
        p.wait(timeout=15)
        print("smoke test ok")
    finally:
        if p.poll() is None:
            p.kill()
            sys.exit("the app did not stop on Close setup")


if __name__ == "__main__":
    main(sys.argv[1])
