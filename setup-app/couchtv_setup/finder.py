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


def scan(nets=None, wait=3.0):
    """Every likely TV: Google TV and Android TV by their own announcement (with the name the TV
    gives itself), plus anything with ADB open on 5555 (Fire TV and older Android TVs)."""
    found = {}
    with ThreadPoolExecutor(max_workers=3) as two:
        heard = two.submit(_browse, [ANDROID_REMOTE, ADB_CONNECT], wait)
        dial = two.submit(dial_names, 2.0)
        hosts = [(h, p) for n in (nets or home_networks()) for h in n.hosts() for p in SCAN_PORTS]
        with ThreadPoolExecutor(max_workers=96) as pool:
            results = list(pool.map(lambda hp: knock(*hp), hosts))
        knocks = [hp for hp, r in zip(hosts, results) if r == 0]
        heard_list = heard.result()   # raises the plain Local Network message when the Mac blocked it
        if not knocks and not heard_list and knocks_blocked(results):
            raise blocked(next(r for r in results if r))
        for r in heard_list:
            if not r.get("ip") or not is_home_address(r["ip"]):
                continue
            t = found.setdefault(r["ip"], {"ip": r["ip"], "name": None, "ports": [], "wireless_debugging": None})
            if r["service"] == ANDROID_REMOTE.rstrip(".").lower():
                t["name"] = r["name"]
            elif r["service"] == ADB_CONNECT.rstrip(".").lower():
                t["wireless_debugging"] = r["port"]
    for h, p in knocks:
        t = found.setdefault(str(h), {"ip": str(h), "name": None, "ports": [], "wireless_debugging": None})
        t["ports"].append(p)
    out = list(found.values())
    try:
        dial_found = dial.result()
    except Exception:
        dial_found = {}
    for t in out:
        t["announced"] = None if t["name"] else dial_found.get(t["ip"])
        t["adb_5555"] = 5555 in t["ports"]
        t["android"] = 6466 in t["ports"] or t["adb_5555"] or bool(t["wireless_debugging"]) or bool(t["name"])
    return sorted(out, key=lambda t: (t["name"] is None, socket.inet_aton(t["ip"])))


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
        m = re.search(r"<friendlyName>([^<]{1,60})</friendlyName>", body)
        if m and m.group(1).strip():
            names[ip] = m.group(1).strip()
    return names


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
