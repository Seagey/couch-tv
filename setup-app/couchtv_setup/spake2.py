"""SPAKE2 over edwards25519, the way BoringSSL does it (crypto/curve25519/spake25519.cc), which is
what Android's adb uses for Wireless debugging pairing (packages/modules/adb, pairing_auth).

Written for couch-tv from the public BoringSSL and AOSP source, nothing copied. Plain Python
integers: slow next to C, but a pairing does a handful of scalar multiplications, well under a
second.

Two details that must match BoringSSL exactly, or the TV refuses the code:
- The ephemeral scalar is reduced mod l and then multiplied by 8 (the cofactor).
- The password scalar is reduced mod l and then has l, 2l and 4l added as needed to make it a
  multiple of 8 ("password scalar hack"): this keeps the mask in the prime order subgroup.
The key is SHA-512 over the names, both messages, the shared point and the password hash, each
with an 8 byte little endian length in front.
"""
import hashlib
import os

P = 2 ** 255 - 19
L = 2 ** 252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)

# The two fixed points, from the comment in BoringSSL's spake25519.cc (also re-derived in the tests
# from the seeds "edwards25519 point generation seed (M)" and "(N)").
M_HEX = "5ada7e4bf6ddd9adb6626d32131c6b5c51a1e347a3478f53cfcf441b88eed12e"
N_HEX = "10e3df0ae37d8e7a99b5fe74b44672103dbddcbd06af680d71329a11693bc778"


def _inv(x):
    return pow(x, P - 2, P)


def _recover_x(y, sign):
    if y >= P:
        return None
    x2 = (y * y - 1) * _inv(D * y * y + 1) % P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (P + 3) // 8, P)
    if (x * x - x2) % P:
        x = x * SQRT_M1 % P
    if (x * x - x2) % P:
        return None
    if (x & 1) != sign:
        x = P - x
    return x


def decode(b):
    """32 bytes to a point in extended coordinates, or None if it is not on the curve."""
    if len(b) != 32:
        return None
    n = int.from_bytes(b, "little")
    y, sign = n & ((1 << 255) - 1), n >> 255
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % P)


def encode(pt):
    x, y, z, _ = pt
    zi = _inv(z)
    x, y = x * zi % P, y * zi % P
    return (y | ((x & 1) << 255)).to_bytes(32, "little")


def add(p1, p2):
    x1, y1, z1, t1 = p1
    x2, y2, z2, t2 = p2
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = t1 * 2 * D * t2 % P
    d = z1 * 2 * z2 % P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def neg(pt):
    x, y, z, t = pt
    return ((-x) % P, y, z, (-t) % P)


IDENTITY = (0, 1, 1, 0)


def mul(k, pt):
    out = IDENTITY
    while k:
        if k & 1:
            out = add(out, pt)
        pt = add(pt, pt)
        k >>= 1
    return out


_BY = 4 * _inv(5) % P
BASE = (_recover_x(_BY, 0), _BY, 1, _recover_x(_BY, 0) * _BY % P)
M = decode(bytes.fromhex(M_HEX))
N = decode(bytes.fromhex(N_HEX))


def _with_length(data):
    return len(data).to_bytes(8, "little") + data


class Spake2:
    """One side of a SPAKE2 exchange. Alice uses M to mask, Bob uses N (adb: the client is Alice)."""

    def __init__(self, alice, my_name, their_name, random=os.urandom):
        self.alice = alice
        self.my_name, self.their_name = my_name, their_name
        self.random = random
        self.my_msg = None

    def generate(self, password):
        self.private = (int.from_bytes(self.random(64), "little") % L) << 3
        self.password_hash = hashlib.sha512(password).digest()
        s = int.from_bytes(self.password_hash, "little") % L
        for bit in (1, 2, 4):
            if s & bit:
                s += L * bit
        assert s % 8 == 0
        self.password_scalar = s
        mask = mul(s, M if self.alice else N)
        self.my_msg = encode(add(mul(self.private, BASE), mask))
        return self.my_msg

    def process(self, their_msg):
        """The 64 byte shared key, or ValueError if their message is not a point on the curve."""
        q = decode(their_msg)
        if q is None:
            raise ValueError("the other side's SPAKE2 message is not a point on the curve")
        their_mask = mul(self.password_scalar, N if self.alice else M)
        shared = encode(mul(self.private, add(q, neg(their_mask))))
        h = hashlib.sha512()
        if self.alice:
            parts = (self.my_name, self.their_name, self.my_msg, their_msg)
        else:
            parts = (self.their_name, self.my_name, their_msg, self.my_msg)
        for part in parts + (shared, self.password_hash):
            h.update(_with_length(part))
        return h.digest()
