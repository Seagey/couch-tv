#!/bin/sh
# Build Couch TV for the Apple TV, sign it with your own Apple ID and put it on the Apple TV
# (docs/APPLE-TV.md, "The home app"). With a free Apple ID the app stops opening after 7 days, so the Mac
# that stays on runs this twice a week to sign it again (a launchd example is in the same doc section).
#
#   scripts/appletv-resign.sh                  # the only Apple TV paired with Xcode
#   scripts/appletv-resign.sh "Lounge"         # the paired Apple TV whose name contains this
#   APPLETV_DEVICE=<identifier> scripts/appletv-resign.sh
#
# Needs, once: Xcode signed in to your Apple ID (Settings, Accounts), the Apple TV paired with Xcode
# (Window, Devices and Simulators), and tvos/Config/Signing.mine.xcconfig with your team id and bundle id
# (copy Signing.example.xcconfig). Nothing here is sent anywhere but Apple and your Apple TV, and the
# signing settings stay in that git ignored file.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/build/tvos-device"
LOG="$ROOT/build/appletv-resign.log"
mkdir -p "$ROOT/build"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M')" "$*" | tee -a "$LOG"; }

if [ ! -f "$ROOT/tvos/Config/Signing.mine.xcconfig" ]; then
  say "stopped: tvos/Config/Signing.mine.xcconfig is missing. Copy Signing.example.xcconfig and fill it in (docs/APPLE-TV.md)."
  exit 1
fi
if grep -q "YOURTEAMID" "$ROOT/tvos/Config/Signing.mine.xcconfig"; then
  say "stopped: Signing.mine.xcconfig still says YOURTEAMID. Put your team id in it (docs/APPLE-TV.md)."
  exit 1
fi

# Xcode's own parts must be installed (it asks for the Mac's password once); without them devicectl waits
# for that password forever, so stop instead
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  say "stopped: Xcode has not finished setting itself up. Open Xcode once and let it install its components (it asks for this Mac's password)."
  exit 1
fi

# which Apple TV
DEVICE="${APPLETV_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  LIST="$ROOT/build/devicectl-devices.json"
  xcrun devicectl list devices --json-output "$LIST" >/dev/null 2>&1 || true
  DEVICE=$(python3 - "$LIST" "${1:-}" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devices = []
want = sys.argv[2].lower()
tvs = [d for d in devices if (d.get("hardwareProperties") or {}).get("platform") == "tvOS"
       and want in ((d.get("deviceProperties") or {}).get("name") or "").lower()]
if len(tvs) == 1:
    print(tvs[0]["identifier"])
elif tvs:
    sys.stderr.write("more than one Apple TV: " + ", ".join(d["deviceProperties"]["name"] for d in tvs) + "\n")
PY
)
fi
if [ -z "$DEVICE" ]; then
  say "stopped: no Apple TV paired with Xcode was found (or more than one: name it). Xcode, Window, Devices and Simulators."
  exit 1
fi

say "building Couch TV"
if ! xcodebuild -project "$ROOT/tvos/CouchTV.xcodeproj" -scheme CouchTV -configuration Release \
      -destination "generic/platform=tvOS" -derivedDataPath "$OUT" \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration build >>"$LOG" 2>&1; then
  say "stopped: the build or the signing failed. The end of $LOG says why (often: Xcode is not signed in, or the bundle id is taken)."
  exit 1
fi
APP="$OUT/Build/Products/Release-appletvos/CouchTV.app"
BUNDLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist")

say "installing on the Apple TV"
if ! xcrun devicectl device install app --device "$DEVICE" "$APP" >>"$LOG" 2>&1; then
  say "stopped: the Apple TV did not take the app. Is it on, awake and on the same network? It tries again next time."
  exit 1
fi
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE" >>"$LOG" 2>&1 || true
say "done: Couch TV ($BUNDLE) is signed again and on the Apple TV"
