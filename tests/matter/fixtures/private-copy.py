#!/usr/bin/env python3
"""Makes a private copy of the Matter fixtures kit on the MacBook, so one builder's contract runs never
meet another's: its own folder (~/<name>), ports, discriminators, device storage, "home" controller and
run lock (~/<name>.lock). Run it on the MacBook, after ~/matter-fixtures/fx.py is deployed:

  python3 private-copy.py ma-fixtures --port 5741
  ~/ma-fixtures/fx up
  python3 tests/matter_contract.py --api ... --fx "ssh macbook ma-fixtures/fx"

The shared kit uses ports 5541-5548 and short discriminators 1 to 8 (factory and share codes). An 11
digit code carries only the short discriminator (top 4 bits), and 15 is the harness's "no such device",
so 0 and 9 to 14 are left: 7 for 8 devices. The copy's alarm (last device) reuses 8; it is only ever
shared, never commissioned by a factory code, so pass --nibbles to move it if two copies run at once.
First written by the matter-android builder (scratchpad ma-mkfx.py, 21 Nov 2026).
"""
import argparse
import os
import re

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("name", help="folder name in the home folder, e.g. ma-fixtures (not matter-fixtures)")
ap.add_argument("--port", type=int, default=5741, help="first of 8 device ports (default 5741)")
ap.add_argument("--nibbles", default="9,10,11,12,13,14,0,8",
                help="8 short discriminators, one per device (default 9,10,11,12,13,14,0,8)")
args = ap.parse_args()
if args.name == "matter-fixtures" or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,40}", args.name):
    raise SystemExit("pick another plain folder name (letters, digits, _ or -, up to 41), e.g. ma-fixtures")
nibbles = [int(x) for x in args.nibbles.split(",")]
if len(nibbles) != 8 or any(not 0 <= n <= 14 for n in nibbles):
    raise SystemExit("--nibbles needs 8 numbers from 0 to 14")

home = os.path.expanduser("~")
src = open(os.path.join(home, "matter-fixtures", "fx.py")).read()
s = src.replace('FX = os.path.join(HOME, "matter-fixtures")', f'FX = os.path.join(HOME, "{args.name}")')
assert s != src, "fx.py has no FX line to change"
i = 0


def dev(m):
    global i
    r = f"port={args.port + i}, disc={hex((nibbles[i] << 8) | 0x40 | i)}"
    i += 1
    return r


s = re.sub(r"port=55\d\d, disc=0x[0-9a-f]+", dev, s)
assert i == 8, f"expected 8 devices, changed {i}"
old = "SHARE_DISC = {n: ((i + 1) << 8) | 0x90 for i, n in enumerate(ORDER)}"
assert old in s, "fx.py has no SHARE_DISC line to change"
s = s.replace(old, "SHARE_DISC = {n: (%r[i] << 8) | 0xA0 for i, n in enumerate(ORDER)}" % nibbles)
d = os.path.join(home, args.name)
os.makedirs(d, exist_ok=True)
with open(os.path.join(d, "fx.py"), "w") as f:
    f.write(s)
with open(os.path.join(d, "fx"), "w") as f:
    f.write(f'#!/bin/sh\nexec python3 "$HOME/{args.name}/fx.py" "$@"\n')
os.chmod(os.path.join(d, "fx"), 0o755)
print("ok", d, "ports", args.port, "to", args.port + 7)
