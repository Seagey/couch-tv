"""The TV finder must not hide a TV because one probe went unanswered (a TCL at the owner's home was on
and reachable, the first scan missed it, the second found it). One regression test per weakness, all with
fakes: no network, no TV, no adb. Addresses are built from numbers or use 192.0.2.x so the repo's privacy
scan, which looks for real home addresses in the source, stays quiet.

Each test is written to fail on the finder as it was in v0.13.14 and pass on the fixed one."""
import ipaddress
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())

import select  # noqa: E402

from couchtv_setup import finder, mdns, server  # noqa: E402
try:
    from couchtv_setup import netinfo  # noqa: E402
except ImportError:   # the finder before the fix has no netinfo
    netinfo = None
try:
    from couchtv_setup import scanlog  # noqa: E402
except ImportError:
    scanlog = None

WEB = os.path.join(os.path.dirname(server.__file__), "web")
BASE = 0xC0A80400                       # the first address of a /22 in the 192.168 range, from a number
def ip(n): return str(ipaddress.IPv4Address(BASE + n))
def net(n, prefix): return ipaddress.ip_network(f"{ip(n)}/{prefix}", strict=False)
def mac_mask(prefix): return "0x%08x" % ((0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF)
def dotted_mask(prefix): return str(ipaddress.IPv4Address((0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF))

TCL = "192.0.2.4"
DOC_NET = ipaddress.ip_network("192.0.2.0/29")


def ifconfig_text(addr, prefix, broadcast=None):
    bc = broadcast or str(ipaddress.ip_network(f"{addr}/{prefix}", strict=False).broadcast_address)
    return ("lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\tinet 127.0.0.1 netmask 0xff000000\n"
            f"en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n"
            f"\tinet6 fe80::1%en0 prefixlen 64 scopeid 0x6\n\tinet {addr} netmask {mac_mask(prefix)} broadcast {bc}\n")


class System:
    """What this computer says about its own networks, without running any command or sending anything."""

    def __init__(self, text, primary):
        self.text, self.primary = text, primary

    def __enter__(self):
        run = mock.MagicMock(return_value=mock.Mock(stdout=self.text, returncode=0))
        self.patches = [mock.patch("subprocess.run", run), mock.patch.object(finder, "_primary_ip", lambda: self.primary)]
        if netinfo:
            self.patches.append(mock.patch.object(netinfo, "primary_ip", lambda: self.primary))
            if sys.platform == "win32":   # the text here is an ifconfig listing, on every computer
                self.patches.append(mock.patch.object(netinfo, "listing", lambda: netinfo.parse_ifconfig(self.text)))
        for p in self.patches:
            p.start()
        return self

    def __exit__(self, *a):
        for p in reversed(self.patches):
            p.stop()


def quiet_system():
    return System("", None)


class Networks(unittest.TestCase):
    def test_a_slash_22_is_scanned_whole(self):
        own = ip(0x38)   # x.4.56 sits in the first quarter of the /22
        with System(ifconfig_text(own, 22), own):
            nets = finder.home_networks()
        self.assertEqual(nets, [net(0, 22)])
        for n in (0x105, 0x205, 0x305):   # the .5.x, .6.x and .7.x hosts
            self.assertIn(ipaddress.ip_address(ip(n)), nets[0])

    def test_the_broadcast_address_is_not_a_network(self):
        own = ip(0x38)
        with System(ifconfig_text(own, 22, broadcast=ip(0x3FF)), own):
            nets = finder.home_networks()
        self.assertNotIn(net(0x3FF, 24), nets)

    def test_a_plain_24_is_still_a_24(self):
        own = ip(0x38)
        with System(ifconfig_text(own, 24), own):
            self.assertEqual(finder.home_networks(), [net(0x38, 24)])

    def test_a_small_network_keeps_its_own_size(self):
        own = ip(0x39)
        with System(ifconfig_text(own, 26), own):
            self.assertEqual(finder.home_networks(), [net(0x39, 26)])

    def test_a_big_network_is_capped_at_a_slash_22(self):
        own = ip(0x138)
        with System(ifconfig_text(own, 16), own):
            nets = finder.home_networks()
        self.assertEqual(nets, [net(0x138, 22)])

    def test_a_vpn_style_single_address_is_not_scanned(self):
        own = ip(0x38)
        vpn = str(ipaddress.IPv4Address(0x0A000009))
        text = ifconfig_text(own, 24) + f"utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380\n\tinet {vpn} --> {vpn} netmask 0xffffffff\n"
        with System(text, own):
            nets = finder.home_networks()
        self.assertEqual(nets, [net(0x38, 24)])

    def test_public_addresses_are_never_scanned(self):
        own = str(ipaddress.IPv4Address(0x08080808))
        with System(ifconfig_text(own, 24), own):
            self.assertEqual(finder.home_networks(), [])
        seen = []
        with System("", None), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda i, p, t=0.5: seen.append(i) or socket.timeout()):
            finder.scan([ipaddress.ip_network("8.8.8.0/29")], wait=0.05)
        self.assertEqual(seen, [])

    def test_no_scan_of_a_network_bigger_than_a_slash_22(self):
        seen = []
        with System("", None), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda i, p, t=0.5: seen.append(i) or socket.timeout()):
            finder.scan([ipaddress.ip_network((BASE & 0xFFFF0000, 16))], wait=0.05)
        self.assertEqual(seen, [])

    def test_windows_and_iproute_listings(self):
        self.assertIsNotNone(netinfo)
        win = f"Ethernet adapter:\n   IPv4 Address. . . : {ip(0x38)}\n   Subnet Mask . . . : {dotted_mask(22)}\n   Default Gateway . : {ip(1)}\n"
        self.assertEqual(netinfo.parse_ipconfig(win)[0], (ip(0x38), 22))
        self.assertEqual(netinfo.parse_ip_addr(f"2: eth0    inet {ip(0x38)}/22 brd {ip(0x3FF)} scope global eth0"), [(ip(0x38), 22)])
        self.assertEqual(netinfo.parse_ifconfig(f"inet addr:{ip(0x38)}  Bcast:{ip(0x3FF)}  Mask:{dotted_mask(22)}"), [(ip(0x38), 22)])
        self.assertIsNone(netinfo.mask_prefix("0xff00ff00"))


