"""MCP server (stdio) for the living room TV. Every tool is a thin call to the bridge HTTP API,
so the bridge stays the only thing that talks to the TV.

Registered for the workspace in .mcp.json as "tv". /api/ask also starts it for each request.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from mcp.server.fastmcp import FastMCP, Image

BRIDGE = os.environ.get("BRIDGE_URL", "http://127.0.0.1:5400")
ASK_ID = os.environ.get("ASK_ID")
TV_ID = os.environ.get("TV_ID")  # set by /api/ask: the TV the person asked from
try:   # the bridge's pairing key (bridge.pairing_key in config.json, or BRIDGE_KEY), if it has one
    import config
    KEY = config.PAIRING_KEY
except (Exception, SystemExit):
    KEY = os.environ.get("BRIDGE_KEY", "").strip()

mcp = FastMCP("tv", instructions=(
    "Controls the living room Google TV through the bridge. "
    "Use play to put a show or film on, find to see where it streams in this home's country, key/volume/"
    "launch for remote control, now to see what is on. Never power the TV off unless asked. "
    "list_widgets and set_widget_setting read and change one widget on the TV home's design. "
    "There can be more than one TV (tvs); tools default to the TV the person asked from."))


def call(method, path, payload=None, raw=False, tv=None, timeout=60, headers_out=None):
    tv = tv or TV_ID
    if tv:
        path += ("&" if "?" in path else "?") + urllib.parse.urlencode({"tv": tv})
    req = urllib.request.Request(BRIDGE + path, method=method)
    if ASK_ID:
        req.add_header("X-Ask-Id", ASK_ID)
    if KEY:
        req.add_header("Authorization", f"Bearer {KEY}")
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            body = r.read()
            if headers_out is not None:
                headers_out.update(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read()
        if raw:
            raise RuntimeError(body.decode(errors="replace")[:200])
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"bridge not running ({e.reason})"}
    if raw:
        return body
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "error": body.decode(errors="replace")[:200]}


@mcp.tool()
def now(tv: str | None = None) -> dict:
    """What is on the TV right now: power, the app in front, volume, and what is playing. tv: an id from config.json (the default if left out)."""
    return call("GET", "/api/now", tv=tv)


@mcp.tool()
def play(title: str, season: int | None = None, episode: int | None = None,
         service: str | None = None, tv: str | None = None) -> dict:
    """Find a show or film and start it on the TV in the right app (looks up where it streams in
    this home's country, then opens it by deep link, or opens the app's search). `service` forces an app id,
    e.g. netflix, stan, binge, abc-iview, sbs-on-demand, disney-plus, prime-video, youtube.
    Pass season and episode only when the person said them. The answer has started=true when
    the app was seen playing; only then say it is playing."""
    payload = {"title": title}
    if season:
        payload["season"] = season
    if episode:
        payload["episode"] = episode
    if service:
        payload["service"] = service
    return call("POST", "/api/play", payload, tv=tv)


@mcp.tool()
def find(title: str, type: str | None = None) -> dict:
    """Where a show or film streams in this home's country (free, subscription, rent, buy), without playing it.
    type is "tv" or "movie" to narrow it."""
    q = {"title": title}
    if type:
        q["type"] = type
    return call("GET", "/api/find?" + urllib.parse.urlencode(q))


@mcp.tool()
def key(key: str, hold: bool = False, tv: str | None = None) -> dict:
    """Press a remote button. Keys: up down left right ok back home play_pause play pause stop
    next previous rewind fast_forward volume_up volume_down mute power settings menu info guide
    input search captions channel_up channel_down 0-9. hold=true for a long press."""
    return call("POST", "/api/key", {"key": key, "hold": hold}, tv=tv)


@mcp.tool()
def type_text(text: str, tv: str | None = None) -> dict:
    """Type text into the text box that is open on the TV (a search box)."""
    return call("POST", "/api/text", {"text": text}, tv=tv)


@mcp.tool()
def launch(app: str, tv: str | None = None) -> dict:
    """Open an app on the TV by id (netflix, youtube, stan, binge, abc-iview, sbs-on-demand,
    disney-plus, prime-video, apple-tv, paramount-plus, kayo, foxtel-go, 9now, 7plus, 10play,
    hbo-max, spotify, home, settings), by Android package name, or by link."""
    return call("POST", "/api/launch", {"app": app}, tv=tv)


@mcp.tool()
def apps() -> dict:
    """The apps on the TV, with ids and whether each is installed."""
    return call("GET", "/api/apps")


@mcp.tool()
def volume(action: str = "up", steps: int = 1, tv: str | None = None) -> dict:
    """Change the volume: action is up, down or mute; steps repeats up or down (1 to 20)."""
    return call("POST", "/api/volume", {"action": action, "steps": steps}, tv=tv)


@mcp.tool()
def power(state: str, tv: str | None = None) -> dict:
    """Turn the TV on or off: state is on, off or toggle. Only turn it off when clearly asked."""
    return call("POST", "/api/power", {"state": state}, tv=tv)


@mcp.tool()
def tvs() -> dict:
    """The TVs the bridge knows (see config.json), whether each is paired, connected and on.
    Every other tool takes an optional tv id; leave it out for the TV the person is using."""
    return call("GET", "/api/tvs")


@mcp.tool()
def history(days: int | None = None, who: str | None = None) -> dict:
    """What has been played on our TVs, newest first, with the date and time (Sydney) of each
    play, the app, and season and episode when known. days limits it to the last N days (7 for
    "last week"); who is a person id from config.json, or both. Use it for "what was I watching" and to resume."""
    r = call("GET", "/api/history")
    if not r.get("ok"):
        return r
    from datetime import datetime, timedelta, timezone
    items = r["items"]
    if days:
        cut = datetime.now(timezone.utc) - timedelta(days=days)
        def recent(h):
            try:
                return datetime.fromisoformat(h["when"]) >= cut
            except (KeyError, TypeError, ValueError):
                return False
        items = [h for h in items if recent(h)]
    if who and who not in ("both", "all", "everyone"):
        items = [h for h in items if h.get("who") in (who, "both", None)]
    keep = ("title", "type", "season", "episode", "episode_title", "service", "who", "when")
    r["items"] = [{k: h.get(k) for k in keep if h.get(k) is not None} for h in items[:60]]
    r["count"] = len(items)
    return r


@mcp.tool()
def taste(who: str | None = None) -> dict:
    """What this household likes, from all watch history (TV plays plus imported Netflix and
    YouTube history): genres, shows finished, dropped and rewatched, films, YouTube channels,
    recent versus long term. who: a person id from config.json, or both. Use it before recommending."""
    path = "/api/taste" + (f"?who={urllib.parse.quote(who)}" if who else "")
    return call("GET", path)


@mcp.tool()
def recs() -> dict:
    """Claude's cached picks for this household, plus continue watching."""
    return call("GET", "/api/recs")


