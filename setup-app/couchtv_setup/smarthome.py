"""The Smart home step in Couch TV Setup (Phase 2 lane B, 28 Nov 2026).

From the computer, on the home Wi-Fi, with nothing done on the TV:
1. Find: Home Assistant (mDNS _home-assistant._tcp, then homeassistant.local:8123), a Philips Hue Bridge (_hue._tcp),
   an AirTouch 5 console (its own UDP 49005 call) and Matter devices (_matterc._udp waiting to be added, _matter._tcp
   already in a home).
2. Sign in to Home Assistant in the computer's browser (Home Assistant's own page, OAuth with client id
   http://127.0.0.1:<Setup's port>/), then Setup makes a long-lived token named "Couch TV" and lets the short sign in go.
   Or the person pastes a long-lived token they made themselves.
3. List what it has, with the house test (locks, alarms, garage doors and gates never listed: the same rule as
   bridge/smarthome.py, tested with tests/fixtures/opens_house_ids.json), and Home Assistant's own areas as room names.
4. Report names only to the account (POST /v1/setup/found), keep the keys LOCKED in the account (POST /v1/setup/keys),
   and say which TV may use which key and which rooms each TV sees (POST /v1/setup/rooms). The per room rule is
   tests/fixtures/room_caps.json.
5. Hue and AirTouch are driven by this computer (the Couch TV Helper's bridge, bridge/direct.py): Setup writes them into
   the Helper's own direct.json (mode 600) so the Helper answers for them.

The Home Assistant token and the Hue key live in memory here until saved, are never written to the page, and never logged.
Every call goes only to the address found or typed on the home network, with no redirect followed.
"""
import base64
import ipaddress
import json
import os
import re
import secrets
import socket
import ssl
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import mdns, paths, studio
from .tv import TvError

# ---------------------------------------------------------------- the house test and the room rule

OPENS_HOUSE = re.compile(r"(cover|switch|script|scene)\.[a-z0-9_]*(garage|gate(?!way)|(?<![._]in)(?<![._]out)door(?!bell)|(?<![._]c)(?<![._]b)lock|alarm|disarm)[a-z0-9_]*")
ALWAYS_OUT = re.compile(r"(lock|alarm_control_panel)\.[a-z0-9_]+")
HOUSE_OPENERS = {"garage", "gate", "door"}
OPENING_SENSORS = {"door", "garage_door", "lock", "opening", "window"}
PICKABLE = re.compile(r"(climate|scene|script|light|switch|fan|cover|camera|sensor|media_player|event|binary_sensor|input_boolean)\.[a-z0-9_]{1,64}")
ENTITY = re.compile(r"[a-z_]{1,32}\.[a-z0-9_]{1,64}")
TOKEN = re.compile(r"[A-Za-z0-9._-]{20,1024}")
HUE_USER = re.compile(r"[A-Za-z0-9_-]{20,64}")
LOCAL = "." + "local."   # the mDNS domain


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_")


# Names in any language the home speaks (G11): bridge/matter.py OPENS_HOUSE_WORDS word for word, plus alarm words
# (bridge/smarthome.py ALARM_WORDS). tests/fixtures/opens_house_names.json keeps the copies in step.
NAME_WORDS = [
    r"garages?", r"gates?", r"doors?", r"locks?",
    r"garagen\w*", r"tore?", r"\w*(?:tür|tuer)(?:e|en)?", r"\w*schlo(?:ss|ß)",
    r"\w*(?:einfahrts|hof|garten|roll|schiebe|flügel|fluegel)tore?",
    r"(?:voor|achter|garage|zij|tuin|schuif|kantel|rol|kelder|balkon|terras)?deur(?:en)?",
    r"(?:garage|toegangs|tuin|rol|schuif|inrit)?poort(?:en)?", r"slot(?:en)?", r"(?:tuin|toegangs|schuif|draai|inrit)?hek(?:ken)?",
    r"portails?", r"portes?", r"serrures?", r"barrières?",
    r"garajes?", r"cocheras?", r"puertas?", r"port[oó]n(?:es)?", r"verjas?", r"cerraduras?",
    r"cancelas?", r"cerrojos?",
    r"portas?", r"portone", r"portoni", r"cancell[oi]", r"serratur[ae]", r"basculante",
    r"garage[mn]s?", r"port[ãa]o", r"port[õo]es", r"fechaduras?",
    r"garaj\w*", r"kap[ıi]\w*", r"kilit\w*", r"kilid\w*",
    r"gara[žżz]\w*", r"kapij\w*", r"vrata", r"brav[au]",
    r"bram(?:a|y|ę|ie|ą|ka|ki|kę)?", r"drzwi", r"zam(?:ek|ka|ku|ki|kiem)",
    r"gar[áa][žz]\w*", r"br[áa]n(?:a|y|u|ou|ě)", r"dve[řr]\w*", r"z[áa]m(?:ek|ku|ky|kem)",
    r"[הבלמו]?(?:מוסך|שער|דלת|מנעול)",
    r"(?:ال)?(?:مرآب|كراج|جراج|بوابة|باب|قفل)",
    r"alarm\w*", r"allarm[ei]", r"disarm\w*", r"[הבלמו]?אזעק\w*", r"(?:ال)?إنذار\w*",
]
NAME_OPENS_HOUSE = re.compile(r"(?<!\w)(?:" + "|".join(NAME_WORDS) + r")(?!\w)", re.I)