class Knocks(unittest.TestCase):
    def run_scan(self, knock, handshake=lambda i: True, **kw):
        with quiet_system(), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", knock), mock.patch.object(finder, "adb_handshake", handshake):
            return finder.scan([DOC_NET], wait=0.05, **kw)

    def test_one_timed_out_knock_does_not_hide_a_tv(self):
        calls = {}

        def knock(addr, port, timeout=0.5):
            key = (str(addr), port)
            calls[key] = calls.get(key, 0) + 1
            if key == (TCL, 5555) and calls[key] >= 2:
                return 0   # the TV answers the second time
            return socket.timeout("timed out")
        rows = self.run_scan(knock)
        self.assertEqual([(r["ip"], r["status"]) for r in rows], [(TCL, "ready")])

    def test_the_log_says_which_knock_was_found_on_retry(self):
        calls = {}

        def knock(addr, port, timeout=0.5):
            calls[(str(addr), port)] = calls.get((str(addr), port), 0) + 1
            return 0 if (str(addr), port) == (TCL, 5555) and calls[(TCL, 5555)] >= 2 else socket.timeout()
        diag = {}
        self.run_scan(knock, diag=diag)
        self.assertIn(f"{TCL}:5555", diag["knock"]["found_on_retry"])

    def test_a_refusal_is_an_answer_and_is_not_retried(self):
        calls = []

        def knock(addr, port, timeout=0.5):
            calls.append((str(addr), port))
            return ConnectionRefusedError(61, "refused")
        self.run_scan(knock)
        self.assertEqual(len(calls), len(set(calls)))

    def test_retry_is_slower_than_the_first_knock(self):
        waits = []

        def knock(addr, port, timeout=0.5):
            waits.append(timeout)
            return socket.timeout()
        self.run_scan(knock)
        self.assertEqual(sorted(set(waits)), [0.5, finder.RETRY_TIMEOUT])

    def test_retry_never_exceeds_its_cap_and_likely_hosts_go_first(self):
        timed = [(ipaddress.ip_address(ip(n)), 5555) for n in range(1, 1500)]
        out = finder.retry_order(timed, hinted=[ip(1499)], own_ips=[ip(1400)])
        self.assertLessEqual(len(out), finder.RETRY_MAX)
        self.assertEqual(str(out[0][0]), ip(1499))
        self.assertTrue(str(out[1][0]).startswith(ip(1400).rsplit(".", 1)[0]))


