#!/usr/bin/env python3
"""Helper for the real-TV test of on-TV mode (see ../REAL-TV-TEST.md).

Talks to the TV with the pure-Python adb_shell library and your computer's existing ADB key, so it
works where the platform-tools adb binary is blocked (macOS Local Network). It only ever installs,
inspects or removes the on-TV app (dev.couchtv.ontv). It never disables, enables or replaces any
other package and never changes the default home app.

  python3 real-tv.py --ip <TV_IP> check                 what is installed, which home app wins, ADB port
  python3 real-tv.py --ip <TV_IP> install <app.apk>     install as a separate app (refuses any other package);
                                                        copies by base64 shell chunks, add --push to try adb push first
  python3 real-tv.py --ip <TV_IP> open                  open the Couch TV setup screen
  python3 real-tv.py --ip <TV_IP> wireless-on           switch wireless debugging on (adb_wifi_enabled=1) and read it back
  python3 real-tv.py --ip <TV_IP> devopts               open Developer options on the TV
  python3 real-tv.py --ip <TV_IP> code                  read the phone code off the TV screen
  python3 real-tv.py --ip <TV_IP> keys DPAD_DOWN ...    press remote keys (for the "Allow debugging?" dialog)
  python3 real-tv.py --ip <TV_IP> focus                 which on-screen element has focus (text)
  python3 real-tv.py --ip <TV_IP> shot <out.png>        screenshot
  python3 real-tv.py --ip <TV_IP> uninstall             remove the on-TV app (and only it)
  python3 real-tv.py --ip <TV_IP> reboot                restart the TV (only for the restart question)

Needs: pip install adb-shell  (the computer bridge's .venv already has it). Key: ~/.android/adbkey
or --key PATH.
"""
import argparse
import os
import re
import sys
import time
import zipfile

PKG = "dev.couchtv.ontv"


def connect(ip, key):
    from adb_shell.adb_device import AdbDeviceTcp
    from adb_shell.auth.sign_pythonrsa import PythonRSASigner
    priv = open(os.path.expanduser(key)).read()
    pub = open(os.path.expanduser(key) + ".pub").read()
    dev = AdbDeviceTcp(ip, 5555, default_transport_timeout_s=60)
    dev.connect(rsa_keys=[PythonRSASigner(pub, priv)], auth_timeout_s=15)
    return dev


def apk_package(path):
    """Reads the package name from the APK's binary manifest without aapt (good enough for a guard)."""
    with zipfile.ZipFile(path) as z:
        data = z.read("AndroidManifest.xml")
    text = data.decode("utf-16-le", errors="ignore")
    return PKG if PKG in text else None