def name_opens_house(name):
    if not name:
        return False
    s = re.sub(r"(?<=[a-zà-ÿ])(?=[A-ZÀ-Þ])", " ", str(name))
    s = re.sub(r"[\d_]+", " ", s)
    return bool(NAME_OPENS_HOUSE.search(s))


def opens_house(entity, attrs=None):
    """A lock, an alarm, or a cover, switch, script or scene named for a garage, gate, door, lock or alarm (by its id, or its name in any language)."""
    entity = str(entity or "")
    if ALWAYS_OUT.fullmatch(entity) or OPENS_HOUSE.fullmatch(entity):
        return True
    raw = (attrs or {}).get("friendly_name") if isinstance(attrs, dict) else ""
    n = _slug(raw)
    if n and OPENS_HOUSE.fullmatch(entity.split(".")[0] + "." + n):
        return True
    return entity.split(".")[0] in ("cover", "switch", "script", "scene") and name_opens_house(raw)


def pickable(states):
    """What Home Assistant has that a TV may show: [{entity, name, domain}], house openers left out."""
    out = []
    for st in states if isinstance(states, list) else []:
        if not isinstance(st, dict):
            continue
        ent = str(st.get("entity_id") or "")
        a = st.get("attributes") if isinstance(st.get("attributes"), dict) else {}
        if not PICKABLE.fullmatch(ent) or opens_house(ent, a):
            continue
        if ent.startswith("cover.") and a.get("device_class") in HOUSE_OPENERS:
            continue
        if ent.startswith("binary_sensor.") and (a.get("device_class") in OPENING_SENSORS or (not a.get("device_class") and opens_house("switch." + ent.split(".", 1)[1], a))):
            continue
        if ent.startswith("sensor.") and not a.get("unit_of_measurement") and opens_house("switch." + ent.split(".", 1)[1], a):
            continue
        if ent.startswith("scene.") and any(opens_house(e) for e in (a.get("entity_id") or []) if isinstance(e, str)):
            continue
        name = str(a.get("friendly_name") or "").strip()[:40] or ent.split(".", 1)[1].replace("_", " ").capitalize()
        o = {"entity": ent, "name": name, "domain": ent.split(".")[0]}
        u = a.get("unit_of_measurement")
        if isinstance(u, str) and 1 <= len(u) <= 12 and "<" not in u and ">" not in u:
            o["unit"] = u
        out.append(o)
    out.sort(key=lambda o: (o["domain"], o["name"].lower()))
    return out[:400]


def room_allows(room, entity):
    """The per room rule (tests/fixtures/room_caps.json; the same in bridge/rooms.py, smarthome.js, HomeAssistant.kt, home-v2.mjs)."""
    e = str(entity or "")
    d = e.split(".")[0]
    if not isinstance(room, dict) or d not in ("climate", "light", "media_player"):
        return True
    zones = room.get("zones")
    zones = [z if "." in z else "climate." + z for z in zones] if isinstance(zones, list) else None
    climate = room.get("climate")
    lists = {"climate": ((climate if isinstance(climate, list) else []) + (zones or [])) if isinstance(climate, list) or zones is not None else None,
             "light": room.get("lights") if isinstance(room.get("lights"), list) else None,
             "media_player": room.get("speakers") if isinstance(room.get("speakers"), list) else None}
    lst = lists[d]
    if lst is None:
        return room.get("only") is not True
    return e in lst


# ---------------------------------------------------------------- addresses

def home_host(h):
    """A name or address that can only be on the home network (the same rule as the account's)."""
    h = str(h or "").lower()
    if h == "localhost" or h.endswith(".local") or (re.fullmatch(r"[a-z0-9-]+", h) and not h.isdigit()):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    return ip.is_private and not ip.is_multicast


