#!/usr/bin/env python3
"""Matter contract test: runs against ANY implementation of the couch-tv Matter API.

The implementation under test is the on-TV app (http://<tv>:5400 with its pairing token), the
bridge (http://<computer>:8765 with its pairing key) or the chip-tool reference server
(tests/matter/reference_server.py). The devices are the virtual Matter devices on the MacBook
(tests/matter/fixtures/fx.py), driven over ssh. Every state check reads the device itself through
the fixtures' own "home" controller, never the implementation's word for it.

  python3 tests/matter_contract.py --api http://<tv>:5400 --token <token>
  python3 tests/matter_contract.py --api http://127.0.0.1:8765 --token <key> --only errors,light
  python3 tests/matter_contract.py --api http://<macbook>:5490 --token test   # reference server

Before a run: `ssh macbook matter-fixtures/fx up` (starts the devices and puts them in the home
fabric). Details: docs/MATTER-TESTING.md. Python 3.9+, standard library only.
"""
import argparse
import json
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ALLOWED_DOMAINS = {"light", "switch", "fan", "cover", "climate", "sensor"}
ERROR_KEYS = {"expired", "wrong_code", "unreachable", "thread"}
# Added to the contract later (changes 10 and 11): a shared lock, alarm or garage door, and a device
# that is already on this controller.
EXTRA_ERROR_KEYS = {"not_allowed", "already"}
# Contract change 14: `reason` keys the screens word in every language.
READY_REASONS = {"off", "not_installed", "node_missing", "node_old", "starting", "stopped",  # bridge
                 "android_old", "processor", "not_started"}                                  # on-TV
NOT_ALLOWED_REASONS = {"blocked", "unsupported"}
ADDRESS_REASONS = {"address", "port", "link_local"}
REMOVE_OFFLINE_REASONS = {"offline", "not_answering"}
FAILED_COMMISSION_S = 35  # change 10: a failed commission answers within about 30 s (WARN above this)
GROUPS = ["auth", "errors", "commission", "list", "light", "plug", "thermostat", "cover", "fan", "sensors",
          "live", "events", "rename", "forbidden", "offline", "remove"]
CONTROLLED = ["light", "plug", "thermostat", "cover", "fan", "sensors"]

# ---------------------------------------------------------------- results

RESULTS = []
VERBOSE = False


def check(name, ok, why="", warn=False):
    status = "PASS" if ok else ("WARN" if warn else "FAIL")
    RESULTS.append((status, name, "" if ok else why))
    line = f"{status} {name}" + ("" if ok else f": {why}")
    print(line, flush=True)
    return ok


def info(msg):
    print(f"     {msg}", flush=True)


# ---------------------------------------------------------------- the API under test

class Api:
    def __init__(self, base, token, timeout):
        self.base = base.rstrip("/")
        self.token = token
        self.timeout = timeout

    def call(self, method, path, body=None, token=True, timeout=None):
        url = self.base + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if token and self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception as e:  # connection refused, timeout
            return 0, {"_transport_error": str(e)}, time.time() - t0
        try:
            obj = json.loads(raw.decode() or "{}")
        except ValueError:
            obj = {"_raw": raw[:300].decode("utf-8", "replace")}
        # Responses may be bare or wrapped in {result: ...} (matter-ui-needs.md 5)
        if isinstance(obj, dict) and isinstance(obj.get("result"), dict) and "ok" not in obj:
            obj = obj["result"]
        elif isinstance(obj, dict) and isinstance(obj.get("result"), dict) and obj.get("ok") is True:
            merged = dict(obj["result"])
            merged.setdefault("ok", True)
            obj = merged
        if VERBOSE:
            info(f"{method} {path} {json.dumps(body) if body else ''} -> {status} {json.dumps(obj)[:400]}")
        return status, obj, time.time() - t0

    def devices(self):
        s, o, _ = self.call("GET", "/api/matter/devices")
        return s, o, (o.get("devices") if isinstance(o, dict) else None) or []

    def commission(self, code, address=None):
        body = {"code": code}
        if address:
            body["address"] = address  # contract change 5: skips discovery (emulator, no multicast)
        return self.call("POST", "/api/matter/commission", body, timeout=180)

    def command(self, id_, action, value=None):
        body = {"id": id_, "action": action}
        if value is not None:
            body["value"] = value
        return self.call("POST", "/api/matter/command", body, timeout=60)


# ---------------------------------------------------------------- the virtual devices

class Fx:
    def __init__(self, cmd):
        self.cmd = shlex.split(cmd)

    def run(self, *args, timeout=240):
        a = [str(x) for x in args]
        if self.cmd and os.path.basename(self.cmd[0]) == "ssh":
            a = [shlex.quote(x) for x in a]  # ssh joins the words into one remote shell line
        r = subprocess.run(self.cmd + a, capture_output=True, text=True, timeout=timeout)
        lines = [l for l in r.stdout.splitlines() if l.strip().startswith("{")]
        if r.returncode != 0 or not lines:
            raise RuntimeError(f"fx {' '.join(map(str, args))} failed: {(r.stderr or r.stdout).strip()[-300:]}")
        return json.loads(lines[-1])

    def read(self, name, cluster, attr, ep=1):
        return self.run("read", name, cluster, attr, ep)["value"]

    def do(self, name, *args):
        return self.run("do", name, *args)

    def share(self, name, secs=300):
        return self.run("share", name, secs)

    def fabrics(self, name):
        return fabrics_of(self.run("fabrics", name), name)

    def lock(self, token, about):
        return self.run("lock", token, about, timeout=60)

    def unlock(self, token):
        return self.run("unlock", token, timeout=60)


def fabrics_of(answer, name):
    """The fabric count from `fx fabrics <name>`: {"name", "fabrics"} (also takes the
    {"devices": [...]} form `fx fabrics` gives for several devices)."""
    if "fabrics" in answer:
        return answer["fabrics"]
    for d in answer.get("devices", []):
        if d.get("name") == name:
            return d["fabrics"]
    raise KeyError(f"fx fabrics answered no count for {name}: {json.dumps(answer)[:200]}")


def lock_token():
    return f"{socket.gethostname()}-{os.getpid()}-{int(time.time())}"


def take_fixture_lock(fx, about, wait_s, every=30, token=None):
    """One contract run at a time on the shared fixtures (two at once corrupt each other: a busy
    light, 3 fabrics). Waits up to wait_s for the lock; answers the token, or None if still held."""
    token = token or lock_token()
    end = time.time() + wait_s
    while True:
        r = fx.lock(token, about)
        if r.get("ok"):
            return token
        held = r.get("held_by") or {}
        msg = (f"The Matter fixtures are in use by another run ({held.get('about') or 'unknown'}, "
               f"since {held.get('since_text', '?')}, {held.get('age_s', '?')} s ago).")
        if time.time() + every > end:
            print(msg + f" Gave up after {wait_s:.0f} s. If that run died, free it with: "
                  f"{' '.join(fx.cmd)} unlock --force", file=sys.stderr, flush=True)
            return None
        print(msg + f" Waiting, trying again in {every} s.", file=sys.stderr, flush=True)
        time.sleep(every)


