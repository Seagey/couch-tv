#!/bin/sh
# Installs our Home app on a TV and makes it the home screen. The TV's own home screen and its setup
# wizard stay installed and switched ON: couch-tv is set as the chosen home, and a small Home button
# watch puts couch-tv back whenever the TV opens its own home (at power on, or from the Home key on
# TVs where the Google home outranks the chosen one). Only ambient mode (the idle adverts) and any
# extra packages named in EXTRA_OFF (e.g. an ACR ad tracker the survey found) are switched off, and
# the list of what was switched off is written to tv-home/tvs/<TV_NAME>.disabled, which undo.sh
# reads. Run survey-tv.py first.
#
# Why the TV's own home and setup wizard stay on: switching them off (what couch-tv 0.10 and older
# did) can leave a Google TV in a boot loop after a restart (blank screen, restart, blank screen):
# with no stock home and no setup wizard, the system process can crash at every start. Reported on
# a Sony Bravia Google TV and on other Google TVs. Running this again on a TV set up by an older
# couch-tv switches them back on. Nothing a TV needs at power on is ever switched off, and EXTRA_OFF
# refuses any package with a home screen, a persistent process, or a core part of Android.
#
# Safe to run again: every step checks or repeats cleanly. Other makers' own home screens
# (survey-tv.py lists them) are left alone too.
#
# Option A (TV home only, no computer left on): leave BRIDGE_URL out. The app then shows the copy
#   of the home it carries inside it, with the people, weather, clock, look and quick buttons from
#   your config.json (passed to the TV now). Run this again after you change config.json.
# Option B (computer bridge): set BRIDGE_URL so the home loads from the bridge.
# Smart home (optional, either option): a "home_assistant" section in config.json and the token in
#   .env (docs/CONFIG.md, Smart home). Without one nothing about it changes on the TV.
#
# Usage, from the repo root:
#   TV_IP=<tv address> [BRIDGE_URL=http://<your-computer>:5400] [APK=couch-tv-home.apk]
#     [TV_ID=<id>] [TV_NAME=<name, defaults to TV_ID, else living-room>] [EXTRA_OFF="pkg pkg"] [ADB_PORT=5555]
#     sh tv-home/tools/apply.sh
# APK defaults to the one scripts/build-apk.sh builds. KEEP_SETUP is no longer needed: the setup
# wizard always stays on.
#
# Privacy clean (Beta, opt in, docs/PRIVACY.md): PRIVACY=1 also switches off the known tracking, ad
# and ACR apps from privacy-list.txt that this TV has, through the same safety check and undo list
# as EXTRA_OFF. Without PRIVACY=1 nothing about it changes.
# Dry run: DRY_RUN=1 only lists what would be switched off and left on, and why. It installs
# nothing, switches nothing off and writes no files. Without TV_IP it prints the privacy list.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PY="${PY:-$ROOT/.venv/bin/python}"
T="$HERE/tvadb.py"
TV_NAME=${TV_NAME:-${TV_ID:-living-room}}
DRY=${DRY_RUN:-0}
PRIVACY_LIST="$HERE/privacy-list.txt"
# The privacy list: one app per line, "package | brand | what it does | if it is off | source".
# Only names that look like an Android package are read, so nothing else can reach the TV's shell.
PRIV_ALL=""
if [ -f "$PRIVACY_LIST" ]; then
  PRIV_ALL=$(grep -v '^[[:space:]]*#' "$PRIVACY_LIST" | cut -d'|' -f1 | tr -d ' \t\r' | grep -E '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$' || true)
fi
if [ "${PRIVACY:-0}" = 1 ] && [ -z "$PRIV_ALL" ]; then
  echo "PRIVACY=1, but no privacy list was found at $PRIVACY_LIST. Nothing was changed."
  exit 1
fi
if [ "$DRY" = 1 ] && [ -z "${TV_IP:-}" ]; then
  echo "Dry run with no TV_IP: the privacy list (PRIVACY=1 switches off the ones a TV has)."
  grep -v '^[[:space:]]*#' "$PRIVACY_LIST" | grep '|' | awk -F'|' '{gsub(/^ +| +$/, "", $1); gsub(/^ +| +$/, "", $2); gsub(/^ +| +$/, "", $3); print "  " $2 ": " $1 " (" $3 ")"}'
  echo "Set TV_IP to see which of these a TV has and which apply.sh would leave on."
  exit 0
