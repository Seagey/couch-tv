#!/usr/bin/env python3
"""A small reference implementation of the couch-tv Matter API, built on chip-tool.

It is NOT shipped. It exists so the contract test (tests/matter_contract.py) can be proven against
something that is known to follow the contract, and so the builders have a worked example of every
mapping: domains, Home Assistant attribute names, units, % open versus Matter's % closed, error keys.

It runs on the MacBook with the connectedhomeip Python (it needs aiohttp and websockets):
  ~/matter-spike/connectedhomeip/.environment/pigweed-venv/bin/python3 \
      ~/matter-fixtures/reference_server.py --port 5490 --token test
Its fabric lives in ~/matter-fixtures/ref-store (wiped by `--reset`). Controller: chip-tool's
interactive websocket server on 127.0.0.1:9010. Live state: a poll of every device every ~2 s.
"""
import argparse
import asyncio
import base64
import colorsys
import json
import os
import re
import shutil
import subprocess
import time

import websockets
from aiohttp import web

HOME = os.path.expanduser("~")
CHIP_TOOL = os.path.join(HOME, "matter-spike/connectedhomeip/out/darwin-arm64-chip-tool-no-ble/chip-tool")
STORE = os.path.join(HOME, "matter-fixtures/ref-store")
DB = os.path.join(STORE, "devices.json")

# Matter device type id -> (domain, extra)
DEVICE_TYPES = {
    0x0100: ("light", {}), 0x0101: ("light", {}), 0x010C: ("light", {}), 0x010D: ("light", {}),
    0x010A: ("switch", {}), 0x010B: ("switch", {}),
    0x0301: ("climate", {}), 0x0202: ("cover", {}), 0x002B: ("fan", {}),
    0x0302: ("sensor", {"device_class": "temperature", "unit_of_measurement": "°C"}),
    0x0307: ("sensor", {"device_class": "humidity", "unit_of_measurement": "%"}),
    0x0015: ("sensor", {"device_class": "contact"}),
    0x0107: ("sensor", {"device_class": "occupancy"}),
    0x0106: ("sensor", {"device_class": "illuminance", "unit_of_measurement": "lx"}),
}
FORBIDDEN = {0x000A: "door lock", 0x0076: "smoke and CO alarm", 0x0042: "water valve"}
# no garage door opener device type in 1.6 apart from closures: refuse closure controllers too
FORBIDDEN.update({0x0230: "closure", 0x0231: "closure", 0x0232: "closure"})
MODES = {0: "off", 1: "heat_cool", 3: "cool", 4: "heat", 7: "fan_only", 8: "dry"}
MODE_IDS = {"off": 0, "heat_cool": 1, "auto": 1, "cool": 3, "heat": 4, "fan_only": 7, "dry": 8}
NAMES = {"light": "Light", "switch": "Plug", "climate": "Thermostat", "cover": "Blind", "fan": "Fan"}


