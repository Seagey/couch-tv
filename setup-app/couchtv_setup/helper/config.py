"""helper.json (the mode and the choices), and the bridge's config.json that Setup writes for it.

helper.json, in Setup's own folder:
    {"v": 1, "mode": "once" | "helper", "autostart": bool, "port": 5400, "pairing_key": "...",
     "allow_sleep": false (keep the computer awake on power for Samsung, LG, Roku), "updates": true,
     "tvs": [{"ip": "192.0.2.20", "kind": "samsung" | "lg" | "roku", "name": "Living room TV"}]}

"tvs" holds only the TVs that need the helper (Samsung, LG, Roku). Android TVs come from known-tvs.json,
which Setup already keeps. The pairing key is made once and kept, so the phone remote stays paired.
"""
import json
import os
import re
import secrets
from pathlib import Path

from .. import paths

FILE = "helper.json"
BRIDGE_FILE = "helper-bridge-config.json"
MODES = ("once", "helper")
KINDS = ("samsung", "lg", "roku")
DEFAULT_PORT = 5400
# the port a TV of each kind answers on, so the menu can say "ready" without asking the bridge
TV_PORTS = {"android": 5555, "samsung": 8002, "lg": 3001, "roku": 8060}


def _dir(data=None):
    return Path(data) if data else paths.data()


def default():
    return {"v": 1, "mode": "once", "autostart": False, "port": DEFAULT_PORT, "pairing_key": "", "tvs": [],
            "allow_sleep": False, "updates": True}


def load(data=None):
    cfg = default()
    try:
        raw = json.loads((_dir(data) / FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return cfg
    if not isinstance(raw, dict):
        return cfg
    if raw.get("mode") in MODES:
        cfg["mode"] = raw["mode"]
    cfg["autostart"] = raw.get("autostart") is True
    cfg["allow_sleep"] = raw.get("allow_sleep") is True
    cfg["updates"] = raw.get("updates") is not False
    port = raw.get("port")
    if isinstance(port, int) and not isinstance(port, bool) and 1024 <= port <= 65535:
        cfg["port"] = port
    key = raw.get("pairing_key")
    if isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]{12,128}", key):
        cfg["pairing_key"] = key
    cfg["tvs"] = clean_tvs(raw.get("tvs"))
    return cfg


def clean_tvs(tvs):
    out, seen = [], set()
    for t in tvs if isinstance(tvs, list) else []:
        if not isinstance(t, dict) or t.get("kind") not in KINDS:
            continue
        ip = str(t.get("ip") or "")
        if not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", ip) or ip in seen:
            continue
        seen.add(ip)
        name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(t.get("name") or ""))[:40] or t["kind"].capitalize() + " TV"
        out.append({"ip": ip, "kind": t["kind"], "name": name})
    return out


def _write_private(path, text):
    """Created owner only from the start (the pairing key is in these files), not chmod after the write."""
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, 0o600)


def save(cfg, data=None):
    p = _dir(data) / FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    _write_private(tmp, json.dumps(cfg, indent=2))
    os.replace(tmp, p)
    return p


def turn_on(autostart=False, data=None):
    """Mode "helper", with a pairing key made on the first time and kept after."""
    cfg = load(data)
    cfg["mode"] = "helper"
    cfg["autostart"] = bool(autostart)
    cfg["pairing_key"] = cfg["pairing_key"] or secrets.token_urlsafe(18)
    save(cfg, data)
    return cfg


def turn_off(data=None):
    """Mode "once" and no start with the computer. The TV and its apps are not touched."""
    cfg = load(data)
    cfg["mode"] = "once"
    cfg["autostart"] = False
    save(cfg, data)
    return cfg


def add_tv(ip, kind, name="", data=None):
    cfg = load(data)
    cfg["tvs"] = clean_tvs([t for t in cfg["tvs"] if t["ip"] != ip] + [{"ip": ip, "kind": kind, "name": name}])
    save(cfg, data)
    return cfg


def bridge_tvs(known, cfg):
    """The bridge's "tvs" list: the Android TVs Setup set up (known-tvs.json) and the helper's own TVs."""
    rows, used = [], set()

    def tv_id(name):
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "tv"
        n, cand = 2, base
        while cand in used:
            cand, n = f"{base}-{n}", n + 1
        used.add(cand)
        return cand

    for ip, k in sorted((known or {}).items()):
        if not isinstance(k, dict) or not (k.get("route") or k.get("kind")):
            continue
        name = k.get("room") or k.get("name") or "TV"
        row = {"id": tv_id(name), "name": name, "label": name, "ip": ip, "adb_port": 5555,
               "wake_on_lan": True, "paired": False}
        if k.get("kind") == "fire":
            row["adb_only"] = True
        rows.append(row)
    for t in cfg["tvs"]:
        rows.append({"id": tv_id(t["name"]), "name": t["name"], "label": t["name"], "ip": t["ip"], "kind": t["kind"]})
    return rows


def bridge_config(known, cfg):
    """What the bridge reads (COUCH_CONFIG). The pairing key is on, so the phone remote needs the code."""
    tvs = bridge_tvs(known, cfg)
    return {"bridge": {"port": cfg["port"], "pairing_key": cfg["pairing_key"]},
            "default_tv": tvs[0]["id"] if tvs else "tv", "tvs": tvs or [{"id": "tv", "name": "TV", "label": "TV", "ip": "SET_YOUR_TV_IP"}],
            "home": {"look": "night"}, "phone_remote": True, "ask": {"enabled": False}}


def write_bridge_config(known, cfg, data=None):
    p = _dir(data) / BRIDGE_FILE
    _write_private(p, json.dumps(bridge_config(known, cfg), indent=2))
    return p


def needs_helper(kind):
    """Samsung, LG and Roku TVs only open Couch TV through the helper."""
    return kind in KINDS
