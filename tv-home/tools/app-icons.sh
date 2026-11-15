#!/bin/sh
# Your own app icons and banners on the TV home (docs/TV-HOME.md, "Your own app icons").
# Copies pictures named after each app's package into the home's own folder on the TV
# (Android/data/app.couchtv.launcher/files/custom), then loads the home afresh so they show.
# Changes nothing else on the TV, and works with options A and B (the TV home app).
#
#   <folder>/icons/<package>.png     square, about 512 x 512: the dock and the Keep watching badge
#   <folder>/banners/<package>.png   16:9, about 640 x 360: the Classic grid and More apps
# PNG, JPEG (.jpg) or WebP. An app with no picture keeps its own. survey-tv.py lists the package
# names, for example com.netflix.ninja for Netflix.
#
# Usage, from the repo root:
#   TV_IP=<tv address> [ADB_PORT=5555] sh tv-home/tools/app-icons.sh <folder>    copy them (adds or replaces)
#   TV_IP=<tv address> sh tv-home/tools/app-icons.sh --list                       what is on the TV now
#   TV_IP=<tv address> sh tv-home/tools/app-icons.sh --remove                     every app's own pictures again
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
PY="${PY:-$HERE/../../.venv/bin/python}"
T="$HERE/tvadb.py"
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
APP=app.couchtv.launcher
DIR=/sdcard/Android/data/$APP/files/custom
[ $# -eq 1 ] || { echo "usage: TV_IP=<tv address> sh tv-home/tools/app-icons.sh <folder> | --list | --remove"; exit 1; }

"$PY" "$T" ping > /dev/null
"$PY" "$T" shell "pm path $APP" | grep -q package: || { echo "The couch-tv home is not on this TV (apply.sh puts it there)."; exit 1; }

# Loads the page afresh (the same as Home settings, About, Restart home) when the home is in front,
# or starts it, so the new pictures show. No force-stop: that would also stop the Home button watch.
reload() { "$PY" "$T" shell "am start -n $APP/.MainActivity --ez restart true" > /dev/null; }

case "$1" in
  --list)
    "$PY" "$T" shell "ls $DIR/icons $DIR/banners 2>/dev/null" || true
    exit 0 ;;
  --remove)
    "$PY" "$T" shell "rm -rf $DIR"
    reload
    echo "Removed. Every app shows its own icon and banner again."
    exit 0 ;;
esac

SRC=$1
[ -d "$SRC/icons" ] || [ -d "$SRC/banners" ] || { echo "$SRC has no icons or banners folder in it."; exit 1; }
COUNT=0
for KIND in icons banners; do
  [ -d "$SRC/$KIND" ] || continue
  for F in "$SRC/$KIND"/*; do
    [ -f "$F" ] || continue
    NAME=$(basename "$F")
    PKG=${NAME%.*}
    EXT=$(echo "${NAME##*.}" | tr 'A-Z' 'a-z')
    # the same rule the app keeps (CustomArt.kt): a package name, and a PNG, JPEG or WebP
    if ! echo "$PKG" | grep -Eq '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$' || [ ${#PKG} -gt 255 ]; then
      echo "     skipping $KIND/$NAME: name it after the app's package, for example com.netflix.ninja.png"
      continue
    fi
    case "$EXT" in png|jpg|webp) ;; *) echo "     skipping $KIND/$NAME: PNG, JPEG (.jpg) or WebP only"; continue ;; esac
    # one picture per app: a new .jpg replaces an older .png and the other way round
    "$PY" "$T" shell "rm -f $DIR/$KIND/$PKG.png $DIR/$KIND/$PKG.jpg $DIR/$KIND/$PKG.webp"
    "$PY" "$T" put "$F" "$DIR/$KIND/$PKG.$EXT" > /dev/null
    echo "     $KIND/$PKG.$EXT"
    COUNT=$((COUNT + 1))
  done
done
reload
echo "Copied $COUNT. The home loads them now; --list shows what is on the TV, --remove takes them off."
