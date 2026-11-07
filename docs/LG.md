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

## Test status: two real LGs so far

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
minutes it reads the TV's app list, and finds each app couch-tv knows by its LG id or its name.

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

- Without `ares-launch` on the bridge computer, the bridge opens Developer Mode with the same
  setting over the network remote instead. That way is **untested** and may only open the app.
  Install the ares tools.
- The bridge looks for `ares-launch` on its PATH. A bridge started by launchd may not see npm's
  folder: then set `"ares_launch": "/full/path/to/ares-launch"` on the TV in `config.json` (or the
  `ARES_LAUNCH` environment variable). `which ares-launch` prints the path.
- The last try, and whether it worked, is in `bridge/data/lg-<id>-devmode.json` and in
  `/api/tvs`. A failed try is not repeated until the next day.
- `"extend_devmode": false` in `config.json` stops it. Then press Extend yourself in the
  Developer Mode app now and then.

## Turning it on

With **Quick Start+** on (Settings, General), an LG that is "off" stays on the network, and the
phone's power button turns it on over the network remote. Fully off, it leaves the network, and
only a Wake-on-LAN packet can reach it, and only if the TV allows it: "Mobile TV On, Turn on via
Wi-Fi" on 2017 and later models, "IP control settings, Wake on LAN" on 2025 models (both under
the TV's network or general settings). A cable is more reliable than Wi-Fi. If it does not wake,
the phone says so and you use the TV's remote.

## Limits to know

- LG's Home button and the app row are LG's. couch-tv cannot hide LG's ads or menu.
- **Developer Mode must stay on.** If it goes off (the session ran out while the bridge was down,
  10 restarts with no network, a firmware update), couch-tv is removed: switch Developer Mode on
  again and rerun steps 2 and 4. Your settings live on the bridge, so nothing is lost.
- App ids differ between TVs and years. The ones in `bridge/apps.py` (`WEBOS`) come from public
  lists and the two real LGs above, and every other app is found by its name. If an app does not open, find
  its id: `ares-install --device lounge --list`, and add it to that app's `ids`.
- couch-tv on LG reads its app list from the TV when webOS allows it, else from the bridge. Some
  firmware does not allow it (webOS 5.6.2 and 6.5.3 both refuse it), so there the app row stays empty
  until the bridge is on **and** the TV has accepted the remote (step 6). With no bridge at all the
  dock stays empty on those TVs for now; an app list built into the package is on the way (#28).
- No screenshots, no "what is playing", no profile picking, no pressing Play inside other apps.

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