def clean_base(u):
    """http(s)://host[:port] on the home network, or None."""
    m = re.fullmatch(r"(https?)://([A-Za-z0-9.-]{1,253})(:\d{1,5})?/?", str(u or "").strip())
    if not m or not home_host(m.group(2)):
        return None
    return m.group(1).lower() + "://" + m.group(2).lower() + (m.group(3) or "")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _ctx():
    # a Home Assistant at home with https almost always has its own certificate: the address is one the person
    # chose on their own network, so the name is checked but an unknown issuer is allowed only for a home address
    c = ssl.create_default_context()
    c.check_hostname = False
    c.verify_mode = ssl.CERT_NONE
    return c


def http(method, url, body=None, headers=None, form=False, timeout=8, limit=12 * 1024 * 1024):
    """(status, parsed json or None). Never follows a redirect; only home addresses."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if not home_host(host):
        raise TvError("That address is not on your home network, so Setup did not call it.", "not_home")
    data = None
    h = {"User-Agent": "couch-tv-setup", **(headers or {})}
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=_ctx()))
    try:
        with opener.open(req, timeout=timeout) as r:
            raw = r.read(limit)
            code = r.status
    except urllib.error.HTTPError as e:
        raw, code = e.read(65536), e.code
    except (OSError, ValueError):
        return -1, None
    try:
        return code, json.loads(raw.decode("utf-8", "replace")) if raw else None
    except ValueError:
        return code, None


# ---------------------------------------------------------------- a small websocket (Home Assistant's own API for tokens and areas)

class WS:
    """Just enough of a websocket client for Home Assistant: text frames, masked, one at a time."""
    def __init__(self, base, timeout=10):
        u = urllib.parse.urlsplit(base)
        port = u.port or (443 if u.scheme == "https" else 80)
        raw = socket.create_connection((u.hostname, port), timeout=timeout)
        self.s = _ctx().wrap_socket(raw, server_hostname=u.hostname) if u.scheme == "https" else raw
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        req = ("GET /api/websocket HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n") % (u.hostname, port, key)
        self.s.sendall(req.encode())
        head = b""
        while b"\r\n\r\n" not in head:
            c = self.s.recv(1)
            if not c:
                raise OSError("closed")
            head += c
            if len(head) > 8192:
                raise OSError("bad answer")
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise OSError("not a websocket")
        self.n = 0

    def _read(self, n):
        out = b""
        while len(out) < n:
            c = self.s.recv(n - len(out))
            if not c:
                raise OSError("closed")
            out += c
        return out

    def send(self, o):
        data = json.dumps(o).encode()
        mask = secrets.token_bytes(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self, limit=16 * 1024 * 1024):
        msg = b""
        while True:
            a, b = self._read(2)
            n = b & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            if n + len(msg) > limit:
                raise OSError("too big")
            payload = self._read(n)
            op = a & 0x0F
            if op == 8:
                raise OSError("closed")
            if op == 9:   # ping
                continue
            msg += payload
            if a & 0x80:
                return json.loads(msg.decode("utf-8", "replace"))

    def ask(self, o):
        self.n += 1
        o = dict(o, id=self.n)
        self.send(o)
        while True:
            r = self.recv()
            if r.get("id") == self.n:
                return r

    def auth(self, token):
        first = self.recv()
        if first.get("type") != "auth_required":
            raise OSError("not Home Assistant")
        self.send({"type": "auth", "access_token": token})
        r = self.recv()
        if r.get("type") != "auth_ok":
            raise TvError("Home Assistant did not accept that sign in.", "ha_token")
        return r.get("ha_version", "")

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


# ---------------------------------------------------------------- what Setup holds while the step is open (memory only)

class Smart:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.ha = None          # {base, token, entities, areas, version}
        self.ha_found = []      # [{base, name}]
        self.oauth = None       # {state, base, client, redirect, at}
        self.hue = None         # {address, user, lights: [{id, name}]}
        self.hue_found = []     # [address]
        self.airtouch = None    # {address, zones: [{id, name}]}
        self.airtouch_found = []
        self.matter = {"waiting": 0, "joined": 0}


SM = Smart()


def view():
    """What the page may see: names and hosts, never a token or key."""
    ha = SM.ha
    return {
        "ha": {"connected": True, "host": urllib.parse.urlsplit(ha["base"]).hostname, "count": len(ha["entities"]), "version": ha.get("version", "")} if ha else None,
        "ha_found": [{"base": f["base"], "host": urllib.parse.urlsplit(f["base"]).hostname, "name": f["name"]} for f in SM.ha_found],
        "hue": {"connected": True, "address": SM.hue["address"], "lights": SM.hue["lights"]} if SM.hue else None,
        "hue_found": SM.hue_found,
        "airtouch": {"connected": True, "address": SM.airtouch["address"], "zones": SM.airtouch["zones"]} if SM.airtouch else None,
        "airtouch_found": SM.airtouch_found,
        "matter": SM.matter,
        "signing_in": bool(SM.oauth),
    }


# ---------------------------------------------------------------- 1. find

def _airtouch_udp(wait=2.0):
    """AirTouch 5 consoles answer a broadcast on UDP 49005 with "<ip>,<console id>,AirTouch5,<id>,<name>"."""
    out = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(0.3)
        s.bind(("", 0))
        s.sendto(b"::REQUEST-POLYAIRE-AIRTOUCH-DEVICE-INFO:;", ("255.255.255.255", 49005))
        end = time.monotonic() + wait
        while time.monotonic() < end:
            try:
                buf, src = s.recvfrom(1024)
            except socket.timeout:
                continue
            parts = buf.decode("ascii", "replace").split(",")
            if len(parts) >= 3 and "airtouch5" in parts[2].lower().replace(" ", "") and home_host(src[0]) and src[0] not in out:
                out.append(src[0])
    except OSError:
        pass
    finally:
        s.close()
    return out[:4]


def _probe_ha(base):
    """Is this a Home Assistant? Its sign in providers list answers without a sign in."""
    code, j = http("GET", base + "/auth/providers", timeout=4)
    return code == 200 and isinstance(j, (list, dict))


def find(progress=lambda *a: None):
    progress(0.1, "Looking on your Wi-Fi")
    try:
        heard = mdns.browse(["_home-assistant._tcp.local.", "_hue._tcp.local.", "_matterc._udp" + LOCAL, "_matter._tcp.local."], 3.0)
    except OSError:
        heard = []
    ha, hue, waiting, joined = [], [], 0, 0
    for h in heard:
        svc = h.get("service", "")
        if svc.startswith("_home-assistant"):
            t = h.get("txt") or {}
            base = clean_base(t.get("internal_url") or t.get("base_url") or "") or (clean_base("http://%s:%d" % (h["ip"], h["port"])) if h.get("ip") else None)
            if base and all(f["base"] != base for f in ha):
                ha.append({"base": base, "name": (t.get("location_name") or "Home Assistant")[:40]})
        elif svc.startswith("_hue") and h.get("ip") and home_host(h["ip"]) and h["ip"] not in hue:
            hue.append(h["ip"])
        elif svc.startswith("_matterc"):
            waiting += 1
        elif svc.startswith("_matter."):
            joined += 1
    progress(0.5, "Looking for Home Assistant")
    if not ha:
        for guess in ("http://homeassistant.local:8123", "http://homeassistant:8123"):
            try:
                if _probe_ha(guess):
                    ha.append({"base": guess, "name": "Home Assistant"})
                    break
            except TvError:
                pass
    progress(0.8, "Looking for air con")
    at = _airtouch_udp()
    with SM.lock:
        SM.ha_found, SM.hue_found, SM.airtouch_found = ha[:4], hue[:4], at
        SM.matter = {"waiting": waiting, "joined": joined}
    return view()


# ---------------------------------------------------------------- 2. sign in to Home Assistant

def ha_start(base, port):
    """Opens Home Assistant's own sign in page in the browser. Returns the page to open."""
    base = clean_base(base)
    if not base:
        raise TvError("That Home Assistant address is not on your home network.", "ha_address")
    client = "http://127.0.0.1:%d/" % port
    state = secrets.token_urlsafe(24)
    redirect = client + "ha/back"
    with SM.lock:
        SM.oauth = {"state": state, "base": base, "client": client, "redirect": redirect, "at": time.time()}
    return base + "/auth/authorize?" + urllib.parse.urlencode({"response_type": "code", "client_id": client, "redirect_uri": redirect, "state": state})


