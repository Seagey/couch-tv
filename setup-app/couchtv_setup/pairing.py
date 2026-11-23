"""Wireless debugging pairing (Android 11 and newer), the "Pair device with pairing code" screen.

What happens, as in AOSP packages/modules/adb (pairing_connection, pairing_auth):
1. TCP to the pairing port the TV shows, then TLS 1.3. Both sides show a self signed certificate
   and neither checks the other's: the pairing code is what proves who is who.
2. Both sides export 64 bytes of keying material from the TLS session (label "adb-label" with its
   NUL byte) and put them after the 6 digit code. That is the SPAKE2 password, so a pairing cannot
   be relayed through someone else's TLS session.
3. SPAKE2 (spake2.py): each side sends 32 bytes, both get the same 64 byte key only if they typed
   the same code.
4. AES-128-GCM with a key made by HKDF-SHA256 (info "adb pairing_auth aes-128-gcm key"), a 12 byte
   nonce that counts up from 0 (little endian, first 8 bytes). Each side sends a PeerInfo of
   exactly 8192 bytes: a type byte, then the text, NUL padded. Ours is our ADB public key (type 0),
   the TV's is its id (type 1). The TV then trusts our key for its Wireless debugging port.
A wrong code shows up as the TV closing the connection, or a PeerInfo we cannot decrypt.

Packets: version byte (1), type byte (0 = SPAKE2 message, 1 = PeerInfo), payload length as a
4 byte big endian number, then the payload.

The server half is here too, only so the tests (and Google's own `adb pair`) can check this
against a known good client without a TV.
"""
import select
import socket
import struct
import time

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from OpenSSL import SSL

from .spake2 import Spake2

CLIENT_NAME = b"adb pair client\x00"
SERVER_NAME = b"adb pair server\x00"
EXPORT_LABEL = b"adb-label\x00"
HKDF_INFO = b"adb pairing_auth aes-128-gcm key"
VERSION = 1
SPAKE2_MSG, PEER_INFO = 0, 1
RSA_PUB_KEY, DEVICE_GUID = 0, 1
PEER_INFO_SIZE = 8192
MAX_PAYLOAD = PEER_INFO_SIZE * 2


