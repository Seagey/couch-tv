# Troubleshooting

Fixes for problems seen on real TVs, starting with a TV that goes round in a restart loop.

- [If your TV loops after a restart](#if-your-tv-loops-after-a-restart)
- [TCL: Home goes back to Google TV after every restart](#tcl-home-goes-back-to-google-tv-after-every-restart)
- [If Disney+ (or another app) signs you out after the TV turns off](#if-disney-or-another-app-signs-you-out-after-the-tv-turns-off)
- [Moving along the rows feels slow](#moving-along-the-rows-feels-slow)
- [The phone can't press keys (ADB or Wireless debugging won't connect)](#the-phone-cant-press-keys-adb-or-wireless-debugging-wont-connect)
- [LG: the TV refuses couch-tv, or Developer Mode won't start](#lg-the-tv-refuses-couch-tv-or-developer-mode-wont-start)
- [Something else stuck](#something-else-stuck)

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

## Sony Bravia: the TV turns very slow after switching off "unused" Sony apps

Seen on a Sony Bravia XBR-65X850G (Android TV 10, 2.3 GB of memory). Switching off Sony's browser engine, `com.vewd.core.service`, and its three `com.sony.dtv.browser.*` packages looks safe: they belong to Sony's web browser and web apps, which most people never open. But Sony's AirPlay app, `com.sony.dtv.airplayapp`, binds to `com.vewd.core.service` when it starts, so with the engine off AirPlay crashes and Android restarts it several times a second. The log shows `Unable to bind to com.vewd.core.service/.BrowserServiceImpl`, the CPU load climbs past 30, and poster pictures stop loading on the home.

The fix is to switch them back on, then restart the home:

```sh
for p in com.vewd.core.service com.sony.dtv.browser.webappruntime com.sony.dtv.browser.webappruntimeextension com.sony.dtv.browser.webappservice; do
  TV_IP=<your tv address> .venv/bin/python tv-home/tools/tvadb.py shell "pm enable --user 0 $p"
done
```

couch-tv itself never switches these off (`apply.sh` and the privacy list leave them alone). If you switch off Sony apps by hand, do it one at a time, check `logcat -d -b crash` after each, and keep a list so that you can switch each one back on with `pm enable --user 0 <package>`.

On the same TV these were switched off with no ill effect over an evening of use, about five hours (all with `pm disable-user --user 0`, never uninstalled, so no sign-in was lost): `tv.samba.ssm` (Samba TV), `com.sony.dtv.promos`, `com.sony.dtv.sonyselect`, `com.sony.dtv.notificationcenter`, the Sony analytics apps `com.qterics.da.product`, `com.sony.dtv.da.service` and `com.sonyericsson.idd.agent`, the shop demo and hotel mode apps (`com.sony.dtv.demosupport`, `com.sony.dtv.demosystemsupport`, `com.sony.dtv.multiscreendemo`, `com.sony.dtv.b2b.hotelmode`, `rs232csupport`, `prosettings`, `adminpassword`, `deviceadminsettings`, `importexport`), `com.google.android.feedback`, the Google bug report sender, Play Games, Play Movies and YouTube Music. This is one TV, so treat it as a report, not a rule.

## TCL: Home goes back to Google TV after every restart

On a TCL Google TV (reported on a TCL Smart TV Pro, Android 14) the TV's own boot manager can stop
the Home button watch from starting, so Home falls back to Google TV after each restart. Since 0.13, couch-tv adds an empty TV input on TCL TVs only, which TCL lets start at boot. Open the app once after
installing so it is switched on. Other TVs are unchanged and show no new input. This is unconfirmed
until it is tested on a real TCL.

**A fix confirmed on a real TCL (0.12, without the TV input):** from a computer, once, run
`adb shell appops set app.couchtv.launcher AUTO_START allow` (on some TCL builds the op is named `APP_AUTO_START` instead, and `AUTO_START` answers "Unknown operation string"; run `adb shell appops get app.couchtv.launcher` to see which name your TV lists), then on the TV itself open Settings,
Accessibility and switch on **Home button watch** and **Home gear button** with the remote (not over
ADB). After a real power cut at the wall the TV went straight to couch-tv with no flash of Google
TV, and TCL kept AUTO_START allowed. It is not yet known which of the two steps does it, so do both. If the two services are not in the Accessibility menu yet, open couch-tv once, then set AUTO_START and write `enabled_accessibility_services` and `accessibility_enabled 1` over ADB: on that TCL the services only appeared in the menu once they were actually running.

**Not on every TCL.** On a second TCL (Smart TV Pro, build G08 AU02, Android 14, 0.12) the same two steps survived a restart from the TV's menu but not a real power cut: TCL set AUTO_START back to `ignore` about 20 seconds after boot, and only the Home gear button came back, not the Home button watch. TCL's own Safety Guard app has no switch for this, so on that TV ADB is the only way to allow it. What brought it back from a computer: set AUTO_START, run `cmd package set-home-activity`, start couch-tv, then write `enabled_accessibility_services` with the Home gear button alone first, and then with both. Writing both at once did not bring the Home button watch back.

On some TVs, installing or removing any other app makes Android forget couch-tv as the home (the Home button watch still brings it back after a flash of Google TV). Running `cmd package set-home-activity app.couchtv.launcher/.MainActivity` again fixes it straight away.

If Home still reverts, press Back twice to leave Google TV, and
from a computer after each restart run: `cmd package set-home-activity
app.couchtv.launcher/.MainActivity`, start the app, `appops set app.couchtv.launcher AUTO_START
allow`, then write `enabled_accessibility_services` and `accessibility_enabled 1` again. On that TCL
a real double press of Home also stays on Google TV; Back twice escapes.

## Fire TV: Home still opens Amazon's home right after apply.sh

Seen twice on a Fire TV Cube (3rd gen, Fire OS 7.7.1.7): `apply.sh` finished with "home screen now:
couch-tv", but a few seconds later `enabled_accessibility_services` was empty and
`accessibility_enabled` was 0 again, so the Home button watch was off and the Home key stayed on
Amazon's home. Writing the two settings once more held, through force-stops and Home presses. The
app's own rebind (it takes the watch out of the list and puts it back, ten seconds after it starts)
was tried on its own over ADB and leaves both settings intact, so it is not the cause; what clears
them is not pinned down. `apply.sh` now looks again after pressing Home and puts them back. If a
Fire TV is still on Amazon's home after `apply.sh`, run from the repo root:

```sh
TV_IP=<tv address> .venv/bin/python tv-home/tools/tvadb.py shell "settings put secure enabled_accessibility_services app.couchtv.launcher/.FireWatch; settings put secure accessibility_enabled 1"
```

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

## Moving along the rows feels slow

If Lighter home and switching off Glass panels and the Video background did not help, the cost may not be the page at all. On some TVs the GPU cannot composite a 1080p window at 60 frames a second, so the page runs at 60 but the screen shows 30. That was the case on an XGIMI Elfin Flip Plus ([#197](https://github.com/Seagey/couch-tv/issues/197)).

**Try it for a minute** (needs ADB, so option A or B; reversible):

```sh
adb shell wm size 1280x720      # the whole TV draws at 720p
# move along the rows for a minute, then:
adb shell wm size reset         # undo
```

If the rows turn smooth, the GPU is the limit. Keep it for couch-tv only, without changing the rest of the TV:

1. Put `"render_height": 720` under `home` in `config.json` (see [CONFIG.md](CONFIG.md)).
2. Run `tv-home/tools/apply.sh`, or restart the home.

To undo it, remove the key or set it to `0`. Text and pictures are a little softer than at full size. If it helps, or does not, please say which TV and Android version on [#197](https://github.com/Seagey/couch-tv/issues/197).

## The phone can't press keys (ADB or Wireless debugging won't connect)

On the on-TV app (option C), open Home settings on your phone, This TV, **Let the phone press keys**,
and press **Check now** under **Can't connect?**. It looks at the TV and says the one thing in the way,
with the fix:

| What it says | What to do |
|---|---|
| The phone can't reach the TV | Phone and TV on the same Wi-Fi: not a guest network, not mobile data. Check the TV is on, then load the page again. |
| The TV is on a network cable | Wireless debugging (Android 11 and newer) only works on Wi-Fi. Join the Wi-Fi on the TV, or use the older TVs steps with Network debugging, which works on a cable. |
| Debugging is off on the TV | Settings, System, About (older Android TV: Settings, Device Preferences, About): press OK on Build seven times. Then Developer options, USB debugging on (some TVs call it Network debugging or ADB debugging). On a Fire TV: Settings, My Fire TV, About, press OK on the device name seven times, then My Fire TV, Developer options, ADB debugging on. |
| Wireless debugging is off | Developer options, Wireless debugging on, tick Always allow on this network, then the newer TVs steps. |
| Wireless debugging is on, but Couch TV is not paired yet | Wireless debugging, Pair device with pairing code, and type the 6 digit code on the phone. |
| This TV has no Wireless debugging | Android 10 or older: Network debugging (on some TVs USB debugging), then Let the phone press keys. |
| The TV is waiting for you, or nobody answered the TV's Allow question | Press Let the phone press keys and look at the TV straight away: tick Always allow and press Allow. If no question shows, restart the TV and try again. |
| The TV's debugging connection is closed | Some TVs close it after a restart: switch Wireless debugging (or Network debugging) off and on again, then press Let the phone press keys. |
| This Fire TV stops Couch TV pressing keys by itself | Amazon switched it off in a Fire TV update. Keys and typing from the phone need a home computer running couch-tv (option B). |

Still stuck: press **Copy a report** and paste it into your question or a GitHub issue. It holds the
TV model, the Android version, the network type, the debugging switches, the connection state and
the last error. Addresses are replaced with `[address]`, and there are no keys, no passwords and no
TV name in it. The box under the button shows exactly what was copied.

## LG: the TV refuses couch-tv, or Developer Mode won't start

An LG is not Android, so the Android steps (Build seven times, USB debugging) are not there. See
"If LG says no" in [LG.md](LG.md#if-lg-says-no): Developer Mode is LG's own app, what to check when
the TV refuses the `.ipk`, and why couch-tv opening at power on needs a computer at home.

## Something else stuck

If the TV no longer asks "Allow USB debugging?", or the home will not go away, see "If something is stuck" in [UNINSTALL.md](UNINSTALL.md). Each TV guide in [the docs index](README.md) has its own limits and fixes, and the open issues often have a fix for your model.
