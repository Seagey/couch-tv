#!/usr/bin/env python3
"""A six digit code for couch-tv's Apple TV app (docs/APPLE-TV.md, "The home app").

    .venv/bin/python scripts/appletv-home-code.py [<apple tv id>]

Run it on the computer with the bridge, while the bridge is running. It asks the bridge for a code and
prints it with the bridge's address. Type the code into Couch TV on the Apple TV (Settings in the app):
the app swaps it for the bridge's pairing key, once. A code works once, for ten minutes. The pairing key
itself is never printed.

Only needed when config.json has bridge.pairing_key. Without a key the app needs nothing typed: it finds
the bridge on the network by itself.
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge"))
import config  # noqa: E402


def main():
    tvs = [t for t in config.CONFIG.get("tvs", []) if t.get("kind") == "appletv"]
    if not tvs:
        sys.exit("config.json has no Apple TV (\"kind\": \"appletv\"). See docs/APPLE-TV.md.")
    want = sys.argv[1] if len(sys.argv) > 1 else tvs[0]["id"]
    if want not in {t["id"] for t in tvs}:
        sys.exit(f"no Apple TV called {want} in config.json (there is {', '.join(t['id'] for t in tvs)})")
    port = int(os.environ.get("PORT") or config.BRIDGE["port"])
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/appletv/code?tv={want}", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    if config.PAIRING_KEY:
        req.add_header("Authorization", "Bearer " + config.PAIRING_KEY)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"the bridge said no ({e.code}): {e.read().decode(errors='replace')[:200]}")
    except OSError as e:
        sys.exit(f"the bridge is not answering on port {port} ({e}). Start it first (docs/SETUP.md, step 5).")
    code = j["code"]
    print(f"Code for Couch TV on the Apple TV: {code[:3]} {code[3:]}")
    print(f"It works once, for {j['expires_in'] // 60} minutes.")
    if not config.PAIRING_KEY:
        print("This bridge has no pairing key, so the app does not need the code: it connects by itself.")


if __name__ == "__main__":
    main()
