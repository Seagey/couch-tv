"""The account link, end to end: the website's page, the one time code, "Link as X?", Setup, the TV's link, the
editor's Send, and the TV picking the design up. (Owner, 25 Nov 2026: Setup ran fine on a TCL, but no TV was ever
linked. Then the security gate, the same day: who is asked, what is sent, and when a TV counts as linked.)

Setup's own code is real (studio.py, server.py, steps.py), the TV is tests/faketv.py. The Studio side, twice:
- AgainstTheContract: tests/fakestudio.py, in this repo, so these run everywhere and CI never skips them;
- AgainstTheRealRoutes: the website's own route code (tv-designer server/cloud/setup.mjs), run by node with an in
  memory database (its server/tests-cloud/link-e2e-host.mjs). The website's code is not in this repo, so this one is
  skipped without it. COUCHTV_STUDIO_HOST names the file, else the sibling folders are tried.
No setting is changed for the test: Setup is used as built, so a default that switches linking off fails here.
Nothing leaves this computer.
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
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()

import fakestudio  # noqa: E402
from couchtv_setup import health, release, server, steps, studio  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import FakeTv  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HOST_NAME = os.path.join("server", "tests-cloud", "link-e2e-host.mjs")
DAY = 24 * 3600 * 1000


def find_host():
    env = os.environ.get("COUCHTV_STUDIO_HOST")
    if env:
        return env if os.path.exists(env) else None
    tools = os.path.abspath(os.path.join(HERE, "..", "..", ".."))   # .../tools when this is tools/couch-tv/<tree>/setup-app/tests
    for d in ("td-work/link-site", "tv-designer"):
        for up in (tools, os.path.abspath(os.path.join(tools, ".."))):
            p = os.path.join(up, d, HOST_NAME)
            if os.path.exists(p):
                return p
    return None


class LinkEndToEnd:
    """The tests themselves; the two classes at the end say which Studio."""

    @classmethod
    def start_studio(cls):
        raise NotImplementedError

    @classmethod
    def setUpClass(cls):
        cls.start_studio()
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls._saved = dict(os.environ)
        for k in ("COUCHTV_SETUP_STUDIO", "COUCHTV_SETUP_STUDIO_STUB"):
            os.environ.pop(k, None)
        os.environ["COUCHTV_SETUP_STUDIO_URL"] = cls.base

    @classmethod
    def tearDownClass(cls):
        os.environ.clear()
        os.environ.update(getattr(cls, "_saved", {}))

    def setUp(self):
        self._S, self._home = server.S, os.environ.get("COUCHTV_SETUP_HOME")
        os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp()
        server.S = server.State()     # a fresh run of Setup: nothing remembered, no account, no TV
        for p in (mock.patch.object(steps.time, "sleep", lambda s: None),
                  mock.patch.object(server, "_link_words", lambda t, r, wait_s=0, f=server._link_words: f(t, r, wait_s=0))):
            p.start()
            self.addCleanup(p.stop)
        self.http("POST", "/test/reset", {})

    def tearDown(self):
        server.S = self._S            # the other test files share the module: leave it as found
        os.environ["COUCHTV_SETUP_HOME"] = self._home or ""

    # ---- the website (signed in, same origin) and the TV, as plain HTTP ----
    def http(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode() or "{}")

    def web(self, method, path, body=None, who="1"):
        return self.http(method, path, body, {"Cookie": "tvm_s=" + who, "Origin": "http://127.0.0.1:5480"} if body is not None else
                         {"Cookie": "tvm_s=" + who, "Sec-Fetch-Site": "same-origin"})

    def page_start(self, who="1"):
        """The /get/ page's "Set up my TV": what journey.js asks."""
        code, j = self.web("POST", "/v1/setup/start", {}, who)
        self.assertEqual(code, 201, j)
        self.assertTrue(re.fullmatch(r"couchtv://setup\?handoff=[A-Za-z0-9_-]{32,128}", j["open"]), j)
        return j

    def mine(self, who="1"):
        return self.web("GET", "/v1/setup/mine", who=who)[1]

    def inbox(self, link):
        return self.http("GET", "/v1/setup/inbox", headers={"Authorization": "Bearer " + link})

    def api(self, path, body=None):
        return server.api("POST", path, body or {})

    def refused(self, code, path, body=None):
        with self.assertRaises(TvError) as e:
            self.api(path, body)
        self.assertEqual(e.exception.code, code)
        return e.exception

    def job(self, path, body=None):
        self.api(path, body)
        for _ in range(400):
            if not server.S.job.get("running"):
                return server.S.job
            threading.Event().wait(0.05)    # not time.sleep: other test files replace it with a no-op
        self.fail(server.S.job)

    def run_job(self, path, body=None):
        j = self.job(path, body)
        self.assertNotIn("error", j, j)
        return j["result"]

    def sign_in(self, who="1"):
        ask = self.api("/api/handoff", {"code": self.page_start(who)["short"]})["ask"]
        return self.api("/api/link-yes", {"id": ask["id"]})["account"]

    def connected_tv(self, tv=None, ip="192.0.2.10", app="0.13.15"):
        tv = tv or FakeTv("google", installed=["app.couchtv.launcher"])
        tv.app, tv.ip = app, ip
        tv.close = lambda: None
        server._attach(tv, ip, "tcp")
        return tv

    def linked_tv(self):
        self.sign_in()
        tv = self.connected_tv()
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])
        return tv, tv.held

    def send_and_pick_up(self, tv_link):
        """The editor's Send, then the TV's own inbox check with the link Setup wrote."""
        linked = [t for t in self.mine()["tvs"] if t["linked"]]
        self.assertEqual(len(linked), 1)
        self.assertEqual(linked[0]["setup_state"], "ready")
        _, sent = self.http("POST", "/test/send", {"tv_id": linked[0]["id"]})
        self.assertTrue(sent["queued"], sent)
        status, inbox = self.inbox(tv_link)
        self.assertEqual(status, 200, inbox)
        self.assertEqual([i["code"] for i in inbox["items"]], [sent["code"]])
        self.assertEqual(inbox["items"][0]["title"], "Cinema night")
        self.assertEqual(self.inbox(tv_link)[1]["items"], [])          # handed out once

    # ---- the paths ----
    def install(self, **body):
        with mock.patch.object(release, "get", lambda name, p=None: {"path": "/x/couch-tv-home.apk", "version": "v0.13.15", "sha256": "", "checked": ""}), \
                mock.patch.object(health, "speed_test", lambda tv: {"measured": True, "cls": "b"}):
            return self.run_job("/api/setup", body)

    def test_opened_by_the_link_then_installed(self):
        """The website's button opens Setup with the code; the person says Yes; the install links the TV; Send reaches it."""
        self.api("/api/handoff-in", {"code": studio.parse_url(self.page_start()["open"])})   # a second copy hands it over
        ask = self.api("/api/handoff")["ask"]
        self.assertNotIn("maker-", json.dumps(ask))
        self.api("/api/link-yes", {"id": ask["id"]})
        self.assertEqual(self.api("/api/account")["mode"], "live")
        tv = self.connected_tv(FakeTv("google"))
        r = self.install()
        self.assertEqual((r["account"]["linked"], r["account"]["reported"]), (True, True))
        self.assertTrue(any("--es design_code CTV1-" in c for c in tv.log))
        self.send_and_pick_up(tv.held)

    def test_double_clicked_setup_links_on_the_last_screen_without_a_reinstall(self):
        tv = self.connected_tv()
        self.assertIsNone(self.api("/api/account")["account"])
        self.sign_in()
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])
        self.assertFalse(any("pm install" in c or "force-stop" in c for c in tv.log), "nothing is reinstalled or stopped")
        self.send_and_pick_up(tv.held)

    def test_closing_and_reopening_setup_needs_a_new_code(self):
        start = self.page_start()
        ask = self.api("/api/handoff", {"code": start["short"]})["ask"]
        self.api("/api/link-yes", {"id": ask["id"]})
        server.S = server.State()
        self.assertIsNone(self.api("/api/account")["account"])
        self.refused("expired", "/api/handoff", {"code": start["short"]})

    # ---- 1: whose account, before anything is used ----
    def test_a_code_is_never_used_before_yes(self):
        start = self.page_start()
        ask = self.api("/api/handoff", {"code": studio.parse_url(start["open"])})["ask"]
        self.assertEqual(ask["account"]["email"], "s***@example.test")
        self.assertIsNone(server.S.link.token)
        self.assertIsNone(self.api("/api/account")["account"])
        self.connected_tv()
        self.assertEqual(self.job("/api/link-tv")["code"], "no_account")    # nothing links while the question is open
        self.assertNotIn("account", self.install())
        self.assertEqual(self.mine()["tvs"], [])
        self.assertEqual(self.mine()["setups"], 0)
        # looked at, not used: it still works
        self.api("/api/link-no")
        self.refused("no_offer", "/api/link-yes", {"id": ask["id"]})
        again = self.api("/api/handoff", {"code": start["short"]})["ask"]
        self.refused("no_offer", "/api/link-yes", {"id": "guess"})
        self.assertEqual(self.api("/api/link-yes", {"id": again["id"]})["account"]["email"], "s***@example.test")

    def test_a_signed_in_setup_never_swaps_accounts_by_itself(self):
        self.sign_in()
        self.api("/api/handoff-in", {"code": self.page_start("2")["handoff"]})       # somebody else's link
        ask = self.api("/api/handoff")["ask"]
        self.assertEqual((ask["account"]["email"], ask["instead_of"]["email"]), ("r***@example.test", "s***@example.test"))
        self.assertEqual(self.api("/api/account")["account"]["email"], "s***@example.test")
        self.api("/api/link-no")
        self.assertEqual(self.api("/api/account")["account"]["email"], "s***@example.test")
        self.sign_in("2")                                                             # and with a Yes it does
        self.assertEqual(self.api("/api/account")["account"]["email"], "r***@example.test")
        self.assertEqual(self.mine()["setups"], 0)                                    # the one before ended at the account too

    def test_the_websites_allow_asks_too(self):
        d = self.api("/api/device/start")
        self.assertEqual(self.web("POST", "/v1/setup/allow", {"user_code": d["user_code"]}, "2")[0], 200)
        ask = self.api("/api/device/poll")["ask"]
        self.assertEqual(ask["account"]["email"], "r***@example.test")
        self.assertIsNone(self.api("/api/account")["account"])
        self.api("/api/link-no")
        self.assertEqual(self.mine("2")["setups"], 0)

    # ---- 3: linked means linked ----
    def test_an_old_couch_tv_is_told_before_anything_is_sent(self):
        self.sign_in()
        tv = self.connected_tv(app="0.13.12")
        self.assertEqual(self.job("/api/link-tv")["code"], "old_app")
        self.assertIsNone(tv.held)
        self.assertEqual(self.mine()["tvs"], [])          # no profile and no app list left this computer

    def test_0_13_14_is_sent_and_counts_once_the_tv_checks_in(self):
        self.sign_in()
        tv = self.connected_tv(app="0.13.14")
        a = self.run_job("/api/link-tv")["account"]
        self.assertEqual((a["linked"], a["sent"]), (False, True))
        self.assertEqual([(t["linked"], t["link"]) for t in self.mine()["tvs"]], [(False, "waiting")])
        self.http("POST", "/test/clock", {"ms": 20 * DAY})         # a TV that was off for weeks is not locked out
        self.assertEqual(self.inbox(tv.held)[0], 200)
        self.assertEqual([(t["linked"], t["link"]) for t in self.mine()["tvs"]], [(True, "linked")])

    def test_a_tv_that_says_no_is_not_linked(self):
        self.sign_in()
        tv = self.connected_tv()
        tv.deaf = True
        self.assertEqual(self.job("/api/link-tv")["code"], "link_failed")
        self.assertEqual([(t["linked"], t["link"], t["setup_state"]) for t in self.mine()["tvs"]], [(False, None, "failed")])

    def test_a_start_the_tv_refused_is_not_linked(self):
        self.sign_in()
        tv = self.connected_tv(app="0.13.14")
        tv.no_start = True
        self.assertEqual(self.job("/api/link-tv")["code"], "not_started")
        self.assertEqual([t["link"] for t in self.mine()["tvs"]], [None])

    def test_an_install_whose_link_failed_says_so(self):
        self.sign_in()
        tv = self.connected_tv(FakeTv("google"))
        tv.deaf = True
        r = self.install()
        self.assertTrue(r["front"])
        self.assertFalse(r["account"]["linked"])
        self.assertIn("did not keep the link", r["account"]["error"])

    # ---- 4: a relink that fails leaves the old link working ----
    def test_a_failed_relink_keeps_the_old_link(self):
        tv, old = self.linked_tv()
        tv.deaf = True
        self.assertEqual(self.job("/api/link-tv")["code"], "link_failed")
        tv.deaf, tv.held = False, old
        self.assertEqual(self.inbox(old)[0], 200)
        self.assertEqual([t["link"] for t in self.mine()["tvs"]], ["linked"])
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])     # and one that works ends the old one
        self.assertEqual(self.inbox(old)[0], 401)
        self.assertEqual(self.inbox(tv.held)[0], 200)
        self.assertEqual(len(self.mine()["tvs"]), 1)

    def test_setup_lost_half_way_leaves_both_until_the_tv_is_seen(self):
        tv, old = self.linked_tv()
        with mock.patch.object(steps, "link_account", side_effect=RuntimeError("the computer went to sleep")), \
                mock.patch.object(server.traceback, "print_exc"):
            self.job("/api/link-tv")
        self.assertEqual(self.inbox(old)[0], 200)
        self.http("POST", "/test/clock", {"ms": 9 * DAY})
        self.assertEqual(self.inbox(old)[0], 200)

    # ---- second gate: Setup not hearing back is not the TV saying no ----
    def lost_after_the_tv_took_it(self, tv, old):
        """The TV let go of its old link when it took the new one (AccountLink.letGo): the new one is all it has."""
        self.assertNotEqual(tv.held, old)
        self.http("POST", "/v1/setup/leave", {}, {"Authorization": "Bearer " + old})
        self.assertEqual(self.inbox(tv.held)[0], 200)
        self.assertEqual([t["link"] for t in self.mine()["tvs"]], ["linked"])

    def test_an_answer_lost_on_the_way_keeps_the_link_the_tv_took(self):
        tv, old = self.linked_tv()
        real = tv.shell

        def shell(cmd, *a, **k):
            out = real(cmd, *a, **k)
            if "SetupLink" in cmd:
                raise TvError("The TV stopped answering.", "lost")
            return out
        with mock.patch.object(tv, "shell", shell):
            self.assertEqual(self.job("/api/link-tv")["code"], "lost")
        self.lost_after_the_tv_took_it(tv, old)

    def test_an_install_that_breaks_after_the_link_keeps_the_link(self):
        tv, old = self.linked_tv()
        with mock.patch.object(steps, "facts_tcl", side_effect=TvError("The TV stopped answering.", "lost")), \
                mock.patch.object(release, "get", lambda name, p=None: {"path": "/x/a.apk", "version": "v0.13.15", "sha256": "", "checked": ""}):
            self.assertEqual(self.job("/api/setup", {})["code"], "lost")
        self.lost_after_the_tv_took_it(tv, old)

    def test_another_tv_answering_at_the_address_is_not_linked(self):
        """The connection comes back by itself (tv.py): when another TV answers now, nothing goes to it or about it."""
        self.sign_in()
        tv = self.connected_tv()
        tv.serial = "ANOTHERTV"
        self.assertEqual(self.job("/api/link-tv")["code"], "no_tv")
        self.assertIsNone(tv.held)
        self.assertEqual(self.mine()["tvs"], [])

    def test_a_name_cannot_pretend_to_be_an_email(self):
        acct = studio.clean_account({"name": "Sam (s***@example.test)\u202e?", "email": "x***@evil.test"})
        self.assertEqual(acct, {"name": "Sam s example.test", "email": "x***@evil.test", "design": None})

    # ---- 5 and 10: ways on, and signing out ----
    def test_a_sign_in_that_ran_out_signs_setup_out_and_a_new_code_works(self):
        self.sign_in()
        tv = self.connected_tv()
        self.http("POST", "/test/clock", {"ms": 3 * 3600 * 1000})
        self.assertEqual(self.job("/api/link-tv")["code"], "signed_out")
        self.assertIsNone(self.api("/api/account")["account"])
        self.sign_in()
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])
        self.send_and_pick_up(tv.held)

    def test_sign_out_on_the_website_ends_setups_sign_in(self):
        self.sign_in()
        self.connected_tv()
        self.assertEqual(self.mine()["setups"], 1)
        self.assertEqual(self.web("POST", "/v1/setup/signout", {})[0], 200)
        self.assertEqual(self.mine()["setups"], 0)
        self.assertEqual(self.job("/api/link-tv")["code"], "signed_out")

    def test_sign_out_in_setup_ends_it_at_the_account(self):
        self.sign_in()
        self.api("/api/sign-out")
        self.assertEqual(self.mine()["setups"], 0)

    def test_unlinked_on_the_website_then_linked_again(self):
        tv, old = self.linked_tv()
        self.web("POST", "/v1/setup/unlink", {"tv_id": self.mine()["tvs"][0]["id"]})
        self.assertEqual(self.inbox(old)[0], 401)
        self.assertEqual(self.job("/api/link-tv")["code"], "signed_out")
        self.sign_in()
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])
        self.assertEqual(len(self.mine()["tvs"]), 1)

    def test_debugging_off_says_find_the_tv_again(self):
        self.sign_in()
        tv = self.connected_tv()
        tv.dev = mock.Mock()
        self.api("/api/debug-off")
        self.assertEqual(self.job("/api/link-tv")["code"], "no_tv")
        self.connected_tv()
        self.assertTrue(self.run_job("/api/link-tv")["account"]["linked"])

    def test_the_tv_lets_go(self):
        tv, link = self.linked_tv()
        self.assertEqual(self.http("POST", "/v1/setup/leave", {}, {"Authorization": "Bearer " + link})[0], 200)
        self.assertEqual([t["link"] for t in self.mine()["tvs"]], [None])
        self.assertEqual(self.http("POST", "/v1/setup/leave", {}, {"Authorization": "Bearer " + link})[0], 401)

    # ---- 6: codes ----
    def test_a_renewed_code_leaves_the_one_in_use_alone(self):
        """Two tabs, and the page renewing while Setup opens: each code lives to its own end, works once, 3 at most."""
        codes = [self.page_start()["handoff"] for _ in range(4)]
        self.refused("expired", "/api/handoff", {"code": codes[0]})
        for c in codes[1:]:
            ask = self.api("/api/handoff", {"code": c})["ask"]
            self.api("/api/link-yes", {"id": ask["id"]})
            self.refused("expired", "/api/handoff", {"code": c})
        late = self.page_start()["handoff"]
        self.http("POST", "/test/clock", {"ms": 11 * 60 * 1000})
        self.refused("expired", "/api/handoff", {"code": late})

    def test_a_code_that_ran_out_at_the_question(self):
        ask = self.api("/api/handoff", {"code": self.page_start()["short"]})["ask"]
        self.http("POST", "/test/clock", {"ms": 11 * 60 * 1000})
        self.refused("expired", "/api/link-yes", {"id": ask["id"]})
        self.assertIsNone(self.api("/api/account")["ask"])
        self.sign_in()

    # ---- 9: two TVs ----
    def test_a_health_report_never_goes_on_the_tv_before(self):
        self.linked_tv()
        self.api("/api/health/preview")
        self.connected_tv(FakeTv("google", installed=["app.couchtv.launcher"]), ip="192.0.2.11")
        self.assertFalse(self.api("/api/health/preview")["can_send"])
        self.refused("no_account", "/api/health/send", {"yes": True})
        self.assertEqual([len(t["reports"]) for t in self.mine()["tvs"]], [0])

    def test_rows_follow_the_tv_not_its_address(self):
        """Two TVs of the same model whose addresses swap (the router does that): each keeps its own row and name."""
        self.sign_in()
        a, b = (FakeTv("google", installed=["app.couchtv.launcher"]) for _ in range(2))
        for tv, ip, room in ((a, "192.0.2.10", "Lounge TV"), (b, "192.0.2.11", "Bedroom TV")):
            self.connected_tv(tv, ip)
            self.api("/api/name-tv", {"ip": ip, "room": room})
            self.run_job("/api/link-tv")
        self.connected_tv(a, "192.0.2.11")
        self.assertIsNone(server._known()["192.0.2.11"]["room"])
        self.run_job("/api/link-tv")
        self.connected_tv(b, "192.0.2.10")
        self.run_job("/api/link-tv")
        self.assertEqual(sorted(t["name"] for t in self.mine()["tvs"]), ["Bedroom TV", "Lounge TV"])
        self.assertNotEqual(a.held, b.held)
        self.assertEqual((self.inbox(a.held)[0], self.inbox(b.held)[0]), (200, 200))


