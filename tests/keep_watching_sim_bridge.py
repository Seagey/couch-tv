"""Keep watching simulation for the bridge (option B), no TV needed.

Two pretend TVs (living room, bedroom) run the bridge's real watch loop (media_watch_loop ->
media_read -> log_seen) against made-up `dumpsys media_session` output, on a fake clock, so the
real one-minute rule is used without waiting a minute. Then a second process (the bridge
restarted) checks Keep watching per TV and per person, opens every card and moves the clock on.

    .venv/bin/python tests/keep_watching_sim_bridge.py          # both phases, prints PASS/FAIL lines
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
NETFLIX, PRIME = "com.netflix.ninja", "com.amazon.amazonvideo.livingroom"
P1, P2 = "person1", "person2"
L, B = "living-room", "bedroom"
SHOWS = ["The Witcher", "Bridgerton", "Squid Game", "Narcos", "Money Heist", "Black Mirror", "You",
         "The Crown", "Ozark", "Wednesday", "Stranger Things", "Man of Steel", "The Dark Knight", "Mindhunter"]
EPISODES = {("The Crown", "Wolferton Splash"): (1, 1), ("Stranger Things", "Chapter One"): (1, 1)}


def setup_bridge(data):
    os.environ["COUCH_DATA"] = data
    sys.path.insert(0, str(ROOT / "bridge"))
    import config
    import server
    import tv as tvmod
    config.PEOPLE[:] = [{"id": P1, "name": "Person 1"}, {"id": P2, "name": "Person 2"}]
    config.PEOPLE_IDS[:] = [P1, P2]

    class Remote:
        is_on = True
        volume_info = {}
        current_app = None

    class FakeTV(tvmod.TV):
        """A TV whose ADB answers with whatever the scenario says is playing."""
        def __init__(self, tv_id):
            super().__init__({"id": tv_id, "name": tv_id, "host": "tv.example.org", "paired": False})
            self.remote, self.connected, self.session = Remote(), True, None

        def front(self, pkg):
            self.remote.current_app = pkg

        async def adb_ready(self):
            return True

        async def adb(self, *args, timeout=None):
            up = CLOCK.now * 1000
            out = f"{CLOCK.now:.2f} 1.00\n"
            s = self.session
            if s and s["package"] == self.remote.current_app:
                pos = s["pos0"] + (up - s["at"])
                out += (f"    package={s['package']}\n    active=true\n"
                        f"    state=PlaybackState {{state=PLAYING(3), position={int(s['pos0'])}, buffered position=0, "
                        f"speed=1.0, updated={int(s['at'])}, actions=0}}\n")
                if not s.get("nometa"):
                    out += f"    metadata: size=3, description={s.get('title')}, {s.get('subtitle') or 'null'}, null\n"
                out += f"    queueTitle={s.get('queue') or 'null'}, size=0\n"
            return out

        def play(self, pkg, title=None, subtitle=None, queue=None, nometa=False, pos_s=0):
            self.front(pkg)
            self.session = {"package": pkg, "title": title, "subtitle": subtitle, "queue": queue,
                            "nometa": nometa, "pos0": pos_s * 1000, "at": CLOCK.now * 1000}

        def home(self):
            self.session = None
            self.front("com.google.android.apps.tv.launcherx")

    server.TVS.clear()
    for t in (L, B):
        server.TVS[t] = FakeTV(t)
    return server


class Clock:
    now = 1_000_000.0


CLOCK = Clock()
REAL_SLEEP = asyncio.sleep


async def fake_sleep(d, *a, **k):
    target = CLOCK.now + d
    while CLOCK.now < target:
        await REAL_SLEEP(0)


class FakeTime:
    def __getattr__(self, n):
        import time
        return getattr(time, n)

    def time(self):
        return CLOCK.now


async def advance(seconds):
    for _ in range(int(seconds)):
        CLOCK.now += 1
        for _ in range(20):
            await REAL_SLEEP(0)


def finder_patch(server):
    async def find(title, *a, **k):
        if title == "Dark":   # a near name: the finder's best match is another show
            return {"title": "Dark Matter", "poster": "p-dm", "backdrop": "b-dm", "year": 2024, "type": "show"}, []
        if title in SHOWS:
            return {"title": title, "poster": "p-" + title, "backdrop": "b-" + title, "year": 2020, "type": "show"}, []
        return None, []

    async def resolve_episode(title, subtitle):
        se = EPISODES.get((title, subtitle))
        return {"show": title, "season": se[0], "episode": se[1], "episode_title": subtitle} if se else {}
    return find, resolve_episode


async def phase_play(server):
    import store
    find, resolve = finder_patch(server)
    with patch.object(server, "time", FakeTime()), patch("asyncio.sleep", fake_sleep), \
            patch.object(server.finder, "find", new=find), patch.object(server, "resolve_episode", new=resolve):
        tasks = [server.for_tv(t, server.media_watch_loop) for t in (L, B)]
        lv, bd = server.TVS[L], server.TVS[B]
        await advance(5)
        steps = []

        def who(tv_id, p):
            store.save_who(p, tv_id)

        who(L, P1); who(B, P1)
        lv.play(NETFLIX, "Stranger Things", "Chapter One"); await advance(90); lv.home(); await advance(20)
        steps.append("L p1 Stranger Things 90 s")
        lv.play(NETFLIX, "Wednesday", "Trailer"); await advance(40); lv.home(); await advance(20)
        steps.append("L p1 Wednesday trailer 40 s (should stay out)")
        who(L, P2)
        lv.play(PRIME, "PrimeVideo"); await advance(180); lv.home(); await advance(20)
        steps.append("L p2 Prime says 'PrimeVideo' for 3 min (should stay out)")
        lv.play(PRIME, "PrimeVideo", queue="Man of Steel"); await advance(90); lv.home(); await advance(20)
        steps.append("L p2 Prime 'PrimeVideo' with queue title Man of Steel 90 s")
        for title in ["Citadel: Diana", "Reacher", "The Boys"] * 2:   # autoplay previews, 30 s each
            lv.play(PRIME, title); await advance(30)
        lv.home(); await advance(20)
        steps.append("L p2 Prime previews rotating every 30 s for 3 min (should stay out)")
        lv.play(NETFLIX, nometa=True); await advance(120); lv.home(); await advance(20)
        steps.append("L p2 Netflix with no metadata 2 min (should stay out)")

        async def watch_next(tv_id, rows):
            """The TV home app posting its Watch Next rows (POST /api/watch-next)."""
            server._current.set(tv_id)
            with patch.object(server, "body", new=AsyncMock(return_value={"rows": rows})):
                await server.h_watch_next(SimpleNamespace(headers={}))
        # issue #23 round 2: the app gives no title, its Watch Next row names the play
        old = (CLOCK.now - 3600) * 1000
        lv.play(NETFLIX, nometa=True); await advance(90); lv.home(); await advance(20)
        await watch_next(L, [{"package": NETFLIX, "title": "Bodies", "engaged": old},          # older than the play
                             {"package": PRIME, "title": "Fallout", "engaged": CLOCK.now * 1000}])  # another app
        await advance(30)
        await watch_next(L, [{"package": NETFLIX, "title": "The Night Agent", "episode_title": "Pilot",
                              "season": "1", "episode": "1", "engaged": CLOCK.now * 1000}])
        await advance(20)
        steps.append("L p2 Netflix with no metadata 90 s, its Watch Next row arrives after it stops")
        lv.play(PRIME, "PrimeVideo"); await advance(90)
        await watch_next(L, [{"package": PRIME, "title": "PrimeVideo", "engaged": CLOCK.now * 1000}])   # a placeholder row
        await advance(10); lv.home(); await advance(20)
        await watch_next(L, [{"package": PRIME, "title": "Fallout", "episode_title": "The End", "season": "1",
                              "episode": "1", "engaged": CLOCK.now * 1000}])
        await advance(20)
        steps.append("L p2 Prime says 'PrimeVideo' 90 s, then its Watch Next row says Fallout")
        lv.play("com.google.android.youtube.tv", "I finally saw quantum physics with my own eyes", "Veritasium")
        await advance(120); lv.home(); await advance(20)
        steps.append("L p2 a YouTube video 2 min (never logged)")
        # both TVs at once, different people
        lv.play(NETFLIX, "The Crown", "Wolferton Splash"); bd.play(NETFLIX, "Ozark", "Sugarwood")
        await advance(90); lv.home(); bd.home(); await advance(20)
        steps.append("L p2 The Crown and B p1 Ozark at the same time")
        # a 6 s blip with nothing playing (the front app read as the home for a moment) in the middle
        # of a show: its minute carries on (it restarted, and on the emulators Lupin was never kept)
        who(B, P2)
        bd.play(NETFLIX, "Lupin", "Chapter 1"); await advance(40); bd.home(); await advance(6)
        bd.play(NETFLIX, "Lupin", "Chapter 1", pos_s=46); await advance(26); bd.home(); await advance(20)
        steps.append("B p2 Lupin 40 s, a 6 s blip, 26 s more (72 s in all, no 60 s stretch)")
        who(L, P1)
        for title in SHOWS[:11]:
            if title in ("The Crown", "Ozark", "Stranger Things", "Wednesday"):
                continue
            lv.play(NETFLIX, title, "Episode"); await advance(90); lv.home(); await advance(15)
        for title in ["Mindhunter", "The Dark Knight", "Man of Steel"]:
            lv.play(NETFLIX, title, "Part"); await advance(90); lv.home(); await advance(15)
        lv.play(NETFLIX, "Dark", "Secrets"); await advance(90); lv.home(); await advance(15)
        steps.append("L p1 plays 12 more shows, the last 'Dark' (finder near miss)")
        for t in tasks:
            t.cancel()
        return steps


def phase_check(server):
    import store
    results = []

    def check(name, ok, detail=""):
        results.append(("PASS" if ok else "FAIL", name, detail))

    def cards(tv_id, who):
        server._current.set(tv_id)
        return server.continue_items(who)

    hist = store.history()
    check("every history line made in the run has an id and a TV", all(h.get("id") and h.get("tv") for h in hist), f"{len(hist)} lines")
    check("who is kept per TV after a restart", (store.current_who(L), store.current_who(B)) == (P1, P2),
          f"{store.current_who(L)}, {store.current_who(B)}")
    lp1, lp2, bp1, bp2 = cards(L, P1), cards(L, P2), cards(B, P1), cards(B, P2)
    t = lambda cs: [c["title"] for c in cs]
    check("living room, person 2: only what they watched there, two named from Watch Next",
          t(lp2) == ["The Crown", "Fallout", "The Night Agent", "Man of Steel"], t(lp2))
    fallout = next((c for c in lp2 if c["title"] == "Fallout"), {})
    check("a Watch Next card keeps its season and episode", (str(fallout.get("season")), str(fallout.get("episode"))) == ("1", "1"), str(fallout)[:160])
    check("no YouTube video was logged at all", not any(h.get("service") == "youtube" for h in hist), "")
    check("Watch Next lines say so", sum(h.get("method") == "watch-next" for h in hist) == 2, "")
    check("bedroom, person 1: only what they watched there", t(bp1) == ["Ozark"], t(bp1))
    check("bedroom, person 2: Lupin, counted through a 6 s blip", t(bp2) == ["Lupin"], t(bp2))
    check("living room, person 1: 10 cards, newest first", len(lp1) == 10 and lp1[0]["title"] == "Dark", t(lp1))
    check("the oldest of person 1's 13 shows dropped off the 10", "Stranger Things" not in t(lp1), t(lp1))
    every = t(lp1) + t(lp2) + t(bp1) + t(bp2)
    check("one card per show", len(every) == len(set((c["title"], i) for i, c in enumerate(lp1 + lp2 + bp1 + bp2))) and len(t(lp1)) == len(set(t(lp1))), "")
    for bad in ("Wednesday", "PrimeVideo", "Citadel: Diana", "Reacher", "The Boys", "Netflix", "Dark Matter", "Bodies",
                "I finally saw quantum physics with my own eyes"):
        check(f"'{bad}' is not in anyone's row", bad not in every)
    dark = lp1[0]
    check("a near name keeps the app's title and no picture", dark["title"] == "Dark" and not dark.get("poster"), json.dumps(dark)[:120])
    crown = lp2[0]
    check("the season and episode are kept", (crown.get("season"), crown.get("episode")) == (1, 1), f"{crown.get('season')} {crown.get('episode')}")
    # every card opens what it shows
    opened = []

    async def press_all():
        play = AsyncMock(side_effect=lambda title, *a, **k: {"title": title})
        with patch.object(server, "play", new=play):
            for tv_id, who, cs in ((L, P1, lp1), (L, P2, lp2), (B, P1, bp1), (B, P2, bp2)):
                for c in cs:
                    server._current.set(tv_id)
                    with patch.object(server, "body", new=AsyncMock(return_value={"id": c["id"], "who": who})):
                        await server.h_continue_open(SimpleNamespace(headers={}))
                    a = play.await_args.args
                    opened.append((c["title"], a[0], c.get("season"), a[1], c.get("episode"), a[2]))
    asyncio.run(press_all())
    wrong = [o for o in opened if o[0] != o[1] or o[2] != o[3] or o[4] != o[5]]
    check("every card opens the show, season and episode it shows", not wrong and len(opened) == 16, f"{len(opened)} pressed, wrong: {wrong}")
    # the clock moves on
    real = datetime.now(timezone.utc)

    class Later(datetime):
        offset = timedelta(0)

        @classmethod
        def now(cls, tz=None):
            return real.astimezone(tz) + cls.offset if tz else real + cls.offset
    with patch.object(store, "datetime", Later):
        Later.offset = timedelta(days=29)
        check("29 days later: still there", len(cards(L, P1)) == 10)
        Later.offset = timedelta(days=31)
        check("31 days later: dropped off", cards(L, P1) == [] and cards(B, P1) == [] and cards(B, P2) == [])
    return results


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--phase":
        server = setup_bridge(sys.argv[3])
        if sys.argv[2] == "play":
            server.SEEN_AFTER_S = 60.0
            for s in asyncio.run(phase_play(server)):
                print("  played:", s)
        else:
            res = phase_check(server)
            for r in res:
                print(f"{r[0]}  {r[1]}" + (f"  {r[2]}" if r[2] and r[0] == "FAIL" else ""))
            print(f"{sum(r[0] == 'PASS' for r in res)} passed, {sum(r[0] == 'FAIL' for r in res)} failed")
            sys.exit(1 if any(r[0] == "FAIL" for r in res) else 0)
        return
    data = tempfile.mkdtemp(prefix="couchtv-sim-")
    py = sys.executable
    print("bridge simulation, data in", data)
    subprocess.run([py, __file__, "--phase", "play", data], check=True)
    print("  (bridge restarted)")
    sys.exit(subprocess.run([py, __file__, "--phase", "check", data]).returncode)


if __name__ == "__main__":
    main()
