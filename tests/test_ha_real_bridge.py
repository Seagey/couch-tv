"""The bridge's QR sign in (bridge/haphone.py, bridge/smarthome.py) end to end against a REAL Home Assistant.
Skipped unless HA_E2E_URL (its address) and HA_E2E_CREDS (a JSON file with tv_user and tv_pass for a
throwaway, non-admin test user) are set. The phone is played by a second HTTP client doing what the
phone page and Home Assistant's own sign in page do: asks for the sign in address, signs in on Home
Assistant's login flow with the PKCE challenge from it, follows the redirect back to /ha/done, ticks
devices and saves. Also: refresh on expiry and on a refused access token, the revoke on disconnect,
and that a long-lived token set up before still works.
Run: HA_E2E_URL=http://127.0.0.1:8123 HA_E2E_CREDS=creds.json python3 tests/test_ha_real_bridge.py"""
import asyncio, json, os, socket, sys, tempfile, time, unittest, urllib.parse
import aiohttp
from aiohttp import web

REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(REPO, "bridge"))
import smarthome, haphone  # noqa: E402

HA = os.environ.get("HA_E2E_URL", "")
READY = bool(HA) and os.path.isfile(os.environ.get("HA_E2E_CREDS", ""))
CREDS = {}
if READY:
    with open(os.environ["HA_E2E_CREDS"]) as f:
        CREDS = json.load(f)
PORT = int(os.environ.get("PORT", "18731"))


