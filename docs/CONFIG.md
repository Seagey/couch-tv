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
`home.language`, a TV set to Spanish, Italian, German, French, Serbian, Polish, Czech, Brazilian Portuguese, Hebrew, Arabic, Romanian or Simplified Chinese now shows the home in that language
(and an Italian, German, Turkish, French, Serbian, Polish, Czech, Brazilian Portuguese, Hebrew, Romanian or Simplified Chinese one with a 24 hour clock), where it used to be English.

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
| `adb_port` [5555] | The TV's ADB port. 5555 is what Network debugging and `adb tcpip 5555` use; change it only if your TV keeps a different fixed port open. The scripts in `tv-home/tools/` and `scripts/` read `ADB_PORT` instead. The random Wireless debugging port does not work here (only `tvadb.py` can use it, with `TV_ADB_BINARY`): see [SETUP.md step 1](SETUP.md#step-1-developer-mode-on-the-tv-every-option). |
| `adb_only` [false] | Fire TV on Fire OS only (a Cube or a stick): `true` when the TV has no Android TV Remote protocol (`scripts/check-tv.py <tv address> --adb` says so: ports 6466 and 6467 closed, Fire OS read). The bridge then drives the TV over ADB alone: keys (`input keyevent`), typing (`input text`, letters, digits and plain punctuation only), links (`am start`), power and the app in front (read every few seconds). There is no code pairing: the TV's "Allow USB debugging?" for the bridge computer is the pairing, `paired` is implied, and `bridge/pair_tv.py <tv id>` only checks ADB. No volume level (the volume keys still work). Current Fire OS blocks apps on the TV from using the TV's own ADB, but not a computer, so this is the way to the full phone remote on a Fire TV. Seen working on a Fire TV Cube (3rd gen, Fire OS 7, Android 9). |
| `mac` | The TV's network (MAC) address, for turning it on from the phone. |
| `wake_on_lan` [true] | `false` stops the bridge sending Wake-on-LAN packets to this TV, even with a `mac`. |
| `paired` | Set by `bridge/pair_tv.py`. Leave it alone. |
| `keep_disabled` | The keep-off list for this TV (see `bridge/API.md`). |
| `close_on_off` | Android TVs, option B: apps the bridge force-stops when this TV turns off, for example `["com.disney.disneyplus"]`. For an app that signs you out when it wakes before the TV is back on the Wi-Fi. |
| `quick` [`["sleep"]`, plus `"picture"` when the TV has a `picture` entry] | The quick buttons on the TV home, in this order. See below. |
| `inputs` [none: `home.inputs` applies] | This TV's own input tiles, the same items as `home.inputs`. Set it on a TV whose consoles differ from the others; `[]` gives that TV no input tiles. Without it, nothing changes. |
| `picture` | Only used when `"picture"` is in `quick`. See below. |
| `kind` [`"android"`] | `"samsung"` for a Samsung TV (Tizen), `"lg"` for an LG TV (webOS), `"roku"` for a Roku TV or box, `"vidaa"` for a Hisense VIDAA TV, `"philips"` for a Philips on Titan OS or Saphi, `"vega"` for a Fire TV on Vega OS, `"vizio"` for a VIZIO TV (SmartCast or VIZIO OS), `"panasonic"` for a Panasonic Viera (My Home Screen or older), `"tivo"` for a TiVo OS TV built by Vestel (JVC, Telefunken and others), `"appletv"` for an Apple TV (`ip`, `port`, and optionally `app_id`, the bundle id of couch-tv's tvOS app to open when it wakes, only needed when it does not start with `dev.couchtv.appletv`; `open_on_power_on: false` stops that: see [APPLE-TV.md](APPLE-TV.md)). The bridge then uses `bridge/samsung.py`, `bridge/lg.py`, `bridge/roku.py`, `bridge/vidaa.py`, `bridge/philips.py`, `bridge/vega.py`, `bridge/vizio.py`, `bridge/panasonic.py` or `bridge/tivo.py` instead of ADB and the Android remote. See [SAMSUNG.md](SAMSUNG.md), [LG.md](LG.md), [ROKU.md](ROKU.md), [VIDAA.md](VIDAA.md), [PHILIPS-TITAN.md](PHILIPS-TITAN.md), [PHILIPS-SAPHI.md](PHILIPS-SAPHI.md), [FIRE-VEGA.md](FIRE-VEGA.md), [VIZIO.md](VIZIO.md), [PANASONIC.md](PANASONIC.md) and [TIVO.md](TIVO.md). VIDAA has its own keys (`trace`, `browser`, `home_url`, `tile_id`, `keep_home`, `pointer`, `cert`, `cert_key`, `tls`, `mqtt_user`, `mqtt_password`, `client_id`), described in [VIDAA.md](VIDAA.md), step 3. Philips on Titan OS has `home_app`, `home_keys`, `api_version`, `tls`, `pair_secret_file` and `trace` ([PHILIPS-TITAN.md](PHILIPS-TITAN.md)); an older Philips with Saphi is `"philips"` with `"saphi": true`, and its keys (`saphi`, `browser_home`, `home_url`) are in [PHILIPS-SAPHI.md](PHILIPS-SAPHI.md). VIZIO has `trace` and `device_id`, described in [VIZIO.md](VIZIO.md), step 2. Panasonic has `trace`, `home_url`, `settle` and `encrypted`, described in [PANASONIC.md](PANASONIC.md), step 3. TiVo OS has `trace`, `home_url`, `settle`, `browser_wait`, `key_gap`, `browser_path` and `dial_apps`, described in [TIVO.md](TIVO.md), step 3. |
| `open_on_power_on` [true] | Samsung, LG, Roku, VIDAA, Philips, Panasonic, TiVo OS and Apple TV only: open the couch-tv app whenever the TV is switched on and nothing else is on screen (on a Philips, only when it has a `home_app`, or lists a browser: [PHILIPS-SAPHI.md](PHILIPS-SAPHI.md); Panasonic and TiVo OS cannot tell what is on screen: they open a few seconds after power on). |
| `app_id` [`"CouchTVApp.Home"`, LG `"app.couchtv.home"`, Roku `"dev"`] | Samsung, LG and Roku only: the couch-tv app's id on the TV, if you changed it in `samsung/app/config.xml` or `lg/app/appinfo.json`. On a Roku a sideloaded channel is always `dev`. |
| `remote_name` [`client_name`] | Samsung only: the name the TV shows when it asks to Allow the remote. |
| `extend_devmode` [true] | LG only: press Developer Mode's Extend once a day while the TV is on, so the app is not removed. With no bridge, the couch-tv app asks once a week with a question on screen that stays until it is answered, and the `extend` quick button does it on demand. |
| `leave_inputs` [false] | LG, Roku, VIDAA and Philips only: an HDMI or external input counts as in use (a computer or a console on it). The TV coming on there is left alone, and the daily Extend never switches away from it. |
| `back_to_couch` [false] | LG only: when an app closes to LG's home (Back out of Netflix, say), couch-tv opens again a second later. Home pressed while couch-tv is open still reaches LG's home. |
| `ares_device` [the TV's `id`] | LG only: this TV's name in LG's ares tools (`ares-setup-device`). |
| `ares_launch` [found on the PATH] | LG only: the full path to `ares-launch`, for a bridge that cannot find it (started by launchd, for example). |
| `port` [LG 3000, then 3001; Roku 8060; VIDAA 36669, then 36668; VIZIO 7345, then 9000; Panasonic 55000; TiVo OS 56789] | LG, Roku, VIDAA, VIZIO, Panasonic and TiVo OS only: the network remote's port, if your TV only answers on one of them (a Roku's is 8060 unless something else changed it). |

### Quick buttons (`quick`)

The round buttons at the top right of the home. Any of these, in the order you list them:

| Name | What it does | Needs |
|---|---|---|
| `sleep` | Sleep timer: 15, 30, 60 or 90 minutes, then the TV turns off. With `bedtime_dim` on, the couch-tv home dims into a warm bedtime amber during the final 15 minutes. With no bridge, the TV launcher app keeps the timer and opens the screensaver at the end. | The bridge or the TV launcher app |
| `picture` | Flips between the TV's two picture modes in `picture.modes`. | The bridge, ADB, and a `picture` entry |
| `look` | Cycles the home through the Night scenes, OLED (the Classic grid on pure black), the Classic look and Loop ([LOOP.md](LOOP.md); with no loop files yet it shows its scrim over a dark ground). This TV remembers the choice. | Nothing |
| `soundscape` | Ambient sleep sounds: each press goes Gentle rain, Fireplace, Ocean waves, Brown noise, off. Made on the TV itself with Web Audio, so there are no sound files and nothing to download. It plays only after someone presses it, stops when an app or the screensaver comes in front, fades over the last 15 minutes of a sleep timer and stops when the timer runs out. Not in the default buttons. | Nothing |
| `headphones` | Opens the TV's own Bluetooth settings screen, where headphones are paired and picked. Nothing is read from the request and no device addresses leave the bridge. Not in the default buttons. | The bridge and ADB, or the TV home launcher or on-TV app |
| `screen_off` | Audio-only / Screen off mode: turns off the display (pitch black canvas for OLEDs and drops hardware backlight on Android TV) while sleep soundscapes, Spotify, and sleep timers keep playing in the dark. Pressing any button on the remote wakes the screen and is absorbed so no unwanted actions occur. | Nothing |
| `input` | couch-tv's own Input menu: the HDMI ports and other inputs Android lists for the TV, by the TV's own names (ARC or eARC shows where the TV's label says so; Android has no public way to read it), with the devices HDMI-CEC found behind each, then Bluetooth and Network. OK switches straight to that input. A TV that lists no inputs keeps today's behaviour: with the bridge it presses the TV's Input key (`KEYCODE_TV_INPUT`); with no bridge the launcher opens the TV's own input screen if it has one. | The TV home launcher, the bridge, or a TV with an input screen |
| `bluetooth` | Opens the TV's own Bluetooth settings (speakers, headphones and controllers). Not in the default buttons. | The on-TV app (option C) |
| `network` | Opens the TV's own network settings (Wi-Fi and the network). Not in the default buttons. | The on-TV app (option C) |
| `tvsettings` | Opens the TV's own Settings on its main menu (the same as Home settings, TV settings). Not in the default buttons. | The TV home launcher, or the bridge |
| `screensaver` | Starts the TV's own screensaver: Google TV's Ambient mode, with the Google Photos albums. Android only lets the system start a dream, so the button cuts the screen timeout to a few seconds and nudges the idle timer until the TV naps by itself; the photos then come up a few seconds later and the timeout goes back to what it was the moment the screensaver covers the home. A second press can never leave the TV on the short timeout. | The TV home app on an Android TV or Google TV, and the "modify system settings" app-op that `apply.sh` grants |
| `extend` | LG only: presses Developer Mode's **Extend**, so LG does not remove couch-tv when the Developer Mode session runs out. The home also asks once a week whether to do it (see `extend_devmode`). It opens LG's Developer Mode app, which sends the Extend; press Home to come back to the home. | The couch-tv app on an LG TV |

A button that cannot work right now is left out, the same way the sleep timer always disappeared
when the computer was off. With no bridge at all (option A), only `look` shows, plus `input` on
TVs that have an input screen the launcher can open, and `extend` on an LG TV.

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
  rows and hands them to the bridge, because ADB cannot read them. Music and streams are never kept.
  On a Fire TV the bridge knows Amazon's builds of YouTube, Prime Video and HBO Max (other package
  names than the Google TV ones), so it opens the one the TV has and their shows reach Keep watching.
  YouTube videos are kept as a list of their own that the home shows only for the YouTube tile, never
  in the shared row or the household's taste: a video is written by the name YouTube gave it (and the
  channel and length the app reported). Opening it plays the exact video when YouTube's public
  results page is sure of it from the title and the channel or the length, resumed from the
  account's own history; otherwise (unsure, or a line with neither channel nor length) it searches
  YouTube for the name. Once the video is found the card shows YouTube's own thumbnail for it, which
  the TV fetches straight from YouTube's image host, the way it already fetches JustWatch posters;
  the found id is kept in `bridge/data/video-ids.json` with the video's length, so a bridge restart
  does not lose it, and a channel's second video of the same title (another length) is looked up
  afresh and kept beside the first rather than given its id. The bridge fetches YouTube's results page two at a
  time at most, and a video the lookup stays unsure of is asked about less and less often (ten
  minutes, then twice as long each time, up to once a day) while its card sits in the row. A live
  stream's card says so: the Loop look's row shows "YouTube · Live" under it. The thumbnail on a real
  TV's screen is not yet tested; the lookup and the watch link are (a Fire TV Cube).