@mcp.tool()
def screens() -> dict:
    """The house screens that can be opened on the TV (see config.json). Nothing shows unless opened."""
    return call("GET", "/api/screens")


@mcp.tool()
def open_screen(id: str) -> dict:
    """Open a house screen on the TV, by its id from config.json. Only when someone asked for it."""
    return call("POST", "/api/screens/open", {"id": id})


@mcp.tool()
def screenshot(tv: str | None = None):
    """A picture of what is on the TV screen right now. Netflix and other protected video show
    as black: then use now (what is playing) and ui (the buttons) instead."""
    head = {}
    img = call("GET", "/api/screen-small", raw=True, tv=tv, headers_out=head)
    if head.get("X-Screen-Black") == "1":
        return ("The screenshot is black: this app protects its picture (Netflix, Stan and "
                "others do). Use now and ui to see what is on.")
    fmt = "jpeg" if (head.get("Content-Type") or "").startswith("image/jpeg") else "png"
    return Image(data=img, format=fmt)


@mcp.tool()
def ui(tv: str | None = None) -> dict:
    """The screen as text: the app in front, what has focus, and every visible label (* has
    focus, + can be pressed, @x,y is its centre). Works where screenshots are black. stop_screen
    true means a sign in, sign up or payment screen: stop and tell the person to finish it."""
    return call("GET", "/api/ui", tv=tv, timeout=40)


@mcp.tool()
def tap(label: str, tv: str | None = None) -> dict:
    """Press the thing on screen with this label (from ui). Most TV screens also work with the
    arrow keys and ok. It refuses buy, subscribe and sign in buttons."""
    return call("POST", "/api/tap", {"label": label}, tv=tv, timeout=40)


@mcp.tool()
def install_app(name: str, tv: str | None = None) -> dict:
    """Install an app from the Play Store (the TV's App Store) by name, e.g. Disney+, Plex,
    Crunchyroll. Takes 20 to 90 seconds; it presses Install itself and waits until the app is on
    the TV. installed=true when done. If it stopped (paid app, sign in, no Install button), say
    so and leave the screen for the person. Never pay, never sign up, never type passwords."""
    return call("POST", "/api/install", {"name": name}, tv=tv, timeout=200)


