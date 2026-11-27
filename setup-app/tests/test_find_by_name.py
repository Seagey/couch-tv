"""Setup finds a TV by its name (or serial), not the address it had last time, and a TV asleep in standby gets
plain words with a retry (the TCL that left the Wi-Fi in standby on 24 and 28 Nov 2026, and came back on another
address). All with fakes: no network, no TV. Addresses use 192.0.2.x so the privacy scan stays quiet."""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

from couchtv_setup import errors, finder, paths, server  # noqa: E402
from couchtv_setup.tv import TvError  # noqa: E402

OLD, NEW, OTHER = "192.0.2.56", "192.0.2.77", "192.0.2.90"
WEB = os.path.join(os.path.dirname(server.__file__), "web")


def heard(service, addr, name, port=None, txt=None):
    return {"service": service.rstrip(".").lower(), "ip": addr, "port": port, "name": name, "txt": txt or {}}


class KnownByName(unittest.TestCase):
    def test_a_tv_on_a_new_address_is_known_by_the_name_it_announces(self):
        known = {OLD: {"name": "TCL 55C735", "kind": "google", "room": "Spare bedroom", "heard": "TCL Smart TV"}}
        rows = finder.merge([heard(finder.ANDROID_REMOTE, NEW, "TCL Smart TV")], [], {}, known, {})
        self.assertEqual(rows[0]["label"], "Spare bedroom")
        self.assertEqual(rows[0]["moved_from"], OLD)
        self.assertEqual(rows[0]["known"]["kind"], "google")

    def test_the_serial_wins_over_the_name(self):
        sid = finder.serial_id("ABC123")
        known = {OLD: {"room": "Lounge", "heard": "Android TV", "sid": sid},
                 OTHER: {"room": "Study", "heard": "Android TV", "sid": finder.serial_id("ZZZ")}}
        rec = heard(finder.ADB_CONNECT, NEW, "adb-ABC123-a1b2c3", port=37000)
        rows = finder.merge([rec, heard(finder.ANDROID_REMOTE, NEW, "Android TV")], [], {}, known, {})
        self.assertEqual((rows[0]["label"], rows[0]["moved_from"]), ("Lounge", OLD))

    def test_two_tvs_with_the_same_name_are_never_guessed(self):
        known = {OLD: {"room": "Lounge", "heard": "Android TV"}, OTHER: {"room": "Study", "heard": "Android TV"}}
        rows = finder.merge([heard(finder.ANDROID_REMOTE, NEW, "Android TV")], [], {}, known, {})
        self.assertIsNone(rows[0]["moved_from"])
        self.assertEqual(rows[0]["label"], "Android TV")

    def test_another_tv_on_the_old_address_does_not_take_its_room(self):
        known = {OLD: {"room": "Spare bedroom", "heard": "TCL Smart TV"}}
        rows = finder.merge([heard(finder.ANDROID_REMOTE, OLD, "Sony Bravia")], [], {}, known, {})
        self.assertEqual(rows[0]["label"], "Sony Bravia")
        self.assertIsNone(rows[0]["known"])

    def test_an_old_record_with_no_name_still_works_by_address(self):
        known = {OLD: {"name": "TCL TV", "room": "Lounge"}}
        rows = finder.merge([], [(OLD, 5555)], {}, known, {OLD: True})
        self.assertEqual((rows[0]["label"], rows[0]["moved_from"]), ("Lounge", None))


class Asleep(unittest.TestCase):
    def test_a_recent_tv_not_found_is_named_as_asleep(self):
        now = time.time()
        known = {OLD: {"room": "Spare bedroom", "kind": "google", "at": now - 3600},
                 OTHER: {"room": "Old flat", "kind": "google", "at": now - 90 * 86400},
                 "192.0.2.91": {"name": "Samsung", "kind": "samsung", "at": now}}
        self.assertEqual(finder.asleep([], known, now), [{"label": "Spare bedroom", "ip": OLD}])

    def test_a_tv_found_on_a_new_address_is_not_asleep(self):
        now = time.time()
        known = {OLD: {"room": "Spare bedroom", "heard": "TCL Smart TV", "at": now}}
        rows = finder.merge([heard(finder.ANDROID_REMOTE, NEW, "TCL Smart TV")], [], {}, known, {})
        self.assertEqual(finder.asleep(rows, known, now), [])


