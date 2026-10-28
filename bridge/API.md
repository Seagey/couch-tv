# TV bridge API (contract for the phone remote and the TV home)

The bridge is the only thing that talks to the TV. Build against this file. If something here
changes, the change is written here first, with a dated note at the bottom.

## Where it lives

| What | Address |
|---|---|
| Base URL, home network | `http://<your-computer>.local:5400` (host and port come from `config.json`) |
| Same, on the computer itself | `http://127.0.0.1:5400` |
| Phone remote | `/` serves `remote/dist/` (run `npm run build` in `remote/`) |
| TV home screen | `/tv/` serves `tv-home/web/` |
| API | everything under `/api/` |

- Plain HTTP on the home network. No password (home network only). Never put the bridge on the internet.
- CORS is open (`Access-Control-Allow-Origin: *`), so you can develop against it from another port.
- Use **relative URLs** (`/api/now`) in both front ends. Then they work from any device at home.
- Static files are sent with `Cache-Control: no-cache`, so a rebuild shows on the next load.
- Unknown paths under `/` and `/tv/` fall back to that folder's `index.html` (single page apps work).

## Shape of every answer

Every response is JSON.

- Success: HTTP 200, `{"ok": true, ...fields}`.
- Failure: HTTP 4xx or 5xx, `{"ok": false, "error": "<short plain English reason>"}`.
  - `400` you sent something wrong (missing field, unknown key or app).
  - `404` not found (no show by that name, unknown screen id).
  - `503` the TV is not reachable right now (off at the wall, Wi-Fi). Show a gentle "TV not
    connected" state, the bridge keeps retrying on its own.

## Which TV (more than one TV)
The bridge can run more than one TV. Every endpoint takes an optional TV id:
- `GET`: `?tv=<id>`. `POST`: `"tv": "<id>"` in the JSON body (or `?tv=` on the URL).
- Leave it out and you get the default TV (`default_tv` in `config.json`). Nothing changes for clients
  that never send it.
- TV ids are the `id` values in the `tvs` list in `config.json`. A TV that is not paired gives `503` "not paired yet".
- `/api/events?tv=<id>` streams that TV. `who`, watch history, keep watching and picks are
  shared by the household, not per TV; `playing`, `sleep` and `power` are per TV.

### `GET /api/tvs`
```json
{"ok": true, "default": "living-room", "tvs": [
  {"id": "living-room", "name": "Living room", "paired": true, "connected": true, "adb": true,
   "power": "on"},
  {"id": "bedroom-tv", "name": "Bedroom", "paired": false, "connected": false, "adb": false,
   "power": "unknown"}
]}
```

## Endpoints

### `GET /api/health`
```json
{"ok": true, "tv_connected": true, "adb": false, "version": "1"}
```
`adb` tells you if the ADB features (screenshot, deep links that need it) are switched on.

