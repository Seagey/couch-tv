# home_networks(), answers() and the /24 scan are adapted from couch-tv-setup by killy10o10
# (couchtv_setup/finder.py). MIT License, Copyright (c) 2026 killy10o10. See setup-app/THIRD-PARTY.md.
# The mDNS names, the Wireless debugging ports and look() (scripts/check-tv.py's knock) are couch-tv's.
"""Finds TVs on this Wi-Fi and says what each one is. It only asks and listens: it opens and closes
a connection to a few ports and hears what TVs announce, so nothing shows on any TV and nothing
changes.
"""
import ipaddress
import json
import re
import socket
import struct
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import errors, mdns, netinfo
from .tv import TvError

ANDROID_REMOTE = "_androidtvremote2._tcp.local."
ADB_CONNECT = "_adb-tls-connect._tcp.local."
ADB_PAIRING = "_adb-tls-pairing._tcp.local."
ADB_PLAIN = "_adb._tcp.local."
GOOGLECAST = "_googlecast._tcp.local."
SCAN_PORTS = (5555, 6466)

PORTS = {
    5555: "adb", 6466: "android_remote", 6467: "android_remote",
    8001: "samsung", 8002: "samsung", 3000: "lg", 3001: "lg", 8060: "roku", 8009: "cast",
}


_primary_ip = netinfo.primary_ip
MAX_HOME_NETWORKS = 4
SMALLEST_PREFIX = 22   # the biggest network scanned is a /22 (1022 addresses)


def network_for(ip, prefix):
    """The network to scan for one address of this computer: its own netmask (a /24 when the system did
    not say), never bigger than a /22, nothing for a single-address or point-to-point link, and nothing
    when the "address" is the network or broadcast address itself."""
    try:
        addr = ipaddress.ip_address(ip)
    except (TypeError, ValueError):
        return None
    if addr.version != 4 or not addr.is_private or addr.is_loopback or addr.is_link_local:
        return None
    prefix = 24 if prefix is None else max(int(prefix), SMALLEST_PREFIX)
    if prefix > 30:
        return None
    net = ipaddress.ip_network(f"{addr}/{prefix}", strict=False)
    if addr in (net.network_address, net.broadcast_address):
        return None
    return net


def home_networks():
    """The home networks this computer is on, the one it uses first: each with its own netmask, capped
    at a /22, private ranges only. (The broadcast address in the interface listing is never read as an
    address of this computer, so a /22 is scanned whole and not as 4.x and 7.x.)"""
    nets = []
    for ip, prefix in netinfo.interfaces():
        net = network_for(ip, prefix)
        if net is None or any(net.subnet_of(n) for n in nets):
            continue
        nets = [n for n in nets if not n.subnet_of(net)] + [net]
    return nets[:MAX_HOME_NETWORKS]


def knock(ip, port, timeout=0.5):
    """0 when the address answers on that port, otherwise the error (an OSError with `dest` set)."""
    try:
        with socket.create_connection((str(ip), port), timeout=timeout):
            return 0
    except OSError as e:
        e.dest = str(ip)
        return e


def answers(ip, port, timeout=0.5):
    return knock(ip, port, timeout) == 0


def blocked(exc):
    """The page's plain words for this computer blocking the app from the home network."""
    return TvError(errors.blocked_message(), errors.LOCAL_NETWORK_CODE, errors.detail(exc))


def _browse(services, wait):
    """mdns.browse, but a Local Network block becomes the plain message; any other send failure just
    means nothing was heard."""
    try:
        return mdns.browse(services, wait)
    except OSError as e:
        if errors.is_local_network_block(e):
            raise blocked(e) from e
        return []