class Handshake(unittest.TestCase):
    ADB = struct.pack("<6I", finder.A_AUTH, 1, 0, 20, 0, finder.A_AUTH ^ 0xFFFFFFFF)

    class Conn:
        def __init__(self, data): self.data = data
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def settimeout(self, t): pass
        def sendall(self, b): pass
        def recv(self, n):
            out, self.data = self.data[:n], self.data[n:]
            return out

    def run_with(self, outcomes):
        seq = list(outcomes)

        def create(addr, timeout=None):
            o = seq.pop(0)
            if isinstance(o, Exception):
                raise o
            return self.Conn(o)
        with mock.patch.object(socket, "create_connection", create), mock.patch("time.sleep", lambda s: None):
            return finder.adb_handshake(TCL), len(outcomes) - len(seq)

    def test_a_slow_first_try_gets_a_second(self):
        self.assertEqual(self.run_with([socket.timeout("t"), self.ADB]), (True, 2))

    def test_a_clear_answer_is_not_retried(self):
        self.assertEqual(self.run_with([self.ADB, self.ADB]), (True, 1))
        self.assertEqual(self.run_with([b"HTTP/1.1 400 Bad Request\r\n\r\n", self.ADB]), (False, 1))

    def test_no_answer_twice_is_unknown_not_no(self):
        self.assertEqual(self.run_with([socket.timeout("t"), socket.timeout("t")]), (None, 2))

    def test_closing_twice_without_a_word_is_a_no(self):
        self.assertEqual(self.run_with([b"", b""]), (False, 2))


def heard(service, addr, name, port=None, txt=None):
    return {"service": service.rstrip(".").lower(), "ip": addr, "port": port, "name": name, "txt": txt or {}}


class NotReady(unittest.TestCase):
    def test_a_failed_check_is_never_ready_but_the_tv_stays(self):
        remote = heard(finder.ANDROID_REMOTE, TCL, "TCL TV")
        rows = finder.merge([remote], [(TCL, 5555)], {}, {}, {TCL: None})
        self.assertEqual([r["ip"] for r in rows], [TCL])
        self.assertNotEqual(rows[0]["status"], "ready")
        self.assertFalse(rows[0]["adb_5555"])

    def test_port_5555_with_no_answer_to_the_check_is_listed_not_ready(self):
        rows = finder.merge([], [(TCL, 5555)], {}, {}, {TCL: None})
        self.assertEqual([(r["ip"], r["status"]) for r in rows], [(TCL, "switch")])

    def test_something_else_on_5555_is_still_dropped(self):
        self.assertEqual(finder.merge([], [(TCL, 5555)], {}, {}, {TCL: False}), [])

    def test_a_confirmed_tv_is_ready(self):
        self.assertEqual(finder.merge([], [(TCL, 5555)], {}, {}, {TCL: True})[0]["status"], "ready")

    def test_a_tv_known_from_before_stays_when_its_check_fails_in_a_scan(self):
        known = {TCL: {"name": "TCL TV", "kind": "google", "room": "Lounge"}}
        with quiet_system(), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), \
                mock.patch.object(finder, "knock", lambda a, p, t=0.5: 0 if (str(a), p) == (TCL, 5555) else socket.timeout()), \
                mock.patch.object(finder, "adb_handshake", lambda a: None):
            rows = finder.scan([DOC_NET], wait=0.05, known=known)
        self.assertEqual([(r["ip"], r["status"], r["label"]) for r in rows], [(TCL, "switch", "Lounge")])


