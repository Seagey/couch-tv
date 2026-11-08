"""Read-only check of a TV before our home screen goes on it. Changes nothing on the TV or its screen.

Prints what the switch-over depends on: Android version, the home screen apps, the packages
apply.sh keeps on or switches off, and any ad trackers (ACR). The TV's own home screens and setup
app always stay on (switching them off can make a Google TV loop at every restart); if an older
couch-tv switched them off, it says so, and apply.sh or undo.sh switches them back on.

Usage: TV_IP=<tv address> [ADB_PORT=5555] .venv/bin/python tv-home/tools/survey-tv.py
"""
import os
import re
import sys

from adb_shell.adb_device import AdbDeviceTcp
from adb_shell.auth.sign_pythonrsa import PythonRSASigner

KEY = os.path.expanduser(os.environ.get("ADB_KEY", "~/.android/adbkey"))
if not os.path.exists(KEY):
    from adb_shell.auth.keygen import keygen
    os.makedirs(os.path.dirname(KEY), exist_ok=True)
    keygen(KEY)
priv = open(KEY).read()
pub = open(KEY + ".pub").read()
ip = os.environ.get("TV_IP") or sys.exit("set TV_IP to the address of the TV")
port = int(os.environ.get("ADB_PORT") or 5555)
dev = AdbDeviceTcp(ip, port, default_transport_timeout_s=60)
try:
    dev.connect(rsa_keys=[PythonRSASigner(pub, priv)], auth_timeout_s=30)
except Exception as e:
    sys.exit(f"Cannot reach the TV at {ip}:{port} over ADB ({type(e).__name__}). Is USB debugging on (and "
             "Network debugging, if the TV has that switch), and was 'Allow USB debugging?' accepted on the "
             "TV? Check with scripts/check-tv.py <tv address>. See README step 1.")
sh = lambda c: dev.shell(c, timeout_s=60, read_timeout_s=30).strip()

print("TV", ip)
print("model:", sh("getprop ro.product.manufacturer"), sh("getprop ro.product.model"))
print("android:", sh("getprop ro.build.version.release"), "sdk", sh("getprop ro.build.version.sdk"),
      "abi", sh("getprop ro.product.cpu.abi"))
print("screen:", sh("wm size").replace("\n", " / "), "|", sh("wm density").replace("\n", " / "))
print("webview:", (re.findall(r"versionName=(\S+)", sh("dumpsys package com.google.android.webview")) or ["?"])[0])
print("memory:", sh("grep -E 'MemTotal|MemAvailable' /proc/meminfo").replace("\n", " / "))

print("\nhome screen now:", sh("cmd package resolve-activity --brief -a android.intent.action.MAIN "
                                "-c android.intent.category.HOME").splitlines()[-1])
print(sh("pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME"))

pkgs = set(l.replace("package:", "") for l in sh("pm list packages").splitlines())
disabled = set(l.replace("package:", "") for l in sh("pm list packages -d").splitlines())
KEEP_ON = {
    "com.google.android.apps.tv.launcherx": "Google TV home",
    "com.google.android.tvlauncher": "older Android TV home",
    "com.google.android.tungsten.setupwraith": "setup wizard",
}
print("\npackages that always stay on (the TV needs them to start):")
old_off = []
for p, what in KEEP_ON.items():
    state = "not on this TV" if p not in pkgs else ("OFF" if p in disabled else "on")
    if state == "OFF":
        old_off.append(p)
    print(f"  {p:45} {state:15} {what}")
if old_off:
    print("  Switched off, probably by couch-tv 0.10 or older. Some Google TVs loop at every restart")
    print("  like this: run apply.sh or undo.sh before the TV next restarts (README, 'If your TV loops")
    print("  after a restart').")
print("\npackages apply.sh switches off:")
for p, what in {"com.google.android.apps.tv.dreamx": "ambient mode (promos when idle)"}.items():
    state = "not on this TV" if p not in pkgs else ("already off" if p in disabled else "present")
    print(f"  {p:45} {state:15} {what}")

acr = sorted(p for p in pkgs if re.search(r"acr|samba|alphonso|inscape|anoki|tvision|admob|\.ads?\b", p))
print("\npossible ad trackers (check each before switching off):", ", ".join(acr) or "none found")

apps = sh("pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER")
print("\nTV apps:")
print("\n".join(sorted(l.strip() for l in apps.splitlines() if "/" in l)))
dev.close()
