#!/usr/bin/env python3
"""The first test on a Philips TV with Titan OS or an older Philips Linux TV (Saphi). Run it with the bridge
stopped. Guides: docs/PHILIPS-TITAN-TESTING.md and docs/PHILIPS-SAPHI-TESTING.md.

    .venv/bin/python scripts/philips-check.py <tv address>             # read only, no login needed
    .venv/bin/python scripts/philips-check.py <tv address> --pair      # the TV shows a PIN; type it here
    .venv/bin/python scripts/philips-check.py <tv address> --pin 1234  # or send the PIN on its own

Without --pair it only reads: which ports answer (1926, encrypted, and 1925, plain), which API version the
TV answers, what it says about itself (including whether it lists a "browser" activity), whether it wants a
login at all, and, once paired or on a TV that wants none, whether it is on, its volume, its inputs, the
apps it lists and the app in front. Plain port 1925 is tried first when it is open. It
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
    if not a.port and not a.plain:
        # Knock on both: plain 1925 first (older Philips Linux TVs, Saphi), else encrypted 1926.
        probe = philips.PhilipsTV(cfg | {"saphi": True})
        probe.ip = a.address
        plain_open = await probe.port_open(philips.PORT_PLAIN)
        tls_open = await probe.port_open(philips.PORT_TLS)
        print(f"Port {philips.PORT_PLAIN} (plain): {'open' if plain_open else 'closed'}. "
              f"Port {philips.PORT_TLS} (encrypted): {'open' if tls_open else 'closed'}.")
        if plain_open:
            cfg["saphi"] = True     # plain first; a plain port that wants a login hands over to 1926
    t = philips.PhilipsTV(cfg)
    t.ip = a.address
    try:
        t.connected = await t.port_open()
        if not t.connected:
            print(f"Nothing answers on port {t.port} at {a.address}. Is the TV on, and on the same network?")
            print("A TV in deep standby does not answer at all: switch it on with its own remote and run this again.")
            return 1
        print(f"Port {t.port} is open.")
        try:
            v = await t.find_version()
        except philips.PhilipsError as e:
            print(f"Stopped: {e}")
            return 1
        print(f"JointSpace answers on /{v}" + ("" if v else " (no version in the path)")
              + f", port {t.port} ({'encrypted' if t.tls else 'plain'})")
        show("About the TV", t.system or "(it wants a login even for this)")
        print(f"Browser activity listed: {'yes' if t.has_browser else 'no'}"
              + (" (couch-tv's page can open in the TV's browser)" if t.has_browser else ""))
        if t.open_api:
            print("Login: none needed. This TV answers without pairing, so there is nothing to pair.")
        else:
            print(f"Pairing key saved: {'yes' if t._secret() else 'no (scripts/philips-secret.py)'}. "
                  f"Paired: {'yes' if t.paired else 'no'}.")
        if (a.pin or a.pair) and t.open_api:
            print("Nothing to pair on this TV. Run this again without --pair.")
            return 0
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
        if not t.paired and not t.open_api:
            print("Not paired yet, so that is all it can read. Next: --pair (docs/PHILIPS-TITAN-TESTING.md, step 6).")
            return 0
        await read(t, "Power", "powerstate")
        await read(t, "Volume", "audio/volume")
        await read(t, "Inputs", "sources")
        await read(t, "Input in front", "sources/current")
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