def is_home_address(ip):
    """Only private home addresses are ever knocked on or connected to."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.version == 4 and a.is_private and not a.is_loopback and not a.is_link_local and not a.is_multicast


def knocks_blocked(results, share=0.9):
    """True when nearly every knock on the home network failed at once with "No route to host" or
    "Operation not permitted" while the internet route is there: what a Mac does with Local Network
    switched off. A TV that is off times out instead, and a computer that is on but closed refuses."""
    fails = [r for r in results if r]
    if len(fails) < 4:
        return False
    hits = [r for r in fails if getattr(r, "errno", None) in errors.BLOCK_ERRNOS]
    return len(hits) >= share * len(fails) and errors.has_default_route()


SERVICES = [ANDROID_REMOTE, GOOGLECAST, ADB_CONNECT, ADB_PAIRING, ADB_PLAIN]
_SVC = {s: s.rstrip(".").lower() for s in SERVICES}

# ---- is it really ADB on 5555? (only reads the TV's first answer; nothing shows on the TV) ----

A_CNXN, A_AUTH, A_STLS = 0x4E584E43, 0x48545541, 0x534C5453


def cnxn_packet():
    """The first message any ADB client sends: CONNECT, version 0x01000001, 256 KB, "host::". It holds
    no key, so the TV never asks "Allow USB debugging?" because of it."""
    import struct
    payload = b"host::\x00"
    return struct.pack("<6I", A_CNXN, 0x01000001, 256 * 1024, len(payload), sum(payload) & 0xFFFFFFFF,
                       A_CNXN ^ 0xFFFFFFFF) + payload


def is_adb_answer(header):
    """True when the first 24 bytes back are an ADB message: AUTH (it wants a key), CNXN (it let us in,
    an emulator or a TV that remembers nothing) or STLS (it wants TLS). The magic must match."""
    import struct
    if len(header) < 24:
        return False
    cmd, _, _, length, _, magic = struct.unpack("<6I", header[:24])
    return cmd in (A_CNXN, A_AUTH, A_STLS) and magic == cmd ^ 0xFFFFFFFF and length <= 1 << 20


def _handshake_once(ip, port, timeout):
    """One try: "adb" (a real ADB answer), "other" (some other service answered), "eof" (it closed on us
    without a word) or "silent" (no answer in time, or the connection broke)."""
    try:
        with socket.create_connection((str(ip), port), timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(cnxn_packet())
            got = b""
            while len(got) < 24:
                part = s.recv(24 - len(got))
                if not part:
                    break
                got += part
            if not got:
                return "eof"
            return "adb" if is_adb_answer(got) else "other"
    except OSError:
        return "silent"


HANDSHAKE_TRIES = ((1.5, 0.0), (3.0, 0.4))   # (timeout, pause before it): a TV that was slow gets a second go


def adb_handshake(ip, port=5555, timeout=1.5, tries=None):
    """Says CONNECT and reads the reply header, then hangs up. It never sends a key or a command, so
    nothing happens on the TV. Used only to tell a real ADB port from anything else on 5555.
    True: it is ADB. False: something else answered (or it closed twice without a word). None: no
    answer either time, so nobody can say. A slow answer gets one more try."""
    seen = []
    for t, pause in (tries or ((timeout, 0.0),) + HANDSHAKE_TRIES[1:]):
        if pause:
            time.sleep(pause)
        r = _handshake_once(ip, port, t)
        seen.append(r)
        if r in ("adb", "other"):
            break
    if "adb" in seen:
        return True
    if "other" in seen or seen.count("eof") == len(seen):
        return False
    return None


def adb_serial(instance_label):
    """The serial in a Wireless debugging announcement ("adb-<serial>-<random>"), or None."""
    m = re.match(r"^adb-([A-Za-z0-9._:-]+?)-[A-Za-z0-9]{6}$", instance_label or "")
    return m.group(1) if m else None


def _clean(s, n=40):
    s = re.sub(r"[\x00-\x1f\x7f<>]", "", str(s or "")).strip()
    return s[:n] or None


def merge(heard, knocks, dial=None, known=None, confirmed=None):
    """One row per TV from everything heard, by address. Pure, so it is tested without a network.
    heard: mdns.browse records; knocks: [(ip, port)] that answered; dial: {ip: name};
    known: {ip: {"name", "kind", "route", "room"}} from earlier runs; confirmed: {ip: True/False} from
    adb_handshake. Each row says how far the TV is from ready:
    - "ready": ADB answers (5555 confirmed by adb_handshake, or Wireless debugging on a TV this computer paired before);
    - "code": the TV shows "Pair device with pairing code" right now (type the 6 numbers);
    - "pair": Wireless debugging is on, not paired with this computer yet;
    - "switch": the TV is there but debugging is off (1 step on the TV)."""
    dial, known, confirmed = dial or {}, known or {}, confirmed or {}
    rows = {}

    def row(ip):
        return rows.setdefault(ip, {"ip": ip, "name": None, "model": None, "ports": [], "wireless_debugging": None,
                                    "pairing_port": None, "serial": None, "remote": False, "cast": False})
    for r in heard:
        ip = r.get("ip")
        if not ip or not is_home_address(ip):
            continue
        t = row(ip)
        svc, txt = r.get("service"), r.get("txt") or {}
        if svc == _SVC[ANDROID_REMOTE]:
            t["remote"] = True
            t["name"] = t["name"] or _clean(r.get("name"))
        elif svc == _SVC[GOOGLECAST]:
            t["cast"] = True
            t["name"] = t["name"] or _clean(txt.get("fn"))
            t["model"] = t["model"] or _clean(txt.get("md"))
        elif svc == _SVC[ADB_CONNECT]:
            t["wireless_debugging"] = r.get("port")
            t["serial"] = t["serial"] or adb_serial(r.get("name"))
        elif svc == _SVC[ADB_PAIRING]:
            t["pairing_port"] = r.get("port")
        elif svc == _SVC[ADB_PLAIN]:
            if r.get("port") and r["port"] not in t["ports"]:
                t["ports"].append(r["port"])
    for h, p in knocks:
        t = row(str(h))
        if p not in t["ports"]:
            t["ports"].append(p)
    # a TV that only answered DIAL: listed when its maker says it is a TV system this app knows
    for ip, d in dial.items():
        if ip not in rows and is_home_address(ip) and other_platform(d):
            row(ip)
    out = []
    for ip, t in rows.items():
        k = known.get(ip) or {}
        d = dial.get(ip)
        d = d if isinstance(d, dict) else ({"name": d} if d else {})
        t["announced"] = None if t["name"] else _clean(d.get("name"))
        t["model"] = t["model"] or d.get("model")
        t["maker"] = d.get("maker")
        t["other"] = None if (t["remote"] or t["wireless_debugging"] or t["pairing_port"]) else other_platform(d)
        state = confirmed.get(ip, True)   # True: ADB. False: something else. None: nobody could say
        t["adb_5555"] = 5555 in t["ports"] and state is True
        # port 5555 open but the check got no answer: kept in the list, never Ready
        t["adb_unconfirmed"] = 5555 in t["ports"] and state is None
        t["android"] = bool(t["remote"] or 6466 in t["ports"] or t["adb_5555"] or t["adb_unconfirmed"]
                            or t["wireless_debugging"] or t["pairing_port"])
        if t["cast"] and not (t["remote"] or t["adb_5555"] or t["adb_unconfirmed"] or t["wireless_debugging"] or t["pairing_port"]):
            t["android"] = False   # a speaker or a plain Chromecast says Cast too; only a TV says more
        if t["other"]:
            t["android"] = False
        t["known"] = k or None
        t["label"] = friendly_name(t, k)
        if t["other"]:
            t["status"] = "other"   # found, but Couch TV cannot be put on it from this app yet
        elif t["adb_5555"] or (t["wireless_debugging"] and k.get("route") == "tls"):
            t["status"] = "ready"
        elif t["pairing_port"]:
            t["status"] = "code"
        elif t["wireless_debugging"]:
            t["status"] = "pair"
        else:
            t["status"] = "switch"
        out.append(t)
    order = {"ready": 0, "code": 1, "pair": 2, "switch": 3, "other": 4}
    out = [t for t in out if t["android"] or t["other"]]
    return sorted(out, key=lambda t: (order[t["status"]], socket.inet_aton(t["ip"])))


def friendly_name(t, known=None):
    """What the list calls a TV: the room the person gave it before ("Living room TV"), the name the
    TV gives itself, its model, then plain words. Never its address alone."""
    k = known or {}
    for v in (k.get("room"), t.get("name"), t.get("announced"), k.get("name"), t.get("model")):
        if v:
            return _clean(v)
    return "TV with debugging on" if t.get("adb_5555") else "Android TV"


KNOCK_WORKERS = 128     # sockets open at once while knocking; far under macOS's default of 256 open files
RETRY_TIMEOUT = 1.0     # the second knock waits twice as long as the first (0.5 s)
RETRY_MAX = 1024        # at most this many second knocks per scan (a /24 and a half)
SEEN_TTL = 30.0         # a TV that was found stays in the list this long after a scan misses it


def raise_fd_limit(want=1024):
    """Lets this program have up to `want` files open (a Mac starts at 256). Best effort; never fails."""
    try:
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        if soft < want:
            resource.setrlimit(resource.RLIMIT_NOFILE, (want if hard == resource.RLIM_INFINITY else min(want, hard), hard))
    except Exception:
        pass


def is_timeout(result):
    """True for a knock that got no answer in time (not for "refused" or "no route": those are answers)."""
    return isinstance(result, (socket.timeout, TimeoutError))


def retry_order(timed_out, hinted, own_ips=()):
    """The knocks to try again, the likeliest first: addresses something already pointed at (an earlier
    TV, an announcement), then this computer's own neighbourhood (same first three numbers), then the
    rest, never more than RETRY_MAX."""
    hinted = set(hinted)
    near = {ip.rsplit(".", 1)[0] for ip in own_ips if ip}

    def rank(hp):
        ip = str(hp[0])
        return 0 if ip in hinted else 1 if ip.rsplit(".", 1)[0] in near else 2
    return sorted(timed_out, key=rank)[:RETRY_MAX]


def scan_networks(nets):
    """The networks a scan may knock on: private, /22 or smaller. Anything else is left out."""
    out = []
    for n in nets:
        if n.version == 4 and n.is_private and n.prefixlen >= SMALLEST_PREFIX and n not in out:
            out.append(n)
    return out


def scan(nets=None, wait=3.0, confirm=True, known=None, on_partial=None, diag=None, hints=(), own_ips=None):
    """Every likely TV, by every way at once, merged by address (merge() says how): the TVs' own
    announcements (Android TV Remote, Cast, Wireless debugging, the pairing screen, plain ADB), a
    knock on 5555 and 6466 across this computer's networks, and DIAL names. A knock that times out is
    tried once more, slower. An open 5555 is checked with adb_handshake() (which tries twice) when
    confirm is on, so a printer on 5555 is not called a TV, and a TV that did not answer the check is
    listed but never Ready.
    on_partial(rows) is called as soon as the announcements are in (about `wait` seconds), before the
    knocking is finished. diag, a dict, is filled with what happened (the scan log is made from it).
    hints: addresses worth a second knock first (TVs seen before)."""
    d = diag if diag is not None else {}
    t0 = time.monotonic()
    raise_fd_limit()
    nets = scan_networks(nets if nets is not None else home_networks())
    known = known or {}
    d.update({"networks": [str(n) for n in nets], "mdns": {}, "knock": {}, "handshake": {}, "dial": 0})

    def heard_done(fut):
        if on_partial is None or fut.exception() is not None:
            return
        try:
            on_partial(merge(fut.result(), [], {}, known, {}))
        except Exception:
            pass

    def timed_browse():
        mdns.last_info.clear()
        try:
            return _browse(SERVICES, wait)
        finally:
            d["mdns"] = dict(mdns.last_info, seconds=round(time.monotonic() - t0, 2))

    with ThreadPoolExecutor(max_workers=3) as two:
        heard = two.submit(timed_browse)
        heard.add_done_callback(heard_done)
        dial = two.submit(dial_names, 2.0)
        wanted_hints = set(known) | set(hints)
        hosts = [(h, p) for n in nets for h in n.hosts() if is_home_address(str(h)) for p in SCAN_PORTS]
        hosts.sort(key=lambda hp: str(hp[0]) not in wanted_hints)   # stable: the likely ones answer first
        with ThreadPoolExecutor(max_workers=KNOCK_WORKERS) as pool:
            results = list(pool.map(lambda hp: knock(*hp), hosts))
            timed_out = [hp for hp, r in zip(hosts, results) if is_timeout(r)]
            heard_so_far = []
            if heard.done() and heard.exception() is None:
                heard_so_far = [r.get("ip") for r in heard.result()]
            own = (own_ips if own_ips is not None else [ip for ip, _ in netinfo.interfaces()]) if timed_out else []
            again = retry_order(timed_out, wanted_hints | set(heard_so_far), own)
            retry_results = list(pool.map(lambda hp: knock(hp[0], hp[1], RETRY_TIMEOUT), again))
        index = {hp: i for i, hp in enumerate(hosts)}
        recovered = []
        for hp, r in zip(again, retry_results):
            results[index[hp]] = r
            if r == 0:
                recovered.append(f"{hp[0]}:{hp[1]}")
        knocks = [hp for hp, r in zip(hosts, results) if r == 0]
        d["knock"] = {"hosts": len(hosts) // len(SCAN_PORTS), "first_timeouts": len(timed_out), "retried": len(again),
                      "found_on_retry": recovered, "hits": [f"{h}:{p}" for h, p in knocks]}
        heard_list = heard.result()   # raises the plain Local Network message when the Mac blocked it
        if not knocks and not heard_list and knocks_blocked(results):
            d["error"] = "local_network_blocked"
            raise blocked(next(r for r in results if r))
    try:
        dial_found = dial.result()
    except Exception:
        dial_found = {}
    d["dial"] = len(dial_found)
    confirmed = {}
    if confirm:
        open_5555 = [str(h) for h, p in knocks if p == 5555]
        if open_5555:
            with ThreadPoolExecutor(max_workers=16) as pool:
                confirmed = dict(zip(open_5555, pool.map(adb_handshake, open_5555)))
        d["handshake"] = {"tried": len(open_5555), "adb": [i for i, v in confirmed.items() if v is True],
                          "other": [i for i, v in confirmed.items() if v is False],
                          "no_answer": [i for i, v in confirmed.items() if v is None]}
    rows = merge(heard_list, knocks, dial_found, known, confirmed)
    d["tvs"] = [{"ip": t["ip"], "status": t["status"]} for t in rows]
    d["seconds"] = round(time.monotonic() - t0, 2)
    return rows


def stale_copy(row):
    """A TV from an earlier scan, shown again because a scan missed it: never Ready, never "type the
    code", only "look for it again". Everything that would start a setup is switched off."""
    t = dict(row)
    if t.get("status") != "other":
        t["status"] = "switch"
    t["adb_5555"] = False
    t["adb_unconfirmed"] = False
    t["pairing_port"] = None
    t["stale"] = True
    return t


