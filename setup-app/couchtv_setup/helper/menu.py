"""The menu bar and tray menu as plain data, so the Mac, Windows and Linux trays and the browser page
show the same thing, and a test can check it without any tray library.

State (from helper.status.snapshot):
    {"running": bool, "paused": bool, "port": 5400, "tvs": [{"name", "kind", "ready": bool}], "autostart": bool,
     "update": {"state": "up_to_date" | "downloading" | "ready" | "error", "version": "0.13.14"} or None,
     "awake": {"needed": bool, "allow_sleep": bool} or None}
Items: {"id", "label", "enabled", "checked"} or {"id": "-"} for a separator. Lines are 14 words or fewer.
"""

KIND_NAMES = {"android": "Google TV", "samsung": "Samsung", "lg": "LG", "roku": "Roku", "fire": "Fire TV"}
STUDIO_URL = "https://couchtv.joshuaseage.com"


def dot(state):
    """green: running with every TV reachable. amber: running, a TV unreachable. grey: paused or starting."""
    if state.get("paused") or not state.get("running"):
        return "grey"
    return "green" if all(t.get("ready") for t in state.get("tvs") or []) else "amber"


def headline(state):
    n = len(state.get("tvs") or [])
    ready = sum(1 for t in state.get("tvs") or [] if t.get("ready"))
    if state.get("paused"):
        return "Paused"
    if not state.get("running"):
        return "Starting"
    if not n:
        return "Running. No TV added yet."
    if ready == n:
        return "Running. %d TV%s connected." % (n, "" if n == 1 else "s")
    return "Running. %d of %d TVs reachable." % (ready, n)


def tv_line(tv):
    kind = KIND_NAMES.get(tv.get("kind"), "TV")
    return "%s: %s, %s" % (tv.get("name") or "TV", kind, "ready" if tv.get("ready") else "not reachable")


def update_line(state):
    u = state.get("update") or {}
    s = u.get("state")
    if s == "ready":
        return "Update ready, restart"
    if s == "downloading":
        return "Downloading %s" % (u.get("version") or "the update")
    if s == "error":
        return "Could not check for updates"
    return "Up to date, %s" % (u.get("version") or "")


def build(state):
    items = [{"id": "status", "label": "Couch TV Helper", "enabled": False},
             {"id": "headline", "label": headline(state), "enabled": False}]
    for i, tv in enumerate(state.get("tvs") or []):
        items.append({"id": "tv%d" % i, "label": tv_line(tv), "enabled": False})
    items += [{"id": "-"},
              {"id": "studio", "label": "Open Couch TV Studio", "enabled": True},
              {"id": "setup", "label": "Add or change a TV...", "enabled": True},
              {"id": "autostart", "label": "Start with this computer", "enabled": True, "checked": bool(state.get("autostart"))}]
    if (state.get("awake") or {}).get("needed"):
        items.append({"id": "sleep", "label": "Let this computer sleep", "enabled": True, "checked": bool(state["awake"].get("allow_sleep"))})
    if state.get("update"):
        items.append({"id": "update", "label": update_line(state), "enabled": state["update"].get("state") == "ready"})
    items += [{"id": "-"},
              {"id": "pause", "label": "Resume the helper" if state.get("paused") else "Pause the helper", "enabled": True},
              {"id": "off", "label": "Turn off extra features...", "enabled": True},
              {"id": "remove", "label": "Remove everything from this computer...", "enabled": True},
              {"id": "quit", "label": "Quit", "enabled": True}]
    return items


def labels(items):
    return [i.get("label") for i in items if i.get("id") != "-"]
