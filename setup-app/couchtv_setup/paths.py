# Adapted from couch-tv-setup by killy10o10 (couchtv_setup/paths.py).
# MIT License, Copyright (c) 2026 killy10o10. See setup-app/THIRD-PARTY.md for the full notice.
"""Where the setup keeps its own files: its ADB key, the downloaded apps, and what it changed.

macOS: ~/Library/Application Support/couch-tv Setup and ~/Library/Caches/couch-tv Setup.
Windows: %APPDATA%\\couch-tv Setup and %LOCALAPPDATA%\\couch-tv Setup\\Cache.
Linux (from source): ~/.local/share/couch-tv-setup and ~/.cache/couch-tv-setup.
"""
import os
import sys
from pathlib import Path

APP = "couch-tv Setup"


def _base_data():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming") / APP
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "couch-tv-setup"


def _base_cache():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / APP
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / APP / "Cache"
    return Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "couch-tv-setup"


def data():
    p = Path(os.environ.get("COUCHTV_SETUP_HOME") or _base_data())
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache():
    p = Path(os.environ["COUCHTV_SETUP_HOME"]) / "cache" if os.environ.get("COUCHTV_SETUP_HOME") else _base_cache()
    p.mkdir(parents=True, exist_ok=True)
    return p
