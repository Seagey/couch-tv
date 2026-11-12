#!/usr/bin/env python3
"""The first test on an Apple TV (docs/APPLE-TV-TESTING.md). Run it with the bridge stopped.

    .venv/bin/python scripts/appletv-check.py                      # find Apple TVs on the network (listens only)
    .venv/bin/python scripts/appletv-check.py <address> [--port N] # is the Companion port open, are we paired
    .venv/bin/python scripts/appletv-check.py <address> --pair     # the Apple TV shows a PIN: type it here
    .venv/bin/python scripts/appletv-check.py <address> --pin 1234 # the same, with the PIN given

Without --pair or --pin it is read only: it looks for Apple TVs the way the iPhone does, then (if this
computer is already paired) reads whether the Apple TV is awake and which apps it lists. It sends no key
and opens nothing. Pairing adds this computer to the Apple TV's list of remotes, so it needs --pair or
--pin on purpose; it can be removed again in Settings, Remotes and Devices on the Apple TV. The PIN and the
keys are never printed. Paste the output into a GitHub issue.
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import appletv  # noqa: E402


async def find(seconds=6):
    from zeroconf import ServiceBrowser, Zeroconf
    found = {}

    class L:
        def add_service(self, zc, t, name):
            info = zc.get_service_info(t, name, 2000)
            if info and info.port:
                found[name] = (info.parsed_addresses()[:1], info.port)
        update_service = remove_service = lambda *a: None

    zc = Zeroconf()
    ServiceBrowser(zc, "_companion-link._tcp.local.", L())
    await asyncio.sleep(seconds)
    zc.close()
    return found


async def main(a):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if not a.address:
        print("Listening for Apple TVs, Apple TV boxes and HomePods (6 seconds)...")
        found = await find()
        for name, (addr, port) in sorted(found.items()):
            print(f"  {name.split('.')[0]}  address {addr[0] if addr else '?'}  port {port}")
        print("Nothing found. Is the Apple TV awake, on the same Wi-Fi?" if not found else
              "Run again with the address (and --port if it is not 49153).")
        return 0 if found else 1
    t = appletv.AppleTV({"id": a.tv, "name": "Apple TV", "kind": "appletv", "ip": a.address, "port": a.port})
    if not await t.port_open(timeout=3):
        print(f"Nothing answers on port {a.port} at {a.address}. Wake the Apple TV, and check the port with no address given.")
        return 1
    print(f"The Companion port is open. Paired with couch-tv: {'yes' if t.paired else 'no'}.")
    try:
        if a.pair or a.pin:
            await t.pair_start()
            pin = a.pin
            if not pin:
                if not sys.stdin.isatty():
                    print(f"Asked for a PIN. Run again with --pin <the 4 digits on the TV>.")
                    return 0
                pin = await asyncio.get_running_loop().run_in_executor(None, input, "The PIN on the TV: ")
            await t.pair_finish(pin.strip())
            print("Paired: the keys are kept in bridge/data (git ignores it).")
            return 0
        if not t.paired:
            print("Not paired, so nothing more can be read. Add --pair to pair (the Apple TV shows a PIN).")
            return 0
        t.connected = True
        state = {appletv.ASLEEP: "asleep", appletv.SCREENSAVER: "screensaver", appletv.AWAKE: "awake"}
        print(f"Apple TV is: {state.get(await t._read_attention(), 'unknown')}")
        await t.refresh_installed(force=True)
        print(f"Apps it lists: {len(t.channels)}")
        for c in t.channels:
            print(f"  {c['id']}  {c['title']}")
        return 0
    except (appletv.AppleTVError, Exception) as e:
        print(f"Stopped: {e}")
        return 1
    finally:
        await t._drop()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address", nargs="?")
    p.add_argument("--tv", default="appletv", help="the TV's id in config.json, so the keys are kept under it")
    p.add_argument("--port", type=int, default=49153)
    p.add_argument("--pair", action="store_true")
    p.add_argument("--pin")
    sys.exit(asyncio.run(main(p.parse_args())))
