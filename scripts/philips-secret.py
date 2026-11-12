#!/usr/bin/env python3
"""Save the Philips pairing key on this computer, for a Philips TV on Titan OS (docs/PHILIPS-TITAN.md).

    .venv/bin/python scripts/philips-secret.py            # asks for it, without showing what you type
    .venv/bin/python scripts/philips-secret.py --check    # says whether one is saved, never what it is

Philips TVs only pair with a phone remote that signs the PIN with a key from Philips's own TV Remote
app. couch-tv does not ship that key: it is Philips's, not ours to hand out. You take it from your
own copy of the official app, or from wherever you trust, and this script keeps it in
bridge/data/philips/pair-secret (only you can read it, and git ignores it). Nothing is sent anywhere.

It checks only that what you type is base64 text of a sensible length. Whether it is the right key
shows when you pair (scripts/philips-check.py --pair).
"""
import base64
import binascii
import getpass
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.environ.get("COUCH_DATA") or os.path.join(ROOT, "bridge", "data"), "philips", "pair-secret")


def main():
    if "--check" in sys.argv:
        print("A pairing key is saved." if os.path.isfile(OUT) and open(OUT).read().strip() else "No pairing key saved yet.")
        return 0
    value = getpass.getpass("Paste the pairing key (nothing shows as you paste), then press Enter: ").strip()
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        print("That is not base64 text. Nothing was saved.")
        return 1
    if not 16 <= len(raw) <= 256:
        print("That is base64, but not a length a key would be. Nothing was saved.")
        return 1
    os.makedirs(os.path.dirname(OUT), mode=0o700, exist_ok=True)
    with open(os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        f.write(value + "\n")
    where = os.path.relpath(OUT, ROOT) if OUT.startswith(ROOT + os.sep) else OUT
    print(f"ok: saved in {where} (git ignores it). Next: scripts/philips-check.py <tv address> --pair")
    return 0


if __name__ == "__main__":
    sys.exit(main())