@mcp.tool()
def uninstall_app(name: str, tv: str | None = None) -> dict:
    """Remove an app. ONLY when the person clearly asked to delete or uninstall that app."""
    return call("POST", "/api/uninstall", {"name": name}, tv=tv, timeout=60)


@mcp.tool()
def inputs(tv: str | None = None) -> dict:
    """The TV's HDMI inputs: number, label, devices seen on each (names like PlayStation 5 when
    the device is on), and state."""
    return call("GET", "/api/inputs", tv=tv, timeout=40)


@mcp.tool()
def input(name: str, remember_as: str | None = None, tv: str | None = None) -> dict:
    """Switch the TV to an input: a device ("playstation", "xbox"), a number ("hdmi 2"), or
    "home" for the apps. It makes a best guess when the TV cannot tell which HDMI a device is on.
    remember_as saves the name for that input, e.g. input("hdmi 3", remember_as="playstation")
    when the person says that is where it is."""
    payload = {"name": name}
    if remember_as:
        payload["remember_as"] = remember_as
    return call("POST", "/api/input", payload, tv=tv, timeout=40)


@mcp.tool()
def off_after_episode(cancel: bool = False, tv: str | None = None) -> dict:
    """Turn the TV off when what is playing now ends (at the credits, or when the next episode
    starts). The home screen and phone show it as the sleep timer. cancel=true stops it."""
    payload = {"cancel": True} if cancel else {}
    return call("POST", "/api/off-after", payload, tv=tv, timeout=40)


@mcp.tool()
def restart_app(app: str | None = None, tv: str | None = None) -> dict:
    """Fix an app that is playing up ("Netflix is being weird", frozen, no sound, stuck): close
    it fully, open it again and carry on with what was playing. app is an app id; leave it out
    for the app on screen."""
    payload = {"app": app} if app else {}
    return call("POST", "/api/restart-app", payload, tv=tv, timeout=90)


@mcp.tool()
def latest_episode(title: str) -> dict:
    """Is the new episode out: the newest episode available in this home's country (season, number,
    name, date, apps), any announced upcoming release, and the last episode watched here."""
    return call("GET", "/api/latest?" + urllib.parse.urlencode({"title": title}), timeout=40)


@mcp.tool()
def both_like() -> dict:
    """For "something we'd both like": each person's genres and shows, what they share,
    what either dropped, who has little history, and the household's ready picks (app, reason)."""
    return call("GET", "/api/both", timeout=40)


@mcp.tool()
def show_message(text: str, sender: str | None = None, seconds: int = 30, tv: str | None = None) -> dict:
    """Show a short message on the TV home (up to 280 characters, plain words, no links). It shows over
    the home for `seconds` (5 to 600) and in an Ask AI widget if the home has one. sender is the name
    shown above it (for example "Claude"); "Your AI" if left out. Works over the home computer and the
    couch-tv TV app (docs/AI-AGENT.md)."""
    payload = {"text": text, "seconds": seconds}
    if sender:
        payload["from"] = sender
    return call("POST", "/api/say/message", payload, tv=tv)


@mcp.tool()
def set_home_design(code: str, tv: str | None = None) -> dict:
    """Put a couch-tv Studio design on the TV home by its code (ABCDE-FGHJK, or the long CTV1-... code).
    Get a code from couch-tv Studio's own MCP server (its send_to_tv tool) or from Send to my TV in
    couch-tv Studio. The TV fetches the design itself and always asks "Use this design?" first, so tell
    the person to press OK on the TV. Nothing changes until they do."""
    return call("POST", "/api/say/design", {"code": code}, tv=tv)


# ---- a design's widgets: read and change one setting, the way the phone's Home settings page does ----
# The TV home hands the bridge its own view of the widgets on screen (app.js designView, through
# /api/athome), and takes one widget's change the same way the phone's Widgets on this TV does
# (widget_set). Only settings in widget-caps.js that a phone may change are sent
# (bridge/widget_settings.json, made from it by scripts/widget-settings-json.mjs).
TV_CLOSED = "The Couch TV home is not open on the TV. Open Couch TV on the TV, then try again."
NO_DESIGN = "No couch-tv Studio design is on the TV home now, so it has no widgets to change."
_SETTINGS = None


def widget_settings():
    """kind -> {"name", "settings": [{"key", "label", "type"}]}: what may be changed from a phone or an AI."""
    global _SETTINGS
    if _SETTINGS is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "widget_settings.json"), encoding="utf-8") as f:
            _SETTINGS = json.load(f)["kinds"]
    return _SETTINGS


