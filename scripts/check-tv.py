#!/usr/bin/env python3
"""Test one TV and say which couch-tv options it can run. Changes nothing on the TV.

    .venv/bin/python scripts/check-tv.py <tv address>          # quick look over the network
    .venv/bin/python scripts/check-tv.py <tv address> --adb    # also ask the TV itself (needs
                                                               # Developer options and debugging on)

The quick look knocks on the ports each kind of TV answers on (Android TV remote, ADB, Samsung,
LG, Roku, Hisense VIDAA, Philips JointSpace, VIZIO, Panasonic Viera, Vestel Smart Center, Apple, Google Cast). On an LG it also says hello to LG's network remote, which tells
the webOS version without any prompt on the TV (the prompt only comes when couch-tv's bridge asks
to control it). On a Philips answering plain port 1925 it reads "system" (a read, no login, nothing on
screen) for the API version and whether the TV lists a browser. On 7345 or 9000 it asks whether the answer is a VIZIO's SmartCast (one read, no
prompt on the TV, no key). --adb connects with ADB to read the Android version, the maker and
which home screen the TV runs. The first time, the TV asks "Allow USB debugging?". That prompt is
the only thing that appears on screen, and saying no is fine. Run --adb only after Developer
options are on (docs/SETUP.md step 1): it also saves this computer's ADB key in ~/.android/adbkey.

ADB is looked for on ADB_PORT (5555 unless set). When that is closed it also listens for a
"Wireless debugging" announcement from the TV and says which of the two cases this TV is.
"""
import os
import re
import socket
import sys
import time

ADB_PORT = int(os.environ.get("ADB_PORT") or 5555)

PORTS = {
    6466: "Android TV remote (control)",
    6467: "Android TV remote (pairing)",
    ADB_PORT: "ADB over the network (USB or Network debugging)",
    8009: "Google Cast",
    8001: "Samsung Tizen remote",
    8002: "Samsung Tizen remote (secure)",
    3000: "LG webOS remote",
    3001: "LG webOS remote (secure)",
    8060: "Roku",
    36669: "Hisense VIDAA remote",
    36668: "Hisense VIDAA remote (older)",
    1926: "Philips JointSpace (secure, Titan OS and newer Philips)",
    1925: "Philips JointSpace (plain, older Philips Linux TVs such as Saphi)",
    7345: "VIZIO SmartCast (firmware 4.0 and newer, VIZIO OS)",
    9000: "VIZIO SmartCast (older firmware), or something else",
    55000: "Panasonic Viera remote",
    56789: "Vestel Smart Center (TiVo OS on JVC, Telefunken and others, and older Vestel built TVs)",
    7000: "AirPlay (Apple TV and some TVs)",
}

HOMES = {
    "com.google.android.apps.tv.launcherx": "Google TV home",
    "com.google.android.tvlauncher": "Android TV home",
    "com.amazon.tv.launcher": "Fire TV home",
    "com.amazon.firehomestarter": "Fire TV home",
}


def knock(ip, port, timeout=1.0):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def lg_hello(ip):
    """What an LG says about itself to a hello on its network remote (no pairing, nothing on
    screen): {"os", "version"}, or None. Plain port 3000, else encrypted 3001."""
    try:
        import asyncio
        import aiohttp
    except ImportError:
        return None

    async def ask():
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4)) as s:
            for url in (f"ws://{ip}:3000", f"wss://{ip}:3001"):
                try:
                    async with s.ws_connect(url, ssl=False) as ws:
                        await ws.send_json({"id": "hello", "type": "hello", "payload": {}})
                        j = await ws.receive_json(timeout=4)
                        p = j.get("payload") or {}
                        return {"os": p.get("deviceOS"), "version": p.get("deviceOSReleaseVersion") or p.get("deviceOSVersion")}
                except Exception:
                    continue
        return None

    try:
        return asyncio.run(ask())
    except Exception:
        return None


def philips_hello(ip, port=1925):
    """What a Philips says on plain port 1925 to GET system (no login, nothing on screen): {"api", "model",
    "browser"}, or None. "browser" is whether it lists a browser activity (docs/PHILIPS-SAPHI.md)."""
    import json
    import urllib.request

    def lists_browser(d, depth=0):
        if not isinstance(d, dict) or depth > 3:
            return False
        return any((k == "activities" and isinstance(v, list) and "browser" in [str(x).lower() for x in v])
                   or (isinstance(v, dict) and lists_browser(v, depth + 1)) for k, v in d.items())

    for v in ("6/", "5/", "1/", ""):
        try:
            with urllib.request.urlopen(f"http://{ip}:{port}/{v}system", timeout=3) as r:
                d = json.loads(r.read(20000).decode("utf-8", "replace"))
        except Exception:
            continue
        if isinstance(d, dict) and d:
            return {"api": "/" + v, "model": d.get("model") or d.get("name"), "browser": lists_browser(d)}
    return None
