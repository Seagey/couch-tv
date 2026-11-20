"""The phone's Home settings page served by the home computer (bridge/phonepage.py, server.py).

A Samsung, LG, VIDAA, Titan, Saphi, Panasonic, TiVo, Vega, Roku, Apple TV or Android TV home that this
bridge runs gets the same /setup page and endpoints as the on-TV app (Server.kt):
  * pairing with the 6 digit code from the TV (right, wrong, run out, 5 wrong tries, used once),
    swapped for the bridge's pairing key, never shown or echoed anywhere else;
  * the key is checked before any body is read (a photo upload without it is refused unread);
  * size limits (25 MB photos, 64 KB changes, 256 KB views);
  * settings_patch changes only the town, checked like the on-TV app; a TV push with an older "seen"
    keeps the phone's town and photos and says so ("kept");
  * At home and a design's widget settings travel to the TV home through its inbox and back;
  * photos are made screen size, listed in that TV's Home settings, shown only with the key.
Needs Pillow for the photo tests (bridge/requirements.txt).
"""
import asyncio
import io
import json
import os
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

os.environ.setdefault("COUCH_DATA", tempfile.mkdtemp(prefix="couchtv-phonepage-"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
from aiohttp import web  # noqa: E402
from aiohttp.test_utils import AioHTTPTestCase, TestServer  # noqa: E402
import config  # noqa: E402
import phonepage  # noqa: E402
import server  # noqa: E402
import store  # noqa: E402

KEY = "test-pairing-key-123456"

try:
    from PIL import Image
except ImportError:   # pragma: no cover
    Image = None


def jpeg(w, h, colour=(200, 40, 40)):
    b = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(b, "JPEG")
    return b.getvalue()


class PinRules(unittest.TestCase):
    def setUp(self):
        phonepage.reset()

    def test_right_code_once(self):
        c = phonepage.new_pin("lounge", now=1000)
        self.assertTrue(phonepage.pair(c, now=1001))
        self.assertFalse(phonepage.pair(c, now=1002))   # used up

    def test_runs_out_after_three_minutes(self):
        c = phonepage.new_pin(now=1000)
        self.assertFalse(phonepage.pair(c, now=1000 + 181))

    def test_five_wrong_throw_it_away(self):
        c = phonepage.new_pin(now=1000)
        for i in range(5):   # five different wrong codes (the same one again is not a new try)
            wrong = "%06d" % (100000 + i) if c != "%06d" % (100000 + i) else "999999"
            self.assertFalse(phonepage.pair(wrong, now=1001))
        self.assertIsNone(phonepage.current_pin(now=1001))
        self.assertFalse(phonepage.pair(c, now=1001))

    def test_qr_reuses_a_code_with_time_left(self):
        c = phonepage.pin_for_qr(now=1000)
        self.assertEqual(phonepage.pin_for_qr(now=1100), c)          # 80 s left
        self.assertNotEqual(phonepage.pin_for_qr(now=1000 + 160), c)  # 20 s left: a new one

    def test_shown_only_on_its_tv(self):
        phonepage.new_pin("bedroom", show=True, now=1000)
        self.assertIsNone(phonepage.shown_pin("lounge", now=1001))
        self.assertEqual(phonepage.shown_pin("bedroom", now=1001)["code"], phonepage.current_pin(now=1001))
        # the QR's code is never shown as a line on the home
        phonepage.new_pin("bedroom", now=2000)
        self.assertIsNone(phonepage.shown_pin("bedroom", now=2001))

    def test_fit(self):
        self.assertEqual(phonepage.fit(4032, 3024), (1440, 1080))
        self.assertEqual(phonepage.fit(3024, 4032), (1080, 1440))   # portrait fits the screen turned
        self.assertEqual(phonepage.fit(800, 600), (800, 600))       # never bigger

    def test_strays(self):
        self.assertEqual(phonepage.strays({"bridgeaaaaaa11.jpg"}, {"bridgeaaaaaa11.jpg", "bridgebbbbbb22.jpg", "mine.jpg"}),
                         {"bridgebbbbbb22.jpg"})


class PhonePageApp(AioHTTPTestCase):
    async def get_application(self):
        phonepage.reset()
        server._pair_start_at[0] = 0
        server._failed_attempts.clear()
        server.pair_lock_reset()
        self.data = tempfile.mkdtemp(prefix="couchtv-pp-")
        self._patches = [patch.object(config, "PAIRING_KEY", KEY), patch.object(store, "DATA", self.data),
                         patch.object(phonepage, "EDIT_WAIT_S", 3.0)]
        for p in self._patches:
            p.start()
        app = web.Application(middlewares=[server.middleware])
        r = app.router
        r.add_get("/api/health", server.h_health)
        r.add_post("/api/pair", server.h_pair)
        r.add_get("/api/settings", server.h_settings_get)
        r.add_post("/api/settings", server.h_settings_set)
        r.add_post("/api/pair/start", server.h_pair_start)
        r.add_get("/api/phone-link", server.h_phone_link)
        r.add_get("/api/athome", server.h_athome_get)
        r.add_post("/api/athome", server.h_athome_set)
        r.add_get("/api/phone/inbox", server.h_phone_inbox)
        r.add_post("/api/phone/view", server.h_phone_view)
        r.add_post("/api/phone/done", server.h_phone_done)
        r.add_post("/api/photos", server.h_photos_add)
        r.add_post("/api/photos/remove", server.h_photos_remove)
        r.add_get("/api/photo/{name}", server.h_photo_get)
        r.add_get("/setup", server.h_setup_page)
        r.add_get("/api/weather", server.h_weather)
        r.add_get("/ontv/shim.js", server.h_setup_shim)
        return app

    async def get_server(self, app):
        return TestServer(app, host="127.0.0.1")

    def tearDown(self):
        super().tearDown()
        for p in self._patches:
            p.stop()

    H = {"Authorization": "Bearer " + KEY}

    async def j(self, method, path, body=None, headers=None, **kw):
        h = dict(self.H if headers is None else headers)
        if body is not None:
            kw["data"] = json.dumps(body)
            h["Content-Type"] = "application/json"
        r = await self.client.request(method, path, headers=h, **kw)
        return r.status, await r.json()

    # ---- the page itself

    async def test_page_and_shim_served(self):
        r = await self.client.get("/setup")
        self.assertEqual(r.status, 200)
        html = await r.text()
        self.assertIn('<script src="/ontv/shim.js"></script>', html)
        self.assertIn("Home settings", html)
        r = await self.client.get("/ontv/shim.js")
        self.assertEqual(r.status, 200)
        self.assertIn("couchtv.token", await r.text())

    # ---- pairing

    async def test_pair_with_code_gets_the_key_once(self):
        st, link = await self.j("GET", "/api/phone-link", headers={**self.H, "Host": "192.0.2.5:5400"})
        self.assertEqual(st, 200)
        self.assertRegex(link["url"], r"^http://192\.0\.2\.5:5400/setup#pin=\d{6}$")
        self.assertGreater(link["pin_expires_in"], 170)
        pin = link["url"][-6:]
        st, j = await self.j("POST", "/api/pair", {"pin": pin, "name": "iPhone"}, headers={})
        self.assertEqual((st, j["token"]), (200, KEY))
        st, j = await self.j("POST", "/api/pair", {"pin": pin}, headers={})
        self.assertEqual(st, 401)
        self.assertNotIn("token", j)
        self.assertIn("expired", j["error"])

    async def test_wrong_code_never_gives_the_key(self):
        await self.j("GET", "/api/phone-link")
        pin = phonepage.current_pin()
        wrong = "000000" if pin != "000000" else "111111"
        st, j = await self.j("POST", "/api/pair", {"pin": wrong}, headers={})
        self.assertEqual(st, 401)
        self.assertNotIn(KEY, json.dumps(j))
        self.assertIn("not right", j["error"])

    def from_ip(self):
        # each request names its address (X-Test-Ip), as if from that phone on the Wi-Fi
        return patch.object(server, "client_ip", lambda r: r.headers.get("X-Test-Ip"))

    async def guesses(self, ip, n, distinct=True, live=True):
        """n wrong codes from one address; a new live code before each when live (5 wrong throw one away)."""
        out = []
        for i in range(n):
            if live and not phonepage.current_pin():
                phonepage.new_pin()
            pin = phonepage.current_pin()
            g = "%06d" % (100000 + i if distinct else 100000)
            if g == pin:
                g = "%06d" % (200000 + i)
            st, j = await self.j("POST", "/api/pair", {"pin": g}, headers={"X-Test-Ip": ip})
            out.append(st)
        return out

    async def test_wrong_codes_from_several_phones_lock_pairing(self):
        # 15 wrong guesses at a live code in 10 minutes, from 3 addresses (5 each), lock code pairing:
        # the code, Show a code and the QR; a phone holding the key keeps working
        with self.from_ip():
            for ip in ("192.0.2.11", "192.0.2.12", "192.0.2.13"):
                self.assertEqual(await self.guesses(ip, 5), [401] * 5)
            self.assertGreater(server.pair_locked_for(), 590)
            pin = phonepage.new_pin()
            st, j = await self.j("POST", "/api/pair", {"pin": pin}, headers={"X-Test-Ip": "192.0.2.20"})
            self.assertEqual((st, j.get("error_key")), (429, "err_pairing_locked"))
            self.assertIn("Wait 10 min", j["error"])
            self.assertGreater(j.get("retry_after", 0), 590)
            self.assertNotIn("token", j)
            r = await self.client.post("/api/pair/start")
            self.assertEqual(r.status, 429)
            st, j = await self.j("GET", "/api/phone-link")
            self.assertEqual(st, 429)
            st, j = await self.j("GET", "/api/settings")
            self.assertEqual(st, 200)
            server.pair_lock_reset()
            st, j = await self.j("POST", "/api/pair", {"pin": phonepage.current_pin()}, headers={"X-Test-Ip": "192.0.2.20"})
            self.assertEqual(st, 200)

    async def test_one_address_alone_never_locks_pairing(self):
        # Fable B2: one address, the same wrong code over and over, then many different ones: never a lock,
        # and the owner's phone (another address) still pairs with the code in the QR
        with self.from_ip():
            same = await self.guesses("192.0.2.66", 40, distinct=False)
            self.assertEqual(server.pair_locked_for(), 0)
            self.assertTrue(set(same) <= {401, 429})
            server._failed_attempts.clear()
            many = await self.guesses("192.0.2.66", 40)
            self.assertTrue(set(many) <= {401, 429})
            self.assertEqual(server.pair_locked_for(), 0)
            st, link = await self.j("GET", "/api/phone-link")
            self.assertEqual(st, 200)
            st, j = await self.j("POST", "/api/pair", {"pin": link["url"][-6:]}, headers={"X-Test-Ip": "192.0.2.7"})
            self.assertEqual((st, j.get("token")), (200, KEY))

    async def test_same_wrong_code_never_kills_the_qr_code(self):
        # N1: one phone sending "000000" again and again (6 times here, 20 rounds) never throws the QR's code away
        with self.from_ip():
            for rnd in range(20):
                st, link = await self.j("GET", "/api/phone-link")
                pin = link["url"][-6:]
                bad = "000000" if pin != "000000" else "111111"
                for _ in range(6):
                    st, j = await self.j("POST", "/api/pair", {"pin": bad}, headers={"X-Test-Ip": "192.0.2.66"})
                    self.assertEqual(st, 401)
                self.assertEqual(phonepage.current_pin(), pin, "round %d" % rnd)
                st, j = await self.j("POST", "/api/pair", {"pin": pin}, headers={"X-Test-Ip": "192.0.2.7"})
                self.assertEqual((st, j.get("token")), (200, KEY), "round %d" % rnd)
            self.assertEqual(server.pair_locked_for(), 0)

    def test_same_wrong_code_rule(self):
        c = phonepage.new_pin(now=1000)
        bad = "000000" if c != "000000" else "111111"
        for _ in range(6):
            self.assertFalse(phonepage.pair(bad, "192.0.2.66", now=1001))
        self.assertEqual(phonepage.current_pin(now=1001), c)
        self.assertTrue(phonepage.pair(c, "192.0.2.7", now=1002))

    async def test_one_address_five_wrong_codes_in_ten_minutes(self):
        # N2: an address with 5 different wrong codes waits until the oldest is 10 minutes old (about 720 a day)
        with self.from_ip():
            st = await self.guesses("192.0.2.66", 5)
            self.assertEqual(st, [401] * 5)
            server._failed_attempts.clear()   # past the one minute limit: the 10 minute one still holds
            phonepage.new_pin()
            st, j = await self.j("POST", "/api/pair", {"pin": "222333"}, headers={"X-Test-Ip": "192.0.2.66"})
            self.assertEqual((st, j.get("error_key")), (429, "err_pairing_locked"))
            self.assertGreater(j.get("retry_after", 0), 590)
            # nobody else waits, and the right code still pairs from another phone
            st, j = await self.j("POST", "/api/pair", {"pin": phonepage.current_pin()}, headers={"X-Test-Ip": "192.0.2.7"})
            self.assertEqual(st, 200)
            # 10 minutes on, the address may try again
            self.assertEqual(phonepage.address_wait("192.0.2.66", server.PAIR_LOCK_WINDOW, server.time.monotonic() + 601), 0)
        self.assertEqual(phonepage.address_wait(None, server.PAIR_LOCK_WINDOW), 0)   # never the computer itself

    async def test_no_live_code_never_counts(self):
        # with no code on the TV there is nothing to guess: 60 tries from 12 addresses lock nothing
        with self.from_ip():
            for k in range(12):
                st = await self.guesses("192.0.2.%d" % (100 + k), 5, live=False)
                self.assertEqual(st, [401] * 5)
            self.assertEqual(server.pair_locked_for(), 0)
            st, link = await self.j("GET", "/api/phone-link")
            self.assertEqual(st, 200)

    async def test_show_a_code_never_swaps_a_live_code(self):
        # Fable 3: asking for a code again and again (anyone on the Wi-Fi can) never kills the QR's code
        st, link = await self.j("GET", "/api/phone-link")
        qr = link["url"][-6:]
        for _ in range(5):
            server._pair_start_at[0] = 0
            r = await self.client.post("/api/pair/start")
            self.assertEqual(r.status, 200)
            self.assertGreater((await r.json())["expires_in"], 90)
            self.assertEqual(phonepage.current_pin(), qr)
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual(box["pin"]["code"], qr)   # the same code shows as the line on the TV
        st, j = await self.j("POST", "/api/pair", {"pin": qr}, headers={})
        self.assertEqual(st, 200)
        # with 90 s or less left, a new one (someone is about to type it)
        c = phonepage.new_pin(now=time.time() - 100)
        server._pair_start_at[0] = 0
        r = await self.client.post("/api/pair/start")
        self.assertNotEqual(phonepage.current_pin(), c)
        self.assertGreater((await r.json())["expires_in"], 170)

    async def test_show_a_code_on_another_tv(self):
        with patch.object(server, "TVS", {"lounge": None, "bedroom": None}), patch.object(server, "DEFAULT_TV", "lounge"):
            r = await self.client.post("/api/pair/start?tv=bedroom")
            self.assertEqual(r.status, 200)
            st, box = await self.j("GET", "/api/phone/inbox?home=1&tv=bedroom")
            self.assertEqual(box["pin"]["code"], phonepage.current_pin())
            st, box = await self.j("GET", "/api/phone/inbox?home=1&tv=lounge")
            self.assertIsNone(box["pin"])

    async def test_code_calls_refuse_a_blind_origin(self):
        # Fable 6: Origin null (a sandboxed frame on any web page) or file: never asks for or swaps a code
        st, link = await self.j("GET", "/api/phone-link")
        pin = link["url"][-6:]
        for o in ("null", "file://", "NULL"):
            st, j = await self.j("POST", "/api/pair", {"pin": pin}, headers={"Origin": o})
            self.assertEqual(st, 403, o)
            self.assertNotIn(KEY, json.dumps(j))
            r = await self.client.post("/api/pair/start", headers={"Origin": o})
            self.assertEqual(r.status, 403, o)
        self.assertEqual(phonepage.current_pin(), pin)   # not used up, not swapped
        host = "127.0.0.1:%d" % self.server.port
        st, j = await self.j("POST", "/api/pair", {"pin": pin}, headers={"Origin": "http://" + host, "Host": host})
        self.assertEqual((st, j.get("token")), (200, KEY))   # the page itself: its own address

    async def test_used_or_dead_code_tells_the_tv_home(self):
        # Fable 7: pin_gen changes when the code is used or thrown away, so the TV home asks for its QR again
        st, link = await self.j("GET", "/api/phone-link")
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        g0 = box["pin_gen"]
        st, j = await self.j("POST", "/api/pair", {"pin": link["url"][-6:]}, headers={})
        self.assertEqual(st, 200)
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        g1 = box["pin_gen"]
        self.assertNotEqual(g1, g0)
        st, link = await self.j("GET", "/api/phone-link")
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        g2 = box["pin_gen"]
        self.assertNotEqual(g2, g1)   # the new QR code
        st, again = await self.j("GET", "/api/phone-link")
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual(box["pin_gen"], g2)   # asking again keeps it: no loop
        pin = link["url"][-6:]
        for i in range(5):
            await self.j("POST", "/api/pair", {"pin": "%06d" % (100000 + i) if pin != "%06d" % (100000 + i) else "999999"}, headers={})
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertNotEqual(box["pin_gen"], g2)   # thrown away after 5 wrong

    async def test_phone_link_needs_the_key(self):
        st, j = await self.j("GET", "/api/phone-link", headers={})
        self.assertEqual(st, 401)
        self.assertIsNone(phonepage.current_pin())   # no code was made for an unpaired caller

    async def test_phone_link_for_another_tv_names_it(self):
        with patch.object(server, "TVS", {"lounge": None, "bedroom": None}), patch.object(server, "DEFAULT_TV", "lounge"):
            st, j = await self.j("GET", "/api/phone-link?tv=bedroom", headers={**self.H, "Host": "my-computer.local:5400"})
        self.assertEqual(st, 200)
        self.assertRegex(j["url"], r"^http://my-computer\.local:5400/setup\?tv=bedroom#pin=\d{6}$")

    async def test_show_a_code_on_the_tv(self):
        r = await self.client.post("/api/pair/start")   # no body, no content type: the shim sends none
        self.assertEqual(r.status, 200)
        j = await r.json()
        self.assertNotIn("code", j)
        self.assertFalse(any(c.isdigit() and len(c) == 6 for c in json.dumps(j).split('"')))
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual(len(box["pin"]["code"]), 6)
        self.assertTrue(box["fast"])
        r = await self.client.post("/api/pair/start")
        self.assertEqual(r.status, 429)   # not every few milliseconds

    # ---- auth before body, sizes

    async def test_photo_without_key_refused_unread(self):
        r = await self.client.post("/api/photos", data=b"x" * 5000, headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status, 401)
        self.assertEqual(os.listdir(self.data), [])

    async def test_photo_too_big_refused_before_reading(self):
        async def gen():
            yield b"x" * 1024
        r = await self.client.post("/api/photos", data=gen(), headers={**self.H, "Content-Type": "image/jpeg",
                                                                         "Content-Length": str(26 * 1024 * 1024)})
        self.assertEqual(r.status, 413)

    async def test_api_needs_key(self):
        for path in ("/api/settings", "/api/athome", "/api/phone/inbox"):
            st, j = await self.j("GET", path, headers={})
            self.assertEqual(st, 401, path)
        st, j = await self.j("POST", "/api/athome", {"edit": {"note": {"text": "hi"}}}, headers={})
        self.assertEqual(st, 401)

    async def test_big_change_refused(self):
        st, j = await self.j("POST", "/api/athome", {"edit": {"note": {"text": "x" * 70000}}})
        self.assertEqual(st, 413)

    # ---- settings

    async def test_settings_patch_place(self):
        st, j = await self.j("POST", "/api/settings", {"settings_patch": {"place": {"name": "Torquay", "area": "Victoria, Australia",
                                                                                     "lat": -38.3312, "lon": 144.3242, "timezone": "Australia/Melbourne"}}})
        self.assertEqual(st, 200)
        self.assertEqual(j["settings"]["place"], {"name": "Torquay", "area": "Victoria, Australia", "lat": -38.33, "lon": 144.32, "timezone": "Australia/Melbourne"})
        self.assertEqual(j["mode"], "bridge")
        st, g = await self.j("GET", "/api/settings")
        self.assertEqual(g["settings"]["place"]["name"], "Torquay")
        # the TV home learns at its next ask that Home settings changed
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual(box["settings_at"], g["updated"])

    async def test_town_from_the_phone_is_the_weather_for_roku_and_apple_tv(self):
        # Roku and Apple TV read the weather from the bridge (GET /api/weather), not from Open-Meteo themselves
        server._weather_by_town.clear()
        server._weather_by_town[(-38.33, 144.32)] = {"at": time.time(), "data": {"place": "Torquay", "temp": 19}}
        server.weather_cache.update({"at": time.time(), "data": {"place": "Sydney", "temp": 25}})
        st, w = await self.j("GET", "/api/weather")
        self.assertEqual(w["place"], "Sydney")   # no town picked: config.json's
        await self.j("POST", "/api/settings", {"settings_patch": {"place": {"name": "Torquay", "lat": -38.3312, "lon": 144.3242, "timezone": "Australia/Melbourne"}}})
        st, w = await self.j("GET", "/api/weather")
        self.assertEqual((w["place"], w["temp"]), ("Torquay", 19))

    async def test_what_draws_the_home(self):
        st, j = await self.j("GET", "/api/settings")
        self.assertEqual(j["home"], "web")
        for kind, home in (("roku", "roku"), ("appletv", "appletv"), ("vizio", "none"), ("samsung", "web"), ("lg", "web"), ("vidaa", "web")):
            with patch.dict(server.TV_CONFIG, {"tvs": [{"id": server.DEFAULT_TV, "kind": kind, "name": "Lounge"}]}):
                st, j = await self.j("GET", "/api/settings")
            self.assertEqual((j["home"], j["tv_name"]), (home, "Lounge"), kind)

    async def test_settings_patch_checked(self):
        for patch_ in ({"look": "night"}, {"place": "Torquay"}, {"place": {"name": "x", "lat": 95, "lon": 0}},
                       {"place": {"name": "", "lat": 1, "lon": 1}}, {}):
            st, j = await self.j("POST", "/api/settings", {"settings_patch": patch_})
            self.assertEqual(st, 400, patch_)
        st, j = await self.j("POST", "/api/settings", {"settings_patch": {"place": None}})
        self.assertEqual(st, 200)
        self.assertNotIn("place", j["settings"])

    async def test_tv_push_keeps_the_phone_town(self):
        st, a = await self.j("POST", "/api/settings", {"settings": {"clock": "12h"}})
        seen = a["updated"]
        await asyncio.sleep(0.01)
        await self.j("POST", "/api/settings", {"settings_patch": {"place": {"name": "Geelong", "lat": -38.15, "lon": 144.36}}})
        # the TV's copy, made before the phone's change, has no town and an old look
        st, b = await self.j("POST", "/api/settings", {"settings": {"clock": "24h"}, "seen": seen})
        self.assertEqual(b["settings"]["place"]["name"], "Geelong")
        self.assertEqual(b["settings"]["clock"], "24h")
        self.assertEqual(sorted(b["kept"]), ["photos", "place"])
        # an up to date copy is taken whole
        st, c = await self.j("POST", "/api/settings", {"settings": {"clock": "24h"}, "seen": b["updated"]})
        self.assertNotIn("place", c["settings"])
        self.assertEqual(c["kept"], [])

    # ---- At home and widget settings: through the TV home

    async def tv_home(self, answer, rounds=40):
        """A stand-in TV home: asks its inbox and answers each change like app.js atHomeEdit."""
        for _ in range(rounds):
            st, box = await self.j("GET", "/api/phone/inbox?home=1")
            for e in box["edits"]:
                await self.j("POST", "/api/phone/done", {"id": e["id"], "result": answer(e["edit"])})
            await asyncio.sleep(0.05)

    async def test_note_reaches_the_tv_and_back(self):
        await self.j("POST", "/api/phone/view", {"athome": {"note": None, "lists": []}})
        got = []

        def answer(e):
            got.append(e)
            return {"ok": True, "athome": {"note": {"text": e["note"]["text"], "from": ""}, "lists": []}}
        tv = asyncio.ensure_future(self.tv_home(answer))
        st, j = await self.j("POST", "/api/athome", {"edit": {"note": {"text": "Dinner at 6", "from": "Mum"}}})
        tv.cancel()
        self.assertEqual((st, j["live"], j["athome"]["note"]["text"]), (200, True, "Dinner at 6"))
        self.assertEqual(got, [{"note": {"text": "Dinner at 6", "from": "Mum"}}])

    async def test_widget_set_and_design_apps_pass_through(self):
        await self.j("POST", "/api/phone/view", {"athome": {"design": {"on": True}}})
        got = []

        def answer(e):
            got.append(e)
            return {"ok": True, "athome": {"design": {"on": True, "widgets": []}}}
        tv = asyncio.ensure_future(self.tv_home(answer))
        st, j = await self.j("POST", "/api/athome", {"edit": {"widget_set": {"key": "w1|surf", "values": {"units": "ft"}}}})
        st2, j2 = await self.j("POST", "/api/athome", {"edit": {"design_apps": {"key": "a1|apps", "apps": ["netflix"]}}})
        tv.cancel()
        self.assertEqual((st, st2), (200, 200))
        self.assertEqual(got, [{"widget_set": {"key": "w1|surf", "values": {"units": "ft"}}}, {"design_apps": {"key": "a1|apps", "apps": ["netflix"]}}])

    async def test_tv_refusal_is_the_phone_error(self):
        await self.j("POST", "/api/phone/view", {"athome": {}})
        tv = asyncio.ensure_future(self.tv_home(lambda e: {"ok": False, "error": "That number is out of range."}))
        st, j = await self.j("POST", "/api/athome", {"edit": {"widget_set": {"key": "w|x", "values": {"n": 999}}}})
        tv.cancel()
        self.assertEqual((st, j["error"]), (400, "That number is out of range."))

    async def test_read_gives_the_tv_view(self):
        st, j = await self.j("GET", "/api/athome")
        self.assertEqual(j, {"ok": True, "live": False})
        view = {"note": None, "cal": {"host": "calendar.google.com"}, "design": {"on": False}}
        await self.j("POST", "/api/phone/view", {"athome": view})
        st, j = await self.j("GET", "/api/athome")
        self.assertEqual((j["live"], j["athome"]), (True, view))

    async def test_no_tv_home_waits_or_refuses(self):
        st, j = await self.j("POST", "/api/athome", {"edit": {"note": {"text": "Hi"}}})
        self.assertEqual((st, j["live"], j["queued"]), (200, False, True))
        for e in ({"lists": []}, {"guide": []}, {"widget_set": {"key": "a|b", "values": {}}}):
            st, j = await self.j("POST", "/api/athome", {"edit": e})
            self.assertEqual(st, 409, e)
        # the waiting note goes to the TV home when it opens
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual([e["edit"] for e in box["edits"]], [{"note": {"text": "Hi"}}])

    async def test_no_answer_in_time(self):
        await self.j("POST", "/api/phone/view", {"athome": {}})
        st, j = await self.j("POST", "/api/athome", {"edit": {"note": {"text": "Hi"}}})
        self.assertEqual(st, 400)
        self.assertIn("did not answer", j["error"])
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertEqual(box["edits"], [])   # taken back: never applied later behind the phone's back

    async def test_unknown_edit_key_refused(self):
        st, j = await self.j("POST", "/api/athome", {"edit": {"ask_key": "sk-123"}})
        self.assertEqual(st, 400)
        self.assertNotIn("sk-123", json.dumps(j))

    async def test_view_and_done_checked(self):
        st, j = await self.j("POST", "/api/phone/view", {"athome": "x"})
        self.assertEqual(st, 400)
        st, j = await self.j("POST", "/api/phone/view", {"athome": {"note": "x" * 300000}})
        self.assertEqual(st, 413)
        st, j = await self.j("POST", "/api/phone/done", {"id": "1", "result": {}})
        self.assertEqual(st, 400)
        st, j = await self.j("POST", "/api/phone/done", {"id": 99, "result": {"ok": True}})
        self.assertEqual((st, j["taken"]), (200, False))

    async def test_phone_page_makes_the_tv_ask_fast(self):
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertFalse(box["fast"])
        await self.j("GET", "/api/athome")
        st, box = await self.j("GET", "/api/phone/inbox?home=1")
        self.assertTrue(box["fast"])

    # ---- photos

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_photo_made_screen_size_and_listed(self):
        r = await self.client.post("/api/photos", data=jpeg(4000, 3000), headers={**self.H, "Content-Type": "image/jpeg"})
        self.assertEqual(r.status, 200)
        j = await r.json()
        self.assertRegex(j["photo"]["file"], r"^bridge[a-z0-9]+\.jpg$")
        self.assertEqual(j["count"], 1)
        path = os.path.join(self.data, "photos", j["photo"]["file"])
        self.assertEqual(Image.open(path).size, (1440, 1080))
        st, s = await self.j("GET", "/api/settings")
        self.assertEqual(s["settings"]["photos"], [j["photo"]])
        # shown only with the key: the header (the phone page fetches it) or ?key= (the TV home's picture)
        r = await self.client.get("/api/photo/" + j["photo"]["file"])
        self.assertEqual(r.status, 401)
        r = await self.client.get("/api/photo/" + j["photo"]["file"] + "?key=" + KEY)
        self.assertEqual((r.status, r.headers["Content-Type"]), (200, "image/jpeg"))
        r = await self.client.get("/api/photo/" + j["photo"]["file"], headers=self.H)
        self.assertEqual(r.status, 200)
        r = await self.client.get("/api/photo/..%2Fsettings.default.json?key=" + KEY)
        self.assertEqual(r.status, 404)
        # never a cookie (Fable 11: a cookie goes to every web service on this computer)
        for p in ("/api/photo/" + j["photo"]["file"], "/api/settings"):
            r = await self.client.get(p, cookies={"couchtv_token": KEY})
            self.assertEqual(r.status, 401, p)
        # removed: off the list, the file deleted
        st, k = await self.j("POST", "/api/photos/remove", {"id": j["photo"]["id"]})
        self.assertEqual((st, k["count"]), (200, 0))
        self.assertFalse(os.path.exists(path))
        st, k = await self.j("POST", "/api/photos/remove", {"id": j["photo"]["id"]})
        self.assertEqual(st, 404)

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_photo_turned_and_portrait(self):
        b = io.BytesIO()
        img = Image.new("RGB", (4000, 3000))
        ex = Image.Exif()
        ex[0x0112] = 6   # the camera's note: turn it 90 degrees
        ex.get_ifd(0x8769)[0x9003] = "2026:01:26 09:30:00"
        img.save(b, "JPEG", exif=ex)
        r = await self.client.post("/api/photos", data=b.getvalue(), headers={**self.H, "Content-Type": "image/jpeg"})
        j = await r.json()
        out = Image.open(os.path.join(self.data, "photos", j["photo"]["file"]))
        self.assertEqual(out.size, (1080, 1440))
        self.assertEqual(out.getexif().get_ifd(0x8769).get(0x9003), "2026:01:26 09:30:00")   # for On this day

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_not_a_photo_and_too_many_pixels(self):
        r = await self.client.post("/api/photos", data=b"hello, not a picture", headers={**self.H, "Content-Type": "image/jpeg"})
        self.assertEqual(r.status, 415)
        b = io.BytesIO()
        Image.new("1", (12000, 9000)).save(b, "PNG")   # 108 megapixels in a small file
        r = await self.client.post("/api/photos", data=b.getvalue(), headers={**self.H, "Content-Type": "image/png"})
        self.assertEqual(r.status, 413)
        self.assertEqual(os.listdir(phonepage.photo_dir(self.data)), [])

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_only_photo_formats(self):
        # Fable 1: PostScript (Pillow would run Ghostscript), PSD, TIFF, GIF, BMP are never opened
        eps = (b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n%%EndComments\n"
               b"newpath 0 0 moveto 10 10 lineto stroke\nshowpage\n%%EOF\n")
        def saved(fmt, mode="RGB"):
            b = io.BytesIO()
            Image.new(mode, (40, 30), (10, 20, 30)).save(b, fmt)
            return b.getvalue()
        psd = (b"8BPS\x00\x01" + b"\x00" * 6 + b"\x00\x03" + (30).to_bytes(4, "big") + (40).to_bytes(4, "big")
               + b"\x00\x08\x00\x03" + b"\x00" * 12 + b"\x00" * 3600)
        for name, raw in (("eps", eps), ("psd", psd), ("tiff", saved("TIFF")), ("gif", saved("GIF", "P")), ("bmp", saved("BMP"))):
            r = await self.client.post("/api/photos", data=raw, headers={**self.H, "Content-Type": "image/jpeg"})
            self.assertEqual(r.status, 415, name)
        self.assertEqual(os.listdir(phonepage.photo_dir(self.data)), [])
        for fmt in ("PNG", "WEBP", "JPEG"):
            r = await self.client.post("/api/photos", data=saved(fmt), headers={**self.H, "Content-Type": "image/png"})
            self.assertEqual(r.status, 200, fmt)

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_far_too_many_pixels_is_too_big_not_unreadable(self):
        # Fable 8: over 200 megapixels Pillow refuses it itself; that is still "too big" (413), not 415
        b = io.BytesIO()
        Image.new("1", (20000, 20000)).save(b, "PNG")   # 400 megapixels in a small file
        r = await self.client.post("/api/photos", data=b.getvalue(), headers={**self.H, "Content-Type": "image/png"})
        self.assertEqual(r.status, 413)
        self.assertIn("too big", (await r.json())["error"])

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_png_over_forty_megapixels_is_too_big(self):
        # N3: a PNG or WebP is decoded whole, so 40 megapixels at most (a JPEG keeps 100: it is decoded smaller)
        for size, want in (((7000, 7000), 413), ((6000, 6000), 200)):
            b = io.BytesIO()
            Image.new("1", size).save(b, "PNG")
            r = await self.client.post("/api/photos", data=b.getvalue(), headers={**self.H, "Content-Type": "image/png"})
            self.assertEqual(r.status, want, size)
            if want == 413:
                self.assertIn("40 megapixels", (await r.json())["error"])

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_big_jpeg_decoded_small(self):
        # Fable 8: a big JPEG is decoded at a fraction of its size (draft), and comes out screen size
        b = io.BytesIO()
        Image.new("RGB", (8000, 6000), (90, 120, 30)).save(b, "JPEG", quality=30)
        seen = []
        real = Image.Image.convert
        def spy(img, *a, **k):
            seen.append(img.size)
            return real(img, *a, **k)
        with patch.object(Image.Image, "convert", spy):
            r = await self.client.post("/api/photos", data=b.getvalue(), headers={**self.H, "Content-Type": "image/jpeg"})
        self.assertEqual(r.status, 200)
        self.assertTrue(seen and max(w for w, h in seen) <= 2000, seen)   # 8000 wide decoded at 1/4: 2000
        out = Image.open(os.path.join(self.data, "photos", (await r.json())["photo"]["file"]))
        self.assertEqual(out.size, (1440, 1080))

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_one_photo_decoded_at_a_time(self):
        # Fable 8: several uploads at once never decode together
        busy, most = [0], [0]
        real = phonepage.make_photo
        def slow(raw, data):
            busy[0] += 1
            most[0] = max(most[0], busy[0])
            try:
                time.sleep(0.15)
                return real(raw, data)
            finally:
                busy[0] -= 1
        with patch.object(phonepage, "make_photo", slow):
            rs = await asyncio.gather(*[self.client.post("/api/photos", data=jpeg(200, 100), headers={**self.H, "Content-Type": "image/jpeg"})
                                        for _ in range(4)])
        self.assertEqual([r.status for r in rs], [200] * 4)
        self.assertEqual(most[0], 1)

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_photo_taken_off_on_the_tv_is_deleted(self):
        # Fable 12: the TV home's push without a photo deletes its file at once (not only at the next upload)
        r = await self.client.post("/api/photos", data=jpeg(300, 200), headers={**self.H, "Content-Type": "image/jpeg"})
        ph = (await r.json())["photo"]
        path = os.path.join(self.data, "photos", ph["file"])
        self.assertTrue(os.path.exists(path))
        st, s = await self.j("GET", "/api/settings")
        st, a = await self.j("POST", "/api/settings", {"settings": {"clock": "12h", "photos": [ph]}, "seen": s["updated"]})
        self.assertTrue(os.path.exists(path))   # still listed
        st, b = await self.j("POST", "/api/settings", {"settings": {"clock": "12h", "photos": []}, "seen": a["updated"]})
        self.assertEqual(b["settings"].get("photos") or [], [])
        self.assertFalse(os.path.exists(path))

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_older_tv_home_keeps_the_phone_photos(self):
        # Fable 12: a push with no "seen" (an older TV home) no longer empties the phone's photo list
        r = await self.client.post("/api/photos", data=jpeg(300, 200), headers={**self.H, "Content-Type": "image/jpeg"})
        ph = (await r.json())["photo"]
        st, a = await self.j("POST", "/api/settings", {"settings": {"clock": "24h", "photos": [{"id": "u1", "url": "https://example.com/a.jpg"}]}})
        self.assertEqual(st, 200)
        self.assertEqual([p["id"] for p in a["settings"]["photos"]], ["u1", ph["id"]])
        self.assertIn("photos", a["kept"])
        self.assertTrue(os.path.exists(os.path.join(self.data, "photos", ph["file"])))

    @unittest.skipIf(Image is None, "Pillow is not installed")
    async def test_fifty_photos_at_most(self):
        store._write(os.path.join(self.data, "settings.%s.json" % server.DEFAULT_TV),
                     {"settings": {"photos": [{"id": "p%d" % i, "url": "https://example.com/%d.jpg" % i} for i in range(50)]}, "updated": "x"})
        r = await self.client.post("/api/photos", data=jpeg(100, 100), headers={**self.H, "Content-Type": "image/jpeg"})
        self.assertEqual(r.status, 409)


if __name__ == "__main__":
    unittest.main()
