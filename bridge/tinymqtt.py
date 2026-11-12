"""A small MQTT 3.1.1 client on asyncio, for bridge/vidaa.py.

It does only what a Hisense VIDAA TV needs from a phone remote: connect (over TLS, with or without a
client certificate), subscribe at QoS 0, publish at QoS 0, answer QoS 1 messages with an
acknowledgement, and keep the connection alive with pings. Written from the MQTT 3.1.1 standard
(OASIS, 2014), sections 2 and 3. No retained messages, no QoS 2, no will message, no reconnecting by
itself: bridge/vidaa.py decides when to connect again.

    c = Client("couchtv-1a2b3c", on_message=lambda topic, payload: ...)
    await c.connect("192.0.2.30", 36669, ssl=context)
    await c.subscribe(["/some/topic/#"])
    await c.publish("/some/topic", "hello")
    await c.close()
"""
import asyncio
import logging
import struct

log = logging.getLogger("tinymqtt")

# Packet types (MQTT 3.1.1, section 2.2.1), shifted into the top four bits of the first byte.
CONNECT, CONNACK, PUBLISH, PUBACK = 0x10, 0x20, 0x30, 0x40
SUBSCRIBE, SUBACK, PINGREQ, PINGRESP, DISCONNECT = 0x82, 0x90, 0xC0, 0xD0, 0xE0

# The broker's answer to CONNECT (section 3.2.2.3), in plain words.
REFUSED = {
    1: "it does not speak this MQTT version",
    2: "it refused the client id",
    3: "its MQTT service is unavailable",
    4: "it refused the user name or password",
    5: "it said this client is not authorised",
}

# Nothing a TV sends is this big; anything larger is a broken stream, not a message.
MAX_PACKET = 4 * 1024 * 1024


class MQTTError(ConnectionError):
    """The broker refused, closed or broke the connection."""


class Refused(MQTTError):
    def __init__(self, code):
        self.code = code
        super().__init__(f"the TV refused the connection: {REFUSED.get(code, f'code {code}')}")


def _text(s):
    b = s.encode("utf-8") if isinstance(s, str) else bytes(s)
    if len(b) > 0xFFFF:
        raise ValueError("an MQTT string is at most 65535 bytes")
    return struct.pack("!H", len(b)) + b


def _length(n):
    """The remaining length, 7 bits per byte, the top bit saying another byte follows (2.2.3)."""
    if n < 0 or n > 268435455:
        raise ValueError("packet too large for MQTT")
    out = bytearray()
    while True:
        byte, n = n % 128, n // 128
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def packet(first, body=b""):
    return bytes([first]) + _length(len(body)) + body


def connect_packet(client_id, username=None, password=None, keepalive=30):
    flags = 0x02   # clean session
    if username is not None:
        flags |= 0x80
    if password is not None:
        flags |= 0x40
    body = _text("MQTT") + bytes([4, flags]) + struct.pack("!H", keepalive) + _text(client_id)
    if username is not None:
        body += _text(username)
    if password is not None:
        body += _text(password)
    return packet(CONNECT, body)


def publish_packet(topic, payload):
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    return packet(PUBLISH, _text(topic) + payload)   # QoS 0: no packet id


def subscribe_packet(packet_id, topics):
    body = struct.pack("!H", packet_id) + b"".join(_text(t) + b"\x00" for t in topics)
    return packet(SUBSCRIBE, body)


async def read_packet(reader):
    """(first byte, body) of the next packet."""
    first = (await reader.readexactly(1))[0]
    n, shift = 0, 0
    for _ in range(4):
        b = (await reader.readexactly(1))[0]
        n += (b & 0x7F) << shift
        shift += 7
        if not b & 0x80:
            break
    else:
        raise MQTTError("a packet length longer than MQTT allows")
    if n > MAX_PACKET:
        raise MQTTError(f"a packet of {n} bytes, larger than any TV message")
    return first, (await reader.readexactly(n)) if n else b""


def parse_publish(first, body):
    """(topic, payload, packet id or None) of a PUBLISH body."""
    if len(body) < 2:
        raise MQTTError("a PUBLISH with no topic")
    tlen = struct.unpack("!H", body[:2])[0]
    topic = body[2:2 + tlen].decode("utf-8", "replace")
    rest = body[2 + tlen:]
    qos = (first >> 1) & 0x03
    pid = None
    if qos:
        if len(rest) < 2:
            raise MQTTError("a PUBLISH with QoS and no packet id")
        pid, rest = struct.unpack("!H", rest[:2])[0], rest[2:]
    return topic, rest, pid


