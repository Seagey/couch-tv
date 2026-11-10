# couch-tv

Your own home screen and phone remote for a Google TV, and now a Samsung TV, and an LG
version that has run on seven real LGs so far. No ads on the home screen. Open source (MIT).

> Note for Google TV owners: 0.11 leaves the Google home and setup apps switched on. If you set
> couch-tv up with 0.10 or older, see [If your TV loops after a restart](#if-your-tv-loops-after-a-restart).

![The Night home screen](docs/screens/home-night.jpg)

## Updates

**8 November 2026: a restart could loop some Google TVs. Fixed.** A Sony Bravia Google TV owner
found that after couch-tv went on, a restart left the TV going round: blank screen, restart, blank
screen. couch-tv 0.10 and older switched off the Google TV home and the setup app, and on some
Google TVs the TV cannot start without them. From 0.11 couch-tv never switches either off, the updated app switches them back on by itself where it can, and if couch-tv itself keeps crashing the TV's own home takes over. **If you set couch-tv up
with 0.10 or older, read [If your TV loops after a restart](#if-your-tv-loops-after-a-restart)
before you next restart your TV.** Sorry, and thank you to the person who reported it.

**4 November 2026: Fire TV extras, from a fork.** Thirty four people have forked couch-tv now. From
[killy10o10](https://github.com/killy10o10/couch-tv), who runs it on a Fire TV Stick 4K (2nd gen):

- **Bluetooth and Network buttons** at the top right of the home. Fire OS's long-press Home menu
  has neither. On a Fire TV they open Amazon's own screens; any other TV gets Android's standard
  ones. They need the "lives on the TV" app (option C): on a Fire TV they are on by default, on
  other TVs switch them on in Home settings, quick buttons.
- **Amazon's own YouTube app** on Fire TV is now recognised, with its logo, so it sorts and opens
  like YouTube does everywhere else.
- **A Fire TV Stick guide**, written on the stick itself: [docs/FIRE-TV-STICK.md](docs/FIRE-TV-STICK.md).

And from [Justin1491](https://github.com/Justin1491/couch-tv): the bridge stops trying to reach a
TV that has not been paired yet, instead of retrying in the background. The two buttons come with
the next release after 0.4.

**1 November 2026: LG TVs.** couch-tv now has an LG version, done the same way as the Samsung one:
it goes on your LG as an app through LG's Developer Mode, and the computer at home opens it every
time the TV is switched on. It was built from LG's own documentation and tested against a stand-in,
so if you have an LG, you would be among the first to run it: give this repo to your agent, and
please open an issue saying how it went. Setup and limits: [docs/LG.md](docs/LG.md).

**10 November 2026: Roku (built, not yet run on a real Roku).** couch-tv now has a Roku version. Roku
channels are not web pages, so the home is drawn again as a native channel (the Night scenes with the clock
in them, date and weather, the people switch, Keep watching and your apps), and the bridge talks to the
Roku over its own network protocol and opens the channel every time the TV is switched on. It was built from
Roku's documentation and tested against a test Roku and a BrightScript simulator. **Nobody has run it on a
real Roku**, so if you have one, you would be the first: give this repo to your agent, and please open an
issue saying how it went. Setup and limits: [docs/ROKU.md](docs/ROKU.md).

**10 November 2026: Android 6 (experimental).** Both TV apps now install on Android 6.0 (a Xiaomi
Mi TV 4A with PatchWall, for example, [issue #59](https://github.com/Seagey/couch-tv/issues/59)).
Checked on an Android 6 emulator only, not a real TV. There both apps install and open, but that
emulator's built in browser engine (Chrome 44, the oldest a TV can ship) lays the home out badly:
the shelf stacks up instead of running across. A TV whose engine is newer may look right. The
on-TV app (option C) cannot pair by Wi-Fi on Android 6 (that needs Android 11): set it up from a
computer with USB or network debugging (port 5555), as the README steps already do. If you try it,
please open an issue saying what you see.

**3 November 2026: older Fire TV sticks (Fire OS 6).** Both TV apps now install on Android 7.1,
so the Fire TV Stick 4K (1st gen) and other Fire OS 6 sticks can run them. Options A and B also
take the Home key back on any Fire TV now, the way the "lives on the TV" app already did:
`apply.sh` switches on a small Home button watch, and the undo switches it off. Checked on
Android 7.1, 9 and 14 emulators with a stand-in for Amazon's home, not yet on a real Fire OS 6
stick: if you have one, please open an issue saying how it went. It comes with the next release
after 0.3.

**30 October 2026: Fire TV sticks, older TVs, smart home and your own scenes.** Sixteen people
have forked couch-tv so far, and six of them built something worth having. The best of it is now in
the main repo, credited to each of them. Download the new apps from
[the Releases page](https://github.com/Seagey/couch-tv/releases) (or ask your agent to update).

- **Fire TV sticks and Fire TV Cube (Fire OS).** The "lives on the TV" app now takes the Home key
  back: Amazon's own home cannot be switched off, so the app sees it come up and puts couch-tv's
  home straight back on top. Amazon's home still flashes up for a moment first. It needs three
  one-off grants from a computer: [on-tv/README.md](on-tv/README.md#fire-tv-fire-os). Confirmed
  on a Fire TV Stick 4K (2nd gen, Fire OS 8) by [killy10o10](https://github.com/Seagey/couch-tv/issues/3).
- **Older TVs no longer crash on open.** Both TV apps used a part of Android that only Android 11
  and newer have. On Android 9 and 10 (most Fire TV sticks, and many older Android TVs) the home
  crashed as it opened. Fixed and checked on an Android 9 emulator: the old apps crash, the new
  ones open.
- **Keep watching with no computer.** With no bridge (option A), Keep watching now fills from
  Android's own Watch Next list: what each app says you are part way through, with its picture
  and how far in you are.
- **Smart home, if you want it.** If you run Home Assistant, the home can show your air
  conditioning (each room, warmer, cooler, on, off, mode), your scenes as tiles, and a doorbell
  card with the door camera over whatever is playing. It is off for everyone unless they set it
  up, and your agent asks first ([docs/CONFIG.md](docs/CONFIG.md), Smart home).
- **Design your own scene.** Put the glass clock over any photo: a landscape, your own holiday
  shot, anything. Optionally let the skyline sit in front of the clock, like the built-in scenes.
  [docs/MAKE-A-SCENE.md](docs/MAKE-A-SCENE.md).
- **Safer setup.** `apply.sh` now makes couch-tv the chosen home and checks the TV took it before
  it switches anything off (on some TVs the other order can leave Home on a crash-looping setup
  screen). The TV app also checks the settings it is handed more strictly.
- **A build on every change.** GitHub now builds both TV apps for every push and pull request, so
  a change that breaks the build shows straight away.

Thank you to [fifarsi](https://github.com/fifarsi/couch-tv) and
[ishanboss20](https://github.com/ishanboss20/couch-tv) (the Android 9 crash),
[gurpritsingh81](https://github.com/gurpritsingh81/couch-tv) (Watch Next),
[herocode1](https://github.com/herocode1/couch-tv-hero) (the safety fixes and the install order),
[dlandman27](https://github.com/dlandman27/couch-tv) (Fire TV) and
[roliusz](https://github.com/roliusz/couch-tv) (the doorbell, Home Assistant and own scenes).

**29 October 2026: Samsung TVs.** couch-tv now works on Samsung TVs too. It was tested on a 2021
Samsung Frame. It is the same link and the same setup: give this repo to your agent and it offers
the Samsung path when it finds a Samsung.

What is the same on a Samsung: the home (scenes, clock, weather, your apps in your order), the phone
remote, and the Claude assistant. "Put on that show about the lawyer who never went to law school"
finds Suits and plays it.

What is different on a Samsung:

- **You need a computer that stays on at home** (a Mac, a Linux box or a Raspberry Pi on the same
  Wi-Fi, option B below). It opens couch-tv every time the TV is switched on, and it is what the
  phone remote and the assistant talk to. Without it you can only open couch-tv yourself from
  Samsung's app row.
- **It is an app that opens itself, not a true home screen.** Samsung does not let any app replace
  its home. The TV remote's own Home button still opens Samsung's menu; Home on the phone remote
  brings couch-tv back.
- **Playing a show.** Netflix opens the show and starts it by itself. YouTube opens the video.
  Prime Video, Stan, Binge, Paramount+ and Apple TV are handed the title by the couch-tv app on the
  TV, the way Samsung's own guide does it; so far Prime has been seen opening, the title page itself
  is still to be confirmed. Disney+ and the rest open on their home page and you pick the show.
- **No reading the screen.** Samsung gives no screenshots and no "what is playing" to the network.
  So Play is pressed by timing, not by looking (only Netflix's timing is tested so far), and on a
  "Who's watching?" screen couch-tv takes the highlighted profile, usually the first, rather than
  yours by name.
- **You install the app yourself**, with a free tool and your own Samsung account sign-in, after
  turning on the TV's Developer Mode. A firmware update can turn Developer Mode off again; then you
  repeat one step.
- No picture mode switch and no ADB tools (those are Android only).

One bridge can run your Google TVs and your Samsung together, and the phone remote switches between
them. Full guide, limits and undo: [docs/SAMSUNG.md](docs/SAMSUNG.md).

**28 to 29 October 2026, every TV:**

- "Put on X" now gets past "Who's watching?" on Android TVs: it presses your profile (you list your
  names per person, [docs/CONFIG.md](docs/CONFIG.md)) and then Play.
- The phone remote no longer opens to a white page when the phone has just woken up
  ([docs/REMOTE.md](docs/REMOTE.md)).
- The TV home works on older TV browsers too (the 2021 Frame showed no photos and two clocks).

## Home backgrounds

Five scenes take turns every 20 seconds, each with a big glass clock that sits just behind the
scenery: the peaks, the volcano and the misty hills overlap the bottom of the digits, and on the
waterline scene the clock floats on the lake with a blurred reflection under the surface. Your apps
and "keep watching" stay put. Start on one with `?scene=<name>`, or swap in your own photos.
**Design your own scene** (any photo, or a place you describe, with your own clock and date over
it, and the skyline in front of the clock if you like): [docs/MAKE-A-SCENE.md](docs/MAKE-A-SCENE.md).

| Night | Golden hour | Waterline |
|---|---|---|
| ![Night](docs/screens/home-night.jpg) | ![Golden hour](docs/screens/home-golden.jpg) | ![Waterline](docs/screens/home-water.jpg) |
| **Fog** | **Dawn** | **Classic** (`?theme=classic`) |
| ![Fog](docs/screens/home-fog.jpg) | ![Dawn](docs/screens/home-dawn.jpg) | ![Classic](docs/screens/home-classic.jpg) |

Shown with sample shows and sample people. On your TV, "keep watching" fills from what you
actually watch: per TV and per person (with options B and C), up to 10 shows, newest first.
With option A it is Android's own Watch Next list, the same for everyone on that TV.

## Settings on the TV

No computer and no `config.json` needed for the everyday settings. Press down to the dock and
pick the gear, **Settings** (just before More apps). OK opens a small menu: **Home settings** is
couch-tv's own list, **TV settings** is Android's own (Wi-Fi, picture, sound). The remote's own
gear or Settings button opens the same menu ([docs/REMOTES.md](docs/REMOTES.md#the-gear-button)).

![Home settings on the TV](docs/screens/home-settings.jpg)

Any remote works: up and down move, right or OK opens a section, OK changes a row, holding OK on a
scene, an app, a person or a quick button picks it up so up and down move it, and Back steps back
and then closes. What you change shows when the list closes.

- **Language:** English, Español, Español (México), Italiano, Deutsch, Türkçe. Until one is picked here (or in
  `config.json`), the home speaks the TV's own language if it is one of these, else English.
- **Location:** type a town or city with the TV's on-screen keyboard (or the phone remote's Type),
  pick it from the places found. It sets the weather's place and time zone. The place search is
  Open-Meteo's, free and with no key. Each place shows what it belongs to (its municipality,
  province or county, and region), so towns with the same name can be told apart; in Italian the
  places in Italy come first, in German the places in Germany.
- **Weather:** show or hide it, °C or °F, check every 15, 30 or 60 minutes. Open-Meteo is the only
  weather provider for now.
- **Look and scenes:** Night scenes or Classic; which scenes take turns, in what order, how many
  seconds each; a 12 or 24 hour clock; glass panels and a video background (below); your own
  photos (below).
- **Apps:** every app on the TV. OK moves it between home, More apps and hidden; hold OK to change
  the order. The same order as holding OK on the dock and the phone's Arrange apps.
- **People:** add, rename, remove and reorder who is watching.
- **Quick buttons:** which of the sleep timer, picture mode, look, input and screensaver buttons
  show, in what order. **Input** opens couch-tv's own menu where the TV lists its inputs: each HDMI port by the
  TV's own name for it ("HDMI 3 (eARC)" where the TV labels it so) with what is plugged in behind it,
  each one switching straight away, then Bluetooth and Network. A TV that lists no inputs gets its
  own input screen, as before (#30). **Screensaver** starts the TV's own screensaver (Google TV's
  Ambient mode, with the Google Photos albums, a few seconds later; its own screen for the albums
  is just below, under Look).
- **Updates:** off until you say yes. The first time the home opens it asks once: "Tell you when a
  new couch-tv version is out?" (setup can answer it for you, `home.updates`). With **Tell me about
  new versions** on, the TV looks on GitHub once a week, so frequent releases never nag; with it off
  nothing is checked by itself. **Check for updates now** looks straight away either way. A new release
  puts a small dot on the gear tile and a line on the home. **Update to ...** downloads it, checks
  it, and hands it to Android, which asks "Do you want to update this app?" first. Your settings,
  people, photos and apps stay. The first time, Android asks you to let Home install apps
  (Settings, Security and restrictions, Unknown sources). Only the app from the Releases page
  updates this way. A copy built on your own computer, for example with your own scenes, says so
  and is updated the way you installed it. The on-TV app (option C) does not do this yet.
- **About:** the version, the GitHub address (github.com/Seagey/couch-tv), where the settings are
  kept, and Reset.

**Your own photos.** On a TV with a file picker, **Add photos from a USB drive or this TV** opens it
and copies the photos you choose into the app (turned the right way up and sized for the screen).
Many Android TV and Google TV builds have no file picker; then the list says so and you add a photo
from a web address instead (a JPEG or PNG on the internet, which the TV loads each time). The on-TV
app (option C) only takes web addresses. Your photos take turns with the scenes and replace the
Classic look's own.

**Glass panels and a video background (optional, both off to start).** Under Look, **Glass
panels** puts clear, softly blurred panels with a light edge behind the clock, Keep watching and
the apps, so the background shows through. Blur is heavy work for an older TV, so **On, no blur**
keeps the panels and their edges without it; a TV that cannot blur at all gets that by itself.
**Video background** plays a short clip that loops, muted, in place of the photo, in both looks:
**Video link** takes the address of an MP4 or MOV on the web or on a computer at home, and the switch
turns it off again without losing the link. The photo stays until the clip plays, and comes back if
it will not play. The video stops while an app is in front. Over a video, the Night clock is
frosted white instead of cut from the photo. Both are heavier than the plain home, so on a small
TV stick switch them off if the home feels slow. Thanks alonmustafa (#22). **Glass app icons**
(also under Look) shows each app's symbol in light glass without its own background, like Apple's
clear icons, and a logo that is itself a shape (YouTube) keeps the shape with its mark cut out (#25, #33). **Focused app** chooses whether the app you are on shows its own colours or stays glass like Apple's, shown by a lift and a brighter rim (#32). **How clear** sets the glass from
frosted to very clear in five steps (#29), and **Clock style, Liquid glass** draws the Night clock
as clear glass digits that bend the photo behind them (#25). The phone remote follows the TV. Links straight to
Apple's own server (`sylvan.apple.com`, the tvOS aerials) never play: it uses a certificate from
Apple's private authority, which Android and Chrome do not trust. Copies of the same aerials on
other hosts, or saved on a computer at home, play fine as MOV (#27).

**Now playing.** When Spotify or any other music app is playing behind the home, a card shows the
song, the artist and its cover, with previous, play or pause and next (the remote's own media keys).
In the Night look it is the first card of the Keep watching row; in Classic it sits under the quick
buttons. A paused song stays for ten minutes. It needs option B or C: Android does not let an
ordinary app see what other apps play, so option A has no card. Home settings, Look, Now playing
switches it off. The cover comes from Apple's free music search. Thanks alonmustafa (#31).
**Navigation sound** (Home settings, Look, Sound): the TV's own click, a soft tap, or none (#32).
With Glass panels on, Home settings and the menus are glass too, and focus moves more calmly (#32, #33).

**Smart home (optional).** If you already run Home Assistant, the home can show your air
conditioning (each room's temperature, warmer, cooler, on, off and mode), your scenes and scripts
as tiles, and a doorbell card with the door camera's picture over whatever is playing. It is off
unless you add a `home_assistant` section to `config.json`; without it nothing changes.
[docs/CONFIG.md](docs/CONFIG.md), Smart home, has the setup.

**Where they are kept.** On the TV, and with option B on the computer too, so the phone agrees and a
reset TV gets them back. They win over `config.json` on that TV; About, Reset home settings goes
back to it. [docs/CONFIG.md](docs/CONFIG.md) has the details.

**Languages.** The TV home and the phone remote both speak English, Spanish (`es`, for Spain and
everyone else), Mexican Spanish (`es-MX`: computadora, celular, presionar, clima and the rest),
Italian (`it`), German (`de`) and Turkish (`tr`), all three with a 24 hour clock unless you pick 12
hour, and the smart home words Home Assistant uses in each. The phone has its own choice (TV menu,
Language), "Same as the TV" by default. Messages that come from the bridge itself (an error, a note
about how a show opened) and some screen reader labels on the phone are still in English. The TV home also speaks French
(`fr`, 24 hour clock); the phone remote has no French yet and shows English there.

## Three ways to run it

- **A. TV home only.** The new home screen, nothing else. You use your normal TV remote and no
  computer has to stay on.
- **B. Computer bridge.** The home screen plus the phone remote, "put on Bluey" search, turning the
  TV on from the phone, keep watching across apps and an optional Claude assistant. A computer at
  home (a Mac, a Linux box or a Raspberry Pi) stays on and runs the bridge.
- **C. Lives on the TV.** The home screen and the phone remote with no computer: the bridge runs
  inside an app on the TV. See [on-tv/README.md](on-tv/README.md).

> **Pick your option, then follow only its steps**
> - **A:** steps 1, 2 and 6 below. With no computer at all: step 1, then "Option A with no
>   computer" in step 6.
> - **B:** steps 1 to 6 below.
> - **C:** [on-tv/README.md](on-tv/README.md) (it has its own developer mode and install steps).

## Will it work on my TV?

| Your TV | A. TV home only | B. Computer bridge | C. Lives on the TV |
|---|---|---|---|
| **Google TV** (Sony, TCL, Hisense Google TV, Philips and others) | Yes | Yes | Partial. Newer models may ask for a pairing code again after a restart |
| **Google TV box** (Google TV Streamer, Chromecast with Google TV, Onn) | Yes | Yes | Partial, as above |
| **Older Android TV** (Android 7.1 to 11) | Yes | Yes | Yes |
| **Android 6 TV** (Xiaomi Mi TV 4A, PatchWall) | Experimental: opens, layout may break on an old browser engine | Not tested | Experimental, set up from a computer (no Wi-Fi pairing) |
| **Nvidia Shield** | Yes (not tested) | Yes | Yes (not tested) |
| **Fire TV on Fire OS** (Fire OS 6, 7 and 8: Fire TV Stick 4K 1st gen and newer, Stick 4K Max, Cube) | Partial. Takes the Home key back, but Amazon's home flashes up first | Partial | Yes, and it takes the Home key back ([how](on-tv/README.md#fire-tv-fire-os)) |
| **Fire TV on Vega OS** (newer Fire TV sticks) | No | No | No |
| **Samsung** (Tizen) | App only, opened from Samsung's app row | With a computer at home: yes, as an app that opens itself, not a true home screen ([how](docs/SAMSUNG.md)) | No |
| **LG** (webOS) | App only, opened from LG's app row, while Developer Mode lasts | With a computer at home: as an app that opens itself, like the Samsung. Built, and run on seven real LGs so far ([how](docs/LG.md)) | No |
| **Roku** (TV or box) | App only, a sideloaded channel opened from Roku's home row, while Developer Mode is on | With a computer at home: as a channel that opens itself, not a true home screen. Built from Roku's documentation, not yet tried on a real Roku ([how](docs/ROKU.md)) | No |
| **Apple TV, Hisense with VIDAA** | No | No | No |

**Hisense, Sharp and other brands that sell more than one kind of TV:** it depends on the model,
not the brand. Their Google TV and Android TV models should work. Their VIDAA models run
Hisense's own system and do not. Open **Settings, System, About** (or
**Device Preferences, About**): "Android TV OS" means yes. Or run `scripts/check-tv.py`.
Brand by brand (TCL, Philips, Panasonic, Sharp, Xiaomi and more, untested):
[docs/TV-BRANDS.md](docs/TV-BRANDS.md).

**What you can and cannot do on each:**
- **Google TV and Android TV:** everything in this repo. Your own home screen, your apps in your
  order, the phone remote, finding and playing shows, the sleep timer. Some Google Home features and
  the YouTube button on the remote can stop working once the Google home is switched off.
- **Fire TV (Fire OS):** the phone remote and app launching work. Amazon does not let another home
  screen replace its own, so couch-tv watches for Amazon's home and puts its own home back on top;
  Amazon's home still flashes up for a moment first. Options A and B: `apply.sh` switches the watch
  on by itself. Option C needs three one-off ADB grants: [on-tv/README.md](on-tv/README.md#fire-tv-fire-os).
  Fire OS 6 sticks (Android 7.1) need a release newer than 0.3.
- **Samsung:** it does not run Android apps and it locks its home screen, so couch-tv goes on as a
  Samsung app (you install it with a free tool and your own Samsung sign-in), and the bridge opens
  it every time the TV is switched on, so it needs a computer that stays on. Samsung's own Home
  button still opens Samsung's menu. The phone remote and the assistant work: Netflix plays the
  show by itself, YouTube opens the video, Prime Video, Stan, Binge, Paramount+ and Apple TV are
  handed the title, and other apps open on their home page. No "what is playing" and no
  screenshots. Setup and limits: [docs/SAMSUNG.md](docs/SAMSUNG.md).
- **LG:** the same as the Samsung: couch-tv goes on as an LG app through LG's Developer Mode (free
  tools and your own LG developer account), and the bridge opens it every time the TV is switched
  on, and presses Developer Mode's Extend once a day so LG does not remove it. LG's own Home button
  still opens LG's menu. The phone remote and the assistant work: Netflix opens the title, YouTube
  opens the video, other apps open on their home page. No "what is playing" and no screenshots.
  It has run on seven real LGs so far (webOS 4.10 to a 2025 QNED on webOS 10.3.2): if you try it on another model, please
  open an issue and say how it went. Setup and limits:
  [docs/LG.md](docs/LG.md).
- **Roku:** the same idea as the LG, with the home drawn again as a Roku channel (Roku channels are not web
  pages): you put couch-tv on as a sideloaded channel through Roku's Developer Mode (a password you make
  up on the Roku, no account), and the bridge opens it every time the TV is switched on. Roku's own Home
  button still opens Roku's home. The phone remote and the assistant work: Netflix opens the title,
  YouTube opens the video, other apps open on their home page. No screenshots and no title for what is
  playing. **It was built from Roku's documentation and tested against a test Roku and a simulator, and it
  has not been run on a real Roku**, so expect to fix something. Newer Roku OS also limits remote control
  until "Control by mobile apps" is switched to Permissive or Enabled. If you try it, please open an issue
  and say how it went. Setup and limits: [docs/ROKU.md](docs/ROKU.md).
- **Apple TV, VIDAA and Vega OS Fire TV:** closed. Nothing here works on them.

**Want everything on a Samsung, LG, Roku or another TV?** The Samsung, LG and Roku apps cover the home and the
phone remote, not everything. Plug in a Google TV box (for example the Google TV Streamer) and set
couch-tv up on that, and you get everything, on any TV with an HDMI port.

**Test your own TV** (changes nothing on it, and installs nothing outside this folder):

```sh
git clone https://github.com/Seagey/couch-tv.git && cd couch-tv
python3 --version                                  # needs 3.11 or newer
python3 -m venv .venv && .venv/bin/pip install -r bridge/requirements.txt
.venv/bin/python scripts/find-tvs.py               # lists the TVs on your Wi-Fi
.venv/bin/python scripts/check-tv.py <tv address>  # says which options that TV can run
```

It knocks on the ports each kind of TV answers on (Android TV, Samsung, LG, Roku, Apple), so it
can tell a Samsung from a Google TV without touching anything. Or, by hand: on the TV open
**Settings, System, About** (Google TV) or **Settings, Device Preferences, About** (Android TV 9 to
11). If you see "Android TV OS", it works. Details and sources:
[docs/TV-COMPATIBILITY.md](docs/TV-COMPATIBILITY.md).

Later, once Developer options are on (step 1), `check-tv.py <tv address> --adb` also reads the
Android version and the maker. That one makes the TV ask "Allow USB debugging?" and saves this
computer's key in `~/.android/adbkey`, so it waits until you have decided to go ahead.

## Setting it up with an AI agent

Open this folder in Claude Code (or any coding agent) and say "set this up on my TV". It reads
[AGENTS.md](AGENTS.md) and asks you two things before it touches anything: which TV you have, and
which option you want.

This repo is **two separate things**. You can use the first without the second, but the second
needs the first's TV set up the same way (developer mode on).

| | 1. The TV home | 2. The phone remote and bridge |
|---|---|---|
| What it is | An Android TV app that replaces the Google TV home screen. Scenes, clock, weather, your app row, "keep watching". | A phone web app (the remote) and a small Python service (the bridge) that runs on a computer at home and talks to the TV. |
| Where it lives | `tv-home/` (`android/` is the app, `web/` is its screen) | `remote/` (phone app) and `bridge/` (the service) |
| Runs on | The TV | Your phone, plus a computer that stays on |
| Options | A and B | B (C has its own app, in `on-tv/`) |

## What you need

**For every option:**
- A **Google TV or Android TV** (Android 7.1 or newer, Android 6 experimental) with Developer options and debugging on
  (step 1).
- A computer on the same Wi-Fi to set it up from: macOS or Linux with **Python 3.11 or newer**
  (`python3 --version`). Missing or older: on macOS `brew install python@3.11` or the installer
  from python.org; on Linux your distribution's package (for example `sudo apt install python3.11
  python3.11-venv`; Debian ships Python without the venv part, so if `python3 -m venv .venv` fails
  install `python3-venv`, or use `uv venv --seed .venv`). On a Mac the first `python3` or `git` may ask to install the developer tools:
  say Install, it takes a few minutes. For option A that computer can go back in the cupboard
  afterwards.
- The TV app, `couch-tv-home.apk`: **download it from the GitHub Releases page**, or build it
  yourself ("Building the app" below).

**Option B also needs:**
- An **always-on computer on the same Wi-Fi**: a Mac or a Linux box (a Raspberry Pi is fine).
  The bridge has to be running whenever you want the remote.
- **Node 20 or newer**, once, to build the phone app.
- Optional, **Claude "ask"** ("put on something funny"): the Claude Code program, installed and
  logged in to your own Claude plan. It runs `claude -p` and strips `ANTHROPIC_API_KEY` from the
  environment first, so it never bills an API key. It is off in `config.example.json`; turn it on
  (`"ask": {"enabled": true}`) once Claude Code works on that computer.
- Where a show streams: nothing to set up. The bridge asks JustWatch's public search (no key) for
  the country in `config.json` (`"country": "AU"`, or `"US"`, `"GB"` and so on).
- A free **TMDB key is not needed** by this code. If you add your own poster lookup, put the key in
  `.env` (see `env.example`). Never commit it.

**The home with the computer off (option B):** the app carries its own copy of the home and also
keeps the bridge's latest copy. If the computer is off, the TV still shows the clock, the weather
and your app row. It only loses "keep watching" and the picks. With option A that copy is the home.

## Setup

### Step 1. Developer mode on the TV (every option)

Do this on the TV itself.

1. Open **Settings**, then **System**, then **About** (Google TV). On Android TV 9 to 11 it is
   **Settings, Device Preferences, About**.
2. Go right down to **Android TV OS build** (or **Build**). Press OK on it **seven times**. A
   countdown appears, then "You are now a developer!".
3. Go back. There is a new menu called **Developer options** (under System, or Device Preferences).
4. Find **USB debugging** and switch it on.
5. If there is also a **Network debugging** switch (also called ADB over network or ADB
   debugging), switch it on too. Some TVs have no such switch: on a TCL with Android TV 11, USB
   debugging alone opened the network port. The opposite happened on a 2015 Sony Bravia (Android
   8.0): port 5555 only opened after **Network debugging** was switched on as well. Either way, check from the computer:
   `.venv/bin/python scripts/check-tv.py <tv address>`. If it says ADB is open on port 5555,
   everything in this repo works as it is. If it says only Wireless debugging is on, see the box
   below.
6. Find the TV's address: **Settings, Network and Internet, your Wi-Fi** (or **Settings, Network,
   your Wi-Fi, details**). It looks like four numbers with dots. Give the TV a fixed address in your
   router if you can, so it never changes.

The first time a computer connects, the TV asks "Allow USB debugging?". Tick **Always allow**
and press **Allow**. You never see it again.

> **Allow every computer before you switch the Google home off.** Seen on one Google TV
> (Android 14): after `apply.sh` switched off the Google TV home and its setup app, the TV no longer
> showed "Allow USB debugging?" for any new computer. Computers allowed before that kept working.
> So connect each computer you will use (`check-tv.py <tv address> --adb`, and for option C the
> app's **Connect ADB**) and press Allow **before** step 6. If it already happened, see "If
> something is stuck" in [docs/UNINSTALL.md](docs/UNINSTALL.md).

> **Only Wireless debugging?** Newer Google TVs (Android 11 and up) may offer only **Wireless
> debugging**, which pairs with a code and uses a random port that changes after a restart.
> couch-tv's scripts and the bridge speak plain ADB on a fixed port, so turn the fixed port on once
> with Google's own tools ([Android platform-tools](https://developer.android.com/tools/releases/platform-tools)):
> 1. On the TV: Developer options, **Wireless debugging** on, then **Pair device with pairing
>    code**. It shows a code and an address with a port, for example `<tv address>:37123`.
> 2. On the computer: `adb pair <tv address>:<pairing port> <code>`.
> 3. Back on the Wireless debugging screen, note the port under "IP address and port", then
>    `adb connect <tv address>:<that port>`.
> 4. `adb tcpip 5555`. Port 5555 is now open and `check-tv.py` should say ADB is open on port 5555.
>
> On some TVs port 5555 closes again after a restart. Then run steps 2 to 4 again (option B's
> daily guard and the remote need it open). If your TV keeps a different fixed port open, set
> `"adb_port"` on that TV in `config.json` (or `ADB_PORT=<port>` for the scripts). The Wireless
> debugging port itself needs Google's `adb`; couch-tv cannot use it directly.

> **Mac: "allow devices on your local network".** macOS asks once per program before it lets it
> talk to devices at home. Say **Allow** for Terminal (or the app your AI agent runs in). A program
> that is new to the Mac, like Google's `adb` straight after downloading it, can be blocked
> silently: it then cannot reach the TV although everything else can. couch-tv's own tools
> (`tv-home/tools/tvadb.py`, `on-tv/scripts/real-tv.py`, `check-tv.py`) are plain Python and run
> inside the Python you have already allowed, so use them for everything except the one-off
> Wireless debugging pairing above. If `adb` is blocked: System Settings, Privacy and Security,
> Local Network, and switch on the app it runs in.

### Step 2. Get the code and set up Python (every option)

```sh
git clone https://github.com/Seagey/couch-tv.git
cd couch-tv
python3 --version                    # 3.11 or newer
python3 -m venv .venv
.venv/bin/pip install -r bridge/requirements.txt
cp config.example.json config.json
```

Edit `config.json` (it is private, it never gets committed):

- `tvs`: put your TV's address in `ip`. Give it a name. Add more TVs by adding more entries.
- `people`: the names that show on the "who is watching" switch, any number. None or one: no
  switch. Two: a switch. Three or more: a round head icon that opens a list. It shows even before
  anyone has watched anything. Mark children with
  `"kid": true` and visitors with `"guest": true` so they stay out of the household's picks.
- `weather`: your latitude, longitude, place name and time zone (Open-Meteo, free, no key). A
  suburb or city, never a home address.
- `country`: two letter code, for where shows stream.
- Option B: `bridge.host`, the name of the computer that runs the bridge, for example
  `my-computer.local`.
- Optional: `home` (scenes, how long each stays, 12 or 24 hour clock, how many apps in the dock,
  apps to hide), `quick` per TV (sleep timer, picture mode, look and input buttons), `ask` and
  `phone_remote`.

Every key, with its default: [docs/CONFIG.md](docs/CONFIG.md). Which TV remotes work and which
keys do what: [docs/REMOTES.md](docs/REMOTES.md). How the phone remote is hosted and how to add it to
your phone: [docs/REMOTE.md](docs/REMOTE.md).

Optional settings (port, Claude location) go in `.env`. Copy `env.example` to `.env`.

### Step 3. Pair the TV with the bridge (option B)

```sh
.venv/bin/python bridge/pair_tv.py living-room
```

The TV shows a 6 character code. Type it in and press Enter. That pairs the bridge as a remote (the
TV lists it as "Couch TV bridge"). An AI agent cannot type into the waiting script: it runs that
command in the background, asks you to read the code off the TV, then runs
`.venv/bin/python bridge/pair_tv.py living-room --code <the code>`.

Then:

```sh
.venv/bin/python bridge/pair_tv.py living-room --adb
```

The TV asks "Allow USB debugging?". Tick Always allow, then Allow. The keys it makes are stored on
your computer (`bridge/data/` and `~/.android/adbkey`). They are in `.gitignore`.

### Step 4. Build the phone remote (option B)

```sh
cd remote
npm ci
npm run build
cd ..
```

### Step 5. Run the bridge (option B)

```sh
.venv/bin/python bridge/server.py
```

Open `http://your-computer.local:5400` on your phone (same Wi-Fi). Add it to your home screen.
On an Android 17 phone, if Chrome says `ERR_TOO_MANY_RETRIES` for that address, allow Chrome to reach
devices on your network: Settings, Apps, Chrome, Permissions, Nearby devices, Allow (#69).
To keep the bridge running all the time, use `bridge/examples/couch-tv-bridge.plist.example`
(macOS) or `bridge/examples/couch-tv-bridge.service.example` (Linux). Both set `CLAUDE_BIN` and a
`PATH`, because a background service does not see your shell's.
To run it in Docker on a NAS instead, see [docs/DOCKER.md](docs/DOCKER.md).

If the macOS service logs `No route to host` while a bridge you start by hand works, that is
macOS Local Network privacy, and the Local Network switch alone may not fix it for an interpreter
that is ad-hoc signed with no app bundle (python-build-standalone, for one). Easiest: use a
python.org or Homebrew Python for the venv. Otherwise copy the interpreter into a small app bundle
with its own identity (an `Info.plist` with a `CFBundleIdentifier` and an
`NSLocalNetworkUsageDescription`, then `codesign -s - --force` on the bundle) and point the plist
at it, as described in issue #42.

A laptop bridge must not sleep, or the bridge stops: Battery, Options, Prevent automatic sleeping
on power adapter when the display is off, or `sudo pmset -c sleep 0`.
A MacBook also sleeps when its lid is shut, even on power and with `caffeinate`: keep the lid open, or attach an external display.

**Anyone on your Wi-Fi can use the remote and the assistant.** By default the bridge has no password, so
everyone on the network, kids included, can change the channel, turn the TV off or ask Claude for
a show. Put visitors on a guest Wi-Fi network (most routers have one) so they cannot reach it.

To require a password on your home network, set `"pairing_key"` under `"bridge"` in `config.json`. The
phone remote pairs once by typing it (or opening `http://your-computer.local:5400/?pair=<key>`), and the
TV homes carry their key. See [Switching the pairing key on](docs/CONFIG.md#switching-the-pairing-key-on)
for how to switch it on and update your TVs.

**Never forward a port to the bridge.** The bridge is built for your home network only. Never expose it
to the internet or forward port 5400 on your router. A private network (VPN) app you run yourself
is the safe way to use the phone remote away from home.

`"phone_remote": false` is for a house that only wants the TV home and its quick settings from the
bridge. The bridge still serves the API (the TV home needs it), and the phone page still loads if
someone opens it, so the same rule applies.

### Step 6. Put the TV home on the TV (options A and B; this replaces the Google home screen)

Get `couch-tv-home.apk` from the GitHub Releases page (or build it, below). Look at the TV first
(it changes nothing):

```sh
TV_IP=<your tv address> .venv/bin/python tv-home/tools/survey-tv.py
```

It lists the TV's home screens and the packages `apply.sh` touches.

Then install it. **Option A** (no computer stays on):

```sh
TV_IP=<your tv address> APK=couch-tv-home.apk sh tv-home/tools/apply.sh
```

**Option B** (the home loads from the bridge):

```sh
TV_IP=<your tv address> APK=couch-tv-home.apk BRIDGE_URL=http://my-computer.local:5400 sh tv-home/tools/apply.sh
```

This installs the app and makes it the TV's home. The TV's own home screen (Google TV's or a
maker's own) and the setup app stay installed and switched on, so the TV always has them when it starts: a small
Home button watch puts couch-tv on top whenever the TV opens its own home, which may flash up for a
moment first. Only ambient mode (the idle adverts) and any ad trackers you name in `EXTRA_OFF` are
switched off, and `apply.sh` refuses to switch off anything the TV may need to start. Nothing is
deleted. It also hands the app your `config.json` settings (people, weather, clock, look, quick
buttons) for its built-in copy. **Read the Undo section before you run it.** It is safe to run as
often as you like, and on a TV set up by couch-tv 0.10 or older it switches the Google TV home and
the setup app back on ([why](#if-your-tv-loops-after-a-restart)).

- **A Google TV update can switch ambient mode back on.** With option B the bridge checks once a
  day and switches it off again. With option A there is no bridge: run `apply.sh` again after an
  update (and after you change `config.json`).

**Option A with no computer** (reported by
[udhava2-stack](https://github.com/udhava2-stack), not tested by us). Apps on the TV and the phone
do the install instead of `apply.sh`:

1. Do step 1 (developer mode and USB debugging). Step 2 is not needed.
2. Copy `couch-tv-home.apk` from the Releases page onto a USB stick and plug it into the TV.
3. Install a file manager on the TV, for example
   [File Manager +](https://play.google.com/store/apps/details?id=com.alphainventor.filemanager).
   Open the APK on the USB stick and install it. The TV may ask you to allow installs from the file
   manager first.
4. On your phone, install
   [TV Launcher Manager](https://play.google.com/store/apps/details?id=com.tv.launcher.manager.adb.tvboxtools).
   It connects to the TV over Wi-Fi with ADB, so the TV asks you to allow it. Open **Setup
   Launcher**, pick couch-tv, then restart the TV.

Good to know:

- Neither app is part of couch-tv and we have not checked them. TV Launcher Manager gets the same
  ADB access to your TV that a computer would.
- It may switch off the Google TV home. If it does, switch **Google TV Home** and **Setup** back
  on (Settings, Apps, See all apps, Show system apps, Enable) before you restart the TV: on some
  Google TVs a restart without them loops ([why](#if-your-tv-loops-after-a-restart)). The app does
  not get your `config.json`. Change the look and the people in
  [Settings on the TV](#settings-on-the-tv).
- If a Google TV update brings the Google home back, run **Setup Launcher** again.
- To undo, use the TV-remote steps in [Undo](#undo-put-the-google-home-screen-back).

### Building the app (instead of downloading it)

You need **JDK 21** and the **Android SDK** with platform 34 and build tools 34. Gradle is not
needed: `tv-home/android/gradlew` fetches Gradle 8.11.1 by itself.

1. JDK 21. The simplest way, with no password needed: download the Temurin 21 JDK `.tar.gz`
   for your computer from [adoptium.net](https://adoptium.net/temurin/releases/?version=21), unpack
   it into a folder you own (for example `couch-tv/build/jdk`, which git ignores) and point
   `JAVA_HOME` at it (on macOS the `Contents/Home` folder inside). Or install it system-wide:
   macOS `brew install --cask temurin@21` (asks for your password), Linux
   `sudo apt install openjdk-21-jdk`.
2. The Android SDK command line tools: download "Command line tools only" from
   [developer.android.com/studio](https://developer.android.com/studio), unzip into
   `~/Library/Android/sdk/cmdline-tools/latest` (macOS) or `~/Android/Sdk/cmdline-tools/latest`
   (Linux).
3. Then, with `ANDROID_HOME` set to that `sdk` folder:
   ```sh
   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0"
   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses     # answer y to each licence
   ```
4. Build:
   ```sh
   JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk sh scripts/build-apk.sh
   ```
   It prints where the APKs are (`dist/couch-tv-home.apk`, plus `dist/couch-tv-ontv.apk` for
   option C, and `dist/couch-tv-sync.apk`, the experimental two TV sync helper,
   [docs/SYNC.md](docs/SYNC.md)). The on-TV app carries the phone remote inside it, so for that one the script builds
   `remote/` first, which needs **Node 20 or newer**. `apply.sh` finds `dist/couch-tv-home.apk`
   by itself.

The release APK is signed with your local debug key, which is fine for your own TV. The built-in
copy uses `config.example.json` unless you pass `CONFIG=config.json`; `apply.sh` hands the TV your
own settings either way. Home settings, Updates offers the releases of `Seagey/couch-tv`, which
your own build cannot take (another key): a fork with releases of its own builds with
`UPDATE_REPO=owner/name sh scripts/build-apk.sh`, and `UPDATE_REPO=` (empty) switches updates off.

## If your TV loops after a restart

**Sony Bravia and other Google TV owners: please read this.** couch-tv 0.10 and older switched off
the Google TV home and the Google TV setup app (`setupwraith`) to make couch-tv the home screen. On
some Google TVs, a Sony Bravia among them, that leaves the TV unable to start: after a restart it
shows a blank screen, restarts by itself, and goes round again. Because it keeps restarting, it may
not stay on the Wi-Fi long enough for a computer to reach it. Version 0.11 no longer switches
either of them off (below), and running its `apply.sh` on a TV set up by an older one switches them
back on.

**If your TV is in the loop now:**

1. Switch the TV off at the wall for 10 to 15 minutes, then on again. Have the computer ready.
2. As soon as the TV answers a ping, switch the two back on, from the couch-tv folder:
   ```sh
   TV_IP=<your tv address> sh tv-home/tools/undo.sh
   ```
   If `undo.sh` cannot connect, keep trying these two lines with Google's `adb` while the TV is
   up (each loop gives a short window):
   ```sh
   adb connect <your tv address>:5555
   adb shell pm enable com.google.android.apps.tv.launcherx
   adb shell pm enable com.google.android.tungsten.setupwraith
   ```
3. Once the TV starts normally, you can put couch-tv back with the new `apply.sh`, which leaves
   both on.

**Set up with 0.10 or older and not looping (yet)?** Run `undo.sh` (above) or the new `apply.sh`
before you next restart the TV. Option B: update the bridge too, so its daily check never switches
them off again. With only the TV remote: Settings, Apps, See all apps, Show system apps, then
**Enable** on both **Google TV Home** and **Setup**.

**How couch-tv stays safe now.** The TV's own home screen and setup app stay installed and on, so
the TV always has a home to start with. couch-tv is set as the chosen home, and a small Home button
watch puts couch-tv on top whenever the TV opens its own home (at power on, and from the Home key on
Google TV). The TV's own home may flash up for a moment first. If couch-tv itself crashes twice in a
few minutes, it stands aside and leaves the TV's own home on screen, and tries again a few minutes
later, so a broken couch-tv cannot hold the TV in a loop either. Only ambient mode (the idle
adverts) and any ad tracker you name are switched off, and `apply.sh` refuses to switch off anything
the TV may need to start: a home screen, a setup app, a persistent system app or part of Android.

## If Disney+ (or another app) signs you out after the TV turns off

This is not couch-tv, and changing your password does not fix it. Seen on an Android TV with Disney+
26.20 (November 2026): turn the TV off with Disney+ open, turn it on later, and Disney+ tries to
refresh your sign-in within 2 seconds of waking, before the TV is back on the Wi-Fi. That fails, and
it signs you out. In the TV's log the network came back 1 second after the sign-out.

**Option B fix:** list the app in `close_on_off` for that TV in `config.json`, and restart the bridge:

```json
{ "id": "bedroom", "name": "Bedroom", "ip": "<tv address>", "close_on_off": ["com.disney.disneyplus"] }
```

When the TV turns off, the bridge closes the app completely. The next time you open it, it starts
fresh with the Wi-Fi already up, and you stay signed in. Sign in once more after adding it. Without a
bridge (options A and C), close the app before you turn the TV off (Settings, Apps, the app, Force
stop).

## Undo: put the Google home screen back

The full guide, with the TV-remote-only way and what to do if something is stuck:
[docs/UNINSTALL.md](docs/UNINSTALL.md). In short:

1. **Option B: stop the bridge first**, or its daily guard switches the Google home off again
   (macOS: `launchctl bootout gui/$(id -u)/app.couchtv.bridge`; Linux:
   `systemctl --user disable --now couch-tv-bridge`).
2. Everything off, including developer mode:
   `TV_IP=<your tv address> DEV_OFF=1 sh tv-home/tools/remove-all.sh`. If the computer cannot reach
   the TV it says so, changes nothing and prints the TV-remote steps.

Only the home screen, keeping the app (10 seconds): `TV_IP=<your tv address> sh tv-home/tools/undo.sh`.
It switches back on what `apply.sh` switched off (and the Google TV home and setup app, in case an
older couch-tv switched them off), and makes the home the TV had before the home again. To remove the app as well, after that:
`TV_IP=<your tv address> .venv/bin/python tv-home/tools/tvadb.py shell "pm uninstall app.couchtv.launcher"`.

With only the TV remote (no computer):

1. On the couch-tv home, open the **Settings** tile (the gear at the end of the app row), or press
   the Settings button on your remote.
2. **Apps**, then **See all apps**, then **Show system apps**.
3. If **Google TV Home** or **Setup** (the Google TV setup app) says Disabled, open it and press
   **Enable** (couch-tv 0.10 and older switched them off). Ambient mode and the ad tracker are
   optional. Then open **Settings, Accessibility** and switch off **Home button watch**.
4. Back in **Apps**, open **Home** (the new one) and press **Uninstall**.
5. Press the Home button. Google TV is back.

Do step 3 before step 4. If the new home is removed while Google TV Home is still off, the TV has
no home screen. Apps still open from the remote's app buttons, and the computer undo above still
works.

If the TV ever lost its saved Wi-Fi after an older couch-tv switched the setup app off, enable
**Setup** again (step 3) and set the Wi-Fi from there.

## Two TVs, one show (experimental)

Two Android TVs or Google TVs can be started on the same show within a few hundredths of a second of
each other, so two rooms do not echo. It needs a small helper app on each TV and a computer to run
one command. It has only been tried on two TVs, with YouTube and Netflix, and Samsung, LG, Roku and VIDAA
cannot do it. Read [docs/SYNC.md](docs/SYNC.md) first.

## How it fits together

```
phone remote (remote/)  --->  bridge (bridge/, always-on computer)  --->  the TV
TV home (tv-home/)      --->  bridge (for shows and picks)               (Android TV Remote
                              TV home carries its own copy for when       protocol and ADB)
                              there is no bridge
```

- API contract: [bridge/API.md](bridge/API.md).
- How shows open in each streaming app: [bridge/DEEPLINKS.md](bridge/DEEPLINKS.md).
- Watch history, taste and picks stay on your computer in `bridge/data/`. That folder is in
  `.gitignore`. You can import your own Netflix and YouTube history: [bridge/IMPORT.md](bridge/IMPORT.md).

## Privacy and safety

- Your settings are in `config.json`, your secrets in `.env`, your data in `bridge/data/`. All
  three are ignored by git.
- Before you push a fork, run `scripts/privacy-scan.sh`. It checks for private addresses, emails,
  phone numbers, MAC addresses, home network names and secrets, in the files and the git history.
  You can also give it a file of your own words to block: `scripts/privacy-scan.sh my-denylist.txt`
  (one word per line, keep that file out of the repo). `scripts/install-hook.sh my-denylist.txt`
  runs it before every commit.
- **Never forward a port to the bridge.** The bridge listens on your home network only. Never expose
  it to the internet or forward a port to it on your router. Use a private network (VPN) if you want to
  reach it away from home.
- Option B pairing: anyone on your Wi-Fi can use the remote and the assistant unless you set a
  `pairing_key` under `bridge` in `config.json` (see step 5).
- Smart home (optional, off unless you add it): the Home Assistant token goes in `.env`, then
  only into the TV app's private storage. The home page never sees it, and the app only touches the
  rooms, scenes and doorbell you list. Make a separate Home Assistant user for the TV
  ([docs/CONFIG.md](docs/CONFIG.md), Smart home).

## Limits

- Google TV and Android TV run everything. Fire TV (Fire OS) runs the on-TV app, with Amazon's
  home flashing up first. Samsung runs it as an app, with a computer that stays on, and LG the
  same way (run on seven real LGs so far). Developer mode has to be on.
- A Google TV update can switch the Google home back on. Option B's bridge checks once a day and
  switches it off again; with option A, run `apply.sh` again.
- Some apps will not open a show directly. They open the app instead. See `bridge/DEEPLINKS.md`.
- The bridge's own messages (errors, notes) are in English in every language.
- No support promise. It works on the TVs it was built on. Your TV may differ.

## Credits

- The five scene backgrounds (`scene-*.jpg`) were generated for this project and are free to use.
  The Classic look's photos are Creative Commons from Wikimedia Commons. Both are listed in
  `tv-home/web/backgrounds/CREDITS.md`.
- The streaming app logos in `remote/src/app-logos/` belong to their owners.
- Fonts: Inter and Antonio (both SIL Open Font Licence).
- Show data and posters: JustWatch (credit them if you publish anything built on this).
- Weather: Open-Meteo.
- The doorbell card and Home Assistant scenes on the TV started in the
  [roliusz fork](https://github.com/roliusz/couch-tv).
- The no-computer install for option A came from
  [udhava2-stack](https://github.com/Seagey/couch-tv/pull/14).
- The Bluetooth and Network buttons, Amazon YouTube support and the Fire TV Stick guide came from
  the [killy10o10 fork](https://github.com/killy10o10/couch-tv); the unpaired TV guard from the
  [Justin1491 fork](https://github.com/Justin1491/couch-tv).

MIT licence, see `LICENSE`.
