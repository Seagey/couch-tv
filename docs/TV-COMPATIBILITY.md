# Which TVs work

Research from public sources (linked below). Only Google TV has been tested
by the author. Everything else is what the sources say, not tested (Samsung and LG have since run on real
TVs, see their pages; Roku has not).

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
| Nvidia Shield | Yes (not tested) | Yes | Yes (not tested) |
| Onn (Google TV) | Yes | Yes | Partial |
| Fire TV on Fire OS 6, 7 and 8 (Stick 4K 1st and 2nd gen, Stick 4K Max, Cube) | Partial | Partial | Partial (home screen confirmed on a Stick 4K 2nd gen by a user; phone remote keys blocked on current Fire OS) |
| Fire TV on Vega OS (Stick 4K Select, Stick HD 2026, 4K gen 3) | No | No | No |
| Samsung (Tizen) | App only | As an app the bridge opens on power-on, not a home screen ([SAMSUNG.md](SAMSUNG.md)) | No |
| LG (webOS) | Home screen: root only, fragile. As an app: while Developer Mode lasts ([LG.md](LG.md)) | As an app the bridge opens on power-on, like Samsung. Built, and run on seven real LGs so far ([LG.md](LG.md)) | No |
| Roku (TV or box) | App only (a sideloaded channel), while Developer Mode is on | As a channel the bridge opens on power-on, like Samsung and LG. Built from Roku's documentation, **not yet tried on a real Roku** ([ROKU.md](ROKU.md)) | No |
| Apple TV, Hisense VIDAA | No | No | No |

## Reported by people using it

Not tested by the author. Each line is what someone said worked on their own device.

- **Xiaomi TV Stick 4K: works**, reported by a user. They installed `couch-tv-home.apk` from the
  Releases page (option A) and asked for the settings screen and the Spanish that are now in Home
  settings ([issue #1](https://github.com/Seagey/couch-tv/issues/1)). It runs Android TV 11, so
  use the Android TV 9 to 11 menus (Settings, Device Preferences).

## Notes

- **Google TV, home screen.** Install the new home first, then switch the Google one off with
  `pm disable-user`. Package names differ by device. Do not: on some Google TVs (a Sony Bravia
  among them) the TV loops at every restart once the Google home and the setup app (`setupwraith`)
  are off. couch-tv leaves both on and uses a Home button watch instead. Some Google Home
  features and the YouTube button can stop working. `tv-home/tools/survey-tv.py` shows what your
  TV has before anything changes.
- **Other makers' home screens.** `apply.sh` switches off no home screen at all, Google's or a
  maker's. The TV's default home is set to couch-tv with `cmd package set-home-activity`, the Home
  button watch covers TVs where the TV's own home still wins, and `undo.sh` puts back whichever
  home the TV had before.
- **Google TV where the home choice does not stick.** On some boxes (a Xiaomi, issue #54) Google's home stays the resolved home after `apply.sh`, so every Home press opens it first and the Home button watch brings couch-tv back (a moment later, and again after the quick presses settle). `apply.sh` says so when it sees this. It is not an error.
- **Where the settings are.** Google TV: Settings, System, About (and Developer options under
  System). Android TV 9 to 11: Settings, Device Preferences, About (and Developer options under
  Device Preferences).
- **TCL memory manager.** A TCL TV can trim couch-tv shortly after it starts (`com.tcl.guard`, log tag
  `TGuardMemoryManagerTrimHandler`). No crash has come of it, and the home starts again when you press Home.
  A TCL on Android TV 11 also starts its Google home as `.home.VanillaModeHomeActivity`, which the Home
  button watch knows ([issue #51](https://github.com/Seagey/couch-tv/issues/51)).
- **ADB port.** Most Android TVs and Google TV boxes open the fixed port 5555, which every couch-tv
  script uses: with a Network debugging switch, or on some TVs (a TCL with Android TV 11) with USB
  debugging alone. Some Android 11 and newer Google TVs only offer Wireless
  debugging (pairing code, random port). For options A and B, open port 5555 once with Google's
  platform-tools (`adb pair`, `adb connect`, `adb tcpip 5555`, README step 1); on some TVs it
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
  option B can. Fire OS 6 never connects the accessibility watcher (it runs Amazon's own accessibility
  manager), so there the Home button watch goes by usage access, the third grant. Seen on an Insignia Fire TV
  Edition, Fire OS 6.7.1.1 ([issue #50](https://github.com/Seagey/couch-tv/issues/50)). The Android TV Remote protocol is not confirmed on Fire TV.
- **Vega OS** is Amazon's newer Linux system. It has no sideloading. Amazon says future Fire TV
  sticks will run it.
- **Roku** channels are BrightScript and SceneGraph, not web pages, so the home is drawn again natively
  (`roku/`) and the bridge talks to the Roku over its External Control Protocol on port 8060
  (`bridge/roku.py`). Built from Roku's documentation, tested against a test Roku and a BrightScript
  simulator, **never on a real Roku**. A sideloaded channel is always one at a time, and newer Roku OS limits
  that protocol unless "Control by mobile apps" allows it ([ROKU.md](ROKU.md)). Roku's home screen cannot be
  replaced.
- **Samsung and LG** do not run Android apps or let an app replace their home screen. On a Samsung,
  couch-tv runs as a sideloaded app that the bridge opens when the TV comes on
  ([SAMSUNG.md](SAMSUNG.md)). On an LG the same is built, through LG's Developer Mode, but not
  yet tried on a real LG ([LG.md](LG.md)). LG's home screen itself can only be touched on a rooted TV, and the known root
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