fi
: "${TV_IP:?set TV_IP to the address of the TV}"
export TV_IP
APK=${APK:-$ROOT/dist/couch-tv-home.apk}
[ -f "$APK" ] || APK=$HERE/../android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$APK" ] && [ "$DRY" != 1 ]; then
  echo "No app found (looked for dist/couch-tv-home.apk and the build output)."
  echo "Download couch-tv-home.apk from the GitHub Releases page and run again with APK=<that file>,"
  echo "or build it with: sh scripts/build-apk.sh"
  exit 1
fi
"$PY" "$T" ping > /dev/null
mkdir -p "$HERE/../tvs"
LIST="$HERE/../tvs/$TV_NAME.disabled"
WIZARD=com.google.android.tungsten.setupwraith
# Never switched off, and switched back on if an older couch-tv (0.10 and before) switched them off:
# the TV's own home screens and the setup wizard. Without them some Google TVs crash at every start.
NEVER_OFF="com.google.android.apps.tv.launcherx com.google.android.tvlauncher com.quickplay.android.bellmediaplayer $WIZARD"
WANT=""
# KEEP_AMBIENT=1 keeps Google TV's ambient mode (the screensaver, and the Google Photos albums
# that come with it) switched on: it is the TV's own, and the screensaver quick button opens it.
[ "${KEEP_AMBIENT:-0}" = 1 ] || WANT="com.google.android.apps.tv.dreamx"
WANT="$WANT ${EXTRA_OFF:-}"
PRIV=""
if [ "${PRIVACY:-0}" = 1 ]; then
  for p in $PRIV_ALL; do
    case " $WANT " in *" $p "*) ;; *) PRIV="$PRIV $p" ;; esac
  done
  WANT="$WANT $PRIV"
fi
HOME_ACT=app.couchtv.launcher/.MainActivity
WATCH=app.couchtv.launcher/.FireWatch
RESOLVE="cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME"