class AgainstTheContract(LinkEndToEnd, unittest.TestCase):
    @classmethod
    def start_studio(cls):
        cls.studio, cls.srv = fakestudio.serve()
        cls.port = cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        super().tearDownClass()

    def test_a_website_from_before_fails_clearly_and_links_nothing(self):
        self.studio.old = True
        try:
            start = self.page_start()
            e = self.refused("studio_old", "/api/handoff", {"code": start["short"]})
            self.assertEqual(str(e), studio.OLD_SITE)
        finally:
            self.studio.old = False
        self.assertIsNone(server.S.link.token)
        self.assertTrue(self.api("/api/handoff", {"code": start["short"]})["ask"])     # the code was not used up

    def test_a_setup_from_before_still_links(self):
        """Its calls, as they were: no look at the code, no linked and no link in done."""
        tok = self.http("POST", "/v1/setup/handoff", {"handoff": self.page_start()["handoff"]})[1]["token"]
        h = {"Authorization": "Bearer " + tok}
        reg = self.http("POST", "/v1/setup/tv", {"tv": {}, "name": "TV"}, h)[1]
        self.http("POST", "/v1/setup/done", {"tv_id": reg["tv_id"], "ok": True}, h)
        self.assertEqual([t["link"] for t in self.mine()["tvs"]], ["linked"])