STATUS_ORDER = {"ready": 0, "code": 1, "pair": 2, "switch": 3, "other": 4}


class Seen:
    """TVs recent scans found, kept SEEN_TTL seconds after a scan misses them, so one unlucky scan does
    not make a TV vanish and come back. A kept TV is marked stale and is never Ready."""

    def __init__(self, ttl=SEEN_TTL, clock=time.monotonic):
        self.ttl, self.clock, self.rows = ttl, clock, {}

    def ips(self):
        now = self.clock()
        return [ip for ip, (at, _) in self.rows.items() if now - at <= self.ttl]

    def apply(self, tvs):
        """Notes the TVs found now and returns them plus the ones seen within the last SEEN_TTL seconds."""
        now = self.clock()
        fresh = {t["ip"]: t for t in tvs}
        for ip, t in fresh.items():
            self.rows[ip] = (now, t)
        for ip in [ip for ip, (at, _) in self.rows.items() if now - at > self.ttl]:
            del self.rows[ip]
        out = list(tvs) + [stale_copy(r) for ip, (_, r) in self.rows.items() if ip not in fresh]
        return sorted(out, key=lambda t: (STATUS_ORDER.get(t["status"], 3), socket.inet_aton(t["ip"])))


DIAL_ST = "urn:dial-multiscreen-org:service:dial:1"


