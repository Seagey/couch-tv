"""Stamps the Setup app's version (couchtv_setup.__version__) into the built program, so it never shows
PyInstaller's 0.0.0.

  python stamp_version.py windows-file version.txt   writes the file details for pyinstaller --version-file
  python stamp_version.py mac-plist "<app>/Contents/Info.plist"   sets CFBundleShortVersionString and CFBundleVersion
  python stamp_version.py                             prints the version
"""
import plistlib
import sys

from couchtv_setup import __version__


def parts(v=__version__):
    nums = [int(x) for x in v.split(".")]
    return tuple((nums + [0, 0, 0, 0])[:4])


def windows_file(v=__version__):
    p = parts(v)
    return f"""# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(filevers={p}, prodvers={p}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'couch-tv'),
      StringStruct('FileDescription', 'couch-tv Setup'),
      StringStruct('FileVersion', '{v}'),
      StringStruct('InternalName', 'couch-tv Setup'),
      StringStruct('LegalCopyright', 'MIT licence, github.com/Seagey/couch-tv'),
      StringStruct('OriginalFilename', 'couch-tv Setup.exe'),
      StringStruct('ProductName', 'couch-tv Setup'),
      StringStruct('ProductVersion', '{v}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def mac_plist(path, v=__version__):
    with open(path, "rb") as f:
        info = plistlib.load(f)
    info["CFBundleShortVersionString"] = v
    info["CFBundleVersion"] = v
    with open(path, "wb") as f:
        plistlib.dump(info, f)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "windows-file":
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(windows_file())
    elif len(sys.argv) == 3 and sys.argv[1] == "mac-plist":
        mac_plist(sys.argv[2])
    elif len(sys.argv) == 1:
        print(__version__)
    else:
        sys.exit(__doc__)
