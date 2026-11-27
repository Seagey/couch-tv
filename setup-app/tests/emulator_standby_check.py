"""A TV that drops off the network in standby and comes back, against the Android TV emulator ONLY (run by hand):

    COUCHTV_SETUP_ADBKEY=~/.android/adbkey python tests/emulator_standby_check.py --port 5591 \
        --drop "<command that pauses the emulator>" --back "<command that resumes it>"

The emulator is reached on 127.0.0.1 (an SSH forward to the MacBook is fine); the script refuses anything that does
not say it is an emulator. Two pretend home addresses (192.0.2.56 then 192.0.2.77) stand for the address the TV had
before standby and the new one it comes back on, as a TCL did on 24 and 28 Nov 2026. Nothing on the Wi-Fi is
contacted: the TV's announcement on the new address is built from the emulator's own device name.

Checks: 1. connect and remember the TV (room, announced name, serial hash); 2. it drops off: the next command
fails with the asleep words and code "lost", and the scan answer names it as asleep; 3. it comes back; 4. the scan
finds it by its announced name on the new address and its record moves with the room; 5. connecting at the new
address keeps the room and leaves nothing at the old one.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["COUCHTV_SETUP_HOME"] = tempfile.mkdtemp(prefix="couchtv-standby-")

from couchtv_setup import errors, finder, server  # noqa: E402
from couchtv_setup.identity import Identity  # noqa: E402
from couchtv_setup.tv import Tv, TvError  # noqa: E402

HOST = "127.0.0.1"
OLD, NEW = "192.0.2.56", "192.0.2.77"
ROOM = "Spare bedroom"
results = []


def check(name, good, detail=None):
    results.append(bool(good))
    print(("PASS " if good else "FAIL ") + name + ("" if good or detail is None else "  " + str(detail)[:300]), flush=True)


def is_emulator(tv):
    return tv.prop("ro.kernel.qemu") == "1" or tv.prop("ro.boot.qemu") == "1"


def connect(port):
    tv = Tv(HOST, Identity(), route="tcp", port=port, allow_wait_s=20)
    if not is_emulator(tv):
        tv.close()
        sys.exit("refused: the device on that port does not say it is an emulator")
    return tv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5591)
    ap.add_argument("--drop", required=True)
    ap.add_argument("--back", required=True)
    a = ap.parse_args()

    # 1. the TV as Setup first meets it
    tv = connect(a.port)
    server._attach(tv, OLD, "tcp")
    server._remember(OLD, room=ROOM)
    rec = server._known()[OLD]
    check("1. remembered with its room, announced name and serial hash", rec["room"] == ROOM and rec.get("heard") and rec.get("sid"), rec)
    heard_name = rec["heard"]
    print("   announced name:", heard_name)

    # 2. standby: the emulator stops answering
    subprocess.run(a.drop, shell=True, check=True)
    t0 = time.monotonic()
    try:
        tv.shell("echo still here", timeout_s=5)
        check("2. a command to the sleeping TV fails", False, "it answered")
    except TvError as e:
        check("2. a command to the sleeping TV fails with the asleep words", str(e) == errors.ASLEEP and e.code == "lost",
              (e.code, str(e)))
        print("   took %.1f s" % (time.monotonic() - t0))
    tv.close()
    check("2. Setup's page offers Find my TV again for that code", "lost: 1" in open(
        os.path.join(os.path.dirname(server.__file__), "web", "app.js"), encoding="utf-8").read())
    asleep = finder.asleep([], server._known())
    check("2. the scan answer names it as asleep while it is gone", asleep == [{"label": ROOM, "ip": OLD}], asleep)
    quiet = finder.knock(HOST, a.port, 2.0)
    print("   knock while asleep:", "answered" if quiet == 0 else type(quiet).__name__)

    # 3. it wakes
    subprocess.run(a.back, shell=True, check=True)
    end = time.monotonic() + 90
    while time.monotonic() < end and finder.adb_handshake(HOST, a.port) is not True:
        time.sleep(2)
    check("3. it answers again after waking", finder.adb_handshake(HOST, a.port) is True)

    # 4. found by name on the new address
    rec_new = {"service": finder.ANDROID_REMOTE.rstrip(".").lower(), "ip": NEW, "port": 6466, "name": heard_name, "txt": {}}
    rows = finder.merge([rec_new], [], {}, server._known(), {})
    row = rows[0] if rows else {}
    check("4. the scan finds it by name on the new address", row.get("label") == ROOM and row.get("moved_from") == OLD, row)
    server._moved(rows)
    k = server._known()
    check("4. its record moved with the room", OLD not in k and k.get(NEW, {}).get("room") == ROOM, k)
    check("4. no longer listed as asleep", finder.asleep(rows, k) == [], finder.asleep(rows, k))

    # 5. connect at the new address
    tv2 = connect(a.port)
    server._attach(tv2, NEW, "tcp")
    k = server._known()
    check("5. connected at the new address with the same room, nothing left at the old one",
          k.get(NEW, {}).get("room") == ROOM and OLD not in k and not any(x.startswith("?") for x in k), k)
    tv2.close()
    print(json.dumps({"passed": sum(results), "failed": len(results) - sum(results)}))
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
