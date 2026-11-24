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

Opening by itself at every switch-on and the phone remote need a computer at home that stays on
(option B). Without one you still get the app, couch-tv Studio designs and, with Samsung's
**Autorun Last App** setting, couch-tv back on screen when the TV comes on.

## The quick way: no AI agent, no paid plan

Every release from 0.13.4 carries two Samsung files on
[the Releases page](https://github.com/Seagey/couch-tv/releases):

- **`couch-tv-samsung-setup.zip`**: the app, a double-click installer for Mac (`Install on
  Mac.command`) and Windows (`Install on Windows.cmd`), and `START HERE.txt` with every step in plain
  words. About 30 minutes, free. This is the route for anyone without an AI agent.
- **`couch-tv-samsung.wgt`**: the app on its own, for Apps2Samsung or Tizen Studio.

The installer finds the TV, shows this computer's address (the one to type on the TV), checks
Developer mode and says what to fix, then signs and installs the app with Apps2Samsung's command line
tool (a pinned version, checked against its SHA-256 before it runs; it downloads it once). The
Samsung sign-in happens on Samsung's own page in the browser. Running it again with a newer download
updates couch-tv and keeps its settings, a bridge included (`samsung/app/kept.js`).

What each TV prompt means, in order:

1. **Developer mode** (Apps, then 1 2 3 4 5). On a remote with no number buttons (The Frame and most
   2021 and newer), press the **123** button (on some, four coloured dots) for numbers on screen, or
   use the remote in the free **SmartThings** phone app, which has a 123 pad. 2022 and newer: if
   nothing happens, Apps, App Settings (at the bottom), then 1 2 3 4 5.
2. **Host PC IP**: the computer's address, which the installer prints. To find it yourself:
   Mac, System Settings, Wi-Fi, Details (next to the network), TCP/IP, "IP address"; Windows,
   Settings, Network & internet, Wi-Fi (or Ethernet), the network's Properties, "IPv4 address".
   Type each group as it is (1, not 001).
3. **Restart**: hold power about 5 seconds until the TV goes off and on (on a Frame a short press
   is only Art Mode).
4. **The Samsung account page** in the computer's browser: sign in, and agree or allow if Samsung
   asks. It makes a certificate for this TV only.
5. **"Allow Couch TV bridge to connect?"** only appears later, if a bridge is set up (step 5 below).

**"No TV was found" or "The TV is not ready yet".** The first reason is the TV being off or asleep: switch
the TV on with its remote first (on The Frame, a short press: it falls asleep from Art Mode by itself and
cannot be woken over the network). To keep it reachable: Settings, General, Network, Expert Settings,
Power On with Mobile, On. Then Developer mode, the Host PC IP and the restart above.

The AI agent route (paste "Set this up on my TV: github.com/Seagey/couch-tv" into Claude Code or
another agent) is still there for the bridge; it is an option, never needed for the app.

**Apps2Samsung as a tool on its own.** Free and open source (GPL-3.0 from 3.3; MIT up to 3.2.1),
about 2,700 stars on GitHub, releases with SHA-256 digests for every file, and the Samsung sign-in
goes to Samsung's own page (a localhost callback), so it never holds the password. It is a community
project, not Samsung's, and its Mac and Windows builds are not from an identified developer, so the
first open needs Open Anyway (Mac) or More info, Run anyway (Windows). Suitable for beginners as an
alternative to our installer: install the desktop app from
[its releases](https://github.com/Apps2Samsung/Apps2Samsung/releases) (`-macos-arm64.dmg`,
`-macos-x64.dmg`, `-win-x64.msi`), open it, pick the TV, choose **your own .wgt**, pick
`couch-tv-samsung.wgt`, press Install, and sign in when it asks. Samsung's own Tizen Studio does the
same job and is the route if you would rather not use a community tool.

**How it updates.** A Samsung app cannot update itself: only a computer can put an app on the TV.
The app asks GitHub once a day whether a newer release with a Samsung file is out
(`samsung/app/update.js`, nothing about the TV is sent) and, if so, says on the home for 25 seconds:
run the Samsung setup again. Nothing installs by itself. Home settings, About shows the version on
the TV and an **Update couch-tv** row with the same steps and Check for updates now; switching off
Tell me about new versions stops the daily look and the note.

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
- **On a real 2016 TV, 22 November 2026 (UN40KU6290, Tizen 2.4, US, app only, Classic look):** its
  browser (WebKit 538) has no `Promise`, `fetch` or `Object.assign`, no CSS custom properties and
  only `-webkit-` flexbox and transforms, so the home was a black screen with "Keep watching" in a
  corner, then (with the first two fixed) every app piled down the left edge. Four things made it
  work, none of which change anything on a TV that already understood the page:
  - `samsung/app/tizen.js` fills in the missing library calls (`Object.assign`, `Array.from`,
    `Promise`, `fetch` over XMLHttpRequest and the like) only where the TV lacks them.
  - `samsung/build.py` (`legacy_css`) puts a copy the old engine understands in front of each CSS
    declaration that needs it: custom properties written out from their first definition,
    `-webkit-` prefixes, `display: -webkit-flex`. A newer engine takes the original, which comes
    last.
  - This TV will not hand another app's icon file (`file:///opt/usr/apps/...`) to couch-tv, so a
    tile whose picture fails shows the app's name instead, and on `html.old-engine` the Settings and
    More apps line icons (inline SVG, which it did not draw) become pictures of the same drawing.
  - It lists Netflix as `RN1MCdNq8t.Netflix` and Prime Video as `evKhCgZelL.AmazonIgnitionLauncher2`
    (`bridge/apps.py`), so both get their logos and Netflix shows once.

  Then the home, the apps and Netflix opened quickly. Not tried on it: the bridge, the Night scenes
  and the phone remote. Netflix ignores Back on its profile page, so Home, Couch TV is the way back.

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
the Frame's own remote does. The bridge never holds power, so a Frame is never switched fully off
from the phone. The hook treats Art Mode as off, so leaving Art Mode counts as switching the TV on.
It waits until the TV says twice in a row (within 15 seconds) that it is on and out of Art Mode,
then opens couch-tv (`bridge/samsung_frame.py`). A Frame leaving Art Mode can say "standby" for a
moment on its way to the picture; one whose Art Mode sleep timer ran out says "standby" and stays.
The first is opened, the second left alone ("Art Mode ended and the TV went to sleep, left alone"),
and the second does not use up the hook for the next real switch-on.

## Before you start

- The bridge running on a computer that stays on (README, option B). The app-only build
  (`samsung/build.py` with no `--bridge`) needs no bridge. The bridge needs Python 3.11 or newer;
  building the app alone ran on Python 3.9 (reported on an M1 Mac with the Mac's own Python).
- The free **Apps2Samsung** tool: its command line, `apps2samsung-cli` (version 3, comes with the
  desktop app). It installs a `.wgt` app and signs it with **your own** Samsung certificate.
  Samsung's own Tizen Studio does the same job if you already have it.
- A Samsung account (the one you may already use on the TV is fine). You sign in once, in a browser
  on the computer. The tool turns that sign-in into a certificate made for your TV only. Nobody
  else sees the password, and couch-tv never touches it.

## Set it up

### 1. Developer Mode on the TV

1. On the TV open **Apps** (the app store).
2. Press **1 2 3 4 5** on the remote. If your remote has no number buttons, press its **123**
   button (or the four coloured dots) for the on-screen number pad, or use the 123 pad of the remote
   in Samsung's free SmartThings phone app, or the phone remote's number keys once the bridge is
   paired.
3. Switch **Developer mode** to **On** and type the **IP address of the computer** that will
   install the app (the bridge computer). Press OK.
4. **Restart the TV**: hold the power button until the TV switches off and on again (a short press
   only sends it to standby or Art Mode).

**2022 and newer (the One UI home):** typing 12345 on the Apps screen may do nothing. Scroll to the bottom of
the Apps tab and open **App Settings**: the code box opens from there (reported on a 2022 Q60B, #53).

**The Frame's slim remote has no number keys, and 12345 on it did nothing on a 2025 Frame.** The
on-screen number pad on the Apps screen did not open the Developer Mode box either. What worked
(reported by retr04ctive on a 2025 Frame, QN65LS03F, Tizen 9.0):

1. Do "Tell the bridge about the TV" (further down) first: add the TV to `config.json` with `"open_on_power_on": false` (so the hook
   does not fight you), and restart the bridge.
2. Open **Apps** on the TV. From the computer, send the keys through the bridge, one at a time:
   `curl -X POST http://<bridge computer's address>:5400/api/key -H 'Content-Type: application/json' -d '{"key":"1","tv":"<tv id>"}'`
   then `2`, `3`, `4`, `5` (the bridge already knows the digit keys). Leave off `"tv"` if there is one TV.
3. The first keys are eaten by the "Allow Couch TV bridge to connect?" prompt ("Allow the remote", below). Press
   **Allow** on the TV, then send 1 to 5 again.

**A 2025 Samsung OLED (S85F, Tizen 9.0), reported by Thesaudidrifter.** Four things differ:

- On the 2025 UI, **Apps** is in the side menu, and the app store page is what takes the code.
- Number keys sent through the bridge reached the TV (they typed into the Apps search box) but did
  not open the Developer Mode box. Type the code by hand.
- In the Developer Mode box, type the computer's address **without leading zeros**: type each
  group as it is (a group of "1" is just 1) and press Right to move to the next. Padding the groups
  with zeros (001 for 1) is saved padded, which the TV does not treat as the host, and
  `apps2samsung-cli` stops with "IP Mismatch" or "Connection reset by peer". To check what was
  stored, open `http://<tv address>:8001/api/v2/` and read `developerIP`.
- `POST /api/text` does not type into that field (it does type into the Apps search box).

**"Developer Mode looks right but the TV's install service is not running yet"** (the install port,
26101, stays closed after enabling Developer Mode, a hold power restart or a one minute unplug).
What fixed it on that Frame: Settings, Support, **Software Update**, then another one minute
unplug of the power cable. After that `apps2samsung-cli tv <tv address>` said ready.

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
on the computer and later installs need nothing.

**Bridge computer with no screen or browser (a headless server or VM)?** `apps2samsung-cli cert
--prepare` prints a sign-in URL that ends at `http://localhost:4794/signin/callback`, on the bridge
computer. From the computer you are sitting at, run `ssh -L 4794:localhost:4794 <bridge computer>`,
leave it open, and open the printed URL in your own browser. The callback then reaches the bridge
computer and the certificate is made there. The app appears on the TV's app row as
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

Before couch-tv is installed, the bridge's `"home"` key cannot be used to bring up the prompt,
because it opens couch-tv. Send `smart_hub` instead (Samsung's KEY_HOME). If the first attempt
says "Connection reset by peer" on port 8002, try again and the prompt shows.

### 6. Check it

- Switch the TV off and on with its own remote. Within a few seconds couch-tv opens.
- Arrows and OK move around and open an app. Back inside couch-tv goes back to the start.
- On the phone remote: volume, Home (opens couch-tv), and "put on" a YouTube video or a Netflix show.

## How the hook works

`bridge/samsung.py` asks the TV every 2 seconds, on its own network ports, which need no pairing:

- `http://<tv>:8001/api/v2/` gives the power state (`on` or `standby`). This is the only thing read
  on a timer.
- `http://<tv>:8001/api/v2/applications/<app id>` says whether that app is on screen. Samsung
  removed the call that lists every app, so the bridge asks about each app it knows
  (`TIZEN` in `bridge/apps.py`) every 30 minutes and remembers which are installed. Which app is
  in front is read only when something needs it: the hook, a launch waiting for its app, or a
  title being opened.
- The volume and mute (UPnP, port 9197) are read once when the bridge first sees the TV on, and
  once after each volume or mute key.
- A Frame also keeps the art channel open, which says when Art Mode goes on and off.

**Why nothing else is on a timer (#53, reported on a 2022 Q60B).** Reading the volume every few
seconds, and asking about every installed app every other tick (about ten requests every 4
seconds), made that TV flash its volume bar and blip mute every 5 to 10 minutes. With the bridge off
for 30 minutes there were none, and with only the power read running for 32 minutes there were
none. What this costs: the phone remote's live "what's on" line on a Samsung (the app in front) is
now only as fresh as the last time something asked, and it is blank when that was more than 30
seconds ago. It was not reliable before either (some apps never report that they are on screen).
Volume changed with the TV's own remote shows on the phone after the next volume key from the phone.

When the TV goes from off (or Art Mode) to on, the bridge waits a moment, and if no app is on
screen (the TV is on live TV, an HDMI input or Samsung's menu) it opens couch-tv with the TV's REST call
(`POST http://<tv>:8001/api/v2/applications/<app id>`; the remote's `ed.apps.launch` is the fallback). If the TV came back straight into an app (some TVs reopen the last app),
it is left alone. Anything the phone remote or Claude just asked for also wins: the hook stays quiet
for 20 seconds after any command, except a power press, so turning the TV on from the phone also
lands on couch-tv. `"open_on_power_on": false` in `config.json` turns the hook off.

The REST launch is tried up to three times, a second apart, because the first call just after
power on can fail with "Server disconnected". The log then says whether couch-tv really came
forward a few seconds later. A very quick off and on can go unseen: the TV may never report
`standby`, so the hook has nothing to react to. A real standby (the TV leaves the network a few
seconds after power off) is seen.

**With no computer on at all:** Samsung's **Autorun Last App** setting reopens couch-tv when the TV
comes on, if couch-tv was the last app used (reported by philehaynes on a 2023 CU8500, Tizen 9.0).

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

## couch-tv Studio on a Samsung

The Samsung app carries the same couch-tv Studio as the Android home (from 0.13.4): in couch-tv,
the gear tile (Home settings), **couch-tv Studio**, **Get a design**. OK on the box opens
Samsung's on-screen keyboard: type the code from the phone's Send sheet with the arrows and OK
(The Frame's remote needs no number keys for this), then Done. Or, with a bridge, open the
keyboard and type the code from the phone remote's **Type on the TV**. **Open this home in
couch-tv Studio** shows a QR code for the phone. The TV asks the design store itself, so this works
with no bridge too.

Tested on a 2021 Frame, 19 November 2026: the code went in through the phone path (the bridge's
`/api/text` into Samsung's keyboard), the "Use this design?" question came up, and Use this design
put the design on the home. Two Samsung fixes came out of that test, both in `samsung/app`:
Samsung's keyboard reports Done as key 65376, not Enter, so `tizen.js` turns Done in a text box into
Enter (the code was never sent before); and a design's page policy refused the bridge, because on a
Samsung the page is a file on the TV and the bridge another computer on plain http, so
`tizen-policy.js` adds this TV's own bridge (and nothing else) to it.

## Building a release

`.venv/bin/python samsung/build.py --release` makes `build/samsung/couch-tv-samsung.wgt` and
`build/samsung/couch-tv-samsung-setup.zip` from `config.example.json` (never this computer's
`config.json`), with no bridge and no key. Attach both to the GitHub release: the app's update note
only counts a release that carries one of them. The app's version is the TV home's `versionName`.

## A Sky box on an HDMI input

Add the port to this TV's entry in `config.json`, then rebuild and reinstall the app:

```json
{ "id": "lounge", "name": "Lounge", "kind": "samsung", "ip": "<tv address>", "sky_hdmi": 2 }
```

A Sky tile then comes first in the dock. OK shows that input full screen, in front of couch-tv. The
Sky remote talks to the box as usual, and Back on the Samsung remote returns to couch-tv. Turning
the TV off and on comes back to couch-tv when Autorun Last App is on, because couch-tv is still the
last app. Without `sky_hdmi` there is no tile. Tested on a 2023 CU8500 (Tizen 9.0) with a Sky Q Mini
on HDMI 2, reported by philehaynes.

## Turning it on

When a Samsung is properly off it leaves the network, and only a Wake-on-LAN packet can reach it,
and only if the TV allows it: Settings, General, Network, Expert Settings, **Power On with Mobile**
(or IP Remote / Network Standby, depending on the year). On Wi-Fi this is unreliable on some
models; a cable is more reliable. If it does not wake, the phone says so and you use the TV's
remote. A Frame in Art Mode is still on the network, so "on" from the phone always works there.

The bridge learns the TV's MAC address from the TV itself (its Wi-Fi MAC on port 8001) the first time
it sees it on, and keeps it in `bridge/data/samsung-<id>-mac.txt`, so `"mac"` in `config.json` is
optional. With no address to wake, or no answer 14 seconds after the first wake packet, the phone is
told at once: "turn it on with its remote". It never waits half a minute.

## Limits to know

- Samsung's Home button and the app row are Samsung's. couch-tv cannot hide Samsung's ads or menu.
- **Developer Mode can switch itself off** after a firmware update, and some updates remove
  sideloaded apps. Then turn Developer Mode on again and rerun step 3 (or the Samsung setup from
  the release). Your settings live on the bridge, so nothing is lost.
- **No self-update.** See "How it updates" above: the TV says when a new release is out, and the
  setup is run again.
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
