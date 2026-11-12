# couch-tv on an Apple TV (Beta)

**New, Beta.** The phone remote path is built and works against a stand-in Apple TV on a computer. No real
Apple TV has run it yet, so expect something to need fixing. Please [open an issue](https://github.com/Seagey/couch-tv/issues)
and say how it went (the Apple TV model, tvOS version, what worked and what did not), even if all of it worked.

## What you get, in plain words

| | Apple TV |
|---|---|
| Phone remote: arrows, OK, Back, Play/Pause, Apple's Home, volume keys | Yes, with the bridge running (option B, a computer at home that stays on) |
| Sleep and wake from the phone | Yes |
| Opening an app from the phone (Netflix, YouTube, Disney+, Prime Video, Apple TV and the rest the Apple TV lists) | Yes. The app opens on its own home page: pick the show there, nothing presses Play for you |
| "Put on Bluey" (find and play) | Finds where it streams, opens that app. No deep link into the show |
| couch-tv's home screen on the TV | **Not included yet** (see "The home screen" below) |
| Opening couch-tv by itself when the Apple TV wakes | Yes, once a couch-tv tvOS app exists and is named in `app_id`. Until then nothing opens |
| Replacing or coming before Apple's own home screen | **No, and it cannot be done.** tvOS lets no app replace the home, and couch-tv never jailbreaks anything |
| Typing from the phone, screenshots, what is playing, a volume level | No (see "Limits") |
| More than one TV on one phone remote | Yes, like the Roku and the LG: one bridge, several entries in `config.json` |

It costs nothing: the remote needs no Apple developer account, no app and no payment.

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

## The home screen

tvOS has no web view, so couch-tv's home (a web page on every other TV) cannot simply be shown. An Apple TV
version of the home would be a new native app written in SwiftUI (Apple has deprecated the older TVML
route as of tvOS 18). That app is **not built yet**. What is already in place for it: the bridge opens any
app by its bundle id, so once an app exists, put its bundle id in `app_id` and the bridge opens it
every time the Apple TV wakes (it cannot tell which app is already on screen, so it opens it on every wake
unless a command from the phone has just run).

What installing such an app would cost, for the record:

- **Free:** Xcode with a free Apple ID can put an app on your own Apple TV. The signature lasts **7 days**, then the app stops
  opening until it is signed again. The computer that stays on could redo that weekly (needs a Mac with Xcode
  and the Apple TV reachable over the network). Reports say a free Apple ID is also limited in how many apps
  it can sign at once.
- **Paid:** the Apple Developer Program (US$99 a year) lasts a year per app and allows TestFlight. This is the
  only way to make it a one time install for someone else.

Neither changes the Apple TV's own home: the Home button on its remote still opens Apple's home.

## Limits, plainly

- **No home screen replacement.** Apple's home stays first.
- **Typing from the phone is not supported yet.** Use the on screen keyboard with the arrows.
- **No "what is playing", no volume level, no screenshots.** The Companion link does not give them. (Apple's other
  protocols do carry now playing and volume. That is not built here.) The volume keys send the remote's
  volume buttons, which only change the TV's volume when the Apple TV is set up to control it (HDMI-CEC or learned IR).
- **No deep links** into a show. The app opens on its home.
- **Sleep and wake:** an Apple TV in sleep keeps listening, so wake works. If one has been fully unplugged,
  there is no way to wake it from the network.
- **Parental and HomeKit settings** can limit which devices may control the Apple TV (Settings, AirPlay and
  HomeKit, Allow access). "Anyone on the same network" is the setting that works with this.

## Test status

See [APPLE-TV-TESTING.md](APPLE-TV-TESTING.md) for what was checked and the steps for the first real test.

## Sources

- Apple TV protocol notes (Companion Link, pairing, keys, power, app launch): <https://pyatv.dev/documentation/protocols/>, supported features: <https://pyatv.dev/documentation/supported_features/>
- tvOS has no web view: <https://medium.com/bpxl-craft/apple-tv-a-world-without-webkit-5c428a64a6dd>. TVML deprecated in tvOS 18: <https://developer.apple.com/documentation/tvml.md>
- Free Apple ID signing lasts 7 days, paid account 12 months: <https://9to5mac.com/2016/03/27/how-to-create-free-apple-developer-account-sideload-apps/> and the tutorials around it. Reports of a three app limit on a free ID are from one third party page and not confirmed.
