# couch-tv on a Panasonic Viera TV

## Status: New, Beta

The Panasonic path is new. It was written in November 2026 from the public description of the network
remote that Panasonic's own phone app uses, and checked against a stand-in TV on a computer
(`tests/panasonic_standin.py`). The parts that only a real set can settle are listed below under "What is
unconfirmed", in one place in `bridge/panasonic.py`, so a first owner's log can fix them quickly. If you
have a Viera, please run the first test below and [open an issue](https://github.com/Seagey/couch-tv/issues)
with what it printed.

Not technical? [PANASONIC-TESTING.md](PANASONIC-TESTING.md) is a step by step guide to the first test.

## Which Panasonic TVs

- **My Home Screen** (Firefox OS based, Vieras from about 2015 to 2019, and later My Home Screen versions):
  the phone remote and the page that opens itself.
- **Older Vieras with network control** (about 2012 to 2014, "Viera Connect"): the phone remote should
  work the same way. Opening a web page may differ on these sets.
- **2018 and newer sets** use the same remote, with every command encrypted. You pair once with a PIN
  the TV shows (step 4).
- **Not this page:** Panasonic's Google TV models are normal couch-tv TVs (README, options A, B and C).
  Its Fire TV, Roku and TiVo models run those systems instead.

`scripts/check-tv.py <tv address>` recognises a Viera by its port 55000.

## What it is

My Home Screen does not run Android apps and does not let anything replace its home screen. So couch-tv on
a Viera is **a page that opens itself, not a true home screen**, the same idea as on a
[Samsung](SAMSUNG.md), an [LG](LG.md) or a [Hisense VIDAA](VIDAA.md):

- **The hook** (`bridge/panasonic.py`): the bridge (option B, a computer that stays on) watches the TV.
  Each time the TV is switched on, it waits a few seconds and opens couch-tv's home page in the TV's own
  web browser.
- **The page** is the same couch-tv home the bridge already serves (`/tv/`).
- **The phone remote and the Claude ask** work against the TV through the same bridge.

It needs the computer that stays on. Without one there is nothing on the TV to open couch-tv.

## What works and what does not

| | Panasonic Viera |
|---|---|
| couch-tv home, apps in your order, the remote's arrows and OK | In the TV's browser |
| Opens by itself when the TV is switched on | Yes, with the bridge running, a few seconds after the TV comes on |
| The browser's own bar | **Stays visible.** A full screen page with no browser bar is not known to be possible |
| Panasonic's own Home button | **Still opens Panasonic's home** (My Home Screen). Press Home on the phone remote to get couch-tv back |
| Phone remote: keys, volume up and down, mute, open an app | Yes |
| Volume level | Yes: the bridge reads and sets the level directly, so the phone's slider works |
| Switching to HDMI 1 to 4 from the phone | Built (unconfirmed, below). The Input key works too |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs, Samsungs, LGs, Rokus, VIDAA TVs and Vieras together |
| "Put on Bluey" (find and play) | The app opens on its own page and the reply says to pick the show there. No deep link into a show is known on a Viera |
| Turning the TV on from the phone | When the TV still answers on the network: the power key. From fully off: Wake on LAN, where the TV allows it (wired works best) |
| Which app is in front, what is playing, a progress bar, screenshots | No. The TV does not tell the network any of it, and live TV has no "what is playing" either |
| Typing from the phone | Not built |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools, switching the stock home off | No (Android only) |

## How the hook decides

Panasonic does not say what is on screen, so the hook cannot tell whether someone is in the middle of
something. It keeps to two rules:

- It opens couch-tv only when the TV has **just been switched on**, a few seconds after (`settle`, 6 s by
  default), because a Viera reopens its last screen when it starts. It never takes over later.
- Anything the phone remote or Claude asked for wins: the hook stays quiet for 20 seconds after any
  command, except a power press from the phone, so turning the TV on from the phone also lands on couch-tv.

`"open_on_power_on": false` turns the hook off and keeps the phone remote.

The page the bridge opens carries a code that works once, for two minutes, never the pairing key: a TV
browser's address bar and history are not private. The page swaps the code for the key once
(`/api/vidaa/claim`, shared with VIDAA) and keeps it in the browser's own storage.

## Before you start

- The bridge running on a computer that stays on (README, option B).
- The Viera on the same network as that computer, ideally with a fixed address (a DHCP reservation in your
  router).

## Set it up

### 1. Settings on the TV

- **Network remote control**: on many Vieras, **Menu, Network, TV Remote App Settings** (or **Network Link
  Settings**). Switch on **TV Remote**, and **Powered On by Apps** if you want the phone to turn the TV on.
  The names differ between years.
- **Wake on LAN**, if the TV has it, for turning it on from fully off. An Ethernet cable is more reliable
  than Wi-Fi for this.
- Note the TV's address and its MAC address, from its network status screen.

### 2. The first test

With the bridge stopped:

```sh
.venv/bin/python scripts/panasonic-check.py <tv address> --tv lounge
```

It reads the TV's description (the model), its list of remote actions, its volume and whether it is
muted, and prints every message with any PIN, key or session hidden. **It presses no key and changes
nothing.** It also says whether this TV is an encrypted set that needs pairing.

### 3. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "panasonic"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "panasonic", "ip": "<tv address>", "mac": "<tv mac>", "trace": true }
```

- `mac` is for turning the TV on from fully off (leave it out if you do not want that).
- `trace: true` logs every message to and from the TV, with the PIN, keys and session hidden (encrypted
  commands are logged before they are sealed). Leave it on for the first weeks: it is what an issue needs.
- `home_url`: the address the TV should open, if the bridge picks the wrong one of this computer's
  addresses (for example `http://192.0.2.20:5400/tv/`). The address must fit in 255 characters.
- `settle` [6]: seconds the hook waits after the TV comes on.
- `encrypted`: `true` or `false` if the first test guessed wrong. Left out, the bridge reads it from the TV.
- `port` [55000]: for a tester who finds the default wrong.

### 4. Pairing (encrypted sets only)

```sh
.venv/bin/python scripts/panasonic-check.py <tv address> --tv lounge --pair
```

The TV shows a PIN. Type it in when asked. The application id and key word the TV gives back are kept in
`bridge/data/panasonic-lounge.json` (readable by your user only), which git ignores. With the bridge
running, `POST /api/panasonic/pair` with `{}` and then `{"pin": "1234"}` does the same (it needs the
pairing key like every other endpoint). A wrong PIN is refused by the TV: ask for a new one and try again.

Start the bridge.

### 5. Check it

- Switch the TV off and on with its own remote. A few seconds after it comes on, the browser opens couch-tv.
- On the phone remote: an arrow, the volume slider, Home (opens couch-tv), then open Netflix or YouTube.
- `http://<bridge>:5400/api/tvs` shows the last few things the hook did and a `panasonic` block: whether
  the port answers, the model, whether it is encrypted and paired, whether a session is open, whether the
  volume was read, how many apps it listed, and the last error in plain words.

## What to test first

In this order, because each one needs the one before:

1. `scripts/panasonic-check.py <tv address>` (step 2). Paste everything it printed into an issue, with the
   TV's model number, the year if you know it, and whether it is on Wi-Fi or Ethernet.
2. Encrypted sets: pairing (step 4). Does the TV show a PIN, and does the script say "Paired"?
3. One key from the phone remote (an arrow), then the volume slider, then mute.
4. Home on the phone remote: does the browser open couch-tv?
5. Switch the TV off and on: does couch-tv open by itself?
6. Open Netflix and YouTube from the phone.
7. Switch the TV off with its remote and wait a minute: does `/api/tvs` say off? (Some sets keep answering
   in standby; that is one of the unconfirmed points.)

## A tile on My Home Screen (Firefox OS route, for testers only)

On Firefox OS Vieras (2015 on) a page can, in principle, be added as an app with its own tile on My Home
Screen, which gets closer to a home screen than the browser does. This is a route for a tester to try, not
something couch-tv does for you:

- It needs the TV's developer (debug) mode and an old Firefox with WebIDE (the remote runtime for Firefox
  OS was removed from current Firefox).
