#!/usr/bin/env python3
"""Write vega/src/bridge.json for the couch-tv Vega app: where the bridge is, and the pairing key.

    COUCHTV_KEY=<pairing key> python3 vega/make-config.py http://192.0.2.20:5400 [tv id]

The key comes from the COUCHTV_KEY environment variable, never the command line (shell history), and
the file is in .gitignore. It goes inside the app you build for your own stick: do not share that app.
"""
import json
import os
import re
import sys
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))


def build(url, key="", tv=""):
    u = urlparse(url)
    if u.scheme != "http" or not u.hostname or u.path not in ("", "/"):
        raise SystemExit("the bridge address looks like http://192.0.2.20:5400 (no path)")
    if key and not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", key):
        raise SystemExit("the pairing key is letters, digits, - and _ only")
    if tv and not re.fullmatch(r"[a-z-]{1,40}", tv):
        raise SystemExit("the TV id is lower case letters and - only")
    return {"url": f"http://{u.netloc}", "key": key, "tv": tv}


def main(argv):
    if not 2 <= len(argv) <= 3:
        raise SystemExit(__doc__)
    cfg = build(argv[1], os.environ.get("COUCHTV_KEY", ""), argv[2] if len(argv) == 3 else "")
    path = os.path.join(HERE, "src", "bridge.json")
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
    os.chmod(path, 0o600)
    print("wrote", os.path.relpath(path), "(key hidden)" if cfg["key"] else "(no key)")


if __name__ == "__main__":
    main(sys.argv)
