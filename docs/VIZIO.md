# couch-tv on a VIZIO TV (SmartCast and VIZIO OS)

## Status: New (Beta)

**This is new, and nobody has run it on a real VIZIO yet.** It was written in November 2026 from VIZIO's
own public app list and from public notes on the SmartCast API (the open pyvizio library and the
community Vizio_SmartCast_API notes), and tested against a pretend VIZIO on a computer
(`tests/vizio_standin.py`). Nothing was copied from another project. Expect something to need fixing.
If you have a VIZIO, you would be the first: please run the first test below and
[open an issue](https://github.com/Seagey/couch-tv/issues) with what it printed.

Not technical? [VIZIO-TESTING.md](VIZIO-TESTING.md) is a step by step guide to the first test.

## What it is

**A phone remote, with power, volume, inputs and opening apps.** couch-tv's own home page does not open on
the TV by itself (below, "The home"). With the bridge running on a computer that stays on (README, option B):

- The phone remote's keys, Home (VIZIO's own home), Back, the arrows and OK.
- Power off, power on from standby, and from fully off with Wake on LAN.
- Volume up, down and mute, and the volume level when the TV reports it.
- The TV's inputs by name ("HDMI 2", or the name you gave it on the TV, such as "Xbox").
- Opening Netflix, YouTube, Prime Video, Disney+ and the other apps in the table below.
- The Claude ask on top of those ("put on Netflix", "switch to the Xbox", "turn it down").

## What works and what does not

| | VIZIO |
|---|---|
| couch-tv's home on the TV | **No.** See "The home" |
| Phone remote: arrows, OK, Back, Menu, Home | Built (Home opens VIZIO's own home). The key codes come from one public source |
| Power off, and on from standby | Built |
| Power on from fully off | Only with Wake on LAN, and not in Eco mode |
| Volume up, down, mute | Built. The level shows when the TV reports it |
| Inputs | Built: the TV lists them, the bridge switches to one by name |
| Opening apps | The apps in the table below. Each opens on its own page |
| "Put on Bluey" (find and play) | The app opens on its own page and the reply says to pick the show there. No deep link into a show is known on a VIZIO |
| Which app is in front | Built, where the TV says. No title, no progress bar |
| Typing from the phone, screenshots | No |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools | No (Android only) |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs, Samsungs, LGs, Rokus, VIDAA TVs and VIZIOs together |

## The home

couch-tv's page cannot be opened on a VIZIO by the bridge, for free, today:

- **No browser.** VIZIO OS has no web browser to open the page in.
- **No sideloading.** There is no developer mode that installs an outside app.
- **VIZIO's app programme is a closed partner scheme.** An app on the TV's row means a business deal with
  VIZIO, not a download.
- **Chromecast built in only opens registered receivers.** A Cast receiver is a web page Google has
  registered. Nobody has shown a VIZIO opening a receiver that is not a known one.

So the bridge does not claim a home on a VIZIO. Asking it to open couch-tv's home gives a plain error
that says so, and Home on the phone remote opens VIZIO's own home.

### One open experiment, for testers only

VIZIO SmartCast TVs have Chromecast built in. Two public Cast receivers can show a web page: Home
Assistant's (`cast.show_lovelace_view`, which shows a Home Assistant dashboard, and a dashboard can hold a
web page card) and the DashCast style receivers (which load any address). If you already run Home
Assistant or a Cast tool, you could try showing couch-tv's home page (`/tv/` on the bridge) on the VIZIO
that way and tell us what happened.

- The page has to be reachable at an `https://` address. Cast receivers run over HTTPS, and a plain
  `http://` page inside one is blocked. That means your own reverse proxy with a certificate. Never open
  a router port for it.
- couch-tv does not do this for you, and the bridge has no code for it. It is an experiment, not a
  feature, and it may not work at all.
- If it works, the phone remote still drives the TV through the bridge, not through the page.

Please open an issue either way. A clear "it does not work" is a useful result.

## Which VIZIO TVs

- **VIZIO OS** (2024 on, and some 2025 Onn TVs sold by Walmart) and **SmartCast** with firmware 4.0 or
  newer: port 7345.
- **Older SmartCast** firmware: port 9000.
- **VIZIO's own app list** says which apps exist in which country. VIZIO sells TVs in the US, Canada and
  Mexico. Stan, Binge, ABC iview and the other Australian apps are not on its list.

The bridge tries 7345, then 9000, and keeps whichever answers like a VIZIO. A firmware update can change
any of this.

## Before you start

- The bridge running on a computer that stays on (README, option B).
- The VIZIO on the same network as that computer, ideally with a fixed address (a DHCP reservation in your
  router).

## Set it up

### 1. Two settings on the TV

