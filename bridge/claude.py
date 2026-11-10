"""Claude for the TV: /api/ask and Claude's picks.

Always `claude -p` on your own Claude plan: ANTHROPIC_API_KEY is stripped from the child's
environment and nothing here calls api.anthropic.com. Model named explicitly (Sonnet).
Runs from a folder outside the workspace so the workspace CLAUDE.md, hooks and plugins never
load into a TV request (faster, and nothing of the agent system can surface on the TV).
"""
import asyncio
import json
import logging
import os
import re
import shutil
import sys
import time
import uuid

import apps
import config
import finder
import store
import taste

log = logging.getLogger("claude")

HERE = os.path.dirname(os.path.abspath(__file__))
CLAUDE = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "/opt/homebrew/bin/claude"
MODEL = "sonnet"
WORKDIR = os.path.join(config.DATA, "claude-workdir")
BRIDGE_URL = f"http://127.0.0.1:{os.environ.get('PORT', '5400')}"
ASK_TIMEOUT = 240  # hard cap; the phone gets an answer by ASK_SOFT
RECS_TIMEOUT = 180
RECS_MAX_AGE = 6 * 3600
RECS_MIN_GAP = 15 * 60  # after a play, refresh picks at most this often

_recs_lock = asyncio.Lock()

ASK_SYSTEM = """You run the living room TV in a home (a Google TV). You control it only with the tv tools. The people asking are on the couch
with a phone remote. You act on your own: never ask them to clarify, make the best guess, do the
whole job, then say what you did. The one thing you may ask is whether they want the next step
you are offering (see OPTIONS below).

Pure questions ("what's that vampire movie with Edward Cullen", "who is in Slow Horses", "what
is Severance about") change nothing on the TV: answer from your own knowledge, use find to say
which of their apps it streams on, and offer to put it on. Touch the TV only once they say yes.

Simple asks stay fast: one tool and done, no looking first.
- Put something on: play with the title. Pass season and episode only if they said them, so the
  app carries on where they are up to. If they name an app, pass service. Only say it is playing
  when play answers started true; otherwise say the app is open and repeat play's note.
- Pause, louder, open an app, go home: key, volume or launch.

Bigger jobs: look, decide, act, check, and repeat until it is done (at most about 20 tool calls).
Look with now and ui (ui reads the screen as text and works where screenshot is black, such as
Netflix); use screenshot only when the layout matters. Move with key (up down left right ok back)
or tap a label from ui. After each step check with ui or now that it worked.
- App not on the TV ("get Stan on here and put on Bluey"): install_app with the name, then play.
  If install_app stopped, say why and stop there.
- "Turn it off when this episode ends": off_after_episode. "Cancel that": cancel=true.
- "What was I watching last week": history with days=7 (and who), answer with the titles and
  days (Monday, last Thursday), newest first, then offer to carry on with the newest one. Do not
  play it unless they asked.
- "Netflix is being weird" (frozen, no sound, stuck, crashing): restart_app, then say whether
  it is playing again.
- "Switch to the PlayStation" or another device: input with the device name. "Back to the TV"
  or apps: input home. If input says it guessed, say which HDMI you chose.
- "Find something we'd both like": both_like, pick three titles that fit both of them, say why
  for each in a few words, and offer to put one on (an option per title). Play one only when
  they ask (for example "play the second one", using the last answer below).
- "Is the new episode out yet": latest_episode, compare with what they last watched, give the
  newest episode and its date, and offer to put it on. If they ask to, use play with season and
  episode.
- Anything else: work it out with the tools you have.

Hard lines: never pay, buy, rent, subscribe, sign up or type a password. If a sign in, account
or payment screen shows (ui stop_screen true), stop and tell them to finish it on the TV. Never
uninstall unless they asked to remove that app. Never turn the TV off unless they asked (the off
after episode job counts as asking). Netflix and other apps black out screenshots, so trust now
and ui there.

Your final answer is shown on a phone. One to three short sentences (four at most when you
give several titles), plain words, the English spelling used in {country}, no dashes used as punctuation, no
markdown. Never use bullet points, numbered lists or line breaks: put several titles in one
sentence. Say what you did, and plainly what you could not do and why.

OPTIONS: when your answer offers something or asks whether they want it, end with one more line,
exactly OPTIONS: followed by a JSON list of one to three quick replies, each {{"label": "...",
"text": "..."}}. label is one to three words for a button; text is the full reply the person would
send, naming the title so it makes sense on its own, for example
OPTIONS: [{{"label": "Play it", "text": "Yes, play Twilight"}}, {{"label": "Not now", "text": "No thanks"}}]
Leave the OPTIONS line out when nothing is offered. Never mention the options in the sentences."""