def dial_names(wait=2.0):
    """The friendly names TVs give themselves over DIAL (the cast-to-TV discovery a Fire TV answers, for
    one): {ip: name}. It asks once over SSDP and reads each answer's device description. Only asks."""
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\n"
           f"ST: {DIAL_ST}\r\n\r\n").encode()
    locations = {}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.3)
            sock.sendto(msg, ("239.255.255.250", 1900))
            end = time.time() + wait
            while time.time() < end:
                try:
                    data, src = sock.recvfrom(4096)
                except socket.timeout:
                    continue
                m = re.search(rb"(?im)^location:\s*(http://[^\r\n]+)", data)
                if m and is_home_address(src[0]):
                    locations[src[0]] = m.group(1).decode(errors="replace").strip()
    except OSError:
        return {}
    names = {}
    for ip, url in locations.items():
        try:
            if (re.match(r"http://([0-9.]+)[:/]", url) or [None, None])[1] != ip:
                continue   # the description must come from the address that answered
            with urllib.request.urlopen(url, timeout=2) as r:
                body = r.read(20000).decode(errors="replace")
        except Exception:
            continue
        d = dial_description(body)
        if d:
            names[ip] = d
    return names


def dial_description(body):
    """{"name", "maker", "model"} from a UPnP device description, or None without a friendly name."""
    def tag(t):
        m = re.search(rf"<{t}>([^<]{{1,80}})</{t}>", body or "")
        return _clean(m.group(1), 60) if m else None
    name = tag("friendlyName")
    if not name:
        return None
    return {"name": name, "maker": tag("manufacturer"), "model": tag("modelName")}


