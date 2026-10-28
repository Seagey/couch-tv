#!/bin/sh
# Installs our Home app on a TV and makes it the home screen. Switches off the Google TV home,
# ambient mode, any extra packages named in EXTRA_OFF (e.g. an ACR ad tracker the survey found)
# and, last of all, the setup wizard (its "recovery home" outranks any home app we can install).
# Only packages that exist on that TV are touched, and the list of what was switched off is
# written to tv-home/tvs/<TV_NAME>.disabled, which undo.sh reads. Run survey-tv.py first.
#
# Order matters. Everything that needs the network (install, switch-offs, setting the home,
# sending config.json) happens first. The setup wizard goes off last, in one command that runs on
# the TV by itself, because on some TVs switching it off makes the TV forget its Wi-Fi, and then
# this computer can no longer reach it. Safe to run again: every step checks or repeats cleanly.
#
# Other makers' own home screens (survey-tv.py lists them) are left alone: the TV's default home
# is set to couch-tv instead, with `cmd package set-home-activity`.
#
# Option A (TV home only, no computer left on): leave BRIDGE_URL out. The app then shows the copy
#   of the home it carries inside it, with the people, weather, clock, look and quick buttons from
#   your config.json (passed to the TV now). Run this again after a Google TV update brings the
#   Google home back, or after you change config.json.
# Option B (computer bridge): set BRIDGE_URL so the home loads from the bridge.
#
# Usage, from the repo root:
#   TV_IP=<tv address> [BRIDGE_URL=http://<your-computer>:5400] [APK=couch-tv-home.apk]
#     [TV_NAME=living-room] [TV_ID=<id>] [EXTRA_OFF="pkg pkg"] [KEEP_SETUP=1] [ADB_PORT=5555]
#     sh tv-home/tools/apply.sh
# APK defaults to the one scripts/build-apk.sh builds. KEEP_SETUP=1 leaves the setup wizard on.
# On some TVs the wizard then keeps winning Home; if Home still shows Google TV afterwards, the
# wizard has to go off.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PY="${PY:-$ROOT/.venv/bin/python}"
T="$HERE/tvadb.py"
TV_NAME=${TV_NAME:-living-room}
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
APK=${APK:-$ROOT/dist/couch-tv-home.apk}
[ -f "$APK" ] || APK=$HERE/../android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$APK" ]; then
  echo "No app found (looked for dist/couch-tv-home.apk and the build output)."
  echo "Download couch-tv-home.apk from the GitHub Releases page and run again with APK=<that file>,"
  echo "or build it with: sh scripts/build-apk.sh"
  exit 1
fi
"$PY" "$T" ping > /dev/null
mkdir -p "$HERE/../tvs"
LIST="$HERE/../tvs/$TV_NAME.disabled"
WIZARD=com.google.android.tungsten.setupwraith
WANT="com.google.android.apps.tv.launcherx com.google.android.tvlauncher com.google.android.apps.tv.dreamx ${EXTRA_OFF:-}"
HOME_ACT=app.couchtv.launcher/.MainActivity
RESOLVE="cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME"

# Remember the home the TV had, so undo.sh puts that one back (it may be the maker's own). Only
# the first run writes it, so a re-run never replaces the original with something in between.
if [ ! -f "$HERE/../tvs/$TV_NAME.home" ]; then
  PREV=$("$PY" "$T" shell "$RESOLVE" | tail -1)
  case "$PREV" in
    app.couchtv.launcher/*|"$WIZARD"/*) ;;
    */*) echo "$PREV" > "$HERE/../tvs/$TV_NAME.home" ;;
  esac
fi

echo "1/4  Installing the app"
"$PY" "$T" install "$APK"

echo "2/4  Switching off the Google home and ambient mode"
present=$("$PY" "$T" shell "pm list packages" | sed 's/package://')
disabled=$("$PY" "$T" shell "pm list packages -d" | sed 's/package://')
: > "$LIST"
for p in $WANT; do
  if echo "$present" | grep -qx "$p"; then
    "$PY" "$T" shell "pm disable-user --user 0 $p"
    echo "$p" >> "$LIST"
  fi
done
WIZARD_OFF=0
if [ "${KEEP_SETUP:-0}" != 1 ] && echo "$present" | grep -qx "$WIZARD"; then
  echo "$WIZARD" >> "$LIST"
  if echo "$disabled" | grep -qx "$WIZARD"; then
    echo "     the setup wizard is already off"
  else
    WIZARD_OFF=1
  fi
fi

echo "3/4  Making couch-tv the home and sending your settings"
"$PY" "$T" shell "cmd package set-home-activity $HOME_ACT"
# Tell our home where the bridge is ("none" for option A) and hand it the settings from
# config.json for its built-in copy. Force-stop first: a running home only reads "bridge".
CFG64=$("$PY" "$HERE/home-config.py")
"$PY" "$T" shell "am force-stop app.couchtv.launcher; am start -n $HOME_ACT --es bridge ${BRIDGE_URL:-none} --es config_b64 $CFG64 ${TV_ID:+--es tv $TV_ID}"

# Tell the bridge's daily guard what to keep switched off (a Google TV update can switch it back
# on). Option A has no bridge, so no guard: run this script again after an update.
KEEP="$ROOT/bridge/data/keep-disabled.json"
[ "$TV_NAME" = living-room ] || KEEP="$ROOT/bridge/data/keep-disabled.$TV_NAME.json"
if [ -n "${BRIDGE_URL:-}" ]; then
  mkdir -p "$(dirname "$KEEP")"
  "$PY" -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))' < "$LIST" > "$KEEP"
fi

if [ "$WIZARD_OFF" = 1 ]; then
  echo "4/4  Switching off the setup wizard (last, because on some TVs this drops the Wi-Fi)"
  # One command, so the TV finishes it by itself even if its Wi-Fi drops halfway. Setting the home
  # again after the switch-off stops the wizard's recovery home winning.
  "$PY" "$T" shell "pm disable-user --user 0 $WIZARD; cmd package set-home-activity $HOME_ACT; input keyevent KEYCODE_HOME" > /dev/null 2>&1 || true
  sleep 5
else
  echo "4/4  Setup wizard: nothing to do"
  "$PY" "$T" keys HOME || true
fi

echo "switched off (undo list): $LIST"
cat "$LIST"
if "$PY" "$T" ping > /dev/null 2>&1; then
  NOW=$("$PY" "$T" shell "$RESOLVE" || true)
  echo "home screen now: $(echo "$NOW" | tail -1)"
  echo "Done. The TV is still reachable."
else
  echo
  echo "Done on the TV, but this computer can no longer reach it. Switching the setup wizard off"
  echo "can make a TV forget its Wi-Fi. At the TV: Settings, Network and Internet (or Network), pick"
  echo "your Wi-Fi and join it again. Then run this same command again: it is safe to repeat, and"
  echo "it checks everything is in place. If the TV will not rejoin, see \"If something is stuck\""
  echo "in docs/UNINSTALL.md."
  exit 2
fi