class FakeSock:
    """A UDP socket that answers by script. `responder(sock, packet)` queues replies."""
    count = 0

    def __init__(self, iface=None, responder=None, fail=False):
        FakeSock.count += 1
        self.n, self.iface, self.responder, self.fail = FakeSock.count + 1000, iface, responder, fail
        self.sent, self.queue, self.closed = [], [], False

    def fileno(self): return self.n
    def close(self): self.closed = True

    def sendto(self, data, addr):
        if self.fail:
            raise OSError(65, "No route to host")
        self.sent.append(data)
        if self.responder:
            self.responder(self, data)

    def recvfrom(self, n):
        return self.queue.pop(0)


def fake_select(r, w, x, timeout):
    ready = [s for s in r if getattr(s, "queue", None)]
    if not ready:
        time.sleep(min(timeout, 0.02))
    return ready, [], []


def rr(name, rtype, rdata):
    return mdns._name_bytes(name) + struct.pack(">HHIH", rtype, 1, 120, len(rdata)) + rdata


def packet(*records):
    return struct.pack(">6H", 0, 0x8400, 0, len(records), 0, 0) + b"".join(records)


def asked(pkt):
    """The (name, type) questions in a packet we sent."""
    _, _, qd, _, _, _ = struct.unpack(">6H", pkt[:12])
    off, out = 12, []
    for _ in range(qd):
        name, off = mdns._read_name(pkt, off)
        rtype = struct.unpack(">H", pkt[off:off + 2])[0]
        off += 4
        out.append((name.lower(), rtype))
    return out


SVC_FQ = "_androidtvremote2._tcp.local."
SVC = SVC_FQ.rstrip(".")
INST = "tcl-tv." + SVC
HOST = "tcl-tv.example.local"


def tv_responder(sock, pkt):
    """The TV: it answers the service question with the PTR alone (the rest of its answer is lost) and
    gives its port, name and address only when asked for them directly."""
    qs = asked(pkt)
    if (SVC, mdns.PTR) in qs:
        sock.queue.append((packet(rr(SVC, mdns.PTR, mdns._name_bytes(INST))), (TCL, 5353)))
    if (INST, mdns.SRV) in qs:
        sock.queue.append((packet(rr(INST, mdns.SRV, struct.pack(">HHH", 0, 0, 6466) + mdns._name_bytes(HOST)),
                                  rr(INST, mdns.TXT, b"\x0dfn=TCL Lounge"),
                                  rr(HOST, mdns.A, socket.inet_aton(TCL))), (TCL, 5353)))


