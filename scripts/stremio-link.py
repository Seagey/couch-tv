#!/usr/bin/env python3
"""Links couch-tv to your Stremio account, for Stremio's Continue Watching in Keep watching.

    .venv/bin/python scripts/stremio-link.py            sign in with a link (Stremio's own TV sign-in)
    .venv/bin/python scripts/stremio-link.py --check    count what Stremio's Continue Watching holds

Stremio puts nothing in Android's Watch Next list, so the TV home reads Stremio's own Continue
Watching from your Stremio account instead (docs/CONFIG.md, Stremio). This asks Stremio for a short
sign-in code, prints its link, and waits (up to 10 minutes) while you open the link on your phone
or computer, sign in to Stremio there and allow it. Stremio then hands this script a key for your
account, which it saves as STREMIO_AUTH_KEY in .env (git ignores .env). The key is never printed.
Your Stremio password never passes through here.

apply.sh hands the key to the TV app, which keeps it in its own private storage and only uses it to
read your Stremio library (nothing is ever written to your account). To unlink: delete the
STREMIO_AUTH_KEY line from .env and run apply.sh again.
"""
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = os.path.join(ROOT, ".env")
LINK = "https://link.stremio.com/api/v2/"
API = "https://api.strem.io/api/"
KEY = re.compile(r"[A-Za-z0-9._=+/-]{16,512}")   # Stremio's keys are base64 with "=" padding
WAIT_S = 600


MOST_BYTES = 32 * 1024 * 1024   # a big library is a few MB


def call(url, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "couch-tv"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(MOST_BYTES).decode())


def saved_key():
    try:
        with open(ENV) as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                if k.strip() == "STREMIO_AUTH_KEY":
                    return v.strip().strip("\"'")
    except OSError:
        pass
    return os.environ.get("STREMIO_AUTH_KEY") or ""


def save_key(key):
    lines = []
    try:
        with open(ENV) as f:
            lines = [ln for ln in f.read().splitlines() if not ln.strip().startswith("STREMIO_AUTH_KEY=")]
    except OSError:
        pass
    lines.append("STREMIO_AUTH_KEY=" + key)
    fd = os.open(ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)


def pick(items):
    """Stremio's own Continue Watching rule (stremio-core): a library item that is not of type
    "other", not removed (unless it is only temporary), and part way through. Newest first. The TV
    app (Stremio.kt) uses the same rule."""
    out = []
    for it in items or []:
        st = it.get("state") or {}
        if it.get("type") == "other" or (it.get("removed") and not it.get("temp")):
            continue
        if (st.get("timeOffset") or 0) > 0:
            out.append(it)
    out.sort(key=lambda it: (it.get("state") or {}).get("lastWatched") or it.get("_mtime") or "", reverse=True)
    return out


def continue_watching(key):
    j = call(API + "datastoreGet", {"authKey": key, "collection": "libraryItem", "ids": [], "all": True}, timeout=20)
    if "error" in j:
        raise SystemExit(f"Stremio did not accept the key ({j['error'].get('message', 'error')}). Run this script again to sign in.")
    return pick(j.get("result"))


def main():
    if "--check" in sys.argv:
        key = saved_key()
        if not KEY.fullmatch(key or ""):
            raise SystemExit("No STREMIO_AUTH_KEY in .env yet. Run: .venv/bin/python scripts/stremio-link.py")
        n = len(continue_watching(key))
        print(f"ok: Stremio's Continue Watching has {n} show{'s' if n != 1 else ''} or film{'s' if n != 1 else ''}")
        return
    if "--code" in sys.argv:
        # a code that was already allowed (a run that stopped before it saved the key)
        code = sys.argv[sys.argv.index("--code") + 1].strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{3,12}", code):
            raise SystemExit("That does not look like a Stremio sign-in code.")
        print(f"Reading the key for code {code}...", flush=True)
    else:
        made = call(LINK + "create?type=Create").get("result") or {}
        code, link = made.get("code"), made.get("link")
        if not code or not link:
            raise SystemExit("Stremio did not hand out a sign-in code. Try again in a minute.")
        print(f"Open {link} on your phone or computer, sign in to Stremio there and allow couch-tv.")
        print(f"(Or go to link.stremio.com and type the code {code}.) Waiting up to {WAIT_S // 60} minutes...", flush=True)
    end = time.time() + WAIT_S
    while time.time() < end:
        time.sleep(3)
        try:
            got = call(LINK + "read?type=Read&code=" + code).get("result") or {}
        except Exception:
            continue
        key = got.get("authKey") or ""
        if key:
            if not KEY.fullmatch(key):
                raise SystemExit("Stremio answered with a key that does not look right. Nothing was saved.")
            save_key(key)
            n = len(continue_watching(key))
            print(f"ok: linked to Stremio. The key is in .env (never printed). Continue Watching has {n} item{'s' if n != 1 else ''}.")
            return
    raise SystemExit("No sign-in within 10 minutes. Run this script again for a fresh code.")


if __name__ == "__main__":
    main()
