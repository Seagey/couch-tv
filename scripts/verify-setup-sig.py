#!/usr/bin/env python3
"""Checks a release's SHA256SUMS-setup.txt.sig the way an installed Couch TV Helper does: the same function and
the same public key (setup-app/couchtv_setup/helper/update.py). Exit 0 when valid, 1 when not.

    python3 scripts/verify-setup-sig.py SHA256SUMS-setup.txt SHA256SUMS-setup.txt.sig v0.13.14
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "setup-app"))


def main(sums, sig, tag):
    from couchtv_setup.helper import update
    with open(sums, "rb") as f:
        message = f.read()
    with open(sig, "rb") as f:
        signature = f.read()
    if update.verify_signature(update.signed_message(tag, message), signature):
        print("signature ok")
        return 0
    print("SIGNATURE DOES NOT MATCH")
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3]))
