#!/usr/bin/env python3
"""Checks the TV apps in dist/ before they go on a GitHub release. Exit 0 only when every rule holds.

Why these rules (Matter, 20 Nov 2026). The on-TV app carries Matter's controller, a native library for
two processors: libCHIPController.so is 6.4 MB for 32 bit ARM (armeabi-v7a, most TVs and Fire TV sticks)
and 12.3 MB for 64 bit ARM (arm64-v8a), stripped. A TV cannot say which it has to any of the ways the app
reaches it: Downloader's code 8180170 and github.com/.../releases/latest/download/couch-tv-ontv.apk (the
TV's own steps and couch-tv Studio), couch-tv Setup on a computer, Update now on the TV, and Make Home
open Couch TV (couch-tv-ontv-watch.apk). So a release has ONE file per app, the same names as always,
with every processor inside, and the native libraries compressed (build.gradle.kts, useLegacyPackaging):

  measured on real release builds of couch-tv-ontv.apk (nl-matter-packaging, 20 Nov 2026):
    0.13.9 as it is, no Matter                        44.49 MB
    + Matter, libraries stored (the Android default)  65.31 MB  (+20.82)
    + Matter, libraries compressed (this)             45.79 MB  (+1.30: Conscrypt compresses too)
    one file per processor, compressed                39.56 MB (armeabi-v7a), 40.46 MB (arm64-v8a)
  Installed, Android unpacks this TV's own libraries: 8.6 MB (armeabi-v7a) or 15.7 MB (arm64-v8a).
  One file per processor would save about 6 MB more per download, and every path above would have to
  pick its file; the Downloader code and the latest/download link cannot. Not worth it.

The rules:
 1. The names: couch-tv-home.apk, couch-tv-ontv.apk, couch-tv-ontv-watch.apk (couch-tv-sync.apk if
    built). Nothing else ending in .apk: no per-processor files that a link could point at by mistake.
 2. SHA256SUMS.txt (scripts/release-checksums.sh) lists every APK, and every file it lists (the two
    Samsung files too) is in dist with that very SHA-256 (--release).
 3. An APK with any native library has a folder for all four processors (armeabi-v7a, arm64-v8a, x86,
    x86_64): Android refuses to install an APK with native libraries but none for the TV's processor
    (INSTALL_FAILED_NO_MATCHING_ABIS), so an ARM only launcher would never install on an Intel TV.
    Every processor folder has the same native libraries, or a TV of the other kind would start
    without one and stop the moment it is needed (Android installs only one folder). Intel folders
    may lack Matter alone (the app must say Matter is not available there, not crash), and may hold
    a tiny placeholder library (a name with "placeholder" in it) that only keeps the folder there.
 4. Where Matter is in an APK, it is there for both armeabi-v7a and arm64-v8a, with libc++_shared.so
    (--matter: it must be in both on-TV APKs).
 5. Native libraries are compressed in every APK, and each APK is under its size limit.
 6. couch-tv-ontv.apk and couch-tv-ontv-watch.apk are the same app, version name and versionCode (Make
    Home open Couch TV installs the watch copy of the very version the TV has). And each is the right
    one: couch-tv-ontv.apk asks for no accessibility service, couch-tv-ontv-watch.apk for exactly one
    (BIND_ACCESSIBILITY_SERVICE in the manifest), so the two files can never be swapped.
 7. Every APK is signed with one and the same key, and with --signer (or --previous, last release's APK)
    the key the TVs already have: Update now, the launcher's Updater and Android itself refuse another.

Usage: python3 scripts/check-release-apks.py [dist] [--release] [--matter] [--signer SHA256]
                                             [--previous OLD.apk] [--skip-signer]
Needs the Android SDK's build tools (aapt2 and apksigner, ANDROID_HOME) for rules 6 and 7.
"""
import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = ["couch-tv-home.apk", "couch-tv-ontv.apk", "couch-tv-ontv-watch.apk"]
OPTIONAL = ["couch-tv-sync.apk"]
ONTV = ["couch-tv-ontv.apk", "couch-tv-ontv-watch.apk"]
ARM = ["armeabi-v7a", "arm64-v8a"]
INTEL = ["x86", "x86_64"]
MATTER_LIBS = ["libCHIPController.so", "libc++_shared.so"]
MB = 1_000_000
# A little over what was measured, so a stored library or a second copy of Matter fails the release.
LIMIT = {"couch-tv-home.apk": 40 * MB, "couch-tv-ontv.apk": 60 * MB, "couch-tv-ontv-watch.apk": 60 * MB,
         "couch-tv-sync.apk": 5 * MB}


