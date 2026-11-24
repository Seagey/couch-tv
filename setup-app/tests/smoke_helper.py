"""Starts the built app as Couch TV Helper (`--helper`) and checks the parts the unit tests cannot: the bundled
bridge starts as its child process and answers, the menu page loads and says Running, the page answers only with
its secret, and Quit stops both. No TV needed, no tray (COUCHTV_HELPER_NO_TRAY: a CI runner has no desktop).
Used by the build workflow on each computer type, after smoke.py.

    python setup-app/tests/smoke_helper.py "<path to the app's program>"
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

BRIDGE_PORT = 5497


def wait_for(fn, seconds, what):
    end = time.time() + seconds
    last = None
    while time.time() < end:
        try:
            got = fn()
            if got:
                return got
        except Exception as e:   # not up yet
            last = e
        time.sleep(1)
    raise AssertionError("%s did not happen in %d s (%s)" % (what, seconds, last))


def get(url, key=None, body=None):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST")
    if key:
        req.add_header("X-Helper-Key", key)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read().decode()


def bridge_answers():
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/" % BRIDGE_PORT, timeout=3).read()
    except urllib.error.HTTPError:
        pass   # any answer, even a 404, means the bridge is listening
    return True


def main(program):
    home = tempfile.mkdtemp()
    with open(os.path.join(home, "helper.json"), "w", encoding="utf-8") as f:
        json.dump({"v": 1, "mode": "helper", "port": BRIDGE_PORT, "autostart": False, "updates": False, "tvs": []}, f)
    env = dict(os.environ, COUCHTV_SETUP_HOME=home, COUCHTV_SETUP_NO_BROWSER="1", COUCHTV_HELPER_NO_TRAY="1")
    p = subprocess.Popen([program, "--helper"], env=env)
    stopped = False
    try:
        url_file = os.path.join(home, "helper-menu-url.txt")
        url = wait_for(lambda: open(url_file, encoding="utf-8").read().strip(), 60, "the menu page address")
        page = get(url)
        assert "Couch TV Helper" in page, "the menu page did not load"
        key = re.search(r'name="key" content="([^"]+)"', page).group(1)
        try:
            get(url + "api/state", body={})
            raise AssertionError("the menu page answered without its secret")
        except urllib.error.HTTPError as e:
            assert e.code == 403, e.code
        wait_for(bridge_answers, 90, "the bridge answering on its port")
        state = json.loads(wait_for(lambda: (lambda s: s if json.loads(s)["headline"].startswith("Running") else None)(get(url + "api/state", key, {})), 30, "the menu saying Running"))
        assert state["items"], "the menu has no items"
        try:
            get(url + "api/act", key, {"id": "quit"})
        except OSError:
            pass   # Quit stops the menu page itself, so its answer may never arrive
        p.wait(timeout=30)
        try:
            bridge_answers()
            raise AssertionError("the bridge was still running after Quit")
        except (OSError, urllib.error.URLError):
            pass
        print("helper smoke test ok")
        stopped = True
    finally:
        if p.poll() is None:
            p.kill()
            print("the helper was still running and was killed", file=sys.stderr)
            if stopped:
                sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
