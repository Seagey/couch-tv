#!/usr/bin/env python3
"""Virtual Matter devices for the couch-tv Matter contract test (runs on the MacBook).

Every device is a real connectedhomeip v1.6.1.0 example app running on this Mac's network, so any
Matter controller on the LAN (the on-TV app, the bridge, Google Home) can find and commission it.
A second controller, "home" (chip-tool with its own fabric), plays Google Home / Apple Home: it
commissions every device first, then "shares" a device by opening a commissioning window with a
fresh code, exactly like "Share device" / "Turn on pairing mode" in those apps.

Usage (on the MacBook, or from anywhere as `ssh macbook ~/matter-fixtures/fx <cmd>`):
  fx start [names]        start the virtual devices (all if no names)
  fx stop                 stop them
  fx status               JSON: which are running, ports, discriminators, node ids
  fx home [names]         commission each device into the "home" fabric (once, after reset)
  fx up                   start + home (skips devices already in the home fabric)
  fx share <name> [secs]  open a commissioning window, print JSON {manual, qr, discriminator}
  fx wrongcode <name>     a well formed 11 digit code for the open window with the wrong passcode
  fx revoke <name>        close the open commissioning window (the shared code stops working)
  fx read <name> <cluster> <attribute> [endpoint]   read one attribute through "home", JSON value
  fx do <name> <chip-tool args...>                   run any chip-tool cluster command as "home"
                                                     (node id is filled in: use NODE / EP words)
  fx fabrics <name>       JSON {name, fabrics}: how many fabrics (controllers) the device is on
  fx fabrics              JSON {devices: [{name, fabrics}, ...]} for every device
  fx lock <token> [about] take the one-run-at-a-time lock (~/matter-fixtures.lock); JSON {ok, held_by?}
  fx unlock <token>       give it back (`fx unlock --force` after a run that died)
  fx evict [names]        remove every controller but "home" from the devices (clean up a failed run)
  fx pipe <name> <json>   send an out-of-band command to the device (sensor changes etc.)
  fx log <name> [n]       last n lines of the device's own log
  fx reset                stop everything, wipe device storage and the home fabric
  fx codes                print the direct (factory) pairing codes

Everything is JSON on stdout when it is data; human notes go to stderr.
"""
import json
import os
import re
import signal
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
SPIKE = os.path.join(HOME, "matter-spike")
OUT = os.path.join(SPIKE, "connectedhomeip", "out")
FX = os.path.join(HOME, "matter-fixtures")
RUN = os.path.join(FX, "run")
KVS = os.path.join(FX, "kvs")
HOMESTORE = os.path.join(FX, "home-store")
LOCK = os.path.join(FX, "chip-tool.lock")

CHIP_TOOL = os.path.join(OUT, "darwin-arm64-chip-tool-no-ble", "chip-tool")
ALL_DEVICES = os.path.join(OUT, "darwin-arm64-all-devices-no-ble", "all-devices-app")
LIGHT = os.path.join(OUT, "darwin-arm64-light", "chip-lighting-app")
THERMOSTAT = os.path.join(OUT, "darwin-arm64-thermostat-no-ble", "thermostat-app")
LOCKAPP = os.path.join(OUT, "darwin-arm64-lock-no-ble", "chip-lock-app")
COVER = os.path.join(SPIKE, "chef-bin", "rootnode_windowcovering_RLCxaGi9Yx")

PASSCODE = 20202021  # factory passcode of every fixture (the shared codes are fresh and random)

