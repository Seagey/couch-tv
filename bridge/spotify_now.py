"""What Spotify is playing on the account right now, on any device (the TV, a phone, a computer).

couch-tv's Now playing card reads Android's media sessions over ADB. TVs with no ADB (Hisense VIDAA,
LG, Samsung, Roku) have none to read, and a song played from a phone never shows there either.
Spotify's Web API knows both, for the whole account. Optional, and off until set up:

1. developer.spotify.com, Dashboard, Create app (Web API), redirect URI
   http://127.0.0.1:5400/api/spotify/callback (the bridge's port). Spotify needs the app owner on
   Premium for apps in Development Mode.
2. Put the app's Client ID in .env as SPOTIFY_CLIENT_ID=... (no client secret: this uses PKCE).
3. On the bridge computer open http://127.0.0.1:5400/api/spotify/login and log in once.

The tokens live in bridge/data/spotify.json (git ignores it; readable by this user only). Spotify is
asked only while a home or phone asks the bridge, at most once every POLL_S seconds.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import urllib.parse

import aiohttp

import config

log = logging.getLogger("spotify")

AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
PLAYER_URL = "https://api.spotify.com/v1/me/player"
SCOPES = "user-read-currently-playing user-read-playback-state"
POLL_S = 3                      # the bridge answers from its last reading inside this window
TOKEN_FILE = os.path.join(config.DATA, "spotify.json")
APP = {"id": "spotify", "name": "Spotify", "package": "com.spotify.tv.android"}

_pending = {}                   # state -> (code_verifier, redirect_uri, created)
_cache = {"at": 0.0, "item": None, "backoff_until": 0.0}
_lock = asyncio.Lock()


def client_id():
    return (os.environ.get("SPOTIFY_CLIENT_ID") or "").strip()


def _read_tokens():
    try:
        with open(TOKEN_FILE) as f:
            t = json.load(f)
        return t if isinstance(t, dict) and t.get("refresh_token") else None
    except (OSError, ValueError):
        return None


def _write_tokens(t):
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    tmp = TOKEN_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)   # also when a stale .tmp was left with looser rights
    with os.fdopen(fd, "w") as f:
        json.dump(t, f)
    os.replace(tmp, TOKEN_FILE)


def status():
    return {"configured": bool(client_id()), "connected": bool(client_id() and _read_tokens())}


def login_url(redirect_uri):
    """Spotify's login page, with a fresh PKCE verifier remembered for the callback."""
    if not client_id():
        raise ValueError("SPOTIFY_CLIENT_ID is not set in .env")
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v[2] > 600]:
        _pending.pop(k, None)
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    _pending[state] = (verifier, redirect_uri, now)
    q = {"client_id": client_id(), "response_type": "code", "redirect_uri": redirect_uri, "scope": SCOPES,
         "state": state, "code_challenge_method": "S256", "code_challenge": challenge}
    return AUTH_URL + "?" + urllib.parse.urlencode(q)


async def _token_request(form):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as cs:
        async with cs.post(TOKEN_URL, data=form, headers={"Content-Type": "application/x-www-form-urlencoded"}) as r:
            j = await r.json(content_type=None)
            if r.status != 200 or not j.get("access_token"):
                raise RuntimeError(f"Spotify token request failed ({r.status}): {j.get('error_description') or j.get('error')}")
            return j


async def finish_login(state, code):
    """The callback: swap the code for tokens and keep them."""
    entry = _pending.pop(state or "", None)
    if not entry or not code:
        raise ValueError("That login link is stale or was not started here. Open /api/spotify/login again.")
    verifier, redirect_uri, _ = entry
    j = await _token_request({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
                              "client_id": client_id(), "code_verifier": verifier})
    _write_tokens({"access_token": j["access_token"], "refresh_token": j["refresh_token"],
                   "expires_at": time.time() + int(j.get("expires_in", 3600)) - 60})
    _cache.update(at=0.0, item=None, backoff_until=0.0)


async def _access_token():
    t = _read_tokens()
    if not t:
        return None
    if time.time() < t.get("expires_at", 0) and t.get("access_token"):
        return t["access_token"]
    j = await _token_request({"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": client_id()})
    # PKCE refresh tokens can be replaced on renewal: always keep the newest
    t = {"access_token": j["access_token"], "refresh_token": j.get("refresh_token") or t["refresh_token"],
         "expires_at": time.time() + int(j.get("expires_in", 3600)) - 60}
    _write_tokens(t)
    return t["access_token"]


def card_item(j):
    """Spotify's player state as couch-tv's Now playing card item (as music_now() returns), or None
    unless something is playing. source "spotify": the card shows it without the TV's media keys,
    which would not reach a phone."""
    it = (j or {}).get("item") or {}
    if not j or not j.get("is_playing") or not it.get("name"):
        return None
    if j.get("currently_playing_type") == "episode":
        artist, album = (it.get("show") or {}).get("name") or "", ""
        images = it.get("images") or (it.get("show") or {}).get("images") or []
    else:
        artist = ", ".join(a.get("name", "") for a in it.get("artists") or [] if a.get("name"))
        album = (it.get("album") or {}).get("name") or ""
        images = (it.get("album") or {}).get("images") or []
    art = min(images, key=lambda i: abs((i.get("width") or 300) - 300)).get("url") if images else None
    item = {"title": it["name"], "artist": artist, "album": album, "state": "playing", "app": dict(APP),
            "art": art, "source": "spotify", "device": (j.get("device") or {}).get("name") or None}
    if j.get("progress_ms") is not None:
        item["position"] = int(j["progress_ms"]) // 1000
    if it.get("duration_ms"):
        item["duration"] = int(it["duration_ms"]) // 1000
    return item


async def now_playing():
    """The song playing on the account, as a card item, or None. Cached POLL_S seconds; quiet when
    not set up."""
    if not client_id() or not _read_tokens():
        return None
    async with _lock:
        t = time.time()
        if t - _cache["at"] < POLL_S or t < _cache["backoff_until"]:
            return _cache["item"]
        _cache["at"] = t
        try:
            token = await _access_token()
            if not token:
                _cache["item"] = None
                return None
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=6)) as cs:
                async with cs.get(PLAYER_URL, params={"additional_types": "track,episode"},
                                  headers={"Authorization": "Bearer " + token}) as r:
                    if r.status == 204:
                        _cache["item"] = None
                    elif r.status == 200:
                        _cache["item"] = card_item(await r.json(content_type=None))
                    elif r.status == 401:   # revoked or expired early: renew on the next ask
                        tk = _read_tokens()
                        if tk:
                            tk["expires_at"] = 0
                            _write_tokens(tk)
                    elif r.status == 429:
                        wait = int(r.headers.get("Retry-After", "30") or 30)
                        _cache["backoff_until"] = t + min(max(wait, 5), 600)
                        log.warning("Spotify rate limit: waiting %ss", wait)
                    else:
                        log.warning("Spotify now playing: HTTP %s", r.status)
        except Exception as e:   # network blip or a refused renewal: keep the last reading
            log.warning("Spotify now playing failed: %s", e)
        return _cache["item"]
