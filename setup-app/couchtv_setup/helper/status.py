"""What the menu shows: is the bridge up, and is each TV reachable. Plain TCP knocks, nothing is sent to a TV."""
import socket

from . import config as hconfig


def knock(host, port, timeout=1.0):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def snapshot(cfg, known, sup, autostart=False, knock=knock):
    """The menu state. `sup` is a bridge_proc.Supervisor (or anything with alive() and paused)."""
    tvs = []
    for t in hconfig.bridge_tvs(known, cfg):
        kind = t.get("kind") or ("fire" if t.get("adb_only") else "android")
        port = hconfig.TV_PORTS.get(kind) or hconfig.TV_PORTS["android"]
        tvs.append({"name": t["name"], "kind": kind, "ready": bool(knock(t["ip"], port)) if t["ip"] != "SET_YOUR_TV_IP" else False})
    paused = bool(getattr(sup, "paused", False))
    running = bool(sup.alive()) and knock("127.0.0.1", cfg["port"], 0.5)
    return {"running": running, "paused": paused, "port": cfg["port"], "tvs": tvs, "autostart": bool(autostart)}
