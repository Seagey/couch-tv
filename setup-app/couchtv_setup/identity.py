"""This computer's ADB identity: the RSA key the TV allows ("Always allow from this computer", or a
Wireless debugging pairing) and a self signed certificate made from it for the TLS connections.

The key lives in the setup's own folder (paths.data()), never in ~/.android, so it is separate from
Android Studio, Google's adb and the couch-tv bridge, and deleting the folder forgets it.
Same file formats as Google's adb: `adbkey` (PKCS#8 PEM) and `adbkey.pub` (Android's public key
struct in base64, then " user@host").
"""
import datetime
import os

from adb_shell.auth.keygen import keygen
from adb_shell.auth.sign_pythonrsa import PythonRSASigner
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import NameOID

from . import paths

NAME = "couch-tv-setup"


class Identity:
    def __init__(self, folder=None):
        folder = folder or paths.data()
        self.key_path = os.environ.get("COUCHTV_SETUP_ADBKEY") or os.path.join(str(folder), "adbkey")
        self.cert_path = self.key_path + ".crt"
        if not os.path.exists(self.key_path) or not os.path.exists(self.key_path + ".pub"):
            keygen(self.key_path)
            try:
                os.chmod(self.key_path, 0o600)
            except OSError:
                pass
            # The name the TV lists under Paired devices (and asks "Allow?" about): say what it is, so
            # a person can find it and choose Forget. adb-shell would write "user@host" (often root@...).
            with open(self.key_path + ".pub") as f:
                key_b64 = f.read().split()[0]
            with open(self.key_path + ".pub", "w") as f:
                f.write(key_b64 + " " + NAME)
        with open(self.key_path, "rb") as f:
            self.key_pem = f.read()
        with open(self.key_path + ".pub") as f:
            self.public_text = f.read().strip()
        self.key = serialization.load_pem_private_key(self.key_pem, password=None)
        if os.path.exists(self.cert_path):
            with open(self.cert_path, "rb") as f:
                self.cert = x509.load_pem_x509_certificate(f.read())
        else:
            self.cert = self._make_cert()
            with open(self.cert_path, "wb") as f:
                f.write(self.cert.public_bytes(serialization.Encoding.PEM))

    def _make_cert(self):
        # The same shape adb makes (crypto/x509_generator.cpp): self signed, ten years.
        name = x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
                          x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Android"),
                          x509.NameAttribute(NameOID.COMMON_NAME, "Adb")])
        now = datetime.datetime.now(datetime.timezone.utc)
        return (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(self.key.public_key()).serial_number(1)
                .not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=3650))
                .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
                .sign(self.key, hashes.SHA256()))

    def signer(self):
        return PythonRSASigner(self.public_text, self.key_pem.decode())
