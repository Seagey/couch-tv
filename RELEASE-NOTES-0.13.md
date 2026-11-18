## couch-tv 0.13: your own TV home designs, and ten days of your fixes

Thank you to everyone who sent a report, a fix or a whole feature. Most of what is below came from you. Names are GitHub usernames, and every change has its own entry in [docs/UPDATES.md](https://github.com/Seagey/couch-tv/blob/main/docs/UPDATES.md).

### Nothing changes unless you ask

If you already use couch-tv, updating leaves your home exactly as it was. Every new look and setting below is off until you switch it on, and the classic home was checked pixel for pixel against the last main build.

### Do this after updating

- **Update the TV apps:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release, so they install over 0.12 and over the 0.13 beta and keep your settings.
- **Option B:** run `git pull` and restart the bridge. The bridge and the home's own page run from your copy of the repo.
- **Samsung, LG and Roku** apps are built on your computer, so build them again to get the changes.
- **If you wrote your own scripts for the bridge:** POST requests now need `Content-Type: application/json`, and `/api/home` takes JSON only. Anything else gets a 415.

### New: TV home designs from couch-tv Studio (opt in)

- **couch-tv Studio** is a design tool for your TV home. Make a home there, get a short code, and type it on the TV in Home settings, couch-tv Studio, Get a design. Nothing about it is on until someone at the TV turns it on, and **Back to my classic home** puts the old home back in one step (your design is kept for later).
- **66 widgets** on a 9 by 5 grid, each with sizes that fit: clocks (flip, analogue, word, world, countdown), weather, rain, UV, air quality and surf, photos and On this day, Keep watching, Picks for you, Now playing and the Spotify Up next queue, Agenda from your own calendar, Family note, List, Guest Wi-Fi with a join code, House guide, Screen time, Headlines, Commute, and Scores and Markets (Beta).
- **Smart home widgets** for Home Assistant: Control Centre (lights, switches, fans, blinds), **Camera** (a still picture every two seconds, never video), Doorbell, Solar and energy, Sensor and Speakers. Locks and alarms are left out on purpose, and a garage door, gate or door Home Assistant lists as a blind is shown but never opened or closed from the TV.
- **A short looping video** as a design's background, which stops while an app is open and falls back to its still picture on a slow TV.
- **Google Fonts by name** in a design, apps picked by catalogue id, and your own cut out photo drawn over the clock.
- **Share this home:** open the home you have now in couch-tv Studio on your phone, to change it or keep it. No names, photos or places are sent.
- **Things typed at home** (the note, lists, Wi-Fi password, house guide, calendar address) stay on that TV. They are never put in a design, a share or `config.json`.
- **Home Assistant token privacy:** a design or a share refuses anything that looks like a token or a private key, so your Home Assistant token can never leave the TV that way.
- **A new optional Android permission, usage access** (`PACKAGE_USAGE_STATS`), in the TV home app. It is only for the Screen time widget, which shows today's time in each app. It is not granted when you install or update: it stays off until you switch Home on in the TV's own Usage access screen (Home settings, At home, Allow screen time), or run `apply.sh` with `SCREEN_TIME=1`. `undo.sh` takes it back.
- **Fit fixes:** every widget fits its box and is centred unless the design says otherwise, and the flip clock fits at every size, with or without a panel.

### New on every TV

- **Kids mode** (optional): a home with only the shows you picked, behind a PIN.
- **Your own cards** at the end of Keep watching, from a small file you write (solar today, bin night, a family message). Nothing in the file is ever run.
- **Keep watching follows the app** the remote is on (optional), Plex's own Continue Watching (option B), Stremio and Nuvio, hold OK on a card to remove it, and remove a card from the phone remote too.
- **Looks:** OLED Cinema, Follow the sun, Lighter home for slow boxes (turned on by itself on a low end TV), Moving tiles, Smart Idle, ambient weather over the scenes, own scenes that move, and sharper scenes on a 4K TV.
- **Now playing** full screen, **Soundscapes**, a **Screen off** button, a **TV settings** quick button and **Restart home** in Home settings, About.
- **Choose where the home starts** (profiles, Keep watching or apps), and the home comes back to the tile you left.
- **The clock follows the TV's own 12 or 24 hour setting** on Android TV.
- **Input tiles for each TV**, with your own picture on an input tile.

### New languages

Polish, Czech, Dutch, Hebrew and Arabic (right to left), Brazilian Portuguese, Serbian (Latin), Romanian and Simplified Chinese on the TV home. The phone remote now also speaks Serbian, Czech, Polish, Brazilian Portuguese and Simplified Chinese, and the Claude assistant answers in the home's language.

### New TVs (Beta unless it says otherwise)

- **Android 6 TVs** can install both apps (experimental).
- **Make couch-tv the home with no computer** on Android TV 10 or newer.
- **Roku**, **Hisense VIDAA** (including a home with no computer), **VIZIO** (the phone remote, and the home in the TV's own webview on one tested set), **Philips Titan OS and Saphi**, **Panasonic**, **Fire TV on Vega OS**, **TiVo OS**, **Apple TV**, **Bell Streamer with Fibe TV** and **Xiaomi PatchWall** TVs.
- **Two TVs in sync** (experimental), and a Docker example for the bridge.
- **Option B on a Fire TV over ADB alone.**

### Fixes

- The Home button brings couch-tv back faster on Android 9 and 10, Fire OS 7, Xiaomi, Chromecast with Google TV and Sony Bravia.
- LG goes back to couch-tv in about half a second, and input tiles switch straight to HDMI. Two more real LGs work.
- TCL: an empty TV input helps the Home button watch start at boot (open the app once after updating).
- The Next song button skips the track again, Home settings lists stay put on older Samsungs, and an app banner that is not 16:9 is no longer squeezed.
- The home rests while something covers it, and the first presses back on the home no longer wait.

### Security

- Optional pairing key for the bridge, a tighter list of allowed web pages, a Host name check, JSON only POSTs and a limit on wrong keys.
- App names are checked before the bridge closes or switches off any app, and the bridge's web pages stay inside their own folder.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C) and `couch-tv-sync.apk` (two TVs in sync, experimental), with `SHA256SUMS.txt`.
