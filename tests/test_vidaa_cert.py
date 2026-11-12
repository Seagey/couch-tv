"""scripts/vidaa-cert.py on small zips standing in for an app: a PKCS#12 keystore with no password (opened and
written out), one with a password (named and left locked), a Java keystore (BKS, named and left locked), and
a zip with nothing. Keys are generated here at test time, never committed."""
import contextlib
import datetime
import importlib.util
import io
import os
import stat
import sys
import tempfile
import shutil
import subprocess
import unittest
import unittest.mock
import zipfile
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

SCRIPT = Path(__file__).parents[1] / "scripts" / "vidaa-cert.py"


def make_p12(password=None):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test client")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
    enc = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    return pkcs12.serialize_key_and_certificates(b"test", key, cert, None, enc)


def make_zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, body in entries.items():
            z.writestr(name, body)
    return buf.getvalue()


class VidaaCert(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["COUCH_DATA"] = os.path.join(self.tmp.name, "data")
        self.addCleanup(os.environ.pop, "COUCH_DATA", None)
        spec = importlib.util.spec_from_file_location("vidaa_cert", SCRIPT)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def run_script(self, entries):
        apk = os.path.join(self.tmp.name, "app.apk")
        with open(apk, "wb") as f:
            f.write(make_zip(entries))
        out = io.StringIO()
        code = 0
        with patched_argv(["vidaa-cert.py", apk]), contextlib.redirect_stdout(out):
            try:
                self.mod.main()
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def out_path(self, name):
        return os.path.join(self.tmp.name, "data", "vidaa", name)

    def test_p12_without_password_is_opened(self):
        code, text = self.run_script({"assets/remote.p12": make_p12()})
        self.assertEqual(code, 0)
        self.assertIn("assets/remote.p12", text)
        with open(self.out_path("client.pem"), "rb") as f:
            self.assertIn(b"BEGIN CERTIFICATE", f.read())
        with open(self.out_path("client.key"), "rb") as f:
            self.assertIn(b"PRIVATE KEY", f.read())
        for name in ("client.pem", "client.key"):
            self.assertEqual(stat.S_IMODE(os.stat(self.out_path(name)).st_mode), 0o600)
        with open(self.out_path("client.pem"), "rb") as pem, open(self.out_path("client.key"), "rb") as key:
            self.assertTrue(self.mod.matches(pem.read().strip(), key.read().strip()))
        self.assertNotIn("PRIVATE KEY", text)

    def test_p12_found_by_content(self):
        code, _ = self.run_script({"res/raw/blob": make_p12()})
        self.assertEqual(code, 0)
        self.assertTrue(os.path.isfile(self.out_path("client.pem")))

    def test_p12_with_password_is_named_and_left_locked(self):
        code, text = self.run_script({"assets/remote.p12": make_p12(b"secret")})
        self.assertEqual(code, 1)
        self.assertIn("assets/remote.p12", text)
        self.assertIn("locked keystore", text)
        self.assertIn("docs/VIDAA.md", text)
        self.assertFalse(os.path.exists(self.out_path("client.pem")))

    def test_legacy_p12_falls_back_to_openssl(self):
        """cryptography refuses the keystore (as 50.x does a legacy one): the openssl command opens it."""
        exe = shutil.which("openssl")
        if not exe:
            self.skipTest("no openssl command")
        key = ec.generate_private_key(ec.SECP256R1())
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test client")])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now)
                .not_valid_after(now + datetime.timedelta(days=1)).sign(key, hashes.SHA256()))
        pem_c, pem_k = os.path.join(self.tmp.name, "c.pem"), os.path.join(self.tmp.name, "k.pem")
        with open(pem_c, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        with open(pem_k, "wb") as f:
            f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()))
        made = None
        for legacy in (["-legacy"], []):
            run = subprocess.run([exe, "pkcs12", "-export", "-inkey", pem_k, "-in", pem_c, "-passout", "pass:",
                                  *legacy], capture_output=True)
            if run.returncode == 0:
                made = run.stdout
                break
        if not made:
            self.skipTest("this openssl cannot build a keystore")
        with unittest.mock.patch.object(pkcs12, "load_key_and_certificates", side_effect=ValueError("legacy")):
            code, text = self.run_script({"assets/remoteclientmobile.p12": made})
        self.assertEqual(code, 0, text)
        self.assertTrue(os.path.isfile(self.out_path("client.pem")))
        with open(self.out_path("client.pem"), "rb") as pem, open(self.out_path("client.key"), "rb") as k:
            self.assertTrue(self.mod.matches(pem.read().strip(), k.read().strip()))

    def test_locked_p12_stays_locked_when_cryptography_refuses(self):
        with unittest.mock.patch.object(pkcs12, "load_key_and_certificates", side_effect=ValueError("bad")):
            code, text = self.run_script({"assets/remote.p12": make_p12(b"secret")})
        self.assertEqual(code, 1)
        self.assertIn("locked keystore", text)
        self.assertFalse(os.path.exists(self.out_path("client.key")))

    def test_bks_is_named_and_left_locked(self):
        code, text = self.run_script({"res/raw/client.bks": b"\x00\x00\x00\x02fake keystore bytes"})
        self.assertEqual(code, 1)
        self.assertIn("res/raw/client.bks", text)
        self.assertIn("locked keystore", text)
        self.assertIn("docs/VIDAA.md", text)
        self.assertFalse(os.path.exists(self.out_path("client.key")))

    def test_nothing_found(self):
        code, text = self.run_script({"readme.txt": b"hello"})
        self.assertEqual(code, 1)
        self.assertIn("No PEM certificate, key or keystore", text)


@contextlib.contextmanager
def patched_argv(argv):
    old = sys.argv
    sys.argv = argv
    try:
        yield
    finally:
        sys.argv = old


if __name__ == "__main__":
    unittest.main()