# TVs this app finds but cannot put Couch TV on: (word in the DIAL maker, platform key Studio uses).
OTHER_PLATFORMS = [("samsung", "Tizen"), ("lg electronics", "webOS"), ("roku", "Roku OS"), ("vidaa", "VIDAA")]


def other_platform(dial_entry):
    maker = ((dial_entry or {}).get("maker") or "").lower() if isinstance(dial_entry, dict) else ""
    for word, platform in OTHER_PLATFORMS:
        if word in maker:
            return platform
    return None


def look(ip):
    """What one address is, from the ports it answers on (scripts/check-tv.py's quick look)."""
    with ThreadPoolExecutor(max_workers=len(PORTS)) as pool:
        knocked = dict(zip(PORTS, pool.map(lambda p: knock(ip, p, 1.0), PORTS)))
    open_ = {p: r == 0 for p, r in knocked.items()}
    kinds = {PORTS[p] for p, ok in open_.items() if ok}
    android = "adb" in kinds or "android_remote" in kinds
    wireless = False
    if not android:
        heard = [r for r in _browse([ADB_CONNECT], 2.5) if r.get("ip") == ip]
        android = wireless = bool(heard)
        if not kinds and not heard and knocks_blocked(list(knocked.values()), share=1.0):
            raise blocked(next(iter(knocked.values())))
    if android:
        kind = "android"
    elif "samsung" in kinds:
        kind = "samsung"
    elif "lg" in kinds:
        kind = "lg"
    elif "roku" in kinds:
        kind = "roku"
    elif not kinds:
        kind = "silent"
    else:
        kind = "unknown"
    out = {"ip": ip, "kind": kind, "adb_5555": open_.get(5555, False),
           "android_remote": open_.get(6466, False) or open_.get(6467, False), "wireless_debugging": wireless}
    out["android_version"] = cast_android_version(ip) if open_.get(8009) or open_.get(8008) else None
    out["route"] = route_hint(out)
    return out