def ha_back(query):
    """Home Assistant sent the browser back with a code: swap it for a sign in, make a long-lived token, let the sign in go.
    Returns (ok, words) for the small page the browser shows."""
    q = urllib.parse.parse_qs(query or "")
    o = SM.oauth
    state, code = (q.get("state") or [""])[0], (q.get("code") or [""])[0]
    if not o or not secrets.compare_digest(state.encode(), o["state"].encode()) or time.time() - o["at"] > 600:
        return False, "That sign in was not started by this Couch TV Setup, or it took too long. Go back to Setup and press Connect again."
    with SM.lock:
        SM.oauth = None
    if not code or not re.fullmatch(r"[A-Za-z0-9._-]{8,512}", code):
        return False, "Home Assistant did not sign you in. Go back to Setup and press Connect again."
    st, t = http("POST", o["base"] + "/auth/token", {"grant_type": "authorization_code", "code": code, "client_id": o["client"]}, form=True)
    if st != 200 or not isinstance(t, dict) or not TOKEN.fullmatch(str(t.get("access_token") or "")):
        return False, "Home Assistant did not finish the sign in. Go back to Setup and try again."
    try:
        token = make_long_lived(o["base"], t["access_token"])
    finally:
        if t.get("refresh_token"):   # the short sign in is not kept anywhere: let Home Assistant forget it
            http("POST", o["base"] + "/auth/revoke", {"token": t["refresh_token"]}, form=True)
    if not token:
        return False, "Home Assistant signed you in, but did not make a key for Couch TV. Use a long-lived token in Setup instead."
    ha_use(o["base"], token)
    return True, "Home Assistant is connected. Go back to Couch TV Setup."


