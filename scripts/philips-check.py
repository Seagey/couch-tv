#!/usr/bin/env python3
"""The first test on a Philips TV with Titan OS (docs/PHILIPS-TITAN-TESTING.md). Run it with the bridge stopped.

    .venv/bin/python scripts/philips-check.py <tv address>             # read only, no login needed
    .venv/bin/python scripts/philips-check.py <tv address> --pair      # the TV shows a PIN; type it here
    .venv/bin/python scripts/philips-check.py <tv address> --pin 1234  # or send the PIN on its own

Without --pair it only reads: which API version the TV answers, what it says about itself, and,
once paired, whether it is on, its volume, its inputs, the apps it lists and the app in front. It
presses no button, opens nothing and changes no setting. --pair asks the TV to show a PIN (the only
thing that appears on the TV) and keeps the login in bridge/data/, which git ignores. Pairing needs
the pairing key saved first with scripts/philips-secret.py.

The PIN and every key are hidden in what it prints. Paste the output into a GitHub issue: it is what
turns the guesses in bridge/philips.py into facts.
"""
import argparse
import asyncio
import json
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import philips  # noqa: E402
from tv import TVUnavailable  # noqa: E402


def show(label, value):
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    print(f"{label}: {text[:1500]}")


async def read(t, label, path):
    try:
        show(label, await t._call("GET", path))
    except (philips.PhilipsError, TVUnavailable) as e:
        show(label, f"no answer ({e})")


async def main(a):
    logging.basicConfig(level=logging.INFO if a.trace else logging.WARNING, format="%(message)s")
    cfg = {"id": a.tv, "name": "Philips", "kind": "philips", "ip": a.address, "trace": a.trace}
    if a.port:
        cfg["port"] = a.port
    if a.plain:
        cfg["tls"] = False
    t = philips.PhilipsTV(cfg)
    t.ip = a.address
    try:
        t.connected = await t.port_open()
        if not t.connected:
            print(f"Nothing answers on port {t.port} at {a.address}. Is the TV on, and on the same network?")
            if t.port == philips.PORT_TLS:
                print("Older Philips TVs use port 1925 without encryption: try again with --plain.")
            return 1
        print(f"Port {t.port} is open.")
        try:
            v = await t.find_version()
        except philips.PhilipsError as e:
            print(f"Stopped: {e}")
            return 1
        print(f"JointSpace answers on /{v}" + ("" if v else " (no version in the path)"))
        show("About the TV", t.system or "(it wants a login even for this)")
        print(f"Pairing key saved: {'yes' if t._secret() else 'no (scripts/philips-secret.py)'}. "
              f"Paired: {'yes' if t.paired else 'no'}.")
        if a.pin or a.pair:
            if not a.pin:
                await t.pair_start()
                print("The TV should now show a PIN.")
                if not sys.stdin.isatty():
                    print(f"Run: scripts/philips-check.py {a.address} --pin <the digits> (within a minute)")
                    return 0
                a.pin = await asyncio.get_running_loop().run_in_executor(None, input, "The PIN on the TV: ")
            await t.pair_finish(a.pin)
            print("Paired: the login is kept in bridge/data (git ignores it). Run this again without --pair.")
            return 0
        if not t.paired:
            print("Not paired yet, so that is all it can read. Next: --pair (docs/PHILIPS-TITAN-TESTING.md, step 6).")
            return 0
        await read(t, "Power", "powerstate")
        await read(t, "Volume", "audio/volume")
        await read(t, "Inputs", "sources")
        await read(t, "In front now", "activities/current")
        await t.refresh_installed(force=True)
        print(f"Apps it lists: {len(t.applist)}")
        for x in t.applist:
            print(f"  {x['id']}  {x['label']}  -> couch-tv knows it as {x['package']}")
        if t.applist:
            show("The first app exactly as the TV lists it", t.applist[0]["entry"])
        print("Now open an app with the TV's own remote (Netflix, say) and run this again: the "
              "\"In front now\" line should change. Then open DevView if the TV has it, and run it once more.")
        return 0
    except (philips.PhilipsError, TVUnavailable, ValueError) as e:
        print(f"Stopped: {e}")
        return 1
    finally:
        if t._session:
            await t._session.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address")
    p.add_argument("--tv", default="philips", help="the TV's id in config.json, so the login is kept under it")
    p.add_argument("--port", type=int)
    p.add_argument("--plain", action="store_true", help="older Philips: port 1925, no encryption")
    p.add_argument("--pair", action="store_true")
    p.add_argument("--pin")
    p.add_argument("--trace", action="store_true", help="print every request and answer (PINs and keys hidden)")
    sys.exit(asyncio.run(main(p.parse_args())))
