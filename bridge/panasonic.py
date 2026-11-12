"""The connection to a Panasonic Viera TV, for "kind": "panasonic" in config.json.

BETA. Written from Panasonic's network remote protocol as it is publicly described, and tested against a
stand-in TV on the computer (tests/panasonic_standin.py, docs/PANASONIC.md). Turn on "trace" (below) so
the first owner's log can settle anything in PROTOCOL that a real set answers differently.

Which sets: Viera TVs on My Home Screen (Firefox OS, about 2015 to 2019) and older Viera sets with
network control (about 2012 on). Not Panasonic's Google TV, Fire TV, Roku or TiVo models: a Google TV
model is a normal couch-tv TV, the others are their own systems.

How a Viera is reached: plain HTTP on port 55000, with SOAP requests (the same family as UPnP):

  nrc/ddd.xml        the device description: the model and the services it offers
  nrc/sdd_0.xml      the action list of the remote service. X_GetEncryptSessionId in it means an
                     encrypted set (about 2018 on): pair once with a PIN the TV shows
  nrc/control_0      keys (X_SendKey), apps (X_GetAppList, X_LaunchApp), the browser hand off
                     (X_ConnectApp), pairing and the encrypted wrapper
  dmr/control_0      volume and mute (UPnP RenderingControl), never encrypted
  pac/control_0      inputs (X_SendCtrlCmd)

The hook: a watcher knocks on port 55000 every 2 seconds. When the TV comes on, it waits a few seconds
and opens couch-tv's page in the TV's own browser. Panasonic does not say which app is in front, so the
hook cannot tell whether something of someone's is on screen: it opens on power on only, and stays quiet
for 20 seconds after anything the phone asked for. It is a page that opens itself, not a true home
screen: the remote's Home button still opens Panasonic's home, and the browser's own bar stays visible.

Encrypted sets: after pairing the TV gives an application id and a key word, kept in bridge/data at 0600
(never in git). Every remote command then goes inside X_EncryptedCommand, AES-128-CBC with an
HMAC-SHA256, as PROTOCOL describes. Needs the "cryptography" package (it comes with the bridge's
requirements, through androidtvremote2).

What it cannot do (docs/PANASONIC.md): read which app is in front or what is playing, typing, screenshots,
deep links into a show, ADB tools.
"""
import asyncio
import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import secrets
import socket
import struct
import time
from urllib.parse import quote
from xml.sax.saxutils import escape

import aiohttp

import apps
import config
from tv import TVUnavailable

HOME_PACKAGE = "app.couchtv.launcher"
COUCH_APP = "couch-tv"   # what the hook opens: the bridge's page in the TV's browser, not an id on the TV
PORT = 55000
WATCH_EVERY = 2.0        # seconds between knocks on the TV's port
SETTLE = 6.0             # seconds the hook lets the TV settle after it comes on (it reopens its last screen)

NRC_URN = "urn:panasonic-com:service:p00NetworkControl:1"
DMR_URN = "urn:schemas-upnp-org:service:RenderingControl:1"

# Every path, name and byte layout in one place, so a tester's trace can correct it here.
# Facts seen only in public write ups, never on a set we ran, are marked UNCONFIRMED.
PROTOCOL = {
    "nrc": ("nrc/control_0", NRC_URN),
    "dmr": ("dmr/control_0", DMR_URN),
    "pac": ("pac/control_0", None),          # URN read from ddd.xml (the service whose controlURL is this)
    "description": "nrc/ddd.xml",
    "actions": "nrc/sdd_0.xml",
    "encrypted_marker": "X_GetEncryptSessionId",
    # actions sent as they are even on an encrypted set (the pairing and the session request)
    "plain_actions": ("X_DisplayPinCode", "X_RequestAuth", "X_GetEncryptSessionId"),
    "wrong_pin": 600,                        # SOAP errorCode for a wrong PIN
    "pin": r"^\d{4}$",                       # UNCONFIRMED: four digits on the sets described
    # Apps. UNCONFIRMED: the list's layout (records split on "vc_app", fields on an apostrophe).
    "app_type": "vc_app",
    "app_split": "vc_app",
    "app_field": "'",
    # Opening a web page. All UNCONFIRMED on a real set:
    #  1. X_LaunchApp with this keyword opens the browser,
    #  2. after browser_wait seconds, X_ConnectApp tells the TV an address of ours (a listener),
    #  3. the TV connects to it and we send url_head, one length byte, the address, url_tail.
    "browser_keyword": "resource_id=1063",
    "browser_wait": 3.0,
    "connect_keyword": "couch-tv",
    "connect_timeout": 8.0,
    "url_head": bytes([0xF4, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]),
    "url_tail": b"\x00",
    "url_max": 255,                          # one length byte
    # Inputs. UNCONFIRMED: the argument's name.
    "input_action": "X_SendCtrlCmd",
    "input_arg": "X_CtrlCmd",
    "input_value": "PAC_IMS:{id}",
    # Encryption (sets with X_GetEncryptSessionId). From the public description of the scheme.
    # Pairing keys from the TV's challenge (16 bytes): AES key = each 4 byte group reversed and inverted,
    # HMAC key = this mask XORed with the challenge, shuffled 2,3,0,1 within each group of four.
    "hmac_mask": bytes.fromhex("15C95AC2B08AA7EB4E228F811E34D04FA54BA7DCAC9879FA8ACDA3FC244F3854"),
    "sequence": "{:08d}",
}

