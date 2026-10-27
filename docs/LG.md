# couch-tv on an LG TV (webOS): possible, untested

**Nothing on this page has been tried on an LG TV.** It is the research for doing on LG what
[SAMSUNG.md](SAMSUNG.md) does on a Samsung: the couch-tv home as an app, opened by the bridge each
time the TV is switched on. There is no LG code in this repo yet. If you try it, please open an
issue with what happened.

Like Samsung, LG does not let an app replace its home screen, so the best case is the same: **an
app that opens itself, not a true home screen**, and it needs the bridge (a computer at home that
stays on).

## The pieces, as LG documents them

### 1. Developer Mode

- Install **Developer Mode** from the LG Content Store, sign in with an LG developer account and
  switch Dev Mode Status on. The TV restarts.
  [LG: Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)
- The app shows a **Key Server** switch and a 6 character passphrase. With the Key Server on, the
  computer fetches the TV's key once (`ares-novacom --device <name> --getkey`). Same page.
- **The session runs out.** The app shows the time left and an Extend button. Reports differ on the
  length: about 50 hours in a 2022 write-up
  ([elis.nu](https://elis.nu/blog/2022/07/keeping-webos-developer-mode-alive-with-home-assistant/)),
  up to 1000 hours according to a reply on LG's own forum
  ([forum](https://forum.webostv.developer.lge.com/t/whats-the-way-to-extend-dev-time-with-webos-cli/28033)).
  When it runs out and the TV restarts, Developer Mode goes off and **test apps are removed**. It
  also goes off after 10 restarts with no network (LG's page above).
- Unconfirmed: whether the developer account is free.

### 2. Installing the app

- LG's command line, `npm install -g @webos-tools/cli`, gives `ares-setup-device`,
  `ares-package` (makes the `.ipk`), `ares-install` and `ares-launch`.
  [webos-tools/cli](https://github.com/webos-tools/cli)
- Or **webOS Dev Manager**, a desktop app for macOS, Windows and Linux that installs an `.ipk`
  in a few clicks and keeps the same settings as the CLI.
  [webosbrew/dev-manager-desktop](https://github.com/webosbrew/dev-manager-desktop)
- The TV takes these over SSH on port 9922 (user `prisoner`).
  [webosbrew: Developer Mode](https://www.webosbrew.org/devmode/)
- couch-tv's TV home is a web page, so it would go in as a webOS web app (an `appinfo.json`
  instead of Samsung's `config.xml`), much like `samsung/build.py` packs it for Samsung.

### 3. Keeping Developer Mode alive from the bridge

The bridge could press Extend for you, so the app is never removed:

- `ares-launch com.palmdts.devmode -p '{"extend":true}' -d <device>` does what the Extend button
  does, with the TV on. Reported working in
  [dev-manager-desktop issue 256](https://github.com/webosbrew/dev-manager-desktop/issues/256).
- An older community method reads a session token from the TV over SSH
  (`/var/luna/preferences/devmode_enabled`) and calls LG's
  `ResetDevModeSession.dev?sessionToken=<token>` web address on a timer
  ([SR-Lut3t1um/Webos-renew-dev](https://github.com/SR-Lut3t1um/Webos-renew-dev)). Issue 256 says the
  call can report success while the TV's timer keeps counting, so the `ares-launch` way is the safer
  one. webOS Dev Manager can also generate a renewal script.

A daily `ares-launch ... extend` from the bridge, whenever the TV is on, would be the plan.

### 4. The network remote (for the phone remote and the hook)

- LG's remote protocol (SSAP) is a websocket on port **3000** (plain) and **3001** (encrypted).
  [LGWebOSRemote](https://github.com/klattimer/LGWebOSRemote),
  [Home Assistant: LG webOS](https://www.home-assistant.io/integrations/webostv/)
- The first connection shows a **pairing prompt on the TV**. The TV then gives a client key, which
  must be kept or it asks again. [PyWebOSTV](https://github.com/supersaiyanmode/PyWebOSTV)
  If it never asks: switch on "LG Connect Apps" in the TV's network settings (Home Assistant page).
- Opening an app is the `system.launcher/launch` call with the app's id. Arrows and OK go over a
  second "pointer input" socket that the same libraries open. The exact messages are in those
  libraries; not checked here.
- Turning the TV on is Wake-on-LAN, more reliable on a cable: "Mobile TV On, Turn On Via Wi-Fi"
  on 2017 and later models, "IP control settings, Wake on LAN" on 2025 models (Home Assistant page).

### 5. Opening couch-tv when the TV comes on

- The bridge watching the TV and sending a launch when it comes on is known to work: Home
  Assistant automations do exactly this, opening an app on "turned on" (Home Assistant page).
- No supported "start this app at boot" setting for developer apps was found. Community scripts
  that register an app as an input exist but were not checked.

### 6. App ids on webOS

`netflix`, `youtube.leanback.v4`, `amazon` (Prime Video), `com.disney.disneyplus-prod` (Disney+,
least certain), `com.webos.app.livetv` (live TV).
Sources: [RTI LG integration note (2020)](https://www.rticontrol.com/pub/media/wysiwyg/dealer/technote/LG_Direct-App_Integration_.pdf),
[Connect SDK](https://connectsdk.readthedocs.io/en/latest/apis-ios/ios-appinfo.html),
[Home Assistant forum](https://community.home-assistant.io/t/app-ids-for-lg-smart-tvs/662550).
Check each on the TV itself before relying on it.

## What it would take

1. `lg/`: the TV home packed as a webOS app (`appinfo.json`, `ares-package`).
2. `bridge/lg.py`: an `"kind": "lg"` driver like `bridge/samsung.py`, on SSAP (keys, open an app,
   volume, power state), Wake-on-LAN, the power-on hook, and the daily Developer Mode extend.
3. A test on a real LG, then this page rewritten as setup steps.

Until then: an LG with a Google TV box on its HDMI gets all of couch-tv today.
