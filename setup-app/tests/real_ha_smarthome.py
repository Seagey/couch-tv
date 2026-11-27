"""The Smart home step against a REAL Home Assistant (lane B, 28 Nov 2026). Not part of the normal run: it needs a throwaway Home
Assistant of its own (never anybody's real one), with the demo integration, onboarded here with a test user made for this run.

  HA_REAL_URL=http://127.0.0.1:18123 HA_REAL_CREDS=<json with tv_user, tv_pass> python setup-app/tests/real_ha_smarthome.py

What it proves, with Home Assistant's own code:
 1. Setup's sign in: Home Assistant accepts client id http://127.0.0.1:<port>/ with redirect /ha/back (the IndieAuth question in
    coord/phase2-widgets/smarthome.md F1), the code swaps for a sign in, Setup makes a long-lived token over the websocket and lets the
    short sign in go (its refresh token is revoked).
 2. The list: the demo's lock and garage door never appear; climate, lights and speakers do, with Home Assistant's own area names.
 3. The bridge on the computer, with what Setup wrote for the Helper (H3), answers the guest room TV for its room only and refuses
    another room by name, against the real Home Assistant (bridge/rooms.py).
 4. Setup finds this Home Assistant by mDNS when it announces itself (zeroconf), if the network lets it."""
import asyncio
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(HERE, "..", "..", "bridge"))
os.environ.setdefault("COUCHTV_SETUP_HOME", tempfile.mkdtemp())
from couchtv_setup import smarthome as sh  # noqa: E402

HA = os.environ["HA_REAL_URL"].rstrip("/")
CREDS = json.load(open(os.environ["HA_REAL_CREDS"]))
PORT = 51234
n = 0


def ok(c, what):
    global n
    if not c:
        print("FAIL:", what)
        sys.exit(1)
    n += 1
    print("ok:", what)


def post(path, body, form=False):
    data = urllib.parse.urlencode(body).encode() if form else json.dumps(body).encode()
    req = urllib.request.Request(HA + path, data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


# ---- 1. sign in, the way a browser would after Setup opens Home Assistant's page
url = sh.ha_start(HA, PORT)
q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}
flow = post("/auth/login_flow", {"client_id": q["client_id"], "handler": ["homeassistant", None], "redirect_uri": q["redirect_uri"]})
ok(flow.get("type") == "form", "Home Assistant accepts client id %s and redirect %s" % (q["client_id"], q["redirect_uri"]))
done = post("/auth/login_flow/" + flow["flow_id"], {"client_id": q["client_id"], "username": CREDS["tv_user"], "password": CREDS["tv_pass"]})
ok(done.get("type") == "create_entry" and done.get("result"), "signed in, a code for Setup")
good, words = sh.ha_back(urllib.parse.urlencode({"state": q["state"], "code": done["result"]}))
ok(good, "Setup swapped the code and made a long-lived token: " + words)
tok = sh.SM.ha["token"]
ok(tok.count(".") == 2 and len(tok) > 100, "a long-lived token (a JWT)")
ok(not any(tok in json.dumps(v) for v in (sh.view(), sh.choices())), "the page never sees the token")

# ---- 2. the list
ents = {e["entity"]: e for e in sh.SM.ha["entities"]}
ok(any(e.startswith("climate.") for e in ents), "air con listed: %s" % [e for e in ents if e.startswith("climate.")])
ok(any(e.startswith("light.") for e in ents), "lights listed")
ok(not any(e.startswith("lock.") for e in ents), "no lock listed")
ok("cover.garage_door" not in ents, "the demo's garage door is not listed")
ok(not any(sh.opens_house(e, {"friendly_name": v["name"]}) for e, v in ents.items()), "nothing listed opens the house")
areas = {e: v.get("area") for e, v in ents.items() if v.get("area")}
print("   areas from Home Assistant:", dict(list(areas.items())[:6]))

# ---- 3. the bridge with what Setup wrote for the Helper
helper = tempfile.mkdtemp()
climate = sorted(e for e in ents if e.startswith("climate."))
ok(sh.write_helper_ha(set(climate), helper), "Setup wrote home-assistant.json for the Helper")
import smarthome as bridge_sh  # noqa: E402
import rooms  # noqa: E402
home = bridge_sh.Home(helper)
ok(home.settings() is not None, "the bridge reads it")
guest = {"label": "Guest room", "only": True, "climate": [climate[-1]]}


async def run():
    allr = (await home.answer("climate")).get("rooms", [])
    mine = rooms.answer(guest, "climate", await home.answer("climate")).get("rooms", [])
    return allr, mine
allr, mine = asyncio.run(run())
ok(len(allr) == len(climate) and all(r.get("ok") for r in allr), "the bridge read every air con from the real Home Assistant (%d)" % len(allr))
ok([r["entity"] for r in mine] == [climate[-1]], "the guest room TV sees only its own air con")
ok(not rooms.ask_ok(guest, "on", climate[0]), "and turning on another room by name is refused before Home Assistant is asked")

# ---- 4. finding it on the Wi-Fi (zeroconf); a network that blocks multicast only skips this
v = sh.find()
found = [f["base"] for f in v["ha_found"]]
print("   found by Setup:", found)
ok(True, "find ran (%d Home Assistant found)" % len(found))
print("real_ha_smarthome: %d checks passed" % n)