class PairingError(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class _Cipher:
    def __init__(self, key_material):
        key = HKDF(algorithm=hashes.SHA256(), length=16, salt=None, info=HKDF_INFO).derive(key_material)
        self.aes = AESGCM(key)
        self.enc = self.dec = 0

    @staticmethod
    def _nonce(n):
        return struct.pack("<Q", n) + b"\x00" * 4

    def encrypt(self, data):
        out = self.aes.encrypt(self._nonce(self.enc), data, None)
        self.enc += 1
        return out

    def decrypt(self, data):
        out = self.aes.decrypt(self._nonce(self.dec), data, None)
        self.dec += 1
        return out


class _Tls:
    """A pyOpenSSL connection on a non-blocking socket, with a deadline on every call."""

    def __init__(self, sock, ctx, server, timeout):
        sock.setblocking(False)
        self.sock = sock
        self.conn = SSL.Connection(ctx, sock)
        self.timeout = timeout
        (self.conn.set_accept_state if server else self.conn.set_connect_state)()

    def _io(self, fn, *args):
        end = time.monotonic() + self.timeout
        while True:
            try:
                return fn(*args)
            except SSL.WantReadError:
                wait = ([self.sock], [])
            except SSL.WantWriteError:
                wait = ([], [self.sock])
            left = end - time.monotonic()
            if left <= 0:
                raise socket.timeout("the TV took too long to answer")
            r, w, _ = select.select(wait[0], wait[1], [], left)

    def handshake(self):
        self._io(self.conn.do_handshake)

    def export(self):
        return self.conn.export_keying_material(EXPORT_LABEL, 64)

    def send(self, data):
        view = memoryview(data)
        while view:
            n = self._io(self.conn.send, bytes(view[:16384]))
            view = view[n:]

    def recv_exact(self, n):
        out = b""
        while len(out) < n:
            try:
                chunk = self._io(self.conn.recv, n - len(out))
            except (SSL.ZeroReturnError, SSL.SysCallError):
                chunk = b""
            if not chunk:
                raise ConnectionError("closed")
            out += chunk
        return out

    def close(self):
        try:
            self.conn.shutdown()
        except Exception:
            pass
        self.sock.close()


def _context(cert, key, server):
    ctx = SSL.Context(SSL.TLS_METHOD)
    ctx.set_min_proto_version(SSL.TLS1_3_VERSION)
    ctx.set_max_proto_version(SSL.TLS1_3_VERSION)
    ctx.use_certificate(cert)
    ctx.use_privatekey(key)
    # Neither side checks the other's certificate (as adb): the pairing code does that job.
    if server:
        ctx.set_verify(SSL.VERIFY_PEER, lambda *a: True)
    else:
        ctx.set_verify(SSL.VERIFY_NONE, lambda *a: True)
    return ctx


def _send_packet(tls, kind, payload):
    tls.send(struct.pack(">BBI", VERSION, kind, len(payload)) + payload)


def _read_packet(tls, want):
    version, kind, size = struct.unpack(">BBI", tls.recv_exact(6))
    if version != VERSION or kind != want or not 0 < size <= MAX_PAYLOAD:
        raise PairingError("The TV answered in a way this setup does not understand.", "protocol")
    return tls.recv_exact(size)


def _peer_info(kind, text):
    data = text.encode() if isinstance(text, str) else text
    if len(data) > PEER_INFO_SIZE - 2:
        raise ValueError("peer info too long")
    return bytes([kind]) + data + b"\x00" * (PEER_INFO_SIZE - 1 - len(data))


def _parse_peer_info(raw):
    if len(raw) != PEER_INFO_SIZE:
        raise PairingError("The TV answered in a way this setup does not understand.", "protocol")
    return raw[0], raw[1:].split(b"\x00", 1)[0].decode(errors="replace")


def pair(host, port, code, cert, key, public_key_text, timeout=20):
    """Pairs this computer's key with the TV. `cert` and `key` are cryptography objects (the TLS
    certificate and the ADB private key), `public_key_text` is the adbkey.pub text. Returns the TV's
    id. Raises PairingError with code "wrong_code", "unreachable" or "protocol"."""
    code = "".join(ch for ch in str(code) if ch.isdigit())
    if len(code) != 6:
        raise PairingError("The pairing code is the 6 numbers on the TV.", "bad_code")
    try:
        sock = socket.create_connection((host, int(port)), timeout=timeout)
    except OSError as e:
        raise PairingError(
            "Could not reach the TV's pairing screen. Is \"Pair device with pairing code\" still open on the TV, "
            "and is the port the one it shows?", "unreachable") from e
    tls = _Tls(sock, _context(cert, key, server=False), server=False, timeout=timeout)
    try:
        try:
            tls.handshake()
        except (SSL.Error, OSError, ConnectionError) as e:
            raise PairingError("The TV's pairing screen did not answer. Open it again and try once more.", "unreachable") from e
        spake = Spake2(True, CLIENT_NAME, SERVER_NAME)
        try:
            _send_packet(tls, SPAKE2_MSG, spake.generate(code.encode() + tls.export()))
            theirs = _read_packet(tls, SPAKE2_MSG)
            cipher = _Cipher(spake.process(theirs))
            _send_packet(tls, PEER_INFO, cipher.encrypt(_peer_info(RSA_PUB_KEY, public_key_text.strip())))
            reply = _read_packet(tls, PEER_INFO)
        except (ConnectionError, SSL.Error, OSError, ValueError) as e:
            # The TV hangs up when our PeerInfo does not decrypt: that is a wrong code.
            raise PairingError("The TV did not take that code. Check the 6 numbers on the TV (a new code "
                               "shows each time the screen opens) and try again.", "wrong_code") from e
        try:
            kind, text = _parse_peer_info(cipher.decrypt(reply))
        except PairingError:
            raise
        except Exception as e:
            raise PairingError("The TV did not take that code. Check the 6 numbers and try again.", "wrong_code") from e
        return text
    finally:
        tls.close()


def serve_once(listener, code, cert, key, guid="couch-tv-test", timeout=20):
    """The TV's half, for tests: accepts one pairing on `listener` and returns the client's PeerInfo
    text (its public key), or raises if the code did not match."""
    sock, _ = listener.accept()
    tls = _Tls(sock, _context(cert, key, server=True), server=True, timeout=timeout)
    try:
        tls.handshake()
        spake = Spake2(False, SERVER_NAME, CLIENT_NAME)
        _send_packet(tls, SPAKE2_MSG, spake.generate(str(code).encode() + tls.export()))
        theirs = _read_packet(tls, SPAKE2_MSG)
        cipher = _Cipher(spake.process(theirs))
        raw = _read_packet(tls, PEER_INFO)
        kind, text = _parse_peer_info(cipher.decrypt(raw))   # raises InvalidTag on a wrong code
        _send_packet(tls, PEER_INFO, cipher.encrypt(_peer_info(DEVICE_GUID, guid)))
        return text
    finally:
        tls.close()