class Client:
    def __init__(self, client_id, username=None, password=None, keepalive=30, on_message=None):
        self.client_id = client_id
        self.username = username
        self.password = password
        self.keepalive = keepalive
        self.on_message = on_message
        self._reader = self._writer = None
        self._tasks = []
        self._pid = 0
        self._subacks = {}
        self._write_lock = asyncio.Lock()
        self._last_in = 0.0
        self.closed_because = None   # why the connection ended, in plain words

    @property
    def alive(self):
        return self._writer is not None and not self._writer.is_closing()

    async def connect(self, host, port, ssl=None, timeout=6):
        loop = asyncio.get_running_loop()
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, ssl=ssl, server_hostname="" if ssl else None), timeout)
        except asyncio.TimeoutError:
            raise MQTTError(f"no answer on port {port}") from None
        try:
            self._writer.write(connect_packet(self.client_id, self.username, self.password, self.keepalive))
            await self._writer.drain()
            first, body = await asyncio.wait_for(read_packet(self._reader), timeout)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, OSError) as e:
            await self._drop()
            raise MQTTError(f"the TV closed the connection before it answered ({type(e).__name__})") from None
        if first & 0xF0 != CONNACK or len(body) < 2:
            await self._drop()
            raise MQTTError("the TV answered with something that is not an MQTT CONNACK")
        if body[1] != 0:
            await self._drop()
            raise Refused(body[1])
        self._last_in = loop.time()
        self.closed_because = None
        self._tasks = [asyncio.create_task(self._read_loop()), asyncio.create_task(self._ping_loop())]

    async def _send(self, data):
        if not self.alive:
            raise MQTTError(self.closed_because or "not connected")
        async with self._write_lock:
            try:
                self._writer.write(data)
                await self._writer.drain()
            except (OSError, ConnectionError) as e:
                self.closed_because = f"the connection broke ({type(e).__name__})"
                await self._drop()
                raise MQTTError(self.closed_because) from None

    async def subscribe(self, topics, timeout=6):
        self._pid = self._pid % 0xFFFF + 1
        pid = self._pid
        fut = asyncio.get_running_loop().create_future()
        self._subacks[pid] = fut
        try:
            await self._send(subscribe_packet(pid, topics))
            codes = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise MQTTError("the TV did not confirm the subscription") from None
        finally:
            self._subacks.pop(pid, None)
        if any(c == 0x80 for c in codes):
            raise MQTTError("the TV refused a subscription")
        return codes

    async def publish(self, topic, payload):
        await self._send(publish_packet(topic, payload))

    async def _read_loop(self):
        loop = asyncio.get_running_loop()
        try:
            while True:
                first, body = await read_packet(self._reader)
                self._last_in = loop.time()
                kind = first & 0xF0
                if kind == PUBLISH:
                    topic, payload, pid = parse_publish(first, body)
                    if pid is not None:   # QoS 1: acknowledge it (QoS 2 is not used by this client)
                        await self._send(packet(PUBACK, struct.pack("!H", pid)))
                    if self.on_message:
                        try:
                            self.on_message(topic, payload)
                        except Exception:
                            log.exception("message handler failed for %s", topic)
                elif kind == SUBACK and len(body) >= 2:
                    fut = self._subacks.get(struct.unpack("!H", body[:2])[0])
                    if fut and not fut.done():
                        fut.set_result(list(body[2:]))
                # PINGRESP and anything else only mark the connection as alive
        except asyncio.CancelledError:
            raise
        except (asyncio.IncompleteReadError, OSError, ConnectionError):
            self.closed_because = self.closed_because or "the TV closed the connection"
        except MQTTError as e:
            self.closed_because = str(e)
        await self._drop(cancel_reader=False)

    async def _ping_loop(self):
        loop = asyncio.get_running_loop()
        every = max(2, self.keepalive / 2)
        try:
            while self.alive:
                await asyncio.sleep(every)
                if loop.time() - self._last_in > self.keepalive * 1.5:
                    self.closed_because = "the TV stopped answering"
                    await self._drop()
                    return
                await self._send(packet(PINGREQ))
        except asyncio.CancelledError:
            raise
        except MQTTError:
            pass

    async def _drop(self, cancel_reader=True):
        w, self._writer = self._writer, None
        if w is not None:
            try:
                w.close()
            except Exception:
                pass
        me = asyncio.current_task()
        for t in self._tasks:
            if t is not me and (cancel_reader or t is not self._tasks[0]):
                t.cancel()
        for fut in self._subacks.values():
            if not fut.done():
                fut.set_exception(MQTTError(self.closed_because or "the connection closed"))

    async def close(self):
        if self.alive:
            try:
                async with self._write_lock:
                    self._writer.write(packet(DISCONNECT))
                    await self._writer.drain()
            except Exception:
                pass
        self.closed_because = self.closed_because or "closed by the bridge"
        await self._drop()
