#!/usr/bin/env python3
"""The first test on a VIZIO TV, SmartCast or VIZIO OS (docs/VIZIO.md). Run it with the bridge stopped.

    .venv/bin/python scripts/vizio-check.py <tv address>                 # read only
    .venv/bin/python scripts/vizio-check.py <tv address> --pair          # the TV shows a PIN
    .venv/bin/python scripts/vizio-check.py <tv address> --pin 1234      # send the PIN, keep the token

Reading finds the port the TV answers on (7345, then 9000), then asks for the power state, the model,
the input on screen, the inputs, the app in front and the volume, and prints what the TV answered
("trace"). It sends no key, opens nothing and changes no setting. Without pairing, most VIZIOs answer
"requires pairing" to these reads, and that is a useful result too. The PIN and the token are never
printed. Paste the output into a GitHub issue: it is what turns the guesses in bridge/vizio.py into facts.
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import vizio  # noqa: E402
from tv import TVUnavailable  # noqa: E402


async def read(t, label, fn):
    try:
        got = await fn()
        print(f"{label}: {got}")
        return got
    except vizio.NeedsPairing as e:
        print(f"{label}: needs pairing ({e})")
    except (vizio.VizioError, TVUnavailable) as e:
        print(f"{label}: no answer ({e})")
    return None


async def main(a):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = {"id": a.tv, "name": "VIZIO", "kind": "vizio", "ip": a.address, "trace": True}
    if a.port:
        cfg["port"] = a.port
    t = vizio.VizioTV(cfg)
    t.ip = a.address
    try:
        t.connected = await t.port_open()
        if not t.connected:
            print(f"Nothing answers on port {' or '.join(map(str, t.ports))} at {a.address}. Is the TV on "
                  "(some sets drop off the network in standby or Eco mode)?")
            return 1
        try:
            port = await t.find_port()
        except TVUnavailable as e:
            print(f"A port is open, but nothing answers like a VIZIO: {e}")
            return 1
        print(f"SmartCast answers on port {port}. Paired already: {'yes' if t.paired else 'no'}.")
        if a.pin:
            await t.pair_finish(a.pin)
            print("Paired: the token is kept in bridge/data (git ignores it).")
            return 0
        if a.pair:
            await t.pair_start()
            if sys.stdin.isatty():
                pin = await asyncio.get_running_loop().run_in_executor(None, input, "The PIN on the TV: ")
                await t.pair_finish(pin)
                print("Paired: the token is kept in bridge/data (git ignores it).")
                return 0
            print(f"Asked for a PIN. If the TV shows one, run: scripts/vizio-check.py {a.address} --pin <the 4 digits>")
            return 0
        power = await read(t, "Power (1 on, 0 standby)", t._read_power)
        await read(t, "Model and firmware", lambda: t._call("GET", vizio.PROTOCOL["device_info"]))
        await read(t, "Input on screen", t.current_input)
        await read(t, "Inputs", t.read_sources)
        if power == 1:
            await read(t, "App in front (name space, id)", t._read_front)
            await read(t, "Volume", t.read_volume)
        print("The TV keeps its app list in VIZIO's cloud, not on the set: couch-tv uses its own table "
              "(APPS in bridge/vizio.py).")
        return 0
    except (vizio.VizioError, TVUnavailable, ValueError) as e:
        print(f"Stopped: {e}")
        return 1
    finally:
        await t.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address")
    p.add_argument("--tv", default="vizio", help="the TV's id in config.json, so the token is kept under it")
    p.add_argument("--port", type=int)
    p.add_argument("--pair", action="store_true")
    p.add_argument("--pin")
    sys.exit(asyncio.run(main(p.parse_args())))
