"""Smart home set up from a phone, for a TV whose home this computer runs (bridge/smarthome.py).

The same flow as the TV apps' (tv-home/android/shared/java/app/couchtv/ha/HaPhone.kt): the TV's
Smart home screen shows a QR code for http://<this computer>:<port>/ha/?k=<key>; the phone page
(tv-home/web/ha-phone.html) picks the Home Assistant found on the Wi-Fi or a typed address, signs in
on Home Assistant's own page (OAuth, IndieAuth client id http://<this computer>:<port>/), and comes
back to /ha/done, where this computer swaps the one time code for the tokens and keeps the refresh
token in bridge/data/home-assistant.json (mode 600). Then the phone ticks what shows.

Every /ha/api call needs the key from the QR code: 128 random bits, new when the screen opens, good
for 30 minutes. /ha is outside /api, so it needs no pairing key: the QR key is its pairing. The phone
only ever gets names and entity ids.

    /ha                 GET   the phone page
    /ha/ha-picks.js     GET   its groups and limits (shared with the TV)
    /ha/done            GET   Home Assistant sends the phone back here with ?code&state
    /ha/api/state       GET   ?k: signed in?, the Home Assistants found on the Wi-Fi
    /ha/api/signin      POST  { k, url } -> { go }: the sign in address
    /ha/api/devices     GET   ?k: what Home Assistant has, and what is ticked
    /ha/api/save        POST  { k, picks }
    /ha/api/forget      POST  { k }: sign out of Home Assistant and switch smart home off
"""
import asyncio
import base64
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import socket
import time
import urllib.parse

from aiohttp import web

import smarthome

LIFE = 30 * 60
SIGN_IN = 10 * 60
HOST = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})")
# a Host header /ha answers (HaPhone.kt HOST_OK): a number address or a .local name, with the port. A web page
# elsewhere cannot point a name of its own at this computer and use the set up.
HOST_OK = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local):(\d{1,5})", re.I)


def host_ok(host):
    return bool(HOST_OK.fullmatch((host or "").strip()))


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def challenge(verifier):
    return b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def private(ip):
    try:
        a = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return a.version == 4 and a.is_private and not a.is_loopback


def own_addresses(own_ip=None):
    """This computer's own IPv4 addresses: the home network one, and every one its name resolves to."""
    out = {own_ip} if own_ip else set()
    try:
        out.update(a for a in socket.gethostbyname_ex(socket.gethostname())[2] if ":" not in a)
    except OSError:
        pass
    return out


def client_for(host, own_ip, port, own=None):
    """The client id: this computer's address as the phone reached it, only when that is one of this
    computer's own home network addresses on this port; else its own home network address."""
    m = HOST.fullmatch((host or "").strip())
    own = own_addresses(own_ip) if own is None else own
    if m and private(m.group(1)) and m.group(1) in own and int(m.group(2)) == port:
        return "http://%s:%d/" % (m.group(1), port)
    return "http://%s:%d/" % (own_ip, port) if own_ip and private(own_ip) else None


def authorize_url(base, client, state, chal):
    q = {"response_type": "code", "client_id": client, "redirect_uri": client + "ha/done", "state": state,
         "code_challenge": chal, "code_challenge_method": "S256"}
    return base + "/auth/authorize?" + urllib.parse.urlencode(q)


def url_from(txt, ip, port):
    """The address to use from Home Assistant's announcement (HaFind.kt urlFrom)."""
    said = None
    for k in ("internal_url", "base_url"):
        said = smarthome.clean_base(txt.get(k) or "")
        if said:
            break
    if said:
        u = urllib.parse.urlsplit(said)
        if re.fullmatch(r"[0-9.]+", u.hostname or "") or u.scheme == "https":
            return said
        if ip:
            return "http://%s:%d" % (ip, u.port or port)
        return said
    return "http://%s:%d" % (ip, port) if ip else None


