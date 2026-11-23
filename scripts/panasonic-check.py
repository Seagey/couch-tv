#!/usr/bin/env python3
"""The first test on a Panasonic Viera (docs/PANASONIC.md). Run it with the bridge stopped.

    .venv/bin/python scripts/panasonic-check.py <tv address>                 # read only
    .venv/bin/python scripts/panasonic-check.py <tv address> --pair          # encrypted sets: the TV shows a PIN,
                                                                             # you type it here, the keys are kept

Reading asks the TV for its device description (the model), its action list (which says whether it is
an encrypted set that needs pairing), its volume and whether it is muted. It sends no key, opens nothing
and changes nothing. Every message is printed with any PIN, key or session hidden.
Paste the output into a GitHub issue: it is what turns the UNCONFIRMED lines in bridge/panasonic.py into facts.
"""
import argparse
import asyncio
import logging
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import panasonic  # noqa: E402


async def main(a):
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    cfg = {"id": a.tv, "name": "Panasonic", "kind": "panasonic", "ip": a.address, "trace": True}
    if a.port:
        cfg["port"] = a.port
    t = panasonic.PanasonicTV(cfg)
    t.ip = a.address
    t.connected = await t.port_open()
    if not t.connected:
        print(f"Nothing answers on port {t.port} at {a.address}. Is the TV on? (Some sets stop answering in standby.)")
        return 1
    try:
        if a.pair:
            if not await t.pair_start():
                print("This TV takes commands without pairing. Nothing to do.")
                return 0
            if not sys.stdin.isatty():
                print("The TV should show a PIN. Run this again in a terminal to type it.")
                return 1
            pin = await asyncio.get_running_loop().run_in_executor(None, input, "The PIN on the TV: ")
            await t.pair_finish(pin)
            print("Paired: the keys are kept in bridge/data (git ignores it).")
            return 0
        enc = await t.detect()
        print(f"Model: {t.model or 'not given'}")
        print(f"Services: {', '.join(sorted(t.services)) or 'none listed'}")
        sdd = await t._get(panasonic.PROTOCOL["actions"])
        names = re.findall(r"<name>([^<]+)</name>", sdd)
        print(f"Remote actions ({len(names)}): {', '.join(names)}")
        print("Encrypted set: " + ("yes, pair once with --pair (the TV shows a PIN)" if enc else "no, no pairing needed"))
        v = await t._read_volume()
        print(f"Volume: {v['level'] if v['known'] else 'not read'}, muted: {v['muted']}")
        return 0
    except Exception as e:
        print(f"Stopped: {e}")
        return 1
    finally:
        await t.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("address")
    p.add_argument("--tv", default="panasonic", help="the TV's id in config.json, so the keys are kept under it")
    p.add_argument("--port", type=int)
    p.add_argument("--pair", action="store_true")
    sys.exit(asyncio.run(main(p.parse_args())))
