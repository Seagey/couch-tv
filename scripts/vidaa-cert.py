#!/usr/bin/env python3
"""Find the client certificate in your own copy of the VIDAA phone app, for a VIDAA TV (docs/VIDAA.md).

    .venv/bin/python scripts/vidaa-cert.py <the app's .apk, .xapk or .apks file>

Newer VIDAA firmware only lets a phone remote in when it shows a client certificate. couch-tv does
not ship one: it is Hisense's, not ours to hand out. This script runs on your computer, on a copy of
the app you got yourself, and writes what it finds to bridge/data/vidaa/ (client.pem and client.key),
which git ignores. Nothing is sent anywhere.

It reads plain PEM text inside the file ("-----BEGIN CERTIFICATE-----" and a matching private key).
Current RemoteNOW keeps the certificate in a keystore instead, so it also looks for keystore files
inside the app (.p12, .pfx, .bks, .jks, .keystore, or PKCS#12 by content). A PKCS#12 keystore with no
password is opened and written out the same way. A locked keystore, or a Java one (BKS, JKS), is named
and left alone: the script does not unlock anything, decompile or patch the app, and never prints key
material. If it finds nothing, it says so and stops.
"""
import io
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.environ.get("COUCH_DATA") or os.path.join(ROOT, "bridge", "data"), "vidaa")
CERT = re.compile(rb"-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+?-----END CERTIFICATE-----")
KEY = re.compile(rb"-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----\r?\n[A-Za-z0-9+/=:,\- \r\n]+?-----END \1-----")
BIGGEST = 20 * 1024 * 1024   # skip anything larger: certificates are a few kilobytes
P12_EXT = (".p12", ".pfx")
JAVA_EXT = (".bks", ".jks", ".keystore")
JAVA_MAGIC = (b"\xfe\xed\xfe\xed", b"\xce\xce\xce\xce")   # JKS and JCEKS
SKIP_EXT = (".dex", ".so", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".xml", ".arsc", ".ttf", ".otf",
            ".mp3", ".mp4", ".ogg", ".wav", ".json", ".js", ".html", ".css", ".kotlin_module", ".version")
LOCKED = ("The app keeps its certificate in a locked keystore ({names}) that this script can't open. "
          "Two things to try (docs/VIDAA.md, step 2): your TV's firmware may not need a certificate at all, "
          "so run scripts/vidaa-check.py first; and if this .apk was not RemoteNOW (com.universal.remote.ms), "
          "try RemoteNOW's .apk, whose keystore has opened before.")


def looks_pkcs12(body):
    """PKCS#12 is a DER sequence whose first item is the integer 3 (the version)."""
    if len(body) < 12 or body[0] != 0x30:
        return False
    n = body[1]
    start = 2 + ((n & 0x7F) if n & 0x80 else 0)
    return body[start:start + 3] == b"\x02\x01\x03"


def store_kind(name, body):
    """'p12', 'java' or None for one file inside the app."""
    low = name.lower()
    if low.endswith(P12_EXT):
        return "p12"
    if low.endswith(JAVA_EXT) or body[:4] in JAVA_MAGIC:
        return "java"
    if len(body) <= 256 * 1024 and not low.endswith(SKIP_EXT) and looks_pkcs12(body):
        return "p12"
    return None


def blocks(data, found, depth=0):
    """Every PEM certificate and key, and every keystore file, in a zip (an .apk is one), one level of zips inside it too."""
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
        kind = store_kind(info.filename, body)
        if kind:
            found["stores"].append((info.filename, body, kind))
            continue
        found["certs"] += [(info.filename, m.group(0)) for m in CERT.finditer(body)]
        found["keys"] += [(info.filename, m.group(0)) for m in KEY.finditer(body)]


def open_pkcs12(body):
    """(certificate PEM, key PEM) from a PKCS#12 with no password or an empty one, else None."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    rejected = False
    for pw in (None, b""):
        try:
            key, cert, _ = pkcs12.load_key_and_certificates(body, pw)
        except (ValueError, TypeError):
            rejected = True
            continue
        if key is None or cert is None:
            continue
        return (cert.public_bytes(serialization.Encoding.PEM).strip(),
                key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()).strip())
    return open_pkcs12_with_openssl(body) if rejected else None


def open_pkcs12_with_openssl(body):
    """Older keystores (RemoteNOW's remoteclientmobile.p12) use legacy encryption that newer `cryptography`
    refuses. Ask the openssl command to open it with an empty password: `-legacy` first (OpenSSL 3 and later),
    then without it (OpenSSL 1.1). A fixed argument list, no shell, the keystore on stdin, a time limit. A
    keystore with a real password still fails here and stays locked."""
    exe = shutil.which("openssl")
    if not exe:
        return None
    for legacy in (["-legacy"], []):
        try:
            run = subprocess.run([exe, "pkcs12", "-nodes", "-passin", "pass:", *legacy], input=body,
                                 capture_output=True, timeout=20, check=False)
        except (OSError, subprocess.SubprocessError):
            continue
        if run.returncode != 0:
            continue
        cert, key = CERT.search(run.stdout), KEY.search(run.stdout)
        if cert and key and b"ENCRYPTED" not in key.group(0):
            return cert.group(0).strip(), key.group(0).strip()
    return None


def write_out(cert, key):
    """client.pem and client.key into bridge/data/vidaa/, owner only. Returns where, for the message."""
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    for name, body in (("client.pem", cert), ("client.key", key)):
        path = os.path.join(OUT, name)
        with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as f:
            f.write(body + b"\n")
    return os.path.relpath(OUT, ROOT) if OUT.startswith(ROOT + os.sep) else OUT


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
    found = {"certs": [], "keys": [], "stores": []}
    blocks(data, found)
    pairs = [(cn, c, kn, k) for cn, c in found["certs"] for kn, k in found["keys"]
             if b"ENCRYPTED" not in k and matches(c, k)]
    if not pairs and found["stores"]:
        for name, body, kind in found["stores"]:
            opened = open_pkcs12(body) if kind == "p12" else None
            if opened:
                where = write_out(*opened)
                print(f"ok: a certificate and its key from the keystore {name} written to {where}/ (git ignores it).")
                print("Restart the bridge so it uses them.")
                return
        print(LOCKED.format(names=", ".join(n for n, _, _ in found["stores"])))
        sys.exit(1)
    if not found["certs"] and not found["keys"]:
        print("No PEM certificate, key or keystore in that file. This script stops there: it does not take the app apart.")
        sys.exit(1)
    if found["keys"] and all(b"ENCRYPTED" in k for _, k in found["keys"]):
        print("The only private keys in that file are locked with a password. This script does not unlock them.")
        sys.exit(1)
    if not pairs:
        print(f"Found {len(found['certs'])} certificate(s) and {len(found['keys'])} key(s), but no key that "
              "belongs to a certificate.")
        sys.exit(1)
    cn, c, kn, k = pairs[0]
    where = write_out(c, k)
    print(f"ok: a certificate ({cn}) and its key ({kn}) written to {where}/ "
          f"(git ignores it). {len(pairs) - 1} other matching pair(s) were left out." if len(pairs) > 1 else
          f"ok: a certificate ({cn}) and its key ({kn}) written to {where}/ (git ignores it).")
    print("Restart the bridge so it uses them.")


if __name__ == "__main__":
    main()
