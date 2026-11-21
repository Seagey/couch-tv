#!/bin/bash
# couch-tv for Samsung: puts couch-tv (CouchTV.wgt, next to this file) on a Samsung TV from a Mac.
# Double-click it in Finder. Read "START HERE.txt" first: Developer mode has to be on on the TV.
#
# It uses Apps2Samsung's free command line tool (GPL-3.0, github.com/Apps2Samsung/Apps2Samsung),
# a pinned version, checked against its SHA-256 before it runs, to sign the app with the person's
# own Samsung certificate and install it. Nothing is sent anywhere else.
set -u

A2S_VERSION="3.3.1"
A2S_SHA_ARM64="f3a63efb340a66791108ca7ff5f968cbd28c24608c0b891f73fa853ab34d3a81"
A2S_SHA_X64="80fb2a81a7ea8b6e577582aaf2cbaee82e8719dc8dd2ffa88cb679ddf45b5c8d"

HERE="$(dirname "$0")"
WGT="$HERE/CouchTV.wgt"
TOOLS="$HOME/Library/Application Support/couch-tv/apps2samsung-cli-$A2S_VERSION"
CLI="$TOOLS/apps2samsung-cli"

say() { printf '%s\n' "$@"; }
stop() { say "" "$1" "" "Press Return to close this window."; read -r _; exit 1; }
ask() { printf '%s ' "$1"; read -r REPLY; }

clear
say "couch-tv for Samsung" "====================" ""
say "This puts couch-tv on your Samsung TV. Keep the TV switched on, with Developer mode on"
say "(START HERE.txt, step 3)." ""

[ -f "$WGT" ] || stop "CouchTV.wgt is not next to this file. Unzip the whole couch-tv-samsung-setup.zip and run it from that folder."

# ---- 1. the install tool ----
# The download is kept and checked against its SHA-256 every time, and the tool is unpacked again
# from it, so a tool changed on this Mac after the first run is never used.
case "$(uname -m)" in
  arm64) ARCH="arm64"; SHA="$A2S_SHA_ARM64" ;;
  *) ARCH="x64"; SHA="$A2S_SHA_X64" ;;
esac
TGZ="$TOOLS/cli-$ARCH.tar.gz"
mkdir -p "$TOOLS" || stop "Could not make a folder for it in your Library."
sha_of() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
if [ ! -f "$TGZ" ] || [ "$(sha_of "$TGZ")" != "$SHA" ]; then
  rm -f "$TGZ"
  say "Downloading Apps2Samsung's free install tool ($A2S_VERSION, about 35 MB) from GitHub..."
  curl -fL --progress-bar -o "$TGZ" \
    "https://github.com/Apps2Samsung/Apps2Samsung/releases/download/v$A2S_VERSION/Apps2Samsung.Cli-v$A2S_VERSION-osx-$ARCH.tar.gz" \
    || { rm -f "$TGZ"; stop "The download did not work. Check the Mac is online, then run this again."; }
  if [ "$(sha_of "$TGZ")" != "$SHA" ]; then
    rm -f "$TGZ"
    stop "The download was not the expected file, so it was not used. Run this again later."
  fi
  say "Done." ""
fi
rm -f "$CLI"
tar -xzf "$TGZ" -C "$TOOLS" apps2samsung-cli || stop "Could not unpack the tool."
chmod +x "$CLI"

# ---- 2. the TV ----
say "Looking for Samsung TVs on your Wi-Fi (about 10 seconds)..."
SCAN="$("$CLI" scan --json 2>/dev/null)"
PICK="$(osascript -l JavaScript -e '
function run(a) {
  var j; try { j = JSON.parse(a[0]); } catch (e) { return "\t"; }
  var tvs = (j && j.tvs) || [], out = [String(j.localIp || "")];
  tvs.forEach(function (t) {
    var ip = t.ip || t.address || t.host || "";
    if (ip) out.push(ip + "  " + (t.name || t.model || t.modelName || "Samsung TV"));
  });
  return out.join("\n");
}' "$SCAN" 2>/dev/null)"
MYIP="$(printf '%s\n' "$PICK" | sed -n 1p)"
LIST="$(printf '%s\n' "$PICK" | sed -n '2,$p')"
if [ -n "$MYIP" ]; then
  say "" "This computer's address is: $MYIP"
  say "It is the address to type on the TV in Developer mode (START HERE.txt, step 3)." ""
