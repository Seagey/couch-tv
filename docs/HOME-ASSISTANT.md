# couch-tv as a Home Assistant app

If you run Home Assistant on its own computer (a Home Assistant Green or Yellow, a Raspberry Pi, a
mini PC), that computer is already on all the time. This app puts couch-tv's bridge on it, so you get
**option B** (the home screen, the phone remote, "put on Bluey" search, turning the TV on from your
phone) without keeping a second computer on. Home Assistant 2026.2 calls these "apps". Older
versions call them "add-ons"; it is the same thing.

## What it is, and what it is not

It is the same bridge as in [SETUP.md](SETUP.md), running inside Home Assistant, with the phone
remote built in and a small MCP server that Home Assistant's own assistant can use.

- **Works:** Android TV and Google TV (including the NVIDIA Shield, which has been tried).
- **Should work, not tried:** Fire TV on Fire OS (it needs `"adb_only": true` in `config.json`,
  see [CONFIG.md](CONFIG.md)).
- **Not in this first version:** Samsung, LG, Roku and the others that run couch-tv as an app on the
  TV. LG needs LG's own tools, which are not in the app. Run the bridge on a computer for those
  ([SETUP.md](SETUP.md)).
- **Also not in this first version:** Matter devices (the Matter service needs Node, which is not in
  the app), and your own photos and scenes. The folder `tv-home/web/backgrounds/mine` is inside the
  app's image, not in the config folder, so anything put there is lost when the app updates.
- **Home Assistant OS or Supervised only.** Apps need the Supervisor. A plain Home Assistant Core
  or Container install has no App store: use [the Docker version](DOCKER.md) there.

You still set each TV up once from a computer (below). The app is the always-on part.

## Install it

1. In Home Assistant: **Settings, Apps, App store**. Open the three dots at the top right,
   **Repositories**, and add `https://github.com/Seagey/couch-tv`.
2. Find **Couch TV**, press **Install**, then **Start**. Switch on **Start on boot** and **Watchdog**.
3. Open the **Log** tab. It prints a line like "phone remote: pair a phone once by opening
   http://&lt;home assistant address&gt;:5400/?pair=&lt;key&gt;". That is the phone remote's link and password.

The first start makes a starter `config.json` for you. It has nothing of yours in it, so the next
parts are about filling it in.

## The Configuration tab

| Option | What it does | Default |
|---|---|---|
| Pairing key | The password phones type once to use the remote. Empty: the app makes a long one the first time and keeps it. 12 to 128 letters, digits, `-` or `_` if you choose your own. | empty |
| Ask assistant | `off`, or `home_assistant` to let a Home Assistant conversation agent answer when someone asks the TV in plain words. | `off` |
| Conversation agent | Which Home Assistant agent answers, for `home_assistant`. Must be set when Ask is `home_assistant`: an empty one does not fall back to a default, and Ask stays unavailable. | empty |
| Let Home Assistant's assistant turn the TV off | Whether the MCP server (below) offers "turn the TV off". | off |

Do not also set `bridge.pairing_key` in `config.json`. The app refuses to start if both are set, so
the key lives in one place.

## The app's config folder

Everything of yours lives in the app's config folder, not in the image, so updating or reinstalling
the app keeps it. Home Assistant calls it `/addon_configs/<something>_couch_tv/` (`<something>` is
a short code for this repository). Open it from the **File editor**, **Studio Code Server** or
**Samba share** app (the `addon_configs` share). It holds:

- `config.json`: your TVs, people, apps and look ([CONFIG.md](CONFIG.md)).
- `.env`: secrets, one `NAME=value` per line, for example `HOME_ASSISTANT_TOKEN` or `PLEX_TOKEN`.
- `adbkey` and `adbkey.pub`: the key your TV trusts for "Allow USB debugging?".
- `data/`: the TV pairing keys, watch history and taste.
- `pairing_key`: the key the app made, if you left the option empty.

Set `bridge.host` in `config.json` to your Home Assistant computer's address (the number address,
or its name if your router gives it one). TVs are told to load their home from there.

## Set up each TV (from a computer, once)

The app cannot show a pairing code to you or press "Allow" on a TV, so each TV is set up once from
a computer, exactly as in [SETUP.md](SETUP.md), but pointing at the app. Everything below is run
inside a copy of the couch-tv folder on that computer.

1. Follow SETUP.md steps 1 and 2 for your TV (Developer options on, the TV and `config.json`).
   In `config.json` set `bridge.host` to the Home Assistant address, and leave `bridge.pairing_key` out.
