"""This computer's own IPv4 addresses and netmasks, read from the system's interface listing
(ifconfig, `ip addr` or ipconfig). It only reads what the computer already knows about itself:
nothing is sent on the network.

Kept apart from finder.py so mdns.py can use it too (finder imports mdns).
"""
import ipaddress
import re
import socket
import subprocess
import sys

_QUAD = r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"


def primary_ip():
    """The address this computer uses to reach other networks. Connecting a UDP socket only picks a
    route: nothing is sent."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))   # a documentation address, never really reached
            return sock.getsockname()[0]
    except OSError:
        return None


def mask_prefix(mask):
    """The prefix length of a netmask written 255.255.252.0 or 0xfffffc00, or None when it is not a
    plain run of ones followed by zeros."""
    try:
        text = str(mask).strip()
        n = int(text, 16) if text.lower().startswith("0x") else int(ipaddress.IPv4Address(text))
    except ValueError:
        return None
    if n < 0 or n > 0xFFFFFFFF:
        return None
    bits = bin(n)[2:].zfill(32)
    return None if "01" in bits else bits.count("1")


def parse_ifconfig(text):
    """[(ip, prefix)] from macOS and Linux `ifconfig`: "inet 192.0.2.20 netmask 0xfffffc00 broadcast ..."
    (the broadcast address is never taken as an address of this computer)."""
    out = []
    for ip, mask in re.findall(rf"\binet\s+{_QUAD}(?:\s+-->\s+\S+)?\s+netmask\s+(\S+)", text or ""):
        out.append((ip, mask_prefix(mask)))
    for ip, mask in re.findall(rf"\binet addr:{_QUAD}\s.*?Mask:{_QUAD}", text or ""):   # older Linux
        out.append((ip, mask_prefix(mask)))
    return out


def parse_ip_addr(text):
    """[(ip, prefix)] from `ip -4 -o addr` ("inet 192.0.2.20/22 brd ...")."""
    return [(ip, int(p)) for ip, p in re.findall(rf"\binet\s+{_QUAD}/(\d{{1,2}})\b", text or "")]


def parse_ipconfig(text):
    """[(ip, prefix)] from Windows `ipconfig`. The words are in the user's language, so it goes by
    the numbers: an address followed straight away by a netmask is this computer's address."""
    quads = re.findall(_QUAD, text or "")
    out = []
    i = 0
    while i < len(quads):
        prefix = mask_prefix(quads[i + 1]) if i + 1 < len(quads) else None
        if prefix:   # quads[i + 1] is a netmask: quads[i] is an address of this computer
            out.append((quads[i], prefix))
            i += 2
        else:
            i += 1
    return out


def _run(cmd):
    flags = 0x08000000 if sys.platform == "win32" else 0   # CREATE_NO_WINDOW
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5, creationflags=flags).stdout or ""
    except Exception:
        return ""


def listing():
    """[(ip, prefix or None)] straight from the system, in the order it lists them."""
    if sys.platform == "win32":
        return parse_ipconfig(_run(["ipconfig"]))
    found = parse_ifconfig(_run(["ifconfig"]))
    if not found and sys.platform != "darwin":
        found = parse_ip_addr(_run(["ip", "-4", "-o", "addr"]))
    return found


def interfaces():
    """[(ip, prefix or None)] for this computer, the address it uses first leading, each address once.
    The prefix is None when the system did not say it."""
    seen = {}
    primary = primary_ip()
    for ip, prefix in listing():
        if ip not in seen or (seen[ip] is None and prefix):
            seen[ip] = prefix
    ordered = []
    if primary:
        ordered.append((primary, seen.pop(primary, None)))
    ordered += list(seen.items())
    return ordered


def own_ipv4s():
    """The private, non-loopback addresses of this computer, for mDNS to send from each one."""
    out = []
    for ip, _ in interfaces():
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if a.is_private and not a.is_loopback and not a.is_link_local and ip not in out:
            out.append(ip)
    return out
