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
| couch-tv home, apps in your order, the remote's arrows and OK | In the TV's browser or a tile. Confirmed on a Hisense 55U7N |
| Opens by itself when the TV is switched on | Yes, with the bridge running |
| VIDAA's own Home button | **Still opens VIDAA's home** unless `keep_home: true` is set (opt in, Beta). Without it that cannot change without rooting the TV, and couch-tv never roots a TV. Press Home on the phone remote to get couch-tv back |
| A Couch TV tile on the app row | Only on firmware that still accepts it (below). Asked for once, from the phone, never by itself |
| Phone remote: keys, volume up and down, mute, open an app | Works |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs, Samsungs, LGs, Rokus and VIDAA TVs together |
| "Put on Bluey" (find and play) | The app opens on its own page and the reply says to pick the show there. No deep link into a show is known on VIDAA |
| Turning the TV on from the phone | From standby: a power key. From fully off: only with Wake on LAN switched on in the TV's network settings |
| Which app is in front, what is playing, a progress bar, screenshots | No. VIDAA does not tell the network any of it |
| Volume level | No: up, down and mute only |
| Typing from the phone | Not built yet |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools, switching the stock home off | No (Android only) |
| Root | **Never.** couch-tv will not root a TV or walk you through it |

## What to expect on older VIDAA firmware (field report, firmware P0218)

