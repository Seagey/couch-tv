# On-TV mode: the remote with no computer

Couch TV normally needs a computer on the network running the bridge. **On-TV mode puts the bridge
inside an app on the TV.** The phone remote is served by the TV itself, and the TV controls itself
through its own debugging port. Nothing else has to stay switched on.

It is a separate app (`dev.couchtv.ontv`, shown as **Couch TV** in the TV's app list). It installs
next to anything else, including the computer-bridge home screen, and it does not take over the
home button unless you switch that on.

## What works, compared with the computer bridge

| Feature | Computer bridge | On-TV mode | Notes for on-TV mode |
|---|---|---|---|
| Phone remote page | yes | yes | Served by the TV at `http://<tv-ip>:5400`. Same remote build as the computer bridge. |
| Pairing a phone | not needed (home network only) | **required** | A 6 digit code on the TV, once per phone. Every call needs the phone's token. |
| Open an app | yes | yes | Plain Android intents, even without ADB. |
| D-pad, back, home, playback keys | yes | yes, with ADB | Through the TV's own ADB (see below). Home works without ADB. |
| Volume | yes | yes | With ADB: key presses, so HDMI soundbars follow. Without ADB: the TV's own speaker only. |
| Type into a search box | yes | yes, with ADB | |
| Turn the TV off | yes | yes, with ADB | |
| **Turn the TV on** | yes (Wake-on-LAN) | **no** | Once the TV sleeps, this app sleeps too. See "Power on" below. |
| What is playing | yes | yes, with ADB | Same `dumpsys media_session` reading as the bridge. Apps that report no title show the app only. |
| Play a show by name | yes | yes | Same JustWatch lookup and deep-link table as the bridge, no key needed. |
| Keep watching | yes | partial | Built from what was started from the phone on this TV. No imported history. |
| Sleep timer | yes | yes, with ADB | Pause, then off. |
| Screenshot (`/api/screenshot`) | yes | yes, with ADB | |
| Picks and taste profile | yes | no | Needs "ask". |
| Ask Claude | yes (computer's Claude Code) | **off by default** | Optional: your own Anthropic API key on the setup page. See below. |
| Picture mode, screens, Moonlight | yes | no | |
| Home screen (TV home page) | yes | yes, optional | Same page, served from the app. Replacing Google's home needs one ADB command, see below. |
| Live updates (`/api/events`) | yes | yes | Server-sent events, plus a WebSocket at `/api/ws`. |

## Which TVs

- **Yes:** Android TV and Google TV (Chromecast with Google TV, Google TV Streamer, Sony, TCL,
  Hisense, Philips and other Google TV sets), Nvidia Shield, and Fire TV on Fire OS. Android 9 or newer.
- **No:** Samsung (Tizen), LG (webOS), Roku, Apple TV, Hisense VIDAA, and Fire TV sticks on Vega OS.
  These do not run Android apps. Use the computer bridge for those where it can reach them.

### The one setup step: let the TV control itself (ADB)

Opening apps works straight away. Keys, typing, "what's playing" and power off need the TV's
debugging switched on once. There are two ways. **On Android 13 and newer (most Google TVs), use
pairing (1).** Use port 5555 (2) on older TVs.

1. **Wireless debugging pairing** (Android 11 and newer, TV on Wi-Fi). The port is random and
   changes after every restart, so the app pairs with the TV once, then finds the port by itself
   and switches wireless debugging back on after a restart. With the TV remote:
   1. Settings, System, About (on Android TV 9 to 11: Settings, Device Preferences, About), press
      **Build** seven times (unlocks Developer options).
   2. Settings, System (or Device Preferences), **Developer options**, scroll to **Wireless debugging**, OK, switch it on.
      On "Allow wireless debugging on this network?" tick **Always allow on this network**, then
      **Allow**.
      **Careful:** in the Developer options list, **Revoke USB debugging authorizations** sits
      directly above Wireless debugging. Never press OK on it: it signs out every computer that
      uses ADB on the TV. Check what is highlighted before each OK.
   3. In Wireless debugging choose **Pair device with pairing code**. Leave that screen open.
   4. On the phone, open `http://<tv-ip>:5400/setup` and type the 6 digit code. The port is
      optional (the app finds it). The setup page shows "connected (wireless debugging)".

   **Wireless debugging needs Wi-Fi.** On Ethernet, Android refuses to turn it on; use 2, or put the
   TV on Wi-Fi.
2. **Network debugging on port 5555** (older Android TV, Fire TV, Nvidia Shield, and any TV where a
   computer has run `adb tcpip 5555`). Turn on network (or USB) debugging, open Couch TV, press
   **Connect ADB**, and on the TV tick **Always allow** and press **Allow**. **Some Android 13+
   Google TVs never show that question for a new key** (seen on one TV after its Google home screen
   had been switched off): the app gives up after 45 seconds and points you to pairing.

After the first connection the app gives itself two permissions over ADB, for itself only:
"draw over other apps" (so it can open apps from the background) and "write secure settings" (so
it can switch wireless debugging back on after a restart, the way Shizuku does).

## Install

1. **Download `couch-tv-ontv.apk` from the GitHub Releases page** (easiest), or build it from the
   repo root with `sh scripts/build-apk.sh` (JDK 21, the Android SDK and Node 20+, no Gradle
   needed; README, "Building the app"). It builds the phone remote first if `remote/dist` is
   missing, then copies the remote and the TV home page into the app, and leaves it at
   `dist/couch-tv-ontv.apk`.
2. Install from a computer once (developer options and debugging must be on). With network
   debugging on port 5555, the repo's own helper needs nothing else installed, and copies the app
   in small pieces (some TVs stall on a normal push):
   ```
   .venv/bin/python on-tv/scripts/real-tv.py --ip <tv-ip> install couch-tv-ontv.apk   # from the repo root, after README step 2
   ```
   If the TV only has **Wireless debugging** (many Android 13 and newer Google TVs), use Google's
   platform-tools once instead:
   ```
   adb pair <tv-ip>:<pairing port> <6 digit code>    # from "Pair device with pairing code"
   adb connect <tv-ip>:<port shown under Wireless debugging>
   adb install -r couch-tv-ontv.apk
   ```
   Or copy the APK to the TV with a file app and open it there.
3. On the TV, open **Couch TV**. It shows the address and a phone code.

## Pair a phone

1. On the phone, open the address the TV shows, for example `http://192.0.2.10:5400`.
2. Type the 6 digit code from the TV. (Tap "Show a code on the TV" if it has gone.)
3. That phone now has its own token, stored in the browser. Add the page to the home screen.

A code lasts 3 minutes, works once, and is thrown away after 5 wrong tries. **Forget phones** on
the TV, or on the setup page, signs every phone out.

## Use it as the home screen (optional)

Switch on **Use as home screen** in Couch TV. On a plain Android TV that is enough. On Google TV the
system launcher always wins the home button, so it also has to be switched off, from a computer:

```
adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx   # Chromecast with Google TV and most Google TVs
adb shell pm enable com.google.android.apps.tv.launcherx                  # undo
```

Check the package name on your TV first (`adb shell pm list packages | grep launcher`). Some Google
Home features stop working while it is off. The app never does this by itself.

The home's gear tile opens **Home settings** here too (language, weather place and units, look,
scenes, apps, people, quick buttons; README, "Settings on the TV"). They are kept in this app
(`/api/settings`, next to the setup page's own settings), and the people list is the same one the
setup page edits. One difference: this app has no file picker, so your own photos come from a web
address.

## Power on

The TV cannot wake itself: in standby the app is not running. Use the TV's own remote, HDMI-CEC
from another device, or Wake-on-LAN from anything that stays on (a phone shortcut, a router, a
Raspberry Pi running the computer bridge). On some TVs `POST /api/power {"state":"on"}` works for
a minute or so after "off", while the TV is still in light standby.

## Ask (optional, off by default)

On-TV mode has no Claude unless you add your own Anthropic API key on the setup page and switch
"ask" on. It uses Claude Haiku 5.5 with a few tools (play, open an app, press a key, what is on),
about a fifth of a US cent per ask at October 2026 prices. Make a key just for the TV and set a
monthly spend limit in the Anthropic Console: the key is stored on the TV, and anyone with ADB
access to the TV could read it. Without a key, "Ask for a show" answers that ask is off.

## Uninstall

```
adb uninstall dev.couchtv.ontv
```
or Settings, Apps, Couch TV, Uninstall. This removes the app, its tokens and its ADB key. If you
switched off Google's launcher, switch it back on first (see above). To also remove the app's
debugging key from the TV, use the revoke option for debugging keys in Developer options (it signs
out every computer, so reconnect yours afterwards).

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| Phone shows "Pair this phone" again | The token was cleared (new phone, private browsing, or Forget phones). Type a new code. |
| "Pressing keys needs ADB on the TV" | ADB is not connected. Open Couch TV and press Connect ADB, or pair wireless debugging on the setup page. |
| "Allow debugging?" never appears | Network debugging is off, or the TV suppresses the question (seen on an Android 14 Google TV). Use wireless debugging pairing instead. |
| Worked, then stopped after a restart | Port 5555 is often switched off by a restart. Pair wireless debugging once: the app then turns it back on and finds the new port after every restart. |
| Wireless debugging will not switch on | The TV is on Ethernet. Android only allows it on Wi-Fi. |
| The phone page does not load | Phone and TV must be on the same network. The address changes if the router gives the TV a new one; reserve it in the router. iPhone asks for Local Network access once. |
| Apps do not open from the phone | Android blocked an app start from the background. Connect ADB once: the app then has the permission it needs. |
| Home button still goes to Google's home | See "Use it as the home screen". |
| Server not answering after a TV update | Open Couch TV once; it also starts at boot. |

## How it works

- `BridgeService`: a foreground service that starts at boot and runs the HTTP and WebSocket
  server (NanoHTTPD) on port 5400.
- `Adb.kt`: ADB to 127.0.0.1 with libadb-android (plain TCP, TLS and pairing, mDNS discovery). The
  app's RSA key and certificate are made on first run and kept in its private storage.
- `Finder.kt` and `Apps.kt`: the computer bridge's JustWatch lookup, app table and deep-link rules.
- `web/shim.js`: added to the phone remote's page by the TV app. It pairs the phone and adds the
  token to every call, so the remote itself is unchanged and the same build works with both modes.
- `web/setup.html`: the phone setup page (ADB, wireless debugging pairing, names, weather, ask).
- Endpoints are those in `bridge/API.md`, plus `/api/pair`, `/api/pair/start`, `/api/adb`,
  `/api/adb/connect`, `/api/adb/pair`, `/api/settings`, `/api/phones/forget` and `/api/ws`.

## Tests

`scripts/emulator-test.mjs` drives an Android TV emulator end to end (pairing, 401s, loopback ADB
with the real "Allow debugging?" dialog, keys, launch, deep link, volume, power, the phone page at
390x664). It refuses to run against anything that is not an emulator.
