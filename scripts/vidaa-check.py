#!/usr/bin/env python3
"""The first test on a Hisense VIDAA TV (docs/VIDAA.md). Run it with the bridge stopped.

    .venv/bin/python scripts/vidaa-check.py <tv address>                 # listen and read, 60 seconds
    .venv/bin/python scripts/vidaa-check.py <tv address> --pair          # the TV shows a PIN
    .venv/bin/python scripts/vidaa-check.py <tv address> --pin 1234      # send the PIN, keep the pairing

Listening connects to the TV's MQTT port the way the phone app does, asks where the TV is and which
apps it has, and prints every message the TV sends for 60 seconds (press buttons on the TV's own
remote meanwhile). It sends no key and opens nothing. The PIN and any token are never printed.
Paste the output into a GitHub issue: it is what turns the guesses in bridge/vidaa.py into facts.
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import vidaa  # noqa: E402


async def main(a):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = {"id": a.tv, "name": "VIDAA", "kind": "vidaa", "ip": a.address, "trace": True}
    if a.port:
        cfg["port"] = a.port
    t = vidaa.VidaaTV(cfg)
    t.ip = a.address
    t.connected = await t.port_open()
    if not t.connected:
        print(f"Nothing answers on port {' or '.join(map(str, t.ports))} at {a.address}. Is the TV on (not fully off)?")
        return 1
    print(f"The MQTT port is open. Client certificate: {'yes' if t._have_cert() else 'none (scripts/vidaa-cert.py)'}.")
    try:
        await t._connection()
    except Exception as e:
        print(f"Could not log in: {e}")
        return 1
    print(f"Logged in as {t.client_id}.")
    try:
        if a.pin:
            await t.pair_finish(a.pin)
            print("Paired: the pairing is kept in bridge/data (git ignores it).")
            return 0
        if a.pair:
            await t.pair_start()
            if sys.stdin.isatty():
                pin = await asyncio.get_running_loop().run_in_executor(None, input, "The PIN on the TV: ")
                await t.pair_finish(pin)
                print("Paired: the pairing is kept in bridge/data (git ignores it).")
                return 0
            print(f"Asked for a PIN. If the TV shows one, run: scripts/vidaa-check.py {a.address} --pin <the 4 digits>")
            await asyncio.sleep(5)
            return 0
        print(f"Where the TV is: {await t.read_state() or 'no answer'}")
        await t.refresh_installed(force=True)
        print(f"Apps it lists: {len(t.applist)}")
        for x in t.applist:
            print(f"  {x['appId']}  {x['name']}  urlType={x['urlType']} storeType={x['storeType']}")
        print(f"Listening for {a.seconds} seconds. Press buttons on the TV's own remote now.")
        await asyncio.sleep(a.seconds)
        return 0
    except Exception as e:
        print(f"Stopped: {e}")
        return 1
    finally:
        await t._drop()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address")
    p.add_argument("--tv", default="vidaa", help="the TV's id in config.json, so the pairing is kept under it")
    p.add_argument("--port", type=int)
    p.add_argument("--pair", action="store_true")
    p.add_argument("--pin")
    p.add_argument("--seconds", type=int, default=60)
    sys.exit(asyncio.run(main(p.parse_args())))
