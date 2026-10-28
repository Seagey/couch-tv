#!/bin/sh
# Puts a TV's own home screen back (see docs/UNINSTALL.md). Switches back on exactly what apply.sh
# switched off on that TV (tv-home/tvs/<TV_NAME>.disabled), then makes the home the TV had before
# (tv-home/tvs/<TV_NAME>.home, else Google TV) the home again. Stops on the first ADB failure
# (each ADB call already reconnects and retries, see tvadb.py).
#
# Option B: stop the bridge first (docs/UNINSTALL.md). This empties its keep-off list as well.
#
# Usage: TV_IP=<tv address> [TV_NAME=living-room] [ADB_PORT=5555] sh tv-home/tools/undo.sh
#   (run from the repo root)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PY="${PY:-$ROOT/.venv/bin/python}"
T="$HERE/tvadb.py"
TV_NAME=${TV_NAME:-living-room}
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
"$PY" "$T" ping > /dev/null
LIST="$HERE/../tvs/$TV_NAME.disabled"
if [ -f "$LIST" ]; then
  PKGS=$(cat "$LIST")
else
  # No list from apply.sh on this computer: the Google packages apply.sh always switches off.
  # Anything else (an ad tracker passed in EXTRA_OFF) is not known here: see survey-tv.py's list.
  echo "No $LIST on this computer, switching the standard Google packages back on."
  PKGS="com.google.android.apps.tv.launcherx com.google.android.tvlauncher com.google.android.apps.tv.dreamx com.google.android.tungsten.setupwraith"
fi
# Stop the bridge's daily guard switching them off again. One list per TV, owned by the bridge:
# keep-disabled.json for the default TV, keep-disabled.<tv>.json for the others.
KEEP="$ROOT/bridge/data/keep-disabled.json"
[ "$TV_NAME" = living-room ] || KEEP="$ROOT/bridge/data/keep-disabled.$TV_NAME.json"
if [ -f "$KEEP" ]; then echo '[]' > "$KEEP"; fi
present=$("$PY" "$T" shell "pm list packages" | sed 's/package://')
for p in $PKGS; do
  if echo "$present" | grep -qx "$p"; then
    "$PY" "$T" shell "pm enable $p"
  fi
done
HOME_ACT=""
[ -f "$HERE/../tvs/$TV_NAME.home" ] && HOME_ACT=$(cat "$HERE/../tvs/$TV_NAME.home")
if [ -z "$HOME_ACT" ]; then
  if echo "$present" | grep -qx com.google.android.apps.tv.launcherx; then
    HOME_ACT=com.google.android.apps.tv.launcherx/.home.HomeActivity
  elif echo "$present" | grep -qx com.google.android.tvlauncher; then
    HOME_ACT=com.google.android.tvlauncher/.MainActivity
  fi
fi
if [ -n "$HOME_ACT" ]; then
  "$PY" "$T" shell "cmd package set-home-activity $HOME_ACT"
else
  echo "No Google home on this TV and no saved home: the TV will ask which home to use."
fi
# The rest only shows the result, so a TV that stops answering here does not fail the undo.
"$PY" "$T" keys HOME || echo "(could not press Home: press it on the remote)"
NOW=$("$PY" "$T" shell "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME" || true)
echo "home screen now: $(echo "$NOW" | tail -1)"
