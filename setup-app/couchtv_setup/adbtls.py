"""ADB over TLS, the connection Wireless debugging uses after pairing (Android 11 and newer).

The handshake, as in AOSP packages/modules/adb (adb.cpp, transport.cpp):
1. We send CNXN as usual.
2. The TV answers STLS ("start TLS") instead of AUTH, and we answer STLS.
3. TLS 1.3 on the same socket. We show a certificate made from our ADB key; the TV lets us in only
   if that key was paired. There is no "Allow" prompt: the pairing code already did that.
4. Inside TLS the TV sends its CNXN, and from then on it is plain ADB.

adb-shell (the pure Python ADB the rest of couch-tv uses) knows nothing of STLS, so this transport
does steps 1 to 3 itself in connect(), then drops the CNXN adb-shell sends next (the TV has already
had ours) and lets adb-shell read the TV's CNXN. Everything after that is adb-shell unchanged.
"""
import select
import socket
import ssl
import struct
import time

from adb_shell.transport.base_transport import BaseTransport

A_CNXN = 0x4E584E43
A_STLS = 0x534C5453
A_VERSION = 0x01000000   # the version adb-shell speaks: with it the TV keeps sending checksums, which adb-shell checks
A_STLS_VERSION = 0x01000000
MAX_DATA = 1024 * 1024


def _packet(cmd, arg0, arg1, data=b""):
    checksum = sum(data) & 0xFFFFFFFF
    return struct.pack("<6I", cmd, arg0, arg1, len(data), checksum, cmd ^ 0xFFFFFFFF) + data


class TlsTransport(BaseTransport):
    def __init__(self, host, port, cert_path, key_path):
        self._host, self._port = host, port
        self._cert, self._key = cert_path, key_path
        self._conn = None
        self._swallow = 0      # bytes of adb-shell's own CNXN still to drop

    def connect(self, transport_timeout_s):
        timeout = transport_timeout_s or 30
        raw = socket.create_connection((self._host, self._port), timeout=timeout)
        try:
            raw.sendall(_packet(A_CNXN, A_VERSION, MAX_DATA, b"host::\x00"))
            head = self._recv_exact(raw, 24)
            cmd, arg0, _, size = struct.unpack("<4I", head[:16])
            if size:
                self._recv_exact(raw, size)
            if cmd != A_STLS:
                raise ConnectionError("this port does not use Wireless debugging's TLS (got %r)" % head[:4])
            raw.sendall(_packet(A_STLS, A_STLS_VERSION, 0))
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE        # the TV's certificate is self signed, as adb's is
            ctx.minimum_version = ssl.TLSVersion.TLSv1_3
            ctx.load_cert_chain(self._cert, self._key)
            self._conn = ctx.wrap_socket(raw, server_side=False, do_handshake_on_connect=True)
        except Exception:
            raw.close()
            raise
        self._swallow = -1     # the next write is adb-shell's CNXN header

    @staticmethod
    def _recv_exact(sock, n):
        out = b""
        while len(out) < n:
            chunk = sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("the TV closed the connection")
            out += chunk
        return out

    def close(self):
        if self._conn:
            try:
                self._conn.close()
            except OSError:
                pass
            self._conn = None

    def bulk_write(self, data, transport_timeout_s):
        if self._swallow == -1 and len(data) == 24 and data[:4] == b"CNXN":
            self._swallow = struct.unpack("<I", data[12:16])[0]
            return len(data)
        if self._swallow > 0:
            self._swallow -= len(data)
            return len(data)
        self._swallow = 0
        self._conn.settimeout(transport_timeout_s)
        self._conn.sendall(data)
        return len(data)

    def bulk_read(self, numbytes, transport_timeout_s):
        from adb_shell.exceptions import TcpTimeoutException
        if not self._conn.pending():
            ready, _, _ = select.select([self._conn], [], [], transport_timeout_s)
            if not ready:
                raise TcpTimeoutException(f"Reading from {self._host}:{self._port} timed out ({transport_timeout_s} seconds)")
        self._conn.settimeout(transport_timeout_s)
        try:
            return self._conn.recv(numbytes)
        except ssl.SSLWantReadError:
            time.sleep(0.01)
            return b""
