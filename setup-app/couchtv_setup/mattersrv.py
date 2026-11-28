"""N13b (28 Nov 2026): the Matter controller for the Couch TV Helper's bridge (web TVs: Samsung, LG), installed on first use.

The bridge's Matter controller is the npm package matter-server (about 170 MB with what it needs, docs/MATTER.md). It is not in the
Helper's build, and inside the app the bridge's own folder is a read only unpack, so the first time Matter is added Setup installs it
into the Helper's own writable folder (helper-data/matter-service/app, mode 700), the same way scripts/matter-setup.sh does on a
computer that runs the bridge from source:
- `npm ci` from bridge/matter/package-lock.json (the lock file in the app): exact versions, and every package checked against the
  integrity hash (sha512) in that lock file. Nothing is chosen at install time.
- --ignore-scripts: no package runs any code while installing. matter-server does not need an install script (matter.js is plain
  JavaScript, nothing is compiled), so nothing is lost.
- --omit=optional leaves out the Bluetooth and USB add ons the bridge never uses; the one optional package the service cannot start
  without (@matter/nodejs) is put back by name and must have the very checksum the lock file pins.
- npm and node come from the computer's own Node when it has npm beside it, else the Helper's own Node (nodejs.py, from the verified
  nodejs.org archive). npm is told to ignore the person's own npm settings (a private registry or token is never used or sent).
- It is built in a staging folder next to the final one and moved into place whole, with a small marker file written last, so the bridge
  never sees half an install. A second call finds the marker and does nothing. A stopped or failed install leaves only the staging
  folder (cleaned at the next try) and npm's download cache (kept so the next try resumes quickly, removed once it works).
Nothing outside helper-data is written. Nothing secret is logged: npm's output is scrubbed of tokens and never shown to the person.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import time

from . import nodejs, paths
from .tv import TvError

ENTRY_PARTS = ("node_modules", "matter-server", "dist", "esm", "bin.js")   # the same as bridge/matter.py ENTRY_PARTS
MARKER = ".couchtv-matter.json"
NPM_TIMEOUT = 15 * 60
NEED_FREE_MB = 600          # installed about 170 MB, plus npm's cache while it works
WORDS = "Getting Matter ready, about 2 minutes, one time only"
SIZE_MB = 170
LOCK_STALE = 30 * 60
NPM_ARGS = ["--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"]
OFFLINE = re.compile(r"ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|network|socket hang up|ESOCKETTIMEDOUT|offline|"
                     r"ERR_SOCKET_TIMEOUT|EPROTO|certificate", re.I)
SECRET = re.compile(r"(_authToken|_auth|_password)\s*=\s*\S+|Bearer\s+\S+|npm_[A-Za-z0-9]{20,}|(?<=//)[^/\s:@]+:[^/\s@]+@", re.I)


def root():
    return paths.data() / "helper-data" / "matter-service"


def service_dir():
    return root() / "app"


def entry_of(d):
    return os.path.join(str(d), *ENTRY_PARTS)


def bridge_matter_dir():
    """bridge/matter/ (package.json and package-lock.json) as the app carries it."""
    from .helper import bridge_proc
    return bridge_proc.bridge_dir() / "matter"


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def _marker(d):
    try:
        with open(os.path.join(str(d), MARKER), encoding="utf-8") as f:
            m = json.load(f)
        return m if isinstance(m, dict) else None
    except (OSError, ValueError):
        return None


def installed(src=None):
    """Is the service installed whole (marker there, entry file there)? True, and also whether it matches this app's lock file:
    returns (present, current)."""
    d = service_dir()
    m = _marker(d)
    present = bool(m and os.path.isfile(entry_of(d)))
    if not present:
        return False, False
    try:
        cur = m.get("lock") == _sha(os.path.join(str(src or bridge_matter_dir()), "package-lock.json"))
    except OSError:
        cur = True      # the app has no lock file to compare with: what is installed stays in use
    return True, cur


def for_bridge():
    """The folder to put in the bridge's config (matter.service_dir) once the service is installed, else None."""
    present, _ = installed()
    return str(service_dir()) if present else None


