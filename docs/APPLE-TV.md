# couch-tv on an Apple TV (Beta)

**New, Beta.** Two parts: the phone remote (the bridge talks to the Apple TV) and **Couch TV**, couch-tv's home as an
Apple TV app. Both were built and checked against a stand-in Apple TV and a stand-in bridge on a computer. No real
Apple TV has run them yet, so expect something to need fixing. Please [open an issue](https://github.com/Seagey/couch-tv/issues)
and say how it went (the Apple TV model, tvOS version, what worked and what did not), even if all of it worked.

## What you get, in plain words

| | Apple TV |
|---|---|
| Phone remote: arrows, OK, Back, Play/Pause, Apple's Home, volume keys | Yes, with the bridge running (option B, a computer at home that stays on) |
| Sleep and wake from the phone | Yes |
| Opening an app from the phone (Netflix, YouTube, Disney+, Prime Video, Apple TV and the rest the Apple TV lists) | Yes. The app opens on its own home page: pick the show there, nothing presses Play for you |
| "Put on Bluey" (find and play) | Finds where it streams, opens that app. No deep link into the show |
| couch-tv's home screen on the TV | **New, Beta:** Couch TV, an app with the same scenes, glass clock, date and weather, people switch, Keep watching and dock as the other TVs. You put it on the Apple TV yourself with Xcode on a Mac ([below](#the-home-app-couch-tv)) |
| Opening couch-tv by itself when the Apple TV wakes | Yes, once Couch TV is installed and the bridge is running, like the Samsung and LG paths |
| Replacing or coming before Apple's own home screen | **No, and it cannot be done.** tvOS lets no app replace the home, and couch-tv never jailbreaks anything. Apple's Home button still opens Apple's home |
| Typing from the phone, screenshots, what is playing, a volume level | No (see "Limits") |
| More than one TV on one phone remote | Yes, like the Roku and the LG: one bridge, several entries in `config.json` |

The phone remote costs nothing and needs no Apple account. Couch TV is free with your own Apple ID, but Apple makes a
free signature run out after 7 days, so a Mac at home signs it again twice a week (a script does it).

## How it works

The bridge talks to the Apple TV over the network the way the iPhone's Control Centre remote does, using
Apple's Companion Link protocol. You pair once (the Apple TV shows a 4 digit PIN), then every connection
is checked and sealed with keys made on your computer. couch-tv makes its own keys: nothing of Apple's is
included, and the keys stay in `bridge/data/` (git ignores it, the file is private to your user). The
Apple TV lists couch-tv's computer under Settings, Remotes and Devices, and you can remove it there.

Written from public descriptions of the protocol (see the sources below). The best known open source
library for it is [pyatv](https://pyatv.dev/); couch-tv's code is its own and was not copied from it.

## Set it up

Needs the bridge running on a computer that stays on (README, option B), on the same network as the Apple TV.

1. Wake the Apple TV. Run `.venv/bin/python scripts/appletv-check.py` (it only listens) to find it and its
   address and port. The port is announced on the network and can change after a restart.
2. Add it to `config.json`:

   ```json
   { "id": "lounge-appletv", "name": "Lounge Apple TV", "kind": "appletv", "ip": "<its address>", "port": 49153 }
   ```
3. Pair once: `.venv/bin/python scripts/appletv-check.py <address> --port <port> --pair` and type the PIN the
   Apple TV shows. Or, with the bridge running, `POST /api/appletv/pair` with `{}`, then with `{"pin": "1234"}`.
4. Start the bridge. The phone remote now shows the Apple TV.

Give the Apple TV a fixed address in your router so it never moves.

## The home app: Couch TV

tvOS has no web view, so the web page every other TV shows cannot run on an Apple TV. Couch TV (`tvos/`) draws the
same home again as a native SwiftUI app for tvOS 17 and newer:

- The five scenes (the same pictures as the other TVs, from `tv-home/web/backgrounds`) taking turns, each with its
  glass clock: the frosted photo seen through the digits, the scenery cut out in front of them, and the reflection
  on the water scene.
- The date and the weather, the people switch, the sleep timer, Keep watching, and the dock with your apps, then
  Settings and More apps. The Siri remote moves between them with tvOS's own focus, like any Apple TV app.
- Picking an app asks the bridge to open it, because a tvOS app cannot open another app by its id. YouTube, Netflix
  and Spotify also open straight from Couch TV with their public addresses, even with the bridge away.
- Picking a Keep watching card asks the bridge to open the show's app (on its own page, as with the phone remote).
- Home settings from the phone (12 or 24 hour clock, which scenes and how long, Keep watching on or off, the order of
  the apps) apply here too.
- Without the bridge (the computer is off, or it was never set up) the clock, the date and the scenes still work, and
  the apps last seen stay in the dock.

![Couch TV on an Apple TV: the night scene, Keep watching and the dock, Netflix focused](screens/appletv-home.jpg)

![Couch TV's Settings: the bridge, the code, the clock](screens/appletv-settings.jpg)

(Drawn on a Mac from Couch TV's own SwiftUI code against the stand-in bridge, with `tvos/preview/render.sh`. On an
Apple TV the glass panels also blur what is behind them.)

What it cannot do:

- **Apple's Home button still opens Apple's home.** Couch TV is an app: the bridge opens it when the Apple TV wakes
  and when you press Home on the phone remote. Put it in the top row of Apple's home so it is one click away.
- No live TV inputs, no screenshots, no "what is playing", and apps open on their own page, not inside a show.
- With a free Apple ID it stops opening 7 days after it was last signed (below). The phone remote is not affected.

### Install it free with your own Apple ID (the main way)

You need a Mac with Xcode (free from the App Store), an Apple ID, and the Apple TV on the same network. The Mac that
runs the bridge is the best one for this, because it also signs Couch TV again every few days.

1. **Open Xcode once** and let it install its components (it asks for the Mac's password). Without this, Xcode's
   command line tools wait for that password and nothing else works.
2. **Sign in:** Xcode, Settings, Accounts, add your Apple ID. A free one shows as "(Personal Team)". Note the team's id
   (ten letters and numbers).
3. **Pair the Apple TV with Xcode:** on the Apple TV, Settings, Remotes and Devices, Remote App and Devices. On the Mac,
   Xcode, Window, Devices and Simulators: the Apple TV shows up, press Pair and type the code the Apple TV shows. If
   the Apple TV or Xcode asks to turn on Developer Mode, say yes.
4. **Your signing settings:** copy `tvos/Config/Signing.example.xcconfig` to `tvos/Config/Signing.mine.xcconfig` and
   put in your team id, and a bundle id that starts with `dev.couchtv.appletv.` and ends with something of your own
   (`dev.couchtv.appletv.smith`), because Apple lets one bundle id belong to one person. Git ignores this file, so
   your team id never goes into the repo.
5. **Build and install:** `scripts/appletv-resign.sh` (or `scripts/appletv-resign.sh "Lounge"` when Xcode knows more
   than one Apple TV). It builds Couch TV, signs it with your Apple ID, installs it on the Apple TV and opens it. The
   first time, if the Apple TV says the developer is not trusted, trust your Apple ID once in the Apple TV's Settings
   (under General; the menu's name changes between tvOS versions).
6. **Connect it to the bridge:** Couch TV looks for the bridge on the network by itself. A bridge without a pairing key
   connects straight away. With a key, open Settings in Couch TV (the gear in the dock), run
   `.venv/bin/python scripts/appletv-home-code.py` on the bridge computer and type the six digit code it prints (it
   works once, for ten minutes; the key itself is never shown). You can also type the bridge's address (for example
   `192.0.2.20:5400`) and the key there. The address and key are kept in the Apple TV's keychain.
7. **Make it open by itself:** nothing to set. The bridge finds Couch TV on the Apple TV by its bundle id and opens it
   whenever the Apple TV wakes. (`app_id` in `config.json` still works if you used a bundle id of your own that does
   not start with `dev.couchtv.appletv`.)

### Keep it signed (every few days)

A free signature lasts 7 days. Run `scripts/appletv-resign.sh` from launchd on the Mac that stays on, twice a week, so
there is always a fresh one. Save this as `~/Library/LaunchAgents/app.couchtv.appletv-resign.plist`, with the path to
your couch-tv folder in it, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.couchtv.appletv-resign.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.couchtv.appletv-resign</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>/path/to/couch-tv/scripts/appletv-resign.sh</string></array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  </array>
</dict>
</plist>
```

Each run writes one line to `build/appletv-resign.log` saying it worked or why it stopped (the Apple TV was off, Xcode
was signed out). If a run is missed, the next one fixes it, as long as it comes within the 7 days. If the Mac is off
for longer, Couch TV stops opening until the script runs again; nothing else changes. Remove the job with
`launchctl bootout gui/$(id -u)/app.couchtv.appletv-resign`.

Apple limits free Apple IDs: reports say up to 10 new bundle ids a week and three apps signed at once. Signing the
same Couch TV again does not use up new ones.

### Or once, with the paid Apple Developer Program

With the Apple Developer Program (US$99 a year) the signature lasts a year instead of 7 days, so the twice weekly job
is not needed: put the paid team's id in `Signing.mine.xcconfig` and run `scripts/appletv-resign.sh` once a year.
It also allows TestFlight, the only way to hand Couch TV to someone without their own Mac. It is not needed for
anything else in couch-tv.

### Trying it without an Apple TV (for developers)

- `tests/appletv_home_standin.py` runs the real bridge with a stand-in Apple TV, two people, Keep watching and the
  weather, and prints a code. Build and run Couch TV in the tvOS Simulator (Xcode, the CouchTV scheme, an Apple TV
  simulator), open Settings and type `127.0.0.1:5455` and the code. Every app it opens is printed.
- `tvos/preview/render.sh 127.0.0.1:5455 <code>` draws Couch TV's screens to PNG files on the Mac from the same
  SwiftUI code against that bridge, without the Simulator (no focus engine and no blur there).
- `tvos/make-project.py` writes the Xcode project and `tvos/make-assets.py` the fonts and icons. Run them after adding
  a Swift file or changing the look.

## Limits, plainly

- **No home screen replacement.** Apple's home stays first. Couch TV opens when the Apple TV wakes (with the bridge
  running) and from Home on the phone remote.
- **Typing from the phone is not supported yet.** Use the on screen keyboard with the arrows.
- **No "what is playing", no volume level, no screenshots.** The Companion link does not give them. (Apple's other
  protocols do carry now playing and volume. That is not built here.) The volume keys send the remote's
  volume buttons, which only change the TV's volume when the Apple TV is set up to control it (HDMI-CEC or learned IR).
- **No deep links** into a show. The app opens on its home.
- **Sleep and wake:** an Apple TV in sleep keeps listening, so wake works. If one has been fully unplugged,
  there is no way to wake it from the network.
- **Parental and HomeKit settings** can limit which devices may control the Apple TV (Settings, AirPlay and
  HomeKit, Allow access). "Anyone on the same network" is the setting that works with this.
- **A free signature runs out after 7 days** (above). The always on Mac renews it; without that, Couch TV stops
  opening until it is signed again.

## Test status

See [APPLE-TV-TESTING.md](APPLE-TV-TESTING.md) for what was checked and the steps for the first real test.

## Sources

- Apple TV protocol notes (Companion Link, pairing, keys, power, app launch): <https://pyatv.dev/documentation/protocols/>, supported features: <https://pyatv.dev/documentation/supported_features/>
- tvOS has no web view: <https://medium.com/bpxl-craft/apple-tv-a-world-without-webkit-5c428a64a6dd>. TVML deprecated in tvOS 18: <https://developer.apple.com/documentation/tvml.md>
- Free Apple ID signing lasts 7 days, paid account 12 months: <https://9to5mac.com/2016/03/27/how-to-create-free-apple-developer-account-sideload-apps/> and the tutorials around it. The limits on a free ID (bundle ids a week, apps at once) are from third party reports and not confirmed by Apple.
- Installing from the command line: `xcrun devicectl device install app` (Xcode 15 and newer, `xcrun devicectl help`).
