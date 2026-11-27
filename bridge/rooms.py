"""Which rooms each TV may see and control (Phase 2 lane B, 28 Nov 2026).

The person picks, in Couch TV Setup or their account, which air con, lights and speakers each TV shows
(the account's details.rooms[<tv id>]). The TV's page hands its own room to this computer (POST
/api/ha/room); the bridge keeps it per TV in bridge/data/direct.json ("rooms", by the TV's id in
config.json) and, for every ask that comes from that TV's address, leaves out and refuses what is not
in its room. So the guest room TV cannot turn on the lounge air con even by asking for it by name.

The rule is the same in every copy (HomeAssistant.kt RoomCap, tv-home/web/smarthome.js roomAllows,
setup-app couchtv_setup/smarthome.py, the account's lib/home-v2.mjs), tested with
tests/fixtures/room_caps.json:
  - no room, or a room with a name only: everything.
  - only climate.* (air con), light.* and media_player.* (speakers) are ever capped.
  - an AirTouch zone "airtouch_2" is climate.airtouch_2.
  - "only": true caps all three kinds to their lists (no list means none of that kind);
    otherwise a kind is capped only when the room has a list for it.
"""
import re

CAPPED = ("climate", "light", "media_player")
ENTITY = re.compile(r"[a-z_]{1,32}\.[a-z0-9_]{1,64}")
ZONE = re.compile(r"[A-Za-z0-9_.:-]{1,40}")
MOST = 16


def clean(room):
    """A room as the account sends it, checked; None for no room."""
    if not isinstance(room, dict):
        return None
    out = {}
    if isinstance(room.get("label"), str) and room["label"].strip():
        out["label"] = room["label"].strip()[:30]
    if room.get("only") is True:
        out["only"] = True
    for k, ok in (("climate", ENTITY), ("speakers", ENTITY), ("lights", ENTITY), ("zones", ZONE)):
        v = room.get(k)
        if not isinstance(v, list):
            continue
        seen = []
        for e in v[:MOST]:
            if isinstance(e, str) and ok.fullmatch(e.strip()) and e.strip() not in seen:
                seen.append(e.strip())
        out[k] = seen
    caps = [k for k in out if k != "label"]
    return out if caps else None


def allows(room, entity):
    e = str(entity or "")
    d = e.split(".")[0]
    if not isinstance(room, dict) or d not in CAPPED:
        return True
    zones = room.get("zones")
    zones = [z if "." in z else "climate." + z for z in zones] if isinstance(zones, list) else None
    climate = room.get("climate")
    lists = {
        "climate": (list(climate) if isinstance(climate, list) else []) + (zones or []) if isinstance(climate, list) or zones is not None else None,
        "light": room.get("lights") if isinstance(room.get("lights"), list) else None,
        "media_player": room.get("speakers") if isinstance(room.get("speakers"), list) else None,
    }
    lst = lists[d]
    if lst is None:
        return room.get("only") is not True
    return e in lst


def _keep(room, items):
    return [x for x in items if not (isinstance(x, dict) and not allows(room, x.get("entity")))]


def info(room, o):
    """The names a TV may list (the bridge's /api/ha/info), with what is not in its room left out."""
    if not room or not isinstance(o, dict):
        return o
    o = dict(o)
    for k in ("climate", "controls", "speakers"):
        if isinstance(o.get(k), list):
            o[k] = _keep(room, o[k])
    return o


# asks that name one entity, and the lists an answer may hold
ONE = {"temp", "mode", "fan", "on", "off", "set", "volume", "playpause", "history"}


def ask_ok(room, action, entity):
    """False when this TV may not touch that entity."""
    return not (room and action in ONE and entity and not allows(room, entity))


def answer(room, action, r):
    if not room or not isinstance(r, dict):
        return r
    r = dict(r)
    for k in ("rooms", "controls", "speakers"):
        if isinstance(r.get(k), list):
            r[k] = _keep(room, r[k])
    return r