def scrub(text):
    return SECRET.sub("[hidden]", text or "")


def _private(d):
    os.makedirs(d, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass


def _inside_root(p):
    r = os.path.realpath(root())
    t = os.path.realpath(p)
    return t != r and os.path.commonpath([r, t]) == r


def _remove(p):
    """Removes one folder or file, only ever inside helper-data/matter-service (a link is unlinked, never followed)."""
    p = str(p)
    if not os.path.lexists(p):
        return
    if os.path.islink(p) or os.path.isfile(p):
        os.unlink(p)
        return
    if not _inside_root(p):
        raise TvError("Matter's folder is not where it should be, so it was left alone.", "matter_path")
    nodejs._rmtree(p)


def _free_mb(path):
    try:
        return shutil.disk_usage(str(path)).free // (1024 * 1024)
    except OSError:
        return 10 ** 9


class _Lock:
    """One install at a time: a lock file made in one step (O_EXCL), thrown away when older than 30 minutes (a crashed Setup)."""

    def __init__(self, path):
        self.path = str(path)

    def __enter__(self):
        for _ in range(2):
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.path) > LOCK_STALE:
                        os.unlink(self.path)
                        continue
                except OSError:
                    continue
                break
        raise TvError("Matter is already being set up (maybe in another window). Wait a few minutes, then try again.", "matter_busy_install")

    def __exit__(self, *a):
        try:
            os.unlink(self.path)
        except OSError:
            pass


def _env(r, base=None):
    """npm's environment: the computer's own, but its own settings files empty (no private registry or token), its cache in helper-data."""
    env = dict(base if base is not None else os.environ)
    empty, empty_global = os.path.join(str(r), "npmrc-empty"), os.path.join(str(r), "npmrc-empty-global")   # npm refuses one file as both
    for e in (empty, empty_global):
        if not os.path.exists(e):
            with open(e, "w") as f:
                f.write("")
    for k in [k for k in env if k.lower().startswith("npm_config_") or k.upper() in ("NPM_TOKEN", "NODE_AUTH_TOKEN")]:
        del env[k]
    env.update({"npm_config_userconfig": empty, "npm_config_globalconfig": empty_global, "npm_config_cache": os.path.join(str(r), "npm-cache"),
                "npm_config_update_notifier": "false", "npm_config_audit": "false", "npm_config_fund": "false",
                "npm_config_ignore_scripts": "true"})
    return env