# Friendly key name -> Panasonic key. The first group is from the public key lists; the ones marked
# are in the same family but UNCONFIRMED.
KEYS = {
    "up": "NRC_UP-ONOFF", "down": "NRC_DOWN-ONOFF", "left": "NRC_LEFT-ONOFF", "right": "NRC_RIGHT-ONOFF",
    "ok": "NRC_ENTER-ONOFF", "select": "NRC_ENTER-ONOFF", "enter": "NRC_ENTER-ONOFF",
    "back": "NRC_RETURN-ONOFF", "exit": "NRC_CANCEL-ONOFF", "viera_home": "NRC_HOME-ONOFF",
    "menu": "NRC_MENU-ONOFF", "settings": "NRC_MENU-ONOFF", "apps": "NRC_APPS-ONOFF",
    "power": "NRC_POWER-ONOFF", "input": "NRC_CHG_INPUT-ONOFF",
    "volume_up": "NRC_VOLUP-ONOFF", "volume_down": "NRC_VOLDOWN-ONOFF", "mute": "NRC_MUTE-ONOFF",
    # UNCONFIRMED from here
    "play_pause": "NRC_PLAY-ONOFF", "play": "NRC_PLAY-ONOFF", "pause": "NRC_PAUSE-ONOFF",
    "stop": "NRC_STOP-ONOFF", "fast_forward": "NRC_FF-ONOFF", "rewind": "NRC_REW-ONOFF",
    "next": "NRC_FF-ONOFF", "previous": "NRC_REW-ONOFF",
    "channel_up": "NRC_CH_UP-ONOFF", "channel_down": "NRC_CH_DOWN-ONOFF",
    **{str(n): f"NRC_D{n}-ONOFF" for n in range(10)},
}
HDMI_KEY = re.compile(r"^hdmi([1-4])$")
RAW_KEY = re.compile(r"^NRC_[A-Z0-9_]{1,24}-ONOFF$")
LAUNCH = re.compile(r"^(product_id=[0-9A-Za-z]{16}|resource_id=\d{1,8})$")   # an app keyword, before it is sent
INPUT_ID = re.compile(r"^[0-9A-Za-z_]{1,16}$")
SECRET_TAGS = ("X_PinCode", "X_ChallengeKey", "X_AuthInfo", "X_AuthResult", "X_Keyword", "X_EncInfo",
               "X_EncResult", "X_ApplicationId", "X_SessionId")


def resolve_key(name):
    """Friendly name, or a Panasonic key such as NRC_RED-ONOFF -> the key sent. "home" is handled before this."""
    if not isinstance(name, str) or not name.strip():
        return None
    k = name.strip()
    if k.lower() in KEYS:
        return KEYS[k.lower()]
    return k.upper() if RAW_KEY.match(k.upper()) else None


