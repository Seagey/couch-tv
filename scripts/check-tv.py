#!/usr/bin/env python3
"""Test one TV and say which couch-tv options it can run. Changes nothing on the TV.

    .venv/bin/python scripts/check-tv.py <tv address>          # quick look over the network
    .venv/bin/python scripts/check-tv.py <tv address> --adb    # also ask the TV itself (needs
                                                               # Developer options and debugging on)

The quick look knocks on the ports each kind of TV answers on (Android TV remote, ADB, Samsung,
LG, Roku, Apple, Google Cast). --adb connects with ADB to read the Android version, the maker and
which home screen the TV runs. The first time, the TV asks "Allow USB debugging?". That prompt is
the only thing that appears on screen, and saying no is fine. Run --adb only after Developer
options are on (README step 1): it also saves this computer's ADB key in ~/.android/adbkey.

ADB is looked for on ADB_PORT (5555 unless set). When that is closed it also listens for a
"Wireless debugging" announcement from the TV and says which of the two cases this TV is.
"""
import os
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
        print("  scripts need the fixed port: pair once with Android platform-tools (README step 1,")
        print("  \"Only Wireless debugging?\"), then run `adb tcpip 5555`.")
    android = open_ports[6466] or open_ports[6467] or adb_open or bool(wireless)
    samsung = open_ports[8001] or open_ports[8002]
    lg = open_ports[3000] or open_ports[3001]
    facts = adb_facts(ip) if want_adb and adb_open else None
    if want_adb and not adb_open and not wireless:
        print(f"  ADB is not open on port {ADB_PORT}. Switch on Developer options, then USB debugging, and if the")
        print("  TV also has a Network debugging (or Wireless debugging) switch, that too. Then try again.")
    if facts:
        if "error" in facts:
            print("  " + facts["error"])
        else:
            homes = ", ".join(HOMES[h] for h in facts["homes"]) or "unknown"
            print(f"  {facts['maker']} {facts['model']}, Android {facts['android']} (API {facts['sdk']}), TV: {facts['tv']}, home apps: {homes}")

    print()
    if samsung and not android:
        verdict = {"A": "no", "B": "no", "C": "no", "why": "Samsung Tizen: no Android apps and a locked home screen. Plug in a Google TV box to use couch-tv."}
    elif lg and not android:
        verdict = {"A": "no", "B": "no", "C": "no", "why": "LG webOS: no Android apps and a locked home screen. Plug in a Google TV box to use couch-tv."}
    elif open_ports[8060] and not android:
        verdict = {"A": "no", "B": "no", "C": "no", "why": "Roku: closed system."}
    elif not android:
        verdict = {"A": "no", "B": "no", "C": "no", "why": "Not an Android TV as far as the network shows (no Android TV remote, no ADB)."}
    else:
        fire = bool(facts and not facts.get("error") and (facts.get("fire_os") or "amazon" in facts.get("maker", "").lower()))
        sdk = int(facts["sdk"]) if facts and facts.get("sdk", "").isdigit() else None
        verdict = {
            "A": "partly (workarounds only)" if fire else "yes",
            "B": "partly (no Android TV remote protocol)" if fire and not open_ports[6466] else "yes",
            "C": "yes" if (fire or (sdk is not None and sdk <= 30)) else ("likely, may need a pairing code after each restart" if sdk else "likely (switch on Developer options, then run with --adb to confirm)"),
            "why": "Android based." + ("" if facts else " Run with --adb for the Android version and maker."),
        }
        if not adb_open:
            verdict["why"] += " ADB on a fixed port is off for now: every option needs Developer options and debugging switched on (README step 1)."
    print(f"A. TV home only:            {verdict['A']}")
    print(f"B. Computer bridge:         {verdict['B']}")
    print(f"C. Lives on the TV:         {verdict['C']}")
    print(f"   {verdict['why']}")


if __name__ == "__main__":
    main()
