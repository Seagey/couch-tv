"""A stand-in Panasonic Viera for the tests: a small web server that answers the SOAP requests on port 55000
the way the public descriptions of the protocol say a Viera does, plays the browser's hand off over TCP,
and keeps a log of everything it was sent.

    async with StandIn() as t:
        tv = t.tv()                 # a bridge/panasonic.py PanasonicTV pointed at it
        t.encrypted = True          # a 2018 on set: pairing with a PIN, every command sealed
        t.volume = 30

It answers only what the driver uses, in the shapes PROTOCOL in bridge/panasonic.py describes. Those are
partly UNCONFIRMED, so these tests prove the driver is consistent with itself and safe with what it sends,
NOT that a real TV answers the same way.

The cipher here is written separately from bridge/panasonic.py, from the same description, so a mistake
in one is not copied into the other.
"""
import asyncio
import base64
import hashlib
import hmac
import os
import re
import struct
import sys
from pathlib import Path

from aiohttp import web
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import panasonic  # noqa: E402

PIN = "5719"
APP_ID = "standin-app-id-0042"
KEYWORD = base64.b64encode(bytes(range(40, 56))).decode()   # the session key word the TV gives out
CHALLENGE = bytes(range(200, 216))
SESSION = "778899"
MASK = "15C95AC2B08AA7EB4E228F811E34D04FA54BA7DCAC9879FA8ACDA3FC244F3854"
APPS = ("vc_app'product_id=0010000200000001'Netflix'http://192.0.2.9/icons/netflix.png'"
        "vc_app'product_id=0070000200180001'YouTube'http://192.0.2.9/icons/yt.png'"
        "vc_app'product_id=0387878700000032'Prime Video'http://192.0.2.9/icons/prime.png'"
        "vc_app'product_id=0076010507000001'Some Local App''"
        "vc_app'resource_id=1063'Web Browser''")
NRC = "urn:panasonic-com:service:p00NetworkControl:1"
DMR = "urn:schemas-upnp-org:service:RenderingControl:1"
PAC = "urn:panasonic-com:service:p00PanaControl:1"   # stand-in only: the driver reads it from ddd.xml


def _tag(xml, tag):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.S)
    return m.group(1) if m else None


