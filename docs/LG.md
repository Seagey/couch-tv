# couch-tv on an LG TV

LG TVs run webOS, not Android, and LG does not let any app replace its home screen. So couch-tv on
an LG is **an app that opens itself, not a true home screen**, the same as on a
[Samsung](SAMSUNG.md):

- **The couch-tv app** (`lg/`): the same TV home as on Google TV (scenes, clock, weather, your
  apps in your order, Keep watching), packed as an LG app. Its tiles open the LG versions of
  Netflix, YouTube and the rest. It goes on the TV through LG's Developer Mode, with LG's free
  tools.
- **The hook** (`bridge/lg.py`): the bridge (option B, a computer that stays on) watches the TV.
  Each time the TV is switched on and nothing else is on screen, it opens couch-tv within a few
  seconds. So the TV "looks for" couch-tv every time it comes on.
- **Keeping it installed:** LG removes Developer Mode apps when the Developer Mode session runs
  out. The bridge presses Developer Mode's **Extend** for you once a day while the TV is on.
- **The phone remote and the Claude ask** work against the LG through the same bridge.

It needs a computer at home that stays on (option B). Without one you can still install the app
and open it from LG's app row, but nothing opens it for you, and nothing extends Developer Mode,
so the app is removed when the session runs out.

## Test status: seven real LGs so far

