"""S7 (Opus final check, 28 Nov 2026): Setup does not overwrite a Home Assistant set up made on the TV. A TV that already had one of our apps
keeps what it has (Setup sends "none", which the app leaves alone) unless the person chose to replace it; a TV with none of our apps gets the
section as before. Pretend TV and pretend Home Assistant."""
import base64
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())
from couchtv_setup import steps  # noqa: E402
from faketv import FakeTv  # noqa: E402

SECTION = {"url": "http://homeassistant.local:8123", "token": "llat." + "K" * 60, "climate": [{"entity": "climate.lounge", "name": "Lounge"}]}


def ha_sent(tv):
    start = next(c for c in tv.log if c.startswith("am force-stop app.couchtv.launcher"))
    return re.search(r"--es ha_b64 (\S+)", start).group(1)


class Keep(unittest.TestCase):
    def test_a_tv_with_none_of_our_apps_gets_the_section(self):
        tv = FakeTv("google")
        r = steps.make_home(tv, "/x/couch-tv-home.apk", smart=SECTION)
        self.assertEqual(json.loads(base64.b64decode(ha_sent(tv))), SECTION)
        self.assertIn("smart home sent", r["changed"])
        self.assertFalse(r["smart_kept"])

    def test_a_tv_that_already_had_couch_tv_keeps_what_it_has(self):
        for pkg in ("app.couchtv.launcher", "dev.couchtv.ontv"):
            tv = FakeTv("google", installed=[pkg])
            r = steps.make_home(tv, "/x/couch-tv-home.apk", smart=SECTION)
            self.assertEqual(ha_sent(tv), "none", pkg)
            self.assertTrue(r["smart_kept"])
            self.assertNotIn("smart home sent", r["changed"])
            self.assertIn("smart home left as it is on the TV", r["changed"])
            self.assertNotIn(SECTION["token"], json.dumps(tv.log))

    def test_the_person_can_choose_to_replace_it(self):
        tv = FakeTv("google", installed=["app.couchtv.launcher"])
        r = steps.make_home(tv, "/x/couch-tv-home.apk", smart=SECTION, replace_ha=True)
        self.assertEqual(json.loads(base64.b64decode(ha_sent(tv))), SECTION)
        self.assertIn("smart home sent", r["changed"])
        self.assertFalse(r["smart_kept"])

    def test_nothing_to_send_is_not_called_kept(self):
        tv = FakeTv("google", installed=["app.couchtv.launcher"])
        r = steps.make_home(tv, "/x/couch-tv-home.apk")
        self.assertFalse(r["smart_kept"])
        self.assertEqual(ha_sent(tv), "none")

    def test_the_setup_page_can_send_the_choice(self):
        src = open(os.path.join(HERE, "..", "couchtv_setup", "server.py"), encoding="utf-8").read()
        self.assertIn('replace_ha=body.get("replace_ha") is True', src)



class Choice(unittest.TestCase):
    """The plain choice on the plan screen: only when this computer has a Home Assistant for this TV and the TV already has Couch TV."""

    def plan(self, tv, section, tv_id="33333333-3333-4333-8333-333333333333"):
        from unittest import mock
        from couchtv_setup import server, smarthome
        old = server.S.tv, server.S.facts, server.S.link
        server.S.tv, server.S.facts = tv, steps.facts(tv)
        server.S.link = server.studio.Link()      # a link another test left (its tv_id) must not answer for this TV
        try:
            with mock.patch.object(smarthome, "tv_section", return_value=section), \
                 mock.patch.object(server, "_rows", return_value={"x": tv_id} if tv_id else {}), \
                 mock.patch.object(server, "_row_name", return_value="x"):
                return server.api("POST", "/api/plan", {})["smart_choice"]
        finally:
            server.S.tv, server.S.facts, server.S.link = old

    def test_asks_only_for_a_tv_that_already_has_couch_tv_and_a_home_assistant_to_send(self):
        self.assertEqual(self.plan(FakeTv("google", installed=["app.couchtv.launcher"]), SECTION), {"ask": True})
        self.assertEqual(self.plan(FakeTv("google", installed=["dev.couchtv.ontv"]), SECTION), {"ask": True})

    def test_a_tv_with_none_of_our_apps_is_sent_it_without_asking(self):
        self.assertEqual(self.plan(FakeTv("google"), SECTION), {"ask": False})

    def test_nothing_to_send_or_no_row_means_no_question(self):
        self.assertEqual(self.plan(FakeTv("google", installed=["app.couchtv.launcher"]), None), {"ask": False})
        self.assertEqual(self.plan(FakeTv("google", installed=["app.couchtv.launcher"]), SECTION, tv_id=None), {"ask": False})

    def test_the_screen_asks_in_plain_words_and_sends_the_answer(self):
        web = os.path.join(HERE, "..", "couchtv_setup", "web")
        html = open(os.path.join(web, "index.html"), encoding="utf-8").read()
        js = open(os.path.join(web, "app.js"), encoding="utf-8").read()
        self.assertIn("This TV already has Couch TV. Send this computer's Home Assistant to it?", html)
        self.assertIn("Send it</label>", html)
        self.assertIn("Keep what the TV has</label>", html)
        self.assertRegex(html, r'id="ha-send-keep" value="keep" checked', "keeping what the TV has is the default")
        self.assertIn('id="ha-row" hidden', html)
        self.assertIn('replace_ha: !$("ha-row").hidden && $("ha-send-yes").checked', js)
        self.assertIn('$("ha-row").hidden = !(p.smart_choice && p.smart_choice.ask)', js)
        self.assertNotIn("\u2014", html + js)


if __name__ == "__main__":
    unittest.main()
