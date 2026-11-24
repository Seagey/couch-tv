"""Remove everything from this computer: stops the helper, takes out the start-up item, and deletes what Setup
keeps here (the TV key, helper settings, tokens, the bridge's data, downloads). The TV is not touched: tell the person
to Forget the key on each TV (Wireless debugging, Paired devices, couch-tv-setup) and, if they like, use
Take couch-tv off a TV first (that needs the key, so it comes before this).
"""
import shutil
from pathlib import Path

from .. import paths
from . import autostart

KEEP_WORDS = ("couch-tv Setup", "couch-tv-setup")


def _own_folder(p):
    """Only ever Setup's own folders: named for the app, or the one COUCHTV_SETUP_HOME names."""
    import os
    if p.is_symlink() or p.resolve() in (Path.home().resolve(), Path(p.anchor).resolve()):
        return False   # a link could lead anywhere; never the home folder or the root
    env = os.environ.get("COUCHTV_SETUP_HOME")
    if env:   # tests and portable installs: that folder when it holds Setup's own files, and its cache folder
        here, root = p.resolve(), Path(env).resolve()
        if here == root / "cache":   # only a cache folder Setup itself made: it leaves a marker or its update folder
            return (here / ".couchtv-setup").exists() or (here / "helper-update").is_dir()
        return here == root and any((root / n).exists() for n in ("helper.json", "known-tvs.json", "helper-data", "helper-bridge-config.json"))
    return p.name in KEEP_WORDS or p.parent.name in KEEP_WORDS


def everything(data=None, cache=None, disable=autostart.disable, stop=None):
    """Returns what was removed, as a list of short names. `stop` stops a running helper first."""
    if stop:
        stop()
    removed = []
    if disable():
        removed.append("start with this computer")
    for folder in (Path(data) if data else paths.data(), Path(cache) if cache else paths.cache()):
        if not folder.is_dir() or not _own_folder(folder):
            continue
        for item in folder.iterdir():
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)
            removed.append(item.name)
    return removed


FORGET = ("On each TV, open Wireless debugging, Paired devices, and Forget couch-tv-setup. "
          "Delete the app itself to finish.")
