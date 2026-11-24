"""The account link, end to end: the website's page, the one time code, Setup, the TV's link, the editor's Send,
and the TV picking the design up. (Owner, 25 Nov 2026: Setup ran fine on a TCL, but no TV was ever linked.)

What is real here: Couch TV Setup's own code (studio.py, server.py, steps.py), and the Studio's own route code
(tv-designer server/cloud/setup.mjs: start, handoff, tv, done, inbox, queue, mine), run by node on a random 127.0.0.1
port by tv-designer's server/tests-cloud/link-e2e-host.mjs. What is a fake: that file's small in memory database and
one signed in person, and tests/faketv.py for the TV. No setting is changed for the test: Setup is used as built,
so a default that switches linking off fails here. Nothing leaves this computer.

Where the host lives: COUCHTV_STUDIO_HOST, else tools/td-work/get-fix, else tools/tv-designer (this repo's
sibling folders). Without node or the host file the tests are skipped.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading

import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

from couchtv_setup import server, steps, studio  # noqa: E402
from faketv import FakeTv  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HOST_NAME = os.path.join("server", "tests-cloud", "link-e2e-host.mjs")


def find_host():
    env = os.environ.get("COUCHTV_STUDIO_HOST")
    if env and os.path.exists(env):
        return env
    tools = os.path.abspath(os.path.join(HERE, "..", "..", ".."))   # .../tools when this is tools/couch-tv/<tree>/setup-app/tests
    for d in ("td-work/get-fix", "td-work/get-fix-base", "tv-designer"):
        for up in (tools, os.path.abspath(os.path.join(tools, ".."))):
            p = os.path.join(up, d, HOST_NAME)
            if os.path.exists(p):
                return p
    return None


class TvWithApp(FakeTv):
    """A TV that has Couch TV on it (the install is done): answers the version question."""
    def _one(self, c):
        if c.startswith("dumpsys package app.couchtv.launcher"):
            return "    versionName=0.13.14"
        return super()._one(c)


class LinkEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        host = find_host()
        if not host:
            raise unittest.SkipTest("the Studio route host (tv-designer server/tests-cloud/link-e2e-host.mjs) was not found")
        try:
            cls.proc = subprocess.Popen(["node", host], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except OSError:
            raise unittest.SkipTest("node is not installed")
        line = cls.proc.stdout.readline()
        cls.port = json.loads(line)["port"]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.env = {k: v for k, v in os.environ.items() if k not in ("COUCHTV_SETUP_STUDIO", "COUCHTV_SETUP_STUDIO_STUB")}
        cls.env["COUCHTV_SETUP_STUDIO_URL"] = cls.base
        cls._saved = dict(os.environ)
        for k in ("COUCHTV_SETUP_STUDIO", "COUCHTV_SETUP_STUDIO_STUB"):
            os.environ.pop(k, None)
        os.environ["COUCHTV_SETUP_STUDIO_URL"] = cls.base

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "proc", None):
            cls.proc.terminate()
            cls.proc.wait(timeout=10)
            cls.proc.stdout.close()
            cls.proc.stderr.close()
        os.environ.clear()
        os.environ.update(getattr(cls, "_saved", {}))

    def setUp(self):
        self._S = server.S
        server.S = server.State()     # a fresh run of Setup: nothing remembered, no account, no TV
        self.http("POST", "/test/reset", {})

    # ---- the website (signed in, same origin) and the TV, as plain HTTP ----
    def tearDown(self):
        server.S = self._S            # the other test files share the module: leave it as found

    def http(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode() or "{}")

    def page_start(self):
        """The /get/ page's "Set up my TV": what journey.js asks."""
        code, j = self.http("POST", "/v1/setup/start", {}, {"Cookie": "tvm_s=1", "Origin": "http://127.0.0.1:5480"})
        self.assertEqual(code, 201, j)
        self.assertTrue(re.fullmatch(r"couchtv://setup\?handoff=[A-Za-z0-9_-]{32,128}", j["open"]), j)
        return j

    def run_job(self, path):
        server.api("POST", path, {})
        for _ in range(200):
            if not server.S.job.get("running"):
                break
            threading.Event().wait(0.05)    # not time.sleep: other test files replace it with a no-op
        self.assertFalse(server.S.job.get("running"), server.S.job)
        self.assertNotIn("error", server.S.job, server.S.job)
        return server.S.job["result"]

    def connected_tv(self):
        tv = TvWithApp("google")
        server.S.tv, server.S.ip = tv, tv.ip
        server.S.facts = {"name": "TV1", "kind": "google"}
        server.S.profile = {"v": 1, "source": "adb", "model": "TV1"}
        return tv

    def link_from(self, tv):
        cmd = next(c for c in tv.log if "account_link" in c)
        return re.search(r"--es account_link (\S+)", cmd).group(1), cmd

    def send_and_pick_up(self, tv_link):
        """The editor's Send, then the TV's own inbox check with the link Setup wrote."""
        _, mine = self.http("GET", "/v1/setup/mine", headers={"Cookie": "tvm_s=1", "Sec-Fetch-Site": "same-origin"})
        linked = [t for t in mine["tvs"] if t["linked"]]
        self.assertEqual(len(linked), 1, mine)
        self.assertEqual(linked[0]["setup_state"], "ready", mine)
        _, sent = self.http("POST", "/test/send", {"tv_id": linked[0]["id"]})
        self.assertTrue(sent["queued"], sent)
        status, inbox = self.http("GET", "/v1/setup/inbox", headers={"Authorization": "Bearer " + tv_link})
        self.assertEqual(status, 200, inbox)
        self.assertEqual([i["code"] for i in inbox["items"]], [sent["code"]])
        self.assertEqual(inbox["items"][0]["title"], "Cinema night")
        # it is handed out once
        self.assertEqual(self.http("GET", "/v1/setup/inbox", headers={"Authorization": "Bearer " + tv_link})[1]["items"], [])

    # ---- the paths ----
    def test_opened_by_the_link_then_installed(self):
        """The website's button opens Setup with the code; the install links the TV; Send reaches it."""
        start = self.page_start()
        code = studio.parse_url(start["open"])
        server.api("POST", "/api/handoff-in", {"code": code})              # a second copy opened by the link hands it over
        acct = server.api("POST", "/api/handoff", {})["account"]           # the page signs in with it at once
        self.assertNotIn("maker-", json.dumps(acct))
        self.assertEqual(server.api("POST", "/api/account", {})["mode"], "live")
        tv = self.connected_tv()
        extras = server._from_account(lambda f, m=None: None)["extras"]    # what the install does
        steps.make_home(tv, "/x/couch-tv-home.apk", account=extras)
        link, cmd = self.link_from(tv)
        self.assertIn("--es design_code CTV1-", cmd)
        studio.report_done(server.S.link, True, "0.13.14", None)
        self.send_and_pick_up(link)

    def test_double_clicked_setup_links_on_the_last_screen_without_a_reinstall(self):
        """Setup opened by a double click: no code. The install finished with no account. On the last screen the
        person types the website's short code, and one step links the TV that is already set up."""
        tv = self.connected_tv()
        self.assertEqual(server.api("POST", "/api/account", {})["account"], None)        # not signed in
        self.assertIsNone(next((c for c in tv.log if "account_link" in c), None))
        start = self.page_start()
        acct = server.api("POST", "/api/handoff", {"code": start["short"]})["account"]   # typed ABCD-EFGH
        self.assertIsNone(acct["name"])        # no name on the account: Setup says "Signed in", never maker-xxxx
        result = self.run_job("/api/link-tv")
        self.assertTrue(result["account"]["linked"])
        self.assertFalse(any("pm install" in c or "install -r" in c for c in tv.log), "nothing is reinstalled")
        link, cmd = self.link_from(tv)
        self.assertNotIn("force-stop", cmd)    # the app keeps its settings and keeps running
        self.send_and_pick_up(link)

    def test_closing_and_reopening_setup_drops_the_sign_in_so_the_next_run_needs_a_new_code(self):
        """Setup keeps the sign in in memory only, and a handoff works once: a second run needs a fresh code."""
        start = self.page_start()
        server.api("POST", "/api/handoff", {"code": studio.parse_url(start["open"])})
        self.assertTrue(server.api("POST", "/api/account", {})["account"])
        server.S = server.State()                               # Setup closed, opened again by a double click
        self.assertEqual(server.api("POST", "/api/account", {})["account"], None)
        with self.assertRaises(Exception) as e:                 # the code from the first run is used up
            server.api("POST", "/api/handoff", {"code": studio.parse_url(start["open"])})
        self.assertEqual(getattr(e.exception, "code", ""), "expired")

    def test_a_renewed_code_replaces_the_old_one_and_the_old_one_stops(self):
        """The page renews the code while it waits (a slow Gatekeeper trip): one live code, single use."""
        first = self.page_start()
        second = self.page_start()
        self.assertNotEqual(first["handoff"], second["handoff"])
        with self.assertRaises(Exception):
            server.api("POST", "/api/handoff", {"code": studio.parse_url(first["open"])})
        self.assertTrue(server.api("POST", "/api/handoff", {"code": studio.parse_url(second["open"])})["account"] is not None)


if __name__ == "__main__":
    unittest.main()
