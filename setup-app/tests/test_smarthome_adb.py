"""N12 (28 Nov 2026): Setup pushes the Home Assistant section (ha_b64) to an Android TV it is setting up over adb, cut to that TV's room.
Pretend Home Assistant data and a pretend TV; nothing real is touched. The same section is checked on the TV's side by the Kotlin test
SetupSectionTest (tv-home/android/shared/test/app/couchtv/ha/), through tests/fixtures/setup_ha_section.json."""
import base64
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())
from couchtv_setup import smarthome as sh, steps, studio  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402
from faketv import FakeTv  # noqa: E402

FIXTURE = os.path.join(HERE, "..", "..", "tests", "fixtures", "setup_ha_section.json")
LLAT = "llat." + "L" * 60
GUEST = "33333333-3333-4333-8333-333333333333"
LOUNGE = "22222222-2222-4222-8222-222222222222"
ENT = [("climate.lounge", "Lounge air con"), ("climate.guest", "Guest air con"), ("light.lounge", "Lounge lamp"), ("light.guest", "Guest lamp"),
       ("media_player.lounge", "Lounge speaker"), ("media_player.guest", "Guest speaker"), ("scene.movie", "Movie night"),
       ("switch.kettle", "Kettle"), ("sensor.pool", "Pool"), ("cover.garage_door", "Garage door"), ("switch.relay_1", "Garagentor"), ("lock.front", "Front")]
ROOMS = [{"tv_id": GUEST, "label": "Guest room", "picks": {"air": ["climate.guest"], "lights": ["light.guest"], "speakers": ["media_player.guest"]}},
         {"tv_id": LOUNGE, "label": "Lounge", "picks": {"air": ["climate.lounge"], "lights": ["light.lounge"], "speakers": []}},
         {"tv_id": "44444444-4444-4444-8444-444444444444", "label": "Nothing", "picks": {}}]


def connect_and_save():
    sh.SM.reset()
    sh.SM.ha = {"base": "http://homeassistant.local:8123", "token": LLAT, "areas": {}, "version": "2026.11",
                "entities": [{"entity": e, "name": n, "domain": e.split(".")[0]} for e, n in ENT]}
    link = studio.Link()
    link.token = "setup-token"
    with mock.patch.object(studio, "call", return_value={"ok": True, "rev": 1}), mock.patch.object(sh, "helper_dir", return_value=tempfile.mkdtemp()):
        sh.save(link, ROOMS)


class Section(unittest.TestCase):
    def setUp(self):
        connect_and_save()

    def test_a_room_gets_only_its_own_air_con_lights_and_speakers(self):
        s = sh.tv_section(GUEST)
        self.assertEqual(s["url"], "http://homeassistant.local:8123")
        self.assertEqual(s["token"], LLAT)
        self.assertEqual([x["entity"] for x in s["climate"]], ["climate.guest"])
        self.assertEqual([x["entity"] for x in s["controls"]], ["light.guest", "switch.kettle"])
        self.assertEqual([x["entity"] for x in s["speakers"]], ["media_player.guest"])
        self.assertEqual([x["entity"] for x in s["scenes"]], ["scene.movie"], "kinds a room does not cap stay")
        self.assertNotIn("from_setup", s)
        text = json.dumps(s)
        for gone in ("lounge", "garage", "lock.", "relay_1"):
            self.assertNotIn(gone, text)

    def test_a_tv_with_no_room_or_an_empty_room_gets_nothing(self):
        self.assertIsNone(sh.tv_section("55555555-5555-4555-8555-555555555555"))
        self.assertIsNone(sh.tv_section("44444444-4444-4444-8444-444444444444"))
        self.assertIsNone(sh.tv_section(None))
        sh.SM.ha = None
        self.assertIsNone(sh.tv_section(GUEST), "no Home Assistant connected on this computer")

    def test_a_new_save_replaces_the_rooms(self):
        link = studio.Link()
        link.token = "t"
        with mock.patch.object(studio, "call", return_value={"ok": True}), mock.patch.object(sh, "helper_dir", return_value=tempfile.mkdtemp()):
            sh.save(link, [ROOMS[1]])
        self.assertIsNone(sh.tv_section(GUEST))
        self.assertIsNotNone(sh.tv_section(LOUNGE))

    def test_the_kotlin_fixture_is_what_setup_builds(self):
        want = json.load(open(FIXTURE))
        self.assertEqual(want["section"], sh.tv_section(GUEST))
        self.assertEqual(want["room"], sh.SM.rooms[GUEST])


class Push(unittest.TestCase):
    def setUp(self):
        connect_and_save()

    def sent(self, tv):
        start = next(c for c in tv.log if c.startswith("am force-stop app.couchtv.launcher"))
        return start, re.search(r"--es ha_b64 (\S+)", start).group(1)

    def test_make_home_sends_the_section_with_the_other_settings(self):
        tv = FakeTv("google")
        section = sh.tv_section(GUEST)
        r = steps.make_home(tv, "/x/couch-tv-home.apk", smart=section)
        start, b64 = self.sent(tv)
        self.assertIn("am start -n app.couchtv.launcher/.FromComputer ", start, "the one channel only adb can use")
        self.assertEqual(json.loads(base64.b64decode(b64)), section)
        self.assertIn("--es config_b64 ", start)
        self.assertIn("smart home sent", r["changed"])

    def test_nothing_to_send_stays_none(self):
        tv = FakeTv("google")
        r = steps.make_home(tv, "/x/couch-tv-home.apk")
        self.assertIn("--es ha_b64 none ", self.sent(tv)[0])
        self.assertNotIn("smart home sent", r["changed"])

    def test_an_older_couch_tv_gets_it_the_old_way_too(self):
        tv = FakeTv("google")
        tv.app = "0.13.14"
        steps.make_home(tv, "/x/couch-tv-home.apk", smart=sh.tv_section(GUEST))
        starts = [c for c in tv.log if "ha_b64" in c and "config_b64" in c]
        self.assertEqual(len(starts), 2)
        self.assertTrue(all("--es ha_b64 none" not in c for c in starts))

    def test_a_failure_never_shows_the_key(self):
        tv = FakeTv("google")
        section = sh.tv_section(GUEST)
        b64 = base64.b64encode(json.dumps(section, separators=(",", ":")).encode()).decode()
        real = steps.start_activity

        def boom(t, act, extras="", before=""):
            if "ha_b64" in extras:
                raise TvError("The TV did not open Couch TV " + b64[:60], "not_started", extras)
            return real(t, act, extras, before)
        with mock.patch.object(steps, "start_activity", side_effect=boom):
            with self.assertRaises(TvError) as c:
                steps.make_home(tv, "/x/couch-tv-home.apk", smart=section)
        pay = json.dumps(c.exception.payload())
        self.assertNotIn(b64[:60], pay)
        self.assertNotIn("detail", pay)
        self.assertNotIn(LLAT, pay)


class ServerSide(unittest.TestCase):
    def test_setup_passes_this_tvs_section_only(self):
        """server.py asks tv_section with the TV id the account gave this TV, and nothing for a TV that is not linked."""
        src = open(os.path.join(HERE, "..", "couchtv_setup", "server.py"), encoding="utf-8").read()
        self.assertIn('smart=smarthome.tv_section(acct and acct.get("tv_id"))', src)
        self.assertIn('"tv_id": reg.get("tv_id")', src)


if __name__ == "__main__":
    unittest.main()
