"""A computer or user name with accents must not crash the key setup (issue #267: UnicodeDecodeError on Windows)."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from couchtv_setup import identity  # noqa: E402


class IdentityEncodingTest(unittest.TestCase):
    def test_accented_user_name_in_key_file(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch("adb_shell.auth.keygen.get_user_info", return_value=" jérôme@café"):
                ident = identity.Identity(d)
            self.assertTrue(ident.public_text.endswith(identity.NAME))
            again = identity.Identity(d)
            self.assertEqual(again.public_text, ident.public_text)

    def test_old_key_file_with_bad_bytes_still_loads(self):
        with tempfile.TemporaryDirectory() as d:
            identity.Identity(d)
            pub = os.path.join(d, "adbkey.pub")
            key = open(pub, "rb").read().split()[0]
            with open(pub, "wb") as f:
                f.write(key + b" \x81\x8d\x9d@host")
            self.assertTrue(identity.Identity(d).public_text.startswith(key.decode()))


if __name__ == "__main__":
    unittest.main()