def _design_widgets(tv):
    """(widgets, error): the widgets on the TV home's design now, as the TV home itself lists them."""
    r = call("GET", "/api/athome", tv=tv)
    if r.get("ok") is False:
        return None, r
    if not r.get("live"):
        return None, {"ok": False, "error": TV_CLOSED}
    d = (r.get("athome") or {}).get("design") or {}
    if not d.get("on"):
        return None, {"ok": False, "error": NO_DESIGN}
    return [w for w in d.get("widgets") or [] if isinstance(w, dict)], None


def _setting_out(s):
    o = {"key": s.get("key"), "label": s.get("label"), "type": s.get("type"), "value": s.get("value")}
    if s.get("words"):
        o["now"] = s["words"]
    if s.get("help"):
        o["help"] = s["help"]
    if s.get("options"):
        o["choices"] = [{"value": x[0], "words": x[1]} for x in s["options"] if isinstance(x, list) and len(x) >= 2]
    for k in ("many", "min", "max", "step"):
        if s.get(k) is not None:
            o[k] = s[k]
    return o


@mcp.tool()
def list_widgets(tv: str | None = None) -> dict:
    """The widgets on the TV home's couch-tv Studio design that have settings, each with its key (pass it to
    set_widget_setting), its kind, its name and where it sits ("Weather, top right"), and its settings: key,
    label, type, the value now and the choices. A private value (a calendar link) only says it is set.
    The Couch TV home must be open on the TV."""
    widgets, err = _design_widgets(tv)
    if err:
        return err
    caps = widget_settings()
    out = []
    for w in widgets:
        allowed = {s["key"] for s in (caps.get(w.get("kind")) or {}).get("settings", [])}
        sets = [_setting_out(s) for s in w.get("settings") or [] if isinstance(s, dict) and s.get("key") in allowed]
        if sets:
            out.append({"key": w.get("key"), "kind": w.get("kind"), "name": w.get("name"), "where": w.get("title"), "settings": sets})
    return {"ok": True, "widgets": out}


@mcp.tool()
def set_widget_setting(widget: str, setting: str, value: str | int | float | bool | list | dict | None,
                       tv: str | None = None) -> dict:
    """Change one setting of one widget on the TV home's design, as the phone's Home settings page does.
    widget is a key from list_widgets; setting is one of that widget's setting keys; value is one of its
    choices' values, true or false for a toggle, a number, or words. A place setting takes
    {"name": "Byron Bay", "area": "New South Wales, Australia", "lat": -28.64, "lon": 153.61} (look the
    town's latitude and longitude up first). null puts the design's own value back. Example: the weather
    widget's place (its town setting) to Byron Bay. The TV checks the value and says plainly when it cannot
    use it. The Couch TV home must be open on the TV."""
    widgets, err = _design_widgets(tv)
    if err:
        return err
    w = next((x for x in widgets if x.get("key") == widget), None)
    if w is None:
        return {"ok": False, "error": "That widget is not on the TV home now. list_widgets shows the ones there are."}
    kind = w.get("kind")
    rec = widget_settings().get(kind)
    names = [s["key"] for s in (rec or {}).get("settings", [])]
    if setting not in names:
        name = (rec or {}).get("name") or kind
        return {"ok": False, "error": f"{name} has no setting called {setting}." + (f" Its settings: {', '.join(names)}." if names else " It has nothing to change.")}
    r = call("POST", "/api/athome", {"edit": {"widget_set": {"key": widget, "values": {setting: value}}}}, tv=tv)
    if r.get("ok") is False:
        if r.get("error_key") == "err_tv_home_closed":
            return {"ok": False, "error": TV_CLOSED}
        return {"ok": False, "error": str(r.get("error") or "The TV did not take that change.")}
    if not r.get("live"):
        return {"ok": False, "error": TV_CLOSED}
    after = next((x for x in (((r.get("athome") or {}).get("design") or {}).get("widgets") or []) if isinstance(x, dict) and x.get("key") == widget), None)
    now = next((_setting_out(s) for s in (after or {}).get("settings") or [] if isinstance(s, dict) and s.get("key") == setting), None)
    return {"ok": True, "widget": widget, "setting": now or {"key": setting}, "said": "Changed on the TV."}


@mcp.tool()
def tv_says(tv: str | None = None) -> dict:
    """What the TV home is showing from Ask AI and from you: the last question and answer, the last
    message, and the last design code sent."""
    return call("GET", "/api/say", tv=tv)


if __name__ == "__main__":
    mcp.run()