fi

TV=""
COUNT="$(printf '%s' "$LIST" | grep -c . || true)"
if [ "$COUNT" = "1" ]; then
  TV="$(printf '%s\n' "$LIST" | awk '{print $1}')"
  say "Found: $LIST"
elif [ "$COUNT" -gt 1 ] 2>/dev/null; then
  say "Found these TVs:"
  printf '%s\n' "$LIST" | awk '{print "  " NR ". " $0}'
  ask "Type the number of your TV and press Return:"
  TV="$(printf '%s\n' "$LIST" | sed -n "${REPLY}p" | awk '{print $1}')"
fi
if [ -z "$TV" ]; then
  say "" "No TV was found by itself. Is the TV switched on? Switch the TV on with its remote first"
  say "(on The Frame, a short press), then run this again. Or type its address instead."
  say "On the TV: Settings, General (or Connection), Network, Network Status, IP Settings."
  ask "The TV's address (four numbers with dots, as the TV shows it):"
  TV="$(printf '%s' "$REPLY" | tr -d ' ')"
fi
printf '%s' "$TV" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || stop "That is not a TV address. Run this again."

# ---- 3. is Developer mode on? ----
while :; do
  say "" "Checking the TV at $TV..."
  "$CLI" tv "$TV"
  CODE=$?
  [ $CODE -eq 0 ] && break
  say "" "The TV is not ready yet. Usually that means one of these:"
  say "  - The TV is off or asleep: switch the TV on with its remote first (on The Frame, a short press)."
  say "  - Developer mode is off: do START HERE.txt step 3."
  say "  - The address typed in Developer mode is not this computer's ($MYIP)."
  say "  - The TV was not restarted by holding the power button after Developer mode."
  ask "Fix it on the TV, then press Return to check again (or type q to stop):"
  [ "$REPLY" = "q" ] && stop "Stopped. Nothing was installed."
done

# ---- 4. install ----
say "" "Next, a browser may open for your Samsung account. It is Samsung's own sign-in page:"
say "this setup never sees your password. It makes a certificate for your TV only. If Samsung"
say "asks you to agree or to allow access, say yes. Then come back to this window." ""
ask "Press Return to put couch-tv on the TV:"
"$CLI" install "$WGT" --tv "$TV"
CODE=$?
if [ $CODE -eq 3 ]; then
  say "" "The install tool stopped at a check (above). An older couch-tv on the TV may have to be"
  say "removed first; its settings on the TV are then lost, but anything kept on a computer stays."
  ask "Type y and press Return to go on, or just Return to stop:"
  if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
    "$CLI" install "$WGT" --tv "$TV" --yes
    CODE=$?
  fi
fi
[ $CODE -eq 0 ] || stop "couch-tv did not go on the TV. What went wrong is above. Help: couchtv.joshuaseage.com/help/tv-samsung"

"$CLI" launch CouchTVApp.Home --tv "$TV" >/dev/null 2>&1
say "" "couch-tv is on your TV. If it is not on screen, open it from the TV's row of apps (Couch TV)." ""
say "Next, on the TV:"
say "  - Settings, General, Smart Features, Autorun Last App: On (couch-tv comes back when the TV does)."
say "  - To open couch-tv: press Home on the Samsung remote, then pick Couch TV in the row of apps."
say "  - couch-tv Studio: the gear tile, Designs, Get a design, then type your code."
say "" "To update couch-tv later, run this again with the newest download. Your settings stay."
say "" "Press Return to close this window."
read -r _