# Anything the TV may need at power on is refused, even when EXTRA_OFF or the privacy list names
# it: a home screen, a setup app, a persistent process or a core part of Android. ($homes is read
# from the TV before this is used.)
needed() {
  case " $NEVER_OFF " in *" $1 "*) return 0 ;; esac
  case "$1" in
    android|app.couchtv.*|com.android.*|com.google.android.gms|com.google.android.gsf|*webview*|com.google.android.trichromelibrary|com.google.android.tv.remote.service|com.google.android.katniss|com.google.android.permissioncontroller|com.google.android.packageinstaller|com.google.android.networkstack*|com.google.android.ext.*|com.google.android.providers.*|com.sony.dtv.sonysystemservice|com.sony.dtv.tvx|*setupwizard*|*.setup|*provision*) return 0 ;;
    # The remote (Bluetooth, pairing, voice, the Assistant, HDMI CEC, the keyboard) and Keep watching
    # (the TV provider that holds Watch Next, TV inputs and listings) always stay on.
    *bluetooth*|*pair*|*.ble*|*remote*|*rcu*|*voice*|*assistant*|*katniss*|*vizzini*|*cec*|*inputmethod*|*.ime|*inputdevice*|*providers.tv*|*tvinput*|*tvprovider*|*listings*|*watchnext*) return 0 ;;
  esac
  echo "$homes" | grep -qx "$1" && return 0
  "$PY" "$T" shell "dumpsys package $1" | grep -q -E "(pkgFlags|flags)=\[.*PERSISTENT" && return 0
  return 1
}
is_priv() { echo "$PRIV_ALL" | grep -qx "$1"; }
# "brand: what it does" for a package on the privacy list.
why() {
  grep -v '^[[:space:]]*#' "$PRIVACY_LIST" | awk -F'|' -v p="$1" '{n=$1; gsub(/[ \t\r]/, "", n); if (n == p) {b=$2; w=$3; gsub(/^ +| +$/, "", b); gsub(/^ +| +$/, "", w); print b ": " w; exit}}'
}
# Works out what to switch off from WANT and does it (or, for a dry run, only says what it would
# do). Reads $present, $disabled and $homes from the TV first, and $OLD (the last undo list).
switch_off() {
  if [ "$DRY" = 1 ]; then would="would leave"; else would="leaving"; fi
  missing=0
  done_priv=0
  for p in $WANT; do
    if ! echo "$present" | grep -qx "$p"; then
      if is_priv "$p"; then missing=$((missing + 1)); fi
      continue
    elif needed "$p"; then
      if echo "$disabled" | grep -qx "$p"; then
        # Refused now, but already switched off by an earlier run (issue #44): it cannot be switched
        # off again here, yet it is still off, so it goes on the undo list and undo.sh turns it back on.
        [ "$DRY" = 1 ] || echo "$p" >> "$LIST"
        echo "     $p is refused as something the TV may need, but it is already switched off from an earlier run: it stays on the undo list so undo.sh switches it back on"
      else
        echo "     $would $p on: the TV may need it to start"
      fi
    elif is_priv "$p" && echo "$disabled" | grep -qx "$p" && ! echo "$OLD" | grep -qx "$p"; then
      # Off before couch-tv touched it (by hand, or by the maker): not ours to switch back on.
      echo "     privacy: $p was already off before couch-tv, so it is left as it is and not put on the undo list"
    elif [ "$DRY" = 1 ]; then
      if is_priv "$p"; then echo "     privacy: would switch off $p ($(why "$p"))"; done_priv=$((done_priv + 1)); else echo "     would switch off $p"; fi
    else
      "$PY" "$T" shell "pm disable-user --user 0 $p"
      echo "$p" >> "$LIST"
      if is_priv "$p"; then echo "     privacy: switched off $p ($(why "$p"))"; done_priv=$((done_priv + 1)); fi
    fi
  done
  # Privacy apps switched off by an earlier PRIVACY=1 run stay off, and stay on the undo list, when
  # this run leaves PRIVACY out: a run without it never changes them, and undo.sh still finds them.
  for p in $OLD; do
    if is_priv "$p" && ! echo " $WANT " | grep -q " $p " && echo "$disabled" | grep -qx "$p"; then
      [ "$DRY" = 1 ] || echo "$p" >> "$LIST"
      echo "     privacy: $p stays off from an earlier PRIVACY=1 run, and stays on the undo list"
    fi
  done
  if [ "${PRIVACY:-0}" = 1 ]; then
    echo "     privacy: $missing apps on the privacy list are not on this TV (nothing to do for them)"
    if [ "$DRY" = 1 ]; then
      echo "     privacy: $done_priv would be switched off"
    else
      echo "     privacy: $done_priv switched off (undo.sh switches them back on)"
    fi
  fi
}
OLD=""
[ -f "$HERE/../tvs/$TV_NAME.disabled" ] && OLD=$(cat "$HERE/../tvs/$TV_NAME.disabled")

if [ "$DRY" = 1 ]; then
  "$PY" "$T" ping > /dev/null
  echo "Dry run: nothing is installed, switched off or written. This is what apply.sh would do."
  present=$("$PY" "$T" shell "pm list packages" | sed 's/package://')
  disabled=$("$PY" "$T" shell "pm list packages -d" | sed 's/package://')
  homes=$("$PY" "$T" shell "pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME" | grep / | sed 's|^ *||; s|/.*||' | sort -u)
  for p in $NEVER_OFF; do
    if echo "$disabled" | grep -qx "$p"; then echo "     would switch $p back on (an older couch-tv had switched it off)"; fi
  done
  LIST=/dev/null
  switch_off
  exit 0