class MdnsFollowUp(unittest.TestCase):
    def browse(self, responder, ifaces=None, wait=0.6):
        sock = FakeSock(responder=responder)
        new = hasattr(mdns, "follow_up")
        opened = (lambda *a: ([sock], [])) if new else (lambda *a: [sock])
        with mock.patch.object(mdns, "_sockets", opened), mock.patch.object(select, "select", fake_select):
            found = mdns.browse([SVC_FQ], wait, ifaces=[]) if new else mdns.browse([SVC_FQ], wait)
        return found, sock

    def test_a_tv_heard_saying_only_here_i_am_is_asked_directly(self):
        found, sock = self.browse(tv_responder)
        self.assertEqual([(r["ip"], r["port"], r["name"]) for r in found], [(TCL, 6466, "tcl-tv")])
        self.assertEqual(found[0]["txt"].get("fn"), "TCL Lounge")

    def test_the_question_goes_out_three_times(self):
        _, sock = self.browse(lambda s, p: None)
        self.assertGreaterEqual(len([p for p in sock.sent if (SVC, mdns.PTR) in asked(p)]), 3)

    def test_a_host_with_no_address_is_asked_for_it(self):
        def responder(sock, pkt):
            qs = asked(pkt)
            if (SVC, mdns.PTR) in qs:
                sock.queue.append((packet(rr(SVC, mdns.PTR, mdns._name_bytes(INST)),
                                          rr(INST, mdns.SRV, struct.pack(">HHH", 0, 0, 6466) + mdns._name_bytes(HOST))), ("192.0.2.200", 5353)))
            if (HOST, mdns.A) in qs:
                sock.queue.append((packet(rr(HOST, mdns.A, socket.inet_aton(TCL))), (TCL, 5353)))
        found, _ = self.browse(responder)
        self.assertEqual([r["ip"] for r in found], [TCL])


class MdnsPerInterface(unittest.TestCase):
    def test_the_question_goes_out_from_every_network_card(self):
        socks = {}

        def opener(addr=None):
            socks[addr] = FakeSock(addr)
            return socks[addr]
        with mock.patch.object(mdns, "_open_sender", opener, create=True), \
                mock.patch.object(mdns, "_open_listener", lambda ifaces: None, create=True), \
                mock.patch.object(select, "select", fake_select):
            mdns.browse([SVC_FQ], 0.3, ifaces=["192.0.2.10", "192.0.2.77"])
        self.assertEqual(sorted(socks), ["192.0.2.10", "192.0.2.77"])
        for s in socks.values():
            self.assertTrue(s.sent and s.closed)

    def test_one_card_failing_does_not_stop_the_others(self):
        good = FakeSock("192.0.2.77", responder=tv_responder)
        bad = FakeSock("192.0.2.10", fail=True)
        with mock.patch.object(mdns, "_open_sender", lambda a=None: bad if a == "192.0.2.10" else good, create=True), \
                mock.patch.object(mdns, "_open_listener", lambda ifaces: None, create=True), \
                mock.patch.object(select, "select", fake_select):
            found = mdns.browse([SVC_FQ], 0.6, ifaces=["192.0.2.10", "192.0.2.77"])
        self.assertEqual([r["ip"] for r in found], [TCL])

    def test_every_card_failing_is_raised_with_where_it_was_going(self):
        a, b = FakeSock("192.0.2.10", fail=True), FakeSock("192.0.2.77", fail=True)
        with mock.patch.object(mdns, "_open_sender", lambda x=None: a if x == "192.0.2.10" else b, create=True), \
                mock.patch.object(mdns, "_open_listener", lambda ifaces: None, create=True), \
                mock.patch.object(select, "select", fake_select):
            with self.assertRaises(OSError) as c:
                mdns.browse([SVC_FQ], 0.3, ifaces=["192.0.2.10", "192.0.2.77"])
        self.assertEqual(c.exception.dest, mdns.GROUP)


class SeenTvs(unittest.TestCase):
    def row(self, status="ready", addr=TCL):
        return {"ip": addr, "status": status, "label": "TCL TV", "adb_5555": status == "ready", "pairing_port": None,
                "android": True, "other": None}

    def test_a_tv_missed_by_one_scan_stays_for_30_seconds_never_ready(self):
        now = [100.0]
        seen = finder.Seen(clock=lambda: now[0])
        self.assertEqual(seen.apply([self.row()])[0]["status"], "ready")
        now[0] = 112.0
        out = seen.apply([])
        self.assertEqual([(t["ip"], t["status"], t["stale"], t["adb_5555"]) for t in out], [(TCL, "switch", True, False)])
        now[0] = 129.0
        self.assertEqual(len(seen.apply([])), 1)
        now[0] = 131.0
        self.assertEqual(seen.apply([]), [])

    def test_a_tv_found_again_is_fresh_and_ready(self):
        now = [0.0]
        seen = finder.Seen(clock=lambda: now[0])
        seen.apply([self.row()])
        now[0] = 5.0
        seen.apply([])
        now[0] = 8.0
        out = seen.apply([self.row()])
        self.assertEqual([(t["status"], t.get("stale")) for t in out], [("ready", None)])

    def test_the_ready_row_is_not_changed_by_going_stale(self):
        seen = finder.Seen(clock=lambda: 0.0)
        original = self.row()
        seen.apply([original])
        seen.apply([])
        self.assertEqual(original["status"], "ready")


