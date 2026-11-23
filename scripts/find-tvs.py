#!/usr/bin/env python3
"""Look for Google TV, Android TV, LG and Philips devices on this Wi-Fi. Changes nothing.

    .venv/bin/python scripts/find-tvs.py [seconds]

Listens for the names TVs announce on the home network (mDNS) for a few seconds and prints one
line per device: its name, address, model (when it says), and what it offers:
  remote  = Android TV Remote protocol (the bridge uses this, option B)
  cast    = Google Cast (almost every Google TV, also many speakers and Chromecasts)
  adb     = Wireless debugging is switched on (Android 11 and newer, Developer options)
A TV that shows "remote" is a Google TV or Android TV. A "Cast device" only offers cast: it could
be a speaker, an older Chromecast or a Fire TV (check-tv.py tells them apart). A Cast device that
also answers on port 8001 is a Samsung TV and is listed as "Samsung TV" (docs/SAMSUNG.md).
A Philips TV announces the service its network remote uses (port 1926) and is listed as "Philips TV"
(docs/PHILIPS-TITAN.md). Only the announcement is read: nothing is sent to the TV.
LG TVs (webOS) answer a second question, the one LG's own phone app asks (SSDP, LG's "second
screen" service), and are listed as "LG TV" (docs/LG.md). Samsung and other TVs that do not run
Android are not listed at all.
"""
import re
import socket
import sys
import time
import urllib.request

try:
    from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
except ImportError:
    sys.exit("Needs zeroconf: .venv/bin/pip install -r bridge/requirements.txt")

SERVICES = {
    "_androidtvremote2._tcp.local.": "remote",
    "_googlecast._tcp.local.": "cast",
    "_adb-tls-connect._tcp.local.": "adb",
    "_philipstv_s_rpc._tcp.local.": "philips",
}


LG_ST = "urn:lge-com:service:webos-second-screen:1"


def find_lg(wait, target=("239.255.255.250", 1900)):
    """LG TVs on this network: {ip: friendly name or None}. One SSDP search, then each TV's own
    description page for its name. Only LG TVs answer this search."""
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\n"
           f"ST: {LG_ST}\r\nMX: 2\r\n\r\n").encode()
    found = {}
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    s.settimeout(0.5)
    try:
        s.sendto(msg, target)
        end = time.time() + wait
        while time.time() < end:
            try:
                data, (ip, _) = s.recvfrom(2048)
            except socket.timeout:
                continue
            text = data.decode(errors="ignore")
            if LG_ST.lower() not in text.lower() or ip in found:
                continue
            m = re.search(r"^location:\s*(\S+)", text, re.I | re.M)
            name = None
            if m:
                try:
                    with urllib.request.urlopen(m.group(1), timeout=2) as r:
                        n = re.search(r"<friendlyName>([^<]+)</friendlyName>", r.read(65536).decode(errors="ignore"))
                        name = n.group(1).strip() if n else None
                except Exception:
                    pass
            found[ip] = name
    finally:
        s.close()
    return found


def philips_name(instance):
    """"6_43PUS8909/12._philipstv_s_rpc._tcp.local." -> "43PUS8909/12" (the 6 is the API version)."""
    return re.sub(r"^\d+_", "", instance.split("._")[0])


class Found(ServiceListener):
    def __init__(self):
        self.devices = {}

    def add_service(self, zc, type_, name):
        info = zc.get_service_info(type_, name, timeout=2000)
        if not info:
            return
        addrs = [socket.inet_ntoa(a) for a in info.addresses if len(a) == 4]
        if not addrs:
            return
        props = {k.decode(errors="ignore"): (v or b"").decode(errors="ignore") for k, v in info.properties.items()}
        ip = addrs[0]
        d = self.devices.setdefault(ip, {"names": set(), "models": set(), "offers": set()})
        friendly = props.get("fn") or (philips_name(name) if SERVICES[type_] == "philips" else name.split("._")[0])
        d["names"].add(friendly)
        if props.get("md"):
            d["models"].add(props["md"])
        d["offers"].add(SERVICES[type_])

    def update_service(self, zc, type_, name):
        self.add_service(zc, type_, name)

    def remove_service(self, zc, type_, name):
        pass


def knock(ip, port, timeout=1.0):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def main():
    wait = float(sys.argv[1]) if len(sys.argv) > 1 else 6
    zc = Zeroconf()
    found = Found()
    for t in SERVICES:
        ServiceBrowser(zc, t, found)
    lgs = find_lg(wait)
    zc.close()
    tvs = {ip: d for ip, d in found.devices.items() if "remote" in d["offers"] or "adb" in d["offers"]}
    philips = {ip: d for ip, d in found.devices.items() if "philips" in d["offers"] and ip not in tvs}
    others = {ip: d for ip, d in found.devices.items() if ip not in tvs and ip not in philips}
    for ip in lgs:
        tvs.pop(ip, None)
        others.pop(ip, None)
        philips.pop(ip, None)
    # A Samsung (Tizen) TV shows up only as a "Cast device" here. It also answers on port 8001.
    samsungs = {ip: others.pop(ip) for ip in list(others) if ip not in tvs and knock(ip, 8001)}
    if not tvs and not lgs and not samsungs and not philips:
        print("No Android TV found. If your TV is Samsung, LG or another brand, that is expected: tell your")
        print("agent the brand and model.")
        print("If it is a Google TV or Android TV: check it is on, awake and on the same Wi-Fi (not a guest")
        print("network), then try again. On a Mac, the first run may ask to find devices on your local")
        print("network: say Allow (System Settings, Privacy and Security, Local Network), then run it again.")
    for ip, d in sorted(tvs.items()):
        model = ", ".join(sorted(d["models"])) or "model not given"
        print(f"TV       {ip:15}  {' / '.join(sorted(d['names']))}  ({model})  offers: {', '.join(sorted(d['offers']))}")
    for ip, name in sorted(lgs.items()):
        print(f"LG TV    {ip:15}  {name or 'name not given'}  (webOS: see docs/LG.md, check-tv.py tells more)")
    for ip, d in sorted(philips.items()):
        print(f"Philips TV  {ip:15}  {' / '.join(sorted(d['names']))}  (Titan OS or older Philips: docs/PHILIPS-TITAN.md)")
    for ip, d in sorted(samsungs.items()):
        model = ", ".join(sorted(d["models"])) or "model not given"
        print(f"Samsung TV  {ip:15}  {' / '.join(sorted(d['names']))}  ({model})  (Tizen: see docs/SAMSUNG.md)")
    for ip, d in sorted(others.items()):
        model = ", ".join(sorted(d["models"])) or "model not given"
        print(f"Cast device {ip:15}  {' / '.join(sorted(d['names']))}  ({model})  "
              "(could be a speaker, a Chromecast or a Fire TV)")


if __name__ == "__main__":
    main()