# name: binary, style ("linux" = examples/platform/linux AppMain flags, "alldev" = all-devices-app),
# extra args, operational UDP port, factory discriminator, node id in the home fabric, what it proves.
DEVICES = {
    "light":      dict(bin=LIGHT, style="linux", args=[], port=5541, disc=0x141, node=101,
                       expect=[{"ep": 1, "domain": "light"}],
                       about="Extended colour light: OnOff, LevelControl, ColorControl (hue/sat, xy, colour temperature)"),
    "plug":       dict(bin=ALL_DEVICES, style="alldev", args=["--device", "on-off-plug-in-unit:1"],
                       port=5542, disc=0x242, node=102, expect=[{"ep": 1, "domain": "switch"}],
                       about="On/Off plug-in unit"),
    "thermostat": dict(bin=THERMOSTAT, style="linux", args=[], port=5543, disc=0x343, node=103,
                       expect=[{"ep": 1, "domain": "climate"}],
                       about="Thermostat: SystemMode, heating/cooling setpoints, LocalTemperature"),
    "cover":      dict(bin=COVER, style="linux", args=[], port=5544, disc=0x444, node=104,
                       expect=[{"ep": 1, "domain": "cover"}],
                       about="Window covering (lift, position aware)"),
    "fan":        dict(bin=ALL_DEVICES, style="alldev", args=["--device", "fan:1"], port=5545, disc=0x545,
                       node=105, expect=[{"ep": 1, "domain": "fan"}],
                       about="Fan: FanControl (FanMode, PercentSetting/PercentCurrent) and OnOff"),
    "sensors":    dict(bin=ALL_DEVICES, style="alldev",
                       args=["--device", "temperature-sensor:1", "--device", "humidity-sensor:2",
                             "--device", "contact-sensor:3", "--device", "occupancy-sensor:4"],
                       port=5546, disc=0x646, node=106,
                       expect=[{"ep": 1, "domain": "sensor", "device_class": "temperature"},
                               {"ep": 2, "domain": "sensor", "device_class": "humidity"},
                               {"ep": 3, "domain": "sensor", "device_class": "contact"},
                               {"ep": 4, "domain": "sensor", "device_class": "occupancy"}],
                       about="One device, four endpoints: temperature, humidity, contact, occupancy"),
    "lock":       dict(bin=LOCKAPP, style="linux", args=[], port=5547, disc=0x747, node=107,
                       expect=[], forbidden=True,
                       about="Door lock: must never be listed or controlled"),
    "alarm":      dict(bin=ALL_DEVICES, style="alldev", args=["--device", "smoke-co-alarm:1"],
                       port=5548, disc=0x848, node=108, expect=[], forbidden=True,
                       about="Smoke and CO alarm: must never be listed or controlled"),
}
ORDER = list(DEVICES)
# Every device has its own short discriminator (the top 4 bits, the only part an 11 digit code
# carries), so two codes never match the same device. The shared window uses another discriminator.
SHARE_DISC = {n: ((i + 1) << 8) | 0x90 for i, n in enumerate(ORDER)}


def err(*a):
    print(*a, file=sys.stderr, flush=True)


def out(obj):
    print(json.dumps(obj), flush=True)


def ensure_dirs():
    for d in (FX, RUN, KVS, HOMESTORE):
        os.makedirs(d, exist_ok=True)


def pid_of(name):
    try:
        pid = int(open(os.path.join(RUN, name + ".pid")).read().strip())
        os.kill(pid, 0)
        return pid
    except Exception:
        return None


def device_cmd(name):
    d = DEVICES[name]
    kvs = os.path.join(KVS, name)
    pipe = os.path.join(RUN, name + ".pipe")
    if d["style"] == "alldev":
        return [d["bin"], *d["args"], "--KVS", kvs, "--port", str(d["port"]),
                "--discriminator", str(d["disc"]), "--app-pipe", pipe]
    return [d["bin"], *d["args"], "--KVS", kvs, "--secured-device-port", str(d["port"]),
            "--discriminator", str(d["disc"]), "--passcode", str(PASSCODE), "--app-pipe", pipe]