**First real LG, 2 November 2026** ([issue #8](https://github.com/Seagey/couch-tv/issues/8)): an
LG UHD TV on webOS 5.6.2 (2020/2021 firmware), Developer Mode with the Homebrew Channel, the bridge
on a Mac. The app built with `lg/build.py` installed and opened, the TV asked to accept the remote
straight away, and the weather, clock, dock, a custom dock tile and a translation all worked. It found
three things, all fixed now: the packer (step 3), the app row before the remote is accepted
(Limits), and soft backgrounds on a 4K panel (a 4K screen now gets 3840x2160 copies of the built-in
scenes and photos).

**Second real LG, 7 November 2026** ([issue #28](https://github.com/Seagey/couch-tv/issues/28)): an
LG OLED55C1 (2021) on webOS 6.5.3, set up from Windows 11 with no bridge, the app opened from LG's
app row. The Python packer built an .ipk that installed first time; the clock, the five scenes, the
weather, Spanish from the TV's language, accepting the remote and opening apps from the dock all
worked. The dock was empty: webOS 6.5.3 also refuses the app list to a Developer Mode app, and with
no bridge there is nothing else to read it from. It also gave three more app ids (Apple TV, HBO Max,
Spotify, now in `bridge/apps.py`) and these, which show by their own names: Jellyfin
`org.jellyfin.webos`, DGO `com.directvgo.webostv-rt`, Win Play `com.toolboxott.winplay`, Claro Video
`clarovideo.dla.1`.

**Third real LG, 9 November 2026** ([issue #45](https://github.com/Seagey/couch-tv/issues/45)): an
LG OLED65C4 (2024) on webOS 24, in Italy, with the bridge on an Intel Mac mini. Claude Code did the
whole setup from the repo link; the person only did the steps that need hands on the TV. The `.ipk`
installed first time, the remote was accepted, and power and the app on screen read fine.

**Fourth real LG, 9 November 2026** ([issue #46](https://github.com/Seagey/couch-tv/issues/46)): an
LG on webOS 4.10.2 (2018/2019 firmware), with the bridge on a Windows 11 laptop. The clock, weather,
scenes, the profile switch, the dock and the phone remote (off and on too) worked, with the
reporter's own layout fallbacks for the older browser, which are not in couch-tv yet (see Limits).

**Fifth real LG, 9 November 2026** ([issue #56](https://github.com/Seagey/couch-tv/issues/56),
reported by ChrisFWCB): an LG OLED77GXPUA (2020, US) on webOS 5.6.2, firmware 04.64.00, wired
Ethernet, set up from Windows 11, with the bridge running in Docker on a Synology DS1019+ (DSM 7.2).
`check-tv.py` recognised it, the `.ipk` built with `--apps` installed first time, and the clock,
scenes, weather, people switch, opening apps from the dock, the power-on hook (3 out of 3), the daily
Extend and phone power off and on (Wake-on-LAN, about 5 s) all worked. It found four things: Plex
hidden behind More apps, no icons for apps without a bundled logo (see "Icons for apps with no bundled
logo" below), no way to default to Fahrenheit from `config.json` (`home.wx_unit` now does), and a 500
from the phone's power button while the TV was still starting (fixed). It also gave the app ids for
Plex (`cdp-30`), YouTube TV (`youtube.leanback.ytv.v1`) and Peacock (`com.peacock.tv`), now in
`bridge/apps.py`; Pluto TV `com.plutotv.app`, Tubi `com.tubitv.ott.tubi`, LG Channels `lgchannels.us`
and IMDb TV (Freevee) `imdbtv` show by their own names.

**The same OLED65C4 after the webOS 26 upgrade, 10 November 2026**
([issue #61](https://github.com/Seagey/couch-tv/issues/61)): LG's Re:New offered webOS 26 in Italy
(firmware 43.21.96, a 1.7 GB background download). Developer Mode, its key and passphrase, the
couch-tv app, the saved remote key (no new Allow prompt), the pointer socket, screenshots and the
power state all survived. The app ids couch-tv relies on (`com.webos.app.home`, `livetv`, the HDMI
inputs) did not change. Power on from the phone still works through Wake-on-LAN. One change: backing
out of Disney+ now passes through an empty screen for about 2 seconds before LG's home, so the hook
could miss it and leave you on LG's home. `back_to_couch` now treats an app going to an empty screen,
then LG's home within 6 seconds, as that app closing.

If you take the webOS 26 upgrade:

- Stop the bridge first, and start it again when the TV has finished. Otherwise, when the TV restarts
  in the middle of the update, the hook opens couch-tv over LG's setup screens.
- Afterwards, Netflix and Prime Video open the LG Content Store until you update them there.

**Sixth real LG, 10 November 2026** ([issue #71](https://github.com/Seagey/couch-tv/issues/71),
reported by wojowar): an LG 65QNED80 (2025) on webOS 10.3.2, with the bridge on a Mac mini that stays
on, a cable box on HDMI 2 and an Apple TV on HDMI 3, set up by Claude Code following AGENTS.md. The
newest model and firmware so far. It worked as documented: Developer Mode, LG's ares tools (kept in
`build/ares`, not installed globally), `lg/build.py`, `ares-install` and `ares-launch`, pairing and the
remote over the encrypted port, couch-tv opening when the TV comes on, Netflix opening the show,
YouTube opening the video, the phone remote, the Netflix history import, and Developer Mode's Extend
with `ares-launch`. What differs on webOS 10.3.2:

- **Port 3000 always resets** (connection reset straight away). Only `wss` on 3001 works. The bridge
  coped by trying 3001 next, but tried 3000 first after every restart. It now remembers, per TV, the
  port that worked (`data/lg-<id>-port.json`) and goes straight to it. Older webOS, where 3000 works,
  still tries 3000 first.
- **No new remote connection while the TV is in standby** (Quick Start+ on): a new connection is
  answered and closed straight away (code 1008). A connection opened while the TV was on stays up in
  standby. So after a bridge restart with the TV off, the bridge sees nothing until the TV is switched on.
- **A slow start from deep standby.** After a long standby the TV dropped off the network, and on
  power on its remote port answered 15 to 22 seconds after the TV was back on the network.
- **Developer Mode's own app takes about 5 seconds to appear after Extend.** The old fixed 2 second
  wait put couch-tv back too early, so Developer Mode then covered it. The bridge now waits up to 20
  seconds for it to appear before putting couch-tv back.
- **LG's clock screensaver** shows over couch-tv after about 3 minutes idle. Not fixed yet.
- **A cable box with SimpLink (CEC) Auto Power Sync on** switches the TV to its own input about 2
  seconds after power on, while couch-tv is still loading (about 8 seconds). Not fixed yet.
- **Disney+ and Prime Video** have no history the bridge can see or import on LG.

Setup snags, nothing to do with webOS 10:

- **launchd on an external drive.** launchd refused a plist kept on an external drive with ownership
  ignored ("Bootstrap failed: 5"). The plist had to live in `/Library/LaunchAgents`.
- **Google Takeout for YouTube history** failed on Google's side ("Service failed to retrieve this
  item") and the zip held only `archive_browser.html`. The history was taken from My Activity instead,
  and the importer read that JSON fine.
- **Canadian Netflix exports** write dates month first (3/25/24). The importer now reads the whole file
  and uses month first when a date proves it (a second number over 12), and day first otherwise.

**Seventh real LG, 10 November 2026** ([PR #77](https://github.com/Seagey/couch-tv/pull/77), by Akdex): an LG 43SQ700S-WB (a 2022 MyView smart monitor, 4K) on webOS
22, firmware 03.07.00, in India, with the bridge in Docker on a Raspberry Pi 5 (Debian 13, arm64,
`network_mode: host`, `@webos-tools/cli` in the image for the daily Extend). `find-tvs.py` listed it as
"[LG] webOS Monitor SQ700S" and `check-tv.py` read webOS 7.0.0 on 3000 and 3001. The `.ipk` from
`lg/build.py` installed first time, the remote was accepted, the daily Extend over `ares-launch`
worked, and the Developer Mode countdown read 987 hours. It found two things:

- **No icons for apps without a bundled logo** (Stremio, JioHotstar, ZEE5, SonyLIV, Amazon Alexa, LG
  Gaming Portal): the same as #56. Fetching each launch point's `largeIcon` from the TV with
  certificate checks off gave 130x130 PNGs for all six, which is what `lg/build.py` now does by itself.
- **Slow on a weak chip with a 4K panel.** The home asked for the 3840x2160 copies of every photo, and
  the full-screen blur behind Home settings froze it when Home settings opened. `home.hi_res: false` keeps
  the 1080 copies (and the `.ipk` drops from 22 MB to under 6 MB). With every blur and the large soft
  shadows taken out (a local patch much like `home.lighter`, which takes out the same blur), each key
  press on the home was on screen in 6 to 47 ms.

App ids from this TV, all shown by their own names: Stremio `io.strem.tv`, JioHotstar `hotstar`, ZEE5
`com.zee5.app`, SonyLIV `com.sonyliv2.tvapp`, Amazon Alexa `amazon.alexa.view`, LG Gaming Portal
`com.twin.app.gamingportal`, Apple TV `com.apple.appletv`, Prime Video `amazon`, YouTube
`youtube.leanback.v4`.

Everything else was built from LG's documentation and the open source libraries that talk to LG
TVs, and tested against a stand-in TV on a computer. If you run it on another LG, thank you: please
[open an issue](https://github.com/Seagey/couch-tv/issues) and say how it went (TV model and year,
webOS version, what worked, what did not), even if everything worked.

What was checked, in November 2026:

- **Against a stand-in LG** (a small program that answers like LG's network remote): the first
  connection shows the prompt and the client key is kept; later connections use it without a
  prompt; a No on the TV and nobody answering are both reported plainly; the newer encrypted port
  (3001) is used when the plain one (3000) is closed. Power state, the app on screen, the app list
  (with apps found by their names), volume and mute are read. Arrows, OK, Back and the other
  buttons go over LG's pointer socket. Opening apps, a Netflix title, a YouTube video, typing,
  volume, mute and power off and on from the phone all reach the stand-in as LG documents them.
  The hook opens couch-tv when the TV comes on into live TV or LG's home, and leaves it alone when
  it comes on in an app. The daily Extend runs once a day (with a stand-in for LG's `ares-launch`),
  is not repeated the same day, and a TV left on all day gets it while couch-tv or live TV is in
  front, with what was on screen put back.
- **The whole bridge** ran with an LG, a Samsung and a Google TV in one `config.json`, each with
  its own driver.
- **The app** was built both with LG's `ares-package` and by `lg/build.py` itself, and LG's
  `ares-package --check` and `--info` read both. In a browser, with webOS's own calls stood in, it
  starts, lists the TV's apps with their logos, moves with the arrows, opens the focused app with
  OK and takes LG's Back key.

Not checked on a real LG yet: the prompt's exact wording, which app ids your TV uses, how long
the Developer Mode session really lasts, whether the Extend over the network remote (without the
ares tools) does anything, and Wake-on-LAN.

## What works and what does not

| | LG |
|---|---|
| couch-tv home as an app, apps in your order, the remote's arrows, OK and Back | Yes (built, not yet seen on a real LG) |
| Opens by itself when the TV is switched on | Yes, with the bridge running |
| LG's own Home button | Still opens LG's menu. Press Back or open couch-tv from the app row |
| Phone remote: keys, volume, mute, open an app | Yes (the TV asks to accept the remote once) |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs, Samsungs and LGs together (several entries in `config.json`) |
| "Put on Bluey" (find and play) | Netflix opens the title, YouTube opens the video. Other apps open on their home page and the reply says to pick the show there. Nothing presses Play for you yet |
| "Who's watching?" in an app | You pick the profile on the TV |
| Typing into the TV from the phone | Only while the TV shows its own keyboard |
| Turning the TV on from the phone | From Quick Start+ standby, yes. From fully off, only if the TV allows Wake-on-LAN (see "Turning it on") |
| What is playing, a progress bar, screenshots, the Claude ask's "look at the screen" | No. LG gives none of these to the network remote |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools, re-disabling the stock home | No (Android only) |

## Before you start

- The bridge running on a computer that stays on (README, option B).
- **Node.js** and LG's command line tools: `npm install -g @webos-tools/cli` (gives `ares-package`,
  `ares-install`, `ares-launch` and `ares-setup-device`). The bridge uses `ares-launch` for the
  daily Extend, so install them on the bridge computer. **webOS Dev Manager**
  ([webosbrew/dev-manager-desktop](https://github.com/webosbrew/dev-manager-desktop)), a desktop
  app for macOS, Windows and Linux, can do the install instead, but the daily Extend still wants
  `ares-launch`.
- An **LG developer account**, made on [LG's developer site](https://webostv.developer.lge.com/).
  You sign in to it once, on the TV, in the Developer Mode app. couch-tv never sees it.

## Set it up

### 1. Developer Mode on the TV

1. On the TV, open the **LG Content Store** (or Apps) and install **Developer Mode**.
2. Open it and sign in with the LG developer account.
3. Switch **Dev Mode Status** on. The TV restarts.
4. Open Developer Mode again and switch **Key Server** on. Note the **passphrase** it shows (6
   characters) and the TV's address.

LG's guide: [Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

### 2. Tell LG's tools about the TV (on the bridge computer)

```sh
ares-setup-device -a lounge -i "username=prisoner" -i "host=<tv address>" -i "port=9922"
ares-novacom --device lounge --getkey        # asks for the passphrase from step 1
```

Use the same name as the TV's `id` in `config.json` (here `lounge`), or set `ares_device` there.
Check it with `ares-launch --device lounge com.palmdts.devmode`: the Developer Mode app opens on
the TV.

**An AI agent cannot type the passphrase** into `--getkey`'s prompt. Piping it in fetches the key but
the passphrase is not stored, and ssh then fails ("All configured authentication methods failed",
[#45](https://github.com/Seagey/couch-tv/issues/45)). Give it all at once instead:

```sh
ares-setup-device -m lounge -i "privatekey=lounge_webos" -i "passphrase=XXXXXX"
```

**Windows:** the Python is `.venv\Scripts\python.exe` wherever this page says `.venv/bin/python`.
After `--getkey` the key at `%USERPROFILE%\.ssh\lounge_webos` can be left encrypted, and
`ares-install` then fails with "Encrypted OpenSSH private key detected, but no passphrase given"
([#40](https://github.com/Seagey/couch-tv/issues/40)). Either use the `ares-setup-device -m` line
above, or take the passphrase off the key and point the tools at it:

```
ssh-keygen -p -P <passphrase> -N "" -f %USERPROFILE%\.ssh\lounge_webos
ares-setup-device -m lounge -i "privatekey=lounge_webos"
```

### 3. Build the app

```sh
.venv/bin/python lg/build.py --bridge http://<bridge computer's address>:5400
```

Use the computer's number address (for example `http://192.0.2.20:5400`), not its `.local` name.
With more than one TV in `config.json`, add `--tv <id>` for this TV. This makes
`build/lg/app.couchtv.home_1.0.0_all.ipk`. It holds the TV home, the LG app ids, and a copy of
your settings for when the computer is off. No passwords or keys go in it.

`lg/build.py` packs the `.ipk` itself. Do not switch to LG's `ares-package` (`--packer ares`)
unless you have a reason: on the first real LG (webOS 5.6.2) the TV refused the ares-package build
with `com.webos.appInstallService failure: ipk verified failed`, and installed the one
`lg/build.py` made.

**No bridge (the app-only path)?** webOS 6.5.3 and 5.6.2 refuse the TV's app list to the app, so the
dock would be empty. Build with the list baked in instead
([#40](https://github.com/Seagey/couch-tv/issues/40), [#28](https://github.com/Seagey/couch-tv/issues/28)):

```sh
.venv/bin/python lg/build.py --apps my-tv-apps.json
```

`my-tv-apps.json` is a list of `{"id": "netflix", "title": "Netflix", "icon": ""}`: the apps on your
TV (`ares-install --device lounge --list` gives the ids). If the TV has accepted the remote before
(the bridge was run once with this TV and you pressed Accept), `--apps tv` reads the list from the TV
itself over LG's network remote instead. The app seeds its dock from the list once per build, so a
later reorder on the TV is kept, and the list goes stale when you install or remove an app: build
again. The package also carries the app logos from `remote/src/app-logos`, because the icon
addresses the TV gives are a 404 on several TVs; an app with no logo there shows its first letter.
The app-only build also sets `handlesRelaunch` so reopening it does not flash black.

**Finding app ids.** `ares-install --device lounge --list` only lists Developer Mode apps, not the
store apps, so it cannot find ids on every TV (ChrisFWCB, [#56](https://github.com/Seagey/couch-tv/issues/56)).
LG's `listLaunchPoints` over the network remote gives every app and its id, once the TV has accepted the
remote (step 6). `--apps tv` uses it.

**Icons for apps with no bundled logo.** Some TVs give icon addresses like
`https://<tv>:3001/resources/<hash>/Plex_80x80.png`. That is the TV's self-signed secure port, so the
page cannot load them and the tile shows a letter instead. A workaround that worked on an LG OLED77GX
(ChrisFWCB, #56): from the computer, with certificate checks off, ask the TV for its launch points
over `listLaunchPoints`, fetch each one's `largeIcon`, and save it as
`remote/src/app-logos/<package>.png` before running `lg/build.py`. `lg/build.py --apps` now does
this by itself: for each app in the list with no bundled logo, it downloads the icon address the TV
gave, with certificate checks off, into the package (not into `remote/src/app-logos`). An icon it
cannot fetch is listed when the build ends, and that tile shows its letter as before.

### 4. Install it

```sh
ares-install --device lounge build/lg/app.couchtv.home_1.0.0_all.ipk
```

Or open the `.ipk` in webOS Dev Manager. The app appears on the TV's app row as **Couch TV**.

### 5. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "lg"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "lg", "ip": "<tv address>", "mac": "<tv mac>" }
```

`mac` is the TV's network (MAC) address, for turning it on from the phone: Settings, General (or
Support), About This TV, or Network, Wi-Fi Connection, Advanced Wi-Fi Settings. Restart the
bridge.

### 6. Accept the remote (someone at the TV, once)

When the bridge starts, the TV shows a prompt asking to accept a remote control connection. Press
**Accept** (or Yes). The TV gives the bridge a client key, kept in
`bridge/data/lg-<id>-key.txt`, and never asks again. If nobody presses it, the bridge asks again at
most every 10 minutes, or the next time someone presses a key on the phone remote. If the TV never
asks, switch on **LG Connect Apps** in the TV's network settings (the name Home Assistant's guide
gives; it may differ by year).

Unlike a Samsung, an LG tells the bridge nothing (not even whether it is on) until the remote is
accepted.

### 7. Check it

- Switch the TV off and on with its own remote. Within a few seconds couch-tv opens.
- Arrows and OK move around and open an app. Back inside couch-tv goes back to the start.
- On the phone remote: volume, Home (opens couch-tv), and "put on" a YouTube video or a Netflix
  show.
- `http://<bridge>:5400/api/tvs` shows the last few things the hook did and when Developer Mode
  was last extended (`devmode`).

## How the hook works

`bridge/lg.py` checks the TV every 2 seconds over LG's network remote (SSAP, a websocket on port
3000, or 3001 encrypted on newer firmware): the power state, and which app is in front. Every 30
minutes it reads the TV's app list, and finds each app couch-tv knows by its LG id or its name. It
keeps, per TV, which of the two ports answered and tries that one first after a restart.

When the TV goes from off (gone from the network, or in Quick Start+ standby) to on, the bridge
waits a moment, and if no app is in front (live TV, an HDMI input or LG's home) it opens couch-tv.
If the TV came back straight into an app, it is left alone. Anything the phone remote or Claude
just asked for also wins: the hook stays quiet for 20 seconds after any command, except a power
press, so turning the TV on from the phone also lands on couch-tv. `"open_on_power_on": false` in
`config.json` turns the hook off.

Netflix titles open with the title in the launch (`contentId`), YouTube videos with the video's
address (`contentTarget`), as LG's own integrations do. Other apps just open.

## Keeping Developer Mode alive

A Developer Mode session runs out (reports differ: about 50 hours in a
[2022 write-up](https://elis.nu/blog/2022/07/keeping-webos-developer-mode-alive-with-home-assistant/),
up to 1000 hours on [LG's forum](https://forum.webostv.developer.lge.com/t/whats-the-way-to-extend-dev-time-with-webos-cli/28033)).
When it runs out and the TV restarts, Developer Mode goes off and **couch-tv is removed**. It also
goes off after 10 restarts with no network.

So once a day, while the TV is on, the bridge runs

```sh
ares-launch --device <ares_device> com.palmdts.devmode -p '{"extend":true}'
```

which does what the Extend button does
([reported working](https://github.com/webosbrew/dev-manager-desktop/issues/256)). It does it as
the TV comes on, just before couch-tv opens, so couch-tv covers whatever Developer Mode shows. On a
TV that stays on all day it waits until couch-tv or live TV is in front, then puts that back. It
never does it over another app.

- With no bridge at all, the app can press Extend itself:
  `com.webos.applicationManager/launch` with `{"id": "com.palmdts.devmode", "params": {"extend": true}}`
  is the same call ([#40](https://github.com/Seagey/couch-tv/issues/40)). couch-tv does not do this
  yet, so on the app-only path press Extend in the Developer Mode app within every session.
- Without `ares-launch` on the bridge computer, the bridge opens Developer Mode with the same
  setting over the network remote instead. That way is **untested** and may only open the app.
  Install the ares tools.
- The bridge looks for `ares-launch` on its PATH. A bridge started by launchd may not see npm's
  folder: then set `"ares_launch": "/full/path/to/ares-launch"` on the TV in `config.json` (or the
  `ARES_LAUNCH` environment variable). `which ares-launch` prints the path.
- The last try, and whether it worked, is in `bridge/data/lg-<id>-devmode.json` and in
  `/api/tvs`. A failed try does not count as the day's: it is tried again an hour later.
- `"extend_devmode": false` in `config.json` stops it. Then press Extend yourself in the
  Developer Mode app now and then.

**How much time is left.** Every 6 hours while the TV is on, the bridge reads the real countdown:
it reads the session token from the TV over Developer Mode's ssh (`ares-novacom`), and asks LG's
own session check (`developer.lge.com/secure/CheckDevModeSession.dev`), the same one the
Developer Mode app uses. The token is never logged or kept. The hours left (999 after an Extend on
this C4) are in `/api/tvs` (`devmode.hours_left`) and in `bridge/data/lg-<id>-devleft.json`.

The TV home (LG only) and the phone remote then show a plain warning when couch-tv is at risk:

- **red:** couch-tv is no longer installed, or fewer than 7 days are left;
- **amber:** fewer than 900 hours are left (the Extends are not working), or, when the countdown
  cannot be read, no Extend has worked for 3 days.

They go away by themselves after the next Extend that works.

## Turning it on

With **Quick Start+** on (Settings, General), an LG that is "off" stays on the network, and the
phone's power button turns it on over the network remote. Fully off, it leaves the network, and
only a Wake-on-LAN packet can reach it, and only if the TV allows it: "Mobile TV On, Turn on via
Wi-Fi" on 2017 and later models, "IP control settings, Wake on LAN" on 2025 models (both under
the TV's network or general settings). A cable is more reliable than Wi-Fi. If it does not wake,
the phone says so and you use the TV's remote.

## Limits to know

- LG's Home button and the app row are LG's. couch-tv cannot hide LG's ads or menu. Leaving couch-tv
  with the Home button is expected. For an app-only setup (no bridge), LG's Quick Access can pin it:
  hold a number key on the remote while couch-tv is in front, and that key opens it from then on
  (ChrisFWCB, #56).
- **If the ThinQ Home Dashboard is in front,** `ares-launch --device lounge app.couchtv.home` for an
  already running couch-tv can report success without bringing it forward. Close it first with
  `ares-launch --device lounge --close app.couchtv.home`, then launch it again (ChrisFWCB, #56).
- **Developer Mode must stay on.** If it goes off (the session ran out while the bridge was down,
  10 restarts with no network, a firmware update), couch-tv is removed: switch Developer Mode on
  again and rerun steps 2 and 4. Your settings live on the bridge, so nothing is lost.
- App ids differ between TVs and years. The ones in `bridge/apps.py` (`WEBOS`) come from public
  lists and the real LGs above, and every other app is found by its name. If an app does not open, find
  its id (see "Finding app ids" in step 3), and add it to that app's `ids`.
- couch-tv on LG reads its app list from the TV when webOS allows it, else from the bridge. Some
  firmware does not allow it (webOS 5.6.2 and 6.5.3 both refuse it), so there the app row stays empty
  until the bridge is on **and** the TV has accepted the remote (step 6). With no bridge, build with
  `--apps` (step 3) to bake the list in.
- **webOS 4** (2018 and 2019 models) has no CSS grid or flex `gap`, so the app row and cards stack
  badly; couch-tv does not have fallbacks for that yet ([#46](https://github.com/Seagey/couch-tv/issues/46)).
  Its power on: webOS 4 has no `system/turnOn`, so the bridge tries `turnOnScreen` and then
  Wake-on-LAN (with "Mobile TV On, Turn on via Wi-Fi" switched on).
- No screenshots, no "what is playing", no profile picking, no pressing Play inside other apps.

## The bridge in Docker on a NAS

The fifth real LG ran its bridge in Docker on a Synology (a `node:22-bookworm-slim` image with
python3 and `@webos-tools/cli`, the repo mounted at `/app`, `network_mode: host`, an entrypoint that
copies the Developer Mode key into `/root/.ssh` and runs `ares-setup-device` with the passphrase
from an environment variable). ChrisFWCB offered a Dockerfile and compose file in
[#56](https://github.com/Seagey/couch-tv/issues/56) as an example for NAS owners; they are not in the
repo yet.

## Undo

1. Remove the app: `ares-install --device lounge --remove app.couchtv.home`, or delete it from
   LG's app row with the TV remote (how depends on the year: usually hold OK on the tile, then
   remove).
2. Developer Mode off: open the Developer Mode app and switch Dev Mode Status off (the TV restarts),
   or uninstall the Developer Mode app.
3. Take the TV out of `config.json` and restart the bridge, and delete
   `bridge/data/lg-<id>-key.txt` and `bridge/data/lg-<id>-devmode.json`. The client key is then
   gone from the computer. The TV may keep its own note of the accepted remote, which is harmless
   (where to remove it on the TV differs by year and was not checked).
4. On the computer: `ares-setup-device -r lounge`.

Nothing else on the TV was changed.
