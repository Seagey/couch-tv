#!/bin/sh
# Takes couch-tv completely off a TV and puts it back the way it came (see docs/UNINSTALL.md).
#   0. Checks the computer can still reach the TV over ADB. If not, says how to do it with the
#      TV remote instead and stops, so it never claims a success it did not have.
#   1. Switches the home screen and everything apply.sh switched off back on (undo.sh).
#   2. Removes the couch-tv apps from the TV.
#   3. Optional (DEV_OFF=1): switches off network debugging, USB debugging and Developer options.
#      This has to be last: the moment debugging is off, the computer can no longer reach the TV.
#
# Every ADB call reconnects and tries again when the TV stops answering (tvadb.py). A step that
# still fails is noted and the script carries on, then lists what failed at the end. The one
# exception: if step 1 fails, step 2 and DEV_OFF are skipped, because removing the couch-tv home
# while the Google home is still off leaves the TV with no home screen, and switching debugging
# off would stop the computer fixing it.
#
# Option B: stop the bridge before running this (docs/UNINSTALL.md), or its daily guard can
# switch the Google home off again.
#
# Usage, from the repo root:
#   TV_IP=<tv address> [TV_NAME=living-room] [DEV_OFF=1] [ADB_PORT=5555] sh tv-home/tools/remove-all.sh
HERE=$(cd "$(dirname "$0")" && pwd)
PY="${PY:-$HERE/../../.venv/bin/python}"
T="$HERE/tvadb.py"
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
FAILED=""
note_fail() { FAILED="$FAILED
  - $1"; echo "     that did not work, carrying on: $1"; }

if ! "$PY" "$T" ping > /dev/null; then
  echo
  echo "The computer cannot reach the TV, so nothing was changed. Do it with the TV remote instead"
  echo "(docs/UNINSTALL.md, \"With only the TV remote\"):"
  echo "  1. Settings tile on the couch-tv home (or the Settings button on the remote)."
  echo "  2. Apps, See all apps, Show system apps."
  echo "  3. Open Google TV Home and press Enable. Do the same for Setup."
  echo "  4. Back in Apps, open Home (the couch-tv one) and press Uninstall."
  echo "  5. Press Home. The TV's own home screen is back."
  echo "Do step 3 before step 4."
  exit 1
fi

echo "1/3  Putting the home screen back"
UNDO_OK=1
if ! sh "$HERE/undo.sh"; then
  UNDO_OK=0
  note_fail "putting the home screen back (undo.sh). The couch-tv apps were left on so the TV keeps a home screen."
fi

if [ "$UNDO_OK" = 1 ]; then
  echo "2/3  Removing the couch-tv apps"
  for p in ${APPS:-app.couchtv.launcher dev.couchtv.ontv}; do
    if ! LISTED=$("$PY" "$T" shell "pm list packages $p"); then
      note_fail "checking for $p"
    elif echo "$LISTED" | grep -q "package:$p\$"; then
      "$PY" "$T" shell "pm uninstall $p" || note_fail "removing $p"
    else
      echo "     $p is not on this TV"
    fi
  done
  "$PY" "$T" keys HOME || echo "     could not press Home (harmless): press it on the remote"
else
  echo "2/3  Skipped: the couch-tv apps stay until the home screen is back"
fi

if [ "${DEV_OFF:-0}" = 1 ] && [ "$UNDO_OK" = 1 ]; then
  echo "3/3  Switching off debugging and Developer options (the connection drops now, that is expected)"
  # One try, short wait: once adb_enabled is 0 the TV hangs up, so no answer is the normal case.
  TVADB_TRIES=1 TVADB_TIMEOUT=15 "$PY" "$T" shell "settings put global adb_wifi_enabled 0; settings put global development_settings_enabled 0; settings put global adb_enabled 0" > /dev/null 2>&1 || true
  sleep 3
  if TVADB_TRIES=1 "$PY" "$T" ping > /dev/null 2>&1; then
    note_fail "switching debugging off (the TV still answers). Switch it off on the TV: docs/UNINSTALL.md"
  fi
elif [ "${DEV_OFF:-0}" = 1 ]; then
  echo "3/3  Skipped: debugging stays on so the computer can still fix step 1"
else
  echo "3/3  Developer options left on. Run again with DEV_OFF=1, or switch them off on the TV (docs/UNINSTALL.md)."
fi

if [ -n "$FAILED" ]; then
  echo
  echo "Finished, but these steps did not work:$FAILED"
  echo "Run this again (it is safe to repeat), or use the TV-remote route in docs/UNINSTALL.md."
  exit 1
fi
echo "Done. Press Home on the TV: you should see the TV's own home screen."