async def scan(seconds=4.0):
    """Home Assistants announcing _home-assistant._tcp on the Wi-Fi: [{name, url}]. Only listens."""
    try:
        from zeroconf import ServiceStateChange
        from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo, AsyncZeroconf
    except ImportError:
        return []
    kind = "_home-assistant._tcp.local."
    names = []
    azc = AsyncZeroconf()
    try:
        def seen(zeroconf, service_type, name, state_change):
            if state_change is ServiceStateChange.Added and name not in names:
                names.append(name)
        browser = AsyncServiceBrowser(azc.zeroconf, [kind], handlers=[seen])
        await asyncio.sleep(seconds)
        out = []
        for name in names:
            info = AsyncServiceInfo(kind, name)
            if not await info.async_request(azc.zeroconf, 2000):
                continue
            txt = {(k or b"").decode("utf-8", "replace"): (v or b"").decode("utf-8", "replace") for k, v in (info.properties or {}).items()}
            ips = [a for a in info.parsed_addresses() if ":" not in a]
            url = url_from(txt, ips[0] if ips else None, info.port or 8123)
            if url and all(f["url"] != url for f in out):
                out.append({"name": (txt.get("location_name") or name.split(".")[0])[:40], "url": url})
        await browser.async_cancel()
        return out
    except Exception:
        return []
    finally:
        await azc.async_close()


async def probe(home, base):
    """Is there a Home Assistant at base that someone can sign in to? ok, unreachable, not_ha or not_ready."""
    code, data = await home.call(base, "", "GET", "/auth/providers", None, 64 * 1024)
    if code == -1:
        return "unreachable"
    if code == 200 and data and b'"type"' in data:
        return "ok"
    if code == 400:
        return "not_ready"
    return "not_ha"