class AgainstTheRealRoutes(LinkEndToEnd, unittest.TestCase):
    test_a_setup_from_before_still_links = AgainstTheContract.test_a_setup_from_before_still_links

    @classmethod
    def start_studio(cls):
        host = find_host()
        if not host:
            raise unittest.SkipTest("the website's own route host was not found (it is not in this repo)")
        try:
            cls.proc = subprocess.Popen(["node", host], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except OSError:
            raise unittest.SkipTest("node is not installed")
        cls.port = json.loads(cls.proc.stdout.readline())["port"]

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stdout.close()
        cls.proc.stderr.close()
        super().tearDownClass()


class PageAsks(unittest.TestCase):
    """The page's side of the question."""

    def test_the_question_and_what_is_sent_are_on_the_page(self):
        web = os.path.join(os.path.dirname(server.__file__), "web")
        with open(os.path.join(web, "index.html"), encoding="utf-8") as f:
            html = f.read()
        line = "Linking sends this TV's model, speed and installed app names to your account."
        self.assertIn(line, html)
        self.assertLessEqual(len(line.split()), 14)
        for el in ("link-ask", "link-ask-yes", "link-ask-no", "acct-out", "link-fix-go"):
            self.assertIn(f'id="{el}"', html)
        with open(os.path.join(web, "app.js"), encoding="utf-8") as f:
            js = f.read()
        self.assertNotIn("signedIn(r.account); linkCard(false); linkRun()", js)
        self.assertEqual(js.count("/api/link-yes"), 1)
        # the email is what cannot be made up, so it comes first; and when to press Yes is said
        self.assertIn('q.account.email + (q.account.name ? ", " + q.account.name : "")', js)
        self.assertIn("Only press Yes if you just asked for this.", js)
        # a button the page does not have stops the rest of the page's script (Close setup did nothing, 0.13.14)
        for el in set(re.findall(r'\$\("([a-z0-9-]+)"\)\.addEventListener', js)):
            self.assertIn(f'id="{el}"', html)


if __name__ == "__main__":
    unittest.main()