def _pair_keys(ch):
    key = b"".join(bytes(255 - x for x in ch[g:g + 4][::-1]) for g in (0, 4, 8, 12))
    mask = bytes.fromhex(MASK)
    pick = [2, 3, 0, 1]
    hk = bytes(mask[i] ^ ch[(4 * (i // 4) + pick[i % 4]) & 15] for i in range(32))
    return key, hk, ch


def _session_keys():
    iv = base64.b64decode(KEYWORD)
    key = b"".join(bytes([iv[g + 2], iv[g + 3], iv[g], iv[g + 1]]) for g in (0, 4, 8, 12))
    return key, iv * 2, iv


def _open(b64, key, hk, iv):
    raw = base64.b64decode(b64)
    ct, sig = raw[:-32], raw[-32:]
    assert hmac.new(hk, ct, hashlib.sha256).digest() == sig, "bad HMAC"
    d = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    plain = d.update(ct) + d.finalize()
    (n,) = struct.unpack(">I", plain[12:16])
    return plain[16:16 + n].decode()


def _close(text, key, hk, iv):
    data = text.encode()
    plain = os.urandom(12) + struct.pack(">I", len(data)) + data
    plain += bytes(16 - len(plain) % 16)
    e = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ct = e.update(plain) + e.finalize()
    return base64.b64encode(ct + hmac.new(hk, ct, hashlib.sha256).digest()).decode()


def _answer(action, urn, inner=""):
    return web.Response(content_type="text/xml", text=(
        '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
        f'<u:{action}Response xmlns:u="{urn}">{inner}</u:{action}Response></s:Body></s:Envelope>'))


def _fault(code, text="error"):
    return web.Response(status=500, content_type="text/xml", text=(
        '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>'
        '<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>'
        f'<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>{code}</errorCode>'
        f'<errorDescription>{text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>'))


class StandIn:
    def __init__(self):
        self.encrypted = False
        self.volume, self.muted = 20, False
        self.log = []                 # (action, inner body) of every command, decrypted on an encrypted set
        self.raw = []                 # every request body exactly as it came, sealed or not
        self.sequences = []           # X_SequenceNumber of each sealed command
        self.urls = []                # what the browser hand off delivered (head, length, address, tail)
        self.refuse = {}              # action -> errorCode to answer it with
        self.session_ok = True        # False: the next sealed command is refused once (a session ran out)
        self.connect_back = True      # False: the TV never comes for the address
        self.pin_shown = False
        self._challenge = None
        self._runner = None
        self.port = None

    async def __aenter__(self):
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self._handle)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        await self._runner.cleanup()

    def tv(self, **cfg):
        t = panasonic.PanasonicTV({"id": "lounge", "name": "Lounge", "kind": "panasonic", "ip": "127.0.0.1",
                                   "port": self.port, "mac": "", **cfg})
        t.ip = "127.0.0.1"
        t.connected = True
        t._checked = True
        return t

    def sent(self, action):
        return [b for a, b in self.log if a == action]

    # ---------- the web server ----------
    async def _handle(self, request):
        path = request.match_info["path"]
        if request.method == "GET" and path == "nrc/ddd.xml":
            return web.Response(content_type="text/xml", text=(
                '<?xml version="1.0"?><root><device><friendlyName>Stand-in Viera</friendlyName>'
                '<modelName>Viera</modelName><modelNumber>TX-55STANDIN</modelNumber><serviceList>'
                f'<service><serviceType>{NRC}</serviceType><controlURL>/nrc/control_0</controlURL></service>'
                f'<service><serviceType>{DMR}</serviceType><controlURL>/dmr/control_0</controlURL></service>'
                f'<service><serviceType>{PAC}</serviceType><controlURL>/pac/control_0</controlURL></service>'
                '</serviceList></device></root>'))
        if request.method == "GET" and path == "nrc/sdd_0.xml":
            names = ["X_SendKey", "X_LaunchApp", "X_GetAppList", "X_ConnectApp"]
            if self.encrypted:
                names += ["X_DisplayPinCode", "X_RequestAuth", "X_GetEncryptSessionId", "X_EncryptedCommand"]
            return web.Response(content_type="text/xml", text="<scpd><actionList>" + "".join(
                f"<action><name>{n}</name></action>" for n in names) + "</actionList></scpd>")
        if request.method != "POST" or path not in ("nrc/control_0", "dmr/control_0", "pac/control_0"):
            return web.Response(status=404)
        body = await request.text()
        self.raw.append(body)
        soap = request.headers.get("SOAPAction", "").strip('"')
        urn, _, action = soap.partition("#")
        m = re.search(rf"<u:{action} xmlns:u=\"{re.escape(urn)}\">(.*)</u:{action}>", body, re.S)
        if not m:
            return _fault(401, "Invalid Action")
        args = m.group(1)
        if action in self.refuse:
            self.log.append((action, args))
            return _fault(self.refuse[action])
        if path == "dmr/control_0":
            return self._dmr(action, args)
        if path == "pac/control_0":
            self.log.append((action, args))
            return _answer(action, PAC)
        if action == "X_DisplayPinCode":
            self.pin_shown = True
            self._challenge = CHALLENGE
            return _answer(action, NRC, f"<X_ChallengeKey>{base64.b64encode(CHALLENGE).decode()}</X_ChallengeKey>")
        if action == "X_RequestAuth":
            k = _pair_keys(self._challenge)
            if _tag(_open(_tag(args, "X_AuthInfo"), *k), "X_PinCode") != PIN:
                return _fault(600, "Invalid Pincode")
            res = _close(f"<X_ApplicationId>{APP_ID}</X_ApplicationId><X_Keyword>{KEYWORD}</X_Keyword>", *k)
            return _answer(action, NRC, f"<X_AuthResult>{res}</X_AuthResult>")
        if action == "X_GetEncryptSessionId":
            k = _session_keys()
            assert _tag(args, "X_ApplicationId") == APP_ID
            assert _tag(_open(_tag(args, "X_EncInfo"), *k), "X_ApplicationId") == APP_ID
            self.session_ok = True
            return _answer(action, NRC, "<X_EncResult>" + _close(f"<X_SessionId>{SESSION}</X_SessionId>", *k)
                           + "</X_EncResult>")
        if action == "X_EncryptedCommand":
            if _tag(args, "X_ApplicationId") != APP_ID:
                return _fault(401, "Unknown application")
            if not self.session_ok:
                self.session_ok = True
                return _fault(403, "Session expired")
            k = _session_keys()
            inner = _open(_tag(args, "X_EncInfo"), *k)
            if _tag(inner, "X_SessionId") != SESSION:
                return _fault(403, "Bad session")
            self.sequences.append(_tag(inner, "X_SequenceNumber"))
            m = re.search(r"<X_OriginalCommand><u:(\w+) xmlns:u=\"[^\"]+\">(.*)</u:\1></X_OriginalCommand>", inner, re.S)
            res = await self._nrc(m.group(1), m.group(2))
            return _answer(action, NRC, "<X_EncResult>" + _close(res, *k) + "</X_EncResult>")
        if self.encrypted:
            return _fault(401, "Encryption required")
        return _answer(action, NRC, await self._nrc(action, args))

    async def _nrc(self, action, args):
        """One remote command (already unsealed); the inner XML of the answer."""
        self.log.append((action, args))
        if action == "X_GetAppList":
            return "<X_AppList>" + APPS.replace("'", "&apos;") + "</X_AppList>"
        if action == "X_ConnectApp" and self.connect_back:
            host, port = _tag(args, "X_ConnectAddr").rsplit(":", 1)
            asyncio.get_running_loop().create_task(self._fetch_url(host, int(port)))
        return ""

    async def _fetch_url(self, host, port):
        r, w = await asyncio.open_connection(host, port)
        data = await r.read()
        w.close()
        n = data[7]
        self.urls.append((data[:7], n, data[8:8 + n].decode(), data[8 + n:]))

    def _dmr(self, action, args):
        self.log.append((action, args))
        if action == "GetVolume":
            return _answer(action, DMR, f"<CurrentVolume>{self.volume}</CurrentVolume>")
        if action == "GetMute":
            return _answer(action, DMR, f"<CurrentMute>{1 if self.muted else 0}</CurrentMute>")
        if action == "SetVolume":
            self.volume = int(_tag(args, "DesiredVolume"))
        elif action == "SetMute":
            self.muted = _tag(args, "DesiredMute") == "1"
        return _answer(action, DMR)
