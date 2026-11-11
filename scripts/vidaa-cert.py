#!/usr/bin/env python3
"""Find the client certificate in your own copy of the VIDAA phone app, for a VIDAA TV (docs/VIDAA.md).

    .venv/bin/python scripts/vidaa-cert.py <the app's .apk, .xapk or .apks file>

Newer VIDAA firmware only lets a phone remote in when it shows a client certificate. couch-tv does
not ship one: it is Hisense's, not ours to hand out. This script runs on your computer, on a copy of
the app you got yourself, and writes what it finds to bridge/data/vidaa/ (client.pem and client.key),
which git ignores. Nothing is sent anywhere.

It only reads plain PEM text inside the file ("-----BEGIN CERTIFICATE-----" and a matching private
key). It does not take the app apart further than that. If it finds nothing, or the key is locked
with a password, it says so and stops.
"""
import io
import os
import re
import ssl
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.environ.get("COUCH_DATA") or os.path.join(ROOT, "bridge", "data"), "vidaa")
CERT = re.compile(rb"-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----")
KEY = re.compile(rb"-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=:,\- \r\n]+?-----END \1-----")
BIGGEST = 20 * 1024 * 1024   # skip anything larger: certificates are a few kilobytes


def blocks(data, found, depth=0):
    """Every PEM certificate and key in a zip (an .apk is one), one level of zips inside it too."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return
    for info in z.infolist():
        if info.is_dir() or info.file_size > BIGGEST:
            continue
        body = z.read(info)
        if depth == 0 and info.filename.lower().endswith((".apk", ".zip")):
            blocks(body, found, depth + 1)
            continue
        found["certs"] += [(info.filename, m.group(0)) for m in CERT.finditer(body)]
        found["keys"] += [(info.filename, m.group(0)) for m in KEY.finditer(body)]


def matches(cert, key):
    """True when the key belongs to the certificate (Python's TLS loader checks it)."""
    with tempfile.TemporaryDirectory() as d:
        c, k = os.path.join(d, "c.pem"), os.path.join(d, "k.pem")
        for path, data in ((c, cert), (k, key)):
            with open(os.open(path, os.O_WRONLY | os.O_CREAT, 0o600), "wb") as f:
                f.write(data + b"\n")
        try:
            ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT).load_cert_chain(c, k)
            return True
        except (ssl.SSLError, OSError):
            return False


def main():
    if len(sys.argv) != 2 or not os.path.isfile(sys.argv[1]):
        print(__doc__.strip().split("\n\n")[1])
        sys.exit(2)
    with open(sys.argv[1], "rb") as f:
        data = f.read()
    found = {"certs": [], "keys": []}
    blocks(data, found)
    if not found["certs"] and not found["keys"]:
        print("No PEM certificate or key in that file. This script stops there: it does not take the app apart.")
        sys.exit(1)
    if found["keys"] and all(b"ENCRYPTED" in k for _, k in found["keys"]):
        print("The only private keys in that file are locked with a password. This script does not unlock them.")
        sys.exit(1)
    pairs = [(cn, c, kn, k) for cn, c in found["certs"] for kn, k in found["keys"]
             if b"ENCRYPTED" not in k and matches(c, k)]
    if not pairs:
        print(f"Found {len(found['certs'])} certificate(s) and {len(found['keys'])} key(s), but no key that "
              "belongs to a certificate.")
        sys.exit(1)
    cn, c, kn, k = pairs[0]
    where = os.path.relpath(OUT, ROOT) if OUT.startswith(ROOT + os.sep) else OUT
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    for name, body in (("client.pem", c), ("client.key", k)):
        path = os.path.join(OUT, name)
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as f:
            f.write(body + b"\n")
    print(f"ok: a certificate ({cn}) and its key ({kn}) written to {where}/ "
          f"(git ignores it). {len(pairs) - 1} other matching pair(s) were left out." if len(pairs) > 1 else
          f"ok: a certificate ({cn}) and its key ({kn}) written to {where}/ (git ignores it).")
    print("Restart the bridge so it uses them.")


if __name__ == "__main__":
    main()
