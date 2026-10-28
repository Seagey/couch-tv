# Which TVs work

Research from public sources (linked below). Only Google TV has been tested
by the author. Everything else is what the sources say, not tested.

- **A. TV home only:** an app replaces the TV's home screen.
- **B. Computer bridge:** a computer at home controls the TV with the Android TV Remote protocol
  and ADB over Wi-Fi.
- **C. Lives on the TV:** the app runs its own server on the TV and controls the TV through its
  own ADB. No computer.

| Platform | A. Home | B. Computer bridge | C. On the TV |
|---|---|---|---|
| Google TV (Chromecast with Google TV, Google TV Streamer, Sony, TCL, Hisense) | Yes | Yes | Partial |
| Older Android TV (Android 9 to 11) | Yes | Yes | Yes |
| Xiaomi TV Stick 4K (Android TV 11) | Yes (reported by a user, not tested by us) | Not reported | Not reported |
| Nvidia Shield | Yes (not tested) | Yes | Yes (not tested) |
| Onn (Google TV) | Yes | Yes | Partial |
| Fire TV on Fire OS (Stick 4K Max, Cube) | Partial | Partial | Yes |
| Fire TV on Vega OS (Stick 4K Select, Stick HD 2026, 4K gen 3) | No | No | No |
| Samsung (Tizen) | App only | As an app the bridge opens on power-on, not a home screen ([SAMSUNG.md](SAMSUNG.md)) | No |
| LG (webOS) | Home screen: root only, fragile. As an app: possible, untested ([LG.md](LG.md)) | Possible, untested | No |
| Roku, Apple TV, Hisense VIDAA | No | No | No |

## Reported by people using it

Not tested by the author. Each line is what someone said worked on their own device.

- **Xiaomi TV Stick 4K: works**, reported by a user. They installed `couch-tv-home.apk` from the
  Releases page (option A) and asked for the settings screen and the Spanish that are now in Home
  settings ([issue #1](https://github.com/Seagey/couch-tv/issues/1)). It runs Android TV 11, so
  use the Android TV 9 to 11 menus (Settings, Device Preferences).

## Notes

- **Google TV, home screen.** Install the new home first, then switch the Google one off with
  `pm disable-user`. Package names differ by device. On some devices the setup app
  (`setupwraith`) switches the Google home back on and has to be switched off too. Some Google Home
  features and the YouTube button can stop working. `tv-home/tools/survey-tv.py` shows what your
  TV has before anything changes.
- **Other makers' home screens.** `apply.sh` only switches off Google's own homes (and the setup
  wizard and ambient mode). A maker's own home that `survey-tv.py` lists is left alone: the TV's
  default home is set to couch-tv with `cmd package set-home-activity` instead, and `undo.sh`
  puts back whichever home the TV had before.
- **Where the settings are.** Google TV: Settings, System, About (and Developer options under
  System). Android TV 9 to 11: Settings, Device Preferences, About (and Developer options under
  Device Preferences).
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
  Amazon's home flashes up. ADB works. The Android TV Remote protocol is not confirmed on Fire TV.
- **Vega OS** is Amazon's newer Linux system. It has no sideloading. Amazon says future Fire TV
  sticks will run it.
- **Samsung and LG** do not run Android apps or let an app replace their home screen. On a Samsung,
  couch-tv runs as a sideloaded app that the bridge opens when the TV comes on
  ([SAMSUNG.md](SAMSUNG.md)). LG should allow the same through its Developer Mode, untested
  ([LG.md](LG.md)). LG's home screen itself can only be touched on a rooted TV, and the known root
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
- Samsung and LG: [Samsung developer forum](https://forum.developer.samsung.com/t/launch-application-automatically-on-boot-of-the-device/26398),
  [webOS developer mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app),
  [webosbrew](https://www.webosbrew.org/devmode/)
- Android TV Remote protocol: [androidtv-remote](https://github.com/kud/androidtv-remote)