### `GET /api/now`
What is on the TV right now.
```json
{
  "ok": true,
  "tv_connected": true,
  "power": "on",
  "app": {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja"},
  "volume": {"level": 12, "max": 100, "muted": false, "known": true},
  "playing": {"title": "Bluey", "season": 3, "episode": 4, "service": "abc-iview",
              "poster": "https://...jpg", "backdrop": "https://...jpg", "started": "2030-01-01T19:31:00Z"}
}
```
- `power`: `"on"`, `"off"` or `"unknown"`.
- `app`: `null` when not known. `id` is `null` for an app the bridge has no name for (the raw
  `package` is still given). `id` `"home"` means a home screen (ours, `app.couchtv.launcher`, or
  Google's).
- `volume.known` is `false` when the TV does not report a level (this TV reports `max: 0` while
  sound goes out to an external speaker). Then hide the slider, keep the up and down buttons.
- `playing`: what is on, `null` when nothing is known. Needs ADB. Fields:
  - `title`, `episode_title`, `season`, `episode`, `service`, `poster`, `backdrop`.
  - `source`: `"bridge"` when the bridge started it with `/api/play`, `"tv"` when it came from
    the app's own "now playing" report (shows started by hand).
  - `state`: `"playing"`, `"paused"`, `"buffering"` or `"stopped"`.
  - `position_ms`: where it is up to, at the moment in `updated` (ISO time with milliseconds).
    While `state` is `"playing"`, run the clock forward from `updated` yourself.
  - `season`, `episode`, `episode_title`, `duration_ms`, `duration_source`: filled only when
    the episode is known for sure, otherwise `null`. Known means one of:
    - the bridge opened it with a season and episode (`/api/play`, `/api/continue/open`);
    - the app reported an episode number ("S2:E3", "Season 3, Episode 4", "2x3") or an episode
      title that matches exactly one episode on JustWatch (Netflix, iview and most apps do);
    - a film whose title matches JustWatch exactly.
    Then `duration_ms` is JustWatch's runtime for that episode or film, rounded to the minute,
    and `duration_source` is `"justwatch"` (so treat the end of the bar as approximate). Android
    itself never gives the length.
  - Apple TV reports no title and no episode and it moves on to the next episode
    by itself, so for Apple TV these stay `null` and only `position_ms` and `state` are live.
  - Read every 8 s while an app is in front. An event is sent when the title or state changes
    (pause, play) or the position drifts more than 3 s from where the clock would put it.
  - Some apps send no title (Apple TV). Then `title` is the show the bridge last
    opened in that app in the last 6 hours, or `null`. `state` and `position_ms` still work.
- **No seek.** Android lets nothing outside the app jump to a time (`cmd media_session` only
  sends media keys). Use the `rewind` and `fast_forward` keys; how far each press moves depends
  on the app. For next and previous episode use the `next` and `previous` keys, for subtitles
  `captions`. Treat these four as "should work": they depend on the app.
- `sleep.ends`: when the sleep timer turns the TV off (ISO time), or `null`.
- `/api/now` never waits on the TV: it answers from memory in a few milliseconds. When the TV is
  off at the wall or its Wi-Fi drops, `tv_connected` is `false` straight away.

### Who is watching
`who` is a person id from `people` in `config.json` (their name works too) or `"both"`. It is
optional on `POST /api/play`, `POST /api/ask`, `POST /api/continue/open`, `GET /api/recs?who=` and
`GET /api/continue?who=`. Plays are logged with it. `both` (or leaving it out) shows everything;
A person id shows their own plays plus shared ones. Anything else is a `400`.

### `POST /api/who` and `GET /api/who`
Who is on the couch right now. The TV home and the phone send it when someone switches.
```json
{"who": "person2"}
```
```json
{"ok": true, "who": "person2"}
```
- It is also in `/api/now` and the events stream as `who` (`null` until someone sets it).
- It is used whenever a request has no `who` of its own: `/api/play`, `/api/ask`,
  `/api/continue/open`, and shows started by hand on the TV (logged from the app's own
  "now playing"). So once a person is set, what they start lands in their keep watching.
- `both` still means everyone: `GET /api/continue?who=both` shows everything.
- Plays logged before this existed, or with nobody set, count as shared (they show for both).

### `GET /api/people` and `POST /api/people`
The people (profiles), in the order the TV and the phone show them. Any number, up to 12, and none
is fine (then nobody is picked and everything shows). Seeded from `people` in `config.json`; once
anything is changed the list lives in `data/people.json` and wins from then on.
```json
{"ok": true, "people": [{"id": "person1", "name": "Person 1"},
                        {"id": "guest", "name": "Guest", "colour": "#30b350"}]}
```
`POST` takes one of two bodies and answers with the new list, as above:
- `{"order": ["guest", "person1"]}`: reorder only (what the TV remote sends). Ids left out keep
  their place at the end; unknown ids are ignored.
- `{"people": [{"id": "person1", "name": "Person 1"}, {"name": "Guest"}]}`: the whole list
  (what the phone's People sheet sends: add, rename, remove, reorder). A new person needs only a
  `name`; the bridge makes the `id` from it. `colour` is optional, a hex colour.

`400` when a name is empty or the body has neither. Removing the person set in `/api/who` sets
`who` back to `null`. Their watch history stays. Every change is pushed on the events stream (`now`)
so open front ends can re-read the list.

### `GET /api/config` and `/tv/config.js`
The settings the front ends are allowed to see (never addresses, keys or history). `/tv/config.js`
is the same object as `window.COUCH_CONFIG = {...};`, loaded by the TV home and kept in its offline
copy. All keys are explained in `docs/CONFIG.md`.
```json
{"ok": true,
 "people": [{"id": "person1", "name": "Person 1"}],
 "weather": {"lat": -33.8688, "lon": 151.2093, "place": "Sydney", "timezone": "Australia/Sydney"},
 "home": {"look": "night", "scenes": ["night", "golden", "water", "fog", "dawn"],
          "scene_seconds": 20, "clock": "12h", "dock_size": 10},
 "tvs": [{"id": "living-room", "name": "Living room", "quick": ["sleep"], "picture_modes": []}],
 "default_tv": "living-room", "ask": {"enabled": true}, "phone_remote": true}
```
`tvs[].quick` is the quick buttons for that TV, in order: any of `sleep`, `picture`, `look`,
`input`. `picture_modes` is the two mode names for the picture button (empty without a `picture`
entry). The home itself hides a button that cannot work at the moment.

### `GET /api/events`
Server-sent events (`text/event-stream`). Open it with `new EventSource('/api/events')`.
Each message is `event: now` with the same JSON as `GET /api/now`. Sent once on connect, then
on every change (app, power, volume, connection). A comment line is sent every 20 s to keep it
open. Use this instead of polling.

### `POST /api/key`
```json
{"key": "ok"}
```
Optional `"hold": true` sends a long press (for `ok` it opens context menus, for `home` the
quick settings on some apps).

Key names (lowercase):

| Group | Keys |
|---|---|
| Moving | `up` `down` `left` `right` `ok` `back` `home` |
| Playback | `play_pause` `play` `pause` `stop` `next` `previous` `rewind` `fast_forward` |
| Sound | `volume_up` `volume_down` `mute` |
| TV | `power` `settings` `menu` `info` `guide` `input` `search` `captions` |
| Channels | `channel_up` `channel_down` |
| Numbers | `0` to `9` |

Any raw Android key name (`DPAD_UP`, `KEYCODE_DPAD_UP`) is also accepted. `input`
(`KEYCODE_TV_INPUT`) is what the TV home's Input quick button sends: it opens the TV's own list of
inputs (HDMI and the rest) on TVs that have one.
```json
{"ok": true, "key": "ok"}
```

### `POST /api/text`
Types text into whatever text box is open on the TV (a search box).
```json
{"text": "bluey"}
```
```json
{"ok": true}
```

### `GET /api/apps`
The app tiles. Only apps installed on this TV are listed once ADB is on; until then the list is
the known set.
```json
{
  "ok": true,
  "apps": [
    {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja", "colour": "#E50914",
     "installed": true}
  ]
}
```
Known ids: `netflix` `youtube` `stan` `binge` `abc-iview` `sbs-on-demand` `disney-plus`
`prime-video` `kayo` `foxtel-go` `9now` `7plus` `10play` `spotify` `plex` `moonlight`
`settings` `home`. `installed` is `null` when the bridge cannot tell yet.

### `POST /api/launch`
```json
{"app": "netflix"}
```
`app` can be a known id from `/api/apps`, a raw package name, or a URL (deep link).
```json
{"ok": true, "app": {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja"}}
```

### `GET /api/find?title=bluey`
Where a show or film streams in the home's country (`country` in `config.json`), without playing it. Optional `&type=tv|movie`.
```json
{
  "ok": true,
  "result": {
    "title": "Bluey", "year": 2018, "type": "tv", "poster": "https://...jpg",
    "overview": "...",
    "providers": [
      {"service": "abc-iview", "name": "ABC iview", "kind": "free", "playable": true},
      {"service": "disney-plus", "name": "Disney+", "kind": "subscription", "playable": true}
    ]
  },
  "others": [{"title": "Bluey", "year": 2022, "type": "tv"}]
}
```
`kind` is `free`, `subscription`, `rent` or `buy`. `playable` means the bridge can open it on this
TV (the app is known and has a working deep link or search).

### `POST /api/play`
Finds the show and starts it in the right app.
```json
{"title": "Bluey", "season": 3, "episode": 4, "service": "abc-iview"}
```
Only `title` is needed. `service` forces one app; otherwise the bridge picks the first playable
provider in this order: free apps, then subscriptions, then the rest.
```json
{
  "ok": true,
  "title": "Bluey", "year": 2018, "type": "tv", "poster": "https://...jpg",
  "service": "abc-iview", "app": {"id": "abc-iview", "name": "ABC iview", "package": "..."},
  "method": "deeplink",
  "note": "Opened the show page. Season and episode are picked on the TV."
}
```
`method`:
- `deeplink`: the show page (or the episode) opened directly.
- `search`: the app has no working deep link, so the bridge opened it and typed the title into
  its search.
- `app`: only the app could be opened. `note` says what to do on the TV.

### `POST /api/ask`
Free text to Claude (runs on the subscription, never the API). Takes about 5 to 20 seconds for
simple asks; bigger jobs (installing an app) can run longer, so at 80 s it answers "Still working
on it" and the job finishes in the background. Show a thinking state. Optional `who` (see "Who is watching").
```json
{"text": "put on the latest Bluey", "who": "person1"}
```
```json
{
  "ok": true,
  "reply": "Bluey is on ABC iview. Opened season 3 for you.",
  "actions": [{"tool": "play", "args": {"title": "Bluey"}, "ok": true}],
  "seconds": 9.4
}
```
`409` when `ask.enabled` is `false` in `config.json` (the phone hides Ask then).
`reply` is one to three short sentences, safe to show as is. `actions` lists what Claude did
to the TV (can be empty when it only answered).

Also in every answer (since 27 Oct 2026, for a chat box):
```json
{
  "ok": true,
  "say": "That's Twilight (2008). It's on Stan and Prime Video. Want me to put it on?",
  "reply": "That's Twilight (2008). It's on Stan and Prime Video. Want me to put it on?",
  "options": [{"label": "Play it", "text": "Yes, play Twilight"},
              {"label": "Not now", "text": "No thanks"}],
  "actions": [{"tool": "find", "args": {"title": "Twilight"}, "ok": true}],
  "seconds": 6.1
}
```
- `say` is the sentence for the person; `reply` is the same text, kept for older front ends.
- `options` is 0 to 3 quick replies Claude proposes when it offers a next step or asks whether
  they want it. `label` is a short button name (at most 24 characters), `text` the full reply.
  Tapping one simply sends its `text` as the next `POST /api/ask` (same `tv`); the bridge gives
  Claude the last ask and answer on that TV for 15 minutes, so "Yes, play Twilight" carries on.
  Empty list when nothing was offered. Claude writes them as a last line `OPTIONS: [...]`
  (JSON), which the bridge strips from `say`; a broken line is dropped, never shown.
- Pure questions ("what's that vampire movie with Edward Cullen") are answered from Claude's own
  knowledge plus `find` (which of the home's apps it streams on), without touching the TV until
  the person says yes.
- `tv` in the body (or `?tv=`) picks the TV, as everywhere else.
- After 80 s the answer is "Still working on it, ..." with no options, and the job finishes in
  the background; the next ask is told how it ended.

### `GET /api/recs`
Claude's picks plus continue watching. Optional `?who=person1`. Fast: it returns the cached picks
(refreshed in the background after plays and at most every 6 hours), never makes you wait.
```json
{
  "ok": true,
  "updated": "2030-01-01T19:00:00Z",
  "continue": [
    {"title": "Bluey", "type": "tv", "service": "abc-iview", "poster": "https://...jpg",
     "last_played": "2030-01-01T19:31:00Z", "season": 3, "episode": 4}
  ],
  "picks": [
    {"title": "Slow Horses", "year": 2022, "type": "tv", "poster": "https://...jpg",
     "reason": "Because you watched The Bear", "service": "apple-tv", "playable": false}
  ]
}
```
`picks` can be empty on day one (no watch history yet). Play a pick with `POST /api/play` and its
`title` (and `service` if you have it).

### `GET /api/continue`
"Keep watching": the shows to carry on with, newest first. Optional `?who=`.
```json
{
  "ok": true,
  "items": [
    {"id": "h-0", "title": "Bluey", "episode_title": "Hammerbarn", "season": 3, "episode": 4,
     "app": {"id": "abc-iview", "name": "ABC iview", "package": "au.net.abc.iview"},
     "service": "abc-iview", "poster": "https://...jpg", "backdrop": "https://...jpg",
     "progress": null, "kind": "continue", "last_played": "2030-01-01T19:31:00Z",
     "source": "bridge"}
  ]
}
```
- Built from the bridge's own history: everything played through `/api/play`, plus what any app
  reported as playing when started by hand (see `playing` above). So it covers every app that
  reports its title, not only the ones we opened.
- Android's own Watch Next list (what Google's home shows) is not readable on this TV: it needs a
  system permission that ADB does not have. If that ever changes, those rows appear here with
  `"source": "tv"` and a real `progress` (0 to 1). Until then `progress` is `null`.
- Resume with `POST /api/continue/open {"id": "h-0"}`. It reopens the show in its app; the app
  itself picks up where you left off (Netflix, Stan, iview and the rest remember the position).
  Response is the same as `POST /api/play`.

### `POST /api/sleep` and `GET /api/sleep`
Sleep timer, kept on the bridge so it still fires when the phone locks.
```json
{"minutes": 30}
```
`0` cancels. 1 to 600. At the end the bridge presses pause, then turns the TV off.
```json
{"ok": true, "ends": "2030-01-01T22:30:00Z"}
```
`GET /api/sleep` gives `{"ok": true, "ends": "<iso>" | null}`. It is also in `/api/now` and the
events stream as `sleep.ends`. Survives a bridge restart.

The TV home screen's sleep button calls `POST /api/sleep {"minutes": 30}` (or 15, 60, 90, ...)
and `{"minutes": 0}` to cancel; it reads `sleep.ends` from `/api/now` or the events stream to show
the countdown. Add `"tv"` for a TV that is not the default.

### `GET /api/picture` and `POST /api/picture`
Picture mode, for the home screen's quick toggle. Only for a TV that has a `picture` entry in
`config.json`, normally `{"modes": ["Calibrated", "Dynamic"]}`: two names exactly as the TV shows
them. The method built (`bridge/server.py`, `set_picture_panel`) opens the TV's own picture mode
settings over ADB and picks the row with the other name.
```json
{"mode": "toggle"}
```
`mode` is one of the two mode ids, or `"toggle"`. A mode id is the name in lower case with dashes
(`"Filmmaker Mode"` is `filmmaker-mode`).
```json
{"ok": true, "mode": "dynamic", "can_set": true}
```
- `GET /api/picture` gives `{"ok": true, "mode": <id> | "other" | null, "can_set": true | false,
  "supported": true, "modes": [{"id": "calibrated", "name": "Calibrated"}, {"id": "dynamic",
  "name": "Dynamic"}]}`. Show `name` for the label. `null` means it cannot be read right now (TV
  off or no ADB).
- A TV without a `picture` entry answers `{"ok": true, "mode": null, "supported": false,
  "can_set": false}` and `POST` answers `409`. The bridge never reads or changes its picture mode.

### App order: `POST /api/home-apps`, `GET /api/app-order`, `POST /api/app-order`
The order of the TV home's dock and where the More apps line sits, per TV (add `?tv=` or `"tv"`).
The phone's Arrange apps and the TV remote (hold OK on an app) both save here, so they agree; the
TV reads it again on every Home press.

The TV home reports the apps it has, in its default order (`data/home-apps.<tv>.json`):
```json
{"apps": [{"package": "com.netflix.ninja", "name": "Netflix"}], "line": 10}
```
`GET /api/app-order` gives the saved order, with apps the TV has gained since at the end (below the
line):
```json
{"ok": true, "saved": true, "line": 8, "dock_max": 10,
 "apps": [{"package": "com.netflix.ninja", "name": "Netflix"}]}
```
`saved` is `false` until someone arranges them (then the order is the TV's default). `POST` saves:
```json
{"order": ["com.netflix.ninja", "com.google.android.youtube.tv"], "line": 8}
```
`order` is every package in order (screens are `screen:<id>`), `line` is how many of them sit in
the dock. `line` is capped at `dock_max`, which is `home.dock_size` in `config.json` (1 to 10,
default 10). The answer is the same as `GET`. Settings and the Play Store (the App Store tile,
first in More apps) are never in the list.

With no bridge the TV keeps the order itself and sends it with this `POST` the next time the
bridge answers.

### Home settings: `GET /api/settings` and `POST /api/settings`
The settings made on the TV with its gear tile (Home settings), per TV (add `?tv=` or `"tv"`). The
TV home keeps them itself and hands the bridge a copy, so the phone remote and the TV agree (the
phone's "Same as the TV" language comes from here) and a TV whose storage was cleared gets them
back. Kept in `data/settings.<tv>.json`. The bridge checks their shape and stores them; it does not
act on them (the TV home does). On that TV they win over `config.json` (docs/CONFIG.md).

```json
{"ok": true, "updated": "2030-01-01T19:31:00+10:00",
 "settings": {"lang": "es-MX", "place": {"name": "Sydney", "lat": -33.87, "lon": 151.21, "timezone": "Australia/Sydney"},
              "wx_show": true, "wx_unit": "c", "wx_every": 30, "look": "night",
              "scene_order": ["dawn", "night", "golden", "water", "fog", "p-a1"], "scenes_off": ["fog"],
              "scene_seconds": 20, "clock": "24h", "photos": [{"id": "a1", "url": "https://example.org/beach.jpg"}],
              "hidden_apps": ["com.example.tvhelp"], "quick": ["sleep", "look"]}}
```
`settings` is `{}` and `updated` is `null` until the TV sends some. `POST` takes
`{"settings": {...}}` (the whole object, it replaces the old one) and answers like `GET`. Every key
is optional:

| Key | What it is |
|---|---|
| `lang` | `en`, `es` or `es-MX`. |
| `place` | The weather's place: `name`, `lat`, `lon` (rounded to two decimals, a town, never a house), `timezone`. |
| `wx_show`, `wx_unit`, `wx_every` | Weather on or off, `c` or `f`, minutes between checks (15, 30 or 60). |
| `look` | `night` or `classic`. |
| `scene_order`, `scenes_off` | Every scene in order, and the ones switched off. Ids are the five scene names and `p-<id>` for a photo. |
| `scene_seconds`, `clock` | 5 to 3600; `12h` or `24h`. |
| `photos` | Up to 20: `{"id", "url"}` for a photo on the web, or `{"id", "file"}` for one the TV's file picker copied into the app (`p....jpg`, kept on the TV only). |
| `hidden_apps` | Packages hidden from the home and More apps on this TV. |
| `quick` | The quick buttons, in order: any of `sleep`, `picture`, `look`, `input`. |

Unknown keys and wrong shapes are dropped. Larger than 32 KB answers `413`. With no bridge (option
A) the TV keeps them alone. The on-TV app (option C) keeps them in its own `/api/settings` under
the same `settings` key, next to its setup settings.

### `GET /api/history`
```json
{"ok": true, "items": [{"title": "Bluey", "service": "abc-iview", "who": "person1",
                        "when": "2030-01-01T19:31:00Z", "method": "deeplink"}]}
```
Newest first, last 200.

History is kept forever (append-only `data/history.jsonl`); `/api/history` shows the newest 200.

### `GET /api/taste`
The taste profile Claude recommends from, built from all history: plays on our TVs plus
imported Netflix and YouTube history (`bridge/history_import.py`). Optional `?who=<person id>|both`,
`&rebuild=1` to rebuild now. Rebuilt daily and after every import.
```json
{"ok": true, "built": "2030-01-01T09:00:00Z", "who": "person2",
 "sources": {"netflix": 100, "youtube": 200, "apple-tv": 10},
 "profile": {"events": 300, "genres": ["Drama", "Comedy"],
   "shows": [{"title": "Sample Show", "status": "finished", "episodes": 20, "sittings": 25,
              "seasons": [1, 2], "rewatched_episodes": 2, "recent_sittings": 0,
              "last": "2030-01-01", "genres": ["Drama"]}],
   "films": [{"title": "Sample Film", "status": "stopped early", "times": 1, "last": "...",
              "genres": ["..."]}],
   "youtube_channels": ["..."], "youtube_channels_recent": ["..."], "youtube_videos": 200,
   "music_artists": ["..."], "recent_shows": ["..."]},
 "summary": "Taste of Person 2 (from 300 things watched): ..."}
```
Show `status` is `finished`, `finished season N of M`, `dropped after N episodes`,
`watching now (...)`, `partly watched (N of M episodes)` or `N episodes watched` (episode
counts from JustWatch). Film `status`: `finished`, `stopped early`, `partly watched` (only with
the whole-account Netflix file, which has sitting lengths) or `watched`. `everyone` leaves out a
Netflix "Kids" profile and anyone marked `"kid": true` or `"guest": true` in `config.json`.

### `POST /api/import`
Reads whatever is in `bridge/data/inbox/` now (it is also checked hourly). Body `{}`. How to get
the files: [IMPORT.md](IMPORT.md).
```json
{"ok": true, "imported_total": 100, "report": [
  {"file": "person1/NetflixViewingHistory.csv", "source": "netflix", "rows": 100, "new": 100,
   "people": ["person1"]}]}
```

### `GET /api/screens`
The Screens tile. Nothing is ever shown on the TV unless someone opens a screen here.
```json
{
  "ok": true,
  "screens": [
    {"id": "desktop", "name": "Desktop", "kind": "moonlight", "ready": false,
     "note": "Needs Sunshine on the computer and Moonlight on the TV."}
  ]
}
```

### `POST /api/screens/open`
```json
{"id": "desktop"}
```
```json
{"ok": true, "id": "desktop", "note": "Opened Moonlight. Pick the Desktop on the TV."}
```
`409` with an `error` when the screen is not `ready`.

### `POST /api/power`
```json
{"state": "on"}
```
`state` is `on`, `off` or `toggle`. `on` and `off` check the current state first, so sending `on`
to a TV that is on does nothing. `on` only answers once the TV says it is on: about 0.5 s in
the first minute after "off" (standby, still on the network), about 2 s after that (the TV has
left the network; the bridge sends Wake-on-LAN and reconnects the moment it is back). It gives up
after 32 s with `503`: then show "Turn the TV on with its own remote".
```json
{"ok": true, "power": "on"}
```
While an `on` is in progress, `/api/now` and the events stream carry `"waking": true`. Show
"Waking the TV" until `waking` is `false` and `power` is `"on"`.

### `POST /api/volume`
```json
{"action": "up"}
```
`action` is `up`, `down` or `mute`. Optional `"steps": 3` repeats `up` or `down`. Or set a level:
`{"level": 20}` (0 to 100, only when `/api/now` says `volume.known` is `true`; otherwise `409`).
```json
{"ok": true, "volume": {"level": 13, "max": 100, "muted": false, "known": true}}
```

### `GET /api/screenshot`
PNG of the TV screen. Needs ADB (`/api/health` `adb: true`), otherwise `503`.
For Claude and debugging, not for the front ends.

## Agentic ask endpoints (`agentic.py`)
What Claude uses to do whole jobs from one ask. All take the usual `?tv=`. Front ends can call
them too, but none of them are needed by the phone remote or the TV home.

### `GET /api/ui`
The screen as text, from `uiautomator dump`: `app`, `focused` (the label with focus), `items`
(one line per visible label: `*` has focus, `+` can be pressed, `@x,y` its centre), and
`stop_screen` / `stop_labels` when a sign in, sign up or payment button is showing. Works where
screenshots are black (protected video). About 3 to 4 seconds. `409` when the screen cannot be
read (some players never go idle). A home screen drawn in a web view shows only its outline.

### `POST /api/tap`
`{"label": "Install"}` (or `{"x": 204, "y": 780}`): presses that label with `input tap`.
Refuses buy, subscribe, sign in and price buttons (`403`).

### `GET /api/screen-small`
The screen as a 960 wide JPEG for Claude (the PNG from `/api/screenshot` is about 1.3 MB).
Header `X-Screen-Black: 1` when the picture is all black.

### `POST /api/install` and `POST /api/uninstall`
`{"name": "Stan"}` (or `{"package": "..."}`). Install finds the Play Store package from the app
catalogue plus a short list of extras (else it opens a Play Store search), opens its page,
presses Install and waits until `pm list packages` has it (up to 150 s). Answers
`installed: true`, or `installed: false` with `stopped`: `paid` (never buys), `sign_in_or_payment`
(left on screen for a person), `no_button`, `timeout`. Uninstall refuses the home screen app,
the Play Store, the keep-off list and apps that came with the TV. Only when someone asked.

### `GET /api/inputs` and `POST /api/input`
`GET` lists HDMI inputs: `name` (HDMI n), the TV's own label, `state`, and `devices` seen over
HDMI CEC on that port (a console only shows while it is on). `POST {"name": "playstation"}`
switches by device name, number (`"hdmi 2"`), a remembered name, or a best guess (`how`:
`device`, `number`, `remembered`, `guess`; never an input that only has a soundbar on it).
`{"name": "home"}` goes back to the apps. `remember_as` saves a name for that input
(`data/input-names.json`). Switching uses `content://android.media.tv/passthrough/<input id>`.

### `POST /api/off-after` and `GET /api/off-after`
Turns the TV off when what is playing ends: at the credits (`threshold_s`, default 30, before
the end, when the length is known), when the next episode or video starts, or when playback
stops. When the length is known it also sets the sleep timer, so the home and phone show
"Off in N min", and keeps it right through pauses. Leaving the app drops the plan. A sleep timer
set by hand replaces it. `{"cancel": true}` cancels. `{"dry_run": true}` only logs what it
would do (for testing). `GET` says whether it is armed and why it last stopped.

### `POST /api/restart-app`
`{"app": "netflix"}` or empty for the app on screen: force stops it, opens it again and carries
on with what was playing (the show page, which resumes where the profile was up to; YouTube
reopens its search for the video).

### `GET /api/latest?title=...`
The newest episode available (season, episode, name, date, apps), announced upcoming releases,
and the last episode of it played on our TVs, with `newer_than_last_watched`.

### `GET /api/both`
For "something we would both like": each person's genres and shows, shared genres, shows
everyone watched, shows anyone dropped, people with little history, and the household's
ready picks. `?who=a,b` narrows it to those people.

## Keep-off guard (one list per TV, owned by the bridge)
Once a day the bridge checks each paired TV over ADB and switches off again any app on that
TV's list that an update switched back on (`pm disable-user --user 0 <package>`). If the TV is
off it tries again hourly.

| TV | List file |
|---|---|
| default TV | `bridge/data/keep-disabled.json` |
| any other TV | `bridge/data/keep-disabled.<tv id>.json` |

`tv-home/tools/apply.sh` writes the list for the TV it sets up.

A JSON array of package names. Undo for a TV: empty that TV's list first, then re-enable the
apps (otherwise the guard switches them off again the next day). Each undo script empties only
its own TV's list. The file per TV is set in `config.json` (`keep_disabled`).

## Images
Every title object (find result, play, playing, continue, picks) carries `poster` (portrait,
592 px wide) and `backdrop` (landscape, 1440 px wide, can be `null`). Both are JustWatch image
URLs. Credit "Data from JustWatch" somewhere quiet (their terms).

## Change notes
- `GET|POST /api/settings` (Home settings made on the TV: language, weather place and units,
  look, scenes, photos, quick buttons, hidden apps). `home.language` in `/api/config` and
  `/tv/config.js`.
- `GET|POST /api/people` (any number of people, ordered, edited from the phone and the
  TV remote). `/api/config` and `/tv/config.js` gained `home`, `tvs[].quick`,
  `tvs[].picture_modes`, `ask` and `phone_remote`. Picture modes are any two names
  (`picture.modes`), and `GET /api/picture` lists them. App order documented; `dock_max` follows
  `home.dock_size`. `/api/ask` answers `409` when `ask.enabled` is `false`.
- Public export. The dated history of the private build is not included.
