"""The Setup page in a real browser (Playwright's Chromium), with the TV, the network scan, the download and
Couch TV Studio all faked (tests/ui_harness.py). Skipped when Playwright or its browser is not installed.

What it proves: Back on every screen and off while installing; Set up another TV resets the per TV state;
the finish screen never says Linked unless the server did; no TVs and many TVs; stale and unconfirmed rows
are never offered as ready; the keyboard alone gets through; no sideways scroll at 390, 768 and 1440;
nothing is fetched from outside this computer; the words follow the text rules.
"""
import os
import re
import sys
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ui_harness as uh  # noqa: E402

PW, BROWSER = uh.chromium()
WIDTHS = (390, 768, 1440)


def step(pg):
    return pg.evaluate("(document.querySelector('section:not([hidden])') || {dataset: {}}).dataset.step")


def visible_text(pg):
    return pg.evaluate("document.body.innerText")


@unittest.skipUnless(BROWSER, "Playwright and its Chromium are not installed")
class Page(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        pass

    def open(self, harness, width=1440, height=900):
        harness.start()
        self.addCleanup(harness.stop)
        self.h = harness
        ctx = BROWSER.new_context(viewport={"width": width, "height": height})
        self.addCleanup(ctx.close)
        pg = ctx.new_page()
        self.requests = []
        pg.on("request", lambda r: self.requests.append(r.url))
        self.errors = []
        pg.on("pageerror", lambda e: self.errors.append(str(e)))
        pg.goto(harness.url)
        pg.wait_for_selector("#setup-start")
        self.addCleanup(lambda: self.assertEqual(self.errors, []))
        return pg

    def sign_in(self, pg):
        pg.wait_for_selector("#acct-box:not([hidden])")
        pg.fill("#acct-code", "ABCD-EFGH")
        pg.click("#acct-go")
        pg.wait_for_selector("#link-ask:not([hidden])")      # whose account: nothing is used until Yes
        pg.click("#link-ask-yes")
        pg.wait_for_selector("#acct-top:not([hidden])")

    def to_plan(self, pg, which=0):
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        pg.locator("#found .tvc").nth(which).get_by_role("button", name="Set up this TV").click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)

    def install(self, pg, name=None):
        if name:
            pg.fill("#tv-room", name)
        pg.click("#setup-go")
        # Tidy up your TV is the optional step between the progress screen and Finish: skip it
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)

    def no_sideways_scroll(self, pg, label):
        over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        self.assertLessEqual(over, 0, f"{label}: the page scrolls sideways by {over}px")

    # ---- Back ----

    def test_back_goes_one_screen_at_a_time(self):
        pg = self.open(uh.Harness())
        self.assertTrue(pg.is_disabled("#back"), "nothing is before the welcome screen")
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        self.assertEqual(step(pg), "find")
        pg.click("#nohere-go")
        pg.wait_for_selector('section[data-step="nohere"]:not([hidden])')
        self.assertTrue(pg.is_enabled("#back"))
        pg.click("#back")
        self.assertEqual(step(pg), "find")
        pg.wait_for_selector("#found .tvc")          # the list is looking again after Back
        self.to_plan_from_find(pg)
        pg.click("#back")
        self.assertEqual(step(pg), "find")
        pg.click("#back")
        self.assertEqual(step(pg), "welcome")

    def to_plan_from_find(self, pg):
        pg.locator("#found .tvc").nth(0).get_by_role("button", name="Set up this TV").click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)

    def test_back_on_the_plan_page_button_too(self):
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        pg.click("#plan-back")
        self.assertEqual(step(pg), "find")

    def test_back_is_off_while_installing(self):
        pg = self.open(uh.Harness(slow=5.0))
        self.to_plan(pg)
        pg.click("#setup-go")
        pg.wait_for_selector('section[data-step="work"]:not([hidden])')
        self.assertTrue(pg.is_disabled("#back"))
        self.assertIn("Back is off while Couch TV installs.", visible_text(pg))
        pg.keyboard.press("Alt+ArrowLeft")           # the browser's own back does not leave either
        self.assertEqual(step(pg), "work")
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)   # Tidy comes after the progress
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)
        self.assertTrue(pg.is_enabled("#back"))

    def test_back_from_finish_does_not_install_again(self):
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        self.install(pg)
        installs = sum(1 for t in self.h.tvs for l in t.log if l.startswith("INSTALL"))
        pg.click("#back")
        self.assertEqual(step(pg), "plan")           # not the progress screen
        self.assertEqual(installs, sum(1 for t in self.h.tvs for l in t.log if l.startswith("INSTALL")))

    def test_back_on_every_instruction_screen(self):
        pg = self.open(uh.Harness(rows=[uh.row("192.0.2.23", "Garage TV", "switch", adb_5555=False)]))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        pg.get_by_role("button", name="Show me how").click()
        pg.wait_for_selector("#guide:not([hidden])")
        pg.click("#back")
        self.assertEqual(step(pg), "welcome")
        # and each legacy screen has the header Back
        for name in ("kind", "dev-google", "dev-google-pair", "dev-classic", "fix-home", "phone-route", "extras", "undo"):
            pg.evaluate("(n) => document.querySelectorAll('section').forEach(s => s.hidden = s.dataset.step !== n)", name)
            self.assertTrue(pg.is_visible("#back"), name)

    # ---- set up another TV ----

    def test_set_up_another_tv_resets_what_belongs_to_the_first(self):
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.sign_in(pg)
        self.to_plan(pg, 0)
        self.install(pg, "Lounge")
        pg.click("#remote-go")
        pg.wait_for_selector('section[data-step="remote"]:not([hidden])', timeout=30000)
        pg.click("#back")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])')
        pg.click("#another-go")
        pg.wait_for_selector("#found .tvc")
        self.assertEqual(step(pg), "find")
        info = pg.evaluate("fetch('/api/info', {method:'POST', headers:{'X-Setup-Key': document.querySelector('meta[name=setup-key]').content}, body:'{}'}).then(r => r.json())")
        self.assertFalse(info["connected"])
        self.assertIsNone(info["facts"])
        self.assertIsNone(info["ip"])
        acct = pg.evaluate("fetch('/api/account', {method:'POST', headers:{'X-Setup-Key': document.querySelector('meta[name=setup-key]').content}, body:'{}'}).then(r => r.json())")
        self.assertIsNone(acct["tv"], "the first TV's account row must not leak into the next TV")
        self.assertTrue(pg.is_visible("#acct-top"), "the sign in stays")
        self.assertEqual(pg.input_value("#tv-room"), "")
        self.assertTrue(pg.is_hidden("#remote-done"))
        self.assertEqual(pg.evaluate("document.getElementById('done-account').children.length"), 0)
        self.assertEqual(pg.evaluate("document.getElementById('plan-list').children.length"), 0)
        # the second TV starts from the plan again, with its own name
        pg.locator("#found .tvc").nth(1).get_by_role("button", name="Set up this TV").click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)
        self.assertEqual(pg.input_value("#tv-room"), "Guest Room TV")
        pg.click("#setup-go")
        # Tidy up your TV is the optional step between the progress screen and Finish: skip it
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)
        items = pg.locator("#session-list li")
        self.assertEqual(items.count(), 2)
        self.assertIn("Lounge", items.nth(0).inner_text())
        self.assertIn("Guest Room TV", items.nth(1).inner_text())
        self.assertEqual(len(self.h.tvs), 2)

    def test_set_up_another_is_refused_while_a_step_runs(self):
        from couchtv_setup import server
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        self.install(pg)
        server.S.job = {"running": True}
        try:
            pg.click("#another-go")
            pg.wait_for_selector("#error:not([hidden])")
            self.assertEqual(step(pg), "done")
        finally:
            server.S.job = {"running": False}

    def test_a_partial_first_look_shows_the_first_tv_before_the_scan_ends(self):
        rows = [uh.row("192.0.2.61", "Early TV", "ready"), uh.row("192.0.2.62", "Late TV", "ready"),
                uh.row("192.0.2.63", "Missed TV", "switch", adb_5555=False, stale=True)]
        pg = self.open(uh.Harness(rows=rows, partial=4.0))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc", timeout=3500)
        self.assertEqual(pg.locator("#found .tvc").count(), 1, "only the early announcement so far")
        self.assertIn("Early TV", pg.inner_text("#found"))
        deadline = time.monotonic() + 15
        while pg.locator("#found .tvc").count() != 3 and time.monotonic() < deadline:
            time.sleep(0.2)
        self.assertEqual(pg.locator("#found .tvc").count(), 3)
        self.assertEqual(pg.get_by_role("button", name="Set up this TV").count(), 2, "the stale one is never offered")
        self.assertEqual(pg.locator("#found .pill", has_text="Looking for it again").count(), 1)
        pg.get_by_role("button", name="Set up this TV").nth(0).click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)

    # ---- linking is off in this release candidate ----

    def test_with_linking_off_the_finish_is_truthful_and_has_no_dead_end(self):
        pg = self.open(uh.Harness(features=["reset-tv"]))
        self.to_plan(pg)
        plan = visible_text(pg).lower()
        self.assertNotIn("ambient", plan, "Tidy's switch is the only ambient switch")
        self.assertTrue(pg.is_hidden("#ambient"))
        pg.click("#setup-go")
        # progress, then Tidy, then Finish: never Finish first
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)
        self.assertEqual(pg.locator("#tidy-idle").count(), 1)
        self.assertEqual(pg.locator("#ambient:visible").count(), 0)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])')
        body = visible_text(pg).lower()
        for bad in ("linked", "link it", "your account", "sign in"):
            self.assertNotIn(bad, body)
        self.assertTrue(pg.is_hidden("#steps"), "no Account, Set up, Design bar")
        self.assertTrue(pg.is_hidden("#link-cta"))
        self.assertTrue(pg.is_visible("#studio-cta"))
        self.assertIn("Design your own screen", pg.inner_text("#studio-cta"))
        self.assertTrue(pg.get_attribute("#studio-cta", "href").endswith("/design/"))
        cap = pg.inner_text("#fin-cap")
        self.assertTrue(cap and len(cap.split()) <= 14, cap)
        self.assertIn("code", cap)
        self.assertNotIn("Installed, not linked", pg.inner_text("#session-list"))
        self.assertNotIn("Studio uses this", pg.inner_text("body"), "the speed check is not sent anywhere")
        pg.click("#health-look")
        pg.wait_for_selector('section[data-step="health"]:not([hidden])')
        self.assertNotIn("link your", visible_text(pg).lower())

    # ---- linked or not ----

    def test_linked_only_when_the_server_says_so(self):
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        self.assertIn("Linked", pg.inner_text("#session-list"))
        self.assertTrue(pg.is_visible("#studio-cta"))
        self.assertIn("already linked", pg.inner_text("#fin-cap"))

    def test_installed_not_linked_says_so_and_never_linked(self):
        stub = dict(uh.stub_account(), **{"/v1/setup/tv": {"error": "no", "message": "No."}})
        pg = self.open(uh.Harness(stub=stub, features=["reset-tv", "link-tv"]))
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        body = visible_text(pg)
        self.assertIn("Installed. Not linked to your account", body)
        self.assertNotIn("Linked to your Couch TV account", body)
        self.assertNotIn("already linked", body)
        self.assertTrue(pg.is_hidden("#studio-cta"))
        self.assertTrue(pg.is_visible("#link-cta"))
        self.assertIn("Installed, not linked", pg.inner_text("#session-list"))

    def test_link_it_hook_is_hidden_when_absent(self):
        stub = dict(uh.stub_account(), **{"/v1/setup/tv": {"error": "no"}})
        pg = self.open(uh.Harness(stub=stub, features=["reset-tv"]))          # no "link-tv" in features
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        self.assertTrue(pg.is_hidden("#link-cta"))
        self.assertNotIn("Linked to your Couch TV account", visible_text(pg))

    def test_link_it_runs_the_hook_and_trusts_only_its_answer(self):
        from couchtv_setup import server
        stub = dict(uh.stub_account(), **{"/v1/setup/tv": {"error": "no"}})
        pg = self.open(uh.Harness(stub=stub, features=["reset-tv", "link-tv"]))
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        seen = []

        def fake(path, body, token=None, timeout=15):
            seen.append(path)
            if path == "/v1/setup/tv":
                return {"tv_id": "tv_1", "link": uh.LINK, "code": "CTV1-ABCD", "design": "Couch Original", "home": None}
            return {"ok": True}
        # a link step that says "not linked": the page must not claim it
        orig = server.api

        def api(method, path, body):
            if path == "/api/link-tv":
                return server.run_job("link", lambda p: {"account": {"linked": False}})
            return orig(method, path, body)
        from unittest import mock
        with mock.patch.object(server, "api", api):
            pg.click("#link-cta")
            pg.wait_for_selector("#link-status:not([hidden])")
            pg.wait_for_selector("#link-status:has-text('still not linked')")
        self.assertNotIn("Linked to your Couch TV account", visible_text(pg))
        self.assertIn("Installed, not linked", pg.inner_text("#session-list"))

    def test_no_account_on_this_setup_says_nothing_about_linking(self):
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        self.install(pg)
        body = visible_text(pg).lower()
        self.assertNotIn("linked", body)
        self.assertNotIn("account", body.replace("send it to my couch tv account", ""))
        self.assertTrue(pg.is_hidden("#steps"))
        self.assertTrue(pg.is_hidden("#link-cta"))

    def calls(self):
        return list(self.h.log)

    def not_linked_finish(self, harness):
        """Installed with no account, on Finish, with the sign in panel open and a code typed: the question is up."""
        pg = self.open(harness)
        self.to_plan(pg)
        self.install(pg)
        pg.click("#link-cta")
        pg.fill("#fl-code", "ABCD-EFGH")
        pg.click("#fl-go")
        pg.wait_for_selector("#link-ask:not([hidden])")
        return pg

    def test_yes_on_finish_links_that_tv_and_only_after_yes(self):
        pg = self.not_linked_finish(uh.Harness(stub=uh.stub_account()))
        self.assertNotIn("/api/link-tv", self.calls())
        pg.click("#link-ask-yes")
        pg.wait_for_selector("#studio-cta:not([hidden])", timeout=20000)
        self.assertEqual(self.calls().count("/api/link-tv"), 1)
        self.assertIn("already linked", pg.inner_text("#fin-cap"))

    def test_the_five_second_look_seeing_the_question_first_does_not_lose_the_link(self):
        from couchtv_setup import server
        from unittest import mock
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.to_plan(pg)
        self.install(pg)
        orig = server.api

        def slow(method, path, body):
            r = orig(method, path, body)
            if path == "/api/handoff":
                uh.real_sleep(7)                 # the answer is slow: the 5 s look shows the question before it
            return r
        with mock.patch.object(server, "api", slow):
            pg.click("#link-cta")
            pg.fill("#fl-code", "ABCD-EFGH")
            pg.click("#fl-go")
            pg.wait_for_selector("#link-ask:not([hidden])", timeout=6500)
            pg.wait_for_selector("#fl-status:empty", state="attached", timeout=10000)
        pg.click("#link-ask-yes")
        pg.wait_for_selector("#studio-cta:not([hidden])", timeout=20000)

    def test_a_question_left_open_never_links_the_next_tv(self):
        pg = self.not_linked_finish(uh.Harness(stub=uh.stub_account()))
        pg.click("#another-go")
        pg.wait_for_selector("#found .tvc")
        pg.locator("#found .tvc").nth(1).get_by_role("button", name="Set up this TV").click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)
        pg.click("#link-ask-yes")                # signs Setup in, which is what it asks
        pg.wait_for_selector("#acct-top:not([hidden])")
        pg.wait_for_timeout(1500)
        self.assertNotIn("/api/link-tv", self.calls())

    def test_yes_after_back_signs_in_and_links_nothing(self):
        pg = self.not_linked_finish(uh.Harness(stub=uh.stub_account()))
        pg.click("#back")
        self.assertEqual(step(pg), "plan")
        pg.click("#link-ask-yes")
        pg.wait_for_selector("#acct-top:not([hidden])")
        pg.wait_for_timeout(1000)
        self.assertNotIn("/api/link-tv", self.calls())

    def test_tidy_never_shows_the_last_tvs_switches_and_never_gets_stuck(self):
        from couchtv_setup import server, tidy
        from unittest import mock
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        pg.click("#setup-go")
        pg.wait_for_selector("#tidy-idle", state="attached", timeout=30000)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])')
        with mock.patch.object(tidy, "state", side_effect=server.TvError("The TV did not answer.", "lost")):
            pg.click("#tidy-go")
            pg.wait_for_selector(".tidy-note:has-text('did not answer')")
            self.assertEqual(pg.locator("#tidy-idle").count(), 0)
            pg.click("#tidy-save")               # nothing was read, so nothing to change: on to Finish
            pg.wait_for_selector('section[data-step="done"]:not([hidden])')

    def test_tidy_shows_the_truth_after_save_and_continue_always_leaves(self):
        from couchtv_setup import server
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        pg.click("#setup-go")
        pg.wait_for_selector("#tidy-idle", state="attached", timeout=30000)
        self.assertTrue(pg.is_hidden("#tidy-undo"))
        server.S.tv.refuse_disable = {"com.google.android.apps.tv.dreamx"}
        server.S.tv.refuse_secure = {"screensaver_enabled"}
        pg.check("#tidy-idle", force=True)
        pg.check("#tidy-anim", force=True)
        pg.click("#tidy-save")
        pg.wait_for_selector("#tidy-res-idle:not([hidden])", timeout=15000)
        self.assertIn("refused", pg.inner_text("#tidy-res-idle"))
        self.assertFalse(pg.is_checked("#tidy-idle"), "a refused switch is not shown as on")
        self.assertTrue(pg.is_checked("#tidy-anim"))
        self.assertTrue(pg.is_visible("#tidy-undo"))
        pg.click("#tidy-save")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])')

    def test_find_the_tv_after_a_lost_link_can_set_up_again(self):
        from couchtv_setup import server
        from unittest import mock
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.to_plan(pg)
        self.install(pg)
        orig = server.api

        def api(method, path, body):
            if path == "/api/link-tv":
                raise server.TvError("Gone.", "no_tv")
            return orig(method, path, body)
        with mock.patch.object(server, "api", api):
            pg.click("#link-cta")
            pg.fill("#fl-code", "ABCD-EFGH")
            pg.click("#fl-go")
            pg.click("#link-ask-yes")
            pg.wait_for_selector("#link-fix:not([hidden])")
        pg.click("#link-fix-go")
        pg.wait_for_selector("#found .tvc")
        self.to_plan_from_find(pg)
        self.install(pg)                         # Finish must come up again
        self.assertIn("already linked", pg.inner_text("#fin-cap"))

    # ---- the list ----

    def test_no_tvs_found(self):
        pg = self.open(uh.Harness(rows=[]))
        pg.click("#setup-start")
        pg.wait_for_selector("#find-help:not([hidden])")
        self.assertEqual(pg.locator("#found .tvc").count(), 0)
        self.assertIn("No TV found yet.", visible_text(pg))
        pg.click("#nohere-go")
        pg.wait_for_selector('section[data-step="nohere"]:not([hidden])')
        self.assertTrue(pg.is_visible("#ip"))

    def test_many_tvs(self):
        rows = [uh.row(f"192.0.2.{40 + i}", f"Room {i + 1} TV", "ready") for i in range(9)]
        pg = self.open(uh.Harness(rows=rows))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        self.assertEqual(pg.locator("#found .tvc").count(), 9)
        self.assertEqual(pg.get_by_role("button", name="Set up this TV").count(), 9)
        for w in WIDTHS:
            pg.set_viewport_size({"width": w, "height": 900})
            self.no_sideways_scroll(pg, f"find with 9 TVs at {w}")

    def test_details_shows_model_and_address(self):
        pg = self.open(uh.Harness())
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        card = pg.locator("#found .tvc").nth(0)
        self.assertTrue(card.locator(".detail").is_hidden())
        card.get_by_role("button", name="Details").click()
        self.assertIn("Reported as AI PONT", card.locator(".detail").inner_text())
        self.assertIn("Address 192.0.2.21", card.locator(".detail").inner_text())

    def test_stale_and_unconfirmed_rows_are_never_offered_as_ready(self):
        rows = [uh.row("192.0.2.51", "Missed TV", "switch", adb_5555=False, stale=True),
                uh.row("192.0.2.52", "Silent TV", "switch", adb_5555=False, adb_unconfirmed=True),
                uh.row("192.0.2.53", "Wrongly ready TV", "ready", stale=True)]
        pg = self.open(uh.Harness(rows=rows))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        self.assertEqual(pg.get_by_role("button", name="Set up this TV").count(), 0)
        self.assertEqual(pg.locator("#found .pill", has_text="Looking for it again").count(), 2)
        stale = pg.locator("#found .tvc", has_text="Missed TV")
        self.assertTrue(stale.locator("button.btn").is_disabled())
        pg.locator("#found .tvc", has_text="Silent TV").get_by_role("button", name="Show me how").click()
        pg.wait_for_selector("#guide:not([hidden])")
        self.assertEqual(self.h.log.count("/api/connect"), 0)

    def test_a_tv_that_needs_the_helper_keeps_its_action(self):
        rows = [uh.row("192.0.2.61", "Den TV", "other", other="Tizen", android=False),
                uh.row("192.0.2.62", "Other TV", "other", other="VIDAA", android=False)]
        pg = self.open(uh.Harness(rows=rows))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        self.assertIn("Needs the Helper", pg.locator("#found .tvc").nth(0).inner_text())
        pg.get_by_role("button", name="Set up the helper").click()
        self.assertEqual(step(pg), "helper-tv")
        self.assertIn("Your Samsung TV needs the helper.", pg.inner_text("#helper-tv-title"))
        pg.click("#back")
        self.assertEqual(step(pg), "find")
        self.assertIn("Found. Can't install from here yet", pg.locator("#found .tvc").nth(1).inner_text())
        self.assertEqual(pg.locator("#found .tvc").nth(1).get_by_role("link", name="Open the guide").count(), 1)

    def test_the_address_box_is_on_the_help_page(self):
        pg = self.open(uh.Harness(rows=[]))
        pg.click("#setup-start")
        pg.wait_for_selector("#find-help:not([hidden])")
        self.assertTrue(pg.is_hidden("#ip"))
        pg.click("#nohere-go")
        pg.wait_for_selector('section[data-step="nohere"]:not([hidden])')
        pg.fill("#ip", "192.0.2.77")
        pg.press("#ip", "Enter")                    # Enter does what Use this does
        pg.wait_for_selector('section[data-step="kind"]:not([hidden])')

    # ---- the rest of the flows still work ----

    def test_phone_remote_health_report_and_debugging_off(self):
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        pg.click("#health-look")
        pg.wait_for_selector('section[data-step="health"]:not([hidden])')
        self.assertTrue(pg.inner_text("#health-text").strip().startswith("{"))
        self.assertTrue(pg.is_visible("#health-send"))
        pg.click("#back")
        self.assertEqual(step(pg), "done")
        pg.click("#remote-go")
        pg.wait_for_selector('section[data-step="remote"]:not([hidden])', timeout=30000)
        self.assertTrue(pg.is_visible("#remote-addr"))
        pg.click("#remote-code")
        pg.wait_for_selector("#remote-status:not(:empty)")
        pg.click("#back")
        pg.click("#debug-off")
        pg.wait_for_selector('section[data-step="debug"]:not([hidden])')
        self.assertIn("safest", pg.inner_text("#debug-line"))
        pg.click("#debug-go")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])')
        self.assertIn("Debugging is off", pg.inner_text("#done-line"))
        self.assertTrue(pg.is_hidden("#debug-off"))
        self.assertTrue(pg.is_hidden("#remote-go"))

    def test_nothing_is_written_below_the_three_cards(self):
        pg = self.open(uh.Harness())
        self.to_plan(pg)
        self.install(pg)
        below = pg.evaluate("""() => {
          const tools = document.querySelector('section[data-step="done"] .tools');
          const bottom = tools.getBoundingClientRect().bottom + window.scrollY;
          const out = [];
          document.querySelectorAll('section[data-step="done"] *').forEach(e => {
            if (e.children.length || !e.textContent.trim() || e.offsetParent === null) return;
            if (e.getBoundingClientRect().top + window.scrollY > bottom - 1) out.push(e.textContent.trim());
          });
          return out;
        }""")
        self.assertEqual(below, [])

    def test_welcome_keeps_the_extras_behind_more(self):
        pg = self.open(uh.Harness())
        body = visible_text(pg)
        self.assertNotIn("Extra features", body)
        self.assertNotIn("Which TVs work", body)
        self.assertNotIn("Take Couch TV off a TV", body)
        self.assertIn("More", body)
        self.assertEqual(pg.inner_text("h1").replace("\n", "|"), "Put Couch TV|on your TV")
        pg.click("#more > summary")
        pg.wait_for_selector("#undo-start", state="visible")
        self.assertTrue(pg.is_visible("#helper-later-go"))
        self.assertIn("Which TVs work", visible_text(pg))

    def test_cards_in_a_row_line_up(self):
        rows = [uh.row("192.0.2.71", "A", "ready"), uh.row("192.0.2.72", "A much longer name for a TV in the big house", "switch", adb_5555=False),
                uh.row("192.0.2.73", "Den TV", "other", other="Tizen", android=False)]
        pg = self.open(uh.Harness(rows=rows))
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        tops = pg.evaluate("[...document.querySelectorAll('#found .tvc')].map(c => [...c.querySelectorAll(':scope > button.btn, :scope > a.btn')].map(b => Math.round(b.getBoundingClientRect().top)))")
        self.assertEqual(len({t[0] for t in tops}), 1, tops)
        pills = pg.evaluate("[...document.querySelectorAll('#found .pill')].map(p => Math.round(p.getBoundingClientRect().height))")
        self.assertEqual(len(set(pills)), 1, pills)

    def test_take_couch_tv_off_a_tv(self):
        pg = self.open(uh.Harness())
        pg.click("#more > summary")
        pg.click("#undo-start")
        pg.wait_for_selector("#found .tvc")
        self.assertIn("Choose this TV", pg.inner_text("#found"))
        pg.locator("#found .tvc").nth(0).get_by_role("button", name="Choose this TV").click()
        pg.wait_for_selector('section[data-step="undo"]:not([hidden])', timeout=20000)
        self.assertTrue(pg.is_hidden("#steps"))
        pg.click("#back")
        self.assertEqual(step(pg), "find")
        pg.locator("#found .tvc").nth(0).get_by_role("button", name="Choose this TV").click()
        pg.wait_for_selector('section[data-step="undo"]:not([hidden])', timeout=20000)
        pg.click("#undo-go")
        pg.wait_for_selector('section[data-step="undone"]:not([hidden])', timeout=30000)

    def test_helper_is_still_reachable(self):
        pg = self.open(uh.Harness())
        pg.click("#more > summary")
        pg.wait_for_selector("#helper-later:not([hidden])")
        pg.click("#helper-later-go")
        self.assertEqual(step(pg), "extras")
        self.assertTrue(pg.is_visible("#extras-on"))

    # ---- keyboard ----

    def test_keyboard_alone_gets_through(self):
        pg = self.open(uh.Harness())
        pg.keyboard.press("Tab")
        for _ in range(8):
            if pg.evaluate("document.activeElement.id") == "setup-start":
                break
            pg.keyboard.press("Tab")
        self.assertEqual(pg.evaluate("document.activeElement.id"), "setup-start")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#found .tvc")
        self.assertEqual(pg.evaluate("document.activeElement.tagName"), "H1", "focus moves to the new screen's heading")
        for _ in range(12):
            pg.keyboard.press("Tab")
            if pg.evaluate("document.activeElement.textContent.trim()") == "Set up this TV":
                break
        self.assertEqual(pg.evaluate("document.activeElement.textContent.trim()"), "Set up this TV")
        outline = pg.evaluate("getComputedStyle(document.activeElement).outlineStyle")
        self.assertNotEqual(outline, "none", "the focused button shows a ring")
        pg.keyboard.press("Enter")
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)
        pg.fill("#tv-room", "Keyboard TV")
        pg.keyboard.press("Enter")                   # Enter in the name box starts the setup
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)

    # ---- layout ----

    def test_no_sideways_scroll_390(self):
        self.scroll_check(390)

    def test_no_sideways_scroll_768(self):
        self.scroll_check(768)

    def test_no_sideways_scroll_1440(self):
        self.scroll_check(1440)

    def scroll_check(self, w):
        if True:
            pg = self.open(uh.Harness(stub=uh.stub_account()), width=w)
            self.sign_in(pg)
            self.no_sideways_scroll(pg, f"welcome at {w}")
            self.to_plan(pg)
            self.no_sideways_scroll(pg, f"plan at {w}")
            pg.click("#plan-details > summary")
            pg.wait_for_selector("#plan-list li", state="attached")
            pg.click("#plan-details .sub > summary")
            self.no_sideways_scroll(pg, f"plan open at {w}")
            self.install(pg, "A very long name for a TV in a big house")
            self.no_sideways_scroll(pg, f"finish at {w}")
            pg.click("#health-look")
            pg.wait_for_selector('section[data-step="health"]:not([hidden])')
            self.no_sideways_scroll(pg, f"the report at {w}")
            pg.click("#back")
            pg.click("#another-go")
            pg.wait_for_selector("#found .tvc")
            self.no_sideways_scroll(pg, f"find at {w}")
            pg.click("#nohere-go")
            self.no_sideways_scroll(pg, f"help at {w}")
            for name in ("kind", "dev-google", "dev-google-pair", "dev-classic", "allow", "fix-home", "phone-route",
                         "stop", "blocked", "undo", "extras", "helper-tv", "work", "remote", "health", "debug"):
                pg.evaluate("(n) => document.querySelectorAll('section').forEach(s => s.hidden = s.dataset.step !== n)", name)
                self.no_sideways_scroll(pg, f"{name} at {w}")

    # ---- nothing leaves this computer ----

    def test_nothing_is_fetched_from_outside(self):
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.sign_in(pg)
        self.to_plan(pg)
        self.install(pg)
        pg.wait_for_timeout(300)
        outside = [u for u in self.requests if not u.startswith(self.h.url[:-1]) and not u.startswith("data:")]
        self.assertEqual(outside, [])
        fonts = [u for u in self.requests if u.endswith(".woff2")]
        self.assertTrue(any("nunito" in u for u in fonts) and any("inter" in u for u in fonts), fonts)
        got = pg.evaluate("[document.fonts.check('900 20px Nunito'), document.fonts.check('500 16px Inter')]")
        self.assertEqual(got, [True, True])

    # ---- words ----

    def test_words_follow_the_text_rules(self):
        banned = re.compile(r"couch-tv|\bbeta\b|experimental|coming soon|[–—]", re.I)
        pg = self.open(uh.Harness(stub=uh.stub_account()))
        self.sign_in(pg)
        seen = []
        for name in pg.evaluate("[...document.querySelectorAll('section')].map(s => s.dataset.step)"):
            pg.evaluate("(n) => document.querySelectorAll('section').forEach(s => s.hidden = s.dataset.step !== n)", name)
            seen.append((name, pg.evaluate("document.querySelector('section:not([hidden])').innerText")))
        seen.append(("header", pg.inner_text("header")))
        for name, text in seen:
            m = banned.search(text)
            self.assertIsNone(m, f"{name}: {m and m.group(0)}")
        # the help lines (the help page and the empty list) are 14 words or fewer
        for name, sel in (("nohere", 'section[data-step="nohere"]'), ("find-help", "#find-help")):
            pg.evaluate("(n) => document.querySelectorAll('section').forEach(s => s.hidden = s.dataset.step !== n)", "find" if name == "find-help" else name)
            pg.evaluate("document.getElementById('find-help').hidden = false")
            lines = pg.evaluate("(sel) => [...document.querySelectorAll(sel + ' li, ' + sel + ' .hint, ' + sel + ' .lede')].filter(e => e.offsetParent).map(e => e.innerText)", sel)
            self.assertTrue(lines, name)
            for line in lines:
                for sentence in re.split(r"(?<=[.?!])\s+", line.strip()):
                    self.assertLessEqual(len(sentence.split()), 14, f"{name}: {sentence}")


if __name__ == "__main__":
    unittest.main()