def start(names):
    ensure_dirs()
    started = []
    for n in names:
        if pid_of(n):
            continue
        d = DEVICES[n]
        if not os.path.exists(d["bin"]):
            err(f"{n}: binary missing: {d['bin']} (run build-fixtures.sh)")
            continue
        logf = open(os.path.join(RUN, n + ".log"), "ab")
        # The chef app (cover) runs a shell on stdin and quits at end of input: give every device a
        # FIFO opened read+write as stdin, so it never sees end of input.
        fifo = os.path.join(RUN, n + ".stdin")
        if not os.path.exists(fifo):
            os.mkfifo(fifo)
        stdin_fd = os.open(fifo, os.O_RDWR)
        p = subprocess.Popen(device_cmd(n), stdout=logf, stderr=subprocess.STDOUT, stdin=stdin_fd,
                             start_new_session=True, cwd=RUN)
        open(os.path.join(RUN, n + ".pid"), "w").write(str(p.pid))
        started.append(n)
    # wait until each new device has finished starting (its server is up)
    deadline = time.time() + 20
    for n in started:
        while time.time() < deadline:
            if re.search(r"Server Listening|Server initialized|Started event loop|Device Configuration",
                         tail(n, 400)):
                break
            time.sleep(0.3)
        time.sleep(0.5)
        err(f"started {n} (pid {pid_of(n)}, port {DEVICES[n]['port']}, discriminator {DEVICES[n]['disc']})")
    return started


def stop(names=None):
    for n in names or ORDER:
        pid = pid_of(n)
        if pid:
            try:
                os.killpg(pid, signal.SIGTERM)
            except Exception:
                try:
                    os.kill(pid, signal.SIGTERM)
                except Exception:
                    pass
            for _ in range(30):
                if not pid_of(n):
                    break
                time.sleep(0.1)
            if pid_of(n):
                try:
                    os.killpg(pid, signal.SIGKILL)
                except Exception:
                    pass
            err(f"stopped {n}")
        try:
            os.remove(os.path.join(RUN, n + ".pid"))
        except FileNotFoundError:
            pass


def tail(name, n=60):
    try:
        with open(os.path.join(RUN, name + ".log"), "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 200 * n))
            lines = f.read().decode("utf-8", "replace").splitlines()[-n:]
        return "\n".join(re.sub(r"\x1b\[[0-9;]*m", "", l) for l in lines)
    except FileNotFoundError:
        return ""


# ---------------------------------------------------------------- chip-tool as the "home" controller

class Locked:
    def __enter__(self):
        t0 = time.time()
        while True:
            try:
                os.mkdir(LOCK)
                with open(os.path.join(LOCK, "pid"), "w") as f:
                    f.write(str(os.getpid()))
                return self
            except FileExistsError:
                if self.stale():
                    self.free()
                    continue
                if time.time() - t0 > 400:
                    raise SystemExit("chip-tool lock busy for 400 s")
                time.sleep(0.2)

    @staticmethod
    def stale():
        """Left by a dead fx: its pid is gone, or (no pid yet or unreadable) it is older than the
        longest a holder can take (3 tries of the 120 s home pairing, plus room: 400 s)."""
        try:
            with open(os.path.join(LOCK, "pid")) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            return False
        except ProcessLookupError:
            return True
        except (FileNotFoundError, ValueError, PermissionError):
            try:
                return time.time() - os.stat(LOCK).st_mtime > 400
            except FileNotFoundError:
                return False

    @staticmethod
    def free():
        try:
            os.remove(os.path.join(LOCK, "pid"))
        except FileNotFoundError:
            pass
        try:
            os.rmdir(LOCK)
        except (FileNotFoundError, OSError):
            pass

    def __exit__(self, *a):
        self.free()


def chip_tool(args, timeout=90):
    cmd = [CHIP_TOOL, *args, "--storage-directory", HOMESTORE]
    with Locked():
        for attempt in range(3):
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=FX)
                text = re.sub(r"\x1b\[[0-9;]*m", "", (r.stdout or "") + (r.stderr or ""))
            except subprocess.TimeoutExpired as e:
                return 124, str(e)
            # seen once in a full run: chip-tool read its own storage mid write. Try again.
            if r.returncode != 0 and "CA certificate not found" in text and attempt < 2:
                time.sleep(1)
                continue
            return r.returncode, text


def home_paired():
    try:
        return set(json.load(open(os.path.join(FX, "home.json"))))
    except Exception:
        return set()


def set_home_paired(names):
    json.dump(sorted(names), open(os.path.join(FX, "home.json"), "w"))


