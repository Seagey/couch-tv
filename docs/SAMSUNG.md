# couch-tv on a Samsung TV

Samsung TVs run Tizen, not Android, and Samsung does not let any app replace its home screen. So
couch-tv on a Samsung is **an app that opens itself, not a true home screen**:

- **The couch-tv app** (`samsung/`): the same TV home as on Google TV (scenes, clock, weather,
  your apps in your order, Keep watching), packed as a Samsung app. Its tiles open the Samsung
  versions of Netflix, YouTube and the rest. You install it yourself with a free tool.
- **The hook** (`bridge/samsung.py`): the bridge (option B, a computer that stays on) watches the
  TV. Each time the TV is switched on and nothing else is on screen, it opens couch-tv within a few
  seconds. So the TV "looks for" couch-tv every time it comes on.
- **The phone remote and the Claude ask** work against the Samsung through the same bridge.

It needs a computer at home that stays on (option B). Without one you can still install the app
and open it from Samsung's app row, but nothing opens it for you.

## Test status

Built in October 2026 and tested so far on a 2021 Samsung Frame (Tizen 6.0) and against a stand-in
TV on the computer:

- **On the real TV:** the bridge reads power, Art Mode, the volume and which app is on screen; it
  found 16 of the apps in `bridge/apps.py` by their Samsung ids; the remote connects with a stored
  token; DIAL answers for Netflix and YouTube.
- **On the stand-in:** the hook opens couch-tv 2 to 3 seconds after the TV comes on and stays out
  of the way when a command is running; keys, volume, opening apps, Home, a YouTube link and
  "play Stranger Things" (DIAL into Netflix) all reach the TV as the real one expects them.
- **In a browser, with Tizen's calls stood in:** the app starts, lists the TV's apps with their
  logos, moves with the arrows and opens the focused app with OK.
- **On the real TV, 27 October 2026 (TV muted):** the app installed in 6 seconds with a Samsung
  certificate and opened; it listed the TV's 23 store apps, with the usual ones first in the dock;
  arrows and OK sent from the bridge moved round it and opened Netflix and YouTube; Home from the
  phone brought it back; pressing power to leave Art Mode made the hook open couch-tv about 7
  seconds later. The TV accepted the Netflix and YouTube title links (DIAL answered 201 and 200),
  but nobody was watching the screen, so whether the title itself came up is not yet seen.
- **Opening apps** goes through the TV's REST call: this Frame ignored the remote's
  `ed.apps.launch`, for store apps and for couch-tv alike, while taking keys on that channel.
