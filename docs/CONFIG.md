# config.json, every setting

Copy `config.example.json` to `config.json` in the repo root and edit it. `config.json` is in
`.gitignore`: it never gets committed. The bridge reads it once when it starts, so restart the
bridge after an edit. The TV home gets the parts it needs from the bridge (`/tv/config.js`) and
keeps a copy for when the computer is off. With no bridge (option A), `tv-home/tools/apply.sh`
hands the same parts to the app on the TV when it installs it, so run `apply.sh` again after you
change people, weather, the look or the quick buttons.

Every key below is optional unless it says otherwise. Leave a key out and you get the default in
brackets, which is how couch-tv behaved before the key existed. So an older `config.json` with no
`home` or `quick` keys looks and works exactly as it did, except one thing: with no
`home.language`, a TV set to Spanish, Italian, German or French now shows the home in that language (and an
Italian, German or French one with a 24 hour clock), where it used to be English.

Most of what the home shows can also be changed on the TV itself, with the gear tile (Home
settings), and what is chosen there wins on that TV. See
[Settings made on the TV](#settings-made-on-the-tv-home-settings) at the end.

## The TVs

`tvs` is a list, one entry per TV. `default_tv` is the `id` used when a request names no TV.

| Key | What it does |
|---|---|
| `id` (needed) | A short id, letters, numbers and dashes. Used in `?tv=` and `"tv"`. |
| `name` (needed) | What the phone and the TV call it. |
| `ip` (needed) | The TV's address on your Wi-Fi, four numbers with dots. |
| `host` | Optional: a name for the TV on your network (one ending in `.local`, if your TV has one), tried before `ip`. Leave it out (an empty `""` counts as left out). |
| `label` | Optional: a longer name for your own notes. Nothing reads it yet. |
| `adb_port` [5555] | The TV's ADB port. 5555 is what Network debugging and `adb tcpip 5555` use; change it only if your TV keeps a different fixed port open. The scripts in `tv-home/tools/` and `scripts/` read `ADB_PORT` instead. The random Wireless debugging port does not work here: see README step 1. |
| `mac` | The TV's network (MAC) address, for turning it on from the phone. |
| `wake_on_lan` [true] | `false` stops the bridge sending Wake-on-LAN packets to this TV, even with a `mac`. |
| `paired` | Set by `bridge/pair_tv.py`. Leave it alone. |
| `keep_disabled` | The keep-off list for this TV (see `bridge/API.md`). |
| `close_on_off` | Android TVs, option B: apps the bridge force-stops when this TV turns off, for example `["com.disney.disneyplus"]`. For an app that signs you out when it wakes before the TV is back on the Wi-Fi. |
| `quick` [`["sleep"]`, plus `"picture"` when the TV has a `picture` entry] | The quick buttons on the TV home, in this order. See below. |
| `picture` | Only used when `"picture"` is in `quick`. See below. |
| `kind` [`"android"`] | `"samsung"` for a Samsung TV (Tizen), `"lg"` for an LG TV (webOS), `"roku"` for a Roku TV or box. The bridge then uses `bridge/samsung.py`, `bridge/lg.py` or `bridge/roku.py` instead of ADB and the Android remote. See [SAMSUNG.md](SAMSUNG.md), [LG.md](LG.md) and [ROKU.md](ROKU.md). |
| `open_on_power_on` [true] | Samsung, LG and Roku only: open the couch-tv app whenever the TV is switched on and nothing else is on screen. |
| `app_id` [`"CouchTVApp.Home"`, LG `"app.couchtv.home"`, Roku `"dev"`] | Samsung, LG and Roku only: the couch-tv app's id on the TV, if you changed it in `samsung/app/config.xml` or `lg/app/appinfo.json`. On a Roku a sideloaded channel is always `dev`. |
| `remote_name` [`client_name`] | Samsung only: the name the TV shows when it asks to Allow the remote. |
| `extend_devmode` [true] | LG only: press Developer Mode's Extend once a day while the TV is on, so the app is not removed. |
| `leave_inputs` [false] | LG and Roku only: an HDMI or external input counts as in use (a computer or a console on it). The TV coming on there is left alone, and the daily Extend never switches away from it. |
| `back_to_couch` [false] | LG only: when an app closes to LG's home (Back out of Netflix, say), couch-tv opens again a second later. Home pressed while couch-tv is open still reaches LG's home. |
| `ares_device` [the TV's `id`] | LG only: this TV's name in LG's ares tools (`ares-setup-device`). |
| `ares_launch` [found on the PATH] | LG only: the full path to `ares-launch`, for a bridge that cannot find it (started by launchd, for example). |
| `port` [LG 3000, then 3001; Roku 8060] | LG and Roku only: the network remote's port, if your TV only answers on one of them (a Roku's is 8060 unless something else changed it). |

### Quick buttons (`quick`)

The round buttons at the top right of the home. Any of these, in the order you list them:

| Name | What it does | Needs |
|---|---|---|
| `sleep` | Sleep timer: 15, 30, 60 or 90 minutes, then the TV turns off. With `bedtime_dim` on, the couch-tv home dims into a warm bedtime amber during the final 15 minutes. With no bridge, the TV launcher app keeps the timer and opens the screensaver at the end. | The bridge or the TV launcher app |
| `picture` | Flips between the TV's two picture modes in `picture.modes`. | The bridge, ADB, and a `picture` entry |
| `look` | Cycles the home through the Night scenes, OLED (the Classic grid on pure black) and the Classic look. This TV remembers the choice. | Nothing |
| `soundscape` | Ambient sleep sounds: each press goes Gentle rain, Fireplace, Ocean waves, Brown noise, off. Made on the TV itself with Web Audio, so there are no sound files and nothing to download. It plays only after someone presses it, stops when an app or the screensaver comes in front, fades over the last 15 minutes of a sleep timer and stops when the timer runs out. Not in the default buttons. | Nothing |
| `input` | couch-tv's own Input menu: the HDMI ports and other inputs Android lists for the TV, by the TV's own names (ARC or eARC shows where the TV's label says so; Android has no public way to read it), with the devices HDMI-CEC found behind each, then Bluetooth and Network. OK switches straight to that input. A TV that lists no inputs keeps today's behaviour: with the bridge it presses the TV's Input key (`KEYCODE_TV_INPUT`); with no bridge the launcher opens the TV's own input screen if it has one. | The TV home launcher, the bridge, or a TV with an input screen |
| `screensaver` | Starts the TV's own screensaver: Google TV's Ambient mode, with the Google Photos
albums. Android only lets the system start a dream, so the button cuts the screen timeout to a few
seconds and nudges the idle timer until the TV naps by itself; the photos then come up a few seconds
later and the timeout goes back to what it was the moment the screensaver covers the home. A second
press can never leave the TV on the short timeout. | The TV home app on an Android TV or Google TV,
and the "modify system settings" app-op that `apply.sh` grants |

A button that cannot work right now is left out, the same way the sleep timer always disappeared
when the computer was off. With no bridge at all (option A), only `look` shows, plus `input` on
TVs that have an input screen the launcher can open.

```json
"quick": ["sleep", "look", "input", "screensaver"]
```

Home settings on the TV (gear tile, Quick buttons) can choose and order them too, for that TV.

### Picture mode (`picture`)

```json
"picture": { "modes": ["Calibrated", "Dynamic"] }
```

Two mode names, written exactly as the TV shows them in its own Picture mode settings. The button
is labelled with the mode the TV is in now, and pressing it switches to the other one. The bridge
opens the TV's picture mode settings over ADB, moves to the row with that name and presses OK, so
the names must match. Test it once from the phone (TV, Picture) before you rely on it.

(The older form, `"values"` with `"method": "panel"`, still works.)

## People

```json
"people": [
  { "id": "person1", "name": "Person 1" },
  { "id": "person2", "name": "Person 2", "colour": "#0a84ff" }
]
```

Any number, up to 12. `name` is needed; `id` is made from the name if you leave it out; `colour`
(a hex colour) is optional, otherwise each person gets one from a fixed set.

**Profiles inside the apps (option B).** When "put on X" opens Netflix, Stan, Disney+ or any app
that stops on "Who's watching?", the bridge presses the profile of whoever is watching, opens the
show again, and presses Play if it stops on the show's page. List each person's profile names
across all their apps, best first, in `app_profiles` (without it, their `name` is tried). Then
`app_profile_fallback` is tried, then everyone else's names:

```json
"people": [
  { "id": "sam", "name": "Sam", "app_profiles": ["Sam", "Samuel", "Sammy"] },
  { "id": "alex", "name": "Alex" }
],
"app_profile_fallback": ["Alex", "Family"]
```

If none of the names is on the screen, nothing is pressed and the app is left on its profile screen.

`"kid": true` and `"guest": true` (both optional) keep that person out of the household's taste:
the shared "everyone" picks and what Claude is told the house likes. They still get their own
Keep watching row and their own picks. Imported Netflix profiles with "Kids" in the name are left
out the same way. The phone's People sheet keeps these marks when it renames or reorders someone.

```json
{ "id": "kids", "name": "Kids", "kid": true },
{ "id": "visitor", "name": "Visitor", "guest": true }
```

- **None or one person:** no switcher. Keep watching shows everything watched on that TV.
- **Keep watching is per TV and per person.** Each TV remembers who is on its couch, and each
  person sees only what they watched on that TV: one card per show, newest first, up to 10, gone
  after 30 days with no watching. A show counts after a minute of the same title playing. An app
  that gives Android no title (Netflix on some TVs) or only its own name (Prime on a Sony) is named
  from its row in Android's "Continue watching" (Watch Next) instead: the TV home app reads those
  rows and hands them to the bridge, because ADB cannot read them. Videos and music are never kept.
- **Dismissing a show:** hold OK on any card in Keep watching to open the menu and choose **Remove from Keep watching**. The card animates away and is hidden on that TV across restarts. It only hides the card in couch-tv: the app's own Continue watching row is not changed, and a show hidden here still shows on the TV's own home.
- **Two:** the pill switch at the top left.
- **Three or more:** a round head icon with the person's initial. OK opens the list.
- With two or more people the switcher always shows, also before anyone has watched anything, so
  you can say who is watching first.

The list order is the order on screen. After the first start the bridge keeps the list in
`bridge/data/people.json`, and that wins over `config.json` from then on, because the phone
(TV, People: add, rename, remove, drag to reorder) and the TV remote (hold OK on a name in the list,
up and down to move it, OK to drop) both change it. To start again from `config.json`, delete
`bridge/data/people.json` and restart the bridge.

With no bridge (option A) there is no phone to edit people, but Home settings on the TV (gear tile,
People) adds, renames, removes and reorders them, and the TV keeps the list itself. With a bridge,
Home settings saves to the same `bridge/data/people.json` the phone uses.

## The home's look (`home`)

```json
"home": {
  "look": "night",
  "scenes": ["night", "golden", "water", "fog", "dawn"],
  "scene_seconds": 20,
  "clock": "12h",
  "dock_size": 10,
  "hide_packages": [],
  "language": "en"
}
```

| Key | What it does |
|---|---|
| `look` ["night"] | `night`: the scenes with the big glass clock. `oled`: the Classic grid of app banners on pure black (no photo, no video, no scenes), with a glowing focus ring and a one or two pixel nudge of the home once a minute against burn-in. Night and Classic are unchanged, and nothing goes black unless this is chosen. `classic`: one photo, a grid of app banners. The `look` quick button cycles Night, OLED and Classic on each TV, and `?theme=` overrides them for a preview. |
| `scenes` [all five] | Which Night scenes take turns, and in what order. Any of `night`, `golden`, `water`, `fog`, `dawn`, and the ids of your own scenes. One scene stays put. |
| `my_scenes` [none] | Your own scenes from any photo, each with its clock designed: where it sits, its size and font, the date above or below it, light or dark text, and `cutout` for the skyline in front of the clock. Made with `tv-home/tools/make-scene.py`; [MAKE-A-SCENE.md](MAKE-A-SCENE.md) has every key. They take turns after the scenes in `scenes` unless they are listed there. Option A needs the app rebuilt with the scene's pictures inside (that guide says how). |
| `scene_seconds` [20] | How long each scene shows. 5 or more. |
| `clock` [the language's usual clock: `24h` in Italian and German, `12h` in the others] | `12h` (5:30 pm) or `24h` (17:30). |
| `hide_packages` [none] | Android package names never shown on the home or in More apps, for a maker's own clutter (help apps, file browsers, screen sharing tools). `survey-tv.py` lists every TV app with its package name. For example `["com.example.tvhelp"]`. |
| `updates` [none: the TV asks once] | The answer to "tell you when a new couch-tv version is out?", asked at setup: `notify` (the TV home looks on GitHub once a week and puts a dot on the gear tile) or `manual` (nothing by itself; Home settings, Updates, Check for updates now). Used only until the TV has an answer; after that the switch in Home settings, Updates wins. Option C has no updates. |
| `glass` [`off`] | Glass panels behind the clock, Keep watching and the apps: `on` (clear, softly blurred, with a light edge), `lite` (the same panels with no blur, for older or slower TVs) or `off`. Home settings, Look, Glass panels wins over it. |
| `glass_icons` [`false`] | `true`: Apple style clear app icons. Each app's symbol is cut from its own background and drawn in light glass on a glass tile, and the app you are on shows its own colours. An icon that will not cut cleanly (a photo) is shown grey and half see-through instead. Works with `glass` on or off, and the phone remote's app grid follows it. Home settings, Look, Glass app icons wins over it. |
| `moving_tiles` [`true`, or `false` when `glass` is `lite`] | The focused tile's slow sway and the light that slides across it. `false` holds it still, which stops the black box that flickers around the focused tile on some slow TVs (a TCL with a weak GPU). Home settings, Look, Moving tiles wins over it, and a TV set to reduce motion (Developer options, Animator duration scale) already holds it still. |
| `lighter` [`false`; `true` on an old TV] | For a slow box (a Xiaomi Mi Box, a Fire stick) where moving along the rows stutters. `true` turns off every blur, the soft shadows under tiles and panels, the slow drift of the photo and the focused tile's sway, and asks for smaller Keep watching pictures. The layout and colours stay. Home settings, Look, Lighter home wins over it. On a TV whose WebView is too old for CSS grid (Android 6 and older, for example a Mi TV 4A with 1 GB of memory) it starts **on** until someone chooses otherwise, in Home settings or by writing `"lighter": false` here. Other TVs start with it off. |
| `hi_res` [`true`] | `false` keeps the 1080 copies of the built-in pictures on a 4K screen. A 4K TV normally gets the 3840x2160 copies, which a weak chip can struggle to decode and keep in memory (an LG 43SQ700S monitor). On an LG, `lg/build.py` then leaves the 4K copies out of the app too (22 MB down to under 6 MB). |
| `glass_amount` [`3`] | How clear the glass is, `1` (frosted) to `5` (very clear): the glass panels, the glass app icons and both clocks (the frosted clock only gets more see-through at `4` and `5`). Home settings, Look, How clear wins over it, and the phone remote follows it. |
| `glass_focus` [`colour`] | With glass app icons: the focused app shows its own colours (`colour`) or stays glass like the rest (`glass`), shown by its lift, a brighter rim and a deeper shadow. Home settings, Look, Focused app wins over it, and the phone remote follows it. |
| `now_playing` [`true`] | Now playing: a card with the song any music app is playing, and previous, play or pause and next. `false` hides it. Needs option B or C. Home settings, Look, Now playing wins over it. |
| `ambient_music` [`false`] | Music screen: a full screen album cover with a colour glow, a progress bar and previous, play or pause and next, which opens when a new song starts while you are on the home. Down or Back goes back to the apps. Off by default. Needs Now playing (option B or C). On the Lighter home setting (or an old WebView) the glow is a plain colour wash with no blur or animation. Home settings, Look, Ambient music screen wins over it. |
| `nav_sound` [`system`] | The sound on every arrow and OK: `system` (the TV's own, which follows its system sounds switch), `soft` (a short, quiet tap) or `off`. Home settings, Look, Sound wins over it. |
| `clock_style` [`frosted`] | The Night look's clock: `frosted` (the photo's frosted copy, as before) or `liquid` (clear glass digits that bend the photo behind them a little, with a bright rim and a soft edge). Home settings, Look, Clock style wins over it. |
| `wx_unit` [`c`] | The weather's temperature unit: `c` (Celsius) or `f` (Fahrenheit). Home settings, Weather, Units wins over it. |
| `video_url` [none] | A looping, muted video background in place of the photo, in both looks: the address of an MP4 or MOV (`https://...`, or `http://` for a computer at home). Given here it is on; Home settings, Look switches it off or changes the link. The photo stays if the clip does not play. |
| `sun_sync` [`false`] | Follow the sun. `true` picks the Night look's scene from the sun's height at `weather.lat` and `weather.lon`: Dawn in the morning twilight, Waterline in the day (Fog when the weather is overcast or rainy), Golden hour in the evening and Night after dark, instead of rotating every `scene_seconds`. A scene you switched off is skipped. With no place set it goes by the clock. Home settings, Look, Scenes, Follow the sun wins over it (ekagra-codes, #57). |
| `ambient_weather` [`false`] | Soft rain, snow, fog and thunderstorm effects drawn over the Night look's scenes when Open-Meteo reports that weather for your place. Off unless you switch it on. It also needs Weather on, stops while an app or Settings is open, and never runs under Lighter home or on an old WebView. Home settings, Weather, Ambient weather effects wins over it (ekagra-codes, #88). |
| `ambient_sun_grade` [`false`] | A gentle tint over the Night look's scenes that follows the sun's height at `weather.lat` and `weather.lon` (cool at night, rose at sunrise and sunset, amber in the golden hour). Off unless you switch it on, and never under Lighter home or on an old WebView. Home settings, Weather, Sunlight colour grading wins over it. |
| `dock_size` [10] | How many apps sit in the Night dock before Settings and More apps. 1 to 10. Everything else is behind More apps. The phone's Arrange apps keeps to the same number. |
| `inputs` [none] | Pinned external inputs/consoles displayed as dock and grid tiles. They take dock places, so the last apps move behind More apps. Each item can specify `port` (e.g. `1` for HDMI 1), `label` or `name` (e.g. `"PS5"`), `icon` (`"ps5"`, `"xbox"`, `"switch"`, `"hdmi"`, `"cable"`, or `"pc"`), `match` (substring matched against TV input labels or IDs), or `id`. For example: `[{"port": 1, "label": "PlayStation 5", "icon": "ps5"}]`. |
| `soundscape` [none] | The sound the Soundscape button starts with: `"rain"`, `"fire"`, `"waves"`, `"brown"`, or `"off"`, or an object `{"type": "rain", "volume": 0.5, "fade_with_sleep": true}` (`volume` 0 to 1). It never starts by itself: only a press on the button, or the row in Home settings, plays it. With `fade_with_sleep` it gets quieter over the last 15 minutes of a sleep timer and stops when it ends. |
| `bedtime_dim` [`false`] | `true` dims the couch-tv home into a warm amber for the last 15 minutes of a sleep timer. It only darkens the couch-tv page, not an app that is playing, and not the TV's brightness or picture settings. |
| `skip_watch_next` [none] | Package names never shown in the Keep watching row (e.g. `["com.google.android.youtube.tv"]`). |
| `watch_next_per_app` [5] | The maximum number of Keep watching cards to show from any single app (1 to 20). |
| `language` [the TV's own language if the home speaks it, else `en`] | The TV home's language until someone picks one in Home settings: `en` (English), `es` (Spanish), `es-MX` (Mexican Spanish), `it` (Italian), `de` (German), `tr` (Turkish) or `fr` (French). The phone remote has its own choice, "Same as the TV" by default. |

## Apps on the home

Nothing to set in `config.json`. Arrange them from the phone (TV, Arrange apps) or with the TV
remote:

- **Move an app:** on the dock, hold OK on it for about half a second. A small menu opens: **Move**,
  **Hide from home**, **Uninstall** (Android's own remove dialog, which asks first) and **App info**.
  **Move** lifts the app and it wiggles. Left and right move it, down sends it behind More apps, OK or Back puts it down.
- **Bring one back:** open More apps, hold OK on an app, and it goes to the end of the dock. If the
  dock is full, the dock's last app moves behind More apps to make room.
- **Home settings, Apps** (gear tile) lists every app: OK moves one between home, More apps and
  hidden (hidden apps are not shown anywhere on that TV until you bring them back there), holding
  OK picks it up to change the order with up and down.
- **New apps:** the Play Store is the **App Store** tile, first in More apps. An app installed later
  goes to the end of the dock if there is room, otherwise first in More apps, with a small blue dot
  until it is opened once.

The order is saved by the bridge (`bridge/data/app-order.<tv>.json`), so the phone and the TV
always agree; the TV reads it again every time Home is pressed. With no bridge, the TV keeps the
order itself. An order made on the TV while the computer was off is handed to the bridge the next
time it answers. Moving apps with the remote works on the Night look; Classic shows the apps in
their default order.

## The phone remote and the Claude ask

| Key | What it does |
|---|---|
| `phone_remote` [true] | `false` says this house does not use the phone remote. The bridge still runs the API, because the TV home uses it, and still serves the phone page if someone opens it. Keep the bridge on the home network only. |
| `ask` [`{"enabled": true}` when the Claude Code program is on the computer, otherwise false] | `config.example.json` sets `{"enabled": false}`: turn it on only once Claude Code is installed and logged in on the bridge computer. Off hides Ask on the phone and the bridge answers `/api/ask` with `409`. Ask runs `claude -p` on your own Claude plan and never uses an API key. Anyone on your Wi-Fi can use it. |

## Smart home (optional, through Home Assistant)

Off unless you add it. With no `home_assistant` section (or `"enabled": false`, as in
`config.example.json`) nothing changes on anyone's TV: no tile, no calls to anything, no extra
permission. It works with option A (no computer) and option B (bridge), because the TV app talks to
Home Assistant itself; the bridge never reads this section and never passes it on.

You need [Home Assistant](https://www.home-assistant.io/) already running at home, on the same home
network as the TV. It is the hub that knows your air conditioner, doorbell and cameras (Daikin,
Mitsubishi, AirTouch, Ring, Nest, Reolink and hundreds more); couch-tv only talks to Home Assistant.

```json
"home_assistant": {
  "url": "http://homeassistant.local:8123",
  "climate": [
    { "entity": "climate.living_room", "name": "Living room" },
    { "entity": "climate.bedroom", "name": "Bedroom" }
  ],
  "scenes": [
    { "entity": "scene.movie_night", "name": "Movie night" },
    { "entity": "script.good_night", "name": "Good night" }
  ],
  "doorbell": { "entity": "event.front_door_ding", "camera": "camera.front_door", "name": "Front door" }
}
```

And the token in `.env` (never in the repo):

```sh
HOME_ASSISTANT_TOKEN=<the long-lived token>
```

| Key | What it does |
|---|---|
| `url` (needed) | Home Assistant's address as the TV reaches it, `http://` or `https://`, with the port. |
| token (needed) | `HOME_ASSISTANT_TOKEN` in `.env`. A `"token"` key in this section also works, but `.env` keeps secrets out of `config.json`. |
| `enabled` [true] | `false` switches smart home off and keeps the rest of the section for later. |
| `climate` | Up to 8 air conditioners or heaters (`climate.*` entities), in the order shown. `name` is optional (else Home Assistant's own name). |
| `scenes` | Up to 10 scenes or scripts (`scene.*`, `script.*`), shown as tiles that run on OK. This is also the way to put lights, blinds or anything else on the TV: make a scene or script for it in Home Assistant. |
| `doorbell` | `entity`: what rings, one of `event.*` (most doorbells, a new event per press), `binary_sensor.*` or `input_boolean.*` (on while ringing). `camera` (optional): a `camera.*` for the still picture. `name` (optional): the card's title. |

**Make a separate Home Assistant user for the TV**, and make the token as that user: in Home
Assistant, Settings, People, add a user (not an administrator), log in as it once, then its
profile, Security, Long-lived access tokens, Create token. If the TV is ever lost or reset, delete
that token and nothing else changes. Even so, a token can do anything that user can do in Home
Assistant, so treat it like a password.

**What the TV does with it.** `apply.sh` hands the section to the TV app on its own (never in the
page's settings, never printed). The app keeps it in its own private storage, left out of Android
backups, and never logs the token. The home page never sees the address or the token: it asks the
app, and the app only allows these, for the entities named here and nothing else:

- read the state of a listed `climate` entity; change its temperature (inside its own limits), its
  mode (only modes it lists), or switch it on or off
- run a listed scene or script
- for the doorbell: read the doorbell entity, and the named camera's still picture

Every call goes to `url` only, never follows a redirect, and gives up after a few seconds, so a
Home Assistant that is off never holds the TV up. Change `config.json` and run `apply.sh` again to
change any of it; the whole section is replaced at once, and a section that is removed or does not
check out switches smart home off on the TV.

**On the TV.** A **Smart home** tile sits just before Settings in the dock (it takes one of the
dock's places, so the dock holds nine apps). OK opens one screen: each room as a card with its set
point, the temperature now and what it is doing, and four buttons (cooler, warmer, on or off, mode),
then the scenes. Left and right move, up and down change rows, Back closes. The rooms are read again
every 20 seconds while the screen is open, and never while it is closed. A doorbell alone has no
tile.

**The doorbell card.** While the TV screen is on, the app asks the doorbell entity every 3
seconds (screen off: it asks nothing). When someone rings, a card with the camera's still picture,
a new one every 2 seconds, slides in at the top right over whatever is playing. Any button on the
remote hides it for that ring; otherwise it goes after 45 seconds. Over other apps it needs Android's
"display over other apps", so `apply.sh` grants it over ADB, but only when a `doorbell` is set up,
and takes it back if you remove the doorbell later. `undo.sh` takes it back too. There is no live
video, only stills, and no sound. The card only shows while the couch-tv app is running, which is
normally all the time because it is the home screen.

**Not supported yet:** live camera video, locks and alarms (on purpose: nothing that opens the house
from a TV remote), single lights or switches as their own buttons (use a scene or a script), and
anything outside Home Assistant.

Preview with no TV and no Home Assistant: `?mock=1&ha=1` (see the end of this page). The doorbell
card is drawn by the app itself, so it cannot be previewed in a browser.

## Everything else

**Never forward a port to the bridge.** The bridge is built for your home network only. Never expose it
to the internet or forward port 5400 on your router. A private network (VPN) app you run yourself
is the safe way to use the phone remote away from home.

| Key | What it does |
|---|---|
| `bridge.host`, `bridge.port` [5400], `bridge.fallback_hosts` | Where the bridge runs. `fallback_hosts` lists other names the bridge may be opened by (see "Opening the bridge by another name" below). |
| `bridge.pairing_key` [""] | Optional API pairing key. Empty/unset by default. When set, clients (phone remote and TV front-ends) must authenticate with this key. |
| `weather` | `lat`, `lon`, `place`, `timezone`, for the weather on the home (Open-Meteo, no key). A suburb or city is enough; never a home address. `timezone` (for example `Europe/London`) is also the time zone the bridge writes times in. |
| `country` [`IT` when `home.language` is `it`, `DE` when it is `de`, else "AU"] | Two letter code, for where shows stream (JustWatch), the country in links to Apple TV and Prime Video, and the country Claude is told about. |
| `country_name` | Optional: what to call the country in Claude's prompts, if the built-in list does not know your code. |
| `client_name` ["Couch TV bridge"] | The name the TV shows for the bridge in its list of paired remotes. Set it before `pair_tv.py`; changing it later means pairing again. |
| `screens` [] | Extra screens the TV can open, for example a computer through Moonlight. |

### Switching the pairing key on

Out of the box the bridge has no password: anything on your home Wi-Fi can use it, and so can a web
page open on any phone or computer at home. The bridge already refuses pages from other sites (it
checks the `Origin` a browser sends, and the name the page used to reach it, which stops a trick
called DNS rebinding). But the TV apps load from files and send `Origin: null`, so the bridge has to
accept `null`, and any web page can send `null` too (from a sandboxed frame). So the origin check
alone cannot tell the TV from a hostile page. **Only the pairing key closes that gap.** With it on:

- every `/api/` call except `/api/health` and `/api/pair` needs the key
  (`Authorization: Bearer <key>`, `X-API-Key: <key>` or `?token=<key>`);
- after 5 different wrong keys from one address within a minute, that address gets HTTP 429 for the
  rest of that minute, whatever key it sends. The same wrong key sent again does not count, so a phone
  or TV still holding an old key does not lock itself out, and the bridge computer itself
  (`127.0.0.1`, the MCP tools, Claude) is never limited.

Switching it on means every TV and phone needs the key, so do all of this in one go:

1. **Add the key to `config.json`** and restart the bridge. Use 12 to 128 letters, digits, `-` or `_`
   (the bridge refuses to start otherwise), and make it long, for example 20 random characters:
   ```json
   "bridge": { "host": "your-computer.local", "port": 5400, "pairing_key": "<your key>" }
   ```
2. **Google TV, Android TV and Fire TV (option B):** the TV home needs a `couch-tv-home.apk` newer
   than 0.12 (0.12 and older cannot carry a key; until a newer release is out, build it with
   `scripts/build-apk.sh`). Then run `apply.sh` again for each TV, the same way as the first time.
   It reads the key from `config.json` and hands it to the TV:
   ```sh
   TV_IP=<tv address> BRIDGE_URL=http://<your-computer>:5400 APK=dist/couch-tv-home.apk sh tv-home/tools/apply.sh
   ```
3. **LG, Samsung and Roku:** the key is built into the app, so build it again and install it again
   (`build.py` reads the key from `config.json`, or pass `--key`). Use the computer's number address,
   as in each guide:
   - LG: `.venv/bin/python lg/build.py --bridge http://<computer's address>:5400`, then install the
     `.ipk` as in [LG.md](LG.md).
   - Samsung: `.venv/bin/python samsung/build.py --bridge http://<computer's address>:5400`, then
     install the `.wgt` as in [SAMSUNG.md](SAMSUNG.md).
   - Roku: `.venv/bin/python roku/build.py --bridge http://<computer's address>:5400 --install <roku address>`
     ([ROKU.md](ROKU.md)).
4. **Phones:** the phone remote shows a "Pair this phone" screen. Type the key once, or open
   `http://<your-computer>.local:5400/?pair=<key>` on the phone. A phone that has the remote on its
   home screen pairs from there the same way.
5. **The MCP tools and Claude** read the key from `config.json` by themselves. Restart Claude Code (or
   whatever runs `bridge/mcp_server.py`) so it picks the key up.
6. **Your own scripts and Home Assistant** calls need `-H "Authorization: Bearer <key>"` (and, for a
   POST, `-H "Content-Type: application/json"`).

Option C (the on-TV app) has its own PIN and is not affected.

**Opening the bridge by another name.** The bridge answers to any number address, any `.local` name,
`localhost` and the names in `bridge.host` and `bridge.fallback_hosts`. A page opened by any other
name (a router name such as `computer.home`, say) gets "forbidden host": add that name to
`bridge.fallback_hosts` and restart the bridge.

## Settings made on the TV (Home settings)

The gear tile in the dock (Settings) opens a small menu: **Home settings** (couch-tv's own) or
**TV settings** (Android's). Home settings changes, with the TV remote alone: the language, the
weather's place (a town search), weather on or off, °C or °F and how often it is checked, the look,
which scenes take turns and in what order, how long each stays, the clock, glass panels, a video
background, your own photos, the
apps (home, More apps or hidden, and their order), the people, and the quick buttons. README,
"Settings on the TV", says how to use it. Its **Updates** section (the TV home app only) looks for
new couch-tv releases on GitHub, once a week if the household said yes, or when asked, and installs
one only after Android's own "update this app?" question. The weekly look and its switch belong to
the app on that TV: `home.updates` only answers the first-time question, the bridge never sees the
switch, and Reset home settings leaves it alone.

**Which wins**, lowest first:

1. The defaults in the brackets above.
2. `config.js`: the parts of `config.json` the TV home reads. With a bridge (option B) it comes from
   the bridge; with no bridge (option A) it is what `apply.sh` handed the app, or the copy built
   into it.
3. **Home settings made on this TV.** They win over `config.json`, key by key: a key never touched
   on the TV still follows `config.json`. With a bridge they are also kept on the computer
   (`bridge/data/settings.<tv>.json`, see `GET|POST /api/settings` in bridge/API.md), so the phone
   and the TV agree and a TV whose storage was cleared gets them back. A change made on the TV while
   the computer is off is handed to the bridge the next time it answers. With no bridge they live on
   the TV only (the page's storage and the launcher's own store).
4. `?theme=` and the other preview settings in the address, for a preview only.

People and the app order are not part of Home settings' file: they use the lists they always had
(`bridge/data/people.json` and `bridge/data/app-order.<tv>.json` with a bridge, the TV's own copy
without one), so the phone's People and Arrange apps and the TV always show the same thing. Apps
hidden in Home settings are hidden on that TV only and are left out of what the TV tells the phone.

To go back to `config.json`: Home settings, About, **Reset home settings** (OK twice). It resets
everything except the people and the apps. Changing `config.json` later does not override a choice
already made on the TV.

## Trying settings without a TV

Serve the repo folder with any static server and open the home with `?mock=1`, for example
`python3 -m http.server 8000`, then `http://127.0.0.1:8000/tv-home/web/index.html?mock=1`.
`tv-home/web/mock.js` lists the preview settings: `people=4`, `quick=sleep,look,input`,
`picture=1`, `look=classic`, `clock=24h`, `lang=it`, `dock=6`, `scenes=fog,dawn`, `secs=8`,
`newapp=1`, `offline=1`, `down`, `ha=1` (smart home with a pretend Home Assistant; `ha=down` when
it is not answering, `ha=scenes` for scenes only), `update=1` (Home settings, Updates, with a pretend
0.4 waiting; `update=latest` and `update=allow` for the other cases), and `reset=1` to forget what a
preview saved (Home settings included). A preview keeps its Home settings apart from a real TV's (they start with `mock:`). `?scene=own`
starts on the first of your own photos. `myscenes=[...]` is `home.my_scenes` as JSON, and
`?scene=<id>` starts on one of them ([MAKE-A-SCENE.md](MAKE-A-SCENE.md), step 5).