- **With no computer (option A),** Keep watching is Android's own Watch Next list, plus the
  Continue Watching channel of apps that put nothing in Watch Next but keep a home screen row of
  their own instead: so far Stremio. Both are read the same read only way, with no account and no
  sign in. A channel card has no time of its own, so couch-tv notes when it first sees each card as
  it is now (its episode and how far in): what you just watched comes first. OK opens the app's own
  link for it (Stremio picks up the episode). `skip_watch_next` and `watch_next_per_app` apply to
  them too.
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

## Kids mode

New, since 0.13. Idea from Natalie Bruss (@nataliebruss on Instagram).

Optional, and off unless you set it up: a person with no `kids_mode` key is not a kids profile, and a
`config.json` with no `kids_mode` anywhere works exactly as before. Nothing makes a kids profile or a
PIN by itself; only `config.json`, the phone remote (TV, Kids mode) or the on-TV app's setup page do,
and only when you ask them to.

A person with `kids_mode` is a kids profile. While they are the one watching, the TV home is one
shelf of big posters, only the shows you put on it, and OK opens each one straight into its show in
its app. Under the shelf sit the apps you allow (up to six), if any. Nothing else: no other apps, no
More apps, no Settings tile, no app store, no Keep watching (theirs or anyone else's), no music
screen, no update questions. The phone remote's Ask is off while that profile is chosen.

```json
"people": [
  { "id": "mum", "name": "Mum" },
  { "id": "ruby", "name": "Ruby", "kid": true,
    "kids_mode": {
      "pin": "2580",
      "shows": [
        "Bluey",
        { "title": "Hey Duggee", "service": "abc-iview" },
        { "title": "Peppa Pig", "service": "abc-iview", "season": 1, "episode": 3 }
      ],
      "apps": ["abc-iview", "youtube"]
    } }
]
```

| Key | What it does |
|---|---|
| `pin` (needed) | The parent PIN, 4 to 8 digits. Without a good one kids mode stays off for that person (the bridge says so once in its log). |
| `shows` [none] | Up to 24. A plain title, or `title` with any of `service` (the app it opens in: an id from `bridge/apps.py`, such as `netflix`, `abc-iview`, `disney-plus`, `stan`, `prime-video`), `season` and `episode`. Without `service` the first free or subscription app it streams on is used, never a rent or buy page. Without `season` it opens the show's own page in the app; with one, that episode (or the season's first). |
| `apps` [none] | Up to six apps shown under the shelf: app ids from `bridge/apps.py` or Android package names. Only apps installed on that TV show. Android's Settings is never allowed. On a Fire TV with the bridge (option B), `youtube`, `prime-video` and `hbo-max` are Amazon's own builds, and the bridge hands the TV the package it has; without a bridge (option A) the kids home only knows the Google TV package, so those three do not show on a Fire TV. |

The poster on each tile comes from JustWatch, the same place Keep watching gets its pictures. `kid`
is separate and optional: it keeps someone out of the household's taste, as before.

**Going in and out.** Choosing the kids profile on the TV (or from the phone) goes straight into kids
mode, no PIN needed. It stays on through Home, Back and a restart. **Grown ups** at the top right, the
remote's Settings button or Menu button, or any number key opens the parent PIN: a number pad worked
with the arrows and OK, or the remote's number keys. Typed digits show only as dots. The right PIN moves
the TV to the first person who is not a kids profile (with no such person, it stays on the child's
profile with kids mode off until someone else is chosen). Five wrong PINs in a minute and the pad waits
a minute. With a bridge, it also checks the PIN before it lets the phone or the TV move away from a
kids profile.

**From the phone remote (options B and C).** TV, **Kids mode**: pick the person, type the PIN once,
then search for a show and tap the app to add it, remove one with the cross, pick the allowed apps,
change the PIN, or switch kids mode off. Someone who is not a kids profile yet can be made one there
with a new PIN, which is how option C (no `config.json`) sets it up. The TV shows a change the next
time Home is pressed. The PIN is never saved on the phone.

**Where it is kept.** The bridge keeps changes made from the phone in `bridge/data/kids.json`, and
that wins over `config.json` for that person from then on, like `people.json` does. A PIN typed into
`config.json` is turned into a salted hash before anything leaves the computer: the TV page,
`/tv/config.js`, `/api/config` and `/api/kids` carry only the hash, never the PIN. To start again from
`config.json`, delete `bridge/data/kids.json` and restart the bridge. The on-TV app (option C) keeps
the same thing in its own storage on the TV.

**With no computer (option A).** `apply.sh` (through `tv-home/tools/home-config.py`) looks each show
up on JustWatch from your computer while it installs, and hands the TV the link that opens it and its
poster, because the TV has no bridge to ask later. Run `apply.sh` again after you change the shelf. A
show it could not find still gets a tile; it opens its app instead of the show. The PIN and the
shelf come from `config.json` only, as there is no phone remote. A TV home app older than this
release opens the app rather than the show.

**What it cannot do, said plainly:**