def _plain(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


BY_NAME = {}
for _a in apps.APPS:
    for _n in [_a["name"]] + (apps.WEBOS.get(_a["id"]) or {}).get("names", []):
        BY_NAME.setdefault(_plain(_n), _a["package"])


def field(xml, tag):
    """The text of the first <tag> in a SOAP answer, unescaped, or None. Namespaces are ignored."""
    m = re.search(rf"<(?:[\w-]+:)?{tag}(?:\s[^>]*)?>(.*?)</(?:[\w-]+:)?{tag}>", xml or "", re.S)
    return html.unescape(m.group(1)) if m else None


def hide(text):
    """A SOAP message with every PIN, key, session and application id replaced, for logs and issues."""
    for t in SECRET_TAGS:
        text = re.sub(rf"(<(?:[\w-]+:)?{t}>).*?(</(?:[\w-]+:)?{t}>)", r"\1(hidden)\2", text, flags=re.S)
    return text


def envelope(action, urn, args=""):
    return ('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
            's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
            f'<u:{action} xmlns:u="{urn}">{args}</u:{action}></s:Body></s:Envelope>')


# ---------- the encrypted sets' cipher ----------
def _aes(key, iv):
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    except ImportError:
        raise PanasonicError("this TV wants encryption, which needs the cryptography package: "
                             ".venv/bin/pip install -r bridge/requirements.txt") from None
    return Cipher(algorithms.AES(bytes(key)), modes.CBC(bytes(iv)))


def pairing_keys(challenge):
    """(AES key, HMAC key) for the PIN step, from the TV's 16 byte challenge."""
    if len(challenge) != 16:
        raise PanasonicError("the TV's challenge is not 16 bytes")
    aes_key = bytearray()
    for g in range(0, 16, 4):
        aes_key += bytes(~b & 0xFF for b in reversed(challenge[g:g + 4]))
    mask = PROTOCOL["hmac_mask"]
    order = (2, 3, 0, 1)
    hmac_key = bytes(mask[i] ^ challenge[(i - i % 4 + order[i % 4]) % 16] for i in range(32))
    return bytes(aes_key), hmac_key


def session_keys(keyword):
    """(IV, AES key, HMAC key) for commands, from the key word the TV gave when it was paired."""
    iv = base64.b64decode(keyword)
    if len(iv) != 16:
        raise PanasonicError("the stored key word is not 16 bytes: pair again")
    key = bytes(iv[g + o] for g in range(0, 16, 4) for o in (2, 3, 0, 1))
    return iv, key, iv + iv


def seal(text, key, hmac_key, iv):
    """12 random bytes, the length (4 bytes, big endian), the text, zero padding; AES-CBC; HMAC on the end."""
    data = text.encode("utf-8")
    plain = secrets.token_bytes(12) + struct.pack(">I", len(data)) + data
    plain += b"\0" * (16 - len(plain) % 16)
    enc = _aes(key, iv).encryptor()
    ct = enc.update(plain) + enc.finalize()
    return base64.b64encode(ct + hmac.new(hmac_key, ct, hashlib.sha256).digest()).decode()


def unseal(b64, key, hmac_key, iv):
    """The text inside a sealed answer. The HMAC is checked and taken off when it is there."""
    try:
        data = base64.b64decode(b64 or "", validate=True)
    except ValueError:
        raise PanasonicError("the TV's encrypted answer is not base64") from None
    if len(data) >= 48 and hmac.compare_digest(hmac.new(hmac_key, data[:-32], hashlib.sha256).digest(), data[-32:]):
        data = data[:-32]
    if not data or len(data) % 16:
        raise PanasonicError("the TV's encrypted answer has the wrong length")
    dec = _aes(key, iv).decryptor()
    plain = dec.update(data) + dec.finalize()
    return plain[16:].split(b"\0", 1)[0].decode("utf-8", "replace")


class PanasonicError(RuntimeError):
    """The TV did not do what was asked, or answered with something unusable."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class PanasonicTV:
    kind = "panasonic"
    can_read_media = False
    INPUT = re.compile(r"^$")   # Panasonic never says which input is on screen

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg["name"]
        self.log = logging.getLogger(f"panasonic.{self.id}")
        self.host = (cfg.get("host") or "").strip() or None
        self.fallback_ip = cfg.get("ip")
        self.ip = None
        self.mac = cfg.get("mac")
        self.wake_on_lan = cfg.get("wake_on_lan", True) is not False
        self.port = int(cfg.get("port") or PORT)
        self.trace = cfg.get("trace", False) is True
        self.open_on_power_on = cfg.get("open_on_power_on", True) is not False
        self.leave_inputs = False
        self.settle = float(cfg.get("settle", SETTLE))
        self.home_url_cfg = (cfg.get("home_url") or "").strip() or None
        self.encrypted_cfg = cfg.get("encrypted") if isinstance(cfg.get("encrypted"), bool) else None
        self.store_file = os.path.join(config.DATA, f"panasonic-{self.id}.json")
        self.app_id = COUCH_APP
        self.paired = True          # an unencrypted set needs no pairing; panasonic_status() says more
        self.picture_cfg = {}
        self.keep_disabled_file = None
        self.adb_ok = False
        self.state = {"playing": {"item": None}, "media_now": {}, "seen_playing": {},
                      "sleep": {"ends": None, "handle": None}, "waking": {"on": False},
                      "installed": {"packages": None, "checked": 0.0}, "picture": {}}
        self.connected = False      # port 55000 answers
        self._checked = False       # the watcher has knocked at least once
        self.visible = None         # never known on Panasonic
        self.encrypted = self.encrypted_cfg   # None until the action list was read
        self.model = None
        self.services = {}          # controlURL -> serviceType, from ddd.xml
        self.applist = []           # [{"launch", "name", "package"}]
        self.ids = {}               # launch keyword -> android style package
        self._ids_checked = 0.0
        self._session = None
        self._enc = None            # (session id, sequence number) on an encrypted set
        self._challenge = None      # the PIN step's challenge, in memory only
        self._codes = {}            # one time codes for the home page -> when they run out
        self._front = (None, 0.0)   # (package, when) the last app the bridge opened
        self._vol = {}
        self._listeners = set()
        self._tasks = []
        self.last_error = None
        self.pin_shown_at = 0.0
        self.quiet_until = 0.0
        self.home_on_wake_until = 0.0
        self.hook_log = []

    # ---------- what the bridge keeps for this TV ----------
    def _stored(self):
        try:
            with open(self.store_file) as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {}
        except (OSError, ValueError):
            return {}

    def _keep(self, **changes):
        d = self._stored() | changes
        os.makedirs(os.path.dirname(self.store_file), exist_ok=True)
        tmp = self.store_file + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(d, f)
        os.replace(tmp, self.store_file)

    @property
    def credentials(self):
        d = self._stored()
        a, k = d.get("app_id"), d.get("keyword")
        return (a, k) if isinstance(a, str) and a and isinstance(k, str) and k else None

    # ---------- shape shared with tv.TV ----------
    @property
    def is_on(self):
        """The TV answering on port 55000 counts as on. UNCONFIRMED: a set in networked standby may answer too."""
        return self.connected if self._checked else None

    @property
    def current_package(self):
        """Panasonic does not say which app is in front. The app the bridge last opened counts while the
        TV stays on, for up to four hours."""
        if not self.connected:
            return None
        pkg, at = self._front
        return pkg if pkg and time.monotonic() - at < 4 * 3600 else None

    @property
    def volume(self):
        v = self._vol if self.connected else {}
        return {"level": v.get("level"), "max": 100 if "level" in v else None,
                "muted": v.get("muted"), "known": "level" in v}

    def on_change(self, fn):
        self._listeners.add(fn)

    def _changed(self):
        for fn in list(self._listeners):
            try:
                fn()
            except Exception:
                self.log.exception("listener failed")

    def require(self):
        if not self.connected:
            raise TVUnavailable(f"the {self.name.lower()} TV is not answering on the network")

    def can_deeplink(self, app):
        return False   # no deep link into a show is known on Panasonic: apps open on their own page

    def panasonic_status(self):
        """For /api/tvs: the parts a tester needs to see at a glance."""
        return {"port": self.connected, "model": self.model, "encrypted": self.encrypted,
                "paired": bool(self.credentials), "session": bool(self._enc), "volume": self.volume["known"],
                "apps": len(self.applist), "error": self.last_error}

    # ---------- HTTP and SOAP ----------
    async def _http(self):
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5))
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
        self._session = None

    def _url(self, path):
        return f"http://{self.ip or self.fallback_ip}:{self.port}/{path}"

    def _trace(self, way, what, text):
        if self.trace:
            self.log.info("trace %s %s %s", way, what, hide(text)[:800])

    async def _get(self, path):
        s = await self._http()
        try:
            async with s.get(self._url(path)) as r:
                text = await r.text()
                self._trace("in ", path, f"{r.status} {text}")
                if r.status != 200:
                    raise PanasonicError(f"the TV answered {r.status} for {path}", r.status)
                return text
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"the TV did not answer ({type(e).__name__})") from None

    async def _post(self, service, action, args, urn=None):
        path, default_urn = PROTOCOL[service]
        urn = urn or default_urn or self.services.get(path)
        if not urn:
            raise PanasonicError(f"the TV does not list a service at {path}")
        body = envelope(action, urn, args)
        self._trace("out", action, body)
        s = await self._http()
        try:
            async with s.post(self._url(path), data=body.encode("utf-8"), headers={
                    "Content-Type": 'text/xml; charset="utf-8"', "SOAPAction": f'"{urn}#{action}"'}) as r:
                text = await r.text()
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
            raise TVUnavailable(f"the TV did not answer {action} ({type(e).__name__})") from None
        self._trace("in ", action, f"{r.status} {text}")
        if r.status != 200:
            code = field(text, "errorCode")
            desc = field(text, "errorDescription") or ""
            raise PanasonicError(f"the TV refused {action} ({code or r.status}{', ' + desc if desc else ''})",
                                 int(code) if code and code.isdigit() else r.status)
        return text

    async def _soap(self, service, action, args=""):
        """One SOAP request. On an encrypted set, remote commands go inside X_EncryptedCommand."""
        if service != "nrc" or action in PROTOCOL["plain_actions"]:
            return await self._post(service, action, args)
        if self.encrypted is None:
            await self.detect()
        if not self.encrypted:
            return await self._post(service, action, args)
        for attempt in (0, 1):
            if not self._enc:
                await self._new_session()
            try:
                return await self._encrypted(action, args)
            except PanasonicError as e:
                if attempt or e.code == PROTOCOL["wrong_pin"]:
                    raise
                self.log.info("encrypted %s refused (%s): asking for a new session", action, e.code)
                self._enc = None   # the session may have run out: one new one, then give up
        raise PanasonicError(f"the TV refused {action}")

    async def _encrypted(self, action, args):
        app_id, keyword = self._need_credentials()
        iv, key, hk = session_keys(keyword)
        sid, seq = self._enc
        seq += 1
        self._enc = (sid, seq)
        inner = (f"<X_SessionId>{escape(sid)}</X_SessionId>"
                 f"<X_SequenceNumber>{PROTOCOL['sequence'].format(seq)}</X_SequenceNumber>"
                 f'<X_OriginalCommand><u:{action} xmlns:u="{NRC_URN}">{args}</u:{action}></X_OriginalCommand>')
        self._trace("out", f"{action} (inside X_EncryptedCommand)", inner)
        text = await self._post("nrc", "X_EncryptedCommand",
                                f"<X_ApplicationId>{escape(app_id)}</X_ApplicationId>"
                                f"<X_EncInfo>{seal(inner, key, hk, iv)}</X_EncInfo>")
        res = field(text, "X_EncResult")
        if res is None:
            return text
        out = unseal(res, key, hk, iv)
        self._trace("in ", f"{action} (decrypted)", out)
        return out

    def _need_credentials(self):
        creds = self.credentials
        if not creds:
            self.last_error = "this TV wants pairing first (a PIN on the TV, docs/PANASONIC.md)"
            raise PanasonicError(self.last_error)
        return creds

    async def _new_session(self):
        app_id, keyword = self._need_credentials()
        iv, key, hk = session_keys(keyword)
        text = await self._post("nrc", "X_GetEncryptSessionId",
                                f"<X_ApplicationId>{escape(app_id)}</X_ApplicationId><X_EncInfo>"
                                + seal(f"<X_ApplicationId>{escape(app_id)}</X_ApplicationId>", key, hk, iv)
                                + "</X_EncInfo>")
        sid = field(unseal(field(text, "X_EncResult") or "", key, hk, iv), "X_SessionId")
        if not sid:
            raise PanasonicError("the TV gave no session (pair again if this keeps happening)")
        self._enc = (sid, 0)

    # ---------- reading the TV ----------
    async def detect(self):
        """Read the device description and the action list once: the model, the services, encryption."""
        try:
            ddd = await self._get(PROTOCOL["description"])
            self.model = " ".join(x for x in (field(ddd, "friendlyName"), field(ddd, "modelName"),
                                               field(ddd, "modelNumber")) if x) or None
            for svc in re.findall(r"<service>(.*?)</service>", ddd, re.S):
                url, kind = field(svc, "controlURL"), field(svc, "serviceType")
                if url and kind:
                    self.services[url.strip().lstrip("/")] = kind.strip()
        except PanasonicError as e:
            self.log.info("device description: %s", e)
        if self.encrypted_cfg is None:
            sdd = await self._get(PROTOCOL["actions"])
            self.encrypted = PROTOCOL["encrypted_marker"] in sdd
        return self.encrypted

    async def _read_volume(self):
        out = {}
        for action, tag, key in (("GetVolume", "CurrentVolume", "level"), ("GetMute", "CurrentMute", "muted")):
            try:
                v = field(await self._soap("dmr", action, "<InstanceID>0</InstanceID><Channel>Master</Channel>"), tag)
            except (PanasonicError, TVUnavailable):
                continue
            if v is not None and v.strip().isdigit():
                out[key] = int(v) if key == "level" else v.strip() == "1"
        changed = out != self._vol
        self._vol = out
        if changed:
            self._changed()
        return self.volume

    async def set_volume(self, level):
        self.require()
        level = max(0, min(100, int(level)))
        await self._soap("dmr", "SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>"
                                             f"<DesiredVolume>{level}</DesiredVolume>")
        await self._read_volume()

    async def set_mute(self, on):
        self.require()
        await self._soap("dmr", "SetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>"
                                           f"<DesiredMute>{1 if on else 0}</DesiredMute>")
        await self._read_volume()

    async def refresh_installed(self, force=False):
        """The apps on the TV, every 30 minutes."""
        if not force and time.time() - self._ids_checked < 1800 and self.applist:
            return self.ids
        try:
            text = await self._soap("nrc", "X_GetAppList", "<X_AppType/><X_PackName/><X_AppMaker/>")
        except (PanasonicError, TVUnavailable) as e:
            self.log.info("app list: %s", e)
            return self.ids
        raw = field(text, "X_AppList") or ""
        listed, found = [], {}
        for rec in raw.split(PROTOCOL["app_split"]):
            parts = [p.strip() for p in rec.split(PROTOCOL["app_field"])]
            i = next((n for n, p in enumerate(parts) if LAUNCH.match(p)), None)
            if i is None:
                continue
            title = next((p for p in parts[i + 1:] if p and not p.startswith(("http:", "https:"))), "")
            if not title or len(title) > 80:
                continue
            pkg = BY_NAME.get(_plain(title))
            if pkg:
                found[parts[i]] = pkg
            listed.append({"launch": parts[i], "name": title, "package": pkg or f"panasonic.{parts[i]}"})
        if listed:
            self.applist, self.ids, self._ids_checked = listed, found, time.time()
        return self.ids

    async def apps_on_tv(self):
        await self.refresh_installed()
        return list(self.applist)

    def _entry(self, package):
        """The TV's own app list entry for a package, "panasonic.<keyword>" or a catalogue id. Only an entry
        the TV listed is ever sent back to it."""
        if package and package.startswith("panasonic."):
            return next((a for a in self.applist if a["launch"] == package[10:]), None)
        app = apps.BY_PACKAGE.get(package) or apps.BY_ID.get(package)
        pkg = app["package"] if app else package
        return next((a for a in self.applist if a["package"] == pkg), None)

    # ---------- couch-tv's page ----------
    def home_url(self, code=None):
        """The bridge's home page as the TV reaches it. "home_url" in config.json wins."""
        base = self.home_url_cfg
        if not base:
            port = int(os.environ.get("PORT") or config.BRIDGE.get("port") or 5400)
            base = f"http://{self._my_address()}:{port}/tv/"
        q = []
        if self.id != config.DEFAULT_TV:
            q.append("tv=" + quote(self.id, safe=""))
        if code:
            q.append("once=" + code)
        return base + (("&" if "?" in base else "?") + "&".join(q) if q else "")

    def _my_address(self):
        """This computer's address towards the TV (a UDP socket sends nothing when it connects)."""
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((self.ip or self.fallback_ip or "192.0.2.1", 9))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"
        finally:
            s.close()

    def new_code(self):
        """A one time code for the page the bridge opens, swapped for the pairing key at /api/vidaa/claim
        (shared with VIDAA), so the key itself is never in the browser's address bar or history."""
        now = time.monotonic()
        self._codes = {c: t for c, t in self._codes.items() if t > now}
        code = secrets.token_urlsafe(18)
        self._codes[code] = now + 120
        return code

    def claim(self, code):
        """True once for a code this TV handed out in the last two minutes."""
        exp = self._codes.pop(code, None) if isinstance(code, str) else None
        return exp is not None and exp > time.monotonic()

    async def open_url(self, url):
        """Open a web address in the TV's browser (PROTOCOL: browser_keyword, then X_ConnectApp)."""
        if not isinstance(url, str) or not re.match(r"^https?://[\x21-\x7e]+$", url):
            raise ValueError("only a plain http or https address can be opened")
        data = url.encode("ascii")
        if len(data) > PROTOCOL["url_max"]:
            raise ValueError(f"the address is longer than {PROTOCOL['url_max']} characters")
        self.require()
        got = asyncio.get_running_loop().create_future()

        async def tv_connected(reader, writer):
            try:
                writer.write(PROTOCOL["url_head"] + bytes([len(data)]) + data + PROTOCOL["url_tail"])
                await writer.drain()
                self._trace("out", "browser address", url.split("?")[0] + ("?(hidden)" if "?" in url else ""))
                if not got.done():
                    got.set_result(True)
            finally:
                writer.close()

        me = self._my_address()
        server = await asyncio.start_server(tv_connected, me, 0)   # only on the address the TV reaches
        try:
            await self._soap("nrc", "X_LaunchApp", f"<X_AppType>{PROTOCOL['app_type']}</X_AppType>"
                                                   f"<X_LaunchKeyword>{PROTOCOL['browser_keyword']}</X_LaunchKeyword>")
            await asyncio.sleep(PROTOCOL["browser_wait"])
            port = server.sockets[0].getsockname()[1]
            await self._soap("nrc", "X_ConnectApp",
                             f"<X_ConnectKeyword>{escape(PROTOCOL['connect_keyword'])}</X_ConnectKeyword>"
                             f"<X_ConnectAddr>{me}:{port}</X_ConnectAddr>")
            try:
                await asyncio.wait_for(got, PROTOCOL["connect_timeout"])
            except asyncio.TimeoutError:
                raise PanasonicError("the browser opened but the TV never came for the address "
                                     "(turn on trace and send the log, docs/PANASONIC.md)") from None
        finally:
            server.close()
            await server.wait_closed()

    async def open_home(self):
        """Open couch-tv: the TV's browser at the bridge's page, with a one time code, never the key."""
        await self.open_url(self.home_url(self.new_code()))
        self._front = (HOME_PACKAGE, time.monotonic())

    # ---------- pairing (the PIN on the TV, encrypted sets only) ----------
    async def pair_start(self):
        """Ask the TV to show its PIN. False on a set that needs no pairing."""
        self.require()
        if not await self.detect():
            return False
        text = await self._post("nrc", "X_DisplayPinCode",
                                f"<X_DeviceName>{escape(config.CLIENT_NAME)}</X_DeviceName>")
        try:
            self._challenge = base64.b64decode(field(text, "X_ChallengeKey") or "", validate=True)
        except ValueError:
            self._challenge = None
        if not self._challenge or len(self._challenge) != 16:
            self._challenge = None
            raise PanasonicError("the TV showed no PIN challenge (turn on trace and send the log)")
        self.pin_shown_at = time.monotonic()
        return True

    async def pair_finish(self, pin):
        """Send the PIN sealed with the challenge; keep the application id and key word (0600, never in git)."""
        pin = str(pin or "").strip()
        if not re.match(PROTOCOL["pin"], pin):
            raise ValueError("the PIN is the digits the TV shows")
        self.require()
        if not self._challenge:
            raise PanasonicError("ask the TV for a PIN first")
        key, hk = pairing_keys(self._challenge)
        iv = self._challenge
        try:
            text = await self._post("nrc", "X_RequestAuth",
                                    f"<X_AuthInfo>{seal(f'<X_PinCode>{pin}</X_PinCode>', key, hk, iv)}</X_AuthInfo>")
        except PanasonicError as e:
            if e.code == PROTOCOL["wrong_pin"]:
                self.last_error = "the TV said the PIN was wrong"
                raise PanasonicError("the PIN was wrong: ask for a new one and try again", e.code) from None
            raise
        out = unseal(field(text, "X_AuthResult") or "", key, hk, iv)
        app_id, keyword = field(out, "X_ApplicationId"), field(out, "X_Keyword")
        if not app_id or not keyword:
            self.last_error = "the TV accepted the PIN but sent no keys"
            raise PanasonicError("the TV accepted the PIN but sent no keys (turn on trace and send the log)")
        session_keys(keyword)   # refuses a key word that is not 16 bytes before it is kept
        self._keep(app_id=app_id, keyword=keyword)
        self._challenge, self._enc, self.last_error = None, None, None
        self.log.info("paired (keys kept in %s)", os.path.basename(self.store_file))
        return True

    # ---------- the watcher and the hook ----------
    async def start(self):
        self._tasks = [asyncio.create_task(self._watch())]

    async def _resolve(self):
        if not self.host:
            self.ip = self.ip or self.fallback_ip
            return self.ip
        try:
            infos = await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(
                self.host, self.port, family=socket.AF_INET), timeout=5)
            self.ip = infos[0][4][0]
        except Exception:
            self.ip = self.ip or self.fallback_ip
        return self.ip

    async def _watch(self):
        await self._resolve()
        was_on, ticks = None, 0
        while True:
            try:
                before = self.connected
                self.connected = await self.port_open()
                self._checked = True
                if not self.connected:
                    self._enc, self._front = None, (None, 0.0)
                    if ticks % 30 == 0:
                        await self._resolve()
                elif before is not True:
                    try:
                        await self.detect()
                        await self._read_volume()
                    except (PanasonicError, TVUnavailable) as e:
                        self.log.info("%s", e)
                if self.connected and ticks % 15 == 0:
                    await self.refresh_installed()
                on = self.is_on
                if on and was_on is False:
                    asyncio.create_task(self._hook())
                was_on = on
                if self.connected != before:
                    self._changed()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.log.warning("watch: %s %s", type(e).__name__, e)
            ticks += 1
            await asyncio.sleep(WATCH_EVERY)

    def _note(self, what):
        self.log.info("hook: %s", what)
        self.hook_log = (self.hook_log + [(time.strftime("%H:%M:%S"), what)])[-8:]

    async def _hook(self):
        """The TV just came on: after a short settle, open couch-tv in the browser. Panasonic cannot say
        what is on screen, so a command from the phone in the last 20 seconds is the only thing that wins."""
        if time.monotonic() < self.home_on_wake_until:
            self.home_on_wake_until = 0.0   # switched on from the phone: couch-tv, even inside the quiet time
        elif time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (a command is running)")
            return
        if not self.open_on_power_on:
            return
        quiet = self.quiet_until
        await asyncio.sleep(self.settle)
        if not self.connected:
            self._note("TV came on and went off again, left alone")
            return
        if self.quiet_until != quiet and time.monotonic() < self.quiet_until:
            self._note("TV came on, left alone (the phone asked for something meanwhile)")
            return
        try:
            await self.open_home()
            self._note("TV came on, opened couch-tv in the browser")
        except Exception as e:
            self._note(f"TV came on, could not open couch-tv: {e}")

    # ---------- the remote ----------
    async def key(self, name, hold=False):
        code = resolve_key(name)
        power = code == KEYS["power"]
        self.quiet_until = 0.0 if power else time.monotonic() + 20
        if isinstance(name, str) and name.strip().lower() == "home":
            # couch-tv's Home is our page; Panasonic's own home is "viera_home".
            await self._launch(self.app_id)
            return "couch-tv"
        m = HDMI_KEY.match(name.strip().lower()) if isinstance(name, str) else None
        if m:
            await self.select_input(m.group(1))
            return f"hdmi{m.group(1)}"
        if not code:
            raise ValueError(f"unknown key: {name}")
        if power and not self.connected:
            await self.wake()   # fully off, or deep standby: the port is gone with it
            return code
        self.require()
        if power and not self.is_on:
            self.home_on_wake_until = time.monotonic() + 90
        await self._soap("nrc", "X_SendKey", f"<X_KeyEvent>{code}</X_KeyEvent>")   # a hold is a press
        if code in (KEYS["volume_up"], KEYS["volume_down"], KEYS["mute"]):
            asyncio.create_task(self._read_volume_quietly())
        return code

    async def _read_volume_quietly(self):
        await asyncio.sleep(0.3)
        try:
            await self._read_volume()
        except Exception:
            pass

    async def select_input(self, input_id):
        """An input by its id (PROTOCOL input_*, UNCONFIRMED). HDMI 1 to 4 are "1" to "4" as far as known."""
        input_id = str(input_id)
        if not INPUT_ID.match(input_id):
            raise ValueError("not an input id")
        self.require()
        self.quiet_until = time.monotonic() + 20
        value = escape(PROTOCOL["input_value"].format(id=input_id))
        await self._soap("pac", PROTOCOL["input_action"], f"<{PROTOCOL['input_arg']}>{value}</{PROTOCOL['input_arg']}>")

    async def text(self, text):
        raise TVUnavailable("typing into a Panasonic TV from the phone is not built: use the TV's own keyboard")

    async def _launch(self, app_id, quiet=True):
        if quiet:
            self.quiet_until = time.monotonic() + 20
        if app_id == self.app_id:
            await self.open_home()
            return
        entry = next((a for a in self.applist if a["launch"] == app_id), None)
        if not entry:
            raise ValueError(f"not an app the TV listed: {app_id}")
        await self._launch_entry(entry)

    async def _launch_entry(self, entry):
        if not LAUNCH.match(entry.get("launch") or ""):
            raise ValueError("not a Panasonic app keyword")
        await self._soap("nrc", "X_LaunchApp", f"<X_AppType>{PROTOCOL['app_type']}</X_AppType>"
                                               f"<X_LaunchKeyword>{entry['launch']}</X_LaunchKeyword>")

    async def launch_package(self, package):
        """Open an app the TV lists: a catalogue app found by its name, or "panasonic.<keyword>"."""
        self.require()
        if package in (HOME_PACKAGE, self.app_id):
            await self._launch(self.app_id)
            return "remote"
        await self.refresh_installed()
        entry = self._entry(package)
        if not entry:
            if not self.applist:
                raise TVUnavailable("the TV has not said which apps it has yet")
            raise TVUnavailable(f"{package} is not installed on the TV")
        self.quiet_until = time.monotonic() + 20
        await self._launch_entry(entry)
        self._front = (entry["package"], time.monotonic())
        return "remote"

    async def start_intent(self, uri, package=None, cold=False):
        """No deep link into a show is known on Panasonic: the app opens on its own page."""
        self.require()
        if not package:
            raise ValueError("Panasonic TVs only open apps, not links: name the app")
        await self.launch_package(package)
        return "app"

    async def front_package(self):
        return self.current_package

    async def wait_for_app(self, packages, timeout=8.0):
        """The TV cannot say what is in front: the app the bridge just opened counts."""
        pkg, at = self._front
        return pkg if pkg in {p for p in packages if p} and time.monotonic() - at < 30 else None

    async def installed_packages(self):
        if not self.connected:
            return None
        await self.refresh_installed()
        return set(self.ids.values()) if self.ids else None

    # ---------- what Panasonic does not have ----------
    async def adb_ready(self):
        return False

    async def adb_connect(self):
        return False

    async def adb(self, *args, **kw):
        raise TVUnavailable("this is a Panasonic TV: ADB tools are Android only")

    async def screenshot(self):
        raise TVUnavailable("Panasonic TVs do not give screenshots over the network")

    # ---------- power ----------
    async def _read_power(self):
        self.connected = await self.port_open()
        self._checked = True

    async def port_open(self, port=None, timeout=1.0):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(self.ip or self.fallback_ip, port or self.port), timeout)
            w.close()
            return True
        except Exception:
            return False

    async def reconnect_now(self):
        await self._read_power()
        if self.connected:
            try:
                await self.detect()
            except Exception as e:
                self.log.info("reconnect: %s", e)
        self._changed()
        return self.connected

    async def wake(self):
        """Wake on LAN, for a TV whose port is gone (off, or deep standby). Only if the TV allows it
        (on many Vieras: Network, Network Link Settings, Powered On by Apps; wired works best)."""
        self.quiet_until = 0.0
        self.home_on_wake_until = time.monotonic() + 90
        if not self.mac or not self.wake_on_lan:
            return
        mac = bytes.fromhex(self.mac.replace(":", "").replace("-", ""))
        packet = b"\xff" * 6 + mac * 16
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            for addr in ("255.255.255.255", os.environ.get("TV_BROADCAST", "255.255.255.255"), self.ip or self.fallback_ip):
                for port in (9, 7):
                    try:
                        s.sendto(packet, (addr, port))
                    except (OSError, TypeError):
                        pass
        finally:
            s.close()
