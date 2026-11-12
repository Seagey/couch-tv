#!/bin/sh
# Puts the sync helper (dev.couchtv.sync) on one TV, switches on its one permission, and checks it.
# Experimental, see docs/SYNC.md. Needs the same yes as anything else that changes a TV.
#
#   sh sync/install.sh <tv address>            install, grant, check
#   sh sync/install.sh --undo <tv address>     take it off again
#
# Run it from the couch-tv folder, once for each TV. Uses the repo's own Python ADB (tv-home/tools/tvadb.py),
# so a Mac needs no new Local Network permission. The APK comes from the Releases page
# (couch-tv-sync.apk, into dist/) or from sync/build.sh; the script looks in both places.
# Set ADB_PORT if the TV's debugging port is not 5555.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY=${PYTHON:-$ROOT/.venv/bin/python}
[ -x "$PY" ] || PY=$(command -v python3)
TVADB="$ROOT/tv-home/tools/tvadb.py"
PKG=dev.couchtv.sync
LISTENER="$PKG/$PKG.Listener"

UNDO=0
[ "${1:-}" = "--undo" ] && { UNDO=1; shift; }
[ $# -eq 1 ] || { echo "Usage: sh sync/install.sh [--undo] <tv address>"; exit 2; }
TV_IP=$1
export TV_IP
tv() { "$PY" "$TVADB" "$@"; }

echo "Checking the TV answers ..."
tv ping > /dev/null || { echo "Cannot reach the TV. Is it on, on the same Wi-Fi, with ADB debugging switched on and allowed for this computer (docs/SETUP.md, step 1)?"; exit 1; }

if [ "$UNDO" = 1 ]; then
  tv shell "cmd notification disallow_listener $LISTENER; pm uninstall $PKG" || exit 1
  echo "The sync helper is off this TV. Nothing else was changed."
  exit 0
fi

APK=""
for f in "$ROOT/dist/couch-tv-sync.apk" "$ROOT/sync/build/couch-tv-sync.apk"; do
  [ -f "$f" ] && { APK=$f; break; }
done
[ -n "$APK" ] || { echo "No couch-tv-sync.apk found. Download it from the GitHub Releases page into dist/, or build it with sync/build.sh."; exit 1; }

echo "Installing $(basename "$APK") ..."
tv install "$APK" || exit 1

echo "Allowing it to see which app is playing ..."
OUT=$(tv shell "cmd notification allow_listener $LISTENER" 2>&1)
# the real test is whether Android now lists it, not what the command printed
if tv shell "settings get secure enabled_notification_listeners" | grep -q "$PKG"; then
  echo "Allowed."
else
  echo "Android would not allow it from here (newer Android TV and Google TV sometimes refuse)."
  [ -n "$OUT" ] && echo "It said: $OUT"
  echo "Allow it by hand on the TV: Settings, Privacy, Special app access (on some TVs Settings, Apps, Special app access),"
  echo "Notification access, then switch on \"couch-tv sync\". If the switch is greyed out, open Settings, Apps,"
  echo "\"couch-tv sync\", the three dots or the Permissions entry, and choose Allow restricted settings first."
  echo "Then run this script again to check it."
  exit 1
fi

REPLY=$(tv shell "am broadcast -a $PKG.CMD -n $PKG/.CmdReceiver --es op ping")
case "$REPLY" in
  *'data="{'*'"sdk"'*) echo "The helper answers. This TV is ready." ;;
  *) echo "The helper is installed but did not answer. Restart the TV and run this script again."; exit 1 ;;
esac
echo "To undo: sh sync/install.sh --undo $TV_IP   (or: pm uninstall $PKG)"
