#!/usr/bin/env python3
"""Experiment: open a web page (couch-tv's home) on a VIZIO OS / SmartCast TV.

VIZIO OS has an internal "web-app launcher" namespace. PUT /app/launch with
NAME_SPACE 4 and a web-launcher APP_ID passes MESSAGE through as a URL the TV's
own system webview loads, over plain http on your LAN. This is undocumented and
chipset-specific, so this tool PROBES which APP_ID your set accepts, using a
throwaway local page that reports back when the TV actually loads it.

It never touches APP_ID 1 (the main system UI). Writing a URL there persists to
NVRAM and can brick the UI until a factory reset; the web-launcher namespace
used here loads fresh each time and does not persist.

    # 1) Find which launcher id your TV accepts (serves a test page, no risk):
    .venv/bin/python scripts/vizio-web.py 192.168.1.130 --probe

    # 2) Once you know the id, put any URL on the TV (e.g. couch-tv's home):
    .venv/bin/python scripts/vizio-web.py 192.168.1.130 --app-id 3001 \
        --url http://192.168.1.50:5400/tv/

Windows (PowerShell): swap the python path for  .venv\Scripts\python  and use
backslashes in  scripts\vizio-web.py . Windows Firewall will ask to allow Python
on private networks the first time the test page is served. Say yes (private).
"""
import argparse
import asyncio
import os
import socket
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import vizio  # noqa: E402
from tv import TVUnavailable  # noqa: E402

from aiohttp import web  # noqa: E402

# Candidates, in order. 3001 = VIZIO OS system modal webview (firmware 86.x and
# similar). 17 = web-app launcher on some older SmartCast sets. Add your own with
# --app-id if a tester finds another. APP_ID 1 is refused everywhere below.
CANDIDATES = ["3001", "17"]
WEB_NS = 4


def lan_ip(tv_ip):
    """This computer's address on the same network as the TV."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((tv_ip, 1))          # no packet is sent; it just picks the right interface
        return s.getsockname()[0]
    finally:
        s.close()


def refuse_app_1(app_id):
    if str(app_id).strip() == "1":
        raise SystemExit("Refusing APP_ID 1: a URL written there persists to NVRAM and can brick the "
                         "TV's UI until a factory reset. The web launcher ids (3001, 17) are safe.")


async def launch(t, app_id, url):
    refuse_app_1(app_id)
    await t._call("PUT", vizio.PROTOCOL["launch"],
                  {"VALUE": {"NAME_SPACE": WEB_NS, "APP_ID": str(app_id), "MESSAGE": url}}, timeout=8)


async def connect(address, port_override):
    cfg = {"id": "vizio", "name": "VIZIO", "kind": "vizio", "ip": address, "trace": True}
    if port_override:
        cfg["port"] = port_override
    t = vizio.VizioTV(cfg)
    t.ip = address
    t.connected = await t.port_open()
    if not t.connected:
        raise SystemExit(f"Nothing answers at {address}. Is the TV on and on this network?")
    await t.find_port()
    if not t.paired:
        raise SystemExit("This TV is not paired yet. Pair first:  scripts/vizio-check.py "
                         f"{address} --pair")
    return t


async def do_probe(a):
    me = lan_ip(a.address)
    hits = {}
    loaded = asyncio.Event()
    last = {"id": None}

    async def page(request):
        cand = request.query.get("c", "?")
        return web.Response(
            text="<!doctype html><meta charset=utf-8>"
                 "<body style='background:#0a7;color:#fff;font:700 6vw sans-serif;"
                 "display:grid;place-items:center;height:100vh;margin:0'>"
                 f"couch-tv sees your TV<br>launcher {cand}"
                 f"<script>fetch('/seen?c={cand}')</script>",
            content_type="text/html")

    async def seen(request):
        cand = request.query.get("c", "?")
        hits[cand] = True
        last["id"] = cand
        loaded.set()
        return web.Response(text="ok")

    app = web.Application()
    app.add_routes([web.get("/", page), web.get("/seen", seen)])
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", a.port_serve)
    await site.start()
    print(f"Test page served at http://{me}:{a.port_serve}/  (this computer)\n")

    t = await connect(a.address, a.port)
    try:
        candidates = [a.app_id] if a.app_id else CANDIDATES
        for cand in candidates:
            refuse_app_1(cand)
            url = f"http://{me}:{a.port_serve}/?c={cand}"
            print(f"Trying launcher APP_ID {cand} (name space {WEB_NS}) -> {url}")
            loaded.clear()
            try:
                await launch(t, cand, url)
            except (vizio.VizioError, TVUnavailable) as e:
                print(f"  TV refused the launch: {e}")
                continue
            try:
                await asyncio.wait_for(loaded.wait(), timeout=12)
                print(f"  SUCCESS: the TV loaded the page with APP_ID {cand}.\n")
                print("=" * 60)
                print(f"Your VIZIO's web launcher is: NAME_SPACE {WEB_NS}, APP_ID {cand}")
                print("Put couch-tv's home on the TV with:")
                print(f"  scripts/vizio-web.py {a.address} --app-id {cand} "
                      f"--url http://{me}:5400/tv/")
                print("=" * 60)
                return 0
            except asyncio.TimeoutError:
                print("  No load within 12s (watch the TV: did anything flash up?). Trying next.\n")
        print("None of the tried launcher ids loaded a page. Note your model and firmware and report it; "
              "a tester may find a different id for this chipset.")
        return 1
    finally:
        await t.close()
        await runner.cleanup()


async def do_launch(a):
    t = await connect(a.address, a.port)
    try:
        refuse_app_1(a.app_id)
        print(f"Launching {a.url} on the TV via NAME_SPACE {WEB_NS}, APP_ID {a.app_id} ...")
        await launch(t, a.app_id, a.url)
        print("Sent. Watch the TV. If it is blank, the page may need a moment, or the URL is not "
              "reachable from the TV (check it opens in a phone browser on the same Wi-Fi).")
        return 0
    finally:
        await t.close()


def main():
    p = argparse.ArgumentParser(description="Open a web page on a VIZIO OS TV (experiment).")
    p.add_argument("address", help="the TV's IP, e.g. 192.168.1.130")
    p.add_argument("--probe", action="store_true", help="find which launcher APP_ID this TV accepts")
    p.add_argument("--url", help="the page to open on the TV (with --app-id)")
    p.add_argument("--app-id", help="the launcher APP_ID to use (e.g. 3001). Never 1.")
    p.add_argument("--port", type=int, help="TV port override (7345 or 9000)")
    p.add_argument("--port-serve", type=int, default=8765, help="port for the local test page")
    a = p.parse_args()
    if a.probe:
        return asyncio.run(do_probe(a))
    if a.url and a.app_id:
        return asyncio.run(do_launch(a))
    p.error("use --probe, or --url with --app-id")


if __name__ == "__main__":
    sys.exit(main() or 0)