2. Pair the TV (step 3): `.venv/bin/python bridge/pair_tv.py <tv id>`, and for Android and Google TV
   tick **Always allow** when the TV asks "Allow USB debugging?". This fills `bridge/data/` and
   `~/.android/adbkey`.
3. Put couch-tv on the TV, pointing at the app, with the key from the Log tab:

   ```sh
   TV_IP=<tv address> TV_ID=<tv id> COUCH_CONFIG=<copy of the app's config.json> BRIDGE_KEY=<pairing key> BRIDGE_URL=http://<home assistant address>:5400 APK=couch-tv-home.apk sh tv-home/tools/apply.sh
   ```

   `TV_ID` is the TV's `id` in `config.json` (without it the first TV is assumed to be called
   living-room), and `COUCH_CONFIG` is the config file `apply.sh` reads the TV from (the copy you
   made for the app).

4. Now copy those into the app's config folder (after `apply.sh`, which writes more files into
   `bridge/data/` that the app needs). Mount the Samba share, or use the File editor's upload,
   then, with `<config folder>` standing for the mounted folder:

   ```sh
   cp config.json "<config folder>/config.json"
   cp -R bridge/data/. "<config folder>/data/"
   cp ~/.android/adbkey ~/.android/adbkey.pub "<config folder>/"
   ```

   Restart the app from its **Info** tab.
5. Open the phone remote's link from the Log tab on a phone. Your TV is listed and the remote works.

Doing another TV is the same again, adding it to the copy of `config.json` first.

## The phone remote

Open the link from the Log tab on each phone, once. After that the phone remembers it. Add the page
to the phone's home screen like any other web page ([REMOTE.md](REMOTE.md)). It works on your
home Wi-Fi. Anyone with the key can use the remote, so share the key like a Wi-Fi password and do
not forward a port to it.

## For Home Assistant's own assistant: the MCP server

The app also starts couch-tv's tools (play, find, volume, keys, what is on) as an MCP server at
`http://127.0.0.1:5401/mcp`. In Home Assistant, add the **Model Context Protocol** integration and
use that address. It is **this computer only**: it listens on the loopback address and has no sign
in, so nothing else on your network can reach it, and Home Assistant itself can. "Turn the TV off"
is left out unless you switch on the last option above.

This needs a couch-tv version that has the MCP HTTP mode. On one without it the MCP server simply
does not start and the rest of the app works the same.

## Ask, with a Home Assistant conversation agent

With **Ask assistant** set to `home_assistant`, plain-words requests ("put on something for the
kids") are answered by one of your Home Assistant conversation agents, so no extra account or key is
needed. The conversation agent must be chosen in the app's options. Setting it up: [HOME-ASSISTANT-ASSIST.md](HOME-ASSISTANT-ASSIST.md). It needs a couch-tv
version that has it; on an older one the option does nothing.

## Backups

The config folder is part of the app's backup. Backing up the app and restoring it brought back every
file in the folder unchanged (checked on a real Home Assistant OS install), and the TVs reconnected
by themselves. Tick **Couch TV** in your backups, and it is still wise to keep a copy of
`config.json` and `adbkey` somewhere safe.

## Take it off

1. **Settings, Apps, Couch TV, Uninstall.** Tick to delete its data only if you want your config
   folder gone too.
2. If you added them: delete the Model Context Protocol integration that points at
   `http://127.0.0.1:5401/mcp`, and the "Couch TV" conversation agent (Settings, Devices and services).
3. The TVs keep what was set up on them. Put each one back as in [UNINSTALL.md](UNINSTALL.md).

## Known

Home Assistant's Supervisor logs "Can't read ... Invalid app config" for the `config.example.json`
files in this repository every time it reloads the App store. They are couch-tv's example settings,
not apps, and the warnings are harmless.

- Home Assistant's MCP integration shows a tool's errors only in its debug logs, so a tool that
  "does nothing" there is worth a look with debug logging switched on.

## If it does not work

- The Log tab is the first place to look. "first start" lines mean it made a starter `config.json`.
- A phone says "pairing key required": open the link from the Log tab once.
- The TV asks "Allow USB debugging?" again: the app has a different `adbkey` from the one the TV
  trusts. Copy the one you paired with into the config folder (step 3), or tick Always allow.
- It says `config.json sets bridge.pairing_key`: remove that line from `config.json`.
- Home Assistant cannot install the app ("image not found"): the images are only published with a
  couch-tv release, and the package must be public. Check the release page.
- More: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