# ---- which way in this TV needs, before anything is switched on ----

SDK_TO_ANDROID = {28: "9", 29: "10", 30: "11", 31: "12", 32: "12", 33: "13", 34: "14", 35: "15", 36: "16"}
_VERSION_KEYS = ("android_version", "os_version", "platform_version", "build_version_release")
_SDK_KEYS = ("sdk_version", "sdk_int", "android_sdk", "api_level")


def android_from_cast_info(info):
    """The Android version from the TV's Cast info (port 8008, /setup/eureka_info), only when a field
    says it outright: a key named for the Android or OS version, or the SDK level. Cast's own build
    numbers (cast_build_revision, system_build_number) are not Android versions and are ignored.
    None when nothing says it, which is the usual answer: then the page shows both ways."""
    if not isinstance(info, dict):
        return None
    found = []

    def walk(d, depth=0):
        if depth > 3 or not isinstance(d, dict):
            return
        for k, v in d.items():
            key = str(k).lower()
            if key in _VERSION_KEYS and isinstance(v, (str, int)) and re.fullmatch(r"\d{1,2}(\.\d{1,2}){0,2}", str(v).strip()):
                found.append(str(v).strip().split(".")[0])
            elif key in _SDK_KEYS and str(v).strip().isdigit() and int(str(v).strip()) in SDK_TO_ANDROID:
                found.append(SDK_TO_ANDROID[int(str(v).strip())])
            elif isinstance(v, dict):
                walk(v, depth + 1)
    walk(info)
    versions = {v for v in found if 5 <= int(v) <= 20}
    return versions.pop() if len(versions) == 1 else None