def wait_for(fn, timeout, every=1.0):
    """Polls fn() until it returns a truthy value or the time runs out; returns the last value."""
    end = time.time() + timeout
    last = None
    while True:
        try:
            last = fn()
        except Exception as e:  # a read can fail while a device is busy
            last = None
            if VERBOSE:
                info(f"poll: {e}")
        if last:
            return last
        if time.time() > end:
            return last
        time.sleep(every)


# ---------------------------------------------------------------- helpers

PLAIN_BAD = re.compile(r"CHIP|0x[0-9a-f]{2,}|Exception|Traceback|errno|null pointer|stack|\.kt:|\.py:", re.I)


def plain(text):
    return isinstance(text, str) and 0 < len(text) <= 240 and not PLAIN_BAD.search(text)


def parse_id(id_):
    m = re.fullmatch(r"matter:([0-9A-Fa-fx]+):(\d+)", id_ or "")
    return (m.group(1).lower(), int(m.group(2))) if m else (None, None)


def by_id(devs):
    return {d.get("id"): d for d in devs if isinstance(d, dict)}


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def near(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def refusal_reason(label, o):
    """Change 15: every refusal carries a reason key. Commission errors FAIL without one (expect_error);
    the other refusals (command, rename, remove) here."""
    if o.get("ok") is False:
        check(f"{label}: the refusal carries a reason key (change 15)", isinstance(o.get("reason"), str)
              and o["reason"], f"answered {json.dumps(o)[:160]}")


def brightness_pct(attrs):
    """light brightness as 0-100 from either brightness 0-255 or level 0-100."""
    if num(attrs.get("brightness")) is not None:
        return num(attrs["brightness"]) * 100 / 255
    if num(attrs.get("level")) is not None:
        return num(attrs["level"])
    return None


def short_disc_code(disc, pin):
    """Matter 11 digit manual code (same encoder as the fixtures)."""
    d = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
         [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
         [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
         [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
    p = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4]]
    for i in range(2, 8):
        p.append([p[i - 1][p[1][j]] for j in range(10)])
    inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]
    short = (disc >> 8) & 0xF
    body = f"{short >> 2}{((short & 0x3) << 14) | (pin & 0x3FFF):05d}{pin >> 14:04d}"
    c = 0
    for i, ch in enumerate(reversed(body)):
        c = d[c][p[(i + 1) % 8][int(ch)]]
    return body + str(inv[c])


# ---------------------------------------------------------------- the run

class Run:
    def __init__(self, api, fx, args):
        self.api, self.fx, self.args = api, fx, args
        self.ids = {}       # fixture name -> [device ids the implementation returned]
        self.node = {}      # fixture name -> node id string inside the implementation's ids
        self.meta = {}

    # ---- groups

    def g_auth(self):
        s, o, _ = self.api.call("GET", "/api/matter/devices", token=False)
        check("auth: GET /api/matter/devices without the token is refused", s in (401, 403),
              f"answered {s} {json.dumps(o)[:120]}")
        s, o, _ = self.api.call("POST", "/api/matter/command", {"id": "matter:1:1", "action": "on"}, token=False)
        check("auth: POST /api/matter/command without the token is refused", s in (401, 403), f"answered {s}")
        s, o, devs = self.api.devices()
        check("list: GET /api/matter/devices answers 200 with devices[] and ready", s == 200 and isinstance(
            o.get("devices"), list) and isinstance(o.get("ready"), bool), f"answered {s} {json.dumps(o)[:200]}")
        if o.get("note") is not None:
            check("list: note is plain words", plain(o["note"]), repr(o["note"]))
        if o.get("ready") is False:  # contract change 14: why it is not ready, as a key the screens word
            check(f"list: not ready carries a reason key from {sorted(READY_REASONS)}", o.get("reason") in READY_REASONS,
                  f"reason={o.get('reason')!r}")
        check("list: ready is true (the controller is up)", o.get("ready") is True, f"ready={o.get('ready')}")

    def expect_error(self, label, code, keys, max_s=120, address=None):
        s, o, dt = self.api.commission(code, address)
        err = o.get("error")
        okflag = o.get("ok")
        check(f"errors: {label}: ok is false", okflag is False and s != 0, f"answered {s} {json.dumps(o)[:200]}")
        check(f"errors: {label}: error key is one of {sorted(keys)}", err in keys,
              f"error={err!r} (keys allowed by the contract: {sorted(ERROR_KEYS)})")
        check(f"errors: {label}: device_ids is []", o.get("device_ids") == [], f"device_ids={o.get('device_ids')!r}")
        check(f"errors: {label}: carries a reason key (change 15)", isinstance(o.get("reason"), str) and o["reason"],
              f"reason={o.get('reason')!r}")
        check(f"errors: {label}: has a note in plain words", isinstance(o.get("note"), str) and o["note"].strip()
              and plain(o["note"]), repr(o.get("note")))
        check(f"errors: {label}: answers within {max_s} s", dt <= max_s, f"took {dt:.0f} s")
        check(f"errors: {label}: answers within about 30 s (change 10)", dt <= FAILED_COMMISSION_S,
              f"took {dt:.0f} s", warn=True)
        info(f"{label}: error={err!r} reason={o.get('reason')!r} note={o.get('note')!r} in {dt:.1f} s")
        return o

    def g_errors(self):
        self.expect_error("malformed code '12345'", "12345", {"wrong_code"}, 15)
        good = short_disc_code(0x141, 20202021)
        bad_check = good[:-1] + str((int(good[-1]) + 1) % 10)
        self.expect_error("11 digits with a bad check digit", bad_check, {"wrong_code"}, 15)
        self.expect_error("QR text that is not a Matter QR", "MT:NOTAREALCODE", {"wrong_code"}, 15)
        # a well formed code no device answers to (short discriminator 15 is unused by the fixtures)
        # ... and while that one is still looking, a second commission answers "busy" at once (change 15)
        import threading
        nobody = short_disc_code(0xF00, 20202021)
        first = threading.Thread(target=self.expect_error, args=(
            "a code no device on the network answers to", nobody, {"unreachable", "expired"}, 120))
        first.start()
        time.sleep(2)  # the first one is now looking for the device (it takes about 30 s to give up)
        if first.is_alive():
            s, o, dt = self.api.commission(nobody)
            info(f"second commission while one runs: answered {s} {json.dumps(o)[:200]} in {dt:.1f} s")
            check("errors: a second commission while one runs answers ok false, error 'busy', reason 'busy'",
                  o.get("ok") is False and o.get("error") == "busy" and o.get("reason") == "busy",
                  f"answered {s} {json.dumps(o)[:200]}")
            check("errors: the 'busy' answer comes at once (under 5 s)", dt < 5, f"took {dt:.1f} s")
            check("errors: the 'busy' answer is HTTP 409 or 400", s in (409, 400), f"answered {s}")
        else:
            check("errors: a second commission while one runs ('busy')", False,
                  "the first commission ended within 2 s, so busy could not be tried", warn=True)
        first.join()
        # right device, window open, wrong passcode
        sh = self.fx.share("light", 300)
        wrong = self.fx.run("wrongcode", "light")["manual"]
        self.expect_error("the right device with the wrong passcode", wrong, {"wrong_code"}, 120,
                          self.address("light"))
        # contract change 14: an address that cannot work answers unreachable with a reason key
        host = self.args.address or self.fx_host()
        for addr, label, want in ((f"{host}:1", f"the light's code with address <host>:1", ADDRESS_REASONS),
                                  # port 5540 passes the bridge's port rule: link_local is the only possible reason
                                  ("[fe80::1]:5540", "the light's code with a link local address [fe80::1]:5540",
                                   {"link_local"})):
            o = self.expect_error(label, sh["manual"], {"unreachable"}, 120, addr)
            check(f"errors: {label}: reason is one of {sorted(want)}", o.get("reason") in want,
                  f"reason={o.get('reason')!r}")
        # the shared window closed (Google Home's code timed out or was cancelled)
        self.fx.run("revoke", "light")
        time.sleep(2)
        self.expect_error("a shared code whose window has closed", sh["manual"], {"expired", "unreachable"}, 120,
                          self.address("light"))
        if self.args.slow:
            sh = self.fx.share("light", 180)
            info("waiting 185 s for a real 180 s window to run out")
            time.sleep(185)
            self.expect_error("a shared code after its 3 minutes ran out", sh["manual"], {"expired", "unreachable"},
                              120)
        check("errors: the light is still only in the home fabric after the failed tries",
              self.fx.fabrics("light") == 1, f"fabrics={self.fx.fabrics('light')}")

    def commission(self, name, use_qr=False):
        before = set(by_id(self.api.devices()[2]))
        sh = self.fx.share(name, 600)
        code = sh["qr"] if use_qr and sh.get("qr") else sh["manual"]
        s, o, dt = self.api.commission(code, self.address(name))
        ids = o.get("device_ids") or []
        ok = check(f"commission: {name} by {'QR text' if use_qr else '11 digit code'} answers ok with device_ids",
                   s == 200 and o.get("ok") is True and isinstance(ids, list) and len(ids) > 0,
                   f"answered {s} {json.dumps(o)[:240]}")
        info(f"{name}: {dt:.1f} s, device_ids={ids}")
        if not ok:
            self.fx.run("revoke", name)
            return
        nodes = {parse_id(i)[0] for i in ids}
        check(f"commission: {name} ids look like matter:<node>:<endpoint>, one node",
              None not in nodes and len(nodes) == 1, f"ids={ids}")
        check(f"commission: {name} ids are new", not (set(ids) & before), f"already listed before: {set(ids) & before}")
        check(f"commission: {name} answers within 120 s", dt <= 120, f"took {dt:.0f} s")
        fab = self.fx.fabrics(name)
        check(f"commission: {name} really joined (the device now has 2 fabrics: home + the implementation)",
              fab == 2, f"the device reports {fab} fabric(s)")
        self.ids[name] = ids
        self.node[name] = nodes.pop()

    def fx_host(self):
        """The fixtures' own LAN address (fx status "host"), else the API's host."""
        from urllib.parse import urlparse
        return self.fx.run("status").get("host") or urlparse(self.api.base).hostname

    def address(self, name):
        if not self.args.address:
            return None
        port = {d["name"]: d["port"] for d in self.fx.run("status")["devices"]}[name]
        host = self.args.address
        return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"

    def g_commission(self):
        for n in self.args.devices:
            if n in self.ids:
                continue
            self.commission(n, use_qr=(n == "sensors"))
        if "light" in self.ids:
            self.share_again("light")

    def share_again(self, name):
        """Contract changes 11 and 13: a device shared to the same controller twice answers ok false,
        error "already". No second entry and no third fabric."""
        before = by_id(self.api.devices()[2])
        sh = self.fx.share(name, 300)
        s, o, dt = self.api.commission(sh["manual"], self.address(name))
        info(f"{name} shared again: answered {s} {json.dumps(o)[:200]} in {dt:.1f} s")
        check(f"commission: {name} shared a second time answers ok false, error 'already'",
              o.get("ok") is False and o.get("error") == "already", f"answered {s} {json.dumps(o)[:200]}")
        check(f"commission: the 'already' answer carries a reason key (change 15)",
              isinstance(o.get("reason"), str) and o["reason"], f"reason={o.get('reason')!r}")
        if o.get("note") is not None:
            check(f"commission: the note for a second share is plain words", plain(o["note"]), repr(o["note"]))
        after = by_id(self.api.devices()[2])
        check(f"commission: {name} shared a second time adds no entry", set(after) == set(before),
              f"new: {sorted(set(after) - set(before))}, gone: {sorted(set(before) - set(after))}")
        self.fx.run("revoke", name)
        check(f"commission: {name} shared a second time still has 2 fabrics (home + the implementation)",
              wait_for(lambda: self.fx.fabrics(name) == 2, 15, 2), f"the device reports {self.fx.fabrics(name)} fabrics")

    def entity(self, name, ep=1):
        if name not in self.node:
            return None
        id_ = f"matter:{self.node[name]}:{ep}"
        for d in self.api.devices()[2]:
            if parse_id(d.get("id")) == (self.node[name], ep):
                return d
        return None

    def g_list(self):
        status = self.fx.run("status")
        expect = {d["name"]: d["expect"] for d in status["devices"]}
        s, o, devs = self.api.devices()
        ids = by_id(devs)
        for d in devs:
            check(f"list: {d.get('id')} has id, name, domain, state, attributes",
                  isinstance(d.get("id"), str) and isinstance(d.get("name"), str) and d.get("name")
                  and d.get("domain") in ALLOWED_DOMAINS and "state" in d and isinstance(d.get("attributes"), dict),
                  json.dumps(d)[:240])
            a = d.get("attributes") if isinstance(d.get("attributes"), dict) else {}
            check(f"list: {d.get('id')} has attributes.friendly_name", isinstance(a.get("friendly_name"), str)
                  and a.get("friendly_name"), f"attributes={a}")
        for n in self.args.devices:
            if n not in self.node:
                continue
            listed = sorted(parse_id(i)[1] for i in ids if parse_id(i)[0] == self.node[n])
            want = sorted(e["ep"] for e in expect[n])
            check(f"list: {n} lists exactly endpoints {want}", listed == want, f"listed {listed}")
            for e in expect[n]:
                d = self.entity(n, e["ep"])
                if not d:
                    continue
                check(f"list: {n} endpoint {e['ep']} has domain {e['domain']}", d.get("domain") == e["domain"],
                      f"domain={d.get('domain')}")
                # a controller reads (or subscribes to) a new device straight away: allow the live time
                ok = wait_for(lambda n=n, e=e: (self.entity(n, e["ep"]) or {}).get("state") not in (None, "unavailable"),
                              self.args.live_timeout, 0.5)
                check(f"list: {n} endpoint {e['ep']} is not unavailable", bool(ok),
                      f"state={(self.entity(n, e['ep']) or {}).get('state')}")
                d = self.entity(n, e["ep"]) or d  # read again now that it has a state
                a = d.get("attributes") or {}
                if e["domain"] == "switch":
                    check(f"list: {n} state is exactly on or off", d.get("state") in ("on", "off"),
                          f"state={d.get('state')!r}")
                if e["domain"] == "sensor" and e["device_class"] == "contact":
                    check("list: contact sensor state is on or off (on = open, as Home Assistant)",
                          d.get("state") in ("on", "off"), f"state={d.get('state')!r}")
                    check("list: contact sensor reading is open or closed and agrees with the state",
                          a.get("reading") == {"on": "open", "off": "closed"}.get(d.get("state")),
                          f"state={d.get('state')!r} reading={a.get('reading')!r}")
                if e["domain"] == "sensor":
                    check(f"list: {n} endpoint {e['ep']} device_class is {e['device_class']}",
                          a.get("device_class") == e["device_class"], f"attributes={a}")
                    if e["device_class"] in ("temperature", "humidity"):
                        unit = {"temperature": "°C", "humidity": "%"}[e["device_class"]]
                        check(f"list: {n} {e['device_class']} unit_of_measurement is {unit}",
                              a.get("unit_of_measurement") == unit, f"unit={a.get('unit_of_measurement')!r}")
                        # the simulated sensors drift all the time: compare with the device's
                        # readings just before and just after, with a little room
                        cl = e["device_class"]
                        r1 = self.fx.read(n, cl, "measured-value", e["ep"]) / 100
                        st = num((self.entity(n, e["ep"]) or {}).get("state"))
                        r2 = self.fx.read(n, cl, "measured-value", e["ep"]) / 100
                        room = 0.5 if cl == "temperature" else 2
                        check(f"list: {n} {cl} state matches the device ({r1:g} to {r2:g})",
                              st is not None and min(r1, r2) - room <= st <= max(r1, r2) + room, f"state={st!r}")
                if e["domain"] == "climate":
                    for k in ("current_temperature", "temperature", "min_temp", "max_temp", "hvac_modes",
                              "target_temp_step", "hvac_action"):
                        check(f"list: thermostat has attribute {k}", k in a, f"attributes={sorted(a)}")
                    check("list: thermostat state is one of its hvac_modes",
                          d.get("state") in (a.get("hvac_modes") or []), f"state={d.get('state')!r}")
                if e["domain"] == "cover":
                    check("list: cover has current_position 0-100", num(a.get("current_position")) is not None,
                          f"attributes={a}")
                if e["domain"] == "fan":
                    check("list: fan has percentage", "percentage" in a, f"attributes={a}")
                if e["domain"] == "light":
                    self.light_attrs("list", d)

    def light_attrs(self, where, d):
        """Contract change 13: an OFF light may leave out brightness, level and color_temp_kelvin
        (as Home Assistant does); an ON light must carry them. The colour range is always there."""
        a, st = d.get("attributes") or {}, d.get("state")
        off = st == "off"
        check(f"{where}: light has brightness or level{' (off: may be left out)' if off else ''}",
              off or brightness_pct(a) is not None, f"state={st!r} attributes={a}")
        check(f"{where}: light has color_temp_kelvin{' (off: may be left out)' if off else ''}",
              off or num(a.get("color_temp_kelvin")) is not None, f"state={st!r} attributes={a}")
        for k in ("min_color_temp_kelvin", "max_color_temp_kelvin"):
            check(f"{where}: light has {k}", num(a.get(k)) is not None, f"attributes={a}")
        check(f"{where}: light has supported_color_modes (a list)",
              isinstance(a.get("supported_color_modes"), list) and a["supported_color_modes"], f"attributes={a}")

    # ---- commands

    def cmd(self, name, action, value=None, ep=1, expect_ok=True):
        id_ = f"matter:{self.node[name]}:{ep}"
        s, o, dt = self.api.command(id_, action, value)
        label = f"command: {name} {action}{'' if value is None else ' ' + json.dumps(value)}"
        if expect_ok:
            check(f"{label} answers ok with state", s == 200 and o.get("ok") is True and "state" in o,
                  f"answered {s} {json.dumps(o)[:200]}")
            # contract change 2: the full model entry after the change
            check(f"{label}: 'device' is the model entry for {id_}",
                  isinstance(o.get("device"), dict) and o["device"].get("id") == id_,
                  json.dumps(o.get("device"))[:160])
        else:
            check(f"{label} is refused (ok false)", o.get("ok") is False, f"answered {s} {json.dumps(o)[:200]}")
            refusal_reason(label, o)
        return o

    def device_is(self, label, name, cluster, attr, pred, ep=1, timeout=8):
        last = {}

        def probe():
            last["v"] = self.fx.read(name, cluster, attr, ep)
            return pred(last["v"])
        ok = wait_for(probe, timeout)
        return check(f"{label} (device {cluster}.{attr} = {last.get('v')!r})", bool(ok),
                     f"the device reads {last.get('v')!r}")

    def g_light(self):
        if "light" not in self.node:
            return
        self.cmd("light", "on")
        self.device_is("command: light on reaches the bulb", "light", "onoff", "on-off", lambda v: v is True)
        self.cmd("light", "off")
        self.device_is("command: light off reaches the bulb", "light", "onoff", "on-off", lambda v: v is False)
        self.cmd("light", "toggle")
        self.device_is("command: light toggle reaches the bulb", "light", "onoff", "on-off", lambda v: v is True)
        on = wait_for(lambda: (lambda d: d if d and d.get("state") == "on" else None)(self.entity("light")),
                      self.args.live_timeout, 0.5)
        check("command: light entity shows on after the toggle", bool(on),
              f"entity={json.dumps(self.entity('light'))[:200]}")
        if on:
            self.light_attrs("command: the light while on", on)
        self.cmd("light", "level", 50)
        self.device_is("command: light level 50 (%) reaches the bulb", "light", "level", "current-level",
                       lambda v: v is not None and 120 <= v <= 134)
        self.cmd("light", "temp", 2700)
        self.device_is("command: light temp 2700 (K) reaches the bulb", "light", "color",
                       "color-temperature-mireds", lambda v: v is not None and 366 <= v <= 375)
        self.cmd("light", "colour", "#0000ff")
        mode = self.fx.read("light", "color", "color-mode")
        if mode == 0:
            self.device_is("command: light colour #0000ff reaches the bulb as hue 240°", "light", "color",
                           "current-hue", lambda v: v is not None and 160 <= v <= 178)
        else:
            self.device_is("command: light colour #0000ff reaches the bulb as xy blue", "light", "color",
                           "current-x", lambda v: v is not None and 7000 <= v <= 12500)
            check("command: light colour put the bulb in a colour mode", mode in (0, 1, 3), f"color-mode={mode}")
        hue_before = self.fx.read("light", "color", "current-hue")
        x_before = self.fx.read("light", "color", "current-x")
        self.cmd("light", "colour", "120,100")
        if self.fx.read("light", "color", "color-mode") == 0:
            self.device_is("command: light colour '120,100' (h,s) reaches the bulb as hue 120°", "light", "color",
                           "current-hue", lambda v: v is not None and 78 <= v <= 92)
        else:
            self.device_is("command: light colour '120,100' (h,s) changes the bulb's colour", "light", "color",
                           "current-x", lambda v: v != x_before)
        hs = wait_for(lambda: (lambda a: a if isinstance(a, list) and len(a) == 2 and near(num(a[0]), 120, 8)
                                          else None)((self.entity("light") or {}).get("attributes", {}).get("hs_color")),
                      self.args.live_timeout, 0.5)
        check("command: light entity shows hs_color about [120, 100] after colour '120,100'", bool(hs),
              f"attributes={(self.entity('light') or {}).get('attributes')}")
        d = self.entity("light")
        if d:
            check("command: light entity shows the new brightness (about 50%)",
                  near(brightness_pct(d.get("attributes") or {}), 50, 3), f"attributes={d.get('attributes')}")

    def g_plug(self):
        if "plug" not in self.node:
            return
        for action, want in (("on", True), ("off", False), ("toggle", True), ("toggle", False)):
            self.cmd("plug", action)
            self.device_is(f"command: plug {action} reaches the plug", "plug", "onoff", "on-off",
                           lambda v, w=want: v is w)
        self.cmd("plug", "level", 50, expect_ok=False)

    def g_thermostat(self):
        if "thermostat" not in self.node:
            return
        modes = {"off": 0, "auto": 1, "cool": 3, "heat": 4}
        d = self.entity("thermostat")
        hvac = (d or {}).get("attributes", {}).get("hvac_modes") or []
        info(f"thermostat hvac_modes={hvac}")
        self.cmd("thermostat", "mode", "heat")
        self.device_is("command: thermostat mode heat reaches the device", "thermostat", "thermostat",
                       "system-mode", lambda v: v == 4)
        self.cmd("thermostat", "target", 22.5)
        self.device_is("command: thermostat target 22.5 °C sets the heating setpoint", "thermostat",
                       "thermostat", "occupied-heating-setpoint", lambda v: v == 2250)
        if "cool" in hvac:
            self.cmd("thermostat", "mode", "cool")
            self.device_is("command: thermostat mode cool reaches the device", "thermostat", "thermostat",
                           "system-mode", lambda v: v == 3)
            self.cmd("thermostat", "target", 24)
            self.device_is("command: thermostat target 24 °C in cool sets the cooling setpoint", "thermostat",
                           "thermostat", "occupied-cooling-setpoint", lambda v: v == 2400)
        self.cmd("thermostat", "mode", "off")
        self.device_is("command: thermostat mode off reaches the device", "thermostat", "thermostat",
                       "system-mode", lambda v: v == 0)
        self.cmd("thermostat", "mode", "not_a_mode", expect_ok=False)
        self.cmd("thermostat", "mode", "heat")
        d = self.entity("thermostat")
        if d:
            check("command: thermostat entity state follows (heat)", d.get("state") == "heat", f"state={d.get('state')}")

    def g_cover(self):
        if "cover" not in self.node:
            return
        # Home Assistant position is % OPEN; Matter stores % CLOSED in hundredths. 30% open = 7000.
        self.cmd("cover", "position", 30)
        self.device_is("command: cover position 30 (% open) sets the lift target to 70% closed", "cover", "cover",
                       "target-position-lift-percent100ths", lambda v: v == 7000)
        self.cmd("cover", "level", 40)  # change 2: "level" is the cover's position too
        self.device_is("command: cover level 40 (% open) sets the lift target to 60% closed", "cover", "cover",
                       "target-position-lift-percent100ths", lambda v: v == 6000)
        self.cmd("cover", "position", 100)
        self.device_is("command: cover position 100 opens it fully", "cover", "cover",
                       "target-position-lift-percent100ths", lambda v: v == 0)
        self.cmd("cover", "off")
        self.device_is("command: cover off closes it", "cover", "cover", "target-position-lift-percent100ths",
                       lambda v: v == 10000)
        self.cmd("cover", "on")
        self.device_is("command: cover on opens it", "cover", "cover", "target-position-lift-percent100ths",
                       lambda v: v == 0)
        d = wait_for(lambda: (lambda e: e if e and num(e.get("attributes", {}).get("current_position")) == 100
                              else None)(self.entity("cover")), 10)
        check("command: cover entity shows current_position 100 and state open",
              bool(d) and d.get("state") == "open", f"entity={json.dumps(self.entity('cover'))[:200]}")

    def g_fan(self):
        if "fan" not in self.node:
            return
        self.cmd("fan", "on")
        self.cmd("fan", "level", 60)
        self.device_is("command: fan level 60 (%) sets the fan's percent setting", "fan", "fan", "percent-setting",
                       lambda v: v == 60)
        self.device_is("command: fan on and level 60 make it turn (percent current 60)", "fan", "fan",
                       "percent-current", lambda v: v == 60)
        self.cmd("fan", "off")
        self.device_is("command: fan off stops it (percent current 0)", "fan", "fan", "percent-current",
                       lambda v: v == 0)

    def g_sensors(self):
        if "sensors" not in self.node:
            return
        self.cmd("sensors", "on", expect_ok=False)
        s, o, _ = self.api.command("matter:999999:1", "on")
        check("command: an unknown id is refused (ok false)", o.get("ok") is False, f"answered {s} {json.dumps(o)[:160]}")
        refusal_reason("command: an unknown id", o)

    # ---- live updates: someone changes the device elsewhere (Google Home, a wall switch)

    def live(self, label, change, entity_of, pred, timeout):
        change()
        t0 = time.time()
        got = wait_for(lambda: (lambda e: e if e and pred(e) else None)(entity_of()), timeout, 0.5)
        dt = time.time() - t0
        e = entity_of()
        check(f"live: {label} shows within {timeout} s", bool(got),
              f"after {dt:.0f} s the entity is {json.dumps(e)[:200]}")
        if got:
            info(f"{label}: {dt:.1f} s")

    def g_live(self):
        t = self.args.live_timeout
        if "light" in self.node:
            self.live("light turned off elsewhere", lambda: self.fx.do("light", "onoff", "off", "NODE", "1"),
                      lambda: self.entity("light"), lambda e: e.get("state") == "off", t)
            self.live("light turned on elsewhere", lambda: self.fx.do("light", "onoff", "on", "NODE", "1"),
                      lambda: self.entity("light"), lambda e: e.get("state") == "on", t)
            self.live("light dimmed to 25% elsewhere",
                      lambda: self.fx.do("light", "levelcontrol", "move-to-level", "64", "0", "0", "0", "NODE", "1"),
                      lambda: self.entity("light"), lambda e: near(brightness_pct(e.get("attributes") or {}), 25, 3), t)
        if "plug" in self.node:
            self.live("plug switched on elsewhere", lambda: self.fx.do("plug", "onoff", "on", "NODE", "1"),
                      lambda: self.entity("plug"), lambda e: e.get("state") == "on", t)
        if "cover" in self.node:
            self.live("blind closed elsewhere",
                      lambda: self.fx.do("cover", "windowcovering", "go-to-lift-percentage", "10000", "NODE", "1"),
                      lambda: self.entity("cover"),
                      lambda e: num(e.get("attributes", {}).get("current_position")) == 0 and e.get("state") == "closed", t)
        if "thermostat" in self.node:
            self.fx.do("thermostat", "thermostat", "write", "system-mode", "4", "NODE", "1")
            self.live("thermostat setpoint changed to 19 °C elsewhere",
                      lambda: self.fx.do("thermostat", "thermostat", "write", "occupied-heating-setpoint", "1900",
                                         "NODE", "1"),
                      lambda: self.entity("thermostat"),
                      lambda e: near(num(e.get("attributes", {}).get("temperature")), 19, 0.01), t)
        if "fan" in self.node:
            self.live("fan set to 30% elsewhere",
                      lambda: (self.fx.do("fan", "onoff", "on", "NODE", "1"),
                               self.fx.do("fan", "fancontrol", "write", "percent-setting", "30", "NODE", "1")),
                      lambda: self.entity("fan"), lambda e: num(e.get("attributes", {}).get("percentage")) == 30, t)
        if "sensors" in self.node:
            # occupancy holds "occupied" for HoldTime seconds (10 by default): make it 1 s
            self.fx.run("pipe", "sensors", json.dumps({"Name": "SetHoldTime", "EndpointId": 4, "HoldTime": 1}))
            self.flip("occupancy", 4, "occupancy", "occupancy",
                      lambda v: self.fx.run("pipe", "sensors", json.dumps(
                          {"Name": "SetOccupancy", "EndpointId": 4, "Occupancy": int(v)})), (0, 1), t)
            self.flip("contact", 3, "booleanstate", "state-value",
                      lambda v: self.fx.run("pipe", "sensors", json.dumps(
                          {"Name": "SetBooleanState", "EndpointId": 3, "NewState": bool(v)})), (False, True), t)

    def flip(self, label, ep, cluster, attr, set_fn, values, t):
        """Mapping free: the entity's text for value a, then b, then a again must change both ways."""
        a, b = values
        set_fn(a)
        wait_for(lambda: self.fx.read("sensors", cluster, attr, ep) == a, 15)
        time.sleep(t / 2)
        s_a = (self.entity("sensors", ep) or {}).get("state")
        check(f"live: {label} sensor has a state", s_a not in (None, "unavailable"), f"state={s_a!r}")
        set_fn(b)
        t0 = time.time()
        got = wait_for(lambda: (self.entity("sensors", ep) or {}).get("state") not in (s_a, None, "unavailable"), t, 0.5)
        s_b = (self.entity("sensors", ep) or {}).get("state")
        check(f"live: {label} {a!r} -> {b!r} changes the state within {t} s", bool(got),
              f"still {s_b!r} (device {self.fx.read('sensors', cluster, attr, ep)!r})")
        info(f"{label}: {a!r} shows as {s_a!r}, {b!r} as {s_b!r} ({time.time() - t0:.1f} s)")
        if label == "contact":  # Matter StateValue true = in contact = closed; Home Assistant "on" = open
            check("live: contact open (StateValue false) shows on, closed (true) shows off",
                  (s_a, s_b) == ("on", "off"), f"open={s_a!r} closed={s_b!r}")
        set_fn(a)
        got = wait_for(lambda: (self.entity("sensors", ep) or {}).get("state") == s_a, t, 0.5)
        check(f"live: {label} {b!r} -> {a!r} goes back to {s_a!r} within {t} s", bool(got),
              f"is {(self.entity('sensors', ep) or {}).get('state')!r}")

    def g_events(self):
        """Contract change 6: GET /api/matter/events (server-sent events, "event: matter", data = the
        /api/matter/devices JSON), sent at once and within 250 ms of a change. Optional for an
        implementation that has no stream (WARN, not FAIL), but the version counter must go up."""
        s, o, devs = self.api.devices()
        check("events: devices carries 'version'", "version" in o, f"keys={sorted(o)}")
        if "version" in o:
            v0 = o["version"]
            if "light" in self.node:
                self.fx.do("light", "onoff", "toggle", "NODE", "1")
                v1 = wait_for(lambda: (lambda x: x if x is not None and x != v0 else None)(self.api.devices()[1].get("version")),
                              self.args.live_timeout)
                check("events: devices 'version' changes after a device changes", v1 is not None and v1 != v0,
                      f"version stayed {v0}")
        import http.client
        import threading
        from urllib.parse import urlparse
        u = urlparse(self.api.base)
        conn = (http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection)(
            u.hostname, u.port or 80, timeout=self.args.live_timeout + 10)
        try:
            conn.request("GET", "/api/matter/events", headers={"Authorization": "Bearer " + self.api.token,
                                                                "Accept": "text/event-stream"})
            r = conn.getresponse()
        except Exception as e:
            check("events: GET /api/matter/events streams", False, str(e), warn=True)
            return
        if r.status != 200:
            check("events: GET /api/matter/events streams", False, f"answered {r.status}", warn=True)
            return
        events = []

        def reader():
            ev, data = None, []
            try:
                while True:
                    line = r.fp.readline()
                    if not line:
                        return
                    line = line.decode("utf-8", "replace").rstrip("\r\n")
                    if line.startswith("event:"):
                        ev = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
                    elif line == "" and data:
                        try:
                            events.append((ev, json.loads("\n".join(data)), time.time()))
                        except ValueError:
                            events.append((ev, None, time.time()))
                        ev, data = None, []
            except Exception:
                return
        threading.Thread(target=reader, daemon=True).start()
        got_first = wait_for(lambda: len(events) > 0, 5, 0.1)
        check("events: the stream sends the device list at once", bool(got_first) and events[0][0] == "matter"
              and isinstance((events[0][1] or {}).get("devices"), list), f"first event: {events[:1]}")
        if "light" in self.node:
            want = "off" if (self.entity("light") or {}).get("state") == "on" else "on"
            n0 = len(events)
            t0 = time.time()
            self.fx.do("light", "onoff", want, "NODE", "1")
            changed_at = time.time()  # chip-tool returns once the device has applied it

            def seen():
                for ev, data, at in events[n0:]:
                    for d in (data or {}).get("devices", []):
                        if parse_id(d.get("id")) == (self.node["light"], 1) and d.get("state") == want:
                            return at
                return None
            at = wait_for(seen, self.args.live_timeout, 0.05)
            check(f"events: a light change elsewhere arrives as an event within {self.args.live_timeout} s",
                  bool(at), f"{len(events) - n0} events after the change, none with the light {want}")
            if at:
                info(f"event arrived {max(0, at - changed_at) * 1000:.0f} ms after the device changed")
        conn.close()

    def g_rename(self):
        if "light" not in self.node:
            return
        id_ = f"matter:{self.node['light']}:1"
        s, o, _ = self.api.call("POST", "/api/matter/rename", {"id": id_, "name": "Lounge lamp"})
        check("rename: light to 'Lounge lamp' answers ok", o.get("ok") is True, f"answered {s} {json.dumps(o)[:160]}")
        check("rename: the answer carries the new name", o.get("name") == "Lounge lamp", f"answered {json.dumps(o)[:160]}")
        check("rename: the list shows the new name", (self.entity("light") or {}).get("name") == "Lounge lamp",
              f"name={(self.entity('light') or {}).get('name')!r}")
        for bad, label in (("", "an empty name"), ("x" * 41, "a 41 character name")):
            s, o, _ = self.api.call("POST", "/api/matter/rename", {"id": id_, "name": bad})
            check(f"rename: {label} is refused", o.get("ok") is False, f"answered {s} {json.dumps(o)[:160]}")
            refusal_reason(f"rename: {label}", o)
        s, o, _ = self.api.call("POST", "/api/matter/rename", {"id": "matter:999999:1", "name": "Nope"})
        check("rename: an unknown id is refused", o.get("ok") is False, f"answered {s} {json.dumps(o)[:160]}")
        refusal_reason("rename: an unknown id", o)
        check("rename: the name is still 'Lounge lamp' after the refusals",
              (self.entity("light") or {}).get("name") == "Lounge lamp", "")
        if "plug" in self.node:
            # contract change 14: a name that would hide a switch (the house opening rule) is refused,
            # reason opens_house. An implementation without the name rule may take it: WARN, then undo.
            pid = f"matter:{self.node['plug']}:1"
            old = (self.entity("plug") or {}).get("name") or "Plug"
            s, o, _ = self.api.call("POST", "/api/matter/rename", {"id": pid, "name": "Garage door"})
            if o.get("ok") is False:
                check("rename: the plug to 'Garage door' is refused with reason opens_house",
                      o.get("reason") == "opens_house", f"answered {s} {json.dumps(o)[:160]}")
            else:
                check("rename: the plug to 'Garage door' is refused (opens_house)", False,
                      f"answered {s} {json.dumps(o)[:160]}", warn=True)
                self.api.call("POST", "/api/matter/rename", {"id": pid, "name": old})
            check("rename: the plug is still listed after that", bool(self.entity("plug")), "")

    def g_forbidden(self):
        for name, cluster, attr in (("lock", "doorlock", "lock-state"), ("alarm", "smokecoalarm", "expressed-state")):
            before_list = set(by_id(self.api.devices()[2]))
            try:
                state_before = self.fx.read(name, cluster, attr)
            except Exception:
                state_before = None
            sh = self.fx.share(name, 300)
            s, o, dt = self.api.commission(sh["manual"], self.address(name))
            ids = o.get("device_ids") or []
            info(f"{name}: commission answered {s} {json.dumps(o)[:200]} in {dt:.1f} s")
            # change 15: a commission that turns out to be a lock may take up to about 130 s (WARN over 120)
            check(f"forbidden: the {name} is answered within 120 s", dt <= 120, f"took {dt:.0f} s", warn=True)
            check(f"forbidden: commissioning the {name} returns no device ids", not ids, f"device_ids={ids}")
            if o.get("ok") is False:  # contract change 10/11: error "not_allowed" (ok true with no ids is also fine)
                check(f"forbidden: the {name} is refused with error 'not_allowed'", o.get("error") == "not_allowed",
                      f"answered {s} {json.dumps(o)[:200]}")
                if o.get("error") == "not_allowed":  # contract change 14
                    check(f"forbidden: the {name}'s reason is one of {sorted(NOT_ALLOWED_REASONS)}",
                          o.get("reason") in NOT_ALLOWED_REASONS, f"reason={o.get('reason')!r}")
            if o.get("note") is not None:
                check(f"forbidden: the note for the {name} is plain words", plain(o["note"]), repr(o["note"]))
            after = by_id(self.api.devices()[2])
            new = set(after) - before_list
            check(f"forbidden: the {name} is not listed", not new, f"new entries: {[after[i] for i in new]}")
            check(f"forbidden: no entry anywhere has a domain outside {sorted(ALLOWED_DOMAINS)}",
                  all(d.get("domain") in ALLOWED_DOMAINS for d in after.values()),
                  f"domains={sorted({d.get('domain') for d in after.values()})}")
            for action in ("on", "off", "toggle"):
                for i in ids:
                    s2, o2, _ = self.api.command(i, action)
                    check(f"forbidden: {action} on {name} id {i} is refused", o2.get("ok") is False, json.dumps(o2)[:120])
            try:
                state_after = self.fx.read(name, cluster, attr)
                check(f"forbidden: the {name}'s {attr} did not change", state_after == state_before,
                      f"{state_before!r} -> {state_after!r}")
            except Exception as e:
                check(f"forbidden: the {name} still answers the home controller", False, str(e))
            fab = self.fx.fabrics(name)
            check(f"forbidden: the implementation keeps no keys to the {name} (device back to 1 fabric)",
                  wait_for(lambda: self.fx.fabrics(name) == 1, 30), f"the {name} reports {fab} fabrics")
            if self.fx.fabrics(name) > 1:
                info(f"{name}: still on {self.fx.fabrics(name)} fabrics; `fx reset` clears it after the run")
            self.fx.run("revoke", name)

    def g_offline(self):
        if "plug" not in self.node:
            return
        subprocess.run(self.fx.cmd + ["stop", "plug"], capture_output=True)
        t = self.args.offline_timeout
        got = wait_for(lambda: (self.entity("plug") or {}).get("state") == "unavailable", t, 2)
        check(f"offline: a device that stops answering shows 'unavailable' within {t} s", bool(got),
              f"entity={json.dumps(self.entity('plug'))[:160]}")
        if self.args.remove_offline and got:
            self.remove_while_offline("plug")
        subprocess.run(self.fx.cmd + ["start", "plug"], capture_output=True)
        if "plug" not in self.node:  # removed while offline: it must leave the fabric once it answers
            left = wait_for(lambda: self.fx.fabrics("plug") == 1, t, 3)
            check(f"offline: the plug removed while offline leaves the fabric within {t} s of answering again",
                  bool(left), f"the plug reports {self.fx.fabrics('plug')} fabrics", warn=True)
            if not left:
                self.fx.run("evict", "plug")  # keep the fixtures clean for the next run
            return
        got = wait_for(lambda: (self.entity("plug") or {}).get("state") in ("on", "off"), t, 2)
        check(f"offline: it comes back (on/off) within {t} s of answering again", bool(got),
              f"entity={json.dumps(self.entity('plug'))[:160]}")

    def remove_while_offline(self, n):
        """Contract changes 7 and 14 (opt in, --remove-offline): a device that does not answer is
        forgotten anyway: ok true, every id gone, reason offline or not_answering, a note."""
        s, o, dt = self.api.call("POST", "/api/matter/remove", {"id": self.ids[n][0]}, timeout=90)
        check(f"offline: removing the {n} while it does not answer answers ok", o.get("ok") is True,
              f"answered {s} {json.dumps(o)[:200]}")
        check(f"offline: the reason is one of {sorted(REMOVE_OFFLINE_REASONS)}",
              o.get("reason") in REMOVE_OFFLINE_REASONS, f"reason={o.get('reason')!r}")
        check(f"offline: the answer has a note in plain words", isinstance(o.get("note"), str) and plain(o["note"]),
              repr(o.get("note")))
        gone = wait_for(lambda: all(parse_id(d.get("id"))[0] != self.node[n] for d in self.api.devices()[2]), 10)
        check(f"offline: every endpoint of the {n} leaves the list", bool(gone), "")
        del self.node[n]

    def g_remove(self):
        for n in list(self.node):
            try:
                self.remove_one(n)
            except Exception as e:
                check(f"remove: {n} ran to the end", False, f"{type(e).__name__}: {e}")
        s, o, _ = self.api.call("POST", "/api/matter/remove", {"id": "matter:999999:1"})
        check("remove: an unknown id is refused", o.get("ok") is False, f"answered {s} {json.dumps(o)[:160]}")
        refusal_reason("remove: an unknown id", o)

    def remove_one(self, n):
        id_ = self.ids[n][0]
        s, o, dt = self.api.call("POST", "/api/matter/remove", {"id": id_}, timeout=90)
        check(f"remove: {n} answers ok", o.get("ok") is True, f"answered {s} {json.dumps(o)[:160]}")
        # contract change 7: every id of the node
        check(f"remove: {n} 'removed' lists every id of the node",
              isinstance(o.get("removed"), list) and sorted(o["removed"]) == sorted(self.ids[n]),
              f"removed={o.get('removed')!r} ids={self.ids[n]}")
        gone = wait_for(lambda: all(parse_id(d.get("id"))[0] != self.node[n] for d in self.api.devices()[2]), 10)
        check(f"remove: every endpoint of {n} leaves the list", bool(gone), "")
        left = wait_for(lambda: self.fx.fabrics(n) == 1, 30, 2)
        check(f"remove: {n} left the implementation's fabric (device back to 1 fabric)", bool(left),
              f"the device reports {self.fx.fabrics(n)} fabrics")
        try:
            self.fx.read(n, "basic", "vendor-id", 0)
            stays = True
        except Exception:
            stays = False
        check(f"remove: {n} still works in the person's own home (home controller reads it)", stays, "")
        del self.node[n]


def main():
    global VERBOSE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True, help="base URL of the implementation, e.g. http://<tv>:5400")
    ap.add_argument("--token", default=os.environ.get("MATTER_TOKEN", ""), help="pairing token (or MATTER_TOKEN)")
    ap.add_argument("--fx", default=os.environ.get("MATTER_FX", "ssh macbook matter-fixtures/fx"),
                    help="command that runs the fixtures (default: ssh macbook matter-fixtures/fx)")
    ap.add_argument("--only", default="", help=f"comma list of groups: {','.join(GROUPS)}")
    ap.add_argument("--skip", default="", help="comma list of groups to leave out")
    ap.add_argument("--devices", default=",".join(CONTROLLED), help="which fixtures to commission")
    ap.add_argument("--keep", action="store_true", help="leave the devices commissioned (skips remove)")
    ap.add_argument("--slow", action="store_true", help="also wait out a real 3 minute window (expired)")
    ap.add_argument("--live-timeout", type=float, default=10, help="seconds a live change may take (default 10)")
    ap.add_argument("--offline-timeout", type=float, default=90, help="seconds for unavailable (default 90)")
    ap.add_argument("--timeout", type=float, default=30, help="HTTP timeout for plain calls")
    ap.add_argument("--address", help="send `address` <host>:<device port> with every commission (skips "
                                      "discovery; for an emulator without multicast). host = the MacBook's IP")
    ap.add_argument("--report", help="write the results as JSON here")
    ap.add_argument("--remove-offline", action="store_true",
                    help="in the offline group, also remove the plug while it does not answer (change 14)")
    ap.add_argument("--lock-wait", type=float, default=900,
                    help="seconds to wait while another run holds the fixtures lock (default 900)")
    ap.add_argument("--no-lock", action="store_true",
                    help="skip the one-run-at-a-time lock (only for a private copy nobody else uses)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    VERBOSE = args.verbose
    args.devices = [d for d in args.devices.split(",") if d]
    groups = [g for g in (args.only.split(",") if args.only else GROUPS) if g]
    skip = set(args.skip.split(",")) if args.skip else set()
    if args.keep:
        skip.add("remove")
    groups = [g for g in GROUPS if g in groups and g not in skip]
    if any(g in groups for g in ("list", "light", "plug", "thermostat", "cover", "fan", "sensors", "live",
                                 "events", "rename", "offline", "remove")) and "commission" not in groups:
        groups.insert(groups.index("list") if "list" in groups else 0, "commission")
        groups = [g for g in GROUPS if g in groups]

    api, fx = Api(args.api, args.token, args.timeout), Fx(args.fx)
    if args.no_lock:
        return run_all(args, groups, api, fx)
    token = lock_token()

    def stop(signum, frame):  # a kill still gives the lock back (finally below)
        raise SystemExit(128 + signum)
    for s in (signal.SIGTERM, signal.SIGHUP):  # before the lock, so there is no moment without them
        signal.signal(s, stop)
    try:
        if not take_fixture_lock(fx, f"contract run against {args.api}", args.lock_wait, token=token):
            return 3
        return run_all(args, groups, api, fx)
    finally:  # unlock with our own token never frees someone else's lock (fx refuses other tokens)
        try:
            fx.unlock(token)
        except Exception as e:
            print(f"Could not give the fixtures lock back ({e}). Free it with: {args.fx} unlock --force",
                  file=sys.stderr)


def run_all(args, groups, api, fx):
    st = fx.run("status")
    down = [d["name"] for d in st["devices"] if not d["running"] or not d["in_home"]]
    if down:
        print(f"The fixtures are not ready ({', '.join(down)} not running or not in the home fabric). "
              f"Run: {args.fx} up", file=sys.stderr)
        return 2
    stale = [d["name"] for d in st["devices"] if d["name"] in args.devices + ["lock", "alarm"] and fx.fabrics(d["name"]) > 1]
    if stale:
        print(f"These fixtures still belong to another controller from an earlier run: {stale}. "
              f"Remove them in the implementation, or run `{args.fx} reset` then `{args.fx} up` "
              f"(the implementation then holds stale devices: remove them there too).", file=sys.stderr)
        return 2

    run = Run(api, fx, args)
    t0 = time.time()
    print(f"Matter contract test against {args.api}: groups {','.join(groups)}", flush=True)
    try:
        for g in groups:
            print(f"--- {g}", flush=True)
            try:
                getattr(run, "g_" + g)()
            except Exception as e:
                check(f"{g}: ran to the end", False, f"{type(e).__name__}: {e}")
    finally:
        if "remove" in groups and run.node:
            # a group stopped half way: still take every device we added back off the implementation
            for n in list(run.node):
                api.call("POST", "/api/matter/remove", {"id": run.ids[n][0]}, timeout=90)
            print(f"(cleaned up after an early stop: removed {sorted(run.node)})")
        elif run.node:
            print(f"(left commissioned: {sorted(run.node)}; ids {run.ids})")
    n = {k: sum(1 for r in RESULTS if r[0] == k) for k in ("PASS", "FAIL", "WARN")}
    print(f"\n{n['PASS']} passed, {n['FAIL']} failed, {n['WARN']} warnings, {len(RESULTS)} checks, "
          f"{time.time() - t0:.0f} s")
    for r in RESULTS:
        if r[0] != "PASS":
            print(f"  {r[0]} {r[1]}: {r[2]}")
    if args.report:
        json.dump({"api": args.api, "groups": groups, "counts": n,
                   "results": [dict(status=a, name=b, why=c) for a, b, c in RESULTS]},
                  open(args.report, "w"), indent=1)
    return 1 if n["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
