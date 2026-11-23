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
    a tiny placeholder library (4 KB or less, any name) that only keeps the folder there.
 4. Where Matter is in an APK, it is there for both armeabi-v7a and arm64-v8a, with libc++_shared.so
    (--matter: it must be in both on-TV APKs).
 5. Native libraries are compressed in every APK, named lib*.so (Android unpacks nothing else), each
    APK is under its size limit, and each on-TV processor folder unpacks to no more than the TV's free
    space check counts (UNPACKED_MAX, the figures in on-tv UpdateRules.unpacked).
 6. couch-tv-ontv.apk and couch-tv-ontv-watch.apk are the same app, version name and versionCode (Make
    Home open Couch TV installs the watch copy of the very version the TV has). And each is the right
    one: couch-tv-ontv.apk asks for no accessibility service, couch-tv-ontv-watch.apk for exactly one
    (BIND_ACCESSIBILITY_SERVICE in the manifest), so the two files can never be swapped.
 7. Every APK is signed with one and the same key, and with --signer (or --previous, last release's APK)
    the key the TVs already have: Update now, the launcher's Updater and Android itself refuse another.
    With --ontv-signer (from 0.13.11, the on-TV app's own release key, scripts/sign-ontv.sh): the two on-TV
    APKs show that key to Android 9 and newer, the --signer key to Android 6 to 8, and carry the proof of
    rotation from the --signer key to it; every other APK keeps the --signer key; --previous must be
    in the on-TV APKs' keys (the old key, or the release key once a rotated release is out).

Usage: python3 scripts/check-release-apks.py [dist] [--release] [--matter] [--signer SHA256] [--ontv-signer SHA256]
                                             [--previous OLD.apk] [--skip-signer] [--version X.Y.Z]
--version: versionName of the home and on-TV APKs must be X.Y.Z; with --previous, the on-TV APK's
versionCode must be higher than that one's.
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


PLACEHOLDER_MAX = 4096   # nl-matter-android's libmatternone.so: 1,300 (x86) and 1,880 (x86_64) bytes
# What Android unpacks per processor from an on-TV APK, the same figures as on-tv UpdateRules.unpacked():
# the free space check on the TV counts these, so a release with more would fill a TV it said had room.
UNPACKED_MAX = {"arm64-v8a": 15_700_000, "armeabi-v7a": 8_600_000, "x86_64": 2_600_000, "x86": 2_400_000}


def placeholder(info):
    """A tiny library that only keeps a processor folder in the APK (the launcher's Intel folders):
    decided by its size, not its name, so any name the build gives it works. Every real library in
    these APKs is far bigger (the smallest, libspake2.so, is tens of KB)."""
    return info.file_size <= PLACEHOLDER_MAX


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
    # Android only unpacks lib/<abi>/lib*.so: any other name stays in the APK and is never loaded
    for abi, v in sorted(libs.items()):
        for lib in sorted(v):
            if not lib.startswith("lib"):
                errs.append(f"{n}: lib/{abi}/{lib} does not start with \"lib\": Android never unpacks it")
    if n in ONTV:
        for abi, most in UNPACKED_MAX.items():
            size = sum(i.file_size for i in libs.get(abi, {}).values())
            if size > most:
                errs.append(f"{n}: lib/{abi} unpacks to {size:,} bytes, over the {most:,} the TV's free space check counts (UpdateRules.unpacked)")
    if sets:
        for abi in ARM + INTEL:
            if abi not in sets:
                errs.append(f"{n}: native libraries inside but no lib/{abi} folder: Android refuses to install it on a TV with that processor")
        every = set().union(*sets.values())
        # a placeholder that only keeps the Intel folders there is never loaded: ARM folders need not have it
        intel_only = {x for x in every if not any(x in sets.get(a, set()) for a in ARM)
                      and all(placeholder(libs[a][x]) for a in INTEL if x in libs.get(a, {}))}
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


def signers(apk, min_sdk=None, max_sdk=None):
    """The SHA-256 of every signing certificate, from apksigner (which also verifies the signature). With
    min_sdk / max_sdk: the signer Android of those versions sees (a rotated APK shows the old key to Android 8
    and older, the new one from its rotation version on)."""
    cmd = [tool("apksigner"), "verify", "--print-certs"]
    if min_sdk is not None:
        cmd += ["--min-sdk-version", str(min_sdk)]
    if max_sdk is not None:
        cmd += ["--max-sdk-version", str(max_sdk)]
    r = subprocess.run(cmd + [str(apk)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{Path(apk).name} does not verify: {(r.stderr or r.stdout).strip()[:200]}")
    return sorted(set(re.findall(r"Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})", r.stdout)))


def lineage(apk):
    """The proof of rotation's certificates (oldest first) in a v3 signed APK, or [] when it has none."""
    r = subprocess.run([tool("apksigner"), "lineage", "--in", str(apk), "--print-certs"], capture_output=True, text=True)
    if r.returncode != 0:
        return []
    return re.findall(r"Signer #\d+ in lineage certificate SHA-256 digest: ([0-9a-f]{64})", r.stdout)


# The on-TV app's key rotation (0.13.11 on, coord/GOOGLE-PLAY-BUILD.md, scripts/sign-ontv.sh): from this
# Android version on the on-TV APKs are signed by the Couch TV release key, below it by the old key.
ROTATION_SDK = 28


def check_ontv_rotation(dist, ontv, expect=None, previous=None):
    """Rule 7 for a release whose on-TV APKs moved to their own key (--ontv-signer). The on-TV APKs: Android 9
    and newer see only the release key (ontv), Android 6 to 8 only the old key (expect: TVs that cannot rotate
    still update), and the proof of rotation runs from the old key to the release key. Every other APK: the old
    key, as before. --previous (last release's on-TV APK): its signer is the old key or the release key, so
    Android and Update now take this release as an update."""
    errs = []
    ontv = ontv.lower()
    old = expect.lower() if expect else None
    seen = {}
    for p in sorted(dist.glob("*.apk")):
        try:
            if p.name in ONTV:
                new_side = signers(p, min_sdk=ROTATION_SDK)
                old_side = signers(p, max_sdk=ROTATION_SDK - 1)
                lin = lineage(p)
                if new_side != [ontv]:
                    errs.append(f"{p.name}: Android 9 and newer see {', '.join(s[:12] for s in new_side) or 'no signer'}, not the release key ({ontv[:12]}...): sign it with scripts/sign-ontv.sh")
                if old and old_side != [old]:
                    errs.append(f"{p.name}: Android 6 to 8 see {', '.join(s[:12] for s in old_side) or 'no signer'}, not the key those TVs have ({old[:12]}...)")
                if old and (len(lin) < 2 or lin[0] != old or lin[-1] != ontv):
                    errs.append(f"{p.name}: no proof of rotation from {old[:12]}... to {ontv[:12]}... (~/.couchtv-keys/couchtv.lineage)")
                seen[p.name] = set(new_side) | set(old_side) | set(lin)
            else:
                got = signers(p)
                if old and got != [old]:
                    errs.append(f"{p.name} is not signed with the key TVs already have ({old[:12]}...): they would refuse it")
        except RuntimeError as x:
            errs.append(str(x))
    if previous and not errs:
        try:
            prev = signers(Path(previous))
        except RuntimeError as x:
            return errs + [f"--previous: {x}"]
        for n, keys in seen.items():
            if not set(prev) <= keys:
                errs.append(f"{n} does not carry last release's key ({', '.join(s[:12] for s in prev)}...): TVs would refuse it")
    return errs


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
    got = {}
    for p in sorted(dist.glob("*.apk")):
        try:
            got[p.name] = signers(p)
        except RuntimeError as x:
            errs.append(str(x))
    if errs:
        return errs
    keys = {tuple(v) for v in got.values()}
    if len(keys) > 1:
        errs.append("the APKs are signed with different keys: " + "; ".join(f"{k} {v[0][:12]}" for k, v in got.items()))
    want = []
    if expect:
        want.append(expect.lower())
    if previous:
        try:
            want += signers(Path(previous))
        except RuntimeError as x:
            errs.append(f"--previous: {x}")
    for w in want:
        for n, v in got.items():
            if w not in v:
                errs.append(f"{n} is not signed with the key TVs already have ({w[:12]}...): they would refuse it")
    return errs


def check_version(dist, version, previous=None, badge=None):
    """The release's version is the one inside: versionName of couch-tv-home.apk and couch-tv-ontv.apk
    equal --version, and couch-tv-ontv.apk's versionCode is higher than last release's (--previous), or
    Update now and Android would not take it as an update."""
    badge = badge or badging
    if badge is badging and not tool("aapt2"):
        return ["aapt2 not found (set ANDROID_HOME): cannot check the version inside the APKs"]
    errs = []
    for n in ["couch-tv-home.apk", "couch-tv-ontv.apk"]:
        p = dist / n
        if not p.is_file():
            continue
        try:
            _, code, name = badge(p)
        except (RuntimeError, subprocess.CalledProcessError) as x:
            errs.append(f"{n}: cannot read its version ({x})")
            continue
        if name != version:
            errs.append(f"{n} is version {name}, not {version}: built from the wrong commit?")
        if n == "couch-tv-ontv.apk" and previous:
            try:
                _, old, oldname = badge(Path(previous))
            except (RuntimeError, subprocess.CalledProcessError) as x:
                errs.append(f"--previous: cannot read its version ({x})")
                continue
            if code <= old:
                errs.append(f"{n} has versionCode {code}, not higher than last release's {old} ({oldname}): TVs would not update")
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dist", nargs="?", default=str(ROOT / "dist"))
    ap.add_argument("--release", action="store_true", help="SHA256SUMS.txt must be there and right")
    ap.add_argument("--matter", action="store_true", help="the on-TV APKs must carry Matter")
    ap.add_argument("--signer", help="SHA-256 of the signing certificate TVs already have")
    ap.add_argument("--ontv-signer", help="SHA-256 of the Couch TV release key the on-TV APKs rotate to (rule 7)")
    ap.add_argument("--previous", help="last release's APK: the same signer")
    ap.add_argument("--skip-signer", action="store_true")
    ap.add_argument("--version", help="the release's version: versionName of the home and on-TV APKs")
    a = ap.parse_args(argv)
    dist = Path(a.dist)
    errs = check_names(dist) + check_sums(dist, a.release)
    for p in sorted(dist.glob("*.apk")):
        on = p.name in ONTV
        errs += check_libs(p, need_matter=a.matter and on, compressed=True)
    errs += check_same_app(dist)
    errs += check_plain_and_watch(dist)
    if not a.skip_signer:
        errs += check_ontv_rotation(dist, a.ontv_signer, a.signer, a.previous) if a.ontv_signer else check_signer(dist, a.signer, a.previous)
    if a.version:
        errs += check_version(dist, a.version, a.previous)
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