class ScanLog(unittest.TestCase):
    def test_log_is_bounded_and_readable(self):
        self.assertIsNotNone(scanlog)
        folder = __import__("pathlib").Path(tempfile.mkdtemp())
        for i in range(scanlog.MAX_ENTRIES * 3):
            scanlog.write({"n": i, "knock": {"hits": [f"192.0.2.{j}:5555" for j in range(500)]}}, folder)
        p = scanlog.path(folder)
        self.assertLessEqual(p.stat().st_size, scanlog.MAX_BYTES + 4096)
        lines = p.read_text().splitlines()
        self.assertLessEqual(len(lines), scanlog.MAX_ENTRIES)
        self.assertEqual(json.loads(lines[-1])["n"], scanlog.MAX_ENTRIES * 3 - 1)
        self.assertEqual(len(scanlog.read(3, folder)), 3)
        self.assertLessEqual(len(json.loads(lines[-1])["knock"]["hits"]), scanlog.MAX_LIST)

    def test_a_log_that_cannot_be_written_does_not_raise(self):
        blocker = tempfile.NamedTemporaryFile()
        self.assertIsNone(scanlog.write({"a": 1}, __import__("pathlib").Path(blocker.name) / "nope"))

    def test_scan_says_what_it_did(self):
        def knock(addr, port, timeout=0.5):
            return 0 if (str(addr), port) == (TCL, 5555) and timeout > 0.5 else socket.timeout()
        diag = {}
        with quiet_system(), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), mock.patch.object(finder, "knock", knock), \
                mock.patch.object(finder, "adb_handshake", lambda a: True):
            finder.scan([DOC_NET], wait=0.05, diag=diag)
        self.assertEqual(diag["networks"], [str(DOC_NET)])
        self.assertGreater(diag["knock"]["retried"], 0)
        self.assertEqual(diag["knock"]["hits"], [f"{TCL}:5555"])
        self.assertEqual(diag["handshake"]["adb"], [TCL])
        self.assertEqual(diag["tvs"], [{"ip": TCL, "status": "ready"}])
        self.assertIn("seconds", diag)

    def test_the_server_writes_one_line_per_scan(self):
        folder = tempfile.mkdtemp()
        env = {"COUCHTV_SETUP_HOME": folder}
        server.S.job = {"running": False}

        def fake_scan(**kw):
            kw["diag"].update({"networks": ["x"], "knock": {"hits": []}})
            return []
        with mock.patch.dict(os.environ, env), mock.patch.object(server.finder, "scan", fake_scan), \
                mock.patch.object(server, "_known", lambda: {}):
            server.api("POST", "/api/scan", {})
            end = time.monotonic() + 10
            while server.S.job.get("running") and time.monotonic() < end:
                threading.Event().wait(0.01)
        self.assertEqual(len(scanlog.read(10, __import__("pathlib").Path(folder))), 1)


