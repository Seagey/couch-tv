"""The dream flow against the Android TV emulator ONLY. Not part of the unit tests (run it by hand):

    COUCHTV_SETUP_ADBKEY=~/.android/adbkey python tests/emulator_check.py --port 5591 [--install]

It refuses to act on anything but an emulator: the address must be 127.0.0.1, the port one of the
emulator ADB ports below, and the device must say it is an emulator (ro.kernel.qemu or ro.boot.qemu
is 1, serial EMULATOR...). A real TV is never connected to: the Wi-Fi part only LISTENS (mDNS) and
prints names; it never knocks, handshakes or connects to anything on the network.

Steps: 1. the ADB handshake tells the emulator's ADB port from its console port; 2. merge() calls it
Ready; 3. mDNS listening on the Wi-Fi (names only); 4. connect, facts and the TV profile (read only);
5. with --install: download the newest Couch TV from GitHub, check it against SHA256SUMS.txt, install
it, make it the home with a pretend account link and home pack, run the speed test, and collect the
health report.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from couchtv_setup import finder, health, release, steps, studio, tvprofile  # noqa: E402
from couchtv_setup.identity import Identity  # noqa: E402
from couchtv_setup.tv import Tv  # noqa: E402

HOST = "127.0.0.1"
EMULATOR_ADB_PORTS = {5555, 5557, 5559, 5561, 5591}          # emulator-5554 ... and emulator-5590
EMULATOR_SERIALS = {"emulator-5554", "emulator-5556", "emulator-5558", "emulator-5560", "emulator-5590"}


def is_emulator(tv):
    return tv.prop("ro.kernel.qemu") == "1" or tv.prop("ro.boot.qemu") == "1"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5591)
    ap.add_argument("--install", action="store_true")
    a = ap.parse_args()
    serial = f"emulator-{a.port - 1}"
    if a.port not in EMULATOR_ADB_PORTS or serial not in EMULATOR_SERIALS:
        sys.exit(f"refused: {HOST}:{a.port} is not on the emulator allow list")

    print("1. handshake on the ADB port:", finder.adb_handshake(HOST, a.port))
    print("   handshake on the console port (must be False):", finder.adb_handshake(HOST, a.port - 1))
    rows = finder.merge([], [(HOST, 5555)], {}, {}, {HOST: finder.adb_handshake(HOST, a.port)})
    print("2. merge() status:", [(r["label"], r["status"]) for r in rows])
    heard = finder.mdns.browse(finder.SERVICES, 3.0)
    print("3. heard on the Wi-Fi (listen only, nothing contacted):",
          sorted({(h.get("name") or "")[:30] + " " + h["service"].split(".")[0] for h in heard}))

    tv = Tv(HOST, Identity(), route="tcp", port=a.port, allow_wait_s=20)
    if not is_emulator(tv):
        tv.close()
        sys.exit("refused: the device on that port does not say it is an emulator")
    f = steps.facts(tv)
    print("4. facts:", {k: f[k] for k in ("name", "android", "sdk", "kind", "google_tv", "installed")})
    prof = tvprofile.read(tv, f)
    print("   profile:", json.dumps(prof))
    if not a.install:
        return
    apk = release.get(release.HOME_APK, lambda fr, m=None: None)
    print("5. downloaded", apk["version"], "checked against", apk["checked"], apk["sha256"][:12])
    home = studio.check_home({"v": 1, "rev": 1, "people": [{"id": "p_demo01", "name": "Ruby"}, {"id": "p_demo02", "name": "Sam"}],
                              "town": {"name": "Ballarat", "lat": -37.56, "lon": 143.85}})
    people, _town = studio.setup_inputs(home)
    weather = {"lat": -37.56, "lon": 143.85, "place": "Ballarat", "timezone": "Australia/Melbourne"}
    r = steps.make_home(tv, apk["path"], ambient_off=False, people=people, weather=weather,
                        account={"link": "E" * 43, "code": "CTV1-" + "e" * 43},
                        progress=lambda fr, m=None: m and print("   ", round(fr * 100), m))
    print("   result:", {k: r.get(k) for k in ("changed", "front", "home_key_opens", "watch", "watch_bound")})
    sp = health.speed_test(tv)
    print("   speed:", json.dumps(sp))
    prof = tvprofile.clean(dict(tvprofile.read(tv, steps.facts(tv)), speed=sp))
    print("   profile after:", json.dumps(prof))
    rep = health.health_report(tv, steps.facts(tv)["installed"])
    print("   health report:", json.dumps({k: v for k, v in rep.items() if k != "log"}), "log lines:", len(rep["log"]))
    tv.close()


if __name__ == "__main__":
    main()
