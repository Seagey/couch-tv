"""Small ADB client for the TV that does not need the shared adb server (pure Python adb_shell,
the same library and key the bridge uses). It runs inside Python, so on a Mac it needs no new
Local Network permission for Google's adb binary.

Usage (TV_IP=<tv address> [ADB_PORT=5555] .venv/bin/python tv-home/tools/tvadb.py ...):
  tvadb.py ping                     connect and say so (exit 1 if the TV cannot be reached)
  tvadb.py shell "<command>"        run a shell command, print the output
  tvadb.py install <file.apk>       install or update an app
  tvadb.py shot <out.png>           screenshot of the TV
  tvadb.py keys KEY [KEY ...]       press remote keys (e.g. DPAD_DOWN ENTER HOME), 0.4 s apart

TVADB_TRIES (3) and TVADB_TIMEOUT (120 s, for `shell`) tune the retries.
ADB_PORT is 5555 unless set: the fixed port of "Network debugging", of USB debugging on TVs that
open it with USB debugging alone, or of `adb tcpip 5555`.

Every ADB call reconnects and tries again (3 tries) when the TV stops answering, which some TVs do
for a few seconds at a time. `install` first copies the app in 64 KB parts with adb push. Some TVs
(seen on a TCL with Android TV 11 and on a Google TV) stall on push, so when a part times out it
reconnects and copies the app as base64 text through plain shell commands instead, the slow but
sure way. Either way the copy is checked with md5 before it is installed. FORCE_B64=1 skips push.

Any failure prints one plain line and exits non-zero, so the shell scripts can stop on it.
"""
import base64
import hashlib
import io
import os
import sys
import time

TMP = "/data/local/tmp/tvhome"
PART = 64 * 1024        # adb push part size
B64_STEP = 32 * 1024    # base64 characters per shell command (a multiple of 4)
TRIES = max(1, int(os.environ.get("TVADB_TRIES") or 3))
SHELL_TIMEOUT = int(os.environ.get("TVADB_TIMEOUT") or 120)


def fail(msg):
    print("tvadb: " + msg, file=sys.stderr)
    sys.exit(1)


def say(msg):
    print("tvadb: " + msg, file=sys.stderr)


def connect():
    try:
        from adb_shell.adb_device import AdbDeviceTcp
        from adb_shell.auth.sign_pythonrsa import PythonRSASigner
    except ImportError:
        fail("needs adb-shell: .venv/bin/pip install -r bridge/requirements.txt")
    ip = os.environ.get("TV_IP") or fail("set TV_IP to the address of the TV")
    try:
        port = int(os.environ.get("ADB_PORT") or 5555)
    except ValueError:
        fail("ADB_PORT must be a number")
    key = os.path.expanduser(os.environ.get("ADB_KEY", "~/.android/adbkey"))
    if not os.path.exists(key):
        from adb_shell.auth.keygen import keygen
        os.makedirs(os.path.dirname(key), exist_ok=True)
        keygen(key)
    signer = PythonRSASigner(open(key + ".pub").read(), open(key).read())
    dev = AdbDeviceTcp(ip, port, default_transport_timeout_s=30)
    try:
        dev.connect(rsa_keys=[signer], auth_timeout_s=10)
    except Exception as e:
        raise ConnectionError(
            f"cannot reach the TV at {ip}:{port} over ADB ({type(e).__name__}). Is it on, on this "
            "Wi-Fi, with USB debugging on (and Network debugging, if the TV has that switch) and this "
            "computer allowed? Check with: .venv/bin/python scripts/check-tv.py <tv address>. "
            "See docs/UNINSTALL.md for the TV-remote-only way.") from e
    return dev


class Tv:
    """An ADB connection that reconnects and retries when the TV stops answering."""

    def __init__(self, opener, sleep=time.sleep):
        self.opener = opener
        self.sleep = sleep
        for attempt in range(1, TRIES + 1):
            try:
                self.dev = opener()
                break
            except ConnectionError:
                if attempt == TRIES:
                    raise
                sleep(2)

    def reconnect(self):
        try:
            self.dev.close()
        except Exception:
            pass
        self.sleep(2)
        self.dev = self.opener()

    def _retry(self, what, fn):
        last = None
        for attempt in range(1, TRIES + 1):
            try:
                return fn()
            except Exception as e:
                last = e
                if attempt == TRIES:
                    break
                say(f"{what} failed ({type(e).__name__}), reconnecting (try {attempt + 1} of {TRIES})")
                try:
                    self.reconnect()
                except Exception as e2:
                    last = e2
        raise last

    def shell(self, cmd, timeout_s=60):
        return self._retry("shell", lambda: self.dev.shell(cmd, timeout_s=timeout_s, read_timeout_s=timeout_s))

    def close(self):
        try:
            self.dev.close()
        except Exception:
            pass