def smartcast(ip, port):
    """True when the port answers like a VIZIO's SmartCast API: JSON with a STATUS block, over HTTPS
    with the TV's own self signed certificate (accepted for this one read only). Sends no key."""
    import json
    import ssl
    import urllib.error
    import urllib.request
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(f"https://{ip}:{port}/state/device/power_mode", context=ctx, timeout=4) as r:
            text = r.read(4096)
    except urllib.error.HTTPError as e:
        text = e.read(4096)
    except Exception:
        return False
    try:
        return isinstance(json.loads(text).get("STATUS"), dict)
    except (ValueError, AttributeError):
        return False


def wireless_debugging_port(ip, wait=4.0):
    """The port the TV announces for Android 11+ Wireless debugging (mDNS _adb-tls-connect), or None."""
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except ImportError:
        return None
    found = {}

    class L(ServiceListener):
        def add_service(self, zc, type_, name):
            info = zc.get_service_info(type_, name, timeout=2000)
            if info and any(socket.inet_ntoa(a) == ip for a in info.addresses if len(a) == 4):
                found["port"] = info.port

        def update_service(self, zc, type_, name):
            self.add_service(zc, type_, name)

        def remove_service(self, zc, type_, name):
            pass

    zc = Zeroconf()
    try:
        ServiceBrowser(zc, "_adb-tls-connect._tcp.local.", L())
        end = time.time() + wait
        while time.time() < end and "port" not in found:
            time.sleep(0.2)
    finally:
        zc.close()
    return found.get("port")


# The first Fire OS builds that stop an app on the TV from using the TV's own ADB (Amazon's fix for
# CVE-2024-27350), as on-tv/README.md lists them. UNCONFIRMED: that ro.build.version.fireos carries the
# same number as Settings, About; a version this cannot read gets the cautious message instead.
FIRE_ADB_BLOCK_FROM = {6: (6, 7, 1, 1), 7: (7, 6, 6, 9), 8: (8, 1, 0, 3)}


def fire_adb_blocks(version):
    """True: this Fire OS build blocks the TV's own ADB. False: an older build, it may still allow it.
    None: the version could not be read (or is not four numbers)."""
    parts = (version or "").split(".")
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return None
    got = tuple(int(p) for p in parts)
    if got[0] > 8:
        return True
    return got >= FIRE_ADB_BLOCK_FROM[got[0]] if got[0] in FIRE_ADB_BLOCK_FROM else False


FIRE_ADB_WARNING = {
    True: " This Fire OS build blocks the TV's own ADB (Amazon's fix for CVE-2024-27350), so option C's phone remote "
          "cannot press keys or type. For the full phone remote use option B (a computer at home that stays on).",
    False: " This Fire OS build may still allow the TV's own ADB: the block was seen from 6.7.1.1, 7.6.6.9 and "
           "8.1.0.3. If option C's phone remote cannot press keys after setup, use option B.",
    None: " Recent Fire OS builds block the TV's own ADB, so option C's phone remote may not press keys or type "
          "(this run could not read the Fire OS version). For the full phone remote use option B.",
}