def home_network_address():
    """This computer's address on the home network (a UDP connect sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]
    finally:
        s.close()


LAN = os.environ.get("HA_E2E_LAN") or home_network_address()
n = 0


def ok(c, m):
    global n
    if not c:
        raise AssertionError(m)
    n += 1
    print("  ok", m)


async def main():
    home = smarthome.Home(tempfile.mkdtemp())
    changes = []
    phone = haphone.Phone(home, os.path.join(REPO, "tv-home", "web"), PORT, lambda: LAN, lambda: changes.append(1))
    phone.scanner = lambda: asyncio.sleep(0, result=[])
    app = web.Application()
    phone.routes(app.router)

    async def info(r):
        return web.json_response({"ok": True, "info": home.info(), "status": dict(home.status(), phone=True)})

    async def start(r):
        return web.json_response({"ok": True, "result": phone.start()})

    async def ask(r):
        b = await r.json()
        return web.json_response({"ok": True, "result": await home.answer(b.get("action"), b.get("entity", ""), b.get("value", ""))})
    app.router.add_get("/api/ha/info", info)
    app.router.add_post("/api/ha/phone", start)
    app.router.add_post("/api/ha", ask)
    runner = web.AppRunner(app); await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    T = "http://%s:%d" % (LAN, PORT)
    try:
        async with aiohttp.ClientSession() as tv, aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar()) as ph:
            # the TV screen asks for the QR address twice: the same key both times
            a = (await (await tv.post(T + "/api/ha/phone")).json())["result"]
            b = (await (await tv.post(T + "/api/ha/phone")).json())["result"]
            ok(a["ok"] and a["url"].startswith(T + "/ha/?k=") and a["url"] == b["url"], "QR address is the bridge on the home network, steady while the screen asks")
            ok(not a["set"], "nothing set up before")
            k = urllib.parse.parse_qs(urllib.parse.urlsplit(a["url"]).query)["k"][0]
            # phone opens the page
            r = await ph.get(a["url"])
            page = await r.text()
            ok(r.status == 200 and "Sign in to Home Assistant" in page and "long-lived" not in page.lower() and "type=\"password\"" not in page, "phone page served, asks for no token")
            st = await (await ph.get(T + "/ha/api/state?k=" + k)).json()
            ok(st["ok"] and not st["signed_in"], "state: not signed in")
            bad = await ph.get(T + "/ha/api/state?k=wrong")
            ok(bad.status == 403, "a wrong key is refused")
            r = await (await ph.post(T + "/ha/api/signin", json={"k": k, "url": "127.0.0.1:1"})).json()
            ok(not r["ok"] and r["error"] == "unreachable", "an address with nothing there says unreachable")
            r = await (await ph.post(T + "/ha/api/signin", json={"k": k, "url": HA})).json()
            ok(r["ok"], "sign in address made for the real Home Assistant")
            go = urllib.parse.urlsplit(r["go"]); q = dict(urllib.parse.parse_qsl(go.query))
            ok(q["client_id"] == T + "/" and q["redirect_uri"] == T + "/ha/done", "client id is the bridge, redirect is /ha/done")
            ok(q.get("code_challenge_method") == "S256" and len(q.get("code_challenge", "")) == 43, "PKCE S256 challenge sent (HA says it supports it)")
            # the phone signs in on Home Assistant's own login flow (what its /auth/authorize page does)
            r = await ph.post(HA + "/auth/login_flow", json={"client_id": q["client_id"], "handler": ["homeassistant", None], "redirect_uri": q["redirect_uri"],
                                                         "code_challenge": q["code_challenge"], "code_challenge_method": "S256"})
            flow = await r.json()
            ok(r.status == 200 and flow.get("type") == "form", "Home Assistant takes the TV's client id and redirect")
            r = await ph.post(HA + "/auth/login_flow/" + flow["flow_id"], json={"client_id": q["client_id"], "username": CREDS["tv_user"], "password": CREDS["tv_pass"]})
            res = await r.json()
            ok(res.get("type") == "create_entry", "test user signed in on Home Assistant")
            # a forged state is refused (and burns nothing)
            for q_ in ("code=x&state=forged", "code=x", "", "code=x&state="):
                r = await ph.get(T + "/ha/done?" + q_, allow_redirects=False)
                ok(r.status == 302 and r.headers["Location"] == "/ha/?e=expired" and k not in r.headers["Location"], "a forged or missing state is refused with no key in Location (%s)" % (q_ or "nothing"))
            r = await ph.get(T + "/ha/done?" + urllib.parse.urlencode({"code": res["result"], "state": q["state"]}), allow_redirects=False)
            ok(r.status == 302 and r.headers["Location"].endswith("#devices"), "code swapped on the bridge, phone sent to its devices")
            kept = json.load(open(home._path()))
            ok("refresh_token" in kept and "token" not in kept and kept["client_id"] == T + "/", "refresh token and client id kept, no long-lived token")
            ok(oct(os.stat(home._path()).st_mode & 0o777) == "0o600", "kept file is private (600)")
            r = await ph.get(T + "/ha/done?" + urllib.parse.urlencode({"code": res["result"], "state": q["state"]}), allow_redirects=False)
            ok("e=expired" in r.headers["Location"], "the same code cannot be used twice")
            st = await (await ph.get(T + "/ha/api/state?k=" + k)).json()
            ok(st["signed_in"] and st["host"] == "127.0.0.1", "state: signed in, host only")
            d = await (await ph.get(T + "/ha/api/devices?k=" + k)).json()
            ents = [e["entity"] for e in d["entities"]]
            ok(d["ok"] and len(ents) > 20, "devices listed from the real Home Assistant: %d" % len(ents))
            ok(not any(e.split(".")[0] in ("lock", "alarm_control_panel") for e in ents), "no lock or alarm listed")
            states = await (await ph.get(HA + "/api/states", headers={"Authorization": "Bearer " + home.access[kept["refresh_token"]][0]})).json()
            garage = [s["entity_id"] for s in states if s["entity_id"].startswith("cover.") and s["attributes"].get("device_class") in ("garage", "gate", "door")]
            ok(garage and not any(g in ents for g in garage), "garage door in Home Assistant (%s) is not listed" % ",".join(garage))
            ok(any(s["entity_id"].startswith("lock.") for s in states), "Home Assistant does have locks (demo), so the filter was tested")
            blob = json.dumps(d) + json.dumps(st)
            ok(kept["refresh_token"] not in blob and home.access[kept["refresh_token"]][0] not in blob, "no token in what the phone gets")
            pick = lambda dom: [e for e in ents if e.startswith(dom + ".")]
            picks = {"climate": [{"entity": e} for e in pick("climate")[:2]], "controls": [{"entity": e} for e in pick("light")[:3]],
                     "sensors": [{"entity": e} for e in pick("sensor")[:2]], "cameras": [{"entity": e} for e in pick("camera")[:1]],
                     "speakers": [{"entity": e} for e in pick("media_player")[:1]], "scenes": [{"entity": e} for e in pick("scene")[:1]]}
            picks["controls"].append({"entity": garage[0]})   # a phone that sends a garage door anyway
            r = await (await ph.post(T + "/ha/api/save", json={"k": k, "picks": picks})).json()
            ok(r["ok"], "saved: %d things show" % r["count"])
            inf = (await (await tv.get(T + "/api/ha/info")).json())
            ok(len(inf["info"]["climate"]) == 2 and len(inf["info"]["controls"]) == 3, "the TV's info (what widget device settings pick from) has the ticks")
            ok(garage[0] not in json.dumps(inf), "the garage door sent anyway is dropped")
            ok(changes, "the TV was told to redraw")
            c = (await (await tv.post(T + "/api/ha", json={"action": "climate"})).json())["result"]
            ok(c["ok"] and len(c["rooms"]) == 2 and all(x.get("ok") for x in c["rooms"]), "climate read through the refresh token's access token")
            ent = picks["controls"][0]["entity"]
            r = (await (await tv.post(T + "/api/ha", json={"action": "controls"})).json())["result"]
            ok(r["ok"], "controls read")
            # the access token runs out: the next call refreshes against the real Home Assistant
            old = home.access[kept["refresh_token"]][0]
            home.clock = lambda: 10 ** 10
            grants, real_form = [], home.form
            async def counted(url, form):
                grants.append(form.get("grant_type")); return await real_form(url, form)
            home.form = counted
            c = (await (await tv.post(T + "/api/ha", json={"action": "climate"})).json())["result"]
            ok(c["ok"] and grants == ["refresh_token"] and home.access[kept["refresh_token"]][1] > 10 ** 10, "an expired access token is refreshed and works")
            # Home Assistant forgets the access token: one fresh try
            home.access[kept["refresh_token"]] = ("bogus-access-token-that-ha-will-refuse-1234", 10 ** 11)
            c = (await (await tv.post(T + "/api/ha", json={"action": "climate"})).json())["result"]
            ok(c["ok"] and grants == ["refresh_token", "refresh_token"], "a refused access token is refreshed once and works")
            # Home Assistant signs the TV out (its refresh token revoked there): the TV waits a minute before
            # asking again, and the TV and the phone say sign in again
            refresh = kept["refresh_token"]
            r = await ph.post(HA + "/auth/revoke", data={"token": refresh})
            ok(r.status == 200, "Home Assistant revoked the TV's refresh token")
            home.access.pop(refresh, None)
            n0 = len(grants)
            await tv.post(T + "/api/ha", json={"action": "climate"})
            ok(len(grants) == n0 + 1 and home.status()["signin_again"], "the refused refresh token: the TV status says sign in again")
            await tv.post(T + "/api/ha", json={"action": "climate"})
            await tv.post(T + "/api/ha", json={"action": "controls"})
            ok(len(grants) == n0 + 1, "and Home Assistant is not asked again within the minute (%d asks)" % (len(grants) - n0))
            st = await (await ph.get(T + "/ha/api/state?k=" + k)).json()
            ok(st["ok"] and st["signin_again"], "the phone page is told to sign in again")
            home.clock = lambda: 10 ** 10 + 61
            await tv.post(T + "/api/ha", json={"action": "climate"})
            ok(len(grants) == n0 + 2, "after a minute it is tried again")
            # disconnect: Home Assistant revokes the refresh token
            r = await (await ph.post(T + "/ha/api/forget", json={"k": k})).json()
            ok(r["ok"] and not os.path.exists(home._path()), "disconnect forgets the set up")
            r = await ph.post(HA + "/auth/token", data={"grant_type": "refresh_token", "refresh_token": refresh, "client_id": T + "/"})
            ok(r.status in (400, 401), "Home Assistant no longer takes the refresh token (revoked)")
            inf = (await (await tv.get(T + "/api/ha/info")).json())
            ok(not inf["status"]["set"], "TV says smart home is off")
            # an older set up with a long-lived token keeps working (the typed token path)
            cl = "http://127.0.0.1:9/"
            f = await (await ph.post(HA + "/auth/login_flow", json={"client_id": cl, "handler": ["homeassistant", None], "redirect_uri": cl})).json()
            code = (await (await ph.post(HA + "/auth/login_flow/" + f["flow_id"], json={"client_id": cl, "username": CREDS["tv_user"], "password": CREDS["tv_pass"]})).json())["result"]
            acc = (await (await ph.post(HA + "/auth/token", data={"grant_type": "authorization_code", "code": code, "client_id": cl})).json())["access_token"]
            async with ph.ws_connect(HA + "/api/websocket") as ws:
                await ws.receive_json(); await ws.send_json({"type": "auth", "access_token": acc}); await ws.receive_json()
                await ws.send_json({"id": 1, "type": "auth/long_lived_access_token", "client_name": "couch-tv test %d" % time.time(), "lifespan": 1})
                llat = (await ws.receive_json())["result"]
            r = await home.check(HA, llat)
            ok(r["ok"] and len(r["entities"]) > 20, "a long-lived token still checks")
            ok(home.save({"climate": [{"entity": "climate.hvac"}]})["ok"], "and saves")
            c = await home.answer("climate")
            ok(c["ok"] and c["rooms"][0]["ok"], "and reads the aircon with the long-lived token")
            ok(home.status()["signed_in"] is False, "status says it is not a phone sign in")
            home.forget()
    finally:
        await runner.cleanup()
    print("%d checks passed against Home Assistant %s." % (n, HA))


@unittest.skipUnless(READY, "set HA_E2E_URL and HA_E2E_CREDS to run against a real Home Assistant")
class RealHomeAssistant(unittest.TestCase):
    def test_phone_sign_in_end_to_end(self):
        asyncio.run(main())


if __name__ == "__main__":
    unittest.main()
