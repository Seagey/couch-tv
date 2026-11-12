"""A stand-in couch-tv bridge for the Apple TV app (tvos/), no Apple TV needed.

    .venv/bin/python tests/appletv_home_standin.py [--port 5455] [--code-file <path>] [--kids]

Runs the bridge's real server (bridge/server.py) on this computer, with a made up config.json in a temporary
folder: one Apple TV (the stand-in from tests/appletv_standin.py, already paired), two people, a pairing key,
two Keep watching cards and the weather (no internet needed). It prints a six digit code for Couch TV's
Settings (and writes it to --code-file), then prints every app the bridge asks the Apple TV to open. Point
the tvOS Simulator's Couch TV, or tvos/preview/render.sh, at 127.0.0.1:<port>. Ctrl-C stops it.

--kids adds a third person, Ruby, a kids profile (kids mode, parent PIN 2580) and makes her the one watching,
for Couch TV's kids mode. Her shows are looked up on JustWatch for their posters when there is internet.
"""
import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
KEY = "couchpass123"
TV_ID = "lounge-appletv"


KIDS_PIN = "2580"
KIDS = {"id": "ruby", "name": "Ruby", "kid": True, "kids_mode": {
    "pin": KIDS_PIN,
    "shows": [{"title": "Bluey", "service": "abc-iview"}, {"title": "Hey Duggee", "service": "abc-iview"},
              {"title": "Peppa Pig", "service": "abc-iview", "season": 1, "episode": 3},
              {"title": "Octonauts", "service": "abc-iview"}, {"title": "Puffin Rock", "service": "netflix"},
              {"title": "Sarah & Duck", "service": "abc-iview"}],
    "apps": ["abc-iview", "youtube"]}}


def write_config(folder, atv_port, port, with_kids=False):
    cfg = {
        "bridge": {"host": "127.0.0.1", "port": port, "pairing_key": KEY},
        "default_tv": TV_ID,
        "tvs": [{"id": TV_ID, "name": "Lounge Apple TV", "kind": "appletv", "ip": "127.0.0.1", "port": atv_port}],
        "people": [{"id": "person1", "name": "Person 1"}, {"id": "person2", "name": "Person 2"}] + ([KIDS] if with_kids else []),
        "weather": {"lat": -33.8688, "lon": 151.2093, "place": "Sydney", "timezone": "Australia/Sydney"},
        "home": {"clock": "12h"},
        "country": "AU",
    }
    path = os.path.join(folder, "config.json")
    with open(path, "w") as f:
        json.dump(cfg, f, indent=1)
    return path


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5455)
    ap.add_argument("--code-file")
    ap.add_argument("--kids", action="store_true", help="add a kids profile and make her the one watching")
    args = ap.parse_args()

    folder = tempfile.mkdtemp(prefix="couchtv-atv-")
    data = os.path.join(folder, "data")
    os.makedirs(data)
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(ROOT / "bridge"))

    # the config first (the bridge reads it on import), then the stand-in Apple TV, whose port is only
    # known once it listens
    os.environ["COUCH_DATA"] = data
    os.environ["COUCH_CONFIG"] = write_config(folder, 49153, args.port, args.kids)
    os.environ["COUCHTV_NO_BONJOUR"] = "1"
    import config  # noqa: F401  (reads COUCH_CONFIG)
    import server
    import store
    import appletv_standin
    from aiohttp import web

    standin = await appletv_standin.StandIn().__aenter__()
    standin.apps.pop("app.couchtv.tvos", None)
    standin.apps["dev.couchtv.appletv.standin"] = "Couch TV"
    standin.apps.update({"com.disney.disneyplus": "Disney+", "au.net.abc.iview": "ABC iview",
                         "com.amazon.aiv.AIVApp": "Prime Video", "au.com.sbs.ondemand": "SBS On Demand"})
    t = server.TVS[TV_ID]
    t.port = standin.port
    t.store_file = os.path.join(data, f"appletv-{TV_ID}.json")
    await t.pair_start()
    await t.pair_finish(standin.pin)

    now = datetime.now(timezone.utc)
    for i, (title, service, s, e, poster) in enumerate([
            ("Night Shift", "disney-plus", 3, 2, "/tv/backgrounds/tessellated-pavement.jpg"),
            ("The Long Road", "abc-iview", 1, 4, "/tv/backgrounds/grose-valley.jpg"),
            ("Harbour Lights", "netflix", 2, 1, "/tv/backgrounds/vang-vieng-sunset.jpg")]):
        store.add_history({"title": title, "type": "show", "service": service, "season": s, "episode": e,
                           "poster": poster, "who": "person1", "tv": TV_ID,
                           "when": (now - timedelta(hours=i + 1)).isoformat()})
    store.save_who("ruby" if args.kids else "person1", TV_ID)
    real_find = server.finder.find
    kid_titles = {s["title"].lower() for s in KIDS["kids_mode"]["shows"]} if args.kids else set()

    async def find(title, *a, **k):         # no internet: every show is found as itself, on the three apps
        if title.lower() in kid_titles:     # the kids shelf's posters, from JustWatch when there is internet
            try:
                got = await real_find(title)
                if got and got[0]:
                    return got
            except Exception:
                pass
        return {"title": title, "poster": None, "backdrop": None, "year": 2024, "type": "show",
                "providers": [{"service": s, "name": s, "playable": True, "kind": "flatrate", "web": None,
                               "deeplink": f"https://example.invalid/{s}"} for s in ("netflix", "disney-plus", "abc-iview")]}, []

    async def resolve_episode(*a, **k):
        return {}
    server.finder.find = find
    server.resolve_episode = resolve_episode
    server.weather_cache.update({"data": {"place": "Sydney", "temp": 22, "code": 1, "text": "Mainly clear",
                                          "is_day": True}, "at": time.time() + 10 ** 9})

    seen = len(standin.log)

    async def show_launches():
        nonlocal seen
        while True:
            for k, *r in standin.log[seen:]:
                if k in ("launch", "url"):
                    print(f"apple tv: opened {r[0]}", flush=True)
            seen = len(standin.log)
            await asyncio.sleep(0.2)

    app = server.make_app()
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", args.port).start()
    asyncio.create_task(show_launches())
    server._current.set(TV_ID)
    code = f"{__import__('secrets').randbelow(10 ** 6):06d}"
    server.appletv_codes[code] = (time.monotonic() + server.APPLETV_CODE_SECS, TV_ID)
    if args.code_file:
        Path(args.code_file).write_text(code)
    print(f"stand-in bridge on http://127.0.0.1:{args.port}, code {code} (pairing key {KEY})"
          + (f", kids profile Ruby, parent PIN {KIDS_PIN}" if args.kids else ""), flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()
        await standin.__aexit__()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
