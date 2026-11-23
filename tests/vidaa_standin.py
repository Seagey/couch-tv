"""A stand-in Hisense VIDAA TV for the tests: a small MQTT broker that also plays the TV, and keeps a
log of everything it was sent.

    async with StandIn() as t:
        tv = t.tv()                 # a bridge/vidaa.py VidaaTV pointed at it
        t.statetype = "livetv"      # where the TV is
        t.tile_allowed = False      # newer firmware: the app_install event adds nothing

It answers the topics bridge/vidaa.py uses, in the shapes bridge/vidaa.py expects. Those shapes are
partly our own reading (see PROTOCOL in bridge/vidaa.py), so these tests prove the driver is
consistent with itself and safe with what it sends, NOT that a real TV answers the same way.

The MQTT framing here is written separately from bridge/tinymqtt.py, so a mistake in one is not
copied into the other.
"""
import asyncio
import json
import ssl
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import vidaa  # noqa: E402

PIN = "4821"
TOKEN = "standin-token-7f3a"
REFRESH = "standin-refresh-9c1e"
APPS = [
    {"appId": "1", "name": "Netflix", "url": "netflix", "urlType": 37, "storeType": 0},
    {"appId": "2", "name": "YouTube", "url": "youtube", "urlType": 37, "storeType": 0},
    {"appId": "3", "name": "Prime Video", "url": "amazon", "urlType": 37, "storeType": 0},
    {"appId": "40", "name": "Stan", "url": "https://stan.example/tv", "urlType": 12, "storeType": 1},
    {"appId": "77", "name": "Browser", "url": "browser", "urlType": 12, "storeType": 0},
    {"appId": "90", "name": "Some Local App", "url": "local", "urlType": 12, "storeType": 1},
]


def _str(b):
    return struct.pack(">H", len(b)) + b


def _frame(first, body):
    n, size = len(body), bytearray()
    while True:
        d = n & 0x7F
        n >>= 7
        size.append(d | 0x80 if n else d)
        if not n:
            break
    return bytes([first]) + bytes(size) + body


def _match(flt, topic):
    f, t = flt.split("/"), topic.split("/")
    for i, part in enumerate(f):
        if part == "#":
            return True
        if i >= len(t) or (part != "+" and part != t[i]):
            return False
    return len(f) == len(t)