- A small hosted app whose start page is the bridge's `/tv/` page would then show as a tile.
- How to switch on debug mode differs by model and is **not confirmed**; some firmware has removed it.

If you get this working, please write up the steps in an issue so they can go here.

## What is unconfirmed

These are written once, in `PROTOCOL` and `KEYS` at the top of `bridge/panasonic.py`, so a tester's trace
can correct them in one place:

- **Opening a web page:** that `X_LaunchApp` with `resource_id=1063` opens the browser, that `X_ConnectApp`
  then makes the TV connect back to an address the bridge gives it, and the exact bytes it is sent (a 7 byte
  header, one length byte, the address, a closing zero). Older 2013 sets may do this differently.
- **Power:** that the TV answering on port 55000 means it is on. A set in networked standby may answer
  too, and then couch-tv would think it is on.
- **The app list's layout** (one record per app, fields split by an apostrophe).
- **The key names** beyond the common ones (play, pause, stop, fast forward, rewind, channel up and down,
  the number keys).
- **Inputs:** the name of the argument `X_SendCtrlCmd` takes, and that HDMI 1 to 4 are ids 1 to 4.
- **Encrypted sets:** that the PIN is four digits, what the TV answers when a session runs out (the bridge
  asks for a new session once, then gives up), and how the sequence number is counted after an error.

## Limits to know

- Panasonic's Home button and home screen are Panasonic's. Leaving couch-tv with the Home button is expected.
- The browser shows its own bar, and the TV shows its last screen for a few seconds before couch-tv opens.
- Pairing on 2018 and newer sets needs the PIN on the TV once.
- Everything here rests on how the TV is described publicly, not on anything Panasonic documents for third
  parties. A firmware update can change it.

## Undo

1. Take the TV out of `config.json` and restart the bridge.
2. Delete `bridge/data/panasonic-<id>.json` (the pairing keys, encrypted sets only).
3. If you switched on TV Remote or Powered On by Apps only for couch-tv, switch them off again.

Nothing else on the TV was changed.
