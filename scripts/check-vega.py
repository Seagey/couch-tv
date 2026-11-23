#!/usr/bin/env python3
"""Look at a Fire TV on Vega OS and say what couch-tv can use. Changes nothing on the stick.

    python3 scripts/check-vega.py <stick address> [vega app id]

It only reads: is the network developer port (5555) open, does the stick answer DIAL (the standard way
a phone opens an app, UDP 1900 then one GET), is Amazon's `vega` command on this computer, and, if it is,
what `vega device list` and `is-app-installed` say. It prints what it saw, never a key.
"""
import re
import shutil
import socket
import subprocess
import sys
import urllib.request


def knock(ip, port, timeout=1.5):
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def dial(ip, port=1900):
    msg = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n"
           "ST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n").encode()
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(3)
    try:
        s.sendto(msg, (ip, port))
        data, _ = s.recvfrom(4096)
    except OSError:
        return None
    finally:
        s.close()
    loc = re.search(rb"(?im)^location:\s*(\S+)", data)
    if not loc:
        return {"location": None}
    out = {"location": loc.group(1).decode(), "application_url": None, "name": None}
    try:
        with urllib.request.urlopen(out["location"], timeout=3) as r:
            out["application_url"] = r.headers.get("Application-URL")
            m = re.search(rb"<friendlyName>([^<]{1,80})</friendlyName>", r.read(20000))
            out["name"] = m.group(1).decode() if m else None
    except OSError:
        pass
    return out


def vega(*args):
    try:
        p = subprocess.run(["vega", *args], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, type(e).__name__
    return p.returncode, (p.stdout + p.stderr).strip()[-400:]


def main(argv):
    if not 2 <= len(argv) <= 3:
        raise SystemExit(__doc__)
    ip = argv[1]
    app = argv[2] if len(argv) == 3 else "com.couchtv.home.main"
    port = int(__import__("os").environ.get("VEGA_PORT") or 5555)
    print(f"Checking {ip} (read only)")
    up = knock(ip, port)
    print(f"  developer port {port}: {'open' if up else 'closed'}"
          + ("" if up else " (Developer Mode and network access are off, or the stick is asleep)"))
    d = dial(ip)
    if d is None:
        print("  DIAL: no answer on UDP 1900")
    else:
        print(f"  DIAL: answers. Name: {d.get('name')}. Application-URL: {d.get('application_url') or 'none'}")
    cli = shutil.which("vega")
    print(f"  Amazon's vega command here: {'yes' if cli else 'no (needed to open couch-tv by CLI; DIAL may do instead)'}")
    if cli:
        rc, out = vega("device", "list")
        print(f"  vega device list: {out or rc}")
        rc, out = vega("device", "is-app-installed", "--appName", app, "-d", f"{ip}:{port}")
        print(f"  is {app} installed: {out or rc}")
    print()
    print("Reading: a closed port with DIAL answering means the stick is awake but not in Developer Mode;"
          " DIAL alone can open Netflix and YouTube. couch-tv itself needs the app installed once"
          " (docs/FIRE-VEGA.md).")


if __name__ == "__main__":
    main(sys.argv)