def run_default(cmd, env, cwd, timeout):
    """(return code, output text). Never raises for a program that fails to run: returns (-1, why)."""
    try:
        p = subprocess.run(cmd, env=env, cwd=cwd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return -2, "timed out"
    except (OSError, subprocess.SubprocessError) as e:
        return -1, str(e)


def _fail(out, log):
    """Plain words for a failed npm run; the scrubbed tail goes to the log (a file in matter-service), never to the person."""
    tail = scrub("\n".join((out or "").strip().splitlines()[-25:]))
    try:
        with open(log, "w", encoding="utf-8") as f:
            f.write(tail + "\n")
        os.chmod(log, 0o600)
    except OSError:
        pass
    if OFFLINE.search(out or ""):
        raise TvError("Could not reach the internet to get Matter. Check this computer is online, then try again. "
                      "What was fetched is kept, so it carries on from there.", "matter_offline")
    raise TvError("Getting Matter ready did not work. Try again in a minute. If it keeps happening, the Helper's folder has a Matter log.", "matter_install")


def _verify(stage, lock):
    """The one package installed by name (@matter/nodejs) must be the very file the lock pins (same version, same checksum)."""
    key = "node_modules/@matter/nodejs"
    with open(os.path.join(lock), encoding="utf-8") as f:
        want = (json.load(f).get("packages") or {}).get(key) or {}
    try:
        with open(os.path.join(stage, "node_modules", ".package-lock.json"), encoding="utf-8") as f:
            pk = json.load(f).get("packages") or {}
        # npm names an entry by its path from the folder it ran in, so it reads ../../private/... when the folder sits behind a
        # link (macOS temp folders do): the entry is the one that ends the same way
        got = pk.get(key) or next((v for k, v in pk.items() if k == key or k.endswith("/" + key)), None) or {}
    except (OSError, ValueError):
        got = {}
    return bool(want.get("integrity") and got.get("integrity") == want["integrity"] and got.get("version") == want.get("version")), want.get("version")


def ensure(progress=lambda f, msg=None: None, src=None, run=run_default, runner=None):
    """Matter's controller installed in helper-data. Returns {"how": "already"|"installed", "dir", "version"} (a second call does nothing).
    `src` is the folder with package.json and package-lock.json (default: the app's bridge/matter), `run` runs a program (tests pass a pretend),
    `runner` is (node, npm-cli.js) (default: nodejs.npm_runner). Raises TvError in plain words."""
    from pathlib import Path
    srcd = Path(src) if src else bridge_matter_dir()
    present, current = installed(src)
    d = service_dir()
    if present and current:
        m = _marker(d) or {}
        return {"how": "already", "dir": str(d), "version": m.get("version", "")}
    lock, pkg = srcd / "package-lock.json", srcd / "package.json"
    if not (lock.is_file() and pkg.is_file()):
        raise TvError("This Couch TV Helper was built without Matter's package list, so Matter cannot be set up here. Get the newest one from the website.",
                      "matter_nolock")
    r = root()
    _private(r.parent)
    _private(r)
    if _free_mb(r) < NEED_FREE_MB:
        raise TvError("Matter needs about %d MB of free space on this computer. Free some up, then try again." % NEED_FREE_MB, "matter_space")
    with _Lock(r / "install.lock"):
        present, current = installed(src)       # another window may have finished while this one waited for the lock
        if present and current:
            return {"how": "already", "dir": str(d), "version": (_marker(d) or {}).get("version", "")}
        progress(0.02, WORDS)
        node, npm = runner if runner else nodejs.npm_runner(lambda f, m=None: progress(0.02 + 0.2 * f, m))
        stage, old = r / "app.part", r / "app.old"
        _remove(stage)
        _remove(old)
        _private(stage)
        shutil.copyfile(str(pkg), str(stage / "package.json"))
        shutil.copyfile(str(lock), str(stage / "package-lock.json"))
        env = _env(r)
        log = str(r / "install.log")
        base = [node, str(npm)]
        try:
            progress(0.25, WORDS)
            code, out = run(base + ["ci", "--prefix", str(stage)] + NPM_ARGS, env, str(stage), NPM_TIMEOUT)
            if code != 0:
                _fail(out, log)
            version = json.load(open(str(lock), encoding="utf-8"))["packages"]["node_modules/@matter/nodejs"]["version"]
            progress(0.65, WORDS)
            code, out = run(base + ["install", "--prefix", str(stage), "--no-save"] + NPM_ARGS + ["@matter/nodejs@" + version], env, str(stage), NPM_TIMEOUT)
            if code != 0:
                _fail(out, log)
            ok, _ = _verify(str(stage), str(lock))
            if not ok:
                raise TvError("Matter's files did not match their checksums, so nothing was kept and nothing was started.", "matter_checksum")
            progress(0.9, "Checking Matter")
            code, out = run([node, entry_of(stage), "--version"], env, str(stage), 60)
            if code != 0:
                _fail(out, log)
            mv = os.path.join(str(stage), "node_modules", "matter-server", "package.json")
            try:
                version = json.load(open(mv, encoding="utf-8")).get("version", "")
            except (OSError, ValueError):
                version = ""
            with open(str(stage / MARKER), "w", encoding="utf-8") as f:
                json.dump({"lock": _sha(str(lock)), "version": version, "at": int(time.time())}, f)
            if os.path.lexists(str(d)):
                os.replace(str(d), str(old))
            os.replace(str(stage), str(d))
        except BaseException:
            _remove(stage)
            raise
        _remove(old)
        _remove(r / "npm-cache")      # kept only while an install did not finish (it makes the next try quick)
        progress(1.0, "Matter is ready")
    return {"how": "installed", "dir": str(d), "version": version}