def home(names):
    done = home_paired()
    results = {}
    for n in names:
        if n in done:
            results[n] = "already"
            continue
        if not pid_of(n):
            results[n] = "not running"
            continue
        d = DEVICES[n]
        ok = False
        for attempt in range(3):
            rc, text = chip_tool(["pairing", "onnetwork-long", str(d["node"]), str(PASSCODE), str(d["disc"])],
                                 timeout=120)
            if rc == 0 and "Device commissioning completed with success" in text:
                ok = True
                break
            err(f"{n}: home pairing attempt {attempt + 1} failed: {last_error(text)}")
            time.sleep(2)
        results[n] = "paired" if ok else "failed"
        if ok:
            done.add(n)
            set_home_paired(done)
    return results


def last_error(text):
    errs = [l for l in text.splitlines() if "rror" in l or "fail" in l.lower()]
    return (errs[-1] if errs else text.strip().splitlines()[-1] if text.strip() else "")[-300:]


def share(name, secs=300):
    d = DEVICES[name]
    secs = max(180, min(900, int(secs)))  # Matter allows a window of 3 to 15 minutes
    rc, text = chip_tool(["pairing", "open-commissioning-window", str(d["node"]), "1", str(secs), "1000",
                          str(SHARE_DISC[name])], timeout=60)
    m = re.search(r"Manual pairing code: \[(\d+)\]", text)
    q = re.search(r"SetupQRCode: \[(MT:[^\]]+)\]", text)
    if not m:
        raise SystemExit(f"{name}: could not open a commissioning window: {last_error(text)}")
    return {"name": name, "manual": m.group(1), "qr": q.group(1) if q else None,
            "discriminator": SHARE_DISC[name], "seconds": secs}


def wrongcode(name):
    """A valid looking manual code (right discriminator, good check digit) with a wrong passcode."""
    return {"name": name, "manual": manual_code(SHARE_DISC[name], 12348765)}


def revoke(name):
    d = DEVICES[name]
    rc, text = chip_tool(["administratorcommissioning", "revoke-commissioning", str(d["node"]), "0",
                          "--timedInteractionTimeoutMs", "10000"])
    return {"name": name, "ok": rc == 0}


CLUSTER_ALIASES = {"onoff": "onoff", "level": "levelcontrol", "levelcontrol": "levelcontrol",
                   "color": "colorcontrol", "colorcontrol": "colorcontrol", "thermostat": "thermostat",
                   "fan": "fancontrol", "fancontrol": "fancontrol", "cover": "windowcovering",
                   "windowcovering": "windowcovering", "temperature": "temperaturemeasurement",
                   "temperaturemeasurement": "temperaturemeasurement",
                   "humidity": "relativehumiditymeasurement",
                   "relativehumiditymeasurement": "relativehumiditymeasurement",
                   "booleanstate": "booleanstate", "occupancy": "occupancysensing",
                   "occupancysensing": "occupancysensing", "doorlock": "doorlock", "basic": "basicinformation",
                   "basicinformation": "basicinformation", "descriptor": "descriptor",
                   "operationalcredentials": "operationalcredentials", "smokecoalarm": "smokecoalarm"}


def parse_value(raw):
    raw = raw.strip()
    if raw in ("TRUE", "FALSE"):
        return raw == "TRUE"
    if raw == "null":
        return None
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        return raw


def read(name, cluster, attribute, ep="1"):
    d = DEVICES[name]
    cl = CLUSTER_ALIASES.get(cluster.lower(), cluster.lower())
    rc, text = chip_tool([cl, "read", attribute, str(d["node"]), str(ep)], timeout=60)
    # chip-tool prints the attribute report as "[TOO] Endpoint: 1 Cluster: ... Attribute ... DataVersion: n"
    # followed by "[TOO]   AttributeName: value"
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if "[TOO] Endpoint:" in l and "Attribute" in l:
            for nxt in lines[i + 1:i + 4]:
                m = re.search(r"\[TOO\]\s+([A-Za-z0-9]+): (.*)$", nxt)
                if m:
                    return {"name": name, "cluster": cl, "attribute": attribute, "endpoint": int(ep),
                            "value": parse_value(m.group(2))}
    raise SystemExit(f"{name}: read {cl} {attribute} failed: {last_error(text)}")


