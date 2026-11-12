# couch-tv on a Hisense VIDAA TV

## Test status: confirmed on a real VIDAA TV

**Confirmed on a real VIDAA TV.** First confirmed set: a Hisense 55U7N on VIDAA 9 (software
`V0002.09.61X.Q0705`, a July 2026 build), over Wi-Fi. On it, login, pairing, reading the TV's state
and app list, the phone remote's keys, opening an app, and a native Couch TV tile on the app row all
work. This firmware uses the newer "modern" transport: the login credentials are worked out from the
clock afresh on every connect, the pairing is kept against the client's id (no token is issued), and
the TV refuses `#` wildcard subscriptions, so `bridge/vidaa.py` now handles all three. Hisense still
publishes nothing about any of this, so another model or firmware may still need fixing: if yours
does, please [open an issue](https://github.com/Seagey/couch-tv/issues) with what the first test
printed. The client certificate is still something each owner supplies from their own copy of
Hisense's app (`scripts/vidaa-cert.py`); couch-tv does not ship it.

Not technical? [VIDAA-TESTING.md](VIDAA-TESTING.md) is a step by step guide to the first test.

## What it is

VIDAA (Hisense's own system, being renamed V or V Home OS on 2026 models) does not run Android apps and
does not let anything replace its home screen. So couch-tv on VIDAA is **a page that opens itself, not a
true home screen**, the same idea as on a [Samsung](SAMSUNG.md), an [LG](LG.md) or a [Roku](ROKU.md):

- **The hook** (`bridge/vidaa.py`): the bridge (option B, a computer that stays on) watches the TV the way
  Hisense's own phone app does. Each time the TV is switched on and lands on its own home or live TV, it
  opens couch-tv's home page within a few seconds.
- **The page** is the same couch-tv home the bridge already serves (`/tv/`). On VIDAA it opens in the
  TV's own browser, or, on firmware that still allows it, as a **Couch TV tile** on the TV's app row.
- **The phone remote and the Claude ask** work against the TV through the same bridge.

It needs the computer that stays on. Without one there is nothing on the TV to open couch-tv.

## What works and what does not

| | VIDAA |
|---|---|
| couch-tv home, apps in your order, the remote's arrows and OK | In the TV's browser or a tile. Not yet seen on a real TV |
| Opens by itself when the TV is switched on | Yes, with the bridge running (not yet seen on a real TV) |
| VIDAA's own Home button | **Still opens VIDAA's home.** That cannot change without rooting the TV, and couch-tv never roots a TV. Press Home on the phone remote to get couch-tv back |
| A Couch TV tile on the app row | Only on firmware that still accepts it (below). Asked for once, from the phone, never by itself |
| Phone remote: keys, volume up and down, mute, open an app | Built. The key names are unconfirmed |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs, Samsungs, LGs, Rokus and VIDAA TVs together |
| "Put on Bluey" (find and play) | The app opens on its own page and the reply says to pick the show there. No deep link into a show is known on VIDAA |
| Turning the TV on from the phone | From standby: a power key. From fully off: only with Wake on LAN switched on in the TV's network settings |
| Which app is in front, what is playing, a progress bar, screenshots | No. VIDAA does not tell the network any of it |
| Volume level | No: up, down and mute only |
| Typing from the phone | Not built yet |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools, switching the stock home off | No (Android only) |
| Root | **Never.** couch-tv will not root a TV or walk you through it |

## Which VIDAA versions should work

Expected, from what owners of these TVs have reported about the TV's remote control, not from our own
tests:

- **Older and mid VIDAA** (VIDAA U6 and U7, many 2023 and early 2024 builds): the phone remote and the
  hook, and probably the Couch TV tile too.
- **Newer VIDAA** (2024 on, VIDAA 9 and the P and Q builds): the phone remote and the hook through the
  TV's browser, **no tile** (the firmware refuses it). The one Australian 2024 set reported so far was in
  this group, so it is the likely case for a Hisense bought in Australia in 2025 or 2026, but that is one
  report, not a rule.
- **Some sets** answer on the network but ignore the control messages. Then nothing here works and the
  first test says so.

A firmware update can change any of this overnight. Hisense says there is no official third party
control.

## Before you start

- The bridge running on a computer that stays on (README, option B).
- The VIDAA TV on the same network as that computer, ideally with a fixed address (a DHCP reservation in
  your router).
- An Android phone with Hisense's own VIDAA remote app on it (once, for the certificate in step 2). Not
  needed on older firmware.

## Set it up

### 1. Two settings on the TV

- **Wake on LAN** (sometimes "Wake on Wireless Network"), in the TV's network settings, if you want the
  phone to turn the TV on from fully off. Ethernet is more reliable than Wi-Fi for this.
- Note the TV's address, from its network settings.

### 2. The client certificate (newer firmware only)

Since about 2024, VIDAA only lets a phone remote in if it shows Hisense's client certificate, the one
inside Hisense's own phone app. **couch-tv does not include it and never will**: it is Hisense's, not ours
to hand out. You take it from your own copy of the app, on your own computer:

1. Copy the VIDAA app's installer (`.apk`) off your own Android phone. On a computer with Android's
   platform tools: `adb shell pm list packages | grep -i vidaa` finds the app's name, `adb shell pm path
   <that name>` says where its `.apk` is, and `adb pull <that path>` copies it.
2. Run:

   ```sh
   .venv/bin/python scripts/vidaa-cert.py <the .apk you copied>
   ```

   It looks for a plain certificate and its matching key inside the file and writes them to
   `bridge/data/vidaa/` (`client.pem` and `client.key`), which git ignores. It does not take the app apart
   any further than that. If it says it found nothing, or that the key is locked, stop there and say so in
   an issue: that is a gap, not something to work round.

Skip this step on older firmware. The first test (step 4) says whether the TV wants it.

### 3. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "vidaa"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "vidaa", "ip": "<tv address>", "mac": "<tv mac>", "trace": true }
```

- `mac` is for turning the TV on from fully off (leave it out if you do not want that).
- `trace: true` logs every message to and from the TV, with the PIN and the token hidden. Leave it on for
  the first weeks: it is what an issue needs.
- `browser`: the name the TV lists its web browser under, if couch-tv cannot find it by itself (it looks
  for "Browser", "Web Browser" and "Internet").
- `home_url`: the address the TV should open, if the bridge picks the wrong one of this computer's
  addresses (for example `http://192.0.2.20:5400/tv/`).
- `port` (36669, then 36668 on older builds), `tls` (true), `cert` and `cert_key` (the files from step 2),
  `mqtt_user`, `mqtt_password` and `client_id` are there for a tester who finds the defaults wrong.

### 4. The first test, then pairing

With the bridge stopped:

```sh
.venv/bin/python scripts/vidaa-check.py <tv address> --tv lounge
```

It logs in the way the phone app does, asks where the TV is and which apps it has, then prints every
message the TV sends for 60 seconds while you press buttons on the TV's own remote. It sends no key and
opens nothing. Then pair:

```sh
.venv/bin/python scripts/vidaa-check.py <tv address> --tv lounge --pair
```

The TV shows a 4 digit PIN. Type it in when asked (or run it again with `--pin <the 4 digits>`). The token
the TV gives back is kept in `bridge/data/vidaa-lounge.json`, which git ignores. With the bridge running,
`POST /api/vidaa/pair` with `{}` and then `{"pin": "1234"}` does the same (it needs the pairing key like
every other endpoint).

Start the bridge.

### 5. The tile (optional, older firmware)

```sh
curl -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer <pairing key>' \
  -d '{"tv": "lounge"}' http://localhost:5400/api/vidaa/tile
```

This asks the TV to add a **Couch TV** tile to its app row, pointing at the bridge's home page. It answers
`"tile": true` if the tile is there afterwards. Newer firmware refuses, and then the browser stays the way
couch-tv opens. Nothing else on the TV is touched.

### 6. Check it

- Switch the TV off and on with its own remote. Within a few seconds couch-tv opens.
- On the phone remote: an arrow, volume, Home (opens couch-tv), then open Netflix or YouTube.
- `http://<bridge>:5400/api/tvs` shows the last few things the hook did and a `vidaa` block: whether the
  connection is up, the last `statetype`, whether a token and a certificate are there, the tile, the
  browser it found, and the last error in plain words.

## What to test first

In this order, because each one needs the one before:

1. `scripts/vidaa-check.py <tv address>` (step 4): does it log in? Paste everything it printed into an
   issue, with the TV's model, the VIDAA version and the firmware string (Settings, Support, About, or
   Settings, System, About), and whether the TV is on Wi-Fi or Ethernet.
2. Pairing (step 4): does the TV show a PIN, and does `--pin` say "Paired"?
3. One key from the phone remote (an arrow), then volume up once, then Home.
4. Switch the TV off and on: does couch-tv open in the browser? If not, `/api/tvs` shows what the hook saw.
5. Open Netflix and YouTube from the phone.
6. Only if you want to: the tile (step 5), and whether it stays after the TV restarts.

## How the hook works

`bridge/vidaa.py` keeps one connection to the TV's MQTT service (port 36669 over TLS) and checks it every
2 seconds. The TV says where it is in a field called `statetype`: `remote_launcher` (VIDAA's home),
`livetv`, `sourceswitch` (an input), `remote_setting` (a settings menu), `fake_sleep_0` (standby) and
`fake_sleep_1` (waking). When the TV goes from off or standby to on, the bridge waits a moment, and if the
TV is on its home or live TV it opens couch-tv: the tile when there is one, else the TV's browser at the
bridge's page. Anything else on screen is left alone. Anything the phone remote or Claude just asked for
also wins: the hook stays quiet for 20 seconds after any command, except a power press, so turning the TV
on from the phone also lands on couch-tv. `"open_on_power_on": false` turns the hook off, and
`"leave_inputs": true` leaves an HDMI input alone.

The page the bridge opens carries a code that works once, for two minutes, never the pairing key: a TV
browser's address bar and history are not private. The page swaps the code for the key once
(`/api/vidaa/claim`) and keeps it in the browser's own storage.

Apps open only from the TV's own app list: the bridge sends back exactly the entry the TV gave it, and
nothing typed on the phone goes into a message unchecked (keys come from a fixed list or the `KEY_` form,
app ids must be in the TV's list, the PIN must be 4 digits).

## What is unconfirmed

These are written once, in `PROTOCOL` and `KEYS` at the top of `bridge/vidaa.py`, so a tester's trace can
correct them in one place:

- The name of the request that asks the TV where it is (`gettvstate`).
- That answers come back on `/remoteapp/mobile/<client>/<service>/data/<name>`.
- That keys go to `remote_service` as `sendkey`, and the key names (`KEY_UP`, `KEY_RETURNS` for Back and so
  on).
- The field the PIN travels in, the field the token comes back in, and that the token is the password on
  later logins.
- Which browser the TV lists, and whether `launchapp` opens the bridge's page in it when given its address.
- Whether the tile, where it installs, survives a firmware update.

## Limits to know

- VIDAA's Home button and home row are VIDAA's. Leaving couch-tv with the Home button is expected.
- No root, ever. A root path for some VIDAA models exists. It is per model, can brick the TV or void its
  warranty, and couch-tv will not use it or explain it.
- Pairing needs the PIN on the TV once, and newer firmware needs the certificate step. It is a set up, not
  a tap.
- Everything here rests on how the TV is known to behave, not on anything Hisense documents. A firmware
  update can break it.

## Undo

1. Take the TV out of `config.json` and restart the bridge.
2. Delete `bridge/data/vidaa-<id>.json` (the token) and `bridge/data/vidaa/` (the certificate).
3. If you added the tile: remove it from the TV's app row the way the TV removes any app.

Nothing else on the TV was changed.
