#!/bin/sh
# Starts the couch-tv bridge (and, beside it, the MCP server) inside the Home Assistant app.
# Everything the household edits lives in /config (the app's config folder): config.json, .env,
# adbkey and data/. The image itself holds none of it, so an update never loses anything.
set -e

OPTIONS=/data/options.json
CFG=/config
APP=/app
PORT="${PORT:-5400}"

say() { echo "couch-tv: $*"; }

# One option from /data/options.json (empty when it is missing). Booleans come out as true or false.
opt() {
  python3 - "$1" <<'PY'
import json, sys
try:
    v = json.load(open("/data/options.json")).get(sys.argv[1], "")
except (OSError, ValueError):
    v = ""
print(str(v).lower() if isinstance(v, bool) else ("" if v is None else v))
PY
}

mkdir -p "$CFG" "$CFG/data"

# The bridge reads these names (bridge/config.py, bridge/tv.py).
export COUCH_CONFIG="$CFG/config.json"
export COUCH_DATA="$CFG/data"
export ADB_KEY="$CFG/adbkey"

# .env holds secrets such as HOME_ASSISTANT_TOKEN and PLEX_TOKEN. The bridge reads <repo>/.env, so
# point that at the config folder.
if [ ! -f "$CFG/.env" ]; then
  echo "# Secrets for couch-tv, one NAME=value per line (for example HOME_ASSISTANT_TOKEN=...)." > "$CFG/.env"
  chmod 600 "$CFG/.env"
fi
ln -sf "$CFG/.env" "$APP/.env"

if [ ! -f "$CFG/config.json" ]; then
  # The example switches Ask off ("ask": {"enabled": false}), which would beat the app's Ask option: drop it.
  python3 -c 'import json,sys;c=json.load(open(sys.argv[1]));c.pop("ask",None);json.dump(c,open(sys.argv[2],"w"),indent=2)' "$APP/config.example.json" "$CFG/config.json"
  say "first start: I made $CFG/config.json from the example. Open the app's config folder"
  say "(File editor, Samba or VS Code) and set your TVs, people and apps, then restart the app."
  say "Set bridge.host to this Home Assistant computer's address. Steps: docs/HOME-ASSISTANT.md"
fi

# The pairing key is on by default. Home Assistant's option wins; empty means make one and keep it.
if python3 -c 'import json,sys;sys.exit(0 if (json.load(open(sys.argv[1])).get("bridge") or {}).get("pairing_key") else 1)' "$CFG/config.json" 2>/dev/null; then
  say "config.json sets bridge.pairing_key. Remove it there and use the app's Pairing key option instead,"
  say "so the key lives in one place. The app will not start until you do."
  exit 1
fi
KEY="$(opt pairing_key)"
if [ -z "$KEY" ]; then
  if [ ! -s "$CFG/pairing_key" ]; then
    python3 -c 'import secrets; print(secrets.token_urlsafe(18))' > "$CFG/pairing_key"
    chmod 600 "$CFG/pairing_key"
  fi
  KEY="$(cat "$CFG/pairing_key")"
fi
export BRIDGE_KEY="$KEY"

# Ask: nothing is exported for "off". It needs a couch-tv version that reads ASK_ENGINE.
if [ "$(opt ask_engine)" = "home_assistant" ]; then
  export ASK_ENGINE=home_assistant
  AGENT="$(opt ask_agent_id)"
  if [ -n "$AGENT" ]; then export ASK_AGENT_ID="$AGENT"; else
    say "Ask is set to home_assistant but no Conversation agent is chosen: set one in the app's Configuration tab."
  fi
  if python3 -c 'import json,sys;sys.exit(0 if (json.load(open(sys.argv[1])).get("ask") or {}).get("enabled") is False else 1)' "$CFG/config.json" 2>/dev/null; then
    say "config.json has ask.enabled set to false, so Ask stays off until you remove that line."
  fi
fi

IP="$(hostname -I 2>/dev/null | cut -d' ' -f1)"
say "phone remote: pair a phone once by opening http://${IP:-<home assistant address>}:$PORT/?pair=$KEY"

cd "$APP"
python3 bridge/server.py &
BRIDGE_PID=$!

# The MCP server for Home Assistant's MCP integration (loopback, port 5401). A couch-tv without the
# HTTP mode just runs the plain version and exits at once: the bridge carries on either way.
if [ "$(opt allow_power_off)" = "true" ]; then export COUCH_MCP_ALLOW_POWER_OFF=1; fi
BRIDGE_URL="http://127.0.0.1:$PORT" COUCH_MCP_HTTP=1 COUCH_MCP_PORT=5401 python3 bridge/mcp_server.py < /dev/null &
MCP_PID=$!

stop() { kill "$BRIDGE_PID" "$MCP_PID" 2>/dev/null || true; }
trap stop TERM INT

# If the bridge stops, so does the app (Home Assistant restarts it if it is set to).
STATUS=0
wait "$BRIDGE_PID" || STATUS=$?
stop
# A stop from Home Assistant (SIGTERM) shows up as 143: that is a clean stop, not a crash.
[ "$STATUS" -le 128 ] || STATUS=0
exit "$STATUS"