- **Wake-on-LAN** did not wake the test Frame from its "room is empty" sleep over Wi-Fi.
- **On the real TV, 29 October 2026 (TV muted, someone watching):** asked in plain words for "that
  show that has a lawyer and the lawyer never went to university", the assistant found Suits on
  Netflix and it started playing by itself, about 13 seconds after the ask. Netflix's link lands on
  the show's card: one OK opens it full screen, a second OK plays. Prime Video was handed No Time to
  Die through the couch-tv app and came up in 9 seconds; it was not signed in, so the title page is
  not yet seen. Turning the TV off and on from the phone opened couch-tv about 6 seconds later.
  Mute from the phone works (over UPnP: this Frame ignores the remote's mute key). The TV home
  needed one fix for the Frame's older browser (no `inset` in CSS), which showed no photos and two
  clocks before it.

## What works and what does not

| | Samsung |
|---|---|
| couch-tv home as an app, apps in your order, the remote's arrows, OK and Back | Yes |
| Opens by itself when the TV is switched on | Yes, with the bridge running |
| Samsung's own Home button | Still opens Samsung's menu. Press Back or open couch-tv from the app row |
| Phone remote: keys, volume, mute, open an app | Yes (the TV asks to Allow the remote once). Mute goes over UPnP |
| More than one TV on one phone remote | Yes: one bridge runs Google TVs and Samsungs together (several entries in `config.json`), the remote's TV menu switches between them |
| "Put on Bluey" (find and play) | Netflix: opens the show and presses Play (tested). YouTube: opens the video. Prime Video, Stan, Binge, Paramount+, Apple TV: the couch-tv app hands them the title, then Play is pressed by timing (Prime seen opening, the title page not yet confirmed). Disney+ and others: open on their home page and the reply says to pick the show there |
| "Who's watching?" in an app | OK is pressed, which takes the highlighted profile (usually the first). It cannot pick yours by name: Samsung gives no way to read the screen |
| Typing into the TV from the phone | Only while the TV shows its own keyboard |
| Turning the TV on from the phone | Only if the TV allows it over the network (see "Turning it on") |
| What is playing, a progress bar, screenshots, the Claude ask's "look at the screen" | No. Samsung gives none of these to the network remote |
| Keep watching | From couch-tv's own history only (what you started through couch-tv) |
| Picture mode switch, ADB tools, re-disabling the stock home | No (Android only) |

Frame TVs: "off" from the phone, the sleep timer and a short press of power go to **Art Mode**, as
the Frame's own remote does. The hook treats Art Mode as off, so leaving Art Mode counts as
switching the TV on.

## Before you start

- The bridge running on a computer that stays on (README, option B).
- The free **Apps2Samsung** tool: its command line, `apps2samsung-cli` (version 3, comes with the
  desktop app). It installs a `.wgt` app and signs it with **your own** Samsung certificate.
  Samsung's own Tizen Studio does the same job if you already have it.
- A Samsung account (the one you may already use on the TV is fine). You sign in once, in a browser
  on the computer. The tool turns that sign-in into a certificate made for your TV only. Nobody
  else sees the password, and couch-tv never touches it.

## Set it up

### 1. Developer Mode on the TV

1. On the TV open **Apps** (the app store).
2. Press **1 2 3 4 5** on the remote. If your remote has no number buttons, use the on-screen
   number pad that some models show, or the phone remote's number keys once the bridge is paired.
3. Switch **Developer mode** to **On** and type the **IP address of the computer** that will
   install the app (the bridge computer). Press OK.
4. **Restart the TV**: hold the power button until the TV switches off and on again (a short press
   only sends it to standby or Art Mode).

Check from the computer:

```sh
apps2samsung-cli tv <tv address>
```

It should say "ready", Developer mode on, and your computer's address as the host.

### 2. Build the app

```sh
.venv/bin/python samsung/build.py --bridge http://<bridge computer's address>:5400
```

Use the computer's number address (for example `http://192.0.2.20:5400`), not its `.local` name:
the TV looks the name up only now and then and can miss it. With more than one TV in
`config.json`, add `--tv <id>` for this TV. This makes
`build/samsung/CouchTV.wgt`. It holds the TV home, the app ids for Samsung, and a copy of your
settings for when the computer is off. No passwords or keys go in it.

### 3. Install it (the Samsung sign-in happens here, once)

```sh
apps2samsung-cli install build/samsung/CouchTV.wgt --tv <tv address>
```

The first time, a browser opens for the Samsung account sign-in. After that the certificate is kept
on the computer and later installs need nothing. The app appears on the TV's app row as
**Couch TV** and opens.

### 4. Tell the bridge about the TV

In `config.json`, add the TV with `"kind": "samsung"`:

```json
{ "id": "lounge", "name": "Lounge", "kind": "samsung", "ip": "<tv address>", "mac": "<tv mac>" }
```

`mac` is the TV's network (MAC) address: Settings, General, Network, Network Status, IP Settings,
or the Wi-Fi MAC that `http://<tv address>:8001/api/v2/` prints. Restart the bridge.

### 5. Allow the remote (someone at the TV, once)

The first key sent from the phone (or the hook's first "open couch-tv") makes the TV show
**"Allow Couch TV bridge to connect?"**. Press **Allow**. The TV gives the bridge a token, kept in
`bridge/data/samsung-<id>-token.txt`, and never asks again. If you pressed Deny by mistake: Settings,
General, External Device Manager, Device Connection Manager, Device List, and allow it there.

Reading the TV (power, which app is open, the volume) needs no Allow. Keys and opening apps do.

### 6. Check it

- Switch the TV off and on with its own remote. Within a few seconds couch-tv opens.
- Arrows and OK move around and open an app. Back inside couch-tv goes back to the start.
- On the phone remote: volume, Home (opens couch-tv), and "put on" a YouTube video or a Netflix show.

## How the hook works

`bridge/samsung.py` asks the TV every 2 seconds, on its own network ports, which need no pairing:

- `http://<tv>:8001/api/v2/` gives the power state (`on` or `standby`).
- `http://<tv>:8001/api/v2/applications/<app id>` says whether that app is on screen. Samsung
  removed the call that lists every app, so the bridge asks about each app it knows
  (`TIZEN` in `bridge/apps.py`) every 30 minutes and remembers which are installed.
- A Frame also keeps the art channel open, which says when Art Mode goes on and off.

When the TV goes from off (or Art Mode) to on, the bridge waits a moment, and if no app is on
screen (the TV is on live TV, an HDMI input or Samsung's menu) it opens couch-tv with the TV's REST call
(`POST http://<tv>:8001/api/v2/applications/<app id>`; the remote's `ed.apps.launch` is the fallback). If the TV came back straight into an app (some TVs reopen the last app),
it is left alone. Anything the phone remote or Claude just asked for also wins: the hook stays quiet
for 20 seconds after any command, except a power press, so turning the TV on from the phone also
lands on couch-tv. `"open_on_power_on": false` in `config.json` turns the hook off.

Netflix and YouTube titles open through DIAL (port 8080, the protocol phones use to cast), which
needs no pairing.

Other apps take a title the way Samsung's own Universal Guide gives one: an app id plus
`action_data` (Prime Video a `gti`, Stan a `guid`, Binge an `EventId`, Paramount+ a URL). JustWatch
lists these for each title (`deeplinkURL(platform: TIZENOS)`, `bridge/finder.py`). A 2021 Frame
ignores them over the network remote, but an app on the TV may pass them on: the couch-tv app
collects the job from the bridge (`/api/tizen/next`) and calls `tizen.application.launchAppControl`
with the operation `http://samsung.com/appcontrol/operation/eden_resume` and
`PAYLOAD = {"values": <action_data>}`. The couch-tv app only runs while it is on screen, so the
bridge brings it forward first. Then it presses OK by timing (`BLIND` in `bridge/samsung.py`):
on a fresh start once for the profile screen, then for Play. Only Netflix's timing has been checked
on a real TV; if an app ends up on the show's page without playing, press OK.

## Turning it on

When a Samsung is properly off it leaves the network, and only a Wake-on-LAN packet can reach it,
and only if the TV allows it: Settings, General, Network, Expert Settings, **Power On with Mobile**
(or IP Remote / Network Standby, depending on the year). On Wi-Fi this is unreliable on some
models; a cable is more reliable. If it does not wake, the phone says so and you use the TV's
remote. A Frame in Art Mode is still on the network, so "on" from the phone always works there.

## Limits to know

- Samsung's Home button and the app row are Samsung's. couch-tv cannot hide Samsung's ads or menu.
- **Developer Mode can switch itself off** after a firmware update, and some updates remove
  sideloaded apps. Then turn Developer Mode on again and rerun step 3. Your settings live on the
  bridge, so nothing is lost.
- The certificate is valid for a year. After that, rerun step 3 with `--force-login` (one more
  sign-in).
- App ids differ between TV years. The ones in `bridge/apps.py` were checked on a 2021 model in
  Australia. If an app does not open, find its id on your TV:
  `apps2samsung-cli installed --tv <tv address>`, and add it to that app's `ids`.

## Undo

1. Remove the app: `apps2samsung-cli uninstall CouchTVApp --tv <tv address>`. Some TVs keep the
   tile after this. Then delete it on the TV: Apps, Settings (the cog), pick Couch TV, Delete.
2. Developer Mode off: Apps, **1 2 3 4 5**, Developer mode **Off**, restart the TV.
3. Take the TV out of `config.json` and restart the bridge. To also remove the remote's
   permission: Settings, General, External Device Manager, Device Connection Manager, Device List,
   delete "Couch TV bridge".

Nothing else on the TV was changed.