def native(apk):
    """{abi: {library name: ZipInfo}} for lib/<abi>/<name>.so in the APK."""
    out = {}
    with zipfile.ZipFile(apk) as z:
        for i in z.infolist():
            m = re.fullmatch(r"lib/([^/]+)/([^/]+\.so)", i.filename)
            if m:
                out.setdefault(m.group(1), {})[m.group(2)] = i
    return out


def placeholder(lib):
    """A tiny library that only keeps a processor folder in the APK (the launcher's Intel folders)."""
    return "placeholder" in lib


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def check_names(dist):
    errs = []
    names = sorted(p.name for p in dist.glob("*.apk"))
    for n in REQUIRED:
        if n not in names:
            errs.append(f"{n} is missing from {dist}")
    for n in names:
        if n not in REQUIRED + OPTIONAL:
            errs.append(f"{n}: not a release name (one APK per app, every processor inside; see the top of this script)")
    return errs


def check_sums(dist, required):
    f = dist / "SHA256SUMS.txt"
    if not f.is_file():
        return ["SHA256SUMS.txt is missing: run sh scripts/release-checksums.sh"] if required else []
    listed = {}
    for line in f.read_text().splitlines():
        m = re.fullmatch(r"([0-9a-f]{64})\s+\*?(\S+)", line.strip())
        if m:
            listed[m.group(2)] = m.group(1)
    errs = []
    for p in sorted(dist.glob("*.apk")):
        if p.name not in listed:
            errs.append(f"SHA256SUMS.txt does not list {p.name}")
        elif listed[p.name] != sha256(p):
            errs.append(f"SHA256SUMS.txt has another SHA-256 for {p.name} (built again after the sums?)")
    for n, want in sorted(listed.items()):
        if not (dist / n).is_file():
            errs.append(f"SHA256SUMS.txt lists {n}, which is not in dist")
        elif not n.endswith(".apk") and want != sha256(dist / n):
            # the Samsung files: couch-tv Setup checks them against this file too
            errs.append(f"SHA256SUMS.txt has another SHA-256 for {n} (built again after the sums?)")
    return errs


def check_libs(apk, need_matter=False, compressed=False):
    errs = []
    libs = native(apk)
    n = apk.name
    sets = {abi: set(v) for abi, v in libs.items()}
    if sets:
        for abi in ARM + INTEL:
            if abi not in sets:
                errs.append(f"{n}: native libraries inside but no lib/{abi} folder: Android refuses to install it on a TV with that processor")
        every = set().union(*sets.values())
        # a placeholder that only keeps the Intel folders there is never loaded: ARM folders need not have it
        intel_only = {x for x in every if placeholder(x) and not any(x in sets.get(a, set()) for a in ARM)}
        for abi, s in sorted(sets.items()):
            # Intel TVs (x86, x86_64: Conscrypt brings them) may lack only Matter: the app still installs
            # and runs there, and the Matter screens say it is not available on this TV. Dropping those
            # folders instead would stop the app installing on an Intel TV at all.
            want = every - set(MATTER_LIBS) if abi in INTEL else every - intel_only
            if not want <= s:
                errs.append(f"{n}: lib/{abi} lacks {', '.join(sorted(want - s))} (a TV of that kind would miss it)")
    has_matter = any("libCHIPController.so" in s for s in sets.values())
    if need_matter and not has_matter:
        errs.append(f"{n}: no Matter controller (libCHIPController.so) inside")
    if has_matter:
        for abi in ARM:
            for lib in MATTER_LIBS:
                if lib not in sets.get(abi, set()):
                    errs.append(f"{n}: lib/{abi}/{lib} is missing")
    if compressed:
        stored = sorted(f"lib/{abi}/{lib}" for abi, v in libs.items() for lib, i in v.items()
                        if i.compress_type != zipfile.ZIP_DEFLATED)
        if stored:
            errs.append(f"{n}: {len(stored)} native libraries stored, not compressed ({stored[0]}...): keep useLegacyPackaging = true")
    if apk.stat().st_size > LIMIT.get(n, 60 * MB):
        errs.append(f"{n}: {apk.stat().st_size / MB:.1f} MB, over its {LIMIT.get(n, 60 * MB) / MB:.0f} MB limit")
    return errs


def tool(name):
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or str(Path.home() / "Library/Android/sdk")
    bt = Path(sdk) / "build-tools"
    found = sorted(bt.glob(f"*/{name}")) if bt.is_dir() else []
    return str(found[-1]) if found else shutil.which(name)


def badging(apk):
    """(package, versionCode, versionName) from aapt2."""
    out = subprocess.run([tool("aapt2"), "dump", "badging", str(apk)], capture_output=True, text=True, check=True).stdout
    m = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", out)
    if not m:
        raise RuntimeError(f"aapt2 gave no package line for {apk.name}")
    return m.group(1), int(m.group(2)), m.group(3)


