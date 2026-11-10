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
| Keep watching | yes | partial, with ADB | Built on this TV: shows started from the phone, and shows an app says it is playing for a minute or more. No imported history, no progress bar. See "Keep watching and people". |
| Sleep timer | yes | yes, with ADB | Pause, then off. |
| Screenshot (`/api/screenshot`) | yes | yes, with ADB | |
| Picks and taste profile | yes | no | Needs "ask". |
| Ask Claude | yes (computer's Claude Code) | **off by default** | Optional: your own Anthropic API key on the setup page. See below. |
| Picture mode, screens, Moonlight | yes | no | |
| Home screen (TV home page) | yes | yes, optional | Same page, served from the app. Replacing Google's home needs one ADB command, see below. |
| Live updates (`/api/events`) | yes | yes | Server-sent events, plus a WebSocket at `/api/ws`. |

## Which TVs

- **Yes:** Android TV and Google TV (Chromecast with Google TV, Google TV Streamer, Sony, TCL,
  Hisense, Philips and other Google TV sets), Nvidia Shield, and Fire TV on Fire OS. Android 7.1 or newer.
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
system launcher still wins the Home button, and **do not switch it off**: on some Google TVs (a
Sony Bravia among them) the TV then loops at every restart
([README](../README.md#if-your-tv-loops-after-a-restart)). Open Couch TV from the app row instead,
or use option A's `apply.sh`, which takes the Home button with a watch and leaves the Google home on.
If an older guide had you switch it off, switch it back on before the next restart:

```
adb shell pm enable com.google.android.apps.tv.launcherx
adb shell pm enable com.google.android.tungsten.setupwraith
```

The app never switches anything off by itself.

### Fire TV (Fire OS)

Step by step on a Fire TV Stick, with the things that will save you time: [docs/FIRE-TV-STICK.md](../docs/FIRE-TV-STICK.md).

Works on Fire TV sticks, Cubes and TVs that run **Fire OS** (6 on Android 7.1, 7 on Android 9, 8 on
Android 11). Fire OS 6 (Fire TV Stick 4K 1st gen and older sticks) needs a release newer than 0.3,
and network debugging on port 5555, because wireless pairing starts at Android 11. It does
**not** work on the newer sticks that run **Vega OS**, which cannot sideload apps at all.

Amazon's launcher cannot be switched off, and the Home key starts it by name, so no setting can
hand the Home key to another app. Instead, with **Use as home screen** on, Couch TV notices
Amazon's home coming on screen and puts its own home back on top. It does nothing on any other
kind of TV. Two things to know:

- **Amazon's home still flashes up for a moment** before Couch TV's comes back. Without root,
  that is as good as Fire OS allows.
- It needs three one-off grants, over ADB from a computer (they survive reboots, so the computer is
  only needed once):

```
adb shell pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS
adb shell appops set dev.couchtv.ontv SYSTEM_ALERT_WINDOW allow
adb shell appops set dev.couchtv.ontv GET_USAGE_STATS allow
```

The first lets the app switch on its own small accessibility watcher (it sees which window came
forward and reads nothing else) and switch it back on if an update turns it off. The second lets
the app come forward from the background. The third is for Fire OS 6, which runs Amazon's own
accessibility manager and never connects the watcher (the setting reads as on, but nothing is
listening): with usage access the app polls the system's usage events instead, and Home comes back
to Couch TV within a second or two. Where the watcher does connect, the third grant is not used, so
it is safe to give on every Fire TV. If you would rather not use an accessibility service at all,
give the third and skip the first. Where a Fire OS build still lets the TV use its own ADB, the
activity log is followed as a last option.

On a Fire TV the quick buttons also gain **Input** (the TV's own HDMI picker).

**Current Fire OS (6.7.1.1, 7.6.6.9, 8.1.0.3 and newer) blocks apps on the TV from using the
TV's own ADB** (Amazon's fix for CVE-2024-27350, 2024, which it backported to Fire OS 6). So on an up
to date Fire TV, **Connect ADB** cannot work, and the setup screen says so. The phone remote's keys, typing, power off and "what's
playing" do not work there; opening apps, playing a show by name, volume on the TV's own speaker
and the sleep timer still do. ADB from another computer is not blocked, so for the full phone
remote on a Fire TV use option B (the bridge), or Amazon's own Fire TV phone app for the keys.
Reported in [issue #12](https://github.com/Seagey/couch-tv/issues/12) (Fire TV Stick, Fire OS 7.7.1.7)
and [issue #50](https://github.com/Seagey/couch-tv/issues/50) (an Insignia Fire TV Edition on Fire OS 6.7.1.1,
where Option C works as a home screen with the usage access grant).

Confirmed on a **Fire TV Stick 4K (2nd gen, Fire OS 8.1, Android 11)** by
[killy10o10](https://github.com/Seagey/couch-tv/issues/3), who also wrote a step-by-step setup guide:
[FIRE-TV-STICK.md](https://github.com/killy10o10/couch-tv/blob/main/docs/FIRE-TV-STICK.md). Two tips
from that report:

- **After updating the app with `adb install -r`, restart the stick** if Home lands on Amazon's
  home. Fire OS can leave the watcher switched on but not connected until a restart.
- **Only one launcher can do this at a time.** If another launcher (Projectivy, for example) also
  has its Home override on, the two fight. Turn the other one's override off.

Ported from the Fire TV work in [dlandman27's fork](https://github.com/dlandman27/couch-tv). Thanks
to them.

The home's gear tile opens **Home settings** here too (language, weather place and units, look,
scenes, glass panels, a video background, apps, people, quick buttons; README, "Settings on the TV"). They are kept in this app
(`/api/settings`, next to the setup page's own settings), and the people list is the same one the
setup page edits. One difference: this app has no file picker, so your own photos come from a web
address.

## Keep watching and people

**Keep watching** fills itself on the TV. A show lands there when:

- it was started from the phone (search, Ask, or a Keep watching tile), or
- an app says it is playing it for a minute or more, however it was started (the TV remote, the
  phone's arrow keys, the app's own menus). The same title has to play for the whole minute, and
  the app's own position has to pass a minute too, so a preview that autoplays on an app's browse
  screen never counts. This needs ADB connected, because the TV reads it from Android's media
  sessions, the same reading as "What is playing". Netflix, Disney+, Prime Video and most others
  say what is playing. Some say nothing (Netflix on some boxes) or only their own name ("PrimeVideo"
  while a film plays, seen on a Sony): that is never kept as a show by itself. Instead the app reads
  that app's row in Android's "Continue watching" (Watch Next), which Netflix and Prime keep up to
  date, usually as you leave the show, and names the play from it, for the person picked when it
  played. The app gives itself the permission to read those rows over its own ADB when it
  connects. An app that says nothing and keeps no such row still cannot land there.

Each card opens exactly the show it shows. One card per show (the latest episode), newest first,
**up to 10**: the row slides along as you move right. A show drops off after **30 days** with no
watching. The finder looks in the country on the setup page for the show's picture; left empty,
that is the TV's own region when the TV is not in English (a German TV in Germany looks in DE),
else AU. A title it cannot match exactly still goes in, with no picture, rather than another show's.
YouTube videos, music and Twitch stay out. There is no progress bar and no imported history; those
need the computer bridge (option B).

**People** (the names at the top left, set on the setup page or in Home settings) decide whose
Keep watching row the home shows. In on-TV mode, switching person:

- shows that person's Keep watching row, and only theirs: what they watched on this TV;
- tags what starts playing next as theirs, from the TV and from the phone (the phone remote follows
  the TV's choice, and the other way round). The TV remembers who it is on, also after a restart;
- tells Ask who is watching, if Ask is on.

It does not pick your profile inside Netflix or the other apps, and there are no picks per person;
both need the computer bridge (`app_profiles` in [docs/CONFIG.md](../docs/CONFIG.md)). With one
person or none, there is no switcher and Keep watching shows everything watched on this TV.

From 0.9 the row starts fresh: what was watched before then is not shown, because it does not say
who watched it. It fills again as you watch.

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
| The phone page does not load | Phone and TV must be on the same network. The address changes if the router gives the TV a new one; reserve it in the router. iPhone asks for Local Network access once. On an Android 17 phone, Chrome showing `ERR_TOO_MANY_RETRIES` means Chrome needs Settings, Apps, Chrome, Permissions, Nearby devices, Allow. |
| Apps do not open from the phone | Android blocked an app start from the background. Connect ADB once: the app then has the permission it needs. |
| Home button still goes to Google's home | See "Use it as the home screen". |
| Server not answering after a TV update | Open Couch TV once; it also starts at boot. |
| Keep watching stays empty | Connect ADB (the TV reads what is playing through it), then watch a show for a minute. Apps that do not say what is playing, YouTube and music never land there. See "Keep watching and people". |
| App icons look soft on a big TV | Update the app: icons are now drawn at 256 px from the sharpest icon each app ships. Older versions drew them at the TV's own density, often 96 px. |

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
