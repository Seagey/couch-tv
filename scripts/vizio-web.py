#!/usr/bin/env python3
"""Beta: open a web page (couch-tv's home) on a VIZIO OS / SmartCast TV.

VIZIO OS has an internal "web-app launcher" name space. PUT /app/launch with
NAME_SPACE 4 and a web-launcher APP_ID passes MESSAGE through as a URL the TV's
own system webview loads, over plain http on your LAN. This is undocumented and
chipset-specific, so this tool PROBES which APP_ID your set accepts, using a
throwaway local page that reports back when the TV actually loads it.

Every launch goes through vizio.VizioTV.launch_web(), which only allows name
space 4 and the ids in vizio.WEB_APP_IDS (3001 and 17). It can never send
APP_ID 1 (the main system UI): writing a URL there persists to NVRAM and can
brick the UI until a factory reset. The web-launcher name space used here loads
fresh each time and does not persist.

    # 1) Find which launcher id your TV accepts (serves a test page):
    .venv/bin/python scripts/vizio-web.py <tv address> --probe

    # 2) Once you know the id, put couch-tv's home on the TV:
    .venv/bin/python scripts/vizio-web.py <tv address> --app-id 3001 \
        --url http://<bridge address>:5400/tv/

Windows (PowerShell): swap the python path for  .venv\\Scripts\\python  and use
backslashes in  scripts\\vizio-web.py . Windows Firewall will ask to allow Python
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

# Tried in order, and only these: the allow list lives in bridge/vizio.py (WEB_APP_IDS). 3001 = VIZIO OS
# system modal webview (firmware 86.x and similar). 17 = web-app launcher on some older SmartCast sets.
CANDIDATES = list(vizio.WEB_APP_IDS)
PROBE_WAIT = 12          # seconds to wait for the TV to load the test page
PROBE_LIFETIME = 120     # the test page shuts down after this many seconds whatever happens


def lan_ip(tv_ip):
    """This computer's address on the same network as the TV."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((tv_ip, 1))          # no packet is sent; it just picks the right interface
        return s.getsockname()[0]
    finally:
        s.close()


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
        await t.close()
        raise SystemExit("This TV is not paired yet. Pair first:  scripts/vizio-check.py "
                         f"{address} --pair")
    return t


async def do_probe(a):
    me = lan_ip(a.address)
    loaded = asyncio.Event()

    def cand_of(request):
        c = request.query.get("c", "")
        return c if c in CANDIDATES else None     # only ever echo a known id into the page

    async def page(request):
        cand = cand_of(request)
        if not cand:
            raise web.HTTPNotFound()
        return web.Response(
            text="<!doctype html><meta charset=utf-8>"
                 "<body style='background:#0a7;color:#fff;font:700 6vw sans-serif;"
                 "display:grid;place-items:center;height:100vh;margin:0'>"
                 f"couch-tv sees your TV<br>launcher {cand}"
                 f"<script>fetch('/seen?c={cand}')</script>",
            content_type="text/html")

    async def seen(request):
        if cand_of(request):
            loaded.set()
        return web.Response(text="ok")

    # Two routes only, bound to this computer's LAN address (not every interface), and shut down in
    # the finally below or after PROBE_LIFETIME seconds.
    app = web.Application()
    app.add_routes([web.get("/", page), web.get("/seen", seen)])
    runner = web.AppRunner(app)
    await runner.setup()
    t = None
    try:
        site = web.TCPSite(runner, me, a.port_serve)
        await site.start()
        print(f"Test page served at http://{me}:{a.port_serve}/  (this computer, until the probe ends)\n")
        t = await connect(a.address, a.port)
        return await asyncio.wait_for(probe_loop(a, t, me, loaded), timeout=PROBE_LIFETIME)
    except asyncio.TimeoutError:
        print("The probe ran out of time; the test page is closed.")
        return 1
    finally:
        if t is not None:
            await t.close()
        await runner.cleanup()


async def probe_loop(a, t, me, loaded):
    candidates = [a.app_id] if a.app_id else CANDIDATES
    for cand in candidates:
        url = f"http://{me}:{a.port_serve}/?c={cand}"
        print(f"Trying launcher APP_ID {cand} (name space {vizio.WEB_NS}) -> {url}")
        loaded.clear()
        try:
            await t.launch_web(url, cand)
        except (vizio.VizioError, TVUnavailable) as e:
            print(f"  TV refused the launch: {e}")
            continue
        try:
            await asyncio.wait_for(loaded.wait(), timeout=PROBE_WAIT)
        except asyncio.TimeoutError:
            print(f"  No load within {PROBE_WAIT}s (watch the TV: did anything flash up?). Trying next.\n")
            continue
        print(f"  SUCCESS: the TV loaded the page with APP_ID {cand}.\n")
        print("=" * 60)
        print(f"Your VIZIO's web launcher is: NAME_SPACE {vizio.WEB_NS}, APP_ID {cand}")
        print("Put couch-tv's home on the TV with:")
        print(f"  scripts/vizio-web.py {a.address} --app-id {cand} "
              f"--url http://{me}:5400/tv/")
        print("=" * 60)
        return 0
    print("None of the tried launcher ids loaded a page. Note your model and firmware and report it; "
          "a tester may find a different id for this chipset.")
    return 1


async def do_launch(a):
    vizio.web_launch_body(a.app_id, a.url)        # refuse a bad id or URL before touching the TV
    t = await connect(a.address, a.port)
    try:
        print(f"Launching {a.url} on the TV via NAME_SPACE {vizio.WEB_NS}, APP_ID {a.app_id} ...")
        await t.launch_web(a.url, a.app_id)
        print("Sent. Watch the TV. If it is blank, the page may need a moment, or the URL is not "
              "reachable from the TV (check it opens in a phone browser on the same Wi-Fi).")
        return 0
    finally:
        await t.close()


def main():
    p = argparse.ArgumentParser(description="Open a web page on a VIZIO OS TV (Beta).")
    p.add_argument("address", help="the TV's IP address")
    p.add_argument("--probe", action="store_true", help="find which launcher APP_ID this TV accepts")
    p.add_argument("--url", help="the http:// or https:// page to open on the TV (with --app-id)")
    p.add_argument("--app-id", choices=CANDIDATES,
                   help="the launcher APP_ID to use. Only " + ", ".join(CANDIDATES) + " are allowed, never 1.")
    p.add_argument("--port", type=int, help="TV port override (7345 or 9000)")
    p.add_argument("--port-serve", type=int, default=8765, help="port for the local test page")
    a = p.parse_args()
    try:
        if a.probe:
            return asyncio.run(do_probe(a))
        if a.url and a.app_id:
            return asyncio.run(do_launch(a))
    except TVUnavailable as e:
        raise SystemExit(str(e))
    p.error("use --probe, or --url with --app-id")


if __name__ == "__main__":
    sys.exit(main() or 0)
