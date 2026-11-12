"""Talking to the TV over ADB, in pure Python (adb-shell), so no Google adb is needed.

Two ways in:
- "tcp": port 5555 (Network debugging, ADB debugging on Fire TV, or USB debugging on TVs that open
  it by themselves). The first time the TV asks "Allow USB debugging?": this waits for the press.
- "tls": the Wireless debugging port, after pairing with the code (pairing.py, adbtls.py). No prompt.

The reconnect, retry and copy code is couch-tv's own tv-home/tools/tvadb.py, kept the same so the
setup app installs exactly the way apply.sh does (push in 64 KB parts, md5 check, base64 through
the shell if the TV stalls on push).
"""
import base64
import hashlib
import io
import time

from adb_shell.adb_device import AdbDevice, AdbDeviceTcp

from .adbtls import TlsTransport

TMP = "/data/local/tmp/couchtv-setup"
PART = 64 * 1024
B64_STEP = 32 * 1024
B64_UNPACK = 64
TRIES = 3


class TvError(Exception):
    """A problem to show the person as it is: plain words, no traceback."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class Tv:
    """An ADB connection that reconnects and tries again when the TV stops answering."""

    def __init__(self, ip, identity, route="tcp", port=5555, allow_wait_s=90, opener=None):
        self.ip, self.port, self.route = ip, int(port), route
        self.identity = identity
        self.dev = None
        self._opener = opener
        self._open(allow_wait_s)

    def _open(self, wait_s=15):
        if self._opener:
            self.dev = self._opener()
            return
        try:
            if self.route == "tls":
                dev = AdbDevice(TlsTransport(self.ip, self.port, self.identity.cert_path, self.identity.key_path),
                                default_transport_timeout_s=30)
                dev.connect(transport_timeout_s=30, auth_timeout_s=10)
            else:
                dev = AdbDeviceTcp(self.ip, self.port, default_transport_timeout_s=max(30, wait_s))
                dev.connect(rsa_keys=[self.identity.signer()], auth_timeout_s=wait_s)
        except Exception as e:
            if self.route == "tls":
                raise TvError("The TV did not let this computer in over Wireless debugging. Pair again with a "
                              "new code from the TV.", "not_paired") from e
            raise TvError("The TV did not let this computer in. Check that debugging is on, then press Allow "
                          "on the TV (tick Always allow) and try again.", "not_allowed") from e
        self.dev = dev

    def close(self):
        try:
            if self.dev:
                self.dev.close()
        except Exception:
            pass

    def reconnect(self):
        self.close()
        time.sleep(2)
        self._open()

    def _retry(self, fn):
        last = None
        for attempt in range(TRIES):
            try:
                return fn()
            except TvError:
                raise
            except Exception as e:
                last = e
                if attempt + 1 < TRIES:
                    try:
                        self.reconnect()
                    except Exception as e2:
                        last = e2
        raise TvError(f"The TV stopped answering ({type(last).__name__}). Is it still on?", "lost")

    def shell(self, cmd, timeout_s=60):
        return self._retry(lambda: self.dev.shell(cmd, timeout_s=timeout_s, read_timeout_s=timeout_s)) or ""

    def prop(self, name):
        return self.shell(f"getprop {name}").strip()

    def key(self, name):
        self.shell(f"input keyevent KEYCODE_{name}")

    # ---- copying and installing an app (tvadb.py's install) ----

    def _md5(self, path):
        return (self.shell(f"md5sum {path} 2>/dev/null || toybox md5sum {path}").split() or [""])[0]

    def _push(self, data, dest, progress):
        self.shell(f"rm -rf {TMP}.parts {dest}; mkdir -p {TMP}.parts")
        for i in range(0, len(data), PART):
            self.dev.push(io.BytesIO(data[i:i + PART]), f"{TMP}.parts/{i // PART:05d}",
                          transport_timeout_s=20, read_timeout_s=20)
            progress(min(1.0, (i + PART) / len(data)))
        self.shell(f"cat {TMP}.parts/* > {dest}; rm -rf {TMP}.parts", 120)

    def _push_b64(self, data, dest, progress):
        b64 = base64.b64encode(data).decode()
        self.shell(f"rm -rf {TMP}.b64 {dest}; mkdir -p {TMP}.b64; : > {dest}")
        total = (len(b64) + B64_STEP - 1) // B64_STEP
        for n, i in enumerate(range(0, len(b64), B64_STEP), 1):
            self.shell(f"echo -n '{b64[i:i + B64_STEP]}' > {TMP}.b64/{n:05d}")
            progress(n / total)
        raw_piece = B64_UNPACK * B64_STEP // 4 * 3
        for p in range(0, total, B64_UNPACK):
            files = " ".join(f"{TMP}.b64/{n:05d}" for n in range(p + 1, min(p + B64_UNPACK, total) + 1))
            self.shell(f'[ "$(wc -c < {dest})" = {p // B64_UNPACK * raw_piece} ] && cat {files} | base64 -d >> {dest}', 120)
        self.shell(f"rm -rf {TMP}.b64")

    def install(self, apk_path, progress=lambda f: None):
        with open(apk_path, "rb") as f:
            data = f.read()
        want = hashlib.md5(data).hexdigest()
        dest = TMP + ".apk"
        ok = False
        try:
            self._push(data, dest, progress)
            ok = self._md5(dest) == want
        except TvError:
            raise
        except Exception:
            self.reconnect()
        if not ok:
            self._push_b64(data, dest, progress)
            if self._md5(dest) != want:
                self.shell(f"rm -f {dest}")
                raise TvError("The app reached the TV damaged. Try again.", "damaged")
        out = self.shell(f"pm install -r {dest}; rm -f {dest}", 180)
        if "Success" in out:
            return out
        if "UPDATE_INCOMPATIBLE" in out or "SIGNATURES" in out:
            raise TvError("This TV already has a couch-tv app signed with a different key (a test build, or "
                          "someone else's build), so it cannot be updated in place. Use Undo first, then set up again.",
                          "different_key")
        if "INSUFFICIENT_STORAGE" in out:
            raise TvError("The TV is out of space. Remove an app you do not use and try again.", "no_space")
        raise TvError("The TV did not install the app: " + out.strip()[-200:], "install_failed")
