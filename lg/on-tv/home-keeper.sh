#!/bin/sh
# couch-tv home keeper for a 1 GB LG (webOS 4).
#  - Home button pressed in an app or on an input: open the home (see watch_home_key).
#  - Another app on screen: close the home, so the app (video players above all) gets its memory.
#  - An input or live TV on screen only because an app closed, or because the TV just started:
#    open the home, so the TV never sits on a black input. An input chosen from the home, from
#    LG's own home or from another input is left alone.
HOME_APP=app.couchtv.home
fg() { luna-send -n 1 -w 3000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null </dev/null | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p'; }
wait_for_bridge() {  # at boot the bridge needs a while; a home opened before it is up starts offline
  w=0
  while [ $w -lt 45 ] && ! netstat -tln 2>/dev/null | grep -q ":5400 "; do sleep 1; w=$((w + 1)); done
}
open_home() {  # $1: what is on screen now
  n=0
  while [ $n -lt 8 ]; do
    luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_APP\"}" >/dev/null 2>&1 </dev/null
    sleep 4
    [ "$(fg)" = "$1" ] || return 0   # the screen moved on: the home came up, or someone chose something
    n=$((n + 1))
  done
}
kind() {
  case "$1" in
    "") echo none ;;
    "$HOME_APP"|com.webos.app.home|com.webos.app.fullhome) echo home ;;
    com.webos.app.hdmi*|com.webos.app.externalinput*|com.webos.app.livetv) echo input ;;
    *) echo app ;;
  esac
}
# Home button. On webOS 4 it opens LG's launcher bar over the current app and the foreground app does
# not change, but the TV logs each press with the app it was pressed in. Pressed anywhere but the
# couch-tv home: open the home, which also puts the launcher bar away. Pressed on the home: the bar
# stays, and that is the way to LG's own launcher. Nothing is injected into LG's services (LG Input
# Hook crashed tvservice on this TV).
watch_home_key() {
  tail -F -n 0 /var/log/messages 2>/dev/null </dev/null | while read -r line; do
    case "$line" in
      *NL_HOME_SHOWN*homeKey*)
        case "$line" in
          *"\"foreground_id\":\"$HOME_APP\""*) ;;
          *) luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$HOME_APP\"}" >/dev/null 2>&1 </dev/null ;;
        esac ;;
    esac
  done
}
watch_home_key &

prev=boot
luna-send -i luna://com.webos.applicationManager/getForegroundAppInfo '{"subscribe":true}' 2>/dev/null </dev/null |
while read -r line; do
  app=$(echo "$line" | sed -n 's/.*"appId":"\([^"]*\)".*/\1/p')
  k=$(kind "$app")
  case "$k" in
    none) continue ;;
    input) if [ "$prev" = boot ]; then wait_for_bridge; fi
           if [ "$prev" = boot ] || [ "$prev" = app ]; then open_home "$app"; fi ;;
    app) luna-send -n 1 luna://com.webos.applicationManager/closeByAppId "{\"id\":\"$HOME_APP\"}" >/dev/null 2>&1 </dev/null ;;
  esac
  prev=$k
done