def unpack_in_pieces(rsh, b64_len):
    """Decodes /data/local/tmp/ontv.b64 into ontv.apk in pieces of about 2 MB: one `base64 -d` of the
    whole 48 MB file outlasted the shell timeout on a slow Fire TV (issue #50). A piece only appends
    when the file is exactly the size the earlier pieces make, so a retried piece is never written twice."""
    blocks = 64                                   # dd blocks of 32768 b64 characters: 2 MiB, a multiple of 4
    raw_piece = blocks * 32768 // 4 * 3           # what one piece decodes to
    pieces = (b64_len + blocks * 32768 - 1) // (blocks * 32768)
    rsh(": > /data/local/tmp/ontv.apk")
    for k in range(pieces):
        rsh(f'[ "$(wc -c < /data/local/tmp/ontv.apk)" = {k * raw_piece} ] && '
            f"dd if=/data/local/tmp/ontv.b64 bs=32768 skip={k * blocks} count={blocks} 2>/dev/null | "
            "base64 -d >> /data/local/tmp/ontv.apk", 120)
        if (k + 1) % 5 == 0 or k + 1 == pieces:
            print(f"  unpacked {k + 1}/{pieces} pieces")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", required=True)
    ap.add_argument("--key", default="~/.android/adbkey")
    ap.add_argument("cmd")
    ap.add_argument("args", nargs="*")
    a = ap.parse_args()
    dev = connect(a.ip, a.key)
    sh = lambda c, t=60: dev.shell(c, timeout_s=t)
    try:
        if a.cmd == "check":
            print("android:", sh("getprop ro.build.version.release").strip(), "sdk", sh("getprop ro.build.version.sdk").strip())
            print("on-TV app installed:", bool(sh(f"pm list packages {PKG}").strip()))
            print("home apps (first one wins):")
            print(sh("cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME"))
            print("current home:", sh("cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME").strip().splitlines()[-1:])
            print("adb tcp port:", sh("getprop service.adb.tcp.port").strip() or "(not set)", " wireless debugging:", sh("settings get global adb_wifi_enabled").strip())
            print("muted:", sh("cmd media_session volume --stream 3 --get 2>/dev/null | tail -1").strip())
        elif a.cmd == "install":
            path = a.args[0]
            if apk_package(path) != PKG:
                sys.exit(f"refusing: {path} is not the {PKG} app")
            # Default: copy as base64 through plain shell commands. adb_shell's file push stalled on a
            # Google TV (Android 14, TcpTimeoutException in _filesync_flush) and left the connection
            # unusable, so push is only tried with --push. Each chunk retries on a fresh connection.
            import base64, hashlib
            raw = open(path, "rb").read()
            pushed = False
            if "--push" in a.args:
                try:
                    dev.push(path, "/data/local/tmp/ontv.apk")
                    pushed = True
                except Exception as e:
                    print(f"push failed ({e.__class__.__name__}), using base64 chunks instead")
            if not pushed:
                def rsh(cmd, t=60):
                    nonlocal dev
                    for attempt in range(3):
                        try:
                            return dev.shell(cmd, timeout_s=t)
                        except Exception as e:
                            print(f"  shell failed ({e.__class__.__name__}), reconnecting ({attempt + 1}/3)")
                            try:
                                dev.close()
                            except Exception:
                                pass
                            time.sleep(2)
                            dev = connect(a.ip, a.key)
                    sys.exit("gave up: the TV keeps dropping the ADB connection")
                rsh("rm -f /data/local/tmp/ontv.b64 /data/local/tmp/ontv.apk")
                b64 = base64.b64encode(raw).decode()
                step = 32 * 1024
                total = (len(b64) + step - 1) // step
                for n, i in enumerate(range(0, len(b64), step), 1):
                    rsh(f"echo -n '{b64[i:i + step]}' >> /data/local/tmp/ontv.b64")
                    if n % 100 == 0 or n == total:
                        print(f"  {n}/{total} chunks")
                unpack_in_pieces(rsh, len(b64))
                rsh("rm -f /data/local/tmp/ontv.b64")
            want = hashlib.md5(raw).hexdigest()
            got = (dev.shell("md5sum /data/local/tmp/ontv.apk", timeout_s=60).split() or [""])[0]
            if got != want:
                sys.exit(f"copy is damaged (md5 {got} != {want}), not installing")
            print("copy ok (md5 match)")
            print(sh("pm install -r /data/local/tmp/ontv.apk; rm /data/local/tmp/ontv.apk", 180))
        elif a.cmd == "wireless-on":
            sh("settings put global adb_wifi_enabled 1")
            time.sleep(3)
            print("adb_wifi_enabled =", sh("settings get global adb_wifi_enabled").strip(),
                  "(if the TV shows 'Allow wireless debugging on this network?', accept it with focus/keys and run this again)")
        elif a.cmd == "devopts":
            print(sh("am start -a android.settings.APPLICATION_DEVELOPMENT_SETTINGS"))
        elif a.cmd == "open":
            print(sh(f"am start -n {PKG}/.SetupActivity"))
        elif a.cmd == "code":
            xml = sh("uiautomator dump /dev/tty", 30)
            m = re.search(r"Phone code\s+(\d{3}) (\d{3})", xml)
            print(m.group(1) + m.group(2) if m else "no code on screen (open the setup screen first)")
        elif a.cmd == "focus":
            xml = sh("uiautomator dump /dev/tty", 30)
            m = re.search(r'<node [^>]*focused="true"[^>]*>', xml)
            t = re.search(r'text="([^"]*)"', m.group(0)) if m else None
            print(t.group(1) if t else "(nothing focused)")
        elif a.cmd == "keys":
            for k in a.args:
                sh(f"input keyevent KEYCODE_{k.upper().removeprefix('KEYCODE_')}")
                time.sleep(0.5)
        elif a.cmd == "shot":
            sh("screencap -p /sdcard/ontv-shot.png")
            dev.pull("/sdcard/ontv-shot.png", a.args[0])
            sh("rm /sdcard/ontv-shot.png")
            print(a.args[0])
        elif a.cmd == "uninstall":
            print(sh(f"pm uninstall {PKG}"))
        elif a.cmd == "reboot":
            print("restarting the TV")
            try:
                sh("reboot", 10)
            except Exception:
                pass   # the connection drops as it goes down
        else:
            sys.exit("unknown command")
    finally:
        dev.close()


if __name__ == "__main__":
    main()
