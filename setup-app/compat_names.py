"""The old name inside the new archives (0.13.15 renamed "couch-tv Setup" to "Couch TV Setup").

An installed Helper from 0.13.14 or older still has the OLD updater (helper/update.py). It unpacks the new archive,
moves the one folder or .app in it to where the old copy was, and starts "<that folder>/couch-tv Setup" (Windows:
"couch-tv Setup.exe"; Mac: open -a on the .app). So the new archive must also hold a program called the old name, or
the update would succeed and then start nothing. This adds it. The workflow runs it right after PyInstaller:

    python compat_names.py windows "dist/Couch TV Setup"       a copy of the program under the old name
    python compat_names.py linux   "dist/Couch TV Setup"       a small launcher under the old name
    python compat_names.py mac     "dist/Couch TV Setup.app"   the display names inside the app (see below)

tests/test_old_updater.py runs the real 0.13.14 updater against archives made this way.

The old name is only a way in. The new program starts from it, the new Helper moves the start with the computer
entry to the real program (autostart.refresh), and the next update puts the new copy under the new name.
On a Mac nothing is added to the folder: the old updater starts the .app, whatever the program inside is called.
"""
import plistlib
import shutil
import stat
import sys
from pathlib import Path

NEW = "Couch TV Setup"
OLD = "couch-tv Setup"


def windows(folder):
    folder = Path(folder)
    exe = folder / (NEW + ".exe")
    if not exe.is_file():
        raise SystemExit("not found: %s" % exe)
    # onedir: the program reads its own packed code and the _internal folder beside it, so a copy under the old
    # name runs exactly the same program
    shutil.copy2(exe, folder / (OLD + ".exe"))


def linux(folder):
    folder = Path(folder)
    if not (folder / NEW).is_file():
        raise SystemExit("not found: %s" % (folder / NEW))
    launcher = folder / OLD
    launcher.write_text('#!/bin/sh\nexec "$(dirname "$0")/%s" "$@"\n' % NEW, encoding="utf-8")
    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def mac(app):
    """The names inside the .app, in the plist and in en.lproj. Finder shows the file name first, so a copy an old
    updater puts under the old file name still reads "couch-tv Setup" there (BUILD.md, Name); these are what
    System Settings, the menu bar and Spotlight's app name use."""
    app = Path(app)
    plist = app / "Contents" / "Info.plist"
    info = plistlib.loads(plist.read_bytes())
    info["CFBundleName"] = NEW
    info["CFBundleDisplayName"] = NEW
    info["CFBundleLocalizations"] = ["en"]
    plist.write_bytes(plistlib.dumps(info))
    lproj = app / "Contents" / "Resources" / "en.lproj"
    lproj.mkdir(parents=True, exist_ok=True)
    (lproj / "InfoPlist.strings").write_text('"CFBundleName" = "%s";\n"CFBundleDisplayName" = "%s";\n' % (NEW, NEW),
                                             encoding="utf-8")


if __name__ == "__main__":
    kinds = {"windows": windows, "linux": linux, "mac": mac}
    if len(sys.argv) != 3 or sys.argv[1] not in kinds:
        raise SystemExit(__doc__)
    kinds[sys.argv[1]](sys.argv[2])
