"""A bridge loads only the libraries its TVs need (couch-tv#336). A Samsung only bridge never imports
the Android TV ones (adb_shell, androidtvremote2 and the protobuf, rsa and cryptography they bring),
nor the ones only some features use (zeroconf, airtouch5py, Pillow, mcp). Each case starts a fresh
Python, because this test process has most of them loaded already. No TV and no network."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(os.path.dirname(HERE), "bridge")

ANDROID_ONLY = ["adb_shell", "androidtvremote2", "google.protobuf", "rsa", "cryptography"]
FEATURE_ONLY = ["zeroconf", "airtouch5py", "PIL", "mcp", "pydantic"]

# Imports server and builds the app the way `python server.py` does, then prints which of the
# named modules are loaded.
PROBE = """
import json, sys
sys.path.insert(0, ".")
import server
server.make_app()
print(json.dumps([m for m in sys.argv[1:] if m in sys.modules]))
"""


def loaded_after_start(kind, modules):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "config.json")
        with open(path, "w") as f:
            json.dump({"bridge": {"host": "127.0.0.1", "port": 5400, "pairing_key": ""},
                       "default_tv": "lounge",
                       "tvs": [{"id": "lounge", "name": "Lounge", "kind": kind, "ip": "192.0.2.10"}]}, f)
        env = dict(os.environ, COUCH_CONFIG=path)
        out = subprocess.run([sys.executable, "-c", PROBE, *modules], cwd=BRIDGE, env=env,
                             capture_output=True, text=True, timeout=60)
    if out.returncode:
        raise AssertionError(out.stderr)
    return json.loads(out.stdout.strip().splitlines()[-1])


class LazyImportTests(unittest.TestCase):
    def test_samsung_only_bridge_loads_no_android_or_feature_libraries(self):
        self.assertEqual(loaded_after_start("samsung", ANDROID_ONLY + FEATURE_ONLY), [])

    def test_android_tv_still_loads_its_libraries(self):
        self.assertEqual(loaded_after_start("android", ["adb_shell", "androidtvremote2"]),
                         ["adb_shell", "androidtvremote2"])


if __name__ == "__main__":
    unittest.main()