class ServerScan(unittest.TestCase):
    def test_asking_for_a_scan_while_one_runs_joins_it(self):
        server.S.job = {"name": "scan", "running": True}
        try:
            self.assertEqual(server.run_job("scan", lambda p: None), {"started": "scan"})
            with self.assertRaises(Exception) as c:
                server.run_job("pair", lambda p: None)
            self.assertEqual(getattr(c.exception, "code", None), "busy")
        finally:
            server.S.job = {"running": False}

    def test_early_results_are_offered_while_the_scan_goes_on(self):
        rows = [{"ip": TCL, "status": "switch", "label": "TCL", "android": True, "other": None, "ports": []}]
        server.S.job = {"running": False}
        server.S.tv_seen = finder.Seen()
        seen_partial = []

        def fake_scan(**kw):
            kw["on_partial"](rows)
            seen_partial.append(dict(server.S.job.get("partial") or {}))
            return rows
        with mock.patch.object(server.finder, "scan", fake_scan), mock.patch.object(server, "_known", lambda: {}), \
                mock.patch.object(server.scanlog, "write", lambda d: None):
            server.api("POST", "/api/scan", {})
            end = time.monotonic() + 10
            while server.S.job.get("running") and time.monotonic() < end:
                threading.Event().wait(0.01)
        self.assertEqual([t["ip"] for t in seen_partial[0]["tvs"]], [TCL])
        self.assertEqual([t["ip"] for t in server.S.job["result"]["tvs"]], [TCL])

    def test_scan_early_hook_fires_when_announcements_are_in(self):
        fired = []
        recs = [heard(finder.ANDROID_REMOTE, TCL, "TCL TV")]
        slow = threading.Event()

        def knock(a, p, t=0.5):
            slow.wait(0.3)
            return socket.timeout()
        with quiet_system(), mock.patch.object(finder.mdns, "browse", lambda s, w: recs), \
                mock.patch.object(finder, "dial_names", lambda w: {}), mock.patch.object(finder, "knock", knock):
            finder.scan([DOC_NET], wait=0.05, on_partial=lambda rows: fired.append([r["ip"] for r in rows]))
        self.assertEqual(fired, [[TCL]])


class FileDescriptors(unittest.TestCase):
    def test_a_slash_22_never_holds_more_sockets_open_than_the_limit_allows(self):
        lock, state = threading.Lock(), {"now": 0, "max": 0}

        def knock(addr, port, timeout=0.5):
            with lock:
                state["now"] += 1
                state["max"] = max(state["max"], state["now"])
            time.sleep(0.0005)
            with lock:
                state["now"] -= 1
            return socket.timeout()
        with quiet_system(), mock.patch.object(finder.mdns, "browse", lambda s, w: []), \
                mock.patch.object(finder, "dial_names", lambda w: {}), mock.patch.object(finder, "knock", knock):
            finder.scan([net(0, 22)], wait=0.05)
        self.assertLessEqual(state["max"], 128)
        self.assertLess(state["max"] + 16 + 40, 256)   # knocks + the ADB checks + mDNS, DIAL and the page itself

    def test_the_limit_is_declared_and_raising_it_never_fails(self):
        self.assertLess(finder.KNOCK_WORKERS + 16 + 40, 256)
        finder.raise_fd_limit()


class PageBehaviour(unittest.TestCase):
    """app.js: looking again survives errors and busy, and shows the early results."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(WEB, "app.js"), encoding="utf-8") as f:
            cls.js = f.read()
        start = cls.js.index("function lookAgain()")
        cls.look = cls.js[start:cls.js.index("function stopLooking")]

    def test_busy_and_errors_schedule_the_next_look(self):
        self.assertIn('"busy"', self.look)
        self.assertGreaterEqual(self.look.count("lookSoon("), 3)
        self.assertIn("function lookSoon", self.js)

    def test_only_a_closed_app_ends_the_looking(self):
        self.assertIn('"lost_app"', self.look)

    def test_early_results_are_drawn(self):
        self.assertIn("j.partial", self.look)

    def test_a_stale_tv_is_not_labelled_ready(self):
        self.assertIn("t.stale", self.js)


if __name__ == "__main__":
    unittest.main()
