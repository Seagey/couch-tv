"""A small mDNS (Bonjour) browser, enough to hear what TVs on the Wi-Fi announce:
- `_adb-tls-pairing._tcp`: the port of "Pair device with pairing code" (only while that screen is open)
- `_adb-tls-connect._tcp`: the Wireless debugging port (changes after every restart)
- `_androidtvremote2._tcp`: any Google TV or Android TV, with the name the TV gives itself
- `_googlecast._tcp`: the same TVs again, with the name (TXT `fn`) and model (TXT `md`) in its TXT record
- `_adb._tcp`: older Android TVs that announce plain ADB (port 5555)

It only asks and listens: nothing on the TV changes. Written for couch-tv so the app needs no
LGPL library (python-zeroconf) inside it. One question goes out as multicast with the "answer me
directly" bit set, from a random port, and a second socket listens on 5353 for the answers that are
multicast anyway.
"""
import select
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


def _open_sender(iface_ip=None):
    """A socket the question goes out from. With an address it is tied to that network card
    (IP_MULTICAST_IF), so a computer on Wi-Fi and Ethernet asks on both."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        if iface_ip:
            s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(iface_ip))
            s.bind((iface_ip, 0))
        else:
            s.bind(("", 0))
    except OSError:
        s.close()
        raise
    return s


def _open_listener(ifaces):
    """The socket on 5353 that hears multicast answers, joined to the group on every network card."""
    m = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        m.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            m.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        m.bind(("", PORT))
        joined = 0
        for ip in list(ifaces) or ["0.0.0.0"]:
            try:
                m.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP) + socket.inet_aton(ip))
                joined += 1
            except OSError:
                pass
        if not joined:
            m.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, socket.inet_aton(GROUP) + socket.inet_aton("0.0.0.0"))
        return m
    except OSError:
        m.close()
        return None   # someone holds 5353 alone (some Windows set ups): the direct answers still come


def _sockets(ifaces):
    """(senders, listeners): one sender per network card (or one on the default route when no card
    could be listed or opened), and the 5353 listener when it can be had."""
    senders = []
    for ip in ifaces:
        try:
            senders.append(_open_sender(ip))
        except OSError:
            pass
    if not senders:
        senders.append(_open_sender(None))
    listener = _open_listener(ifaces)
    return senders, ([listener] if listener else [])


def send(sock, q):
    """Sends the question to the mDNS group. A failure keeps where it was going (`dest`), so the page
    can tell a Mac's Local Network block (errors.py) from anything else."""
    try:
        sock.sendto(q, (GROUP, PORT))
    except OSError as e:
        e.dest = GROUP
        raise


def questions(pairs):
    """One packet asking for each (name, type): PTR, SRV, TXT or A, class IN with the unicast bit."""
    msg = struct.pack(">6H", 0, 0, len(pairs), 0, 0, 0)
    for name, rtype in pairs:
        msg += _name_bytes(name) + struct.pack(">HH", rtype, 0x8001)
    return msg


def unresolved(records, wanted):
    """What a TV announced but did not finish saying: ([instance names with no SRV or TXT yet],
    [host names with no address yet]). Those are asked for directly."""
    ptrs, srv, txts, addr = set(), {}, set(), set()
    for name, rtype, value, _ in records:
        if rtype == PTR and name in wanted:
            ptrs.add(value.lower())
        elif rtype == SRV:
            srv[name] = value
        elif rtype == TXT:
            txts.add(name)
        elif rtype == A:
            addr.add(name)
    need_inst = sorted(i for i in ptrs if i not in srv or i not in txts)
    need_host = sorted({srv[i][1].lower() for i in ptrs if i in srv and srv[i][1].lower() not in addr})
    return need_inst, need_host


def follow_up(records, wanted, per_packet=12):
    """The direct questions for what is still missing, as packets (none when nothing is)."""
    need_inst, need_host = unresolved(records, wanted)
    pairs = [(i, t) for i in need_inst for t in (SRV, TXT)] + [(h, A) for h in need_host]
    return [questions(pairs[i:i + per_packet]) for i in range(0, len(pairs), per_packet)]