def make_long_lived(base, access):
    ws = None
    try:
        ws = WS(base)
        ws.auth(access)
        r = ws.ask({"type": "auth/long_lived_access_token", "client_name": "Couch TV " + time.strftime("%Y-%m-%d %H%M"), "lifespan": 3650})
        tok = r.get("result") if r.get("success") else None
        return tok if isinstance(tok, str) and TOKEN.fullmatch(tok) else None
    except (OSError, ValueError, TvError):
        return None
    finally:
        if ws:
            ws.close()


def _areas(base, token):
    """{entity: area name} from Home Assistant's own registry, or {} (older Home Assistant, or no websocket)."""
    ws = None
    try:
        ws = WS(base)
        ws.auth(token)
        areas = {a["area_id"]: a.get("name", "") for a in (ws.ask({"type": "config/area_registry/list"}).get("result") or []) if isinstance(a, dict) and a.get("area_id")}
        devices = {d["id"]: d.get("area_id") for d in (ws.ask({"type": "config/device_registry/list"}).get("result") or []) if isinstance(d, dict) and d.get("id")}
        out = {}
        for e in ws.ask({"type": "config/entity_registry/list"}).get("result") or []:
            if not isinstance(e, dict) or not ENTITY.fullmatch(str(e.get("entity_id") or "")):
                continue
            a = e.get("area_id") or devices.get(e.get("device_id"))
            if a in areas and areas[a]:
                out[e["entity_id"]] = str(areas[a])[:30]
        return out
    except (OSError, ValueError, TvError, KeyError, TypeError):
        return {}
    finally:
        if ws:
            ws.close()


def ha_use(base, token):
    """Checks an address and a token, reads what Home Assistant has and keeps it here (memory only)."""
    base = clean_base(base)
    if not base:
        raise TvError("That Home Assistant address is not on your home network.", "ha_address")
    token = str(token or "").strip()
    if not TOKEN.fullmatch(token):
        raise TvError("That token did not look right. Copy the whole token from Home Assistant.", "ha_token")
    auth = {"Authorization": "Bearer " + token}
    st, j = http("GET", base + "/api/", headers=auth)
    if st in (401, 403):
        raise TvError("Home Assistant did not accept that token.", "ha_token")
    if st != 200 or not isinstance(j, dict) or "API running" not in str(j.get("message", "")):
        raise TvError("Couch TV Setup could not reach Home Assistant at that address.", "ha_unreachable")
    st, states = http("GET", base + "/api/states", headers=auth)
    if st != 200 or not isinstance(states, list):
        raise TvError("Home Assistant did not list its devices.", "ha_unreachable")
    ents = pickable(states)
    areas = _areas(base, token)
    for e in ents:
        if e["entity"] in areas:
            e["area"] = areas[e["entity"]]
    _, cfg = http("GET", base + "/api/config", headers=auth)
    with SM.lock:
        SM.ha = {"base": base, "token": token, "entities": ents, "version": str((cfg or {}).get("version", ""))[:20] if isinstance(cfg, dict) else ""}
    return view()


# ---------------------------------------------------------------- Philips Hue

def hue_pair(address, wait=30):
    """The round button on the Hue Bridge: pressed, then this within 30 seconds. Tries every 2 seconds until then."""
    addr = str(address or "").strip()
    if not home_host(addr):
        raise TvError("That Hue Bridge address is not on your home network.", "hue_address")
    end = time.monotonic() + wait
    while True:
        st, r = http("POST", "http://%s/api" % addr, {"devicetype": "couch-tv#setup"}, timeout=4)
        if isinstance(r, list) and r and isinstance(r[0], dict):
            user = str((r[0].get("success") or {}).get("username") or "")
            if HUE_USER.fullmatch(user):
                _, lights = http("GET", "http://%s/api/%s/lights" % (addr, user), timeout=4)
                ls = [{"id": k, "name": str((v or {}).get("name") or "Light " + k)[:40]} for k, v in (lights or {}).items()
                      if re.fullmatch(r"[0-9]{1,4}", str(k)) and isinstance(v, dict)] if isinstance(lights, dict) else []
                with SM.lock:
                    SM.hue = {"address": addr, "user": user, "lights": sorted(ls, key=lambda x: int(x["id"]))[:64]}
                return view()
        elif st == -1:
            raise TvError("Couch TV Setup could not reach the Hue Bridge.", "hue_unreachable")
        if time.monotonic() >= end:
            raise TvError("The button was not pressed in time. Press the round button on the Hue Bridge, then try again.", "hue_button")
        time.sleep(2)