def do(name, args):
    d = DEVICES[name]
    args = [str(d["node"]) if a == "NODE" else a for a in args]
    rc, text = chip_tool(args, timeout=60)
    ok = rc == 0 and "status = 0x" not in text.lower().replace("status = 0x00", "")
    return {"name": name, "ok": rc == 0, "detail": "" if rc == 0 else last_error(text)}


def fabrics(name):
    return {"name": name, "fabrics": read(name, "operationalcredentials", "commissioned-fabrics", "0")["value"]}


def evict(name):
    """Removes every controller except "home" from the device (clean up after a run that did not
    remove its devices). Same as the person deleting Couch TV from "Connected services"."""
    d = DEVICES[name]
    mine = read(name, "operationalcredentials", "current-fabric-index", "0")["value"]
    rc, text = chip_tool(["operationalcredentials", "read", "fabrics", str(d["node"]), "0", "--fabric-filtered", "0"])
    idx = sorted({int(m) for m in re.findall(r"FabricIndex: (\d+)", text)} - {mine})
    for i in idx:
        chip_tool(["operationalcredentials", "remove-fabric", str(i), str(d["node"]), "0"])
    return {"name": name, "removed_fabric_indexes": idx, "fabrics": fabrics(name)["fabrics"]}


def pipe(name, payload):
    path = os.path.join(RUN, name + ".pipe")
    if not os.path.exists(path):
        raise SystemExit(f"{name}: no app pipe at {path}")
    fd = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
    os.write(fd, (payload.strip() + "\n").encode())
    os.close(fd)
    return {"name": name, "sent": json.loads(payload)}


_VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
       [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
       [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
       [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4]]
for _i in range(2, 8):
    _VP.append([_VP[_i - 1][_VP[1][j]] for j in range(10)])
_VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff(digits):
    c = 0
    for i, d in enumerate(reversed(digits)):
        c = _VD[c][_VP[(i + 1) % 8][int(d)]]
    return str(_VINV[c])


def manual_code(disc, pin):
    """Matter 11 digit manual pairing code (Matter core spec 5.1.4.1)."""
    short = (disc >> 8) & 0xF
    body = f"{short >> 2}{((short & 0x3) << 14) | (pin & 0x3FFF):05d}{pin >> 14:04d}"
    return body + verhoeff(body)


def manualcode(disc, pin=PASSCODE):
    return manual_code(disc, pin)


def status():
    paired = home_paired()
    return {"host": lan_address(), "devices": [{"name": n, "running": bool(pid_of(n)), "pid": pid_of(n), "port": d["port"],
                         "discriminator": d["disc"], "home_node": d["node"], "in_home": n in paired,
                         "share_discriminator": SHARE_DISC[n], "expect": d["expect"],
                         "forbidden": bool(d.get("forbidden")), "about": d["about"]}
                        for n, d in DEVICES.items()]}


def lan_address():
    """This Mac's address on the home network (the harness sends <host>:1 to test address errors)."""
    for ifc in ("en0", "en1"):
        try:
            r = subprocess.run(["ipconfig", "getifaddr", ifc], capture_output=True, text=True, timeout=5)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except Exception:
            pass
    return None


def names_from(args):
    if not args:
        return ORDER
    bad = [a for a in args if a not in DEVICES]
    if bad:
        raise SystemExit(f"unknown device(s): {bad}; known: {ORDER}")
    return args


def fabrics_answer(args):
    """`fx fabrics <name>` answers {"name", "fabrics"} (what tests/matter_contract.py reads);
    `fx fabrics` with no name or several answers {"devices": [{"name", "fabrics"}, ...]}."""
    names = names_from(args)
    if len(args) == 1:
        return fabrics(names[0])
    return {"devices": [fabrics(n) for n in names]}


# One contract run at a time on these devices: two runs at once see each other's controllers
# (3 fabrics, "busy"). The lock is a folder next to this kit (~/matter-fixtures.lock; a private
# copy in ~/<other> gets ~/<other>.lock), taken with mkdir so it is atomic.
LOCKDIR = FX.rstrip("/") + ".lock"


def lock_info():
    try:
        with open(os.path.join(LOCKDIR, "owner.json")) as f:
            return json.load(f)
    except Exception:
        return {}


def take_lock(token, about=""):
    """Takes the run lock for `token`. Answers {"ok": true} or {"ok": false, "held_by": {...}}."""
    if not token:
        raise SystemExit("fx lock <token> [about]: a token is needed (the same one unlocks)")
    try:
        os.mkdir(LOCKDIR)
    except FileExistsError:
        held = lock_info()
        if held.get("token") == token:
            return {"ok": True, "again": True}
        held = {k: v for k, v in held.items() if k != "token"}
        held["age_s"] = int(time.time() - held["since"]) if "since" in held else None
        return {"ok": False, "held_by": held, "lock": LOCKDIR}
    with open(os.path.join(LOCKDIR, "owner.json"), "w") as f:
        json.dump({"token": token, "about": about, "since": time.time(),
                   "since_text": time.strftime("%Y-%m-%d %H:%M:%S")}, f)
    return {"ok": True, "lock": LOCKDIR}


def drop_lock(token):
    """Gives the run lock back. Only its own token frees it, or `--force` (after a run that died)."""
    if not os.path.isdir(LOCKDIR):
        return {"ok": True, "held": False}
    held = lock_info()
    if token != "--force" and held.get("token") not in (None, token):
        return {"ok": False, "held_by": {k: v for k, v in held.items() if k != "token"}}
    owner = os.path.join(LOCKDIR, "owner.json")
    if os.path.exists(owner):
        os.remove(owner)
    os.rmdir(LOCKDIR)
    return {"ok": True, "held": False}


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    cmd, args = argv[0], argv[1:]
    ensure_dirs()
    if cmd == "start":
        start(names_from(args))
        out(status())
    elif cmd == "stop":
        stop(names_from(args) if args else None)
    elif cmd == "status":
        out(status())
    elif cmd == "home":
        out(home(names_from(args)))
    elif cmd == "up":
        names = names_from(args)
        start(names)
        out(home(names))
    elif cmd == "share":
        out(share(args[0], int(args[1]) if len(args) > 1 else 300))
    elif cmd == "wrongcode":
        out(wrongcode(args[0]))
    elif cmd == "revoke":
        out(revoke(args[0]))
    elif cmd == "read":
        out(read(*args[:4]))
    elif cmd == "do":
        out(do(args[0], args[1:]))
    elif cmd == "fabrics":
        out(fabrics_answer(args))
    elif cmd == "lock":
        out(take_lock(args[0] if args else "", " ".join(args[1:])))
    elif cmd == "unlock":
        out(drop_lock(args[0] if args else ""))
    elif cmd == "evict":
        out([evict(n) for n in names_from(args)])
    elif cmd == "pipe":
        out(pipe(args[0], args[1]))
    elif cmd == "log":
        print(tail(args[0], int(args[1]) if len(args) > 1 else 60))
    elif cmd == "codes":
        out({n: {"manual": manualcode(d["disc"]), "discriminator": d["disc"], "passcode": PASSCODE,
                 "port": d["port"]} for n, d in DEVICES.items()})
    elif cmd == "reset":
        stop()
        for n in ORDER:
            for suffix in ("", "-shm", "-wal"):
                p = os.path.join(KVS, n + suffix)
                if os.path.exists(p):
                    os.remove(p)
        for f in os.listdir(HOMESTORE):
            os.remove(os.path.join(HOMESTORE, f))
        for f in ("home.json",):
            if os.path.exists(os.path.join(FX, f)):
                os.remove(os.path.join(FX, f))
        err("reset: devices stopped, device storage and home fabric wiped")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