def md5_on_tv(tv, path):
    out = tv.shell(f"md5sum {path} 2>/dev/null || toybox md5sum {path}")
    return (out.split() or [""])[0]


def copy_by_push(tv, data, dest):
    """64 KB parts with adb push, joined on the TV. Raises on the first stalled part (no retry:
    a stalled file push usually leaves the connection unusable, and the caller falls back)."""
    tv.shell(f"rm -rf {TMP}.parts {dest}; mkdir -p {TMP}.parts")
    for i in range(0, len(data), PART):
        tv.dev.push(io.BytesIO(data[i:i + PART]), f"{TMP}.parts/{i // PART:05d}",
                    transport_timeout_s=20, read_timeout_s=20)
    tv.shell(f"cat {TMP}.parts/* > {dest}; rm -rf {TMP}.parts", 120)


def copy_by_base64(tv, data, dest):
    """Base64 text through plain shell commands, one file per chunk so a retried chunk is never
    written twice, then decoded on the TV."""
    b64 = base64.b64encode(data).decode()
    tv.shell(f"rm -rf {TMP}.b64 {dest}; mkdir -p {TMP}.b64")
    total = (len(b64) + B64_STEP - 1) // B64_STEP
    for n, i in enumerate(range(0, len(b64), B64_STEP), 1):
        tv.shell(f"echo -n '{b64[i:i + B64_STEP]}' > {TMP}.b64/{n:05d}")
        if n % 25 == 0 or n == total:
            say(f"copied {n}/{total} parts")
    tv.shell(f"cat {TMP}.b64/* | base64 -d > {dest}; rm -rf {TMP}.b64", 120)


def install(tv, path):
    data = open(path, "rb").read()
    want = hashlib.md5(data).hexdigest()
    dest = TMP + ".apk"
    ok = False
    if os.environ.get("FORCE_B64") != "1":
        try:
            copy_by_push(tv, data, dest)
            ok = md5_on_tv(tv, dest) == want
            if not ok:
                say("the pushed copy did not match, copying again the slow way")
        except Exception as e:
            say(f"push stalled ({type(e).__name__}), reconnecting and copying the slow way")
            tv.reconnect()
    if not ok:
        copy_by_base64(tv, data, dest)
        got = md5_on_tv(tv, dest)
        if got != want:
            tv.shell(f"rm -f {dest}")
            fail(f"the app reached the TV damaged (md5 {got or 'unknown'}, wanted {want}), not installing")
    out = tv.shell(f"pm install -r {dest}; rm -f {dest}", 180)
    print(out, end="")
    if "Success" not in out:
        fail("the TV did not install the app (see the line above)")


def main():
    if len(sys.argv) < 2:
        fail("usage: tvadb.py ping | shell CMD | install APK | shot OUT.png | keys KEY ...")
    cmd, args = sys.argv[1], sys.argv[2:]
    try:
        tv = Tv(connect)
    except ConnectionError as e:
        fail(str(e))
    try:
        if cmd == "ping":
            print("ok")
        elif cmd == "shell":
            print(tv.shell(args[0], SHELL_TIMEOUT), end="")
        elif cmd == "install":
            install(tv, args[0])
        elif cmd == "shot":
            tv.shell("screencap -p /sdcard/tv-shot.png")
            tv._retry("pull", lambda: tv.dev.pull("/sdcard/tv-shot.png", args[0]))
            tv.shell("rm -f /sdcard/tv-shot.png")
            print(args[0])
        elif cmd == "keys":
            for k in args:
                tv.shell(f"input keyevent KEYCODE_{k}")
                time.sleep(0.4)
        else:
            fail(f"unknown command {cmd}")
    except SystemExit:
        raise
    except Exception as e:
        fail(f"the TV stopped answering during '{cmd}' ({type(e).__name__}: {e})")
    finally:
        tv.close()


if __name__ == "__main__":
    main()