MAX_TURNS = 25        # the step cap for one ask
ASK_SOFT = 80         # the phone waits 90 s; answer by then and let the job finish in the background
LAST_FOR = 15 * 60    # the last answer on a TV is given to the next ask for 15 minutes
_last = {}            # tv id -> {"text", "reply", "ts", "pending"}

RECS_PROMPT = """{taste}

Played on our TVs lately, newest first (title, year, type, app):
{history}

Apps on the TV: {apps}.

Recommend 12 shows or films they have not watched that they are likely to enjoy, available to
stream in {country}, based on the taste above (weigh what they finished and rewatched, avoid
things like what they dropped early, and use their YouTube channels as a hint to interests).
Prefer things on the apps listed. Mix in a couple of recent releases.
Answer with ONLY a JSON array, no prose, each item:
{{"title": "...", "year": 2024, "type": "tv" or "movie", "reason": "Because you watched X"}}
The reason is at most eight words."""


def _env(extra=None):
    env = {k: v for k, v in os.environ.items()
           if k not in ("ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
           and not k.startswith("CLAUDE_CODE_SSE")}
    env.setdefault("HOME", os.path.expanduser("~"))
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + env.get("PATH", "")
    env.update(extra or {})
    return env


async def run_claude(prompt, system=None, mcp_config=None, timeout=ASK_TIMEOUT):
    os.makedirs(WORKDIR, exist_ok=True)
    args = [CLAUDE, "-p", prompt, "--model", MODEL, "--output-format", "json",
            "--no-session-persistence", "--setting-sources", "project", "--tools", ""]
    if system:
        args += ["--system-prompt", system]
    if mcp_config:
        args += ["--strict-mcp-config", "--mcp-config", mcp_config, "--allowedTools", "mcp__tv",
                 "--max-turns", str(MAX_TURNS)]
    else:
        args += ["--strict-mcp-config"]
    proc = await asyncio.create_subprocess_exec(
        *args, cwd=WORKDIR, env=_env(), stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError("Claude took too long")
    text = out.decode(errors="replace").strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError((err.decode(errors="replace").strip() or text)[:200] or "Claude failed")
    if data.get("subtype") == "error_max_turns":
        raise RuntimeError("I ran out of steps before finishing")
    if data.get("subtype") == "error_max_turns":
        raise RuntimeError("I ran out of steps before finishing")
    if data.get("is_error"):
        raise RuntimeError(str(data.get("result") or data.get("subtype") or "Claude error")[:200])
    return data.get("result") or ""


def _mcp_config(ask_id, tv_id=None):
    os.makedirs(WORKDIR, exist_ok=True)
    path = os.path.join(WORKDIR, f"mcp-{ask_id}.json")
    cfg = {"mcpServers": {"tv": {
        "type": "stdio",
        "command": sys.executable,
        "args": [os.path.join(HERE, "mcp_server.py")],
        # COUCH_CONFIG (a path, never the key) so the tools read the same pairing key as the bridge
        "env": {"BRIDGE_URL": BRIDGE_URL, "ASK_ID": ask_id, "COUCH_CONFIG": config.CONFIG_FILE,
                **({"TV_ID": tv_id} if tv_id else {})},
    }}}
    with open(path, "w") as f:
        json.dump(cfg, f)
    return path


_OPTIONS = re.compile(r"\n?\s*OPTIONS:\s*(\[.*\])\s*$", re.S)


def split_options(reply):
    """(say, options): the answer without its OPTIONS line, and at most three {label, text}."""
    m = _OPTIONS.search(reply or "")
    if not m:
        # A broken OPTIONS line is dropped, never shown to the person.
        return re.sub(r"\n?\s*OPTIONS:.*$", "", reply or "", flags=re.S).strip(), []
    say = reply[:m.start()].strip()
    try:
        raw = json.loads(m.group(1))
    except json.JSONDecodeError:
        return say, []
    opts = []
    for o in raw if isinstance(raw, list) else []:
        if isinstance(o, dict) and str(o.get("label") or "").strip() and str(o.get("text") or "").strip():
            opts.append({"label": str(o["label"]).strip()[:24], "text": str(o["text"]).strip()[:200]})
        if len(opts) == 3:
            break
    return say, opts


DOING = {"install_app": "installing {name}", "play": "putting on {title}",
         "restart_app": "restarting the app", "input": "switching input", "tap": "pressing {label}",
         "launch": "opening {app}", "off_after_episode": "setting the TV to go off"}


def _doing(actions):
    for a in reversed(actions):
        words = DOING.get(a.get("tool"))
        if words:
            try:
                return words.format(**{k: v for k, v in (a.get("args") or {}).items()})
            except (KeyError, IndexError):
                return words.split(" {")[0]
    return None


def _ago(seconds):
    mins = int(seconds // 60)
    return "just now" if mins < 1 else f"{mins} min ago"


DOING = {"install_app": "installing {name}", "play": "putting on {title}",
         "restart_app": "restarting the app", "input": "switching input", "tap": "pressing {label}",
         "launch": "opening {app}", "off_after_episode": "setting the TV to go off"}


def _doing(actions):
    for a in reversed(actions):
        words = DOING.get(a.get("tool"))
        if words:
            try:
                return words.format(**{k: v for k, v in (a.get("args") or {}).items()})
            except (KeyError, IndexError):
                return words.split(" {")[0]
    return None


def _memory(reply):
    say, opts = split_options(reply)
    return say + (" (offered: " + "; ".join(o["text"] for o in opts) + ")" if opts else "")


def _ago(seconds):
    mins = int(seconds // 60)
    return "just now" if mins < 1 else f"{mins} min ago"


async def ask(text, who, asks, tv_id=None):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    ask_id = uuid.uuid4().hex[:12]
    asks[ask_id] = []
    cfg = _mcp_config(ask_id, tv_id)
    start = time.monotonic()
    key = tv_id or "default"
    names = [p["name"] for p in config.PEOPLE]
    asker = {p["id"]: p["name"] + " is asking" for p in config.PEOPLE}
    asker["both"] = " and ".join(names) + " are watching together"
    asker = asker.get(who)
    prompt = f"({asker}) {text}" if asker else text
    now = datetime.now(ZoneInfo(config.TIMEZONE))
    prompt += f"\n\n[Now: {now.strftime('%A %d %B %Y, %I:%M %p').replace(' 0', ' ')} local time]"
    last = _last.get(key)
    if last and time.time() - last["ts"] < LAST_FOR:
        # So "yes", "play the second one" and "keep watching" follow on from the last answer.
        prompt += (f"\n[Last ask on this TV, {_ago(time.time() - last['ts'])}: \"{last['text']}\". "
                   f"Your answer then: \"{last['reply']}\""
                   + (" (that job was still running when you answered)" if last.get("pending") else "")
                   + "]")
    likes = taste.summary(who)
    if likes:
        # So "recommend something" and "put on something good" use the real taste.
        prompt = f"{prompt}\n\n[Background, use only if relevant]\n{likes}"

    async def job():
        try:
            return (await run_claude(prompt, ASK_SYSTEM.format(country=config.COUNTRY_NAME), cfg)).strip()
        except RuntimeError as e:
            log.warning("ask failed: %s", e)
            return f"Sorry, that did not work: {e}"
        finally:
            try:
                os.remove(cfg)
            except OSError:
                pass

    task = asyncio.create_task(job())
    try:
        reply = await asyncio.wait_for(asyncio.shield(task), ASK_SOFT)
        actions = asks.pop(ask_id, [])
        _last[key] = {"text": text, "reply": _memory(reply), "ts": time.time()}
    except asyncio.TimeoutError:
        # The phone gives up at 90 s. Answer now and let the job finish on its own.
        actions = list(asks.get(ask_id, []))
        doing = _doing(actions)
        reply = ("Still working on it" + (f", {doing}" if doing else "")
                 + ". Give it a minute and watch the TV.")
        _last[key] = {"text": text, "reply": reply, "ts": time.time(), "pending": True}

        def finished(t):
            asks.pop(ask_id, None)
            r = t.result() if not t.cancelled() and not t.exception() else "That job did not finish."
            _last[key] = {"text": text, "reply": _memory(r), "ts": time.time()}
            log.info("ask finished in the background after %.0f s: %s", time.monotonic() - start, r)
            _background.discard(t)
        _background.add(task)
        task.add_done_callback(finished)
    say, options = split_options(reply)
    return {"reply": say, "say": say, "options": options, "actions": actions,
            "seconds": round(time.monotonic() - start, 1)}


_background = set()


# ---------- picks ----------
def _key(who):
    return "all" if who in (None, "both") else who


def _installed_app_names():
    return ", ".join(a["name"] for a in apps.APPS if a["jw"])


async def _enrich(item):
    try:
        best, _ = await finder.find(item["title"], item.get("type"))
    except Exception:
        best = None
    if not best:
        return None
    # Only keep it if the year roughly matches what Claude meant.
    if item.get("year") and best.get("year") and abs(int(item["year"]) - int(best["year"])) > 1:
        return None
    usable = [p for p in best["providers"] if p["playable"]]
    first = (usable or best["providers"] or [None])[0]
    return {"title": best["title"], "year": best["year"], "type": best["type"],
            "poster": best["poster"], "backdrop": best["backdrop"], "reason": item.get("reason"),
            "service": first["service"] if first else None, "playable": bool(usable)}


async def _popular_picks():
    items = await finder.popular(None, first=40)
    picks = []
    for b in items:
        usable = [p for p in b["providers"] if p["playable"]]
        if not usable:
            continue
        picks.append({"title": b["title"], "year": b["year"], "type": b["type"],
                      "poster": b["poster"], "backdrop": b["backdrop"],
                      "reason": f"Popular in {config.COUNTRY_NAME} this week",
                      "service": usable[0]["service"], "playable": True})
        if len(picks) >= 12:
            break
    return picks


def _parse_list(text):
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    m = re.search(r"\[.*\]", text, re.S)
    return json.loads(m.group(0) if m else text)


async def refresh_recs(who=None, force=False):
    async with _recs_lock:
        cache = store.recs()
        entry = cache.get(_key(who))
        age = time.time() - entry.get("ts", 0) if entry else None
        if entry and age < (RECS_MIN_GAP if force else RECS_MAX_AGE):
            return entry
        hist = [h for h in store.history() if store.matches(h, who)][:60]
        likes = taste.summary(who)
        picks = []
        if hist or likes:
            lines = "\n".join(f"- {h['title']} ({h.get('year')}, {h.get('type')}, {h.get('service')})"
                              for h in hist) or "(nothing yet)"
            try:
                raw = await run_claude(RECS_PROMPT.format(taste=likes or "(no taste profile yet)", country=config.COUNTRY_NAME,
                                                          history=lines, apps=_installed_app_names()),
                                       timeout=RECS_TIMEOUT)
                wanted = _parse_list(raw)[:14]
                watched = {h["title"].lower() for h in store.history()} | {
                    i["title"].lower() for i in store.imported() if i.get("source") != "youtube"}
                found = await asyncio.gather(*[_enrich(w) for w in wanted
                                               if isinstance(w, dict) and w.get("title")])
                picks = [p for p in found if p and p["title"].lower() not in watched][:12]
            except Exception as e:
                log.warning("Claude picks failed, using popular: %s", e)
        if not picks:
            try:
                picks = await _popular_picks()
            except Exception as e:
                log.warning("popular picks failed: %s", e)
                picks = entry["picks"] if entry else []
        from datetime import datetime
        from zoneinfo import ZoneInfo
        entry = {"ts": time.time(), "picks": picks,
                 "updated": datetime.now(ZoneInfo(config.TIMEZONE)).isoformat(timespec="seconds")}
        cache = store.recs()
        cache[_key(who)] = entry
        store.save_recs(cache)
        return entry


async def cached_recs(who=None):
    entry = store.recs().get(_key(who))
    stale = not entry or time.time() - entry.get("ts", 0) > RECS_MAX_AGE
    if stale and not _recs_lock.locked():
        asyncio.create_task(refresh_recs(who))
    if not entry:
        entry = store.recs().get("all")  # nothing for this person yet: show the shared picks
    if not entry:
        return [], None
    return entry["picks"], entry.get("updated")


async def background_loop():
    await asyncio.sleep(5)
    while True:
        try:
            for who in [None, *config.PEOPLE_IDS]:
                await refresh_recs(who)
        except Exception:
            log.exception("recs refresh failed")
        await asyncio.sleep(1800)
