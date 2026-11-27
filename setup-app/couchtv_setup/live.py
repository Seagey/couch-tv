"""The finish screen's four extras (lane D, 28 Nov 2026): Ask AI, Connect your own AI, Apps on this TV, Live from this TV.

Everything here is done from the computer, nothing at the TV:
- Ask AI: the person's own key goes into their Couch TV account (POST /v1/setup/key), sealed, https only, and only the TV Setup
  is working on may use it. The account sends it to that TV when the TV's link is trusted. The key is never kept on this computer
  and never shown again (only its last 4).
- Connect your own AI: the lines to paste into Claude Desktop, Claude Code or Cursor. They start this same program with --mcp, which
  runs the TV's MCP server (bridge/mcp_server.py) against the Couch TV Helper on this computer, or against the Couch TV app on the
  TV (paired once with the 6 numbers the TV shows, as a phone is).
- Apps on this TV: the TV's launcher apps (package names only), read again over the connection Setup already has, and sent to the
  account (POST /v1/setup/apps) so the editor's app picker marks "On <TV>".
- Live from this TV: what Keep watching, Keep watching row, Up next, Picks and Now playing will read on this TV, checked now over
  ADB: Android's Watch Next list and the media sessions (the same reads as the bridge, bridge/server.py watch_next and _sessions).
  Read only. The titles found are shown on this page only and are not sent anywhere.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

from . import steps, studio, tvprofile
from .helper import config as hconfig
from .tv import TvError

# who answers Ask AI (the same list and addresses as the TV, tv-home/web/ask.js PROVIDERS). A model at home needs no key, so it is
# set up on the TV itself (Home settings, Ask AI), not kept in the account.
PROVIDERS = [
    {"id": "anthropic", "name": "Claude (Anthropic)", "base": "https://api.anthropic.com", "model": "claude-haiku-5-5",
     "where": "console.anthropic.com, API keys"},
    {"id": "openai", "name": "OpenAI (ChatGPT)", "base": "https://api.openai.com/v1", "model": "", "where": "platform.openai.com, API keys"},
    {"id": "gemini", "name": "Google Gemini", "base": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "",
     "where": "aistudio.google.com, Get API key"},
    {"id": "openrouter", "name": "OpenRouter", "base": "https://openrouter.ai/api/v1", "model": "", "where": "openrouter.ai, Keys"},
    {"id": "groq", "name": "Groq", "base": "https://api.groq.com/openai/v1", "model": "", "where": "console.groq.com, API keys"},
    {"id": "mistral", "name": "Mistral", "base": "https://api.mistral.ai/v1", "model": "", "where": "console.mistral.ai, API keys"},
    {"id": "other", "name": "Another service (OpenAI compatible)", "base": "", "model": "", "where": "The address it gives you, ending in /v1"},
]
MONEY_LINE = "This key can spend your money. Whoever has it can run up charges with that company."
HTTPS_BASE = re.compile(r"^https://[A-Za-z0-9.-]+(:\d{1,5})?(/[^\s?#]*)?$")

WATCH_NEXT_COLS = ["_id", "title", "package_name", "browsable", "last_engagement_time_utc_millis"]
WATCH_NEXT = ("content query --uri content://android.media.tv/watch_next_program --projection " + ":".join(WATCH_NEXT_COLS))
SESSIONS = "dumpsys media_session"
# the names the editor's picker already uses for the common apps; anything else shows its package's last word
APP_NAMES = {
    "com.netflix.ninja": "Netflix", "com.google.android.youtube.tv": "YouTube", "com.amazon.amazonvideo.livingroom": "Prime Video",
    "au.com.stan.and": "Stan", "au.com.foxtel.binge": "Binge", "com.spotify.tv.android": "Spotify", "au.net.abc.iview": "ABC iview",
    "com.sbs.ondemand.tv": "SBS On Demand", "com.disney.disneyplus": "Disney+", "com.apple.atve.androidtv.appletv": "Apple TV",
    "com.cbs.ca": "Paramount+", "au.com.nine.jumpin": "9Now", "au.com.seven.plus": "7plus", "au.com.tenplay": "10",
    "com.kayo.android": "Kayo", "com.plexapp.android": "Plex", "com.google.android.youtube.tvmusic": "YouTube Music",
}


def _provider(pid):
    return next((p for p in PROVIDERS if p["id"] == pid), None)


def app_name(pkg):
    if pkg in APP_NAMES:
        return APP_NAMES[pkg]
    last = [w for w in re.split(r"[._]", pkg) if w and w not in ("android", "tv", "com", "app", "au", "atv", "leanback")]
    return (last[-1] if last else pkg).capitalize()


# ---------------------------------------------------------------- reading the TV (read only)

def parse_watch_next(out):
    """Rows of `content query` ("Row: 0 _id=1, title=Bluey, package_name=..., browsable=1, ..."): titles the apps put in Watch Next."""
    rows = []
    for line in (out or "").splitlines():
        if not line.startswith("Row:"):
            continue
        row, heads = {}, list(re.finditer(r"(?:^Row: \d+ |, )(" + "|".join(WATCH_NEXT_COLS) + r")=", line))
        for i, h in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(line)
            v = line[h.end():end]
            row[h.group(1)] = None if v == "NULL" else v
        if row.get("title") and row.get("browsable") != "0":
            rows.append(row)
    rows.sort(key=lambda r: -int(r.get("last_engagement_time_utc_millis") or 0) if str(r.get("last_engagement_time_utc_millis") or "").isdigit() else 0)
    return rows


def parse_sessions(out):
    """Package, playing or not, and the title of each media session in `dumpsys media_session`."""
    found, cur = [], None
    for line in (out or "").splitlines():
        line = line.strip()
        if line.startswith("package="):
            cur = {"package": line.split("=", 1)[1]}
            found.append(cur)
        elif cur is not None and line.startswith("state=PlaybackState"):
            m = re.search(r"\{state=([A-Z_]+)\(|\{state=(\d+)[,}]", line)
            cur["playing"] = bool(m and (m.group(1) == "PLAYING" or m.group(2) == "3"))
        elif cur is not None and line.startswith("metadata:") and "description=" in line:
            t = line.split("description=", 1)[1].split(", ")[0].strip()
            cur["title"] = None if t in ("null", "") else t[:80]
    return found


def live_state(tv, facts):
    """What the watching and music widgets read on this TV, checked now. Titles stay on this page."""
    def ask(cmd):
        try:
            return tv.shell(cmd, timeout_s=15)
        except Exception:
            return None
    wn_out = ask(WATCH_NEXT)
    rows = parse_watch_next(wn_out) if wn_out is not None else []
    sessions = parse_sessions(ask(SESSIONS) or "")
    ontv = bool(((facts or {}).get("installed") or {}).get("ontv"))
    playing = next((s for s in sessions if s.get("playing")), None)
    music_any = ontv
    return {
        "keep": {"ok": wn_out is not None and "Error" not in (wn_out or ""), "count": len(rows),
                 "shows": [{"title": r["title"][:60], "app": app_name(r.get("package_name") or "")} for r in rows[:3]]},
        "picks": {"ok": True},
        "now": {"any_app": music_any, "spotify_only": not music_any,
                "playing": playing and {"title": playing.get("title"), "app": app_name(playing.get("package") or "")}},
        "ontv": ontv,
        "helper": hconfig.load()["mode"] == "helper",
    }


# ---------------------------------------------------------------- Ask AI into the account

def ask_save(link, body):
    tv_id = (link.tv or {}).get("tv_id")
    if not link.token or not tv_id:
        raise TvError("Link this TV to your Couch TV account first. Then Ask AI can be kept there.", "no_account")
    p = _provider(str(body.get("provider") or ""))
    if not p:
        raise TvError("Pick who answers.", "bad_provider")
    base = (str(body.get("base") or "").strip().rstrip("/") if p["id"] == "other" else p["base"])
    if not HTTPS_BASE.match(base or ""):
        raise TvError("Use the service's https:// address. A key is never sent in the clear.", "bad_base")
    key = re.sub(r"\s+", "", str(body.get("key") or ""))
    if len(key) < 8 or len(key) > 2000:
        raise TvError("That key did not look right. Paste the whole thing.", "bad_key")
    model = re.sub(r"[\x00-\x1f\x7f<>]", "", str(body.get("model") or p["model"] or "")).strip()[:120]
    ans = studio.call("/v1/setup/key", {"tv_id": tv_id, "kind": "ai", "provider": p["id"], "base": base, "model": model or None,
                                        "key": key}, link.token)
    shown = ans.get("shown") if isinstance(ans.get("shown"), dict) else {}
    return {"saved": True, "last4": str(shown.get("last4") or "")[-4:], "money_line": ans.get("money_line") or MONEY_LINE,
            "trusted": ans.get("trusted") is True, "sent": ans.get("sent") is True}


def ask_remove(link):
    tv_id = (link.tv or {}).get("tv_id")
    if not link.token or not tv_id:
        raise TvError("Link this TV to your Couch TV account first.", "no_account")
    studio.call("/v1/setup/key", {"tv_id": tv_id, "kind": "ai", "remove": True}, link.token)
    return {"removed": True}


# ---------------------------------------------------------------- your own AI: the lines to copy

def mcp_command():
    """How to start the TV's MCP server from this computer: this program with --mcp (the built app carries the bridge)."""
    if getattr(sys, "frozen", False):
        return sys.executable, ["--mcp"]
    return sys.executable, ["-m", "couchtv_setup", "--mcp"]


