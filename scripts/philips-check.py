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

Not paired, it still tries each read once and says which ones the TV guards with the login.

The PIN, every key and the TV's serial number are hidden in what it prints. Paste the output into a GitHub issue: it is what
turns the guesses in bridge/philips.py into facts.
"""
import argparse
import asyncio
import json
import logging
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import philips  # noqa: E402
from tv import TVUnavailable  # noqa: E402


READS = [("Power", "powerstate"), ("Volume", "audio/volume"), ("Inputs", "sources"),
         ("Input in front", "sources/current"), ("In front now", "activities/current")]
PRIVATE = re.compile(r"serial|deviceid|mac", re.I)   # what names this one TV: hidden, the output goes in a public issue


def hide(value):
    if isinstance(value, dict):
        return {k: "(hidden)" if PRIVATE.search(k) and not isinstance(v, (dict, list)) else hide(v)
                for k, v in value.items()}
    return [hide(v) for v in value] if isinstance(value, list) else value


async def knock(ip, port, timeout=1.0):
    """Knock on a port and say why it did not open: open, refused (the TV answered "no"), silent (nothing came
    back in time) or unreachable (this computer cannot get to the address at all)."""
    try:
        _, w = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout)
        w.close()
        return "open"
    except ConnectionRefusedError:
        return "refused"
    except (asyncio.TimeoutError, TimeoutError):
        return "silent"
    except OSError:
        return "unreachable"


def why_closed(states):
    """The sentence for the ports that did not open. Unreachable and silent beat refused: one refusal does not
    mean the TV is simply not listening if the other port went quiet."""
    if "unreachable" in states:
        return ("This computer cannot reach devices on the home network. The usual causes: a VPN app with a kill "
                "switch, macOS Local Network permission refused (System Settings, Privacy and Security, Local "
                "Network), a guest Wi-Fi, or router client isolation.")
    if "silent" in states:
        return "Nothing came back. The TV is probably in deep standby: switch it on with its own remote and run this again."
    if "refused" in states:
        return "The TV is on the network but has no Philips network remote on these ports."
    return None


def show(label, value):
    text = json.dumps(hide(value), ensure_ascii=False) if not isinstance(value, str) else value
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
    states = {}
    if not a.port and not a.plain:
        # Knock on both: plain 1925 first (older Philips Linux TVs, Saphi), else encrypted 1926.
        states = {p: await knock(a.address, p) for p in (philips.PORT_PLAIN, philips.PORT_TLS)}
        say = {k: v if v == "open" else f"closed ({v})" for k, v in states.items()}
        print(f"Port {philips.PORT_PLAIN} (plain): {say[philips.PORT_PLAIN]}. "
              f"Port {philips.PORT_TLS} (encrypted): {say[philips.PORT_TLS]}.")
        if states[philips.PORT_PLAIN] == "open":
            cfg["saphi"] = True     # plain first; a plain port that wants a login hands over to 1926
    t = philips.PhilipsTV(cfg)
    t.ip = a.address
    try:
        t.connected = await t.port_open()
        if not t.connected:
            if not states:
                states = {t.port: await knock(a.address, t.port)}
            print(f"Nothing answers on port {t.port} at {a.address} ({states.get(t.port) or 'closed'}).")
            print(why_closed(states.values()) or "Is the TV on, and on the same network? Run this again.")
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
              + (" (couch-tv may be able to open its page there: not tested)" if t.has_browser else ""))
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
            print("What the TV answers without a login:")
            for label, path in READS + [("Apps", "applications")]:
                try:
                    show(f"  {label}", await t._call("GET", path))
                except philips.NeedsLogin:
                    print(f"  {label}: wants a login")
                except (philips.PhilipsError, TVUnavailable) as e:
                    print(f"  {label}: no answer ({e})")
            print("Not paired yet, so that is all it can read. Next: --pair (docs/PHILIPS-TITAN-TESTING.md, step 6).")
            return 0
        for label, path in READS:
            await read(t, label, path)
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
