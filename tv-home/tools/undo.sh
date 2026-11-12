#!/bin/sh
# Puts a TV's own home screen back (see docs/UNINSTALL.md). Switches back on exactly what apply.sh
# switched off on that TV (tv-home/tvs/<TV_NAME>.disabled), then makes the home the TV had before
# (tv-home/tvs/<TV_NAME>.home, else Google TV) the home again. Stops on the first ADB failure
# (each ADB call already reconnects and retries, see tvadb.py).
#
# Option B: stop the bridge first (docs/UNINSTALL.md). This empties its keep-off list as well.
#
# Usage: TV_IP=<tv address> [TV_ID=<id>] [TV_NAME=<name, defaults to TV_ID, else living-room>] [ADB_PORT=5555] sh tv-home/tools/undo.sh
#   (run from the repo root)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PY="${PY:-$ROOT/.venv/bin/python}"
T="$HERE/tvadb.py"
TV_NAME=${TV_NAME:-${TV_ID:-living-room}}
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
"$PY" "$T" ping > /dev/null
LIST="$HERE/../tvs/$TV_NAME.disabled"
if [ -f "$LIST" ]; then
  PKGS=$(cat "$LIST")
else
  # No list from apply.sh on this computer: ambient mode, which apply.sh always switches off.
  # Anything else (an ad tracker passed in EXTRA_OFF, or an app from PRIVACY=1) is not known here:
  # see survey-tv.py's list and tv-home/tools/privacy-list.txt.
  echo "No $LIST on this computer, switching the standard Google packages back on."
  PKGS="com.google.android.apps.tv.dreamx"
fi
# The TV's own homes and the setup wizard always go back on, whatever the list says: couch-tv 0.10
# and older switched them off, and without them some Google TVs loop at power on.
PKGS="com.google.android.apps.tv.launcherx com.google.android.tvlauncher com.google.android.tungsten.setupwraith $PKGS"
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
# Smart home's doorbell card: take back "display over other apps" if apply.sh granted it.
"$PY" "$T" shell "appops set app.couchtv.launcher SYSTEM_ALERT_WINDOW default" > /dev/null 2>&1 || true
# The screensaver button's "modify system settings" grant goes back too.
"$PY" "$T" shell "appops set app.couchtv.launcher WRITE_SETTINGS default" > /dev/null 2>&1 || true
# Switch off the Home button watch apply.sh switched on (any TV with a stock home), and leave any
# other accessibility service alone.
# The grant goes first, so the app cannot put the watch back.
"$PY" "$T" shell "pm revoke app.couchtv.launcher android.permission.WRITE_SECURE_SETTINGS" > /dev/null 2>&1 || true
CUR=$("$PY" "$T" shell "settings get secure enabled_accessibility_services" 2> /dev/null | tr -d '\r' || true)
case "$CUR" in
  *app.couchtv.launcher/*)
    NEW=$(echo "$CUR" | tr ':' '\n' | grep -v '^app\.couchtv\.launcher/' | paste -sd: -)
    if [ -n "$NEW" ]; then
      "$PY" "$T" shell "settings put secure enabled_accessibility_services $NEW"
    else
      "$PY" "$T" shell "settings delete secure enabled_accessibility_services"
    fi
    echo "The Home button watch is off." ;;
esac
HOME_ACT=""
[ -f "$HERE/../tvs/$TV_NAME.home" ] && HOME_ACT=$(cat "$HERE/../tvs/$TV_NAME.home")
if [ -z "$HOME_ACT" ]; then
  # Ask the TV which activity its Google home has for HOME: it is not always .home.HomeActivity (a TCL
  # with Android TV 11 has .home.VanillaModeHomeActivity, issue #51). The names are only a fallback.
  HOMES=$("$PY" "$T" shell "cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME" 2> /dev/null | tr -d '\r' | sed 's|^ *||' || true)
  if echo "$present" | grep -qx com.google.android.apps.tv.launcherx; then
    HOME_ACT=$(echo "$HOMES" | grep '^com\.google\.android\.apps\.tv\.launcherx/' | head -1)
    [ -n "$HOME_ACT" ] || HOME_ACT=com.google.android.apps.tv.launcherx/.home.HomeActivity
  elif echo "$present" | grep -qx com.google.android.tvlauncher; then
    HOME_ACT=$(echo "$HOMES" | grep '^com\.google\.android\.tvlauncher/' | head -1)
    [ -n "$HOME_ACT" ] || HOME_ACT=com.google.android.tvlauncher/.MainActivity
  fi
fi
if [ -n "$HOME_ACT" ]; then
  "$PY" "$T" shell "cmd package set-home-activity $HOME_ACT" || true
else
  echo "No Google home on this TV and no saved home: the TV will ask which home to use."
fi
# The rest only shows the result, so a TV that stops answering here does not fail the undo.
"$PY" "$T" keys HOME || echo "(could not press Home: press it on the remote)"
NOW=$("$PY" "$T" shell "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME" || true)
echo "home screen now: $(echo "$NOW" | tail -1)"
case "$NOW" in
  *app.couchtv.launcher*)
    echo "The TV still picks couch-tv for Home (some Google TVs keep that choice while the app is on)."
    echo "Its own home and setup app are back on for the next restart. To hand Home back fully,"
    echo "remove the app: sh tv-home/tools/remove-all.sh" ;;
esac
