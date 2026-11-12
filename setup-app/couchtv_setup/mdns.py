"""A small mDNS (Bonjour) browser, enough to hear what TVs on the Wi-Fi announce:
- `_adb-tls-pairing._tcp`: the port of "Pair device with pairing code" (only while that screen is open)
- `_adb-tls-connect._tcp`: the Wireless debugging port (changes after every restart)
- `_androidtvremote2._tcp`: any Google TV or Android TV, with the name the TV gives itself

It only asks and listens: nothing on the TV changes. Written for couch-tv so the app needs no
LGPL library (python-zeroconf) inside it. One question goes out as multicast with the "answer me
directly" bit set, from a random port, and a second socket listens on 5353 for the answers that are
multicast anyway.
"""
import socket
import struct
import time

GROUP, PORT = "224.0.0.251", 5353
PTR, TXT, SRV, A = 12, 16, 33, 1


def _name_bytes(name):
    out = b""
    for label in name.rstrip(".").split("."):
        raw = label.encode()
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def query(services):
    """One DNS question per service, PTR, class IN with the unicast response bit."""
    msg = struct.pack(">6H", 0, 0, len(services), 0, 0, 0)
    for s in services:
        msg += _name_bytes(s) + struct.pack(">HH", PTR, 0x8001)
    return msg


def _read_name(buf, off, depth=0):
    labels = []
    while True:
        if off >= len(buf) or depth > 20:
            raise ValueError("bad name")
        n = buf[off]
        if n == 0:
            return ".".join(labels), off + 1
        if n & 0xC0 == 0xC0:
            ptr = struct.unpack(">H", buf[off:off + 2])[0] & 0x3FFF
            rest, _ = _read_name(buf, ptr, depth + 1)
            labels.append(rest)
            return ".".join(x for x in labels if x), off + 2
        labels.append(buf[off + 1:off + 1 + n].decode(errors="replace"))
        off += 1 + n


def parse(buf):
    """Every answer and additional record in one mDNS packet, as (name, type, value)."""
    out = []
    try:
        _, flags, qd, an, ns, ar = struct.unpack(">6H", buf[:12])
        off = 12
        for _ in range(qd):
            _, off = _read_name(buf, off)
            off += 4
        for _ in range(an + ns + ar):
            name, off = _read_name(buf, off)
            rtype, _, _, rdlen = struct.unpack(">HHIH", buf[off:off + 10])
            off += 10
            rdata = buf[off:off + rdlen]
            if rtype == PTR:
                value = _read_name(buf, off)[0]
            elif rtype == SRV:
                _, _, port = struct.unpack(">HHH", rdata[:6])
                value = (port, _read_name(buf, off + 6)[0])
            elif rtype == A and rdlen == 4:
                value = socket.inet_ntoa(rdata)
            elif rtype == TXT:
                value = rdata
            else:
                value = None
            off += rdlen
            if value is not None:
                out.append((name.lower(), rtype, value))
    except (ValueError, struct.error, IndexError):
        pass
    return out


def _sockets():
    socks = []
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
    s.bind(("", 0))
    socks.append(s)
    try:
        m = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        m.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            m.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        m.bind(("", PORT))
        m.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP) + socket.inet_aton("0.0.0.0"))
        socks.append(m)
    except OSError:
        pass   # someone holds 5353 alone (some Windows set ups): the direct answers still come
    return socks


def browse(services, wait=3.0):
    """Asks for each service and returns what answered: a list of
    {"service", "instance", "ip", "port", "name"} (name is the instance's own label)."""
    services = [s.rstrip(".") + "." if not s.endswith(".") else s for s in services]
    wanted = [s.rstrip(".").lower() for s in services]
    records = []
    socks = _sockets()
    try:
        q = query([s.rstrip(".") for s in services])
        socks[0].sendto(q, (GROUP, PORT))
        end, resent = time.time() + wait, False
        import select
        while time.time() < end:
            if not resent and time.time() > end - wait / 2:
                socks[0].sendto(q, (GROUP, PORT))
                resent = True
            ready, _, _ = select.select(socks, [], [], 0.2)
            for s in ready:
                try:
                    buf, src = s.recvfrom(9000)
                except OSError:
                    continue
                records += [r + (src[0],) for r in parse(buf)]
    finally:
        for s in socks:
            s.close()
    return resolve(records, wanted)


def resolve(records, wanted):
    ptrs = {}
    srv, addr = {}, {}
    sender = {}
    for name, rtype, value, src in records:
        if rtype == PTR and name in wanted:
            ptrs.setdefault(value.lower(), (name, value))
        elif rtype == SRV:
            srv[name] = value
            sender.setdefault(name, src)
        elif rtype == A:
            addr.setdefault(name, value)
    found = []
    for inst, (service, original) in ptrs.items():
        if inst not in srv:
            continue
        port, target = srv[inst]
        ip = addr.get(target.lower()) or sender.get(inst)
        label = original[:-len(service) - 1] if inst.endswith("." + service) else original
        found.append({"service": service, "instance": inst, "ip": ip, "port": port, "name": label})
    return found