class StandIn:
    def __init__(self, tls=None):
        self.tls = tls                    # an ssl context for the broker, or None for plain TCP
        self.statetype = "remote_launcher"
        self.apps = [dict(a) for a in APPS]
        self.tile_allowed = True
        self.refuse = None                # a CONNACK code to refuse every login with
        self.want_token = False           # refuse (5) a login whose password is not the token
        self.issue_token = False          # like a 43A6N (#145): push tokenissuance after the PIN, answer no gettoken
        self.silent = set()               # action names the TV does not answer
        self.log = []                     # (topic, payload text) of everything the bridge published
        self.logins = []                  # (client id, user, password)
        self.pin_shown = False
        self.pin_ok = False
        self._clients = []                # (writer, client id, [filters])
        self._server = None
        self.port = None

    async def __aenter__(self):
        self._server = await asyncio.start_server(self._client, "127.0.0.1", 0, ssl=self.tls)
        self.port = self._server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *_):
        for w, _, _ in self._clients:
            w.close()
        self._server.close()
        await self._server.wait_closed()

    def tv(self, **cfg):
        t = vidaa.VidaaTV({"id": "lounge", "name": "Lounge", "kind": "vidaa", "ip": "127.0.0.1",
                           "port": self.port, "tls": self.tls is not None, "mac": "", **cfg})
        t.ip = "127.0.0.1"
        t.connected = True
        return t

    def sent(self, name):
        """Payloads the bridge sent to an action (the last topic level)."""
        return [p for topic, p in self.log if topic.rsplit("/", 1)[-1] == name]

    # ---------- the broker ----------
    async def _read(self, r):
        first = (await r.readexactly(1))[0]
        n, mult = 0, 1
        while True:
            d = (await r.readexactly(1))[0]
            n += (d & 0x7F) * mult
            mult *= 128
            if not d & 0x80:
                break
        return first, await r.readexactly(n) if n else b""

    async def _client(self, r, w):
        entry = [w, None, []]
        try:
            first, body = await self._read(r)
            assert first == 0x10, "the first packet must be CONNECT"
            plen = struct.unpack(">H", body[:2])[0]
            pos = 2 + plen + 1
            flags = body[pos]
            pos += 3
            fields = []
            while pos < len(body):
                ln = struct.unpack(">H", body[pos:pos + 2])[0]
                fields.append(body[pos + 2:pos + 2 + ln].decode())
                pos += 2 + ln
            cid = fields.pop(0)
            user = fields.pop(0) if flags & 0x80 else None
            pw = fields.pop(0) if flags & 0x40 else None
            self.logins.append((cid, user, pw))
            code = self.refuse or (5 if self.want_token and pw != TOKEN else 0)
            w.write(bytes([0x20, 2, 0, code]))
            await w.drain()
            if code:
                w.close()
                return
            entry[1] = cid
            self._clients.append(entry)
            while True:
                first, body = await self._read(r)
                kind = first & 0xF0
                if kind == 0x80:   # SUBSCRIBE
                    pid, pos, codes = body[:2], 2, b""
                    while pos < len(body):
                        ln = struct.unpack(">H", body[pos:pos + 2])[0]
                        entry[2].append(body[pos + 2:pos + 2 + ln].decode())
                        pos += 3 + ln
                        codes += b"\x00"
                    w.write(_frame(0x90, pid + codes))
                elif kind == 0x30:
                    ln = struct.unpack(">H", body[:2])[0]
                    await self._published(cid, body[2:2 + ln].decode(), body[2 + ln:].decode())
                elif kind == 0xC0:
                    w.write(bytes([0xD0, 0]))
                elif kind == 0x40:
                    pass   # PUBACK for a QoS 1 message we sent
                elif kind == 0xE0:
                    break
                await w.drain()
        except (asyncio.IncompleteReadError, ConnectionError, AssertionError):
            pass
        finally:
            if entry in self._clients:
                self._clients.remove(entry)
            w.close()

    async def send(self, topic, payload, qos=0):
        """Publish to every client subscribed to the topic (QoS 1 too, to test the acknowledgement)."""
        data = payload if isinstance(payload, str) else json.dumps(payload)
        for w, _, filters in list(self._clients):
            if any(_match(f, topic) for f in filters):
                head = (0x32, _str(topic.encode()) + b"\x00\x07") if qos else (0x30, _str(topic.encode()))
                w.write(_frame(head[0], head[1] + data.encode()))
                await w.drain()

    async def broadcast_state(self, statetype):
        self.statetype = statetype
        await self.send("/remoteapp/mobile/broadcast/ui_service/state", {"statetype": statetype}, qos=1)

    # ---------- the TV ----------
    async def _published(self, cid, topic, text):
        self.log.append((topic, text))
        name = topic.rsplit("/", 1)[-1]
        if name in self.silent:
            return
        try:
            data = json.loads(text)
        except ValueError:
            data = text
        mine = f"/remoteapp/mobile/{cid}"
        if name == "gettvstate":
            await self.send(f"{mine}/ui_service/data/state", {"statetype": self.statetype})
        elif name == "applist":
            await self.send(f"{mine}/ui_service/data/applist", self.apps)
        elif name == "launchapp":
            self.statetype = "app"   # what a real TV says here is unknown
        elif name == "sendkey":
            if data == "KEY_POWER":
                self.statetype = "remote_launcher" if self.statetype in vidaa.OFF_STATES else "fake_sleep_0"
            elif data == "KEY_HOME":
                self.statetype = "remote_launcher"
        elif name == "vidaa_app_connect":
            self.pin_shown = True
        elif name == "authenticationcode":
            # a real VIDAA 9 TV wants the PIN as a number: a string is refused (PR #128)
            num = data.get("authNum") if isinstance(data, dict) else None
            self.pin_ok = self.pin_shown and isinstance(num, int) and num == int(PIN)
            await self.send(f"{mine}/ui_service/data/authenticationcode", {"result": 1 if self.pin_ok else 0})
            if self.pin_ok and self.issue_token:
                await self.send(f"{mine}/platform_service/data/tokenissuance",
                                {"accesstoken": TOKEN, "refreshtoken": REFRESH, "refresh_token": REFRESH,
                                 "accesstoken_duration_day": 7})
        elif name == "gettoken" and self.issue_token:
            pass
        elif name == "gettoken":
            await self.send(f"{mine}/platform_service/data/gettoken", {"accesstoken": TOKEN} if self.pin_ok else {})
        elif name == "uievent" and isinstance(data, dict) and data.get("type") == "app_install" and self.tile_allowed:
            info = data.get("app_info") or {}
            self.apps.append({"appId": info.get("Id"), "name": info.get("Title"), "url": info.get("URL"),
                              "urlType": 12, "storeType": info.get("StoreType")})


def tls_pair(folder):
    """A throwaway self-signed certificate and key (needs the openssl command), for both ends."""
    import subprocess
    cert, key = str(Path(folder) / "c.pem"), str(Path(folder) / "k.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=standin",
                    "-keyout", key, "-out", cert], check=True, capture_output=True)
    return cert, key


def server_tls(cert, key, client_cert=None):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    if client_cert:
        ctx.verify_mode = ssl.CERT_REQUIRED
        ctx.load_verify_locations(client_cert)
    return ctx