fi

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
# Make couch-tv the chosen home and check the TV took it. On Google TV the Home key itself still
# opens Google's home (it outranks the chosen one), and resolve-activity keeps naming Google's, so
# the check asks for the chosen launcher instead; the Home button watch (step 3) does the rest.
"$PY" "$T" shell "cmd package set-home-activity $HOME_ACT" > /dev/null
NOW=$("$PY" "$T" shell "cmd shortcut get-default-launcher" | grep -m1 Launcher || true)
case "$NOW" in
  *app.couchtv.launcher/*) ;;
  *) echo "The TV did not take couch-tv as its home (it says: $NOW). Nothing was switched off."; exit 1 ;;
esac
# Keep watching with no computer reads Android's Watch Next list, which needs this permission.
"$PY" "$T" shell "pm grant app.couchtv.launcher android.permission.READ_TV_LISTINGS" > /dev/null 2>&1 || true
# The screensaver quick button cuts the screen timeout for a moment (its own screensaver refuses
# apps), which needs "modify system settings".
"$PY" "$T" shell "appops set app.couchtv.launcher WRITE_SETTINGS allow" > /dev/null 2>&1 || true

echo "2/4  Keeping the TV's own home and setup on"
present=$("$PY" "$T" shell "pm list packages" | sed 's/package://')
disabled=$("$PY" "$T" shell "pm list packages -d" | sed 's/package://')
# An older couch-tv switched these off. Switch them back on first: that is the boot loop fix.
for p in $NEVER_OFF; do
  if echo "$disabled" | grep -qx "$p"; then
    "$PY" "$T" shell "pm enable $p" > /dev/null
    echo "     switched $p back on (an older couch-tv had switched it off)"
  fi
done
# What the TV may need at power on (needed(), above) is refused, even when EXTRA_OFF or the privacy
# list names it.
homes=$("$PY" "$T" shell "pm query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME" | grep / | sed 's|^ *||; s|/.*||' | sort -u)
: > "$LIST"
switch_off

echo "3/4  Making couch-tv the home and sending your settings"
"$PY" "$T" shell "cmd package set-home-activity $HOME_ACT"
# Some Google TVs (seen on a Xiaomi, issue #54) keep their own home as the resolved home whatever is
# set here. Say so plainly, since the Home button watch (below) is then what brings couch-tv back.
# Only a note: the run carries on either way.
RESOLVED=$("$PY" "$T" shell "$RESOLVE" | tr -d '\r' | tail -1)
case "$RESOLVED" in
  app.couchtv.launcher/*) echo "     the TV's Home key opens couch-tv itself" ;;
  *) echo "     this TV kept its own home ($RESOLVED) as the one the Home key opens."
     echo "     That is normal on some Google TVs: the Home button watch brings couch-tv back instead." ;;
esac
# Tell our home where the bridge is ("none" for option A) and hand it the settings from
# config.json for its built-in copy. Force-stop first: a running home only reads "bridge".
CFG64=$("$PY" "$HERE/home-config.py")
PAIRING_KEY=$("$PY" "$HERE/home-config.py" --key)
# Smart home (optional, docs/CONFIG.md): the home_assistant section goes to the app on its own,
# never into the page's settings, and is never printed (it holds the Home Assistant token).
# "none" (no section, or it is switched off) switches smart home off on the TV.
HA64=$("$PY" "$HERE/home-config.py" --ha)
SMART=$("$PY" "$HERE/home-config.py" --ha --check)
echo "     $(echo "$SMART" | head -1)"
# The doorbell card shows over other apps, which needs "display over other apps". Only granted
# when a doorbell is set up; taken back if one was set up before and is not any more.
if echo "$SMART" | grep -qx doorbell; then
  "$PY" "$T" shell "appops set app.couchtv.launcher SYSTEM_ALERT_WINDOW allow"
elif "$PY" "$T" shell "appops get app.couchtv.launcher SYSTEM_ALERT_WINDOW" 2> /dev/null | grep -q allow; then
  "$PY" "$T" shell "appops set app.couchtv.launcher SYSTEM_ALERT_WINDOW default"
fi
"$PY" "$T" shell "am force-stop app.couchtv.launcher; am start -n $HOME_ACT --es bridge ${BRIDGE_URL:-none} --es config_b64 $CFG64 --es ha_b64 $HA64 ${TV_ID:+--es tv $TV_ID} --es key \"${PAIRING_KEY:-}\""

# The Home button watch (FireWatch.kt: it only sees which window came forward). The TV's own home
# stays on, so at power on, and from the Home key on Google TV and Fire TV, the TV opens its own
# home; the watch puts couch-tv back on top (the TV's home flashes up for a moment). After the
# force-stop above, because Android drops a stopped app's watcher; the secure-settings grant lets
# the app put it back itself after updates and reboots. undo.sh takes both away. If couch-tv itself
# keeps crashing, the watch stands aside and the TV's own home stays (CrashGuard.kt).
if echo "$present" | grep -qx -E "com.google.android.apps.tv.launcherx|com.google.android.tvlauncher|com.amazon.tv.launcher|com.quickplay.android.bellmediaplayer"; then
  "$PY" "$T" shell "pm grant app.couchtv.launcher android.permission.WRITE_SECURE_SETTINGS" > /dev/null 2>&1 || true
  CUR=$("$PY" "$T" shell "settings get secure enabled_accessibility_services" | tr -d '\r')
  case ":$CUR:" in
    *":$WATCH:"*|*":app.couchtv.launcher/app.couchtv.launcher.FireWatch:"*)
       # Already listed, but the force-stop above leaves Android showing it as a crashed service that
       # is never rebound (issue #37). Take it out of the list and put it back so Android binds it again.
       REST=$(echo "$CUR" | tr ':' '\n' | grep -v -e FireWatch -e '^null$' -e '^$' | paste -sd: - || true)
       if [ -z "$REST" ]; then
         "$PY" "$T" shell "settings delete secure enabled_accessibility_services" > /dev/null
         NEW=$WATCH
       else
         "$PY" "$T" shell "settings put secure enabled_accessibility_services $REST" > /dev/null
         NEW="$REST:$WATCH"
       fi
       sleep 2
       "$PY" "$T" shell "settings put secure enabled_accessibility_services $NEW" ;;
    *) if [ -z "$CUR" ] || [ "$CUR" = null ]; then NEW=$WATCH; else NEW="$CUR:$WATCH"; fi
       "$PY" "$T" shell "settings put secure enabled_accessibility_services $NEW" ;;
  esac
  "$PY" "$T" shell "settings put secure accessibility_enabled 1"
  echo "     the Home button watch is on (the TV's own home may flash up, then couch-tv comes back)"
fi

# Tell the bridge's daily guard what to keep switched off (a Google TV update can switch ambient
# mode back on). Option A has no bridge, so no guard: run this script again after an update.
KEEP="$ROOT/bridge/data/keep-disabled.json"
[ "$TV_NAME" = living-room ] || KEEP="$ROOT/bridge/data/keep-disabled.$TV_NAME.json"
if [ -n "${BRIDGE_URL:-}" ]; then
  mkdir -p "$(dirname "$KEEP")"
  "$PY" -c 'import json,sys; print(json.dumps(sys.stdin.read().split()))' < "$LIST" > "$KEEP"
fi

echo "4/4  Pressing Home"
"$PY" "$T" keys HOME || true
sleep 3

echo "switched off (undo list): $LIST"
cat "$LIST"
if "$PY" "$T" ping > /dev/null 2>&1; then
  FRONT=$("$PY" "$T" shell "dumpsys window | grep -m1 mCurrentFocus" || true)
  case "$FRONT" in
    *app.couchtv.launcher*) echo "home screen now: couch-tv" ;;
    *) echo "home screen now: $(echo "$FRONT" | tr -s ' ' | cut -c1-120)"
       echo "couch-tv is not in front yet. Press Home on the remote. If the TV's own home stays, open"
       echo "Settings, Accessibility (under System or Device Preferences) and check Home button watch is on." ;;
  esac
  echo "Done. The TV is still reachable. Its own home screen and setup wizard are still on, so the"
  echo "TV has them when it next starts."
else
  echo
  echo "Done on the TV, but this computer can no longer reach it. Check the TV is on and on the"
  echo "Wi-Fi, then run this same command again: it is safe to repeat. See \"If something is stuck\""
  echo "in docs/UNINSTALL.md."
  exit 2
fi
