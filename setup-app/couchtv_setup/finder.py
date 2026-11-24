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
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import errors, mdns
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


def _primary_ip():
    """The address this computer uses to reach other networks. Connecting a UDP socket only picks a
    route: nothing is sent."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))   # a documentation address, never really reached
            return sock.getsockname()[0]
    except OSError:
        return None


def _listed_ips():
    if sys.platform == "win32":
        cmd, flags = ["ipconfig"], 0x08000000   # CREATE_NO_WINDOW
    else:
        cmd, flags = ["ifconfig"], 0
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=5, creationflags=flags).stdout
    except Exception:
        return []
    return re.findall(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b", out or "")


def home_networks():
    """The /24 home networks this computer is on, the one it uses first."""
    nets = []
    for raw in [_primary_ip()] + _listed_ips():
        try:
            ip = ipaddress.ip_address(raw)
        except (TypeError, ValueError):
            continue
        if ip.is_private and not ip.is_loopback and not ip.is_link_local and not str(ip).endswith(".0"):
            net = ipaddress.ip_network(f"{ip}/24", strict=False)
            if net not in nets:
                nets.append(net)
    return nets


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


def adb_handshake(ip, port=5555, timeout=1.5):
    """Says CONNECT and reads the reply header, then hangs up. It never sends a key or a command, so
    nothing happens on the TV. Used only to tell a real ADB port from anything else on 5555."""
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
            return is_adb_answer(got)
    except OSError:
        return False


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
    - "ready": ADB answers (5555 confirmed, or Wireless debugging on a TV this computer paired before);
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
        t["adb_5555"] = 5555 in t["ports"] and confirmed.get(ip, True)
        t["android"] = bool(t["remote"] or 6466 in t["ports"] or t["adb_5555"]
                            or t["wireless_debugging"] or t["pairing_port"])
        if t["cast"] and not (t["remote"] or t["adb_5555"] or t["wireless_debugging"] or t["pairing_port"]):
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
    out = [t for t in out if t["android"] or t["other"] or t["adb_5555"]]
    return sorted(out, key=lambda t: (order[t["status"]], socket.inet_aton(t["ip"])))


def friendly_name(t, known=None):
    """What the list calls a TV: the room the person gave it before ("Living room TV"), the name the
    TV gives itself, its model, then plain words. Never its address alone."""
    k = known or {}
    for v in (k.get("room"), t.get("name"), t.get("announced"), k.get("name"), t.get("model")):
        if v:
            return _clean(v)
    return "TV with debugging on" if t.get("adb_5555") else "Android TV"


def scan(nets=None, wait=3.0, confirm=True, known=None):
    """Every likely TV, by every way at once, merged by address (merge() says how): the TVs' own
    announcements (Android TV Remote, Cast, Wireless debugging, the pairing screen, plain ADB), a
    knock on 5555 and 6466 across this computer's /24, and DIAL names. An open 5555 is checked with
    adb_handshake() when confirm is on, so a printer on 5555 is not called a TV."""
    with ThreadPoolExecutor(max_workers=3) as two:
        heard = two.submit(_browse, SERVICES, wait)
        dial = two.submit(dial_names, 2.0)
        hosts = [(h, p) for n in (nets or home_networks()) for h in n.hosts() for p in SCAN_PORTS]
        with ThreadPoolExecutor(max_workers=96) as pool:
            results = list(pool.map(lambda hp: knock(*hp), hosts))
        knocks = [hp for hp, r in zip(hosts, results) if r == 0]
        heard_list = heard.result()   # raises the plain Local Network message when the Mac blocked it
        if not knocks and not heard_list and knocks_blocked(results):
            raise blocked(next(r for r in results if r))
    try:
        dial_found = dial.result()
    except Exception:
        dial_found = {}
    confirmed = {}
    if confirm:
        open_5555 = [str(h) for h, p in knocks if p == 5555]
        if open_5555:
            with ThreadPoolExecutor(max_workers=16) as pool:
                confirmed = dict(zip(open_5555, pool.map(adb_handshake, open_5555)))
    return merge(heard_list, knocks, dial_found, known, confirmed)


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