- **Power mode: Quick Start** (not Eco), if you want the phone to turn the TV on. In Eco mode the TV drops
  off the network when it is off.
- Note the TV's address and its network (MAC) address, from its network settings (**Menu, Network**, or
  **Settings, Network, Network information**; the wording varies).

### 2. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "vizio"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "vizio", "ip": "<tv address>", "mac": "<tv mac>", "trace": true }
```

- `mac` is for turning the TV on from fully off (leave it out if you do not want that).
- `trace: true` logs every request and answer, with the PIN and the token hidden. Leave it on for the
  first weeks: it is what an issue needs.
- `port` (7345, then 9000), `device_id` (the name the TV remembers the bridge by) and `wake_on_lan` are
  there for a tester who finds the defaults wrong.

### 3. The first test, then pairing

With the bridge stopped:

```sh
.venv/bin/python scripts/vizio-check.py <tv address> --tv lounge
```

It finds the port, asks for the power state, the model, the inputs, the app in front and the volume, and
prints what the TV answered. It sends no key and opens nothing. Before pairing most VIZIOs answer "requires
pairing" to all of it: that is expected, and still worth pasting. Then pair:

```sh
.venv/bin/python scripts/vizio-check.py <tv address> --tv lounge --pair
```

The TV shows a 4 digit PIN. Type it in when asked (or run it again with `--pin <the 4 digits>`). The token
the TV gives back is kept in `bridge/data/vizio-lounge.json` (only you can read it, and git ignores it).
Run the first command again: now it should print real answers. With the bridge running,
`POST /api/vizio/pair` with `{}` and then `{"pin": "1234"}` does the same (it needs the pairing key like
every other endpoint).

Start the bridge.

### 4. Check it

- On the phone remote: an arrow, OK, volume up once, Home, then open Netflix or YouTube.
- Switch inputs: `POST /api/input` with `{"name": "hdmi 1"}`, or ask Claude.
- `http://<bridge>:5400/api/tvs` shows a `vizio` block: the port it found, whether it is paired, the power
  state, the app in front, the volume and the last error in plain words.

## Apps

VIZIO keeps its app list in its own cloud, not on the TV, so the bridge cannot ask the TV which apps it
has. couch-tv carries the ids from VIZIO's own public app list (read 12 November 2026). None has been
opened on a real VIZIO yet.

| App | Name space | App id |
|---|---|---|
| Netflix | 3 | 1 |
| YouTube | 5 | 1 |
| YouTube TV | 5 | 3 |
| Prime Video | 2 | 4 |
| Hulu | 2 | 3 |
| Disney+ | 2 | 75 |
| Paramount+ | 2 | 37 |
| Peacock | 2 | 88 |
| Plex | 2 | 9 |
| HBO Max | 2 | 128 |
| Apple TV | 3 | 4 |

Any other app opens as `vizio.<name space>.<app id>` (for example `POST /api/launch` with
`{"app": "vizio.2.61"}`), if you know its numbers. `scripts/vizio-check.py` prints the numbers of the app in
front: open the app with the TV's own remote, run it, and say in an issue what it printed.

## What is unconfirmed

Everything is written once, in `PROTOCOL`, `KEYS` and `APPS` at the top of `bridge/vizio.py`, so a tester's
output can correct it in one place. Two public references agree on the paths for pairing, power, keys, app
launch and inputs. These rest on one source or our own reading:

- The key codes other than volume and power (one public table): the arrows, OK, Back, Home, Menu, play and
  pause, input, channel.
- That the power state is 1 for on and 0 for standby.
- `/app/current` and the shape of its answer, and that VIZIO's own home answers as name space 4, app id 1.
- The volume level path (`/menu_native/dynamic/tv_settings/audio/volume`).
- The exact body that switches inputs (`REQUEST: MODIFY` with the `HASHVAL` from the current input) on
  VIZIO OS.
- What a token the TV no longer accepts looks like (`requires_pairing`, an HTTP 403, or both).
- Whether launching wants `MESSAGE` as `null` (VIZIO's list) or `""` (some notes).
- That a held key is a KEYDOWN, a short wait and a KEYUP.

## Limits to know

- couch-tv's home does not open on the TV. This is a phone remote.
- VIZIO's Home button and home row are VIZIO's.
- Pairing needs the PIN on the TV once. If the TV is reset, or forgets the bridge, pair again.
- Everything here rests on public notes about the SmartCast API, not on anything VIZIO publishes for
  outside developers. A firmware update can break it.
- Never open a router port for the TV's SmartCast port: some of its requests need no token.

## Undo

1. Take the TV out of `config.json` and restart the bridge.
2. Delete `bridge/data/vizio-<id>.json` (the token).
3. Optional: on the TV, remove the bridge from its list of paired devices, if your model shows one.