# ---------------------------------------------------------------- AirTouch 5

def airtouch_use(address):
    """The console's zones, through airtouch5py when this Setup has it (the Couch TV Helper does); else the console only."""
    addr = str(address or "").strip()
    if not home_host(addr):
        raise TvError("That AirTouch address is not on your home network.", "airtouch_address")
    zones = []
    try:
        import asyncio
        from airtouch5py.airtouch5_simple_client import Airtouch5SimpleClient

        async def read():
            c = Airtouch5SimpleClient(addr)
            await c.connect_and_stay_connected()
            try:
                return [{"id": "airtouch_%d" % z.zone_number, "name": str(z.zone_name)[:30]} for z in c.zones]
            finally:
                await c.disconnect()
        zones = asyncio.run(asyncio.wait_for(read(), 10))
    except Exception:
        zones = []
    with SM.lock:
        SM.airtouch = {"address": addr, "zones": zones[:16]}
    return view()


# ---------------------------------------------------------------- 3. the choices for each TV

def choices():
    """What each TV's room can hold, grouped: air con (Home Assistant climate and AirTouch zones), lights (Home Assistant and Hue),
    speakers. Each {id, name, from, area}."""
    air, lights, speakers = [], [], []
    for e in (SM.ha or {}).get("entities", []):
        item = {"id": e["entity"], "name": e["name"], "from": "Home Assistant", **({"area": e["area"]} if e.get("area") else {})}
        if e["domain"] == "climate":
            air.append(item)
        elif e["domain"] == "light":
            lights.append(item)
        elif e["domain"] == "media_player":
            speakers.append(item)
    for z in (SM.airtouch or {}).get("zones", []):
        air.append({"id": z["id"], "name": z["name"], "from": "AirTouch"})
    for lt in (SM.hue or {}).get("lights", []):
        lights.append({"id": "light.hue_" + lt["id"], "name": lt["name"], "from": "Hue"})
    return {"air": air, "lights": lights, "speakers": speakers}


def room_of(picks, label):
    """A room as the account keeps it from the ticks: air con ids split into climate entities and AirTouch zones."""
    p = picks if isinstance(picks, dict) else {}
    air = [str(x) for x in p.get("air", []) if isinstance(x, str)]
    room = {"label": str(label or "").strip()[:30], "only": True,
            "climate": [a for a in air if a.startswith("climate.")][:16],
            "zones": [a for a in air if re.fullmatch(r"airtouch_\d{1,2}", a)][:16],
            "lights": [str(x) for x in p.get("lights", []) if isinstance(x, str) and ENTITY.fullmatch(x)][:16],
            "speakers": [str(x) for x in p.get("speakers", []) if isinstance(x, str) and ENTITY.fullmatch(x)][:16]}
    for k in ("climate", "zones", "lights", "speakers"):
        if not room[k]:
            del room[k]
    return room


# ---------------------------------------------------------------- 4. the account

def report(link):
    """Names and ids only (never an address or key) to the account, so the editor can offer them."""
    ents = [{"entity": e["entity"], "name": e["name"], **({"unit": e["unit"]} if e.get("unit") else {})} for e in (SM.ha or {}).get("entities", [])]
    ents += [{"entity": "light.hue_" + lt["id"], "name": lt["name"]} for lt in (SM.hue or {}).get("lights", [])]
    body = {"zones": [{"id": z["id"], "name": z["name"]} for z in (SM.airtouch or {}).get("zones", [])],
            "lights": [e for e in ents if e["entity"].startswith("light.")],
            "entities": [e for e in ents if not e["entity"].startswith("light.")]}
    return studio.call("/v1/setup/found", body, link.token)


def account(link):
    return studio.call("/v1/setup/smarthome", {}, link.token)


