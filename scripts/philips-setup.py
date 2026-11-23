#!/usr/bin/env python3
"""Set up a Philips TV with Titan OS in one go. Run it with the bridge stopped. Guide: docs/PHILIPS-TITAN.md.

    .venv/bin/python scripts/philips-setup.py <tv address>

It checks the TV answers, reads what it says about itself, and checks the pairing key is saved (without it
it stops, changing nothing). Then it asks before pairing: the TV shows a PIN (the only thing that appears on
the TV), you type it here, and it reads power, volume and apps. It ends by printing the entry to paste into
"tvs" in config.json. It does not write config.json. Not on a terminal, it prints the next command and stops.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "bridge"))
import philips  # noqa: E402
from tv import TVUnavailable  # noqa: E402

_spec = importlib.util.spec_from_file_location("philips_check", os.path.join(HERE, "philips-check.py"))
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


async def ask(prompt):
    return await asyncio.get_running_loop().run_in_executor(None, input, prompt)


async def main(a):
    cfg = {"id": a.tv, "name": "Philips", "kind": "philips", "ip": a.address}
    if a.port:
        cfg["port"] = a.port
    t = philips.PhilipsTV(cfg)
    t.ip = a.address
    try:
        state = await check.knock(a.address, t.port)
        if state != "open":
            print(f"Nothing answers on port {t.port} at {a.address} ({state}).")
            print(check.why_closed([state]))
            return 1
        t.connected = True
        try:
            v = await t.find_version()
        except philips.PhilipsError as e:
            print(f"Stopped: {e}")
            return 1
        print(f"Found a Philips TV: JointSpace answers on /{v}, port {t.port}.")
        name = (t.system or {}).get("name") or "Philips TV"
        if t.open_api:
            print("This TV answers without a login, so there is nothing to pair.")
        elif not t.paired:
            if not t._secret():
                print("Pairing needs a key that belongs to Philips: the TV only accepts a remote that signs its PIN with it.")
                print("couch-tv cannot provide that key. If you have it from your own copy of Philips's TV Remote app, "
                      "save it with scripts/philips-secret.py and run this again.")
                print("Nothing was changed on the TV.")
                return 0
            if not sys.stdin.isatty():
                print(f"Pairing key saved. Next: scripts/philips-check.py {a.address} --pair --tv {a.tv}, "
                      f"or run this on a terminal.")
                return 0
            if (await ask("The TV will show a PIN. Go on? [y/N] ")).strip().lower() not in ("y", "yes"):
                print("Stopped. Nothing was changed on the TV.")
                return 0
            await t.pair_start()
            print("The TV should now show a PIN (it waits about 30 seconds).")
            await t.pair_finish(await ask("The PIN on the TV: "))
            print("Paired: the login is kept in bridge/data (git ignores it).")
        for label, path in check.READS[:2]:
            await check.read(t, label, path)
        await t.refresh_installed(force=True)
        print(f"Apps it lists: {len(t.applist)}")
        entry = {"id": a.tv, "name": name, "kind": "philips", "ip": a.address}
        if a.mac:
            entry["mac"] = a.mac
        print("Add this to \"tvs\" in config.json" + ("" if a.mac else " (and its \"mac\", to turn it on from fully off)") + ":")
        print(json.dumps(entry, indent=2))
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
    p.add_argument("--mac", help="the TV's network (MAC) address, to put in the entry")
    p.add_argument("--port", type=int)
    sys.exit(asyncio.run(main(p.parse_args())))
