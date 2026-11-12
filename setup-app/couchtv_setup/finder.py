# home_networks(), answers() and the /24 scan are adapted from couch-tv-setup by killy10o10
# (couchtv_setup/finder.py). MIT License, Copyright (c) 2026 killy10o10. See setup-app/THIRD-PARTY.md.
# The mDNS names, the Wireless debugging ports and look() (scripts/check-tv.py's knock) are couch-tv's.
"""Finds TVs on this Wi-Fi and says what each one is. It only asks and listens: it opens and closes
a connection to a few ports and hears what TVs announce, so nothing shows on any TV and nothing
changes.
"""
import ipaddress
import re
import socket
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import mdns

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


def answers(ip, port, timeout=0.5):
    try:
        with socket.create_connection((str(ip), port), timeout=timeout):
            return True
    except OSError:
        return False


def is_home_address(ip):
    """Only private home addresses are ever knocked on or connected to."""
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.version == 4 and a.is_private and not a.is_loopback and not a.is_link_local and not a.is_multicast


def scan(nets=None, wait=3.0):
    """Every likely TV: Google TV and Android TV by their own announcement (with the name the TV
    gives itself), plus anything with ADB open on 5555 (Fire TV and older Android TVs)."""
    found = {}
    with ThreadPoolExecutor(max_workers=3) as two:
        heard = two.submit(mdns.browse, [ANDROID_REMOTE, ADB_CONNECT], wait)
        dial = two.submit(dial_names, 2.0)
        hosts = [(h, p) for n in (nets or home_networks()) for h in n.hosts() for p in SCAN_PORTS]
        with ThreadPoolExecutor(max_workers=96) as pool:
            knocks = [hp for hp, ok in zip(hosts, pool.map(lambda hp: answers(*hp), hosts)) if ok]
        for r in heard.result():
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
        open_ = {p: ok for p, ok in zip(PORTS, pool.map(lambda p: answers(ip, p, 1.0), PORTS))}
    kinds = {PORTS[p] for p, ok in open_.items() if ok}
    android = "adb" in kinds or "android_remote" in kinds
    if not android:
        heard = [r for r in mdns.browse([ADB_CONNECT], 2.5) if r.get("ip") == ip]
        android = bool(heard)
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
    return {"ip": ip, "kind": kind, "adb_5555": open_.get(5555, False),
            "android_remote": open_.get(6466, False) or open_.get(6467, False)}


def pairing_port(ip, wait=3.0):
    """The port of "Pair device with pairing code" while that screen is open on the TV, or None."""
    for r in mdns.browse([ADB_PAIRING], wait):
        if r.get("ip") == ip:
            return r["port"]
    return None


def connect_port(ip, wait=3.0):
    """The Wireless debugging port the TV announces, or None."""
    for r in mdns.browse([ADB_CONNECT], wait):
        if r.get("ip") == ip:
            return r["port"]
    return None