def verhoeff_ok(code):
    d = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
         [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
         [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
         [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
    p = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4]]
    for i in range(2, 8):
        p.append([p[i - 1][p[1][j]] for j in range(10)])
    c = 0
    for i, ch in enumerate(reversed(code)):
        c = d[c][p[i % 8][int(ch)]]
    return c == 0


class Controller:
    def __init__(self, ws_port):
        self.ws_port = ws_port
        self.lock = asyncio.Lock()
        self.ws = None
        self.proc = None

    async def start(self):
        os.makedirs(STORE, exist_ok=True)
        self.proc = subprocess.Popen([CHIP_TOOL, "interactive", "server", "--port", str(self.ws_port),
                                      "--storage-directory", STORE],
                                     stdout=open(os.path.join(STORE, "chip-tool.log"), "ab"),
                                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        for _ in range(100):
            try:
                self.ws = await websockets.connect(f"ws://127.0.0.1:{self.ws_port}", max_size=None,
                                                   ping_interval=None)
                return
            except OSError:
                await asyncio.sleep(0.2)
        raise SystemExit("chip-tool interactive server did not start")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except Exception:
                self.proc.kill()

    async def restart(self):
        """chip-tool keeps a dead CASE session after a device restarts and never retries it, and a
        timed out websocket answer would put every later answer out of step: start it again."""
        async with self.lock:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.stop()
            await self.start_locked()

    async def start_locked(self):
        await Controller.start(self)

    async def run(self, command, timeout=60):
        """Runs one chip-tool command; returns (ok, results, log text)."""
        async with self.lock:
            try:
                await self.ws.send(command)
                raw = await asyncio.wait_for(self.ws.recv(), timeout)
            except (asyncio.TimeoutError, websockets.ConnectionClosed):
                self.stop()
                await self.start_locked()
                return False, [], "timeout"
        obj = json.loads(raw)
        logs = "\n".join(base64.b64decode(l.get("message", "")).decode("utf-8", "replace")
                         for l in obj.get("logs", []))
        results = obj.get("results", [])
        ok = not any("error" in r for r in results)
        return ok, results, logs

    async def read(self, node, ep, cluster, attr):
        ok, res, logs = await self.run(f"{cluster} read {attr} {node} {ep} --timeout 4", timeout=20)
        vals = [r["value"] for r in res if "value" in r]
        if not ok or not vals:
            raise IOError(f"read {cluster} {attr} failed")
        return vals[0]

    async def cmd(self, line):
        ok, res, logs = await self.run(line + " --timeout 6", timeout=30)
        return ok


class Ref:
    def __init__(self, args):
        self.args = args
        self.c = Controller(args.ws_port)
        self.db = {"next": 1000, "nodes": {}}
        if os.path.exists(DB):
            self.db = json.load(open(DB))
        self.state = {}  # id -> {"state":..., "attributes": {...}}
        self.failing = {}  # node -> poll cycles in a row with no answer
        self.version = 0
        self.listeners = set()
        self.breaks = set(filter(None, args.breaks.split(",")))
        self.last_restart = 0
        self.busy = set()
        self.commissioning = False
        self.db.setdefault("forgotten", [])  # removed while offline: leave their fabric once they answer

    def save(self):
        json.dump(self.db, open(DB, "w"), indent=1)

    # ---------------------------------------------------------------- device model

    def model(self):
        out = []
        for node, n in self.db["nodes"].items():
            for ep, e in n["eps"].items():
                id_ = f"matter:{node}:{ep}"
                s = self.state.get(id_, {"state": "unavailable", "attributes": {}})
                attrs = dict(s["attributes"])
                attrs.update(e.get("extra", {}))
                attrs["friendly_name"] = e["name"]
                out.append({"id": id_, "name": e["name"], "domain": e["domain"], "state": s["state"],
                            "attributes": attrs})
        return out

    async def poll_one(self, node, ep, e):
        c, d = self.c, e["domain"]
        r = lambda cl, at: c.read(node, ep, cl, at)
        if d == "light":
            on = await r("onoff", "on-off")
            lvl = await r("levelcontrol", "current-level")
            mired = await r("colorcontrol", "color-temperature-mireds")
            if "range" not in e:
                lo = await r("colorcontrol", "color-temp-physical-min-mireds") or 153
                hi = await r("colorcontrol", "color-temp-physical-max-mireds") or 500
                e["range"] = (round(1000000 / hi), round(1000000 / lo))
            hs = None
            if on and await r("colorcontrol", "color-mode") == 0:
                hs = [round((await r("colorcontrol", "current-hue")) * 360 / 254),
                      round((await r("colorcontrol", "current-saturation")) * 100 / 254)]
            return ("on" if on else "off",
                    {"brightness": round((lvl or 0) * 255 / 254), "level": round((lvl or 0) * 100 / 254),
                     "hs_color": hs,
                     "color_temp_kelvin": round(1000000 / mired) if mired else None,
                     "min_color_temp_kelvin": e["range"][0], "max_color_temp_kelvin": e["range"][1],
                     "supported_color_modes": ["color_temp", "hs"]})
        if d == "switch":
            return ("on" if await r("onoff", "on-off") else "off", {})
        if d == "fan":
            pct = await r("fancontrol", "percent-setting")
            cur = await r("fancontrol", "percent-current")
            return ("on" if cur else "off", {"percentage": pct if cur else 0})
        if d == "cover":
            closed = await r("windowcovering", "current-position-lift-percent100ths")
            pos = 100 - round((closed or 0) / 100)
            return ("closed" if pos == 0 else "open", {"current_position": pos})
        if d == "climate":
            mode = await r("thermostat", "system-mode")
            local = await r("thermostat", "local-temperature")
            heat = await r("thermostat", "occupied-heating-setpoint")
            cool = await r("thermostat", "occupied-cooling-setpoint")
            m = MODES.get(mode, "heat")
            sp = cool if m == "cool" else heat
            return (m, {"current_temperature": None if local is None else local / 100,
                        "temperature": sp / 100, "min_temp": 7, "max_temp": 30, "target_temp_step": 0.5,
                        "hvac_modes": ["off", "heat", "cool", "heat_cool"],
                        "hvac_action": "idle" if m == "off" else ("heating" if m == "heat" else "cooling")})
        if d == "sensor":
            dc = e["extra"]["device_class"]
            if dc == "temperature":
                v = await r("temperaturemeasurement", "measured-value")
                return ("unknown" if v is None else f"{v / 100:g}", {})
            if dc == "humidity":
                v = await r("relativehumiditymeasurement", "measured-value")
                return ("unknown" if v is None else f"{v / 100:g}", {})
            if dc == "contact":  # StateValue true = in contact = closed; HA "on" = open
                closed = await r("booleanstate", "state-value")
                return ("off" if closed else "on", {"reading": "closed" if closed else "open"})
            if dc == "occupancy":
                return ("on" if (await r("occupancysensing", "occupancy")) else "off", {})
        return ("unknown", {})

    def set_state(self, id_, st):
        if self.state.get(id_) != st:
            self.state[id_] = st
            self.changed()

    def changed(self):
        self.version += 1
        payload = self.payload()
        for q in list(self.listeners):
            q.put_nowait(payload)

    def payload(self):
        return {"devices": self.model(), "ready": True, "version": self.version}

    async def poll(self):
        while True:
            if any(v >= 3 for v in self.failing.values()) and time.time() - self.last_restart > 15:
                self.last_restart = time.time()
                await self.c.restart()
            for node in list(self.db["forgotten"]):
                if await self.c.cmd(f"pairing unpair {node}"):
                    self.db["forgotten"].remove(node)
                    self.save()
            for node, n in list(self.db["nodes"].items()):
                for ep, e in list(n["eps"].items()):
                    id_ = f"matter:{node}:{ep}"
                    if "no-live" in self.breaks and id_ in self.state:
                        continue
                    if id_ in self.busy:
                        continue
                    try:
                        st, at = await self.poll_one(node, ep, e)
                        self.set_state(id_, {"state": st, "attributes": at})
                        self.failing[node] = 0
                    except Exception:
                        self.set_state(id_, {"state": "unavailable", "attributes": {}})
                        self.failing[node] = self.failing.get(node, 0) + 1
            await asyncio.sleep(1.5)

    # ---------------------------------------------------------------- API

    def authed(self, req):
        return req.headers.get("Authorization", "") == "Bearer " + self.args.token

    async def h_devices(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        return web.json_response(self.payload())

    async def h_events(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
        await resp.prepare(req)
        q = asyncio.Queue()
        self.listeners.add(q)
        try:
            await resp.write(("event: matter\ndata: " + json.dumps(self.payload()) + "\n\n").encode())
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), 20)
                    await resp.write(("event: matter\ndata: " + json.dumps(msg) + "\n\n").encode())
                except asyncio.TimeoutError:
                    await resp.write(b": keepalive\n\n")
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            self.listeners.discard(q)
        return resp

    async def h_commission(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        if self.commissioning:
            return web.json_response({"ok": False, "error": "busy", "reason": "busy", "device_ids": [],
                                      "note": "Couch TV is already adding a device. Wait a moment and try again."},
                                     status=409)
        self.commissioning = True
        try:
            return await self.commission(req)
        finally:
            self.commissioning = False

    async def commission(self, req):
        body = await req.json()
        code = str(body.get("code", "")).strip()
        if not code.startswith("MT:"):
            code = re.sub(r"[\s-]", "", code)  # "3497-011-2332" style; never strip a QR's own dashes
        if code.startswith("MT:"):
            if not re.fullmatch(r"MT:[0-9A-Z.\-]{19,}", code):
                return web.json_response({"ok": False, "error": "wrong_code", "reason": "wrong_code", "device_ids": [], "note": "That code is not right."})
        elif not (re.fullmatch(r"\d{11}|\d{21}", code) and verhoeff_ok(code)):
            return web.json_response({"ok": False, "error": "wrong_code", "reason": "wrong_code", "device_ids": [], "note": "That code is not right."})
        problem = address_problem(body.get("address"))
        if problem:
            return web.json_response({"ok": False, "error": "unreachable", "reason": problem, "device_ids": [],
                                      "note": ADDRESS_NOTES[problem]})
        node = self.db["next"]
        self.db["next"] += 1
        self.save()
        ok, res, logs = await self.c.run(f"pairing code {node} {code} --timeout 60", timeout=120)
        if not ok:
            if "setup code is incorrect" in logs or "Integrity check failed" in logs or "Invalid argument" in logs:
                return web.json_response({"ok": False, "error": "wrong_code", "reason": "wrong_code", "device_ids": [], "note": "That code is not right."})
            if re.search(r"0x0+7E\b|FabricConflict|fabric already|Fabric exists", logs, re.I):
                # contract change 11: the device is already on this controller (CHIP_ERROR_FABRIC_EXISTS)
                return web.json_response({"ok": False, "error": "already", "reason": "already", "device_ids": [],
                                          "note": "This device is already on Couch TV."})
            note = "No device answered to that code. Get a new code and try again."
            if "raw-errors" in self.breaks:
                note = "CHIP Error 0x00000032: Timeout"
            return web.json_response({"ok": False, "error": "unreachable", "reason": "not_found", "device_ids": [],
                                      "note": note})
        # what is on it
        parts = await self.c.read(node, 0, "descriptor", "parts-list")
        eps, forbidden = {}, []
        for ep in parts:
            types = await self.c.read(node, ep, "descriptor", "device-type-list")
            ids = [t.get("0") if isinstance(t, dict) else t for t in types]
            for t in ids:
                if t in FORBIDDEN:
                    forbidden.append(FORBIDDEN[t])
            known = [DEVICE_TYPES[t] for t in ids if t in DEVICE_TYPES]
            if known:
                dom, extra = known[0]
                label = extra.get("device_class", "").capitalize() or NAMES.get(dom, dom)
                eps[str(ep)] = {"domain": dom, "extra": extra, "name": label}
        if "lock-listed" in self.breaks and forbidden:
            eps["1"] = {"domain": "switch", "extra": {}, "name": "Lock"}
            forbidden = []
        if forbidden or not eps:
            await self.c.cmd(f"pairing unpair {node}")
            if forbidden:  # contract change 10/11: refused, and the controller leaves its fabric at once
                return web.json_response({"ok": False, "error": "not_allowed", "reason": "blocked", "device_ids": [],
                                          "note": "Locks, alarms and garage doors are not added to Couch TV."},
                                         status=400)
            return web.json_response({"ok": True, "device_ids": [],
                                      "note": "There is nothing on this device that Couch TV can show."})
        self.db["nodes"][str(node)] = {"eps": eps}
        self.save()
        return web.json_response({"ok": True, "device_ids": [f"matter:{node}:{ep}" for ep in eps]})

    def find(self, id_):
        m = re.fullmatch(r"matter:(\d+):(\d+)", id_ or "")
        if not m:
            return None, None, None
        n = self.db["nodes"].get(m.group(1))
        if not n or m.group(2) not in n["eps"]:
            return None, None, None
        return m.group(1), m.group(2), n["eps"][m.group(2)]

    async def h_command(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        b = await req.json()
        node, ep, e = self.find(b.get("id"))
        if not e:
            return web.json_response({"ok": False, "error": "unknown device", "reason": "not_found"})
        a, v, d = b.get("action"), b.get("value"), e["domain"]
        c = self.c
        line = None
        if d in ("light", "switch") and a in ("on", "off", "toggle"):
            line = f"onoff {a} {node} {ep}"
        elif d == "light" and a == "level":
            line = f"levelcontrol move-to-level {round(float(v) * 254 / 100)} 0 0 0 {node} {ep}"
        elif d == "light" and a == "temp":
            line = f"colorcontrol move-to-color-temperature {round(1000000 / float(v))} 0 0 0 {node} {ep}"
        elif d == "light" and a == "colour":
            hs = None
            if re.fullmatch(r"#[0-9a-fA-F]{6}", str(v)):
                rgb = [int(str(v)[i:i + 2], 16) / 255 for i in (1, 3, 5)]
                h, s, _ = colorsys.rgb_to_hsv(*rgb)
                hs = (h * 360, s * 100)
            elif isinstance(v, (list, tuple)) and len(v) == 2:
                hs = (float(v[0]), float(v[1]))
            elif isinstance(v, dict) and "h" in v and "s" in v:
                hs = (float(v["h"]), float(v["s"]))
            elif re.fullmatch(r"\s*[\d.]+\s*,\s*[\d.]+\s*", str(v)):
                hs = tuple(float(x) for x in str(v).split(","))
            if hs:
                line = (f"colorcontrol move-to-hue-and-saturation {round(hs[0] / 360 * 254)} "
                        f"{round(hs[1] / 100 * 254)} 0 0 0 {node} {ep}")
        elif d == "fan" and a in ("on", "off"):
            line = f"onoff {a} {node} {ep}"
        elif d == "fan" and a == "level":
            line = f"fancontrol write percent-setting {int(v)} {node} {ep}"
        elif d == "cover" and a in ("on", "off"):
            line = f"windowcovering {'up-or-open' if a == 'on' else 'down-or-close'} {node} {ep}"
        elif d == "cover" and a in ("position", "level"):
            pct = int(v) if "cover-percent" in self.breaks else 100 - int(v)
            line = f"windowcovering go-to-lift-percentage {pct * 100} {node} {ep}"
        elif d == "climate" and a == "mode" and v in MODE_IDS:
            line = f"thermostat write system-mode {MODE_IDS[v]} {node} {ep}"
        elif d == "climate" and a == "target":
            mode = MODES.get(await c.read(node, ep, "thermostat", "system-mode"), "heat")
            attr = "occupied-cooling-setpoint" if mode == "cool" else "occupied-heating-setpoint"
            line = f"thermostat write {attr} {round(float(v) * 100)} {node} {ep}"
        if not line:
            return web.json_response({"ok": False, "error": "not supported", "reason": "bad_request"})
        id_ = f"matter:{node}:{ep}"
        ok = await c.cmd(line)
        if not ok:
            return web.json_response({"ok": False, "error": "unreachable", "reason": "failed"})
        try:
            st, at = await self.poll_one(node, ep, e)
            self.set_state(id_, {"state": st, "attributes": at})
        except Exception:
            pass
        dev = next((x for x in self.model() if x["id"] == id_), None)
        return web.json_response({"ok": True, "state": self.state.get(id_, {}).get("state"), "device": dev})

    async def h_remove(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        b = await req.json()
        node, ep, e = self.find(b.get("id"))
        if not e:
            return web.json_response({"ok": False, "error": "unknown device", "reason": "not_found"})
        offline = all(self.state.get(f"matter:{node}:{x}", {}).get("state") == "unavailable"
                      for x in self.db["nodes"][node]["eps"])
        left = False if offline else await self.c.cmd(f"pairing unpair {node}")
        for k in list(self.state):
            if k.startswith(f"matter:{node}:"):
                del self.state[k]
        removed = [f"matter:{node}:{ep}" for ep in self.db["nodes"][node]["eps"]]
        self.failing.pop(node, None)
        del self.db["nodes"][node]
        self.save()
        self.changed()
        if offline or not left:
            self.db["forgotten"].append(node)
            return web.json_response({"ok": True, "removed": removed, "reason": "offline" if offline else
                                      "not_answering", "note": "Couch TV forgot this device. It did not answer, "
                                      "so remove Couch TV from it in your home app too."})
        return web.json_response({"ok": True, "removed": removed})

    async def h_rename(self, req):
        if not self.authed(req):
            return web.json_response({"ok": False, "error": "not paired"}, status=401)
        b = await req.json()
        node, ep, e = self.find(b.get("id"))
        name = str(b.get("name", "")).strip()
        if not e or not 1 <= len(name) <= 40:
            return web.json_response({"ok": False, "error": "unknown device" if not e else "bad name",
                                      "reason": "not_found" if not e else "bad_name"})
        if e["domain"] in ("switch", "cover") and re.search(r"\b(garage|gate|door|lock)\b", name, re.I):
            # contract change 14: a name that would hide it (the house opening rule) is refused
            return web.json_response({"ok": False, "error": "refused", "reason": "opens_house",
                                      "note": "That name is kept for things that open the house. Pick another name."})
        e["name"] = name
        self.save()
        self.changed()
        return web.json_response({"ok": True, "name": name})


ADDRESS_NOTES = {"link_local": "That address only works on one network cable. Use the device's home network address.",
                 "port": "That port cannot be a smart home device. Leave the port out, or use the one from the device.",
                 "address": "That is not an address on your home network."}


def address_problem(address):
    """Contract change 14: why an address cannot work, as a reason key, or None."""
    if not address:
        return None
    a = str(address).strip()
    m = re.fullmatch(r"\[([0-9a-fA-F:.%a-zA-Z0-9]+)\](?::(\d+))?", a) or re.fullmatch(r"([^:\s]+)(?::(\d+))?", a)
    if not m:
        return "address"
    host, port = m.group(1), m.group(2)
    if host.lower().startswith("fe80"):
        return "link_local"
    if port is not None and not 1024 <= int(port) <= 65535:
        return "port"
    return None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5490)
    ap.add_argument("--ws-port", type=int, default=9010)
    ap.add_argument("--token", default="test")
    ap.add_argument("--reset", action="store_true", help="forget the reference fabric first")
    ap.add_argument("--break", dest="breaks", default="",
                    help="known bugs to switch on, to prove the contract test catches them: "
                         "cover-percent (no %% open/closed flip), lock-listed (no lock filter), "
                         "no-live (state only refreshed by our own commands), raw-errors (CHIP text in note)")
    args = ap.parse_args()
    if args.reset and os.path.isdir(STORE):
        shutil.rmtree(STORE)
    ref = Ref(args)
    await ref.c.start()
    app = web.Application()
    app.add_routes([web.get("/api/matter/devices", ref.h_devices),
                    web.post("/api/matter/commission", ref.h_commission),
                    web.post("/api/matter/command", ref.h_command),
                    web.post("/api/matter/remove", ref.h_remove),
                    web.post("/api/matter/rename", ref.h_rename),
                    web.get("/api/matter/events", ref.h_events)])
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", args.port).start()
    print(f"reference server on :{args.port}", flush=True)
    try:
        await ref.poll()
    finally:
        ref.c.stop()


if __name__ == "__main__":
    asyncio.run(main())
