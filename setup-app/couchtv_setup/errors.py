"""Every error the page can show, in plain words. A raw exception name never reaches the page: the
technical part goes in a "detail" line that the page keeps behind a Details disclosure.

The one that matters most: macOS's Local Network permission. When it is switched off for this app,
macOS does not say so. Every send to the home network fails with "No route to host" (EHOSTUNREACH,
errno 65 on a Mac) or "Operation not permitted" (EPERM), the mDNS question to 224.0.0.251 fails
the same way, while the internet still works (the default route is there). Seen on a real Mac on
19 November 2026: "Something went wrong: OSError" on the first launch, and the same app found
every TV once it ran from Terminal, which already had the permission.
"""
import errno
import ipaddress
import socket
import ssl
import sys
import urllib.error

LOCAL_NETWORK_CODE = "local_network_blocked"

MAC_BLOCKED = ("Your Mac blocked this app from finding the TV. Open System Settings, Privacy and Security, "
               "Local Network, switch on Couch TV Setup, then press Look again.")
WINDOWS_BLOCKED = ("Windows blocked this app from finding the TV. Open Windows Security, Firewall and network "
                   "protection, Allow an app through firewall, tick Private for Couch TV Setup, then press Look again.")
OTHER_BLOCKED = ("This computer blocked this app from finding the TV. Allow Couch TV Setup on your home network "
                 "in this computer's firewall settings, then press Look again.")

# "No route to host" and "Operation not permitted": what a blocked send to the home network gives.
BLOCK_ERRNOS = {errno.EHOSTUNREACH, errno.EPERM}
if sys.platform == "win32":
    BLOCK_ERRNOS |= {10013, 10065}    # WSAEACCES, WSAEHOSTUNREACH

FALLBACK = "That step did not work. Try it again. If it keeps happening, press Close setup and open the app again."


def _platform():
    return "mac" if sys.platform == "darwin" else "windows" if sys.platform == "win32" else "other"


def blocked_message(platform=None):
    return {"mac": MAC_BLOCKED, "windows": WINDOWS_BLOCKED}.get(platform or _platform(), OTHER_BLOCKED)


def has_default_route():
    """True when this computer can route to the internet. Connecting a UDP socket only picks a route:
    nothing is sent. Local Network permission on a Mac does not affect this one."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("192.0.2.1", 9))   # a documentation address, never really reached
            return True
    except OSError:
        return False


def _home_or_multicast(dest):
    try:
        a = ipaddress.ip_address(str(dest).split(":")[0])
    except ValueError:
        return False
    return a.version == 4 and (a.is_multicast or (a.is_private and not a.is_loopback and not a.is_link_local))


def root(exc):
    """The OSError (or other cause) underneath wrappers: URLError's reason, a raise ... from e chain."""
    seen = 0
    while exc is not None and seen < 8:
        seen += 1
        if isinstance(exc, urllib.error.URLError) and isinstance(getattr(exc, "reason", None), BaseException):
            exc = exc.reason
            continue
        if isinstance(exc, OSError) and getattr(exc, "errno", None) is not None:
            return exc
        nxt = exc.__cause__ or exc.__context__
        if nxt is None:
            return exc
        exc = nxt
    return exc


def is_local_network_block(exc, dest=None, default_route=None):
    """True when this looks like the computer stopping the app from reaching the home network, rather
    than a TV that is off: a block errno, sent to a home or multicast address (when known), while the
    internet route is there."""
    e = root(exc)
    if not isinstance(e, OSError) or e.errno not in BLOCK_ERRNOS:
        return False
    dest = dest or getattr(e, "dest", None)
    if dest is not None and not _home_or_multicast(dest):
        return False
    if dest is None and (e.errno != errno.EHOSTUNREACH or getattr(e, "filename", None)):
        return False   # "Operation not permitted" alone could be a file; only trust it for a network send
    if default_route is None:
        default_route = has_default_route()
    return bool(default_route)


def detail(exc):
    """The technical line for the Details disclosure."""
    e = root(exc)
    parts = [type(exc).__name__ + (": " + str(exc) if str(exc) else "")]
    if e is not exc and e is not None:
        parts.append(type(e).__name__ + (f" [errno {e.errno}]" if getattr(e, "errno", None) is not None else "")
                     + (": " + str(e) if str(e) else ""))
    return " / ".join(parts)[:400]


def explain(exc, dest=None, platform=None, default_route=None):
    """(message, code, detail) for any exception: plain words, a code the page can act on, and the
    technical part for Details."""
    if is_local_network_block(exc, dest, default_route):
        return blocked_message(platform), LOCAL_NETWORK_CODE, detail(exc)
    e = root(exc)
    no = getattr(e, "errno", None)
    if isinstance(e, (socket.timeout, TimeoutError)) or no == errno.ETIMEDOUT:
        msg, code = ("The TV did not answer in time. Check it is switched on and on the same Wi-Fi as this "
                     "computer, then try again."), "timeout"
    elif isinstance(e, ConnectionRefusedError) or no == errno.ECONNREFUSED:
        msg, code = ("The TV turned this computer away. Check the switch on the TV is still on (see the steps "
                     "above), then try again."), "refused"
    elif isinstance(e, (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)) or \
            no in (errno.ECONNRESET, errno.EPIPE, errno.ECONNABORTED):
        msg, code = "The TV stopped the connection part way. Check it is still on, then try again.", "reset"
    elif no in (errno.ENETUNREACH, errno.ENETDOWN):
        msg, code = "This computer is not on a network. Connect it to the same Wi-Fi as the TV, then try again.", "no_network"
    elif no == errno.EHOSTUNREACH:
        msg, code = ("This computer cannot see the TV. Check the TV is on and on the same Wi-Fi as this computer, "
                     "then try again."), "unreachable"
    elif no == errno.EADDRINUSE:
        msg, code = ("Another program on this computer is in the way. Close other TV or casting apps, then try "
                     "again."), "in_use"
    elif isinstance(e, socket.gaierror):
        msg, code = "This computer could not reach the internet. Check it is online, then try again.", "offline"
    elif isinstance(e, ssl.SSLError):
        msg, code = "The TV would not open a private connection with this computer. Try again.", "secure"
    elif isinstance(e, PermissionError) or no in (errno.EACCES, errno.EROFS):
        msg, code = ("Couch TV Setup could not save its own files on this computer. Check there is free space, "
                     "then try again."), "files"
    elif no == errno.ENOSPC or isinstance(e, MemoryError):
        msg, code = "This computer is out of space. Free some up, then try again.", "no_space_here"
    else:
        msg, code = FALLBACK, "crash"
    return msg, code, detail(exc)