(thanks trentosc, #131) On an older Hisense (firmware P0218) the whole path ran: connect, pairing, the phone
remote's keys, the app list, and couch-tv's home showing in the TV Browser, opening itself when the TV is
switched on. What an owner should know before investing an evening:

- **The older TV Browser gives a page a mouse cursor only, never the D pad.** Its engine is a 2014 Firefox
  build, and the page sees mouse moves and clicks, no key presses. So you navigate by pointing and clicking.
- **couch-tv's own settings and app management can't be reached from the couch.** The gear tile needs the D
  pad, and the phone remote's Settings key opens the TV's settings, not couch-tv's. Change the look and the
  apps from a computer or phone instead.
- **Loading is slow.** On switch on you see the browser's bookmark page first, then the dock, then the
  background fills in while the TV's modest hardware catches up.
- **Auto open on power on works through a saved bookmark.** Save couch-tv once as a bookmark in the TV Browser
  (with the `http://` in front, otherwise the browser searches for it). The reported sequence on switch on is
  Home (to leave live TV), open the TV Browser (app id 16), then OK on that bookmark. Firmware that refuses a
  page address (`launchapp` with a URL, a web app, the tile install) needs this route. There is no
  `open_sequence` setting on main yet, so today it is a sequence a tester sends by hand.
- **The Hisense Home button still opens VIDAA's home**, as everywhere on VIDAA.
- **For the full couch-tv experience on a Hisense VIDAA, plug in a Google TV streamer** (for example the
  Google TV Streamer) on HDMI. VIDAA stays as a display and couch-tv runs natively on the streamer.

The newer VIDAA 9 browser (Chromium 111, below) is a different story: there the arrows and OK reach the page.

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

This step needs the Android app. Use an Android phone, or install RemoteNOW from Google Play in an Android
emulator on your computer. There is no iPhone only path yet (thanks trentosc, #131).

1. Get the VIDAA app's installer (`.apk`). From your own Android phone, on a computer with Android's
   platform tools: `adb shell pm list packages | grep -i vidaa` finds the app's name, `adb shell pm path
   <that name>` says where its `.apk` is, and `adb pull <that path>` copies it. (Current RemoteNOW is
   `com.universal.remote.ms`.)
2. Run:

   ```sh
   .venv/bin/python scripts/vidaa-cert.py <the .apk you copied>
   ```

   Current RemoteNOW (5.01.011) keeps the certificate in a binary keystore, not as plain text. The script
   looks for a plain certificate and key first, then for keystore files inside the app (`.p12`, `.pfx`,
   `.bks`, `.jks`, `.keystore`, or a PKCS#12 file by content):

   - A PKCS#12 keystore that opens with no password is written to `bridge/data/vidaa/` (`client.pem` and
     `client.key`), which git ignores.
   - A keystore that needs a password, or a Java one (BKS, JKS), is named, and the script says the
     certificate is in a locked keystore it can't open. It does not unlock anything, decompile or patch the
     app, and it never prints key material. If you get that message, first check whether your TV needs a
     certificate at all (run the first test in step 4: older firmware may not), and whether the `.apk` was
     RemoteNOW (`com.universal.remote.ms`): its `remoteclientmobile.p12` has opened, while another Hisense app
     shipped a locked `client_mobile_android.p12` and `remoteca.bks` (#170). Still stuck: please say so in an
     issue with the file name it printed. That is a gap, not something to work round.

The keystore Hisense's app ships (`remoteclientmobile.p12`) can use legacy PKCS#12 encryption, which the
`cryptography` library in this repo's `.venv` (version 50) refuses to read. If the script says it can't open
the keystore, it tries `openssl pkcs12 -legacy` itself when `openssl` is installed. Failing that, `openssl` 1.1
extracts it by hand (thanks trentosc, #131).

Skip this step on older firmware. The first test (step 4) says whether the TV wants it.

A Hisense set on an older build (firmware P0218) connected once the certificate was in place, using the legacy
login (the static `hisenseservice` one), per trentosc's report in #131. couch-tv tries that login last.

### 3. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "vidaa"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "vidaa", "ip": "<tv address>", "mac": "<tv mac>", "trace": true }
```

- `mac` is for turning the TV on from fully off (leave it out if you do not want that).
- `trace: true` logs every message to and from the TV, with the PIN and every token hidden (any field whose
  name holds token, secret or password, so `refreshtoken` too). Leave it on for the first weeks: it is what
  an issue needs.
- `browser`: the name the TV lists its web browser under, if couch-tv cannot find it by itself (it looks
  for "Browser", "Web Browser" and "Internet").
- `home_url`: the address the TV should open, if the bridge picks the wrong one of this computer's
  addresses (for example `http://192.0.2.20:5400/tv/`).
- `tile_id` (`app.couchtv.home`): the id the Couch TV tile is added under. VIDAA keeps the address a tile
  was **first** added with: adding it again under the same id answers `"tile": true` but the tile still opens
  the old address. To point the tile somewhere new (the standalone home below, or a new bridge address), set a
  new id here (for example `app.couchtv.tv`), add the tile again, and remove the old one from the app row.
- `keep_home` (false): opt in (Beta). When the TV falls back to VIDAA's own home, couch-tv opens again on top. A
  Home press from the phone remote is never bounced, and after the phone remote's Input key it waits up to
  30 seconds, or until a source is picked, so the source picker stays usable. The Input key on the TV's own
  remote is not seen by the bridge: press Home twice to keep VIDAA's home up for a while instead.
- `pointer` (false): opt in. In the TV Browser (not the tile) the arrows move a mouse cursor; with
  `"pointer": true` the page takes that cursor: pointing at a tile moves the focus to it and a click opens it.
- `uuid`: the identity the TV pairs with. It is kept automatically and rarely set by hand.
- `auth_method`: optional override for how the login is worked out, if your firmware needs a different one.
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

The TV shows a 4 digit PIN. Type it in when asked (or run it again with `--pin <the 4 digits>`). The pairing
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
second, and a power on is pushed to it at once. The TV says where it is in a field called `statetype`: `remote_launcher` (VIDAA's home),
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

## No computer: a standalone home

Everything above needs a computer that stays on. Without one, couch-tv's home can still live on the TV
on its own, as a website the Couch TV tile opens. What you keep and what you lose:

| | Standalone home |
|---|---|
| Clock, scenes or your own photos, weather, Home settings | Yes. Settings are kept in the TV's own storage |
| Now playing (Spotify) and **Play on TV** | Yes, on Vercel, with the Spotify functions below |
| The dock opening apps | **No**: a page on a VIDAA TV cannot open other apps (see below). Use the remote's app keys or VIDAA's home |
| couch-tv opening at power on, and Home bringing it back | **No**: that is the bridge's watch. See "One press back" below |
| Phone remote, Keep watching, the assistant | No (they are the bridge) |

1. Build it: `scripts/build-standalone.sh` (it writes `build/standalone`: the page, your `config.json`
   settings as `config.js` with the standalone switch on, the Spotify functions, a `noindex` header and
   the tile's icon).
2. Put it on a host. Vercel's free plan runs the Spotify functions too:
   `cd build/standalone && npx vercel deploy --prod`. Any static host serves the page without them.
   The address is public to anyone who has it (search engines are told to skip it), and the site carries
   your own photos from `backgrounds/mine` if you have any, your people's names, and for a kids profile
   the kids PIN's hash (the page checks the PIN itself), so use a kids PIN you use nowhere else. The
   weather's place goes in rounded to about a kilometre. The script only builds into a new or empty
   folder, or over an earlier build.
3. Point the tile at it, once, from any computer with the bridge set up: set `home_url` to the site's
   address and a new `tile_id` (above), restart the bridge, `POST /api/vidaa/tile`. From then on the tile
   opens the site and the computer can stay off. With Spotify (below), put the site key in the address:
   `https://<your site>/?sk=<the key>`.

### Spotify on the standalone home (optional)

A TV remote can't type a Spotify password, so the login lives on the site, not the TV:

1. developer.spotify.com, Dashboard, Create app (Web API), Redirect URI `https://<your site>/api/callback`.
   Spotify needs the app owner on Premium for apps in Development Mode, and Play on TV needs Premium.
2. On the host, add the environment variables `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and
   `COUCH_SITE_KEY` (16 to 128 letters, digits, `-` or `_`, for example from `openssl rand -hex 24`), and
   deploy. What's playing, the player's token and moving playback only answer a page opened with
   `?sk=<the key>`, which is the tile's address. Without a site key they answer nobody, so the card stays
   empty until it is set.
3. On a phone or computer open `https://<your site>/api/login`, sign in, and copy the code it shows into a
   third variable, `SPOTIFY_REFRESH_TOKEN`. Deploy once more.

The Now playing card then shows what's playing on the account, on any device. Its **Play on TV** button
moves it to the TV: first the page itself becomes a Spotify speaker called "Couch TV" (Spotify's Web
Playback SDK; this works on a 55U7N on VIDAA 9), and if a TV's browser can't do that, the TV's Spotify app
opens and the music is moved to it as soon as it shows up (that wait needs a function time limit over 25 s:
`vercel.json` asks for 40, which Vercel's fluid compute, on by default for new projects, allows on the free
plan).

With the bridge instead, Spotify fills the same card for a song the TV's own media sessions can't see (a
VIDAA, LG, Samsung or Roku, or music on a phone): a Spotify app with the Redirect URI
`http://127.0.0.1:5400/api/spotify/callback`, its Client ID in `.env` as `SPOTIFY_CLIENT_ID` (no secret: the
bridge uses PKCE), then `http://127.0.0.1:5400/api/spotify/login` on the bridge computer once
(`bridge/spotify_now.py`). The card
shows it without media buttons, since the TV's keys don't reach a phone.

### One press back to couch-tv, without a computer

- Many VIDAA remotes have a favourite key (a heart with a plus, ♡+, next to VIDAA Channels on a 2025
  remote). Press and hold it, pick **Couch TV**, Save: one press then opens couch-tv from anywhere.
- Settings, System, Advanced Settings, **Default Startup Page**: Last Accessed Source or Home. Whether
  "Last Accessed Source" brings an app back at power on is not confirmed yet.
- Put the Couch TV tile first in VIDAA's app row (Edit at the end of the row).

### What a VIDAA TV's browser can do

Measured on a 55U7N, VIDAA 9, build Q0705, from a page the tile opened:

- Chromium 111 ("Odin"), drawing 1920x1080 at a pixel ratio of 1 on a 4K panel: 4K pictures only cost
  memory there. No service worker. `backdrop-filter` works. `localStorage` works.
- Spotify's Web Playback SDK plays (so the browser has the DRM it needs).
- **No page can open another app.** The browser has `Hisense_Get*` getters, an OIPF object factory, and
  `window.vowOS`, a local service at `https://localhost:9888/service/<module>` (`pkgmgr`, `hiutils`,
  `tvinfo`) that the app store uses. It checks the calling app's identity natively (appconfig), so an
  ordinary page gets read only answers; there is no launch call, and couch-tv does not try to get round
  that. The TV's DIAL server (`:3366/dd.xml`, apps on `:3367`) launches Netflix and Prime Video for a
  phone, but a page in the TV's browser can't reach it. Opening apps stays the bridge's job (MQTT).
- Web apps that VIDAA itself runs as hosted pages (Disney+, Spotify's TV app) can be opened by going to
  their address from the page, inside the tile.

## What still stands

This path was confirmed on a Hisense 55U7N, VIDAA 9, build Q0705, by Matthew Klette (#128). Two things still
depend on your TV:

- Which browser name the TV lists, so couch-tv can match it (set `browser` if it cannot).
- The native Couch TV tile is only confirmed on newer firmware. Older builds may or may not take it.

The protocol details are written once, in `PROTOCOL` and `KEYS` at the top of `bridge/vidaa.py`, so a
tester's trace can correct them in one place.

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
2. Delete `bridge/data/vidaa-<id>.json` (the pairing) and `bridge/data/vidaa/` (the certificate).
3. If you added the tile: remove it from the TV's app row the way the TV removes any app.

Nothing else on the TV was changed.
