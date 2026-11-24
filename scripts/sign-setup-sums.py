#!/usr/bin/env python3
"""Signs SHA256SUMS-setup.txt for a couch-tv release: writes SHA256SUMS-setup.txt.sig beside it (base64 Ed25519).

    python3 scripts/sign-setup-sums.py SHA256SUMS-setup.txt v0.13.14   then: gh release upload <tag> SHA256SUMS-setup.txt.sig

The signature covers the tag and the sums file together ("couch-tv-setup-sums <tag>\\n" + the file), the same bytes
update.signed_message() builds, so a signed file from one release is not valid for another.

The private key is NOT in this repo. It lives on the release computer at ~/.couch-tv-signing/update-ed25519.pem
(COUCHTV_SIGNING_KEY names another file). The matching public key is PUBLIC_KEY_B64 in
setup-app/couchtv_setup/helper/update.py. Never print or commit the private key.
"""
import base64
import os
import sys

from cryptography.hazmat.primitives import serialization


def main(path, tag):
    key_path = os.path.expanduser(os.environ.get("COUCHTV_SIGNING_KEY") or "~/.couch-tv-signing/update-ed25519.pem")
    if os.stat(key_path).st_mode & 0o077:
        sys.exit("The signing key must be readable by you only (chmod 600).")
    with open(key_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), None)
    with open(path, "rb") as f:
        sig = key.sign(b"couch-tv-setup-sums " + tag.encode("utf-8") + b"\n" + f.read())
    with open(path + ".sig", "w", encoding="utf-8") as f:
        f.write(base64.b64encode(sig).decode() + "\n")
    print("wrote " + path + ".sig")


if __name__ == "__main__":
    if len(sys.argv) != 3 or not sys.argv[2].startswith("v"):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
