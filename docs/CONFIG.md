# config.json, every setting

Copy `config.example.json` to `config.json` in the repo root and edit it. `config.json` is in
`.gitignore`: it never gets committed. The bridge reads it once when it starts, so restart the
bridge after an edit. The TV home gets the parts it needs from the bridge (`/tv/config.js`) and
keeps a copy for when the computer is off. With no bridge (option A), `tv-home/tools/apply.sh`
hands the same parts to the app on the TV when it installs it, so run `apply.sh` again after you
change people, weather, the look or the quick buttons.

Every key below is optional unless it says otherwise. Leave a key out and you get the default in
brackets, which is how couch-tv behaved before the key existed. So an older `config.json` with no
`home` or `quick` keys looks and works exactly as it did.

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
| `quick` [`["sleep"]`, plus `"picture"` when the TV has a `picture` entry] | The quick buttons on the TV home, in this order. See below. |
| `picture` | Only used when `"picture"` is in `quick`. See below. |
| `kind` [`"android"`] | `"samsung"` for a Samsung TV (Tizen). The bridge then uses `bridge/samsung.py` instead of ADB and the Android remote. See [SAMSUNG.md](SAMSUNG.md). |
| `open_on_power_on` [true] | Samsung only: open the couch-tv app whenever the TV is switched on and nothing else is on screen. |
| `app_id` [`"CouchTVApp.Home"`] | Samsung only: the couch-tv app's id on the TV, if you changed it in `samsung/app/config.xml`. |
| `remote_name` [`client_name`] | Samsung only: the name the TV shows when it asks to Allow the remote. |

### Quick buttons (`quick`)

The round buttons at the top right of the home. Any of these, in the order you list them:

| Name | What it does | Needs |
|---|---|---|
| `sleep` | Sleep timer: 15, 30, 60 or 90 minutes, then the TV turns off. | The bridge |
| `picture` | Flips between the TV's two picture modes in `picture.modes`. | The bridge, ADB, and a `picture` entry |
| `look` | Flips the home between the Night scenes and the Classic look. This TV remembers the choice. | Nothing |
| `input` | Opens the TV's input list (HDMI, a games console, a set top box). With the bridge it presses the TV's Input key (`KEYCODE_TV_INPUT`); with no bridge the launcher opens the TV's own input screen if it has one. | The bridge, or a TV with an input screen |

A button that cannot work right now is left out, the same way the sleep timer always disappeared
when the computer was off. With no bridge at all (option A), only `look` shows, plus `input` on
TVs that have an input screen the launcher can open.

```json
"quick": ["sleep", "look", "input"]
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

- **None or one person:** no switcher. Keep watching shows everything.
- **Two:** the pill switch at the top left.
- **Three or more:** a round head icon with the person's initial. OK opens the list.

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
| `look` ["night"] | `night`: the scenes with the big glass clock. `classic`: one photo, a grid of app banners. The `look` quick button overrides this on each TV, and `?theme=` overrides both for a preview. |
| `scenes` [all five] | Which Night scenes take turns, and in what order. Any of `night`, `golden`, `water`, `fog`, `dawn`. One scene stays put. |
| `scene_seconds` [20] | How long each scene shows. 5 or more. |
| `clock` ["12h"] | `12h` (5:30 pm) or `24h` (17:30). |
| `hide_packages` [none] | Android package names never shown on the home or in More apps, for a maker's own clutter (help apps, file browsers, screen sharing tools). `survey-tv.py` lists every TV app with its package name. For example `["com.example.tvhelp"]`. |
| `dock_size` [10] | How many apps sit in the Night dock before Settings and More apps. 1 to 10. Everything else is behind More apps. The phone's Arrange apps keeps to the same number. |
| `language` ["en"] | The TV home's language until someone picks one in Home settings: `en` (English), `es` (Spanish) or `es-MX` (Mexican Spanish). The phone remote has its own choice, "Same as the TV" by default. |

## Apps on the home

Nothing to set in `config.json`. Arrange them from the phone (TV, Arrange apps) or with the TV
remote:

- **Move an app:** on the dock, hold OK on it for about half a second. It lifts and wiggles.
  Left and right move it, down sends it behind More apps, OK or Back puts it down.
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

| Key | What it does |
|---|---|
| `bridge.host`, `bridge.port` [5400], `bridge.fallback_hosts` | Where the bridge runs. |
| `weather` | `lat`, `lon`, `place`, `timezone`, for the weather on the home (Open-Meteo, no key). A suburb or city is enough; never a home address. `timezone` (for example `Europe/London`) is also the time zone the bridge writes times in. |
| `country` ["AU"] | Two letter code, for where shows stream (JustWatch), the country in links to Apple TV and Prime Video, and the country Claude is told about. |
| `country_name` | Optional: what to call the country in Claude's prompts, if the built-in list does not know your code. |
| `client_name` ["Couch TV bridge"] | The name the TV shows for the bridge in its list of paired remotes. Set it before `pair_tv.py`; changing it later means pairing again. |
| `screens` [] | Extra screens the TV can open, for example a computer through Moonlight. |

## Settings made on the TV (Home settings)

The gear tile in the dock (Settings) opens a small menu: **Home settings** (couch-tv's own) or
**TV settings** (Android's). Home settings changes, with the TV remote alone: the language, the
weather's place (a town search), weather on or off, °C or °F and how often it is checked, the look,
which scenes take turns and in what order, how long each stays, the clock, your own photos, the
apps (home, More apps or hidden, and their order), the people, and the quick buttons. README,
"Settings on the TV", says how to use it.

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
`picture=1`, `look=classic`, `clock=24h`, `dock=6`, `scenes=fog,dawn`, `secs=8`, `newapp=1`,
`offline=1`, `down`, `ha=1` (smart home with a pretend Home Assistant; `ha=down` when it is not
answering, `ha=scenes` for scenes only), and `reset=1` to forget what a preview saved (Home
settings included). A
preview keeps its Home settings apart from a real TV's (they start with `mock:`). `?scene=own`
starts on the first of your own photos.
