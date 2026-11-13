# What works on each TV

This page says, for each kind of TV, which of the three ways to run couch-tv works and what you can and cannot do on it.

## On this page

- [All TVs in one table](#all-tvs-in-one-table)
- [It depends on the model, not the brand](#it-depends-on-the-model-not-the-brand)
- [Google TV and Android TV](#google-tv-and-android-tv)
- [Fire TV on Fire OS](#fire-tv-on-fire-os)
- [Samsung](#samsung)
- [LG](#lg)
- [Roku](#roku)
- [The Beta paths](#the-beta-paths)
  - [Hisense VIDAA](#hisense-vidaa)
  - [Philips with Titan OS](#philips-with-titan-os)
  - [Older Philips with Saphi](#older-philips-with-saphi)
  - [Fire TV on Vega OS](#fire-tv-on-vega-os)
  - [VIZIO](#vizio)
  - [Panasonic Viera](#panasonic-viera)
  - [Apple TV](#apple-tv)
  - [TiVo OS](#tivo-os)
- [Want everything on a TV that is not Google TV or Android TV?](#want-everything-on-a-tv-that-is-not-google-tv-or-android-tv)
- [Test your own TV](#test-your-own-tv)

Sources and test reports: [TV-COMPATIBILITY.md](TV-COMPATIBILITY.md). Brand by brand: [TV-BRANDS.md](TV-BRANDS.md).

## All TVs in one table

A, B and C are the [three ways to run it](../README.md#three-ways-to-run-it).

| Your TV | A. TV home only | B. Computer bridge | C. Lives on the TV |
|---|---|---|---|
| **Google TV** (Sony, TCL, Hisense Google TV, Philips and others) | Yes | Yes | Partial. Newer models may ask for a pairing code again after a restart |
| **Google TV box** (Google TV Streamer, Chromecast with Google TV, Onn) | Yes | Yes | Partial, as above |
| **Older Android TV** (Android 7.1 to 11) | Yes | Yes | Yes |
| **Android 6 TV** (Xiaomi Mi TV 4A, PatchWall) | Experimental: opens, layout may break on an old browser engine | Not tested | Experimental, set up from a computer (no Wi-Fi pairing) |
| **XGIMI projector** (Android TV 11, XK03H) | Yes, through `apply.sh` (reported by a user) | Not reported | Yes. "Use as home screen" alone does not take the Home button there: use `apply.sh` (option A). No Wireless debugging: USB debugging opens ADB on 5555 (thanks nithinjak, [#159](https://github.com/Seagey/couch-tv/issues/159)) |
| **Bell Streamer** (Bell Canada, Android TV 12) | **Beta**, untested ([#168](https://github.com/Seagey/couch-tv/issues/168)): Bell's Fibe TV app is the home, so `apply.sh` switches the Home button watch on and couch-tv comes back after Fibe flashes up. Opening Fibe from the couch-tv tile works; a Fibe button on the remote brings couch-tv back instead | Not reported | Not reported |
| **Nvidia Shield** | Yes (not tested) | Yes | Yes (not tested) |
| **Fire TV on Fire OS** (Fire OS 6, 7 and 8: Fire TV Stick 4K 1st gen and newer, Stick 4K Max, Cube) | Partial. Takes the Home key back, but Amazon's home flashes up first | Partial | Partial. It takes the Home key back, but on current Fire OS the phone remote cannot press keys or type ([why](../on-tv/README.md#fire-tv-fire-os)) |
| **Fire TV on Vega OS** (Stick 4K Select and newer) | App only, built once with Amazon's free developer tools | **Beta**, with a computer at home that stays on: an app that opens itself when the stick comes up. Amazon's Home button still opens Amazon's home; the phone remote works while couch-tv is in front, and Netflix and YouTube open from the phone ([how](FIRE-VEGA.md)) | No |
| **Samsung** (Tizen) | App only, opened from Samsung's app row (or reopened by its Autorun Last App) | With a computer at home: yes, as an app that opens itself, not a true home screen ([how](SAMSUNG.md)) | No |
| **LG** (webOS) | App only, opened from LG's app row, while Developer Mode lasts | With a computer at home: as an app that opens itself, like the Samsung. Built, and run on ten real LGs so far ([how](LG.md)) | No |
| **Roku** (TV or box) | App only, a sideloaded channel opened from Roku's home row, while Developer Mode is on | With a computer at home: as a channel that opens itself, not a true home screen. Built from Roku's documentation, first real Roku reports wanted ([how](ROKU.md)) | No |
| **Hisense with VIDAA** | App only: a tile on the app row where the firmware allows it, else the TV's browser | **Beta**, with a computer at home that stays on: a page that opens itself in the TV's browser. VIDAA's Home button still opens VIDAA's home unless you opt in with `keep_home` ([how](VIDAA.md)). On older firmware the TV Browser gives the page a mouse cursor only, so you point and click ([what to expect](VIDAA.md#what-to-expect-on-older-vidaa-firmware-field-report-firmware-p0218)) | No |
| **Philips with Titan OS** (mostly Europe) | Needs a Titan app: a Titan store app or Titan's DevView, not there yet | **Beta**, with a computer at home that stays on: the phone remote works now (power, keys, volume, inputs, apps). The home opens once there is a Titan app ([how](PHILIPS-TITAN.md)) | No |
| **Older Philips with Saphi** (about 2015 to 2019, not Android) | No | **Beta**, with a computer at home that stays on: phone remote, and couch-tv's page opens in the TV's browser if your set offers one. Philips's Home button still opens Philips's menu ([how](PHILIPS-SAPHI.md)) | No |
| **VIZIO** (SmartCast, VIZIO OS) | No (no browser, no sideloading) | **Beta, phone remote only**, with a computer at home that stays on: power, volume, inputs and opening apps ([how](VIZIO.md)) | No |
| **Panasonic Viera** (My Home Screen and older Vieras) | No | **Beta**, with a computer at home that stays on: phone remote, and a page that opens itself in the TV's browser. Panasonic's Home button still opens Panasonic's home ([how](PANASONIC.md)) | No |
| **Apple TV** | No: Apple lets no app replace its home | **Beta**, with a computer at home that stays on: phone remote (keys, sleep and wake, opening apps), and the couch-tv home as an Apple TV app, Couch TV (Beta, free with your own Apple ID and a Mac, reinstalled weekly by the computer at home). Apple's Home button still opens Apple's home ([how](APPLE-TV.md)) | No |
| **TiVo OS** (JVC, Telefunken and other Vestel built sets) | No | **Beta**, with a computer at home that stays on: phone remote, and a page that opens itself in the TV's browser from a Speed Dial tile you add once. TiVo's Home button still opens TiVo's home. Run on one real JVC so far ([how](TIVO.md)) | No |

## It depends on the model, not the brand

**Hisense, Sharp and other brands that sell more than one kind of TV:** it depends on the model,
not the brand. Their Google TV and Android TV models should work. Their VIDAA models run
Hisense's own system and get the VIDAA path below, not the full couch-tv. Open **Settings, System, About** (or
**Device Preferences, About**): "Android TV OS" means yes. Or run `scripts/check-tv.py`.
Brand by brand (TCL, Philips, Panasonic, Sharp, Xiaomi and more, from public sources):
[TV-BRANDS.md](TV-BRANDS.md).

## Google TV and Android TV

**At a glance.** Works as: your own home screen, with everything in this repo. Needs: a Home button watch, switched on by `apply.sh`. Home button: brings couch-tv to the front; the Google home stays on.

**Google TV and Android TV:** everything in this repo. Your own home screen, your apps in your
order, the phone remote, finding and playing shows, the sleep timer. couch-tv never switches the
Google home off (older versions did, and that is what broke some Google features and the remote's
YouTube button). It stays on, and a Home button watch (an accessibility service, switched on by
`apply.sh`) brings couch-tv to the front when you press Home.

## Fire TV on Fire OS

**At a glance.** Works as: the phone remote, app launching and couch-tv's home put back on top of Amazon's. Needs: `apply.sh` for options A and B, three one-off ADB grants for option C, and a release newer than 0.3 on Fire OS 6. Home button: Amazon's home flashes up for a moment, then couch-tv's home is back on top.

**Fire TV (Fire OS):** the phone remote and app launching work (with option C on current Fire OS,
the phone remote's keys and typing do not: Amazon blocks an app from using the TV's own ADB, so
use option B for the full remote). Amazon does not let another home
screen replace its own, so couch-tv watches for Amazon's home and puts its own home back on top;
Amazon's home still flashes up for a moment first. Options A and B: `apply.sh` switches the watch
on by itself. Option C needs three one-off ADB grants: [on-tv/README.md](../on-tv/README.md#fire-tv-fire-os).
Fire OS 6 sticks (Android 7.1) need a release newer than 0.3.

## Samsung

**At a glance.** Works as: a Samsung app that the bridge opens every time the TV is switched on. Needs: a computer that stays on, a free tool and your own Samsung sign-in. Home button: still opens Samsung's menu.

**Samsung:** it does not run Android apps and it locks its home screen, so couch-tv goes on as a
Samsung app (you install it with a free tool and your own Samsung sign-in), and the bridge opens
it every time the TV is switched on, so it needs a computer that stays on. Samsung's own Home
button still opens Samsung's menu. The phone remote and the assistant work: Netflix plays the
show by itself, YouTube opens the video, Prime Video, Stan, Binge, Paramount+ and Apple TV are
handed the title, and other apps open on their home page. No "what is playing" and no
screenshots. Setup and limits: [SAMSUNG.md](SAMSUNG.md).

## LG

**At a glance.** Works as: an LG app through LG's Developer Mode that the bridge opens every time the TV is switched on. Needs: the bridge, free tools and your own LG developer account. Home button: still opens LG's menu.

**LG:** the same as the Samsung: couch-tv goes on as an LG app through LG's Developer Mode (free
tools and your own LG developer account), and the bridge opens it every time the TV is switched
on, and presses Developer Mode's Extend once a day so LG does not remove it. LG's own Home button
still opens LG's menu. The phone remote and the assistant work: Netflix opens the title, YouTube
opens the video, other apps open on their home page. No "what is playing" and no screenshots.
It has run on ten real LGs so far (from webOS 4.10 to 2025 models on webOS 10.3.2 and 11.2, and one
upgraded to webOS 26): if you try it on another model, please
open an issue and say how it went. Setup and limits:
[LG.md](LG.md).

## Roku

**At a glance.** Works as: a sideloaded Roku channel that the bridge opens every time the TV is switched on. Needs: the bridge and Roku's Developer Mode (a password you make up, no account). Home button: still opens Roku's home.

**Roku:** the same idea as the LG, with the home drawn again as a Roku channel (Roku channels are not web
pages): you put couch-tv on as a sideloaded channel through Roku's Developer Mode (a password you make
up on the Roku, no account), and the bridge opens it every time the TV is switched on. Roku's own Home
button still opens Roku's home. The phone remote and the assistant work: Netflix opens the title,
YouTube opens the video, other apps open on their home page. No screenshots and no title for what is
playing. **It was built from Roku's documentation and tested against a test Roku and a simulator, and the channel
has since run on one real Roku TV (Roku OS 16, no bridge); the bridge path has not been seen on a real
Roku**, so expect to fix something. Roku OS 16 blocks a channel's own remote calls, so with no bridge
build with `--apps-from` ([ROKU.md](ROKU.md)). Newer Roku OS also limits remote control
until "Control by mobile apps" is switched to Permissive or Enabled. If you try it, please open an issue
and say how it went. Setup and limits: [ROKU.md](ROKU.md).

## The Beta paths

**At a glance.** Works as: couch-tv opened on top of the maker's home, or the phone remote only. Needs: a computer at home that stays on. Home button: still opens the maker's own home.

**The Beta paths: Hisense VIDAA, Philips, Fire TV on Vega OS, VIZIO, Panasonic, TiVo OS and Apple TV.** All of them need a
**computer at home that stays on**, and on all of them **the maker's own Home button still opens the
maker's own home**: couch-tv opens itself on top, it does not replace that home. VIDAA now runs on a real Hisense (Beta, below), and the TiVo OS path was worked out on a real JVC. The
others have not run on a real TV yet, so if you try one, please open an issue and say how it went (each has
a short read only first test).

### Hisense VIDAA

**At a glance.** Works as: couch-tv's home in the TV's browser (or a tile on the app row on older firmware), opened every time the TV is switched on. Needs: a computer at home that stays on, and on newer firmware a certificate from your own copy of Hisense's phone app. Home button: still opens VIDAA's home unless you opt in with `keep_home: true`.

**Hisense VIDAA (Beta):** no app to install: the bridge talks to the TV the way Hisense's own phone app
does, and every time the TV is switched on it opens couch-tv's home in the TV's browser (or as a tile on
the app row, on older firmware that still accepts one). VIDAA's Home button still opens VIDAA's home unless you opt in with `keep_home: true` (Beta), and
couch-tv never roots a TV. The phone remote works; apps open on their own page; no "what is playing" and
no screenshots. Newer firmware needs a certificate you take from your own copy of Hisense's phone app
(couch-tv does not include it). Setup and limits: [VIDAA.md](VIDAA.md).

**On older VIDAA firmware** (field report on firmware P0218, thanks trentosc, #131) it connects, pairs, and
opens itself from a bookmark saved in the TV Browser, but that browser gives a page a mouse cursor only,
never the D pad: you point and click, couch-tv's own settings and app management can't be reached from the
couch, and loading is slow. For the full couch-tv on a Hisense, plug in a Google TV streamer.

### Philips with Titan OS

**At a glance.** Works as: the phone remote for now; couch-tv's home waits for a Titan app. Needs: a computer at home that stays on, and a key from Philips's own phone app that you save yourself. Home button: the home stays Philips's for now.

**Philips with Titan OS (Beta):** the phone remote works now: power, keys, volume, inputs, opening the
TV's apps and the assistant on top of those. couch-tv's home needs a Titan app to open on the TV: a
couch-tv app in Titan's store, or Titan's DevView developer app. Neither is there yet, so for now the home
stays Philips's. Pairing needs a key from Philips's own phone app that you save yourself (couch-tv does
not include it). Mostly Philips TVs sold in Europe from 2023. Setup, limits and the home routes:
[PHILIPS-TITAN.md](PHILIPS-TITAN.md).

### Older Philips with Saphi

**At a glance.** Works as: the phone remote, and couch-tv's page in the TV's own browser if your set offers one. Needs: a computer at home that stays on; some sets want a PIN. Home button: still opens Philips's menu.

**Older Philips with Saphi (Beta)** (Philips's own Linux system, roughly 2015 to 2019): the phone remote,
and couch-tv's page opens in the TV's own browser each time it is switched on, if your set offers a
browser to the network remote. The browser's bar can show and the remote's Home button still opens
Philips's menu. Many of these sets need no pairing; some want a PIN and some have no network remote at
all, so it depends on the model. A two minute test in a web browser tells you which:
[PHILIPS-SAPHI-TESTING.md](PHILIPS-SAPHI-TESTING.md). Setup and limits:
[PHILIPS-SAPHI.md](PHILIPS-SAPHI.md).

### Fire TV on Vega OS

**At a glance.** Works as: an app that the computer at home opens when the stick comes up. Needs: a computer at home, and to build the app once a free Amazon Developer account, a Mac or Linux computer and a USB cable. Home button: still opens Amazon's home.

**Fire TV on Vega OS (Beta):** couch-tv goes on as an app you build once with Amazon's free developer
tools (a free Amazon Developer account, a Mac or Linux computer and a USB cable), and the computer at home
opens it when the stick comes up. Amazon's Home button still opens Amazon's home, the phone remote presses
arrows and OK while couch-tv is in front but not volume or power off, and only Netflix and YouTube open
from the phone. Setup and limits: [FIRE-VEGA.md](FIRE-VEGA.md).

### VIZIO

**At a glance.** Works as: the phone remote only; couch-tv's home cannot open on a VIZIO. Needs: a computer at home that stays on, and a PIN the TV shows once. Home button: opens VIZIO's home.

**VIZIO (Beta), phone remote only** (SmartCast and VIZIO OS): the bridge talks to the TV the way VIZIO's
own phone app does: power, the remote's keys, volume, switching inputs by name, and opening Netflix,
YouTube, Prime Video, Disney+ and other apps on their own page. couch-tv's home cannot open on a VIZIO:
VIZIO OS has no browser, takes no sideloaded app, and its app programme is a closed partner scheme.
VIZIO's Home button opens VIZIO's home. No "what is playing" title, no typing and no screenshots. You
type a PIN the TV shows once. Setup and limits: [VIZIO.md](VIZIO.md).

### Panasonic Viera

**At a glance.** Works as: the phone remote, and couch-tv's home in the TV's web browser a few seconds after the TV is switched on. Needs: a computer at home that stays on; 2018 and newer sets pair once with a PIN. Home button: still opens Panasonic's home.

**Panasonic Viera (Beta)** (My Home Screen, and older Vieras with network control): nothing to install on
the TV: the bridge talks to it the way Panasonic's own phone app does, and every time the TV is switched
on it opens couch-tv's home in the TV's web browser a few seconds later. The browser's own bar stays
visible and Panasonic's Home button still opens Panasonic's home. The phone remote works, with a real
volume level; apps open on their own page; no "what is playing" and no screenshots. 2018 and newer sets
pair once with a PIN on the TV. Panasonic's Google TV models are normal couch-tv TVs. Setup, limits and
the read only first test: [PANASONIC.md](PANASONIC.md).

### Apple TV

**At a glance.** Works as: the phone remote, and the home as a native Apple TV app, Couch TV, that the bridge opens every time the Apple TV wakes. Needs: a computer at home that stays on, Xcode on a Mac and your own Apple ID, with a reinstall each week. Home button: still opens Apple's home.

**Apple TV (Beta):** the phone remote works, with no app and no payment: the bridge pairs once with a PIN
and then sends the remote keys, sleep and wake, and opens any app on the Apple TV by its bundle id. tvOS
has no web view, so the home is drawn again as a native Apple TV app, **Couch TV** (`tvos/`): the scenes
with the glass clock, the date and weather, people, Keep watching, your apps and kids mode, and the bridge opens it
every time the Apple TV wakes. Apple's own Home button still opens Apple's home. You put Couch TV on the
Apple TV yourself, free, with Xcode on a Mac and your own Apple ID; Apple makes that run out after 7 days,
so the computer at home reinstalls it each week with `scripts/appletv-resign.sh` (or once a year with
Apple's paid developer programme). Limits and steps: [APPLE-TV.md](APPLE-TV.md).

### TiVo OS

**At a glance.** Works as: the phone remote, and couch-tv in the TV's browser, opened every time the TV is switched on. Needs: a computer at home that stays on, and a Speed Dial tile you add once. Home button: still opens TiVo's home.

**TiVo OS (Beta)** (JVC, Telefunken and other sets built by Vestel): nothing to install on the TV. The
bridge talks to it the way Vestel's own phone app does, and every time the TV is switched on it presses
the keys that open couch-tv in the TV's browser, from a Speed Dial tile you add once. With the browser's
bar switched off the page fills the screen. TiVo's Home button still opens TiVo's home, the TV gives no
volume level, and only Netflix and Prime Video open from the phone. Worked out on one real JVC; the
list of what ran there and what did not is in [TIVO.md](TIVO.md).

## Want everything on a TV that is not Google TV or Android TV?

The Samsung, LG, Roku, VIDAA, Philips
Saphi, Panasonic, TiVo OS and Vega paths give you the home (opened on top of the maker's) and the phone remote, not
everything, and Philips Titan OS and VIZIO are the phone remote for now. Plug in a Google TV box (for
example the Google TV Streamer) and set couch-tv up on that, and you get everything, on any TV with an
HDMI port.

## Test your own TV

This changes nothing on the TV, and installs nothing outside this folder:

```sh
git clone https://github.com/Seagey/couch-tv.git && cd couch-tv
python3 --version                                  # needs 3.11 or newer
python3 -m venv .venv && .venv/bin/pip install -r bridge/requirements.txt
.venv/bin/python scripts/find-tvs.py               # lists the TVs on your Wi-Fi
.venv/bin/python scripts/check-tv.py <tv address>  # says which options that TV can run
```

It knocks on the ports each kind of TV answers on (Android TV, Samsung, LG, Roku, VIDAA, VIZIO, Apple), so it
can tell a Samsung from a Google TV without touching anything. Or, by hand: on the TV open
**Settings, System, About** (Google TV) or **Settings, Device Preferences, About** (Android TV 9 to
11). If you see "Android TV OS", it works. Details and sources:
[TV-COMPATIBILITY.md](TV-COMPATIBILITY.md).

Later, once Developer options are on ([step 1](SETUP.md#step-1-developer-mode-on-the-tv-every-option)), `check-tv.py <tv address> --adb` also reads the
Android version and the maker. That one makes the TV ask "Allow USB debugging?" and saves this
computer's key in `~/.android/adbkey`, so it waits until you have decided to go ahead.
