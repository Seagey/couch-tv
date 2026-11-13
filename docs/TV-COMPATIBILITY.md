# Which TVs work

Research from public sources (linked below). Only Google TV has been tested
by the author. Everything else is what the sources say, not tested (Samsung and LG have since run on real
TVs, see their pages, and so has Hisense VIDAA; Philips Titan OS has answered a read only check on one real TV but is not paired; Roku has run as a channel on one real TV, with no bridge; Philips Saphi, VIZIO and Panasonic have not run on a real TV; on TiVo OS the keys and the way to couch-tv's page ran on one real JVC, sent by hand, see [TIVO.md](TIVO.md)).

- **A. TV home only:** an app replaces the TV's home screen.
- **B. Computer bridge:** a computer at home controls the TV with the Android TV Remote protocol
  and ADB over Wi-Fi.
- **C. Lives on the TV:** the app runs its own server on the TV and controls the TV through its
  own ADB. No computer.

| Platform | A. Home | B. Computer bridge | C. On the TV |
|---|---|---|---|
| Google TV (Chromecast with Google TV, Google TV Streamer, Sony, TCL, Hisense) | Yes | Yes | Partial |
| Older Android TV (Android 7.1 to 11) | Yes | Yes | Yes |
| Android 6 TV (Xiaomi Mi TV 4A, PatchWall) | Installs and opens, layout may break (experimental) | Not tested | Installs and opens, set up from a computer (experimental) |
| Xiaomi TV Stick 4K (Android TV 11) | Yes (reported by a user, not tested by us) | Not reported | Not reported |
| XGIMI projector (Android TV 11, XK03H) | Yes, through `apply.sh` (reported by a user, not tested by us) | Not reported | Yes (reported by a user: phone remote, keys, typing and apps; use `apply.sh` for the Home button) |
| Bell Streamer (Bell Canada, Android TV 12) | **Beta**, untested (reported by Sparkybabcia, [#168](https://github.com/Seagey/couch-tv/issues/168)): Bell's Fibe TV app is the box's home, so `apply.sh` switches the Home button watch on. Fibe may flash up before couch-tv comes back. Opening Fibe from the couch-tv tile works; a Fibe button on the remote brings couch-tv back instead | Not reported | Not reported |
| Nvidia Shield | Yes (not tested) | Yes | Yes (not tested) |
| Onn (Google TV) | Yes | Yes | Partial |
| Fire TV on Fire OS 6, 7 and 8 (Stick 4K 1st and 2nd gen, Stick 4K Max, Cube) | Partial | Partial | Partial (home screen confirmed on a Stick 4K 2nd gen by a user; phone remote keys blocked on current Fire OS) |
| Fire TV on Vega OS (Stick 4K Select, Stick HD 2026, 4K gen 3) | App only: built with Amazon's free developer tools | **Beta**: an app the bridge opens when the stick comes up, not a home screen (Amazon's Home button still opens Amazon's home). Phone remote arrows and OK while couch-tv is in front ([FIRE-VEGA.md](FIRE-VEGA.md)) | No |
| Samsung (Tizen) | App only | As an app the bridge opens on power-on, not a home screen ([SAMSUNG.md](SAMSUNG.md)) | No |
| LG (webOS) | Home screen: root only, fragile. As an app: while Developer Mode lasts ([LG.md](LG.md)) | As an app the bridge opens on power-on, like Samsung. Built, and run on eleven real LGs so far ([LG.md](LG.md)) | No |
| Roku (TV or box) | App only (a sideloaded channel), while Developer Mode is on | As a channel the bridge opens on power-on, like Samsung and LG. Built from Roku's documentation. The channel has run on one real Roku TV (Roku OS 16, no bridge; Roku OS 16 refuses a channel's own ECP, so there the app list is baked in at build time with `--apps-from`). The bridge, the power on hook and deep links are **not yet seen on a real Roku** ([ROKU.md](ROKU.md)) | No |
| Hisense VIDAA | App only: a Couch TV tile on firmware that still allows it, else the TV's browser | **Beta**: a page the bridge opens on power-on, like Samsung and LG (VIDAA's Home button still opens VIDAA's home unless you turn on `keep_home`). Confirmed on a real Hisense 55U7N, VIDAA 9 ([VIDAA.md](VIDAA.md), #128). On older firmware (P0218) it connects, pairs and opens itself from a saved browser bookmark, but that TV Browser gives the page a mouse cursor only, so you point and click, couch-tv's own settings and app management can't be reached from the couch and loading is slow; for the full experience plug in a Google TV streamer (thanks trentosc, #131) | No |
| Philips on Titan OS (mostly Europe, from 2023) | Needs a Titan app (Titan's store or DevView), not there yet | **Beta**: the phone remote works now (power, keys, volume, inputs, opening apps); the home opens once there is a Titan app. One real TV (a 43PUS8909/12) has answered the read only check; pairing and the rest are tested against a stand in so far ([PHILIPS-TITAN.md](PHILIPS-TITAN.md)) | No |
| Older Philips with Saphi (about 2015 to 2019, not Android) | No | **Beta**: phone remote, and couch-tv's page opens in the TV's browser if your set offers it; no real home screen (Philips's Home button still opens Philips's menu). Depends on the model and firmware ([PHILIPS-SAPHI.md](PHILIPS-SAPHI.md)) | No |
| VIZIO (SmartCast, VIZIO OS) | No (no browser, no sideloading) | **Beta, phone remote only**: power, volume, inputs and opening apps; couch-tv's home page cannot open on the TV. Tested against a stand in so far ([VIZIO.md](VIZIO.md)) | No |
| Panasonic Viera (My Home Screen, older Vieras) | No | **Beta**: phone remote and a page that opens itself in the TV's browser (Panasonic's Home button still opens Panasonic's home) ([PANASONIC.md](PANASONIC.md)) | No |
| Apple TV | No (Apple lets no app replace its home; tvOS has no web view) | **Beta**: phone remote and opening apps, and Couch TV, the home as an Apple TV app that opens itself, installed free from a Mac with your own Apple ID and reinstalled weekly by the computer at home (Apple's Home button still opens Apple's home) ([APPLE-TV.md](APPLE-TV.md)) | No |
| TiVo OS (JVC, Telefunken and other Vestel built sets) | No (no outside apps, no app store) | **Beta**: phone remote and a page the bridge opens in the TV's browser, from a Speed Dial tile added once (TiVo's Home button still opens TiVo's home). Keys and the way to the page ran on one real JVC LT-50VUQ3455; the power on hook has not been watched on a real TV ([TIVO.md](TIVO.md)) | No |

**VIZIO, what it cannot do.** couch-tv's home page does not open on a VIZIO by itself: VIZIO OS has no
browser, no sideloading and a closed app programme, and its Chromecast built in only opens registered
receivers. So option B on a VIZIO is the phone remote and the assistant, not a home. Testers who already use
Home Assistant's Cast dashboards or a DashCast style tool can try showing couch-tv's page that way and report
back ([VIZIO.md](VIZIO.md), "One open experiment"); couch-tv has no code for it.

## Reported by people using it

Not tested by the author. Each line is what someone said worked on their own device.

- **Xiaomi TV Stick 4K: works**, reported by a user. They installed `couch-tv-home.apk` from the
  Releases page (option A) and asked for the settings screen and the Spanish that are now in Home
  settings ([issue #1](https://github.com/Seagey/couch-tv/issues/1)). It runs Android TV 11, so
  use the Android TV 9 to 11 menus (Settings, Device Preferences).
- **Samsung Smart Monitor M8 (LS32BM801UUXEN, Tizen 6.5): works as an app with no computer
  left running**, reported by a user. They built it with `samsung/build.py` without `--bridge` and
  installed it with Apps2Samsung. couch-tv opened YouTube and Netflix, and Samsung's Autorun Last
  App brought it back after the monitor was switched off and on. The install stopped printing at
  65% but the app was there. If the install service is unreachable after Developer Mode, unplug
  the monitor for a minute ([issue #93](https://github.com/Seagey/couch-tv/issues/93)).
- **LG OLED65C56LA (OLED C5, 2025, webOS 11.2, firmware 43.21.96): works**, reported by BlueSpark911 with
  the bridge on Windows 10. The first LG on webOS 11.2. The snags were Windows ones and are in
  [LG.md](LG.md) ([issue #136](https://github.com/Seagey/couch-tv/issues/136)).
- **Nokia Streaming Box 8000 (Sagemcom, SEI600NK4, Android TV 14): works**, reported by lelijk1tje with
  `apply.sh` and no computer left running (option A, `KEEP_AMBIENT=1`). The box keeps Google's home as
  the Home key target, so the Home button watch brings couch-tv back after a Home press, and couch-tv
  comes up by itself after a restart. Unlike the TiVo Stream 4K, the box's own service did not remove
  it ([issue #139](https://github.com/Seagey/couch-tv/issues/139)).
- **LG QNED88T6A and NANO83A6A (2025, webOS 10.3): both work on one bridge**, reported by a user
  who followed [LG.md](LG.md) and measured key presses on the TVs. Lighter home brought a key press
  from about 50 ms to 16 ms on both. Developer Mode and couch-tv survived a firmware update; only
  Key Server had to be switched on again
  ([issue #89](https://github.com/Seagey/couch-tv/issues/89)).
- **XGIMI XK03H projector (Android TV 11): works**, reported by nithinjak. The on-TV app's "Use as home
  screen" alone did not take the Home button there: the projector still went back to Google's home. Use
  `apply.sh` (option A), whose Home button watch works: a single Home press and a restart both come back to
  couch-tv. The projector has no Wireless debugging, only USB debugging, and that alone opens ADB on port
  5555, which `check-tv.py` reports (thanks nithinjak, [#159](https://github.com/Seagey/couch-tv/issues/159)).
- **Hisense VIDAA, older firmware P0218: connects, pairs and opens couch-tv from a browser bookmark**, reported
  by trentosc. Navigation there is point and click, because the older TV Browser never passes the D pad to a
  page. Details: [VIDAA.md](VIDAA.md) (thanks trentosc, [#131](https://github.com/Seagey/couch-tv/issues/131)).
- **Hisense 43A6N (VIDAA, firmware V0003.09.60A.Q0707, Germany): works with the bridge**, reported by
  Schielef. The modern login worked with the owner's own client certificate (from their copy of Hisense's
  app), PIN pairing held across later connections, the Couch TV tile went in and opened couch-tv, and the
  app list came through. Their report led to `keep_home` leaving the source picker alone after the Input
  key, the `pointer` option for the TV Browser, and the trace hiding the refresh token
  ([issue #145](https://github.com/Seagey/couch-tv/issues/145)).

## Notes

- **Google TV, home screen.** Install the new home first, then switch the Google one off with
  `pm disable-user`. Package names differ by device. Do not: on some Google TVs (a Sony Bravia
  among them) the TV loops at every restart once the Google home and the setup app (`setupwraith`)
  are off, and some Google Home features and the remote's YouTube button stop working. couch-tv
  leaves both on and uses a Home button watch instead, so those keep working.
  `tv-home/tools/survey-tv.py` shows what your TV has before anything changes.
- **Other makers' home screens.** `apply.sh` switches off no home screen at all, Google's or a
  maker's. The TV's default home is set to couch-tv with `cmd package set-home-activity`, the Home
  button watch covers TVs where the TV's own home still wins, and `undo.sh` puts back whichever
  home the TV had before.
- **Google TV where the home choice does not stick.** On some boxes (a Xiaomi, issue #54) Google's home stays the resolved home after `apply.sh`, so every Home press opens it first and the Home button watch brings couch-tv back (a moment later, and again after the quick presses settle). `apply.sh` says so when it sees this. It is not an error.
- **Android TV 10 and newer, no computer (issue #98).** couch-tv can ask Android to make it the home (`RoleManager.ROLE_HOME`), which shows Android's own "default home app" screen; below Android 10 it opens Home settings or the "Select a home app" chooser. This is how a Haier on Android TV 11 with no computer gets a home. On Google TV the TV's own home can still win the Home key, so the Home button watch from `apply.sh` is needed there. Nothing here switches off the TV's own home.
- **Where the settings are.** Google TV: Settings, System, About (and Developer options under
  System). Android TV 9 to 11: Settings, Device Preferences, About (and Developer options under
  Device Preferences).
- **TCL memory manager.** A TCL TV can trim couch-tv shortly after it starts (`com.tcl.guard`, log tag
  `TGuardMemoryManagerTrimHandler`). No crash has come of it, and the home starts again when you press Home.
  A TCL on Android TV 11 also starts its Google home as `.home.VanillaModeHomeActivity`, which the Home
  button watch knows ([issue #51](https://github.com/Seagey/couch-tv/issues/51)).
- **TCL after a restart.** TCL's boot controller opens the Google home before the Home button watch is running,
  so on a TCL the watch puts couch-tv in front once in the first two minutes after a restart, as it does on
  Fire OS ([issue #94](https://github.com/Seagey/couch-tv/issues/94), PR #114). A TCL set to power on to an
  HDMI input or live TV is covered by couch-tv that one time: press Input to go back.
- **ADB port.** Most Android TVs and Google TV boxes open the fixed port 5555, which every couch-tv
  script uses: with a Network debugging switch, or on some TVs (a TCL with Android TV 11) with USB
  debugging alone. Some Android 11 and newer Google TVs only offer Wireless
  debugging (pairing code, random port). For options A and B, open port 5555 once with Google's
  platform-tools (`adb pair`, `adb connect`, `adb tcpip 5555`,
  [SETUP.md step 1](SETUP.md#step-1-developer-mode-on-the-tv-every-option)); on some TVs it
  closes again after a restart. `scripts/check-tv.py` says which kind your TV has.
- **Google TV, on the TV (C).** Many Android 11 and newer Google TVs (all the Android 13 and newer
  ones seen so far) use "Wireless debugging" with a pairing code and a random port, not the old
  fixed port 5555. The app has to pair with the TV once, and
  the port changes after a restart. See `on-tv/README.md` for how it handles that.
- **Fire OS.** Amazon blocks real home screen replacement. The workarounds relaunch your app after
  Amazon's home flashes up; for options A and B `apply.sh` switches that on, and the on-TV app
  (option C) does it itself once three one-off ADB grants are given (`on-tv/README.md`, "Fire TV
  (Fire OS)"). Fire OS 6 is Android 7.1 (Fire TV Stick 4K 1st gen); both apps run on it from the
  release after 0.3, checked on an Android 7.1 emulator only. ADB from a computer works. Fire OS
  Current Fire OS (6.7.1.1, 7.6.6.9, 8.1.0.3 and newer) blocks an app on the TV from using the TV's own ADB, so on an up to
  date Fire TV option C's phone remote cannot press keys or type ([issue #12](https://github.com/Seagey/couch-tv/issues/12));
  option B can. `scripts/check-tv.py <tv address> --adb` now reads the Fire OS version and says which case yours is (only the version is read, and it has not run on a real Fire TV yet). Fire OS 6 never connects the accessibility watcher (it runs Amazon's own accessibility
  manager), so there the Home button watch goes by usage access, the third grant. Seen on an Insignia Fire TV
  Edition, Fire OS 6.7.1.1 ([issue #50](https://github.com/Seagey/couch-tv/issues/50)). The Android TV Remote protocol is not confirmed on Fire TV.
  The gear tile's TV settings (and the Settings app tile) open Fire OS's own Settings screen by name and tell
  the Home button watch for a few seconds that Amazon's home coming forward is Settings being drawn, so Settings
  stays open ([issue #75](https://github.com/Seagey/couch-tv/issues/75), [#123](https://github.com/Seagey/couch-tv/issues/123)). Pressing the remote's Home button and then going to Amazon's Settings is still a Home press: couch-tv comes back.
- **Vega OS** is Amazon's newer Linux system. It has no APKs and no ADB, but Amazon's own Developer Mode
  does allow installing your own app (free Amazon Developer account, Vega CLI on a Mac or Linux computer, a
  USB cable once). couch-tv goes on as a WebView app the bridge opens ([FIRE-VEGA.md](FIRE-VEGA.md)); Amazon's
  home cannot be replaced. Amazon says future Fire TV sticks will run it.
- **Roku** channels are BrightScript and SceneGraph, not web pages, so the home is drawn again natively
  (`roku/`) and the bridge talks to the Roku over its External Control Protocol on port 8060
  (`bridge/roku.py`). Built from Roku's documentation, tested against a test Roku and a BrightScript
  simulator, then run as a channel on one real Roku TV (Roku OS 16.0.4, no bridge, thanks mjiles, #152); the
  bridge path is still not seen on a real one. Roku OS 16 refuses a channel's own ECP (403), so with no
  bridge `roku/build.py --apps-from <roku address>` copies the app list and icons in at build time and the
  list is a snapshot. A sideloaded channel is always one at a time, and newer Roku OS limits
  that protocol unless "Control by mobile apps" allows it ([ROKU.md](ROKU.md)). Roku's home screen cannot be
  replaced.
- **Panasonic Viera on My Home Screen** (Firefox OS) and older Vieras do not run Android apps or let an
  app replace the home screen. The bridge talks to the TV over its network remote (SOAP on port 55000,
  `bridge/panasonic.py`), and each time the TV comes on it opens couch-tv's home page in the TV's web
  browser. New, Beta: the browser hand off and the standby behaviour are the parts a first owner's log
  settles ([PANASONIC.md](PANASONIC.md)). Limits: the browser bar stays visible, Panasonic's Home button
  still opens Panasonic's home, and the TV cannot say what is on screen, so couch-tv opens only just after
  power on. 2018 and newer sets pair once with a PIN. Panasonic's Google TV models are normal couch-tv TVs.
- **Hisense VIDAA** does not run Android apps or let an app replace its home screen. The bridge talks to the
  TV the way Hisense's own phone app does (MQTT over TLS on port 36669, `bridge/vidaa.py`) and opens couch-tv's
  home page in the TV's browser, or as a tile on firmware that still accepts one, each time the TV comes on.
  Newer firmware (2024 on) needs a client certificate the owner takes from their own copy of Hisense's app;
  couch-tv never ships it. Confirmed on a Hisense 55U7N (#128) and reported working on a 43A6N (#145); parts
  of the protocol are still unconfirmed on other firmware ([VIDAA.md](VIDAA.md)). VIDAA's Home button cannot be taken over without root, and
  couch-tv never roots a TV.
- **Philips on Titan OS** does not run Android apps, has no sideloading or developer mode switch, and runs a
  web page only as a Titan app. The bridge drives it with Philips's own network remote (JointSpace, HTTPS on
  port 1926, PIN pairing, `bridge/philips.py`): power, keys, volume, inputs and opening the apps it lists. The
  pairing needs a key from Philips's own TV Remote app that the owner saves themselves; couch-tv never ships
  it. couch-tv's home could only open through a published Titan app or Titan's DevView developer app, and
  neither exists for couch-tv yet ([PHILIPS-TITAN.md](PHILIPS-TITAN.md), "The home"). One real TV (a 43PUS8909/12,
  read only, not paired) has answered the check: its JointSpace API, its mDNS announcement and its browser activity
  are confirmed, but **pairing, keys, volume, inputs, apps and the home have not run on a real Titan OS TV**
  (the rest is tested against a stand in). Titan OS is on Philips TVs sold in Europe from 2023.
- **Older Philips with Saphi** (Philips's own Linux system, roughly 2015 to 2019) does not run Android apps or
  let an app replace its home screen. Some sets answer Philips's network remote on plain port 1925 with no
  pairing, one owner's set wanted a PIN and refused it, and some have no network remote at all. The bridge
  tries 1925 first, needs no login when the TV asks for none, and falls back to the paired path when it does
  (`bridge/philips.py`, `"saphi": true`). When the TV lists a browser, couch-tv's page opens in it at power on
  (`activities/browser`); that is a page that opens itself, not a home screen. New (Beta): checked against a
  stand in only, and every protocol detail is marked UNCONFIRMED in [PHILIPS-SAPHI.md](PHILIPS-SAPHI.md).
- **Samsung and LG** do not run Android apps or let an app replace their home screen. On a Samsung,
  couch-tv runs as a sideloaded app that the bridge opens when the TV comes on
  ([SAMSUNG.md](SAMSUNG.md)). On an LG the same is built, through LG's Developer Mode, and has run on
  eleven real LGs so far ([LG.md](LG.md)). LG's home screen itself can only be touched on a rooted TV, and the known root
  methods are being patched. Not recommended.
- **Google developer verification (2026).** Google's FAQ says apps installed with ADB do not need
  verification, and enforcement outside Google Play covers phones and tablets. couch-tv installs
  over ADB. [FAQ](https://developer.android.com/developer-verification/guides/faq).

## Sources

- Home replacement: [FLauncher README](https://github.com/svrooij/flauncher),
  [freya.cat, Mar 2025](https://freya.cat/blog/post/2025-03-11)
- On-TV ADB: [TV Remote on F-Droid](https://f-droid.org/en/packages/com.porter.tvremote/),
  [AFTVnews, Remote ADB](https://www.aftvnews.com/?p=7897),
  [ADB on the Google TV Streamer](https://allaboutchromecast.com/using-adb-on-google-tv-streamer/),
  [adb docs](https://developer.android.com/tools/adb)
- Fire TV: [AFTVnews, launchers](https://www.aftvnews.com/?p=41438),
  [Android Authority, Vega OS](https://www.androidauthority.com/amazon-vega-os-fire-tv-stick-3602647/)
- Roku: [External Control API](https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md),
  [deep linking](https://developer.roku.com/docs/developer-program/discovery/implementing-deep-linking.md),
  [developer setup](https://developer.roku.com/docs/developer-program/getting-started/developer-setup.md)
- Samsung and LG: [Samsung developer forum](https://forum.developer.samsung.com/t/launch-application-automatically-on-boot-of-the-device/26398),
  [webOS developer mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app),
  [webosbrew](https://www.webosbrew.org/devmode/)
- Android TV Remote protocol: [androidtv-remote](https://github.com/kud/androidtv-remote)