def signers(apk):
    """The SHA-256 of every signing certificate, from apksigner (which also verifies the signature)."""
    r = subprocess.run([tool("apksigner"), "verify", "--print-certs", str(apk)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{apk.name} does not verify: {(r.stderr or r.stdout).strip()[:200]}")
    return sorted(set(re.findall(r"certificate SHA-256 digest: ([0-9a-f]{64})", r.stdout)))


def check_same_app(dist):
    a, b = (dist / n for n in ONTV)
    if not (a.is_file() and b.is_file()):
        return []
    if not tool("aapt2"):
        return ["aapt2 not found (set ANDROID_HOME): cannot check the two on-TV APKs are the same version"]
    x, y = badging(a), badging(b)
    return [] if x == y else [f"{a.name} is {x} but {b.name} is {y}: they must be the same app and version"]


def accessibility_services(apk):
    """How many services in the APK's manifest ask for android.permission.BIND_ACCESSIBILITY_SERVICE."""
    out = subprocess.run([tool("aapt2"), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)],
                         capture_output=True, text=True, check=True).stdout
    return count_accessibility(out)


def count_accessibility(xmltree):
    """In aapt2's xmltree text: android:permission="...BIND_ACCESSIBILITY_SERVICE" on a service. A
    <uses-permission> line names it with android:name instead, so it is not counted."""
    return sum(1 for line in xmltree.splitlines()
               if ":permission(" in line and '="android.permission.BIND_ACCESSIBILITY_SERVICE"' in line)


def check_plain_and_watch(dist):
    """couch-tv-ontv.apk has no accessibility service; couch-tv-ontv-watch.apk has exactly one."""
    want = {"couch-tv-ontv.apk": 0, "couch-tv-ontv-watch.apk": 1}
    errs = []
    for n, w in want.items():
        p = dist / n
        if not p.is_file():
            continue
        if not tool("aapt2"):
            return ["aapt2 not found (set ANDROID_HOME): cannot tell the plain on-TV APK from the watch one"]
        got = accessibility_services(p)
        if got != w:
            kind = "the plain app (no accessibility service)" if w == 0 else "the watch app (one accessibility service)"
            errs.append(f"{n} has {got} accessibility services but must be {kind}: are the two on-TV files swapped?")
    return errs


def check_signer(dist, expect=None, previous=None):
    if not tool("apksigner"):
        return ["apksigner not found (set ANDROID_HOME), or pass --skip-signer"]
    errs = []
    got = {p.name: signers(p) for p in sorted(dist.glob("*.apk"))}
    keys = {tuple(v) for v in got.values()}
    if len(keys) > 1:
        errs.append("the APKs are signed with different keys: " + "; ".join(f"{k} {v[0][:12]}" for k, v in got.items()))
    want = []
    if expect:
        want.append(expect.lower())
    if previous:
        want += signers(Path(previous))
    for w in want:
        for n, v in got.items():
            if w not in v:
                errs.append(f"{n} is not signed with the key TVs already have ({w[:12]}...): they would refuse it")
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dist", nargs="?", default=str(ROOT / "dist"))
    ap.add_argument("--release", action="store_true", help="SHA256SUMS.txt must be there and right")
    ap.add_argument("--matter", action="store_true", help="the on-TV APKs must carry Matter")
    ap.add_argument("--signer", help="SHA-256 of the signing certificate TVs already have")
    ap.add_argument("--previous", help="last release's APK: the same signer")
    ap.add_argument("--skip-signer", action="store_true")
    a = ap.parse_args(argv)
    dist = Path(a.dist)
    errs = check_names(dist) + check_sums(dist, a.release)
    for p in sorted(dist.glob("*.apk")):
        on = p.name in ONTV
        errs += check_libs(p, need_matter=a.matter and on, compressed=True)
    errs += check_same_app(dist)
    errs += check_plain_and_watch(dist)
    if not a.skip_signer:
        errs += check_signer(dist, a.signer, a.previous)
    for p in sorted(dist.glob("*.apk")):
        libs = native(p)
        m = "Matter " + "+".join(abi for abi in ARM if "libCHIPController.so" in libs.get(abi, {})) if any(
            "libCHIPController.so" in v for v in libs.values()) else "no Matter"
        print(f"  {p.name:26} {p.stat().st_size / MB:6.1f} MB  {m}")
    if errs:
        print(f"RELEASE CHECK FAILED ({len(errs)}):")
        for e in errs:
            print("  - " + e)
        return 1
    print("release check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