def cast_android_version(ip, timeout=1.5):
    """Reads the TV's own Cast info (only asks, nothing shows on the TV). See android_from_cast_info."""
    if not is_home_address(ip):
        return None
    try:
        url = f"http://{ip}:8008/setup/eureka_info?params=build_info,device_info,name"
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return android_from_cast_info(json.loads(r.read(65536).decode("utf-8", "replace")))
    except Exception:
        return None


def route_hint(r):
    """How a Google TV or Android TV will let this computer in, from what it already shows before any
    pairing:
    - "allow": it already answers on port 5555, so it can ask "Allow USB debugging?" straight away;
    - "pair": it announces Wireless debugging, or says it runs Android 12 or newer (a 6 number code);
    - "usb": it says Android 11 or older (USB debugging, then the Allow question over Wi-Fi);
    - "unknown": the page shows both ways and the person picks from what Developer options shows."""
    if r.get("adb_5555"):
        return "allow"
    if r.get("wireless_debugging"):
        return "pair"
    v = r.get("android_version")
    if v and str(v).isdigit():
        return "pair" if int(v) >= 12 else "usb"
    return "unknown"


def pairing_port(ip, wait=3.0):
    """The port of "Pair device with pairing code" while that screen is open on the TV, or None."""
    for r in _browse([ADB_PAIRING], wait):
        if r.get("ip") == ip:
            return r["port"]
    return None


def connect_port(ip, wait=3.0):
    """The Wireless debugging port the TV announces, or None."""
    for r in _browse([ADB_CONNECT], wait):
        if r.get("ip") == ip:
            return r["port"]
    return None
