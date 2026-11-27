"""The finish screen's extras (live.js, lane D 28 Nov 2026) in a real browser, with the TV and the account faked (ui_harness.py).
Skipped when Playwright or its browser is not installed.

What it proves: the four cards are on Finish; Ask AI shows the money line, sends the key once and empties the field, and the key is
never on the page afterwards; the own AI lines need the Helper or the TV app; the TV's apps show by name and go to the account;
Live from this TV shows what the TV has on the go; Back returns to Finish; no sideways scroll at 390; nothing from outside is fetched.
"""
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ui_harness as uh  # noqa: E402

PW, BROWSER = uh.chromium()


def step(pg):
    return pg.evaluate("(document.querySelector('section:not([hidden])') || {dataset: {}}).dataset.step")


@unittest.skipUnless(BROWSER, "Playwright's Chromium is not installed")
class Live(unittest.TestCase):
    def open(self, width=1440):
        stub = uh.stub_account()
        stub["/v1/setup/key"] = {"kind": "ai", "shown": {"last4": "7Kq2"}, "money_line": "This key can spend your money. Whoever has it can run up charges with that company.",
                                 "allowed": True, "trusted": True, "sent": True}
        stub["/v1/setup/apps"] = {"apps": 3}
        h = uh.Harness(stub=stub).start()
        self.addCleanup(h.stop)
        self.h = h
        ctx = BROWSER.new_context(viewport={"width": width, "height": 900})
        self.addCleanup(ctx.close)
        pg = ctx.new_page()
        self.requests, self.errors = [], []
        pg.on("request", lambda r: self.requests.append(r.url))
        pg.on("pageerror", lambda e: self.errors.append(str(e)))
        pg.goto(h.url)
        pg.wait_for_selector("#setup-start")
        self.addCleanup(lambda: self.assertEqual(self.errors, []))
        self.addCleanup(lambda: self.assertTrue(all(u.startswith(h.url[:-1]) for u in self.requests), "only this computer's page server"))
        # sign in, find the TV, install, Finish (the same steps as test_ui.py)
        pg.wait_for_selector("#acct-box:not([hidden])")
        pg.fill("#acct-code", "ABCD-EFGH")
        pg.click("#acct-go")
        pg.wait_for_selector("#link-ask:not([hidden])")
        pg.click("#link-ask-yes")
        pg.wait_for_selector("#acct-top:not([hidden])")
        pg.click("#setup-start")
        pg.wait_for_selector("#found .tvc")
        pg.locator("#found .tvc").nth(0).get_by_role("button", name="Set up this TV").click()
        pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)
        pg.click("#setup-go")
        pg.wait_for_selector('section[data-step="tidy"]:not([hidden])', timeout=30000)
        pg.click("#tidy-skip")
        pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)
        return pg

    def test_ask_ai_money_line_key_sent_once_and_gone(self):
        from couchtv_setup import studio
        pg = self.open()
        for id_ in ("live-ask-go", "live-agent-go", "live-apps-go", "live-watch-go"):
            self.assertTrue(pg.is_visible("#" + id_), id_)
        pg.click("#live-ask-go")
        pg.wait_for_selector('section[data-step="live-ask"]:not([hidden])')
        self.assertIn("This key can spend your money.", pg.inner_text("#ask-money"))
        self.assertIn("Only", pg.inner_text("#ask-only-l"))
        sent = []
        real = studio.call
        with mock.patch.object(studio, "call", lambda p, b, t=None, timeout=15: sent.append((p, b)) or real(p, b, t, timeout)):
            pg.fill("#ask-key", "sk-ant-SECRETKEY-7Kq2")
            pg.click("#ask-save")
            pg.wait_for_selector("#live-ask .hint:has-text('within a minute')".replace("#live-ask", 'section[data-step="live-ask"]'))
        keys = [b for p, b in sent if p == "/v1/setup/key"]
        self.assertEqual(len(keys), 1)
        self.assertEqual(keys[0]["base"], "https://api.anthropic.com")
        self.assertEqual(pg.input_value("#ask-key"), "", "the field is emptied")
        self.assertNotIn("SECRETKEY", pg.content(), "the key is not on the page any more")
        self.assertIn("7Kq2", pg.inner_text('section[data-step="live-ask"]'))
        pg.click("#back")
        self.assertEqual(step(pg), "done")

    def test_apps_and_live_read_the_tv(self):
        pg = self.open(width=390)
        tv = self.h.tvs[-1]
        tv_shell = tv.shell

        granted = []

        def shell(cmd, timeout_s=60):
            tv.log.append(cmd)
            if cmd.startswith("cmd notification allow_listener"):
                granted.append(1)
                return ""
            if "enabled_notification_listeners" in cmd:
                return "app.couchtv.launcher/app.couchtv.launcher.SpotifySessionAccess" if granted else "null"
            if "watch_next_program" in cmd:
                return "Row: 0 _id=4, title=Bluey, package_name=au.net.abc.iview, browsable=1, last_engagement_time_utc_millis=1764300000000"
            return tv_shell(cmd, timeout_s)
        tv.shell = shell
        pg.click("#live-apps-go")
        pg.wait_for_selector("#apps-list li")
        self.assertIn("Netflix", pg.inner_text("#apps-list"))
        pg.click("#apps-send")
        pg.wait_for_selector('section[data-step="live-apps"] .hint:has-text("Sent")')
        self.assertIn("/api/live/apps-send", self.h.log)
        over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        self.assertLessEqual(over, 0)
        pg.click("#back")
        pg.click("#live-watch-go")
        pg.wait_for_selector("#watch-rows .live-row")
        txt = pg.inner_text("#watch-rows")
        self.assertIn("Bluey (ABC iview)", txt)
        self.assertIn("Off until you turn it on here", txt)
        self.assertTrue(pg.is_visible("#watch-music"), "offers Turn on Now playing")
        pg.click("#watch-music")
        pg.wait_for_selector('section[data-step="live-watch"] .hint:has-text("Now playing is on")')
        self.assertIn("cmd notification allow_listener app.couchtv.launcher/app.couchtv.launcher.SpotifySessionAccess", tv.log)
        over = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        self.assertLessEqual(over, 0)

    def test_own_ai_without_helper_offers_the_tv_app(self):
        pg = self.open()
        pg.click("#live-agent-go")
        pg.wait_for_selector("#agent-pair:not([hidden])")
        self.assertEqual(pg.locator("#agent-desktop").count(), 0, "no lines without a way in")


if __name__ == "__main__":
    unittest.main()