last_info = {}   # what the latest browse did (for the scan log): cards used, rounds, direct questions


def browse(services, wait=3.0, ifaces=None):
    """Asks for each service and returns what answered: a list of
    {"service", "instance", "ip", "port", "name"} (name is the instance's own label).
    The question goes out three times across `wait`, from every network card of this computer. From the
    second time on, a TV heard saying only "I am here" is asked directly for its port, name and
    address, so one lost reply does not hide it. What happened is left in `last_info`."""
    services = [s.rstrip(".") + "." if not s.endswith(".") else s for s in services]
    wanted = [s.rstrip(".").lower() for s in services]
    if ifaces is None:
        try:
            from . import netinfo
            ifaces = netinfo.own_ipv4s()
        except Exception:
            ifaces = []
    records = []
    senders, listeners = _sockets(ifaces)
    stats = {}
    stats.update({"interfaces": len(senders), "rounds": 0, "followups": 0, "send_errors": 0})
    try:
        q = query([s.rstrip(".") for s in services])
        start = time.monotonic()
        schedule, nxt, ever_sent = [0.0, wait / 3, 2 * wait / 3], 0, False
        while True:
            now = time.monotonic() - start
            if nxt < len(schedule) and now >= schedule[nxt]:
                packets = [q] + (follow_up(records, wanted) if nxt else [])
                stats["followups"] += len(packets) - 1
                last_err = None
                for sock in senders:
                    for pkt in packets:
                        try:
                            send(sock, pkt)
                            ever_sent = True
                        except OSError as e:
                            last_err = e
                            stats["send_errors"] += 1
                if last_err is not None and not ever_sent:
                    raise last_err   # every card failed: the caller can tell a Local Network block
                nxt += 1
                stats["rounds"] = nxt
                continue
            if now >= wait:
                break
            ready, _, _ = select.select(senders + listeners, [], [], 0.2)
            for s in ready:
                try:
                    buf, src = s.recvfrom(9000)
                except OSError:
                    continue
                records += [r + (src[0],) for r in parse(buf)]
    finally:
        for s in senders + listeners:
            s.close()
    found = resolve(records, wanted)
    stats["heard"] = len(found)
    stats["unresolved"] = len(unresolved(records, wanted)[0])
    last_info.clear()
    last_info.update(stats)
    return found


def txt(rdata):
    """A TXT record's key=value strings as a dict ({"fn": "Living room TV", "md": "..."}). Keys are
    lower case; a key with no "=" gets "". Anything that does not decode is skipped."""
    out = {}
    off = 0
    while off < len(rdata):
        n = rdata[off]
        part = rdata[off + 1:off + 1 + n]
        off += 1 + n
        if not part:
            continue
        s = part.decode("utf-8", "replace")
        k, _, v = s.partition("=")
        k = k.strip().lower()
        if k and k not in out:
            out[k] = v[:100]
    return out


def resolve(records, wanted):
    ptrs = {}
    srv, addr, texts = {}, {}, {}
    sender = {}
    for name, rtype, value, src in records:
        if rtype == PTR and name in wanted:
            ptrs.setdefault(value.lower(), (name, value))
        elif rtype == SRV:
            srv[name] = value
            sender.setdefault(name, src)
        elif rtype == A:
            addr.setdefault(name, value)
        elif rtype == TXT and isinstance(value, (bytes, bytearray)):
            texts.setdefault(name, txt(bytes(value)))
    found = []
    for inst, (service, original) in ptrs.items():
        if inst not in srv:
            continue
        port, target = srv[inst]
        ip = addr.get(target.lower()) or sender.get(inst)
        label = original[:-len(service) - 1] if inst.endswith("." + service) else original
        found.append({"service": service, "instance": inst, "ip": ip, "port": port, "name": label,
                      "txt": texts.get(inst, {})})
    return found