def adb_facts(ip):
    try:
        from adb_shell.adb_device import AdbDeviceTcp
        from adb_shell.auth.sign_pythonrsa import PythonRSASigner
    except ImportError:
        return {"error": "needs adb-shell: .venv/bin/pip install -r bridge/requirements.txt"}
    key = os.path.expanduser(os.environ.get("ADB_KEY", "~/.android/adbkey"))
    if not os.path.exists(key):
        from adb_shell.auth.keygen import keygen
        os.makedirs(os.path.dirname(key), exist_ok=True)
        keygen(key)
    dev = AdbDeviceTcp(ip, ADB_PORT, default_transport_timeout_s=20)
    try:
        dev.connect(rsa_keys=[PythonRSASigner(open(key + ".pub").read(), open(key).read())], auth_timeout_s=30)
    except Exception as e:
        return {"error": f"ADB did not connect ({type(e).__name__}). Was 'Allow USB debugging?' accepted on the TV?"}
    sh = lambda c: dev.shell(c, timeout_s=20).strip()
    facts = {
        "android": sh("getprop ro.build.version.release"),
        "sdk": sh("getprop ro.build.version.sdk"),
        "maker": sh("getprop ro.product.manufacturer"),
        "model": sh("getprop ro.product.model"),
        "fire_os": sh("getprop ro.build.version.fireos") or "",
        "tv": "android.software.leanback" in sh("pm list features"),
        "home": sh("cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -1"),
        "homes": [p for p in HOMES if f"package:{p}" in sh("pm list packages")],
        "adb_wifi": sh("settings get global adb_wifi_enabled"),
        "remote_service": sh("dumpsys package com.google.android.tv.remote.service | grep -m1 versionName").replace("versionName=", "").strip(),
    }
    dev.close()
    return facts


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ip, want_adb = sys.argv[1], "--adb" in sys.argv
    open_ports = {p: knock(ip, p) for p in PORTS}
    print(f"TV at {ip}")
    for p, ok in open_ports.items():
        if ok:
            print(f"  answers on {p}: {PORTS[p]}")
    if not any(open_ports.values()):
        print("  nothing answered. Is the TV on, awake and on the same Wi-Fi?")
        return

    adb_open = open_ports[ADB_PORT]
    wireless = None if adb_open else wireless_debugging_port(ip)
    if adb_open:
        print(f"  ADB: open on port {ADB_PORT} (Network debugging, or USB debugging on TVs that open it by itself). couch-tv can use it as it is.")
    elif wireless:
        print(f"  ADB: only Wireless debugging is on (port {wireless}, it changes on restart). couch-tv's")
        print("  scripts need the fixed port: pair once with Android platform-tools (docs/SETUP.md step 1,")
        print("  \"Only Wireless debugging?\"), then run `adb tcpip 5555`.")
    android = open_ports[6466] or open_ports[6467] or adb_open or bool(wireless)
    samsung = open_ports[8001] or open_ports[8002]
    lg = open_ports[3000] or open_ports[3001]
    vizio = not android and any(open_ports[p] and smartcast(ip, p) for p in (7345, 9000))
    if vizio:
        print("  SmartCast answered: this is a VIZIO")
    facts = adb_facts(ip) if want_adb and adb_open else None
    hello = lg_hello(ip) if lg and not android else None
    if hello:
        print(f"  LG network remote: {hello['os'] or 'webOS'} {hello['version'] or ''}".rstrip())
    saphi = philips_hello(ip) if open_ports[1925] and not android else None
    if saphi:
        print(f"  Philips JointSpace on 1925: API {saphi['api']}, {saphi['model'] or 'model not given'}, "
              f"browser listed: {'yes' if saphi['browser'] else 'no'}")
    if want_adb and not adb_open and not wireless:
        print(f"  ADB is not open on port {ADB_PORT}. Switch on Developer options, then USB debugging, and if the")
        print("  TV also has a Network debugging (or Wireless debugging) switch, that too. Then try again.")
    if facts:
        if "error" in facts:
            print("  " + facts["error"])
        else:
            homes = ", ".join(HOMES[h] for h in facts["homes"]) or "unknown"
            print(f"  {facts['maker']} {facts['model']}, Android {facts['android']} (API {facts['sdk']}), TV: {facts['tv']}, home apps: {homes}")
            rs = facts.get("remote_service") or ""
            if rs:
                print(f"  Android TV Remote Service: {rs}")
                m = re.match(r"(\d+)", rs)
                if m and int(m.group(1)) < 3:
                    print("  That is old. One Sony Bravia on 2.2 could not pair (the pairing run died with ConnectionClosed")
                    print("  or CannotConnect) until the app was updated from the Play Store (7.x worked). On the TV open")
                    print("  the Play Store, search for Android TV Remote Service and update it, then pair again.")

    print()
    if samsung and not android:
        verdict = {"A": "no", "B": "Samsung path (works on a 2021 and a 2025 Frame): docs/SAMSUNG.md", "C": "no",
                   "why": "Samsung Tizen: no Android apps and a locked home screen. couch-tv goes on as a Samsung app that a "
                          "computer at home opens each time the TV comes on (docs/SAMSUNG.md), or plug in a Google TV box for everything."}
    elif lg and not android:
        verdict = {"A": "no", "B": "LG path (untested on a real LG): docs/LG.md", "C": "no",
                   "why": "LG webOS: no Android apps and a locked home screen. couch-tv can go on as an LG app that a computer "
                          "at home opens each time the TV comes on (docs/LG.md, built and tested against a stand-in, "
                          "not yet on a real LG), or plug in a Google TV box for everything."}
    elif open_ports[8060] and not android:
        verdict = {"A": "no", "B": "Roku path (built, not yet tried on a real Roku): docs/ROKU.md", "C": "no",
                   "why": "Roku: no Android apps and a locked home screen. couch-tv can go on as a Roku channel that a computer "
                          "at home opens each time the TV comes on (docs/ROKU.md, built from Roku's documentation and tested "
                          "against a stand-in, not yet on a real Roku), or plug in a Google TV box for everything."}
    elif (open_ports[36669] or open_ports[36668]) and not android:
        verdict = {"A": "no", "B": "VIDAA path (built, not yet tried on a real VIDAA TV): docs/VIDAA.md", "C": "no",
                   "why": "Hisense VIDAA: no Android apps and a locked home screen. couch-tv can open itself in the TV's "
                          "browser each time the TV comes on, with a computer at home (docs/VIDAA.md, tested against a "
                          "stand-in only, not yet on a real VIDAA TV), or plug in a Google TV box for everything."}
    elif open_ports[1925] and not open_ports[1926] and not android:
        page = (saphi or {}).get("browser")
        verdict = {"A": "no", "B": "Philips Saphi path, New (Beta): phone remote" + (
                       ", and couch-tv's page opens in the TV's browser" if page else " only (no browser listed)")
                   + ": docs/PHILIPS-SAPHI.md", "C": "no",
                   "why": "An older Philips Linux TV (Saphi): no Android apps and a locked home screen. With a computer at "
                          "home, the phone remote and the assistant drive it over plain port 1925"
                          + (", and couch-tv's page opens in the TV's own browser when it comes on (not a true home "
                             "screen: the browser's bar shows and Home still opens Philips's menu)" if page else "")
                          + ". Run scripts/philips-check.py next. Plug in a Google TV box for everything."}
    elif (open_ports[1926] or open_ports[1925]) and not android:
        verdict = {"A": "no", "B": "Philips Titan OS path, phone remote only (the read only check has run on one real TV, pairing has not): "
                              "docs/PHILIPS-TITAN.md", "C": "no",
                   "why": "Philips on Titan OS (or an older Philips Linux TV): no Android apps and a locked home screen. The "
                          "phone remote and the assistant can drive it with a computer at home (docs/PHILIPS-TITAN.md, tested "
                          "against a stand in only). couch-tv's home cannot open on it without a Titan app, so plug in a "
                          "Google TV box for everything."}
    elif vizio:
        verdict = {"A": "no", "B": "VIZIO path, New (Beta): phone remote, power, volume, inputs and opening apps: "
                              "docs/VIZIO.md", "C": "no",
                   "why": "VIZIO SmartCast or VIZIO OS: no Android apps, no browser and a locked home screen. With a computer "
                          "at home the phone remote and the assistant can drive it (docs/VIZIO.md, tested against a stand in "
                          "so far). couch-tv's own home cannot open on a VIZIO, so plug in a Google TV box for everything."}
    elif open_ports[55000] and not android:
        verdict = {"A": "no", "B": "Panasonic path (New, Beta): docs/PANASONIC.md", "C": "no",
                   "why": "Panasonic Viera (My Home Screen or older): no Android apps and a locked home screen. couch-tv "
                          "can open itself in the TV's browser each time the TV comes on, with a computer at home, and the "
                          "phone remote works (docs/PANASONIC.md, Beta: first run scripts/panasonic-check.py, it only reads). "
                          "Or plug in a Google TV box for everything."}
    elif open_ports[56789] and not android:
        verdict = {"A": "no", "B": "TiVo OS path (New, Beta): docs/TIVO.md", "C": "no",
                   "why": "A TV built by Vestel that answers Smart Center: TiVo OS (JVC, Telefunken and others) or an older "
                          "Vestel system. No Android apps and a locked home screen. With a computer at home the phone "
                          "remote works, and couch-tv opens itself in the TV's browser each time the TV comes on, from a "
                          "Speed Dial tile you add once (docs/TIVO.md, Beta, run on one real JVC so far: first run "
                          "scripts/tivo-check.py, it only reads). Or plug in a Google TV box for everything."}
    elif not android:
        verdict = {"A": "no", "B": "no", "C": "no", "why": "Not an Android TV as far as the network shows (no Android TV remote, no ADB)."}
    else:
        fire = bool(facts and not facts.get("error") and (facts.get("fire_os") or "amazon" in facts.get("maker", "").lower()))
        sdk = int(facts["sdk"]) if facts and facts.get("sdk", "").isdigit() else None
        blocks = fire_adb_blocks(facts.get("fire_os")) if fire else None
        verdict = {
            "A": "partly (workarounds only)" if fire else "yes",
            "B": "partly (no Android TV remote protocol)" if fire and not open_ports[6466] else "yes",
            "C": "yes" if (fire or (sdk is not None and sdk <= 30)) else ("likely, may need a pairing code after each restart" if sdk else "likely (switch on Developer options, then run with --adb to confirm)"),
            "why": "Android based." + ("" if facts else " Run with --adb for the Android version and maker."),
        }
        if fire:
            verdict["why"] += FIRE_ADB_WARNING[blocks]
            if blocks:
                verdict["C"] = "yes, but the phone remote cannot press keys or type"
        if not adb_open:
            verdict["why"] += " ADB on a fixed port is off for now: every option needs Developer options and debugging switched on (docs/SETUP.md step 1)."
    print(f"A. TV home only:            {verdict['A']}")
    print(f"B. Computer bridge:         {verdict['B']}")
    print(f"C. Lives on the TV:         {verdict['C']}")
    print(f"   {verdict['why']}")


if __name__ == "__main__":
    main()
