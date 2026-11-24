"""A small log of what each TV scan did, so the next missed TV can be explained: when, which networks,
what each way of looking (announcements, knocking, the ADB check) found, which knocks were tried again
and which of those answered.

It stays in couch-tv Setup's own folder on this computer (scan-log.jsonl), is never sent anywhere,
and is kept small: one line per scan, at most MAX_ENTRIES lines and about MAX_BYTES bytes (the oldest
lines go first). It holds the addresses of devices on your own network and no names, no keys.
"""
import json
import os
import threading
import time

from . import paths

NAME = "scan-log.jsonl"
MAX_ENTRIES = 200
MAX_BYTES = 128 * 1024
MAX_LIST = 40        # longest list of addresses kept in one line
_lock = threading.Lock()


def _trim(v):
    if isinstance(v, list):
        return [_trim(x) for x in v[:MAX_LIST]]
    if isinstance(v, dict):
        return {str(k)[:40]: _trim(x) for k, x in v.items()}
    if isinstance(v, str):
        return v[:200]
    return v


def path(folder=None):
    return (folder or paths.data()) / NAME


def write(diag, folder=None):
    """Adds one line for a scan. Never raises: a log that cannot be written must not stop a scan."""
    try:
        entry = _trim(dict(diag, time=time.strftime("%Y-%m-%dT%H:%M:%S%z")))
        line = json.dumps(entry, separators=(",", ":"), sort_keys=True)
        with _lock:
            p = path(folder)
            lines = []
            if p.exists():
                lines = p.read_text(encoding="utf-8").splitlines()
            lines.append(line)
            lines = lines[-MAX_ENTRIES:]
            while len(lines) > 1 and sum(len(x) + 1 for x in lines) > MAX_BYTES:
                lines.pop(0)
            tmp = p.with_suffix(".tmp")
            tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
            try:
                os.chmod(tmp, 0o600)
            except OSError:
                pass
            os.replace(tmp, p)
        return p
    except Exception:
        return None


def read(last=20, folder=None):
    """The newest `last` scans, oldest first."""
    try:
        lines = path(folder).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for x in lines[-last:]:
        try:
            out.append(json.loads(x))
        except ValueError:
            pass
    return out