def agent_lines(url, key, pythonpath=None):
    cmd, args = mcp_command()
    env = {"BRIDGE_URL": url, "BRIDGE_KEY": key}
    if pythonpath:
        env["PYTHONPATH"] = pythonpath
    desktop = json.dumps({"couch-tv": {"command": cmd, "args": args, "env": env}}, indent=2)
    q = (lambda s: '"' + s.replace('"', '\\"') + '"' if re.search(r"[\s\"'$`\\]", s) else s)
    code = "claude mcp add couch-tv " + " ".join(f"--env {k}={q(v)}" for k, v in env.items()) + " -- " + " ".join(q(x) for x in [cmd] + args)
    return {"desktop": desktop, "code": code, "url": url}


def _source_path():
    return None if getattr(sys, "frozen", False) else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def agent_helper():
    """The Helper on this computer is the agent's way in: its own address and pairing key."""
    cfg = hconfig.load()
    if cfg["mode"] != "helper" or not cfg["pairing_key"]:
        return {"helper": False}
    return dict(agent_lines(f"http://127.0.0.1:{cfg['port']}", cfg["pairing_key"], _source_path()), helper=True)


def _tv_call(ip, path, body):
    req = urllib.request.Request(f"http://{ip}:5400{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            said = (json.loads(e.read().decode("utf-8", "replace")) or {}).get("error")
        except Exception:
            said = None
        raise TvError(str(said or "The TV said no. Try again.")[:200], "tv_said") from e
    except Exception as e:
        raise TvError("The Couch TV app on the TV is not answering. Add the phone remote first, then try again.", "remote_down") from e


def agent_tv_pair(ip, pin):
    """The Couch TV app on the TV pairs the agent like a phone: the 6 numbers the TV shows, once."""
    pin = re.sub(r"\D", "", str(pin or ""))
    if len(pin) != 6:
        raise TvError("Type the 6 numbers the TV shows.", "bad_pin")
    ans = _tv_call(ip, "/api/pair", {"pin": pin, "name": "My AI"})
    tok = str(ans.get("token") or "")
    if not re.fullmatch(r"[A-Za-z0-9_\-.]{12,200}", tok):
        raise TvError("The TV did not give a key. Show a new code and try again.", "no_token")
    return dict(agent_lines(f"http://{ip}:5400", tok, _source_path()), helper=False)


# ---------------------------------------------------------------- apps

def apps_now(tv):
    found = tvprofile.parse_apps(*[_ask(tv, q) for q in tvprofile.APP_QUERIES])
    return {"apps": [{"pkg": p, "name": app_name(p)} for p in found], "count": len(found)}


def _ask(tv, cmd):
    try:
        return tv.shell(cmd, timeout_s=15)
    except Exception:
        return ""


def apps_send(link, apps):
    tv_id = (link.tv or {}).get("tv_id")
    if not link.token or not tv_id:
        raise TvError("Link this TV to your Couch TV account first. Then its apps can show in the editor.", "no_account")
    clean = tvprofile.clean_apps(apps)
    if not clean:
        raise TvError("No apps were found on the TV. Look again.", "no_apps")
    return studio.call("/v1/setup/apps", {"tv_id": tv_id, "apps": clean}, link.token)


# ---------------------------------------------------------------- the routes (server.py: /api/live/<name>)

def route(name, body, S, need_tv):
    if name == "state":
        return {"providers": [{k: p[k] for k in ("id", "name", "model", "where")} for p in PROVIDERS], "money_line": MONEY_LINE,
                "linked": bool(S.link.token and (S.link.tv or {}).get("tv_id")), "tv": (S.facts or {}).get("name") or "this TV",
                "helper": hconfig.load()["mode"] == "helper", "ontv": bool(((S.facts or {}).get("installed") or {}).get("ontv"))}
    if name == "ask-save":
        return ask_save(S.link, body)
    if name == "ask-remove":
        return ask_remove(S.link)
    if name == "agent-helper":
        return agent_helper()
    if name == "agent-tv-code":
        need_tv()
        return _tv_call(S.ip, "/api/pair/start", {})
    if name == "agent-tv-pair":
        need_tv()
        return agent_tv_pair(S.ip, body.get("pin"))
    if name == "apps":
        r = apps_now(need_tv())
        S.live_apps = [a["pkg"] for a in r["apps"]]
        return r
    if name == "apps-send":
        return apps_send(S.link, getattr(S, "live_apps", None) or (S.profile or {}).get("apps"))
    if name == "watch":
        return live_state(need_tv(), S.facts)
    raise TvError("No such step.", "404")
