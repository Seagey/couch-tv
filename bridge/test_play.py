"""End-to-end /api/play run against the real TV (the bridge must be running).

For each case: POST /api/play, wait, note the app really on screen (ADB), save a screenshot to
data/play-shots/, go home. Usage: ../.venv/bin/python test_play.py [case ...]
Every case is logged as a real play. Afterwards write [] to data/history.json and {} to
data/recs.json, or the test titles show up as keep watching and shape the picks.
"""
import json
import os
import sys
import time

from test_deeplinks import call, front

# These scripts drive a REAL TV through a running bridge (they play shows and write watch history).
# They refuse to run unless asked on purpose, so an agent running "all the tests" never fires them.
if os.environ.get("COUCHTV_REAL_TV") != "1":
    sys.exit("This drives a real TV. Set COUCHTV_REAL_TV=1 to run it on purpose.")


OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "play-shots")

CASES = {
    "netflix": {"title": "Stranger Things", "service": "netflix"},
    "stan": {"title": "Bump", "service": "stan"},
    "abc-iview": {"title": "Bluey", "season": 3, "episode": 4},
    "sbs-on-demand": {"title": "Alone Australia"},
    "disney-plus": {"title": "The Bear"},
    "9now": {"title": "The Block", "service": "9now"},
    "10play": {"title": "Paw Patrol", "service": "10play"},
    "prime-video": {"title": "The Boys"},
    "binge": {"title": "Colin from Accounts"},
}


def main(names):
    os.makedirs(OUT, exist_ok=True)
    for name in names:
        start = time.time()
        r = call("POST", "/api/play", {**CASES[name], "who": "both"})
        took = round(time.time() - start, 1)
        time.sleep(8)
        at = front()
        png = call("GET", "/api/screenshot", raw=True)
        with open(os.path.join(OUT, f"{name}.png"), "wb") as f:
            f.write(png)
        print(json.dumps({"case": name, "ok": r.get("ok"), "service": r.get("service"),
                          "method": r.get("method"), "note": r.get("note") or r.get("error"),
                          "seconds": took, "front_after_8s": at}), flush=True)
        call("POST", "/api/key", {"key": "home"})
        time.sleep(3)


if __name__ == "__main__":
    main(sys.argv[1:] or list(CASES))