class Records(unittest.TestCase):
    def setUp(self):
        self.file = paths.data() / "known-tvs.json"
        self.file.write_text("{}", encoding="utf-8")

    def test_the_same_tv_on_a_new_address_keeps_its_room(self):
        server._remember(OLD, {"name": "TCL 55C735", "kind": "google"}, route="tcp", key="K1", heard="TCL Smart TV",
                         sid="s1")
        server._remember(OLD, room="Spare bedroom")
        server._remember(NEW, {"name": "TCL 55C735", "kind": "google"}, route="tcp", key="K1", heard="TCL Smart TV")
        k = json.loads(self.file.read_text(encoding="utf-8"))
        self.assertNotIn(OLD, k)
        self.assertEqual((k[NEW]["room"], k[NEW]["sid"], k[NEW]["heard"]), ("Spare bedroom", "s1", "TCL Smart TV"))

    def test_a_scan_moves_the_record_with_the_tv(self):
        self.file.write_text(json.dumps({OLD: {"room": "Lounge", "heard": "TCL Smart TV", "kind": "google"}}),
                             encoding="utf-8")
        server._moved([{"ip": NEW, "moved_from": OLD}])
        k = json.loads(self.file.read_text(encoding="utf-8"))
        self.assertEqual(list(k), [NEW])
        self.assertEqual(k[NEW]["room"], "Lounge")

    def test_the_scan_answer_lists_asleep_tvs(self):
        self.file.write_text(json.dumps({OLD: {"room": "Spare bedroom", "kind": "google", "at": time.time()}}),
                             encoding="utf-8")
        server.S.job = {"running": False}
        server.S.tv_seen = finder.Seen()
        with mock.patch.object(server.finder, "scan", lambda **kw: []), mock.patch.object(server.scanlog, "write", lambda d: None):
            server.api("POST", "/api/scan", {})
            end = time.monotonic() + 10
            while server.S.job.get("running") and time.monotonic() < end:
                threading.Event().wait(0.01)
        self.assertEqual(server.S.job["result"]["asleep"], [{"label": "Spare bedroom", "ip": OLD}])


class Words(unittest.TestCase):
    def test_the_asleep_words_tell_a_beginner_what_to_do(self):
        for part in ("asleep", "TV remote", "home screen", "same Wi-Fi", "Find my TV again"):
            self.assertIn(part, errors.ASLEEP)
        self.assertNotIn("—", errors.ASLEEP)
        self.assertNotIn("–", errors.ASLEEP)

    def test_a_tv_timeout_says_asleep_but_an_internet_one_does_not(self):
        e = socket.timeout()
        e.dest = OLD
        self.assertEqual(errors.explain(e, default_route=True)[0], errors.ASLEEP)
        w = socket.timeout()
        w.dest = "8.8.8.8"
        self.assertNotEqual(errors.explain(w, default_route=True)[0], errors.ASLEEP)

    def test_a_silent_tv_is_asleep_but_a_refusing_one_has_its_switch_off(self):
        import errno
        self.assertTrue(finder.went_quiet(socket.timeout()))
        self.assertTrue(finder.went_quiet(OSError(errno.EHOSTDOWN, "Host is down")))
        self.assertFalse(finder.went_quiet(ConnectionRefusedError(errno.ECONNREFUSED, "refused")))

    def test_connecting_to_a_sleeping_tv_says_asleep_not_switch_debugging_on(self):
        server.S.job = {"running": False}
        with mock.patch.object(server.finder, "knock", lambda *a, **k: socket.timeout()), \
                mock.patch.object(server.errors, "is_local_network_block", lambda *a, **k: False):
            server.api("POST", "/api/connect", {"ip": OLD})
            end = time.monotonic() + 10
            while server.S.job.get("running") and time.monotonic() < end:
                threading.Event().wait(0.01)
        self.assertEqual((server.S.job.get("code"), server.S.job.get("error")), ("timeout", errors.ASLEEP), server.S.job)

    def test_no_tv_and_a_lost_tv_offer_find_again(self):
        server.S.tv = None
        with self.assertRaises(TvError) as c:
            server.need_tv()
        self.assertEqual((str(c.exception), c.exception.code), (errors.ASLEEP, "no_tv"))
        js = open(os.path.join(WEB, "app.js"), encoding="utf-8").read()
        self.assertIn('{ lost: 1, no_tv: 1, timeout: 1 }[e.code]', js)
        html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
        self.assertIn('id="error-find"', html)
        self.assertIn("Turn the TV on with the TV remote.", html)


if __name__ == "__main__":
    unittest.main()