def save(link, tvs):
    """tvs: [{tv_id, label, picks: {air, lights, speakers}}]. Keeps the keys locked in the account, then each TV's room and which keys it may use.
    A TV with nothing ticked gets no smart home key."""
    if not link or not link.token:
        raise TvError("Link Couch TV Setup to your account first.", "signed_out")
    saved = []
    if SM.ha:
        studio.call("/v1/setup/keys", {"kind": "ha", "key": {"token": SM.ha["token"], "url": SM.ha["base"]}}, link.token)
        saved.append("Home Assistant")
    if SM.hue:
        studio.call("/v1/setup/keys", {"kind": "hue", "key": {"key": SM.hue["user"], "url": "http://" + SM.hue["address"]}}, link.token)
        saved.append("Hue")
    out = []
    ha_ids = {e["entity"] for e in (SM.ha or {}).get("entities", [])}
    for t in tvs if isinstance(tvs, list) else []:
        if not isinstance(t, dict) or not studio.TV_ID_RE.fullmatch(str(t.get("tv_id") or "")):
            continue
        room = room_of(t.get("picks"), t.get("label"))
        ids = room.get("climate", []) + room.get("lights", []) + room.get("speakers", [])
        allow = []
        if SM.ha and any(i in ha_ids for i in ids):
            allow.append("ha")
        if SM.hue and any(i.startswith("light.hue_") for i in room.get("lights", [])):
            allow.append("hue")
        if SM.airtouch and room.get("zones"):
            allow.append("airtouch")
        out.append({"tv_id": t["tv_id"], "allow": allow, "room": room})
    r = studio.call("/v1/setup/rooms", {"tvs": out}, link.token) if out else {"ok": True}
    helper = write_helper()
    ticked = {i for o in out for k in ("climate", "lights", "speakers") for i in o["room"].get(k, [])}
    helper_ha = write_helper_ha(ticked)
    return {"ok": True, "saved": saved, "tvs": [{"tv_id": o["tv_id"], "allow": o["allow"]} for o in out], "helper": helper, "helper_ha": helper_ha, "rev": r.get("rev")}


# ---------------------------------------------------------------- 5. the Couch TV Helper on this computer (Hue and AirTouch)

def helper_dir():
    return paths.data() / "helper-data"


def write_helper(data_dir=None):
    """Hue and AirTouch go into the Helper's own direct.json (bridge/direct.py reads it), mode 600. Only when the Helper is set up here."""
    d = data_dir or helper_dir()
    if not (SM.hue or SM.airtouch) or not os.path.isdir(d):
        return False
    f = os.path.join(d, "direct.json")
    try:
        with open(f, encoding="utf-8") as fh:
            o = json.load(fh)
        o = o if isinstance(o, dict) else {}
    except (OSError, ValueError):
        o = {}
    if SM.hue:
        o["hue"] = {"address": SM.hue["address"], "user": SM.hue["user"], "lights": [lt["id"] for lt in SM.hue["lights"]][:16]}
    if SM.airtouch:
        o["airtouch"] = {"address": SM.airtouch["address"], "zones": [z["name"] for z in SM.airtouch["zones"]][:16]}
    _write600(f, o)
    return True


def _write600(f, o):
    tmp = f + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(o, fh)
    os.replace(tmp, f)
    return True


GROUPS = {"climate": ("climate", 8), "scene": ("scenes", 10), "script": ("scenes", 10), "light": ("controls", 16), "switch": ("controls", 16),
          "fan": ("controls", 16), "cover": ("controls", 16), "camera": ("cameras", 4), "sensor": ("sensors", 8), "media_player": ("speakers", 6)}


def helper_section(ticked):
    """H3: the Home Assistant section for the Helper's bridge (bridge/smarthome.py parse): the address, the long-lived token and the ticks,
    what a TV ticked for its room first, then the rest of what Home Assistant lists, up to each group's limit (ha-picks.js). Each TV's room
    still cuts it down on the bridge (bridge/rooms.py). Pure, for tests."""
    ha = SM.ha
    if not ha:
        return None
    out = {"url": ha["base"], "token": ha["token"], "from_setup": True}
    first = [e for e in ha["entities"] if e["entity"] in ticked]
    rest = [e for e in ha["entities"] if e["entity"] not in ticked]
    for e in first + rest:
        g = GROUPS.get(e["domain"])
        if not g or opens_house(e["entity"], {"friendly_name": e["name"]}):
            continue
        lst = out.setdefault(g[0], [])
        if len(lst) < g[1]:
            lst.append({"entity": e["entity"], "name": e["name"]})
    return out