class Phone:
    def __init__(self, home, web_dir, port, own_ip, on_change=None):
        self.home, self.web_dir, self.port, self.own_ip = home, web_dir, port, own_ip
        self.on_change = on_change or (lambda: None)
        self.session = None
        self.scanner = scan

    def start(self):
        """{ ok, url, seen } plus what is kept now. Asking again keeps the same key, so the QR code stays."""
        s = self.session
        ip = self.own_ip()
        if not s or s["until"] < time.time() + 60:
            s = self.session = {"key": secrets.token_urlsafe(16), "until": time.time() + LIFE, "found": [], "scanning": True,
                                "seen": False, "pending": None}
            mine = s

            async def look():
                try:
                    mine["found"] = await self.scanner()
                finally:
                    mine["scanning"] = False
            asyncio.get_running_loop().create_task(look())
        out = dict(self.home.status(), ok=bool(ip), seen=s["seen"])
        if ip:
            out["url"] = "http://%s:%d/ha/?k=%s" % (ip, self.port, s["key"])
        else:
            out["error"] = "network"
        return out

    def stop(self):
        self.session = None

    def _live(self, k):
        s = self.session
        if not s or not k or s["until"] < time.time():
            return None
        return s if hmac.compare_digest(str(k).encode(), s["key"].encode()) else None

    @staticmethod
    def _json(o, status=200):
        return web.json_response(o, status=status, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})

    def _fail(self, error, status=200):
        return self._json({"ok": False, "error": error}, status)

    def _file(self, name, kind):
        try:
            with open(os.path.join(self.web_dir, name), "rb") as f:
                body = f.read()
        except OSError:
            return web.Response(status=404, text="Not found")
        return web.Response(body=body, content_type=kind, charset="utf-8" if kind == "text/html" else None,
                            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"})

    def routes(self, r):
        def guard(h):
            async def g(request):
                if not host_ok(request.host):
                    return web.Response(status=403, text="Forbidden", headers={"Cache-Control": "no-store"})
                return await h(request)
            return g
        r.add_get("/ha", guard(self.h_page))
        r.add_get("/ha/", guard(self.h_page))
        r.add_get("/ha/ha-picks.js", guard(self.h_picks))
        # the page's words in the TV's language, and the widget settings words it shares (phone-words.js)
        r.add_get("/ha/phone-words.js", guard(self.h_phone_words))
        r.add_get("/ha/caps-words.js", guard(self.h_caps_words))
        r.add_get("/ha/done", guard(self.h_done))
        r.add_get("/ha/api/state", guard(self.h_state))
        r.add_post("/ha/api/signin", guard(self.h_signin))
        r.add_get("/ha/api/devices", guard(self.h_devices))
        r.add_post("/ha/api/save", guard(self.h_save))
        r.add_post("/ha/api/forget", guard(self.h_forget))

    async def h_picks(self, request):
        return self._file("ha-picks.js", "application/javascript")

    async def h_phone_words(self, request):
        return self._file("phone-words.js", "application/javascript")

    async def h_caps_words(self, request):
        return self._file("caps-words.js", "application/javascript")

    async def h_page(self, request):
        return self._file("ha-phone.html", "text/html")

    async def _body(self, request):
        try:
            b = await request.json()
            return b if isinstance(b, dict) else {}
        except Exception:
            return {}

    async def h_state(self, request):
        s = self._live(request.query.get("k"))
        if not s:
            return self._fail("expired", 403)
        if not s["seen"]:
            s["seen"] = True
            self.on_change()
        st = self.home.status()
        return self._json({"ok": True, "signed_in": bool(st.get("set")), "host": st.get("host", ""), "signin_again": bool(st.get("signin_again")), "scanning": s["scanning"], "found": s["found"]})

    async def h_signin(self, request):
        b = await self._body(request)
        s = self._live(b.get("k"))
        if not s:
            return self._fail("expired", 403)
        url = str(b.get("url") or "").strip()
        base = smarthome.clean_base(url if not url or "://" in url else "http://" + url)
        if not base:
            return self._fail("address")
        client = client_for(request.host, self.own_ip(), self.port)
        if not client:
            return self._fail("network")
        p = await probe(self.home, base)
        if p != "ok":
            return self._fail(p)
        # PKCE S256 always: a Home Assistant too old to say it takes it ignores it, so it is never dropped
        verifier = secrets.token_urlsafe(32)
        state = secrets.token_urlsafe(16)
        s["pending"] = {"state": state, "verifier": verifier, "base": base, "client": client, "at": time.time()}
        return self._json({"ok": True, "go": authorize_url(base, client, state, challenge(verifier))})

    async def h_done(self, request):
        # every failure before the state checks out goes to /ha/?e=expired with no key: only the phone that
        # asked for this sign in (it holds the state) is sent back with the set up key
        s = self.session
        p = s and s.get("pending")
        state = request.query.get("state", "")
        if not p or not hmac.compare_digest(state.encode(), p["state"].encode()):
            raise web.HTTPFound("/ha/?e=expired")
        if s["until"] < time.time() or time.time() - p["at"] > SIGN_IN:
            s["pending"] = None
            raise web.HTTPFound("/ha/?e=expired")
        back = "/ha/?k=" + urllib.parse.quote(s["key"])
        s["pending"] = None   # a code is used once
        code = request.query.get("code", "")
        if not code or len(code) > 512:
            raise web.HTTPFound(back + "&e=denied")
        form = {"grant_type": "authorization_code", "code": code, "client_id": p["client"], "code_verifier": p["verifier"]}
        status, t = await self.home.form(p["base"] + "/auth/token", form)
        if status != 200 or not isinstance(t, dict) or not smarthome.TOKEN.fullmatch(str(t.get("access_token") or "")):
            raise web.HTTPFound(back + "&e=" + ("unreachable" if status == -1 else "signin"))
        if not self.home.keep_sign_in(p["base"], t, p["client"]):
            raise web.HTTPFound(back + "&e=signin")
        self.on_change()
        raise web.HTTPFound(back + "#devices")

    async def h_devices(self, request):
        if not self._live(request.query.get("k")):
            return self._fail("expired", 403)
        s = self.home.settings()
        if not s:
            return self._fail("signin")
        r = await self.home.list_for(s)
        if not r.get("ok"):
            return self._fail("signin") if r.get("error") == "token" else self._json(r)
        r["picked"] = self.home.status()
        return self._json(r)

    async def h_save(self, request):
        b = await self._body(request)
        if not self._live(b.get("k")):
            return self._fail("expired", 403)
        if not isinstance(b.get("picks"), dict):
            return self._fail("picks")
        if not self.home.keep_picks(b["picks"]):
            return self._fail("signin" if not self.home.settings() else "picks")
        self.on_change()
        return self._json({"ok": True, "count": self.home.status().get("count", 0)})

    async def h_forget(self, request):
        b = await self._body(request)
        if not self._live(b.get("k")):
            return self._fail("expired", 403)
        await self.home.disconnect()
        self.on_change()
        return self._json({"ok": True})
