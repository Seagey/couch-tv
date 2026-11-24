"""Runs the real Setup page server (couchtv_setup.server) on 127.0.0.1 with everything outside the computer
faked, for the browser tests and the screenshots: the finder returns the rows it is given, the TV is
tests/faketv.py, the release download and the smoothness check answer at once, Couch TV Studio is a stub
file. No TV, no adb, no network scan and no download is touched.

    h = Harness(rows=[...]); h.start(); ... h.url ... h.stop()
"""
import json
import os
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer
from time import sleep as real_sleep   # steps.time.sleep is patched below, and that is the same time module
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

from couchtv_setup import health, server, steps  # noqa: E402
from faketv import FakeTv  # noqa: E402

LINK = "L" * 40


def row(ip, label, status="ready", model=None, **kw):
    """One TV row as the finder gives it (finder.merge)."""
    t = {"ip": ip, "name": label, "model": model, "ports": [], "wireless_debugging": None, "pairing_port": None,
         "serial": None, "remote": True, "cast": False, "other": None, "adb_5555": status == "ready", "adb_unconfirmed": False,
         "android": True, "known": None, "label": label, "status": status, "android_version": "12"}
    t.update(kw)
    return t


THREE = [row("192.0.2.21", "Lounge TV 2", "ready", "AI PONT"), row("192.0.2.22", "Guest Room TV", "ready"),
         row("192.0.2.23", "Garage TV", "switch", adb_5555=False)]


class Harness:
    def __init__(self, rows=None, stub=None, kind="google", slow=0.0, features=None, partial=0.0):
        self.partial = partial         # seconds the full scan takes after the TVs' own announcements are in
        self.rows = rows if rows is not None else list(THREE)
        self.stub = stub               # Couch TV Studio's answers, or None for "no account on this Setup"
        self.kind = kind
        self.slow = slow               # seconds the "download" takes, so the progress screen can be seen
        self.features = features
        self.patches = []
        self.tvs = []
        self.scans = 0
        self.log = []                  # api paths the page called

    def start(self):
        env = {"COUCHTV_SETUP_NO_BROWSER": "1", "COUCHTV_SETUP_NO_HELPER_START": "1", "COUCHTV_SETUP_STUDIO": ""}
        if self.stub is not None:
            f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
            json.dump(self.stub, f)
            f.close()
            env["COUCHTV_SETUP_STUDIO_STUB"] = f.name
        else:
            env["COUCHTV_SETUP_STUDIO_STUB"] = ""
            env["COUCHTV_SETUP_STUDIO"] = "off"      # linking is on in every build now; these pages test the page with it off
        self.patches = [mock.patch.dict(os.environ, env)]
        h = self

        def scan(**kw):
            h.scans += 1
            if h.partial and kw.get("on_partial"):
                kw["on_partial"]([dict(r) for r in h.rows[:1]])     # the announcements are in; the knocking goes on
                real_sleep(h.partial)
            return [dict(r) for r in h.rows]

        def make_tv(ip, ident, route="tcp", port=5555, allow_wait_s=45):
            tv = FakeTv(h.kind)
            tv.ip = ip
            tv.close = lambda: None
            h.tvs.append(tv)
            return tv

        def get(name, progress=lambda f, m=None: None):
            n = 10
            for i in range(n + 1):
                progress(i / n, "Downloading Couch TV (v0.13.14)")
                real_sleep(h.slow / n)
            return {"path": "/tmp/couch-tv-home.apk", "version": "0.13.14", "sha256": "a" * 64, "checked": "the release's checksum list"}

        class Said:
            def __init__(self, data): self.data = data
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n=-1): return self.data

        def urlopen(req, timeout=None, **kw):
            # the TV's phone remote app (port 5400) answers; nothing else may be asked
            url = getattr(req, "full_url", str(req))
            if ":5400/api/pair/start" in url:
                return Said(b'{"ok": true}')
            raise AssertionError("the page server asked the network for " + url)

        self.patches += [
            mock.patch.object(server.urllib.request, "urlopen", urlopen),
            mock.patch.object(server.finder, "scan", scan),
            mock.patch.object(server.finder, "knock", lambda ip, port, t=0.5: 0),   # 0 = the port answered
            mock.patch.object(server.finder, "pairing_port", lambda ip, t=2.0: None),
            mock.patch.object(server.finder, "look", lambda ip: {"kind": "android", "adb_5555": True, "android_remote": True,
                                                                 "route": "allow", "ip": ip}),
            mock.patch.object(server, "Tv", make_tv),
            mock.patch.object(server, "identity", lambda: None),
            mock.patch.object(server.release, "get", get),
            mock.patch.object(health, "speed_test", lambda tv: {"cls": "c"}),
            mock.patch.object(steps.time, "sleep", lambda s: None),
            mock.patch.object(server, "_known", lambda: {}),
            mock.patch.object(server, "_remember", lambda *a, **k: None),
        ]
        if self.features is not None:
            self.patches.append(mock.patch.object(server, "FEATURES", self.features))
        for p in self.patches:
            p.start()
        server.S.tv = server.S.ip = server.S.route = server.S.facts = server.S.profile = None
        server.S.job = {"running": False}
        server.S.link = server.studio.Link()
        server.S.tv_seen = server.finder.Seen()   # what an earlier test's scans found must not show here
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.S.httpd, server.S.port = self.httpd, self.httpd.server_address[1]
        orig = server.api

        def spy(method, path, body):
            if path not in ("/api/ping", "/api/job"):
                h.log.append(path)
            return orig(method, path, body)
        self.patches.append(mock.patch.object(server, "api", spy))
        self.patches[-1].start()
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{server.S.port}/"
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        for p in reversed(self.patches):
            p.stop()


def stub_account(name="Sam", design="Couch Original"):
    """Couch TV Studio's answers for a signed in account, a TV that registers, and a finished setup."""
    return {"/v1/setup/who": {"account": {"email": "s***@example.test", "name": name}},
            "/v1/setup/handoff": {"token": "T" * 40, "account": {"email": "s***@example.test", "name": name, "design": design}},
            "/v1/setup/tv": {"tv_id": "tv_abc123", "link": LINK, "code": "CTV1-ABCD", "design": design, "home": None},
            "/v1/setup/done": {"ok": True}}


def chromium():
    """A browser for the tests, or None. Uses Playwright's own copy."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None, None
    pw = sync_playwright().start()
    try:
        return pw, pw.chromium.launch()
    except Exception:
        import glob
        for path in sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
                           + glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell")), reverse=True):
            try:
                return pw, pw.chromium.launch(executable_path=path)
            except Exception:
                continue
        pw.stop()
        return None, None
