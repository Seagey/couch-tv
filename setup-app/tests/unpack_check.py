"""Unpacks the built archive the way the helper's updater does (update.unpack), then runs the smoke tests on the
unpacked copy. A Mac .app holds symlinks and run permissions that Python's zipfile drops; the first gate review
found the updater would have left every Mac helper unable to start. Used by the build workflow on each computer type.

    python setup-app/tests/unpack_check.py <archive> <the program's path inside the archive>   (HELPER_BUNDLED=yes also runs smoke_helper.py)
    (the program's path is relative to the folder the archive was made from, e.g. "Couch TV Setup/Couch TV Setup")
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from couchtv_setup.helper import update  # noqa: E402


def main(archive, program):
    out = Path(tempfile.mkdtemp()) / "new"
    update.unpack(archive, out)
    exe = out / program
    assert exe.is_file(), "the program is not in the unpacked update: " + str(exe)
    if sys.platform != "win32":
        assert os.access(exe, os.X_OK), "the program lost its run permission when unpacked"
    if sys.platform == "darwin":
        app = next(p for p in exe.parents if p.suffix == ".app")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    for smoke in ("smoke.py", "smoke_link.py") + (("smoke_helper.py",) if os.environ.get("HELPER_BUNDLED") == "yes" else ()):
        subprocess.run([sys.executable, str(HERE / smoke), str(exe)], check=True, timeout=600)
    print("unpacked update ok")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
