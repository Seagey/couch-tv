# couch-tv on a Philips TV with Titan OS

**Read this first.**

- **One real Titan OS TV has answered the read only check, and nothing more yet.** A 43PUS8909/12 (2024,
  Germany), not paired: see "The first real TV" below. Everything else here was tested against a pretend
  Philips TV on a computer (`tests/philips_standin.py`). Philips does not publish the newer parts of its
  network remote, so some of it is our best reading, and pairing on a real TV will probably show something
  to fix.
- **Phone remote only, today.** The bridge can drive the TV: power, keys, volume, inputs, opening the TV's
  apps, and the Claude ask on top of those. **couch-tv's home does not open on a Titan OS TV**, because
  Titan OS only runs a web page that is a Titan app, and that needs either a Titan developer account
  (Titan's DevView app) or a couch-tv app in Titan's store. Neither exists yet. "The home" below says
  exactly what is missing and what is already built for it.
- **Mostly Philips TVs sold in Europe.** Titan OS is on Philips TVs from 2023 in Europe (all of the 2026
  range, and many 2023 to 2025 models below the flagships). Philips TVs are not a normal retail item in
  Australia; the only Titan OS model listed for Australia is a hotel TV.

An older Philips that is not Android and not Titan OS (Saphi, about 2015 to 2019)? See
[PHILIPS-SAPHI.md](PHILIPS-SAPHI.md).

Want everything today? Plug a Google TV box (for example the Google TV Streamer) into the TV's HDMI and set
couch-tv up on that.

## Which TVs

Titan OS is made by Titan OS (Barcelona) and launched with Philips in January 2024. Titan's own device
table lists:

| TVs | Where sold | Browser engine |
|---|---|---|
| Philips 2026 (the whole range, OLED included) | Europe, Latin America | Chromium 122 |
| Philips 2025 (most models from the 7000 series up) | Europe, Latin America | Chromium 122 |
| Philips 2023 and 2024 (entry and mid ranges; flagships were Google TV) | Europe | Chrome 112 |
| Philips 2020 to 2022 (older Philips Linux TVs, now with Titan's app layer) | Europe | Chrome 84 |
| JVC 2025, HKC 2025, Sharp 2026 (Europe) | Europe | Chromium 122 |

Sources: [Titan OS device table](https://docs.titanos.tv/platform-versions.md),
[Philips UK: what is Titan OS](https://www.philips.co.uk/c-e/tv-buying-guide/tv-101/what-is-titan-os),
[ChannelNews](https://www.channelnews.com.au/philips-drops-google-tv-for-titan-os-across-2026-range-in-major-platform-shift/),
[9to5Google](https://9to5google.com/2026/03/23/google-tv-just-lost-a-big-tv-brand-to-web-app-based-titan-os/).

The driver speaks Philips's own network remote (JointSpace), so it is for **Philips** TVs. Whether the
JVC, HKC and Sharp Titan OS TVs answer it at all is unknown.

**How to tell.** A Philips with a Google Assistant button and "Android TV OS" under Settings, About is a
Google TV, and the full couch-tv works on it. A Philips with no Google button and a home screen of
"Lifestyle" rows is Titan OS. `scripts/check-tv.py <tv address>` says "Philips Titan OS path" when the TV
answers on port 1926 and is not Android.

## The first real TV

`scripts/philips-check.py` against a 43PUS8909/12 on 12 November 2026, read only and not paired:

- JointSpace answers on https port 1926 under `/6/` (API 6.1.0). Plain port 1925 is open too.
- "system" answers without a login and says `"pairing_type": "digest_auth_pairing"` and `"os_type": "Linux"`.
- "system" lists `"activities": ["browser"]`. So the bridge takes the browser route on this TV
  ([PHILIPS-SAPHI.md](PHILIPS-SAPHI.md)): once paired it will try to open couch-tv's page in the TV's browser
  at power on, unless `"browser_home": false`. **Whether the TV really opens a page is not settled.** Unpaired,
  `POST activities/browser` on 1926 answered 200 with the web page "Ok" (not JSON), but the owner saw nothing
  open on the screen. Paired, it is untested. Plain port 1925 answers 403.
- "system" also lists `"textentry"` and `"inputkey": ["key", "unicode"]`, so typing from the phone may be
  possible. Not built, not tested.
- Without a login, `powerstate`, `audio/volume` and `activities/current` answer 401 (they want the login).
  `sources`, `sources/current` and `applications` answer 403. Whether they answer once paired is unknown.
- Finding it on the network, with the TV on (read only, 12 November 2026). One SSDP search for `ssdp:all`
  got no answer from the TV at all (only the router and one other device replied). Browsing mDNS for every service
  type showed two from the TV: `_philipstv_s_rpc._tcp.local.` on port 1926, instance name `6_43PUS8909/12`
  (the 6 is the API version), and `_secure-mqtt._tcp` under the titanos domain, on port 8883 with `FriendlyName`
  `43PUS8909/12` and a `mqttv_version` of `v2.11.3` (its serial-like `SN` property is left out here). So
  `scripts/find-tvs.py` lists the TV from the `_philipstv_s_rpc` service as "Philips TV". The plain-port
  counterpart (1925) was not seen announcing on this TV, so it is not looked for. Whether other Titan OS Philips
  models announce the same is not verified.

Pairing, keys, volume, inputs, apps and the home are still untested on a real TV.

## What works, and what does not

Tested against the stand in only:

| | |
|---|---|
| Pairing | A PIN shows on the TV once; the login is kept in `bridge/data/` |
| Power | Off to standby, and on again from networked standby. From fully off, Wake on LAN if the TV allows it |
| Keys | Arrows, OK, Back, Home, play and pause, numbers, colour keys, channel up and down, Source |
| Volume | Up, down and mute, and the level (the TV reports it) |
| Inputs | The inputs the TV lists, by name ("HDMI 2") or number, from the phone and the Claude ask |
| Apps | Opens any app the TV lists. Only an app the TV listed is ever sent back to it |
| What is in front | If the TV says (unconfirmed on Titan OS) |

Not possible or not built: couch-tv's home (below), typing from the phone, opening a show inside an app
(apps open on their own page and you pick the show), "what is playing", screenshots, ADB tools.

## The home

Titan OS has no way to replace its home screen, no sideloading, no developer mode switch and, as far as
we found, no web browser app. A web page only runs on the TV as a Titan app. So couch-tv's home can only
open inside a Titan app that shows couch-tv's page, and the bridge then opens that app each time the TV is
switched on, the way the Samsung and LG versions open theirs. (The first real TV does list a "browser"
activity to its network remote, which may be a way round this: "The first real TV" above. Untested.) Searched on 12 November 2026, these are the
routes, closest to "opens by itself at power on" first:

1. **A couch-tv app in Titan's store.** A tile on every Titan OS TV, no account for anyone. Titan reviews
   every app (an intake test and full QA) and agrees terms with each publisher before release
   ([Publishing](https://docs.titanos.tv/publishing.md)); whether it takes a free, open source home
   dashboard is unknown. **Not applied for.**
2. **DevView with one couch-tv developer account.** DevView is Titan's developer app, already on every
   Titan OS TV. A developer adds a page address to their Titan Partner Portal "sandbox", and a TV is paired
   to that account by a code DevView shows on the TV
   ([Testing your app](https://docs.titanos.tv/devviewinstall.md),
   [App testing](https://docs.titanos.tv/partner-portal/app-testing.md)). If one couch-tv account can pair
   many people's TVs, nobody needs their own account. Unknown: whether Titan grants access to an open
   source project, how many TVs one account may pair, whether a home network address is accepted, and
   whether the entry survives a restart. Titan says DevView is "only for your internal testing purposes",
   so this would be a developer route, like LG's Developer Mode. **Not applied for.**
3. **DevView with each person's own developer account.** The same, with an account per person. Works on
   paper; the most effort for the person and the least likely to be granted.

Ruled out, with the reason:

- **Launching a web page over the network** (DIAL, an HbbTV companion launch). Titan's device table lists
  DIAL and SSDP as not supported on Philips 2023 to 2025.
- **A store app that opens any web address** (a browser, a signage or dashboard viewer, a photo frame).
  None found on Titan OS.
- **A "switch on with" setting** that opens a chosen app at power on. None found.
- **The developer debug port** (DevTools on 9222 or 7001 when DevView's debug mode is on). It would let the
  bridge steer the TV's browser, but it is an open door on the person's network. couch-tv will not use it.
- **Rooting.** No public way exists, and couch-tv never roots a TV.

**What is already built for routes 1 to 3**, so a tester can try one the day it is available:

- `titan/index.html`, couch-tv's start page for a Titan app. The bridge serves it at
  `http://<computer>:5400/titan/`. It asks for the bridge's pairing key once with the TV remote (if one
  is set), then opens the home. Hosted anywhere else (a public https address, if Titan will not take a home
  network address), it moves to the bridge given as `?bridge=192.0.2.20:5400`, or asks for it once.
- `"home_app"` in config.json: the name of the app on the TV that shows couch-tv. An app called "Couch TV"
  is used without it. When the TV comes on and nothing else is in front, the bridge opens it; the phone's
  Home opens it too.
- `"home_keys"`: up to six keys pressed after the app opens, one a second. For DevView, the keys that move
  to the couch-tv sandbox entry and open it, for example `["down", "ok"]`.

Without a `home_app` (and no "Couch TV" on the TV), nothing opens at power on, and Home on the phone presses
the TV's own Home.

## Setting it up

You need a computer at home that stays on, running the bridge (README, option B). The short way, with the
bridge stopped:

```sh
.venv/bin/python scripts/philips-setup.py <tv address>
```

It checks the TV answers, stops with an explanation if the pairing key (step 2 below) is not saved, asks before
the TV shows a PIN, pairs, reads power, volume and apps, and prints the entry for `config.json` (it does not
write the file; add `--mac <tv mac>` to have the MAC in it). Not tried on a paired real TV yet. The long way,
step by step:

1. **The TV's address.** Settings, Network (or Wireless and networks), Network status. Give it a fixed
   address in the router if you can.
2. **The pairing key.** Philips TVs only pair with a phone remote that signs the PIN with a key from
   Philips's own TV Remote app. couch-tv does not include it: it is Philips's, not ours to hand out. Take it
   from your own copy of the app (or wherever you trust), then save it on this computer:

   ```sh
   .venv/bin/python scripts/philips-secret.py
   ```

   It goes in `bridge/data/philips/pair-secret`, readable only by you, and git ignores it.
3. **Pair.** With the bridge stopped:

   ```sh
   .venv/bin/python scripts/philips-check.py <tv address> --pair
   ```

   The TV shows a PIN; type it. The login is kept in `bridge/data/philips-<id>.json` (use `--tv <id>` with
   the id you give the TV in config.json). With the bridge running, `POST /api/philips/pair` with `{}` and
   then `{"pin": "1234"}` does the same.
4. **config.json**, in `tvs`:

   ```json
   {"id": "lounge", "name": "Lounge", "kind": "philips", "ip": "<tv address>", "mac": "<tv mac>"}
   ```

5. Start the bridge. `GET /api/tvs` shows a `philips` block: paired, the API version found, power, the app
   in front and any problem in plain words.

| Key | Meaning |
|---|---|
| `kind` | `"philips"` |
| `ip` or `host` | The TV's address |
| `mac` | For Wake on LAN from fully off (only if the TV allows waking over the network) |
| `port` [1926], `tls` [true] | Older Philips TVs: `"saphi": true` ([PHILIPS-SAPHI.md](PHILIPS-SAPHI.md)), or `"port": 1925, "tls": false` |
| `api_version` | Found by itself (`6`, `5`, `1` or none). Set it only if the TV is slow to answer |
| `home_app`, `home_keys` | The home, above. Leave them out for the phone remote only |
| `open_on_power_on` [true] | Open `home_app` when the TV comes on and nothing else is in front |
| `leave_inputs` [false] | An HDMI input in front counts as in use, and is left alone |
| `pair_secret_file` | Somewhere else for the pairing key |
| `trace` [false] | Log every request and answer (PINs and keys hidden), for an issue |

Bridge endpoints, all behind the pairing key: `POST /api/philips/pair`, `GET /api/philips/apps`,
`GET /api/philips/sources`, `POST /api/philips/source {"name": "HDMI 2"}`. `/api/input` and the Claude ask
use the TV's own input list on a Philips.

## What the first tester settles

[PHILIPS-TITAN-TESTING.md](PHILIPS-TITAN-TESTING.md) is the step by step guide. `scripts/philips-check.py`
only reads. It settles:

- whether a Titan OS TV answers JointSpace on 1926, and on which API version
- whether pairing works with our reading of the pairing fields (marked UNCONFIRMED in `bridge/philips.py`)
- what the TV's app list looks like, whether DevView is in it, and what it says is in front with an app
  open and with Titan's home open
- the inputs and the volume

## How it was written

From protocol facts only: the port, the paths, the field names and the pairing steps, as noted in our own
research and Philips's own JointSpace documentation (the key names). No code, comments or layout were taken
from any other project. Philips's pairing key is never in this repository.