- **Once a show is open, your child is inside that app** (Netflix, iview, Disney+ and the rest) and
  can browse anything the app offers. couch-tv cannot see or limit what happens inside another app.
  Pair kids mode with the app's own kids profile and limits: Netflix's Kids profile, maturity rating
  and title blocking (Profile and Parental Controls, on the Netflix website), Disney+ Junior mode,
  Prime Video's kids profile, YouTube Kids. With a bridge, list the app's kids profile name in that
  person's `app_profiles` and the bridge picks it on the "Who's watching?" screen (People, above).
- **The TV's own buttons.** On some TVs the remote's Home button, or a long press of it, can reach the
  TV's own home or quick settings. On Android TV and Google TV the Home button watch (set up by
  `apply.sh`) brings couch-tv back, and with it kids mode. Samsung, LG, Roku and the paths that need a computer at home keep
  their maker's own Home button, so there a child can leave couch-tv that way.
- **The phone remote is a grown up's tool.** It can still open any app or play any show. Keep it, and
  the pairing key if you set one, away from the kids.
- **The PIN is a lock for a child with a remote, not a password.** A four digit PIN behind a hash can
  be worked out by someone with a computer on your Wi-Fi in seconds. A longer PIN helps a little.
- The Roku channel draws its own home and does not have kids mode yet. The Apple TV app (Couch TV) has it,
  with the bridge: see [APPLE-TV.md](APPLE-TV.md#kids-mode), which also covers Apple's Restrictions, because the
  Apple TV's own TV button still opens Apple's home. The Samsung and LG apps, and the pages the paths that need a computer at home open,
  are the same home page and have it too.

## The home's look (`home`)

```json
"home": {
  "look": "night",
  "scenes": ["night", "golden", "water", "fog", "dawn"],
  "scene_seconds": 20,
  "idle_photo_seconds": 0,
  "clock": "12h",
  "dock_size": 10,
  "hide_packages": [],
  "show_packages": [],
  "language": "en"
}
```

| Key | What it does |
|---|---|
| `look` ["night"] | `night`: the scenes with the big glass clock. `loop`: one video of a place, graded for dawn, day, dusk and night, under a centred clock, bare thumbnails and a dock with no bar; option B only, and it needs the footage made by `scripts/make-loop.sh` ([LOOP.md](LOOP.md)). `oled`: the Classic grid of app banners on pure black (no photo, no video, no scenes), with a glowing focus ring and a one or two pixel nudge of the home once a minute against burn-in. Night and Classic are unchanged, and nothing goes black unless this is chosen. `classic`: your photos (or five built in) behind a grid of app banners, changing every 90 seconds unless `keep_photo` is on. The `look` quick button cycles Night, OLED, Classic and Loop on each TV, whether or not the loop files are there, and `?theme=` overrides them for a preview. A couch-tv Studio `design` is not drawn in the Loop look; it shows again in the other looks. |
| `loop` (read only) | Built by the bridge, not read from `config.json`: `{"variants": [...], "blur": true, "version": "...", "meta": {...}, "fg": true}`, the Loop look's variants whose `.mp4` is in `tv-home/web/loop/` (in the order `dawn`, `day`, `dusk`, `night`), whether every one of them has its blurred glass copy, a mark of the files that the home puts on their addresses, `meta` the folder's `loop.json` (the loop's length and motion, or null), and `fg` true when `meta` has the cut-out's rectangle and every variant has its `-fg.png` (the clock behind the peak). The bridge reads the folder afresh on every request, so after `scripts/make-loop.sh` no restart is needed. Empty when there are no files; when `look` here is `loop`, the bridge also says so once in its log as it starts (a Loop look picked on the TV logs nothing). [LOOP.md](LOOP.md). |
| `scenes` [all five] | Which Night scenes take turns, and in what order. Any of `night`, `golden`, `water`, `fog`, `dawn`, and the ids of your own scenes. One scene stays put. |
| `my_scenes` [none] | Your own scenes from any photo, each with its clock designed: where it sits, its size and font, the date above or below it, light or dark text, `cutout` for the skyline in front of the clock, and `video` for a looping clip behind it. Made with `tv-home/tools/make-scene.py`; [MAKE-A-SCENE.md](MAKE-A-SCENE.md) has every key. They take turns after the scenes in `scenes` unless they are listed there. Option A needs the app rebuilt with the scene's pictures inside (that guide says how). |
| `scene_seconds` [20] | How long each scene shows. 5 or more. |
| `clock` [the language's usual clock: `24h` in Italian, German, Turkish, French, Serbian, Polish, Czech, Brazilian Portuguese, Dutch, Romanian and Simplified Chinese, `12h` in the others] | `12h` (5:30 pm) or `24h` (17:30). |
| `idle_photo_seconds` [`0`] | `0` leaves rows on. `5`, `10`, `15`, `30` or `60` fades out the app dock, Keep watching and profile controls after that many seconds without input. The clock, weather and background scenes stay visible. Any remote button wakes the rows without opening the focused app. Home settings, Look, Hide rows when idle wins over it. |
| `keep_photo` [`false`] | Classic look only. `true` stops the background changing and holds one photo, the one showing when it was switched on. In Home settings, Look, Keep one photo you can then pick which photo it holds, and the TV remembers it after a restart (if that photo is later removed it goes back to the usual photo for the time of day). Night and OLED are unaffected. Home settings wins over it. |
| `hide_packages` [none] | Android package names never shown on the home or in More apps, for a maker's own clutter (help apps, file browsers, screen sharing tools). `survey-tv.py` lists every TV app with its package name. For example `["com.example.tvhelp"]`. |
| `show_packages` [none] | Android package names to show even though the home hides them by default (the Google TV app, `com.google.android.videos`, for example: `["com.google.android.videos"]`). Use it for apps you actually want back. |
| `updates` [none: the TV asks once] | The answer to "tell you when a new couch-tv version is out?", asked at setup: `notify` (the TV home looks on GitHub once a week and puts a dot on the gear tile) or `manual` (nothing by itself; Home settings, Updates, Check for updates now). Used only until the TV has an answer; after that the switch in Home settings, Updates wins. Option C has no updates. |
| `glass` [`off`] | Glass panels behind the clock, Keep watching and the apps: `on` (clear, softly blurred, with a light edge), `lite` (the same panels with no blur, for older or slower TVs) or `off`. Home settings, Look, Glass panels wins over it. |
| `glass_icons` [`false`] | `true`: Apple style clear app icons. Each app's symbol is cut from its own background and drawn in light glass on a glass tile, and the app you are on shows its own colours. An icon that will not cut cleanly (a photo) is shown grey and half see-through instead. Works with `glass` on or off, and the phone remote's app grid follows it. Home settings, Look, Glass app icons wins over it. |
| `moving_tiles` [`true`, or `false` when `glass` is `lite`] | The focused tile's slow sway and the light that slides across it. `false` holds it still, which stops the black box that flickers around the focused tile on some slow TVs (a TCL with a weak GPU). Home settings, Look, Moving tiles wins over it, and a TV set to reduce motion (Developer options, Animator duration scale) already holds it still. |
| `dock` [`classic`] | The Night look's dock. `mac` makes it a Mac-style dock: the focused app and its neighbours grow in a wave (the focused one 1.55 times, then 1.45, 1.25 and 1.05), all standing on one line, the dock stays centred and its tray grows with them, and the app's name shows in a small bubble above it instead of a white ring. OK presses the icon in and it hops as the app opens. A dock too wide for the screen shrinks as a whole. Home settings, Look, Mac-style dock wins over it; Lighter home holds it off. |
| `lighter` [`false`; `true` on an old or low end TV] | For a slow box (a Xiaomi Mi Box, a Fire stick) where moving along the rows stutters. `true` turns off every blur, the soft shadows under tiles and panels, the slow drift of the photo and the focused tile's sway, and asks for smaller Keep watching pictures. The layout and colours stay. Home settings, Look, Lighter home wins over it. On a TV whose WebView is too old for CSS grid (Android 6 and older, for example a Mi TV 4A with 1 GB of memory) it starts **on** until someone chooses otherwise, in Home settings or by writing `"lighter": false` here. When it is not set (here or in Home settings), the TV also checks itself: 1 GB of memory or less (`navigator.deviceMemory`) turns it on, 4 GB or more leaves it off, and in between (or when the WebView does not say) it measures its frame time for 1.5 s with something moving, a few seconds after the home opens, and keeps the answer for a week. On a 2 GB Android 11 TV the blur held the home to 22 frames a second whenever a tile was focused. Other TVs start with it off. On every TV the focused tile's sway and glint hold still 6 s after the focus last moved, so a home left alone draws nothing. |
| `render_height` [`0`: the screen's own size] | Draws the whole home at this many pixels high (for example `720`) and lets the Android TV scale it up to the screen, so a weak GPU has a quarter fewer pixels to composite. Try it when moving along the rows is slow and `lighter` did not help, even though idle the page runs at 60 frames a second. Measured on an XGIMI Elfin Flip Plus (MediaTek, Mali-G52, 1.7 GB, Android 11): with `1080` the screen showed a new frame every 33.3 ms (30 fps) in both looks, with `720` every 17 ms, and the home's memory fell from about 250 MB to 136 MB. Text and pictures are a little softer than at the screen's full size. The layout does not change: the density is lowered by the same factor. 360 to 2160; apply.sh (or the next restart of the home) sends it with the rest of `home`. |
| `app_keys` [none] | Remote buttons that open an app, for buttons the TV hands to no app (a YouTube, Netflix or shortcut key that the maker's own service swallows, seen on an XGIMI projector). A list of `"<key>:<package>"`: the key is an Android key name (`KEYCODE_BUTTON_3`), a number (`190`) or a raw Linux scancode as `scan384`, and the package is the app to open, for example `["KEYCODE_BUTTON_3:org.smarttube.stable", "scan384:com.stremio.one"]`. The package can also be `gear`, which opens couch-tv's own gear menu (Home settings, TV settings, Wi-Fi, Bluetooth, Screen off): `"scan66:gear"` makes the remote's Settings button do that where Android sends it as F8 and so never as Settings (seen on the XGIMI Elfin Flip Plus). Find a button's codes with `tvadb.py shell "getevent -lt"` and `logcat -s couchtv-keywatch` while pressing it. apply.sh switches the `KeyWatch` accessibility service on when the list is not empty (Android switches it off again after a reinstall: run apply.sh again). Every other key is left alone. |
| `hi_res` [`true`] | `"always"` uses the 3840x2160 copies even when the TV draws its interface at 1080 (a 4K panel set to a 1080 interface, where the scenes looked soft). On a TCL 75C6K with 2.4 GB that cost about 65 MB more for the home's WebView (145 MB to 209 MB), with no stutter (#191). `false` keeps the 1080 copies of the built-in pictures on a 4K screen. A 4K TV normally gets the 3840x2160 copies, which a weak chip can struggle to decode and keep in memory (an LG 43SQ700S monitor). On an LG, `lg/build.py` then leaves the 4K copies out of the app too (22 MB down to under 6 MB). |
| `glass_amount` [`3`] | How clear the glass is, `1` (frosted) to `5` (very clear): the glass panels, the glass app icons and both clocks (the frosted clock only gets more see-through at `4` and `5`). Home settings, Look, How clear wins over it, and the phone remote follows it. |
| `glass_focus` [`colour`] | With glass app icons: the focused app shows its own colours (`colour`) or stays glass like the rest (`glass`), shown by its lift, a brighter rim and a deeper shadow. Home settings, Look, Focused app wins over it, and the phone remote follows it. |
| `now_playing` [`true`] | Now playing: a card with the song any music app is playing, and previous, play or pause and next. `false` hides it. Needs option B or C. Home settings, Look, Now playing wins over it. Optional: with `SPOTIFY_CLIENT_ID` in `.env` and one login at `http://127.0.0.1:5400/api/spotify/login`, a song playing on the Spotify account anywhere (a phone, or a TV with no ADB) fills the card when the TV shows none, without the media buttons ([VIDAA.md](VIDAA.md), "Spotify"). The same login also fills a design's Up next widget with the next songs in the Spotify queue (the bridge's `/api/music/queue`, the standalone site's `api/now?queue=1`); no other music app shares its queue. The standalone home gets it from its own site, with a Play on TV button. |
| `ambient_music` [`false`] | Music screen: a full screen album cover with a colour glow, a progress bar and previous, play or pause and next, which opens when a new song starts while you are on the home. Down or Back goes back to the apps. Off by default. Needs Now playing (option B or C). On the Lighter home setting (or an old WebView) the glow is a plain colour wash with no blur or animation. Home settings, Look, Ambient music screen wins over it. |
| `nav_sound` [`system`] | The sound on every arrow and OK: `system` (the TV's own, which follows its system sounds switch), `soft` (a short, quiet tap) or `off`. Home settings, Look, Sound wins over it. |
| `clock_style` [`frosted`] | The Night look's clock: `frosted` (the photo's frosted copy, as before) or `liquid` (clear glass digits that bend the photo behind them a little, with a bright rim and a soft edge). Home settings, Look, Clock style wins over it. |
| `wx_unit` [`c`] | The weather's temperature unit: `c` (Celsius) or `f` (Fahrenheit). Home settings, Weather, Units wins over it. |
| `video_url` [none] | A looping, muted video background in place of the photo, in both looks: the address of an MP4 or MOV (`https://...`, or `http://` for a computer at home). Given here it is on; Home settings, Look switches it off or changes the link. The photo stays if the clip does not play. |
| `sun_sync` [`false`] | Follow the sun. `true` picks the Night look's scene from the sun's height at `weather.lat` and `weather.lon`: Dawn in the morning twilight, Waterline in the day (Fog when the weather is overcast or rainy), Golden hour in the evening and Night after dark, instead of rotating every `scene_seconds`. A scene you switched off is skipped. With no place set it goes by the clock. In the Loop look it picks the loop's variant the same way (night below -6 degrees, dawn while the sun rises to +10, day above, dusk as it sets back to -6), cutting at the loop's wrap; off, the Loop look shows `day` all day ([LOOP.md](LOOP.md)). Home settings, Look, Scenes, Follow the sun wins over it (ekagra-codes, #57). |
| `sun_rotate_minutes` [`25`] | With `sun_sync` on and own scenes tagged with `when` (see [MAKE-A-SCENE.md](MAKE-A-SCENE.md)), how long each scene of the current time of day stays before the next one in that group takes its turn, 5 to 240. Without any tagged scene nothing changes. |
| `date_bars` [`false`] | `true` puts a thin vertical bar between the day, the place and the weather on the Night look's date line, in place of the dots (`Monday 16 November │ Sydney │ 17° Cloudy`). Off, the line is exactly as before. |
| `ambient_weather` [`false`] | Soft rain, snow, fog and thunderstorm effects drawn over the Night look's scenes when Open-Meteo reports that weather for your place. Off unless you switch it on. It also needs Weather on, stops while an app or Settings is open, and never runs under Lighter home or on an old WebView. Home settings, Weather, Ambient weather effects wins over it (ekagra-codes, #88). |
| `ambient_sun_grade` [`false`] | A gentle tint over the Night look's scenes that follows the sun's height at `weather.lat` and `weather.lon` (cool at night, rose at sunrise and sunset, amber in the golden hour). Off unless you switch it on, and never under Lighter home or on an old WebView. Home settings, Weather, Sunlight colour grading wins over it. |
| `dock_size` [10] | How many apps sit in the Night dock before Settings and More apps. 1 to 10. Everything else is behind More apps. The phone's Arrange apps keeps to the same number. |
| `dock_banners` [`false`] | `true`: the Night dock shows each app's wide TV banner (16:9, as tall as the icon) instead of its square icon, like a streaming box's home. The dock shows one row of six; the apps after them, then Settings and More apps, wait in rows below the screen and slide up one row at a time as you press down (Keep watching fades out meanwhile, and comes back on the way up). More apps lists six to a row. Nothing else changes: the scenes, clock and Keep watching stay as they are. An app with no banner of its own gets the one the launcher draws. |
| `inputs` [none] | Pinned external inputs/consoles displayed as dock and grid tiles. They take dock places, so the last apps move behind More apps. Each item can specify `port` (e.g. `1` for HDMI 1), `label` or `name` (e.g. `"PS5"`), `icon` (`"ps5"`, `"xbox"`, `"switch"`, `"hdmi"`, `"cable"`, or `"pc"`), `match` (substring matched against TV input labels or IDs), or `id`. Optional `image`: a picture for the tile, a file inside the app such as `"backgrounds/mine/console.svg"` (SVG, PNG, JPEG or WebP; no web addresses), shown in place of the drawn icon, which comes back if the picture does not load. On an LG the tile switches straight to that HDMI input (`com.webos.app.hdmi<N>`). For example: `[{"port": 1, "label": "PlayStation 5", "icon": "ps5"}]`. A TV can have its own list instead, `tvs[].inputs` (below). |
| `soundscape` [none] | The sound the Soundscape button starts with: `"rain"`, `"fire"`, `"waves"`, `"brown"`, or `"off"`, or an object `{"type": "rain", "volume": 0.5, "fade_with_sleep": true}` (`volume` 0 to 1). It never starts by itself: only a press on the button, or the row in Home settings, plays it. With `fade_with_sleep` it gets quieter over the last 15 minutes of a sleep timer and stops when it ends. |
| `bedtime_dim` [`false`] | `true` dims the couch-tv home into a warm amber for the last 15 minutes of a sleep timer. It only darkens the couch-tv page, not an app that is playing, and not the TV's brightness or picture settings. |
| `smart_idle` [off] | Automatic OLED protection and idle power-off: `{"enabled": false, "home_idle_minutes": 15, "home_action": "ambient_clock", "paused_idle_minutes": 30, "quiet_hours": {"enabled": false, "start": "23:00", "end": "06:00", "idle_minutes": 15}}`. `home_action` is `"ambient_clock"`, `"screen_off"`, or `"tv_off"`. Setting either minute value to `0` turns that trigger off. `home_idle_minutes` is one of `5`, `10`, `15`, `30` or `60` (the same steps as Home settings), and `paused_idle_minutes` one of `10`, `15`, `20`, `30`, `45` or `60`: any other number is not an error, it is quietly read as the default (15 and 30), so `"home_idle_minutes": 2` behaves as 15. Paused-media auto-off works on Android TV (Option B and Option C) and Roku; it never turns off HDMI inputs or games with no media session, and is not available on Samsung or LG. Home settings, Smart Idle (under Look) wins over it. Off unless `enabled` is `true`. It sits beside, not over, `idle_photo_seconds` (above): that only fades the rows out, the ambient clock covers the whole screen in black after a longer wait, and the OLED look's burn in nudge is unchanged. Quiet hours are checked in the `weather.timezone` zone, else the TV's own. Option C reads only the settings made on the TV, not this file. |
| `keep_watching` [`true`] | `false` hides the whole Keep watching row, heading and all: the layout closes the gap, the remote skips it and the home stops asking the bridge for it. A song still shows its Now playing card in the Night look. Home settings, Look, Show Keep watching wins over it. Works on the Android, LG, Samsung and Roku homes. |
| `input_tile` [`false`] | `true` puts an **Inputs** tile first in the dock (Night, OLED and Classic), which opens couch-tv's own Input menu (each HDMI port by the TV's name, then Bluetooth and Network), so HDMI is one press from the apps, for a simple home (#154). It takes one dock place, like a pinned input, so the dock stays as wide as before. It shows only where the Input menu works (the TV lists its inputs, or a bridge or the on-TV app can open them) and not in a couch-tv Studio design. Home settings, Keep watching has the same switch and wins over this. With `keep_watching` set to `false` it makes the simplest home: the apps and the inputs. |
| `shelf_follows_app` [`false`] | `true` makes the Keep watching row follow the app the remote is on: while the outline is on an app tile in the dock or the grid (not More apps, Settings, an input, a Screen or a tool), the row shows only that app's cards under the heading "Recently on <app>", and under the YouTube tile that person's YouTube videos, which the bridge sends next to the row (`videos` in `GET /api/continue`, option B) and the row never shows otherwise. The filter stays while the remote goes up from that tile into the row, and the whole row comes back on any other tile or anywhere else on the home. An app with nothing on the go changes nothing: the whole row stays. Works with Android's Watch Next list too (option A, no videos there). Home settings, Look, Keep watching follows the app wins over it. |
| `start_focus` [`"people"`] | Where focus starts when the Home button is pressed or when couch-tv opens: `"people"` (as before: the profile switcher at the top left when two or more people are set up, else Keep watching if cards exist, else apps), `"keep_watching"` (the first show card in Keep watching, falling back to apps if empty), or `"apps"` (the first app in the dock or grid). Any other value is ignored and the home starts as it always has. Home settings, Look, Start on wins over it (#211). |
| `custom_cards` [none: off] | Your own cards at the end of the Keep watching row, from a small JSON file: a file on the bridge computer (`"cards.json"`, read from the folder `config.json` is in, or an absolute path) or an `http` or `https` link (`"https://raw.githubusercontent.com/you/repo/main/cards.json"`, or a Raspberry Pi on your Wi-Fi). Display only: a title, a value, a subtitle, a picture, and an installed app or an `http(s)` link for OK; at most 8 cards, nothing in the file is ever run. Read every 10 minutes; a bad file keeps the last good cards. Example: `{"cards": [{"title": "Solar today", "value": "18.4 kWh", "app": "com.example.solar"}, {"title": "Bin night", "value": "Recycling", "url": "https://example.com/bins"}]}`. The schema and limits: [TV-HOME.md](TV-HOME.md#custom-cards). |
| `skip_watch_next` [none] | Package names never shown in the Keep watching row (e.g. `["com.google.android.youtube.tv"]`). |
| `watch_next_per_app` [5] | The maximum number of Keep watching cards to show from any single app (1 to 20). |
| `language` [the TV's own language if the home speaks it, else `en`] | The TV home's language until someone picks one in Home settings: `en` (English), `es` (Spanish), `es-MX` (Mexican Spanish), `it` (Italian), `de` (German), `tr` (Turkish), `fr` (French), `sr-Latn-RS` (Serbian Latin), `pl` (Polish), `cs` (Czech), `pt` (Brazilian Portuguese), `nl` (Dutch), `ro` (Romanian) or `zh-CN` (Simplified Chinese). The phone remote has its own choice, "Same as the TV" by default; Romanian is not available as a separate phone language yet. |

## Design (`design`, from couch-tv Studio)

Optional, top level, beside `home`. couch-tv Studio (a website for designing this home) writes it:
download your design there and paste its `design` key into `config.json`. It is laid over the Night
home by `tv-home/web/design.js`. The Loop look draws no design (its loop is the background); pick
another look to see it. **Without a `design` key the home is exactly as before.** Every
value is checked on the TV, and anything it does not understand is left out.

**A design is treated as untrusted.** Before anything is drawn, the home rebuilds it from an
allowed list (`CouchDesign.sanitize` in design.js): unknown keys are dropped at every level,
numbers are clamped, choices come from fixed lists, colours only as `#rrggbb` or `rgb()`/`rgba()`,
fonts only from the list below, and every word is drawn as text, never as HTML. **There are no
outside links in a design:** pictures come only from the TV (`backgrounds/...`) or inside the design
as a JPEG, PNG or WebP; `http`, `https`, `//`, `javascript:`, `file:` and SVG are refused, and
`design.home` never carries `video_url`. An outside picture would tell a stranger the TV's address
the moment it loaded. The bridge also leaves out any value that looks like a link or markup before
it hands the design over.

**A design can never lock someone out.** Settings and More apps cannot be hidden or taken out of
the dock; a hidden dock keeps just those two; the dock is never smaller than half size or fainter
than 40%; everything in front of the home (cards, words, widgets, clocks) may cover at most 30% of
the screen (past that it goes behind), no card or word alone more than a quarter, and cards and
words together at most 60% (the rest are left out); the home's own parts have size limits (clock 3x,
people and quick buttons 3x, Keep watching 1.5x); and the remote never lands on a part the design
hides or moves mostly off the screen. **Holding Back for about 5 seconds** (or pressing it 5 times
quickly) switches designs off on that TV and shows the normal home. They stay off, whatever design
arrives next, until **Home settings, Look, Your design** turns them back on. **Words with a phone
number or a web address are never drawn** (`CouchDesign.flags` finds them; couch-tv Studio warns
before download). **A design is kept cheap to draw:** at most 40 objects, 6 frosted cards (and about
a screen and a bit of frosted area), 8 turned objects, 10 glows, a 16 px background blur, and a
total under 100 on the speed meter's weights (`CouchDesign.cost`: rain and snow 34, the liquid
clock 6, and so on); past that the heaviest extras are switched off, rain and snow first. Anything
over is brought within it, and `CouchDesign.check` says what changed. `background.colour` (a plain
colour, `#000000` for a black screen) can stand in for `background.image`; a widget object may carry
`w` and `h`, the box its card fills (couch-tv Studio's grid sets them).

```json
"design": {
  "v": 1,
  "home": { "scenes": ["night"] },
  "background": { "image": "backgrounds/aresquiers-beach.jpg", "darken": 0.15, "zoom": 1, "x": 50, "y": 50, "blur": 0 },
  "elements": {
    "clock": { "x": -740, "y": 700, "scale": 0.3, "style": "solid", "font": "inter", "weight": 300, "colour": "#ffffff", "shadow": "soft", "format": "24h" },
    "date": { "format": "short", "x": -718, "y": 870, "scale": 0.74 },
    "weather": { "place": false },
    "keep_watching": { "hidden": true },
    "dock": { "panel": "solid", "icon_shape": "circle", "icon_tone": "mono" }
  },
  "apps": { "order": ["com.netflix.ninja", "com.google.android.youtube.tv"], "hidden": [], "tiles": { "com.netflix.ninja": { "scale": 1.2 } } },
  "texts": [{ "text": "Welcome. Make yourself at home.", "x": 80, "y": 660, "size": 60, "weight": 650 }]
}
```

| Key | What it does |
|---|---|
| `elements.<part>` | One of `clock`, `date`, `weather`, `people`, `quick`, `keep_watching`, `dock`. `x` and `y` move it from where it normally sits, in pixels of a 1920x1080 screen (so it lands in the same place on any TV); `scale` sizes it (0.2 to 6). `hidden: true` hides it (it shows again while the remote is on it, once a key has been pressed); `opacity` 0.1 to 1. In a design every part keeps one place whichever scene is showing, and the weather is its own part under the date. |
| text styles | On `clock`, `date`, `weather`, `keep_watching` (its heading) and `texts`: `font` (`inter`, `antonio`, `condensed`, `serif`, `mono`), `weight` (100 to 900), `colour` (`#rrggbb` or `rgba(...)`), `shadow` (`none`, `soft`, `strong`), `case: "upper"`. |
| `clock` | `format` `12h` or `24h` (wins over `home.clock`). `style` `glass` (the frosted photo digits, the default) or `solid` (in `colour`). The scene's hills stand in front of the clock only with `behind: true`, because a moved clock would vanish behind them. |
| `date` | `format`: left out is "Tuesday 17 November"; `short` "Tue 17 Nov", `day_month` "17 November", `weekday` "Tuesday", `numeric` "17/11/2026", `full` with the year. |
| `weather` | `place: false` hides the place name, `words: false` the words ("Partly cloudy"). |
| `panel` | On `people`, `quick`, `keep_watching`, `dock`: `glass` (frosted, the default), `solid` (no blur, lighter for a slow TV) or `none`. |
| `dock` | `icon_shape` `rounded`, `circle` or `square`; `icon_tone` `colour`, `mono` (black and white until focused) or `dim`. |
| `apps` | `order`: the dock's apps, in order (only those, up to ten; the rest are behind More apps). `hidden`: apps taken off the dock. `tiles.<package>`: `x`, `y`, `scale` for one app's tile. Settings and More apps always stay. |
| `background` | Your own picture over the scenes: `image` is a file in the app (`backgrounds/...`) or a JPEG, PNG or WebP data URL (couch-tv Studio makes these, 1920x1080); never a web address. A picture that does not load leaves the normal scenes. `darken` 0 to 0.9, `zoom` 1 to 4, `x` and `y` 0 to 100 (which part shows when zoomed), `blur` in pixels. The glass clock shows this picture through its digits. `video` (with `image`, which is then its still picture): a short muted loop played over the picture, either a file on the TV (`backgrounds/loop-rain.mp4`, `loop-fire`, `loop-ocean`, `loop-clouds`, or your own in `backgrounds/mine/`) or `store:<id>`, a video the design store keeps; never a web address. MP4 with H.264 or WebM with VP8 or VP9, at most 15 s, 1920x1080 and 8 MB (1280x720 and 4 MB for the store's 720p copy). An official couch-tv Studio gallery design's `store:` video may also have a long seamless loop, up to about 4 minutes and 24 MB at 1080p (16 MB at 720p); only a TV with 2 GB of memory or more asks for it, it falls back to the 15 s copy if the loop does not arrive within 3 minutes, and once a store video has played the TV keeps one copy (the current design's) and plays it from there. The picture shows first and stays with Lighter home, in power save, on a TV that drops frames (for a week), while an app is open, and whenever the video cannot play (Home settings, couch-tv Studio, Your design says why). `blur` is not used with a video. `loop-clouds.jpg` with `depth: true` puts the clock behind its hills. |
| `texts` | Up to eight lines of your own words: `text` (200 characters), `x`, `y` (the top left corner), `size` in pixels, and the text styles. Older designs; newer ones use `objects` of type `text`. |
| `rotate`, `shade` | On parts (not the clock or the dock): `rotate` in degrees. On text parts and objects: `shade` `glow` (a wide dark glow) or `panel` (a dark panel behind the words; on the clock, a dark pool under the digits), to read them on a busy photo. |
| dock layout | On `elements.dock`: `layout` `row` (the default), `column` or `grid` (with `columns`), `icon_size` and `icon_gap` in pixels (112 and 26), `labels` `focus` (the default), `always` or `off`, `label_pos` `below` or `right`, `icon_shape` also `squircle` or `none` (the app's symbol with no tile), `icon_style` `colour`, `mono`, `glass`, `outline` or `dark`. A row too long for the TV's safe area wraps onto more lines instead of running off the screen. The remote follows the shape: up and down move along a column (a side rail), left and right step off it to the shows, and More apps opens in its usual place. With `labels: "always"` a long name shows by its first word. |
| `apps.tiles.<package>` | Also `icon_shape` and `icon_style` for one app, and `free: true` with `x`, `y` (its top left corner on the screen) and `scale` to put that app anywhere. It stays in the dock's list, so the remote still reaches it and OK still opens it. |
| `objects` | Up to 80 things of the design's own, each with an `id` (letters, digits, `-`, `_`), `type`, `x`, `y`, `scale`, `rotate`, `opacity`, `hidden`, and `layer` `front` (over the home, the default) or `back` (behind the clock, the dock and the rest). Later in the list is drawn on top. `text`: `text`, `size`, `align` and the text styles. `shape`: `variant` `glass`, `solid`, `outline` or `line`, `w`, `h`, `radius`, `colour`. `clock`: `size`, `format`, `date: true` and `date_format`, text styles. `weather`: `style` `line`, `card` or `big`, `place: false`. `smart`: `kind` (`aircon`, `light`, `speaker`, `camera`, `doorbell`, `network`, `devices`, `vacuum`, `appliance`, `scene`), `style` `tile`, `pill`, `icon` or `card`, `name`, `status`, `value`, `on: false`, `zones` (aircon) or `items` (scene buttons), `panel` `glass`, `solid` or `none`. On the TV a smart home object never shows a reading it does not have: an `aircon` widget reads its room (`entity`, else the first) and lists the other rooms as zones, and a `scene` widget lists the scenes, both from the Home Assistant section of this file through couch-tv's smart home; every other kind, and these two without Home Assistant, shows its name and "Not connected". The demo readings saved in the design show only in couch-tv Studio, marked Demo. Objects do not take the remote's focus. |
| `home` | Look settings carried with the design: `scenes`, `scene_seconds`, `glass`, `glass_icons`, `glass_amount`, `clock_style`, `ambient_weather`, `ambient_sun_grade`, `dock`, `moving_tiles`, `lighter`, `keep_watching`, `now_playing`, `dock_size`, `clock` (never `video_url`: a design carries no links). They win over the same keys in `home`; Home settings on the TV still win over both. |

**Widgets: OK, sizes and what each needs.** In a widget design, OK on a widget opens its detail
layer (`tv-home/web/widget-detail.js`): the widget grows into a sheet over the home, Back shrinks it
back. A clock opens Timers (kept on the TV), the weather the 24 hour and 7 day forecast, a photo the
full screen slideshow, Now playing the player (previous, play or pause, next, volume), Aircon every
room (warmer, cooler, on and off, mode and, when Home Assistant lists them, fan speeds), Scenes every
scene, Keep watching every show with Resume, an app folder every app. A widget whose own buttons do
things (a row of scenes, a poster row) keeps them, and its layer is the first item of Hold OK. What
each widget needs, where that is set up, which TVs can run it and the sizes it comes in are in
`tv-home/web/widget-caps.js`; a TV with nothing real for a widget shows that record's setup card, and
OK on the card opens the whole record. It never shows pretend data. The air quality and surf widgets
ask Open-Meteo's free air quality and marine services, only while one is on the home.

**Things typed at home (Home settings, couch-tv Studio, At home).** The Family note, List, Guest
Wi-Fi, House guide, Agenda and Screen time widgets show what is typed on the TV itself, with the remote
or the phone remote's Type on the TV: a note and who it is from, up to 3 lists of 40 items (OK on the
List widget opens it, OK ticks an item), the guest network's name, password and security, up to 8 guide
entries, a calendar's private address, and a daily screen time goal. Privacy:

- It is kept on that TV only (`tv-home/web/athome.js`). On the Android home it goes in the app's own
  `athome` store, which Android's backups and device transfers leave out (like the Home Assistant token);
  on a TV that runs the home as a web page, in that page's storage. It is not in `config.json`, not in
  Home settings' copy the bridge keeps (`/api/settings`), never in a design (design.js drops every option
  these widgets could carry), never in Open this home in couch-tv Studio (which also refuses to share if any of it turns
  up), and never sent to couch-tv Studio or any server of couch-tv's.
- The calendar address is a password: Home settings shows only its host. The Android home reads it
  itself (https only, no cookies, at most 3 https redirects, 4 MB, and only an answer that is a
  calendar). A TV whose home a computer runs asks the bridge (`POST /api/calendar`), which reads it the
  same way, refuses any address on the home network, and keeps and logs nothing. The home as a website
  (VIDAA with no computer) can only read a calendar that lets web pages read it, which Google, Apple and
  Outlook do not. Today and the next 7 days are kept on the TV (titles and times only).
- On this day reads the day each photo was taken: the Android home notes it in the photo's file name
  when Home settings copies it in (from the photo's EXIF block; photos added before this have no day);
  a photo by web address gives its day from its own bytes, when its host lets the TV read them, or from
  a date in its name.
- Screen time reads Android's own usage numbers (time in each app today, this home not counted), only
  once usage access is allowed: `apply.sh` with `SCREEN_TIME=1`, or the TV's own Usage access screen
  (Home settings, At home, Allow screen time). `undo.sh` takes it back. Not possible on Samsung, LG,
  Hisense or the other web TVs.

**Web widgets: where their data comes from, and what stays on the TV.** Headlines, Scores, Markets
and Commute read free sources with no key and no account, and no couch-tv server is in the way
(`tv-home/web/widget-web.js`). Each source is asked only while its widget is on the home, at most
once per refresh, and the last answer is kept in the TV's own storage (`tvhome.webdata`) so a
reload asks nothing.

| Widget | Source | How often | What it sends |
|---|---|---|---|
| Headlines | A public RSS feed picked in the design (`opts.feed`: `abc` (default), `abc-justin`, `abc-sport`, `abc-business`, `sbs`, `guardian`, `bbc`, `rnz`), for personal, non commercial reading | 15 minutes | Nothing: the feed is fetched by its id |
| Scores | ESPN's public scoreboards (`opts.league`: `afl`, `nrl` (default), `aleague`, `epl`, `nba`, `bbl`, `cricket`; `opts.team` puts a team first). Unofficial and undocumented, so they may change | 2 minutes while a game is on, else 15 | Nothing |
| Markets | Yahoo Finance's public chart data (`opts.tickers`, up to six symbols such as `BHP.AX`, `^AXJO`, `AUDUSD=X`, `BTC-AUD`; the ASX 200, the dollar and Bitcoin by default). Unofficial, for personal use, ASX prices about 20 minutes late | 10 minutes | The symbols |
| Commute | OSRM's route server with OpenStreetMap roads; the usual drive, no live traffic | When the places change, then 6 hours | The two places, rounded to about a kilometre |
| Picks for you | This TV's own Keep watching (everyone's, but never a kids or guest profile's shows) | Never asks anyone | Nothing |

A news feed and a share price send no CORS header, so the TV asks through a relay that is part of
couch-tv at home: the bridge or the on-TV app (`GET /api/webdata`, bridge/API.md), or with neither,
the launcher itself (`http://tvos.invalid/webdata`). The relay knows only the ids above, never a
link. The website home on a Hisense (no computer) has no relay, so Headlines and Markets say they
need a home computer there; Scores and Commute ask their services straight from the TV.

The commute's places are never in a design: from the town in Home settings, Location, to the town or
suburb picked in Home settings, couch-tv Studio, Commute (shown while a design has the widget). The
second is kept on the TV only (`tvhome.commute`), not in the settings the bridge keeps, and Share
this home stops if it would send it. A design's Commute widget carries only its label, the arrive by
time (`arrive_h`, `arrive_m`), the minutes to spare (`buffer`, 10 unless set) and `weekdays`.

Scores and Markets are marked as unofficial (their sources are unofficial). The design store can pause any of
these sources for every TV without an update: the TV asks `<design_store>/v1/config/sources` at most
once a day, only while a web widget is on the home, with no cookies and no referrer, and keeps the
answer for the day. `{"v": 1, "paused": ["sports"]}` pauses Scores; a paused source is never asked and
its widget says "This feed is paused". No store (`"design_store": ""`), no answer or a bad one means
everything on.

Every web widget is centred unless the design sets `opts.align` (`left` or `right`), and fits its
box at every size: words wrap and shrink (never under 23 px) and whole items are left out before
anything is cut off.

The whole block must stay under 4 MB (a photo inside it is the big part). The bridge passes it to
the home as it is, in `/tv/config.js` (option B), and the standalone build carries it. `apply.sh`
(option A) hands the settings to the app inside an Android intent, which is far too small for a
photo: there, put the picture in `tv-home/web/backgrounds/mine/`, rebuild the app, and name it in
`image` (`backgrounds/mine/your-photo.jpg`) instead of the data URL. couch-tv Studio's download
already does this: a design with your own photo comes as a zip with the photo as its own file and
the design pointing at it. Not yet tried on a real TV.

**Getting a design by code (`design_store`).** With `"design_store": "https://designs.example"`
(https only, no path; `http://127.0.0.1` or `localhost` for development), Home settings, Look has
**Get a design**: type the code couch-tv Studio's Send to my TV shows (`ABCDE-FGHJK`, or the long
`CTV1-...` one from its QR code). The TV asks that one server, with the code and nothing else (no
cookies, no referrer), and keeps the design in its own storage (`couchtv.design.fetched`); it wins
over a `design` in this file until **Remove the design I got**. The only picture it takes is a JPEG
inside the answer. A design got this way always shows "Use this design?" first: getting one clears
the TV's record of any design it said yes to. Without `design_store` the rows do not show. The
browser preview takes `?mock=1&designstore=http://127.0.0.1:5490`. English only for now.

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
- **New apps:** the Play Store or Amazon Appstore is the **App Store** tile, near the end of More apps
  by default. Move it onto the home or rearrange it like any other app. An app installed later
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
`config.example.json`) and nothing set up on the TV, nothing changes on anyone's TV: no tile, no calls
to anything, no extra permission. It works with option A (no computer) and option B (bridge), because
the TV app talks to Home Assistant itself.

**Set up on the TV, no computer and no file.** Home settings, couch-tv Studio, **Smart home**: type
Home Assistant's address (usually `http://homeassistant.local:8123`), paste a long-lived access token
with the phone remote's Type on the TV, and the TV lists everything Home Assistant has that couch-tv
can show (never locks, alarms, garage doors or gates). Tick what you want and pick **Save and show on
the home**. The TV keeps the address and token in the app's own private store, exactly as if
`apply.sh` had sent this section; the page never gets the token back. **Change what shows** reads Home
Assistant again with the kept token, and **Disconnect smart home** removes both. A later `apply.sh`
with no `home_assistant` section leaves a set up made on the TV alone; one with a section replaces it.
**Add a device we don't list** walks through getting a device into Home Assistant first (Tuya and
Smart Life, Google Nest, Alexa devices, Apple Home and Matter, Hue, aircon, solar, and anything with a
web address or MQTT through Home Assistant's RESTful, MQTT or Webhook integrations).

**Samsung, LG, Hisense, Philips, TiVo OS and Panasonic** (a computer runs the home): the same Smart
home screen works, and the bridge talks to Home Assistant for the TV (`bridge/smarthome.py`, `/api/ha`).
The address, token and ticks are kept in `bridge/data/home-assistant.json` (mode 600, git ignores it);
without one the bridge uses this section and `HOME_ASSISTANT_TOKEN`. The website home on a VIDAA with
no computer cannot reach Home Assistant.

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
| `controls` | Up to 16 lights, switches, fans and blinds (`light.*`, `switch.*`, `fan.*`, `cover.*`) for a design's **Control Centre** widget. Never a lock, an alarm, a garage door or a gate: `lock.*` and `alarm_control_panel.*` are refused, so is a `cover.*` or `switch.*` whose id says garage, gate, door or lock, and on the TV a blind Home Assistant calls a garage door, gate or door is shown but never switched. |
| `cameras` | Up to 4 cameras (`camera.*`) for the **Camera** widget: a still picture, new every 2 seconds, never video. |
| `sensors` | Up to 8 sensors (`sensor.*`, the pool, a rain gauge, humidity) for the **Sensor** widget: the reading and its last 24 hours. |
| `energy` | One sensor for the **Solar and energy** widget: `entity`, either today's energy total (kWh or Wh, the kind that counts up through the day) or power (W or kW); `name` (optional); `battery` (optional): a home battery's charge in %. |
| `speakers` | Up to 6 speakers (`media_player.*`, anything Home Assistant plays on: Sonos, Google, others) for the **Speakers** widget: what each plays, its volume, louder, quieter, play and pause. |

Each takes `{ "entity": "...", "name": "..." }` (the name is optional, else Home Assistant's own), the
same as `climate`. For example:

```json
"controls": [{ "entity": "light.lounge", "name": "Lounge" }, { "entity": "cover.blinds", "name": "Blinds" }],
"cameras": [{ "entity": "camera.backyard", "name": "Backyard" }],
"sensors": [{ "entity": "sensor.pool_temperature", "name": "Pool" }],
"energy": { "entity": "sensor.solar_energy_today", "name": "Solar", "battery": "sensor.home_battery" },
"speakers": [{ "entity": "media_player.kitchen", "name": "Kitchen" }]
```

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
- for a design's widgets: read and switch a listed control (on, off, open, close; never a garage
  door, gate or door), read a listed sensor and its last 24 hours, read the energy sensor's history
  for today, read a listed speaker and set its volume or play and pause it, get a still from a listed
  camera, and read when the doorbell last rang

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

**The smart home widgets** (couch-tv Studio designs: Control Centre, Camera, Doorbell, Solar and
energy, Sensor, Speakers). Each shows only what this section lists; a design can only pick among
them by entity id, and a TV without them shows the widget's set up card instead. They are asked only
while a widget for them is on the home and the home is in front, never while an app plays: switches
and speakers every 10 seconds, the doorbell every 8, sensors every minute and their last 24 hours
every 15 minutes, energy every 5 minutes, and a camera's still every 2 seconds (stills only, kept in
memory, never saved or sent anywhere). The Doorbell widget shows when it last rang (Home Assistant's
own record, or the ring this TV saw), with the still the TV kept from that ring while the card was up
(in memory only, gone when the app restarts), else the door camera now. Energy and sensor history
come from Home Assistant's history, so a sensor Home Assistant does not record shows no curve, and
one that writes many times a second may be too much to draw (it then says so).

**Not supported:** live camera video, locks, alarms, garage doors and gates (on purpose: nothing that
opens the house from a TV remote), and anything Home Assistant cannot reach (Smart home, Add a device
we don't list, says how to add one). On Samsung, LG and the other web TVs smart home needs the home
computer on; the doorbell card that slides in over apps needs a Google TV, Android TV or Fire TV.

## Philips Hue and AirTouch 5 with no Home Assistant (option B)

With a computer at home, couch-tv talks to a Philips Hue bridge and an AirTouch 5 aircon console
itself, the way Home Assistant would, on every TV it serves (Google TV and Android TV too, beside any
Home Assistant things). Set both up on the TV: Home settings, couch-tv Studio, Smart home.

- **Philips Hue:** type the Hue bridge's address (Hue app, Settings, Bridges, the i button), press the
  round button on top of the Hue bridge, then Pair within 30 seconds. Tick up to 16 lights. They show
  as `light.hue_<number>` in a design's Control Centre widget: on and off, with the brightness shown.
- **AirTouch 5:** Find the console (it answers on the Wi-Fi), then Connect. Each zone shows as a room
  in the Smart home tile and the Aircon widget: on, off and its own temperature (zones the console
  runs by percentage switch on and off only). Cooling or heating stays as set on the wall: couch-tv
  never changes the unit's mode from a TV remote. A TV cannot open the console's own port (TCP 9005)
  from a web page, so AirTouch always goes through the home computer. It needs `airtouch5py`, which is
  in `bridge/requirements.txt`.

What the TV sets up is kept in `bridge/data/direct.json` (mode 600, git ignores it). The Hue key never
goes to the page. The same can be written by hand:

```json
"hue": { "bridge": "192.0.2.30", "lights": ["1", "4"] },
"airtouch": { "ip": "192.0.2.31", "zones": ["Living", "Bed 1"] }
```

with the Hue key in `.env` as `HUE_USERNAME=` (made by pressing the button and sending
`{"devicetype": "couch-tv#home"}` to `http://<hue bridge>/api`). `zones` left out shows every zone.

## Guests: names and times from a bookings calendar

For a holiday let or a guest room. A couch-tv Studio design's **Welcome** widget can take the guest's
name from a calendar (Guest name from: Bookings calendar): "Welcome, Sarah" from the day before check in
until check out, with "Check in from 3pm" or "Check out Sunday at 10am" under it. Between stays it shows
the design's own words. This is the way guest-tv, our sibling project for guest TVs, does it.

On the TV: Home settings, couch-tv Studio, At home, **Guests**. Paste the calendar link Airbnb
(Calendar, Availability, Connect calendars, Export calendar), Booking.com or VRBO gives you, and set
**Check in from** and **Check out by** (calendars hold days, not times). Without a bookings link the
Agenda's own calendar is read, and there only events titled like "Stay: Sarah" count. The link, the
times and the names stay on the TV; nothing goes in a design. It is read every 15 minutes, by the TV
itself on a Google TV, Android TV or Fire TV, and by the home computer on the web TVs.

Where the name comes from, first that has one:
1. A name typed on the TV for that stay (At home, Guests, Next guest).
2. Airbnb's "reservation confirmed" emails, read by the home computer (option B), matched by arrival day.
   Airbnb's calendar link only says "Reserved"; the email has the first name and the number of guests.
   Either save the emails into `bridge/data/bookings-inbox/` or let the bridge read the mailbox (read
   only, every email left unread):

   ```json
   "bookings": { "imap": { "host": "imap.gmail.com", "user": "you@example.com" } }
   ```

   with an app password (not your real password) in `.env` as `BOOKINGS_PASSWORD=...`. The names stay on
   that computer and the TV (`/api/stay-names`). Written from guest-tv's reader and its made up sample
   emails: not yet checked against a real Airbnb email.
3. The calendar event's own title: VRBO and many channel managers write "Reserved - Sarah Smith";
   Booking.com and Airbnb write no name.

Preview with no TV and no Home Assistant: `?mock=1&ha=1` (see the end of this page). The doorbell
card is drawn by the app itself, so it cannot be previewed in a browser.

## Plex (optional, option B)

Off unless you add it. With no `plex` section (or `"enabled": false`) nothing changes: no calls to
anything, Keep watching as before.

The bridge only learns of a Plex play it sees on the TV, a minute into playback. The Plex Media
Server itself keeps a **Continue Watching** list for the account: shows and films left half way on a
phone, on another TV, or before couch-tv existed. With this section the bridge reads that list every
five minutes and gives each item a Keep watching card next to the plays it logs itself, with the
show's season, episode and how far in it is (the progress bar), and the server's own poster.

```json
"plex": {
  "url": "http://your-computer.local:32400",
  "who": "person1"
}
```

And the token in `.env` (never in `config.json`):

```sh
PLEX_TOKEN=<your X-Plex-Token>
```

| Key | What it does |
|---|---|
| `url` (needed) | The server's address as the bridge computer reaches it, `http://` or `https://` with the port (32400 unless you changed it): the name or the number address of the computer Plex runs on, on the home network. |
| token (needed) | `PLEX_TOKEN` in `.env`. The token of the Plex account whose list this is. Finding it: [Plex's own article](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/) (in Plex Web, any item's **Get Info**, **View XML**: the address ends in `X-Plex-Token=...`). The bridge keeps it to itself: it goes to the server in a header, is never written to a log, and the TV and the phone get the pictures through the bridge (`/api/plex/art`), never the token or the server's address. |
| `who` | Whose cards they are: a person's `id` or `name` from `people`. Left out, everyone sees the same cards. A name that is not a person shows them to nobody, and the bridge's log says so. |
| `enabled` [true] | `false` switches it off and keeps the rest of the section for later. |

**One account.** A Plex server keeps one Continue Watching list per Plex account, and a token belongs to
one account, so the bridge reads one list. With Plex Home (several users on one server) the token
decides whose list it is; a second user's list would need that user's token, which the bridge does not
do yet. `who` is how you say which person on the couch it belongs to.

**On the TV and the phone.** A Plex card looks like any other: the show and its episode, or the film,
newest first, one card per show, nothing older than 30 days, up to 10 with the bridge's own. When
both the bridge and Plex know a show, the newer of the two is the card (Plex names a show with its
country, "The Office (US)", and the bridge as JustWatch does, "The Office": they count as one; two
different brackets, "The Office (UK)" and "The Office (US)", are two shows). The card opens the show
in Plex the way a Plex card already did: the show's page when JustWatch knows the title by that
name, or the Plex app for you to pick it (a home video, say; the search's nearest guess at a name
it does not know is never played in its place). Removing a card (hold OK on the TV, the cross on
the phone) keeps it off until it is watched again, for the person it was shown to, or for everyone
when nobody was picked. Plays the bridge sees on the TV are still logged as before.

**Checking it.** `GET /api/plex/status` on the bridge says whether the section and the token are
there, the server's name, how many items the last read gave and any error (never the token). The
bridge's log has one line at the first read, `plex: Continue Watching from <server name>`, one
warning when the server stops answering and one line when it answers again; the last good list is
kept in between. The error in the status is a plain reason ("the server is not reachable"), never
the server's address. A `url` the bridge cannot use (no `http://`, a path on the end) switches the
section off and says so, at start and in the status. A server that is off or away never holds the
home up: the hub is read in the background, and a read gives up after 10 seconds.

## Everything else

**Never forward a port to the bridge.** The bridge is built for your home network only. Never expose it
to the internet or forward port 5400 on your router. A private network (VPN) app you run yourself
is the safe way to use the phone remote away from home.

| Key | What it does |
|---|---|
| `bridge.host`, `bridge.port` [5400], `bridge.fallback_hosts` | Where the bridge runs. `fallback_hosts` lists other names the bridge may be opened by (see "Opening the bridge by another name" below). |
| `bridge.pairing_key` [""] | Optional API pairing key. Empty/unset by default. When set, clients (phone remote and TV front-ends) must authenticate with this key. |
| `weather` | `lat`, `lon`, `place`, `timezone`, for the weather on the home (Open-Meteo, no key). A suburb or city is enough; never a home address. `timezone` (for example `Europe/London`) is also the time zone the bridge writes times in. |
| `country` [`IT` for Italian, `DE` for German, `BE` for Dutch, `RS` for Serbian, `IL` for Hebrew, `CZ` for Czech, `PL` for Polish, `BR` for Brazilian Portuguese, `SA` for Arabic, `RO` for Romanian, `CN` for Simplified Chinese, else `AU`] | Two letter code, for where shows stream (JustWatch), the country in links to Apple TV and Prime Video, and the country Claude is told about. |
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
background, your own photos (up to 50; each one lives in the TV's own storage and is loaded into its memory when it shows, so an old or low memory TV is happier with fewer), the
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
