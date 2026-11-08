# couch-tv on a Fire TV Stick

Written by [killy10o10](https://github.com/killy10o10/couch-tv), who runs couch-tv's on-TV app
(`dev.couchtv.ontv`, option C) as the home screen of a
**Fire TV Stick 4K (2nd gen, model AFTKM) on Fire OS 8.1.8.5 (Android 11)**. Everything below was
done on that stick. Other Fire OS 7 and 8 sticks should behave the same; sticks on **Vega OS**
cannot sideload apps at all.

![couch-tv on the Fire TV Stick](screens/firestick-home.jpg)

## The Fire TV extras

- **Bluetooth and Network buttons** at the top right of the home. Fire OS's long-press Home menu
  has neither. On a Fire TV they open Amazon's own screens (Fire OS has no Bluetooth settings
  action); other TVs get Android's standard ones.
- **Amazon's YouTube app** (`com.amazon.firetv.youtube`) is recognised as YouTube.

## What works, and what does not

| | |
|---|---|
| Home screen, clock, scenes, weather, dock | Yes |
| Home button brings couch-tv back | Yes. Amazon's home flashes up for a moment first: Fire OS allows nothing better without root |
| Survives a restart | Yes (the accessibility watcher stays on) |
| Bluetooth button | Yes. If parental controls are on, Fire OS asks for the Prime Video PIN first |
| Network button | Yes |
| Phone remote | Opening apps works without ADB. Keys, typing and "what's playing" need the TV's own ADB (Connect ADB in the app) |
| Keep watching | Only fills from shows started from the phone remote |
| Amazon's YouTube app | Yes, shown and sorted as YouTube |

## Install

You need a computer with `adb` (macOS: `brew install --cask android-platform-tools`) on the same
network as the stick.

1. **Developer options.** Settings, My Fire TV, About: press the device name seven times. Then
   Settings, My Fire TV, Developer options: **ADB debugging** on.
2. **Find the stick's address.** Settings, My Fire TV, About, Network. It changes when the stick
   joins another network (a phone hotspot, say), so look again after a move. A DHCP reservation in
   the router keeps it fixed.
3. **Connect**, then press **Allow** on the TV (tick "Always allow from this computer"):
   ```sh
   adb connect <stick-ip>:5555
   ```
4. **Install** `couch-tv-ontv.apk` from [the Releases page](https://github.com/Seagey/couch-tv/releases):
   ```sh
   adb -s <stick-ip>:5555 install couch-tv-ontv.apk
   ```
5. **Open Couch TV** on the stick and press **Use as home screen**. Skip Connect ADB unless you
   want the phone remote's keys.
6. **Three grants** so it can take the Home key back (they survive restarts):
   ```sh
   adb -s <stick-ip>:5555 shell pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS
   adb -s <stick-ip>:5555 shell appops set dev.couchtv.ontv SYSTEM_ALERT_WINDOW allow
   adb -s <stick-ip>:5555 shell appops set dev.couchtv.ontv GET_USAGE_STATS allow
   ```
   (On Fire OS 8.1.8.5 the second was already `allow` after install; running it does no harm. The
   third is for Fire OS 6, where the accessibility watcher never connects and the app watches usage
   events instead; on 7 and 8 it is simply not used.)
7. **Press "Use as home screen" after the grants** (if it was already on, press it off and on
   again). The app switches its accessibility watcher on when that switch is pressed and at every
   boot, and it needs the grant to be there first. Check it took:
   ```sh
   adb -s <stick-ip>:5555 shell settings get secure enabled_accessibility_services
   ```
   The answer should include `dev.couchtv.ontv/dev.couchtv.ontv.WatchService`. If it does not,
   add it yourself (keep anything already in the list, joined with `:`):
   ```sh
   adb -s <stick-ip>:5555 shell settings put secure enabled_accessibility_services dev.couchtv.ontv/dev.couchtv.ontv.WatchService
   ```
8. Press Home from any app: couch-tv comes back.

## Settings

The gear tile in the dock opens Home settings (weather place, apps, quick buttons, look). They can
also be set from a computer through the app's API, after pairing like a phone (the code shows on
the TV):

```sh
curl -X POST http://<stick-ip>:5400/api/pair/start
curl -X POST http://<stick-ip>:5400/api/pair -H 'Content-Type: application/json' -d '{"pin":"<code>","name":"My computer"}'
# returns {"token": ...}; send it as  Authorization: Bearer <token>
```

- `POST /api/settings` with `weather` (`lat`, `lon`, `place`, `timezone`), `country` (two
  letters), `people`, and `settings.hidden_apps` (packages to hide completely).
- `POST /api/app-order` with `order` (packages, first ones first) and `line` (how many sit in the
  dock before Settings and More apps).

**Forget phones** on the Couch TV screen signs every phone and computer out again.

## Things that will save you time

- **Fire OS 8.1.8 protects most Amazon apps.** `pm uninstall --user 0` fails with
  `DELETE_FAILED_INTERNAL_ERROR` for nearly all of them; `pm disable-user --user 0` works for most.
  Never touch `com.amazon.tv.launcher`: couch-tv relies on it staying put, and the stick can lose
  its home without it.
- **Only one Home watcher at a time.** If another launcher (Projectivy, Wolf) also overrides the
  Home key, they fight. Turn the other one's override off; it can stay installed as a fallback.
- **The Bluetooth screen asks for a PIN** when Amazon parental controls are on. That is Fire OS,
  not couch-tv.
- **Uninstalling the app removes its watcher and grants.** After a reinstall, redo Install steps
  5 to 7. An update (`adb install -r`, same signing key) keeps everything.
- **Restart the stick after an update if Home lands on Amazon's home.** Fire OS keeps the watcher
  switched on but does not always reconnect it after the app is updated (seen on 8.1.8.5). A
  restart reconnects it. To check: `adb shell dumpsys accessibility | grep "Bound services"`
  should list "Couch TV home watch".
- **Prime Video crashes at boot if you switched it off.** With Prime Video (`com.amazon.firebat`)
  disabled, Fire OS still starts it at boot and it crashes 2 to 3 times in the log. That is
  Amazon's and harmless.
- **The setup screen remembers which button had focus.** Count your D-pad presses from what is
  highlighted, not from the left: it is easy to press Forget phones by mistake.
- **Weather defaults to Sydney** until you set a place in Home settings or through the API.

## Undo

Open Couch TV and press **Stop being the home screen**, or remove it:

```sh
adb -s <stick-ip>:5555 uninstall dev.couchtv.ontv
```

Amazon's home is back on the Home key straight away.
