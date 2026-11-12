"""Print the TV home's settings from config.json (the same parts the bridge serves as /tv/config.js),
base64 encoded, for apply.sh to hand to the app on the TV. The app keeps them and uses them for the
copy of the home it carries inside it (option A, or when the computer is off).

Usage: .venv/bin/python tv-home/tools/home-config.py [--json]     (COUCH_CONFIG picks another file)
Never contains secrets: only people, weather, the home's look and each TV's quick buttons. A kids
profile's parent PIN goes as a salted hash only. Each kids shelf show is looked up on JustWatch here
(the TV has no computer to ask later) for its poster and the link that opens it; --no-lookup skips that.

       .venv/bin/python tv-home/tools/home-config.py --ha [--check]
The smart home section ("home_assistant" in config.json, docs/CONFIG.md), base64 encoded, for
apply.sh to hand to the app on its own ("ha_b64"); the app keeps it apart from the page. Prints
"none" when smart home is off, missing or not filled in. This one DOES hold the Home Assistant
token (from HOME_ASSISTANT_TOKEN in .env, else "token" in the section), so it is never printed
to the screen by apply.sh and never written to a file. --check prints only what is set up, no
token, and "doorbell" on its own line when there is a doorbell (apply.sh uses that).
"""
import base64
import json
import os
import re
import sys
from urllib.parse import urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "bridge"))
import config  # noqa: E402

ENTITY = {
    "climate": re.compile(r"^climate\.[a-z0-9_]{1,64}$"),
    "scenes": re.compile(r"^(scene|script)\.[a-z0-9_]{1,64}$"),
    "doorbell": re.compile(r"^(binary_sensor|input_boolean|event)\.[a-z0-9_]{1,64}$"),
    "camera": re.compile(r"^camera\.[a-z0-9_]{1,64}$"),
}


def smart_home():
    """The checked section, or None when smart home is off. Bad entries are dropped with a note."""
    ha = config.CONFIG.get("home_assistant")
    if not isinstance(ha, dict) or ha.get("enabled") is False:
        return None
    url = str(ha.get("url") or "").strip().rstrip("/")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.query:
        print("home-config: home_assistant.url must look like http://homeassistant.local:8123, smart home stays off",
              file=sys.stderr)
        return None
    token = (os.environ.get("HOME_ASSISTANT_TOKEN") or str(ha.get("token") or "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{20,1024}", token):
        print("home-config: no Home Assistant token (HOME_ASSISTANT_TOKEN in .env), smart home stays off",
              file=sys.stderr)
        return None

    def named(key, most):
        out = []
        for x in ha.get(key) or []:
            x = {"entity": x} if isinstance(x, str) else x
            ent = str((x or {}).get("entity") or "").strip()
            if not ENTITY[key].match(ent):
                print(f"home-config: skipping {key} entry {ent or '(empty)'!r}: not a {key} entity id", file=sys.stderr)
                continue
            out.append({"entity": ent, "name": str(x.get("name") or "").strip()[:40]})
        return out[:most]

    out = {"url": url, "token": token, "climate": named("climate", 8), "scenes": named("scenes", 10)}
    bell = ha.get("doorbell")
    if isinstance(bell, dict) and bell.get("entity"):
        ent, cam = str(bell.get("entity")).strip(), str(bell.get("camera") or "").strip()
        if not ENTITY["doorbell"].match(ent) or (cam and not ENTITY["camera"].match(cam)):
            print("home-config: skipping the doorbell: entity must be binary_sensor., input_boolean. or event., "
                  "camera must be camera.", file=sys.stderr)
        else:
            out["doorbell"] = {"entity": ent, "camera": cam, "name": str(bell.get("name") or "").strip()[:40]}
    if not out["climate"] and not out["scenes"] and "doorbell" not in out:
        return None
    return out


if "--key" in sys.argv:
    print(config.PAIRING_KEY)
    sys.exit(0)


if "--ha" in sys.argv:
    ha = smart_home()
    if "--check" in sys.argv:
        if ha:
            print(f"smart home: {len(ha['climate'])} climate, {len(ha['scenes'])} scenes"
                  + (", doorbell" if "doorbell" in ha else ""))
            if "doorbell" in ha:
                print("doorbell")
        else:
            print("smart home: off")
    else:
        print(base64.b64encode(json.dumps(ha, separators=(",", ":")).encode()).decode() if ha else "none")
    sys.exit(0)

async def bake_kids(people):
    """Kids mode with no computer (option A): look each shelf show up now, on this computer, and
    hand the TV the app and link that open it, and its poster. A show that is not found still goes
    on the shelf; it opens its app (or says it cannot) instead of the show."""
    import asyncio
    import finder
    import kids
    for p in people:
        for show in (p.get("kids_mode") or {}).get("shows") or []:
            try:
                best, _ = await asyncio.wait_for(finder.find(show["title"]), 20)
                if not best or finder._norm(best["title"]) != finder._norm(show["title"]):
                    print(f"home-config: kids shelf: {show['title']!r} not found, it will open its app only",
                          file=sys.stderr)
                    continue
                show.setdefault("poster", best.get("poster"))
                show.setdefault("backdrop", best.get("backdrop"))
                ep = None
                if show.get("season") and best.get("type") == "tv":
                    ep = await finder.episode_providers(best["jw_id"], show["season"], show.get("episode"))
                got = kids.link_for(best, show, ep)
                if got and not show.get("link"):
                    show.update({k: v for k, v in got.items() if v})
                    app = kids.apps.BY_ID.get(got["service"])
                    if app:
                        show["app"] = {"id": app["id"], "name": app["name"], "package": app["package"]}
            except Exception as e:
                print(f"home-config: kids shelf: could not look up {show['title']!r} ({e})", file=sys.stderr)
    if finder._session and not finder._session.closed:
        await finder._session.close()


pub = config.public()
pub["ask"] = {"enabled": False}
if "--no-lookup" not in sys.argv and any(p.get("kids_mode") for p in pub["people"]):
    import asyncio
    asyncio.run(bake_kids(pub["people"]))
text = json.dumps(pub, separators=(",", ":"))
print(text if "--json" in sys.argv else base64.b64encode(text.encode()).decode())