def write_helper_ha(ticked, data_dir=None):
    """H3: hands the Home Assistant connection to the Couch TV Helper's bridge on this computer, for TVs it serves (Samsung, LG and the other
    web TVs): its home-assistant.json, mode 600. A set up made on a TV (a phone sign in, or a different Home Assistant) is never replaced.
    Setup writes it again each time the rooms are saved, so a change of ticks reaches the bridge at once (the bridge reads the file on each ask)."""
    d = str(data_dir or helper_dir())
    sec = helper_section(set(ticked or []))
    if not sec or not os.path.isdir(d):
        return False
    f = os.path.join(d, "home-assistant.json")
    try:
        with open(f, encoding="utf-8") as fh:
            old = json.load(fh)
    except (OSError, ValueError):
        old = None
    if isinstance(old, dict) and old and not old.get("from_setup") and (old.get("refresh_token") or clean_base(old.get("url")) != sec["url"]):
        return False
    return _write600(f, sec)


NODE_MIN = (22, 13)


def node_ok():
    """The computer's Node.js, which the bridge's Matter controller needs (docs/MATTER.md): (ok, version words)."""
    import shutil
    import subprocess
    n = shutil.which("node")
    if not n:
        return False, ""
    try:
        v = subprocess.run([n, "--version"], capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return False, ""
    m = re.match(r"v(\d+)\.(\d+)", v)
    return bool(m and (int(m.group(1)), int(m.group(2))) >= NODE_MIN), v


def matter_code(code):
    c = re.sub(r"[\s-]", "", str(code or ""))
    if not re.fullmatch(r"\d{11}|\d{21}|MT:[A-Z0-9.-]{10,40}", c):
        raise TvError("A Matter code has 11 digits. Copy it from your home app.", "matter_code")
    return c


ONTV_MATTER = "dev.couchtv.ontv/.matter.MatterFromComputer"


def matter_add_tv(tv, code, wait=150, poll=3.0):
    """H2: the TV is the controller (the on-TV app, dev.couchtv.ontv). The code goes in over ADB (MatterFromComputer.kt, behind the DUMP
    permission only ADB's shell holds), so nobody reads a pairing code off the TV. Asks again until the TV says how it went."""
    c = matter_code(code)
    out = tv.shell("am broadcast --include-stopped-packages -n %s --es matter_code %s" % (ONTV_MATTER, c))
    said = re.search(r'data="(couchtv-matter [^"]*)"', out or "")
    if not said:
        raise TvError("The Couch TV app on this TV is too old to add Matter devices from the computer. Update it, or use the phone page.", "matter_tv_old")
    if said.group(1) == "couchtv-matter busy":
        raise TvError("The TV is adding another device right now. Try again in a minute.", "matter_busy")
    end = time.monotonic() + wait
    while time.monotonic() < end:
        time.sleep(poll)
        out = tv.shell("am broadcast --include-stopped-packages -n %s --es matter_status 1" % ONTV_MATTER)
        s = re.search(r'data="couchtv-matter ([^"]*)"', out or "")
        st = s.group(1) if s else ""
        if st.startswith("ok"):
            return {"ok": True, "on": "tv", "devices": [d for d in st[2:].strip().split(",") if d]}
        if st.startswith("no"):
            key = st[2:].strip()
            words = {"not_allowed": "That device is a lock, an alarm or a garage door, so it was not added.", "thread": "The device uses Thread. A Google or Apple hub must be on at home.",
                     "expired": "That code ran out. Make a new one in your home app."}.get(key, "The device was not added. Make a new code in your home app and try again.")
            raise TvError(words, "matter_failed", key)
    raise TvError("That took too long. Make a new code in your home app and try again.", "matter_timeout")


def matter_add(code):
    """An 11 or 21 digit sharing code from Google Home, Apple Home, SmartThings or Alexa, handed to the Couch TV Helper's bridge on this
    computer (it is the Matter controller for TVs it serves, docs/MATTER.md). It needs Node.js 22.13 or newer on this computer."""
    c = matter_code(code)
    ok, v = node_ok()
    if not ok:
        raise TvError("Matter on this computer needs Node.js 22.13 or newer (" + (("this computer has " + v) if v else "it is not installed") +
                      "). Get it from nodejs.org, then try again. Or add the device on a Google TV, which needs no computer.", "matter_node")
    from .helper import config as hcfg
    cfg = hcfg.load()
    req = urllib.request.Request("http://127.0.0.1:%d/api/matter/commission" % cfg["port"], data=json.dumps({"code": c}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + cfg["pairing_key"]} if cfg["pairing_key"] else {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read(65536).decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            said = json.loads(e.read(4000).decode("utf-8", "replace"))
        except ValueError:
            said = {}
        raise TvError(said.get("message") or "The device was not added. Check the code and that it is on your Wi-Fi.", "matter_failed") from e
    except OSError as e:
        raise TvError("Turn on the Couch TV Helper on this computer first. It looks after Matter devices for your TVs.", "matter_helper") from e
