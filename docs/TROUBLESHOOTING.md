# Troubleshooting

Fixes for problems seen on real TVs, starting with a TV that goes round in a restart loop.

- [If your TV loops after a restart](#if-your-tv-loops-after-a-restart)
- [TCL: Home goes back to Google TV after every restart](#tcl-home-goes-back-to-google-tv-after-every-restart)
- [If Disney+ (or another app) signs you out after the TV turns off](#if-disney-or-another-app-signs-you-out-after-the-tv-turns-off)
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

## TCL: Home goes back to Google TV after every restart

On a TCL Google TV (reported on a TCL Smart TV Pro, Android 14) the TV's own boot manager can stop
the Home button watch from starting, so Home falls back to Google TV after each restart. On main, in
the next release, couch-tv adds an empty TV input on TCL TVs only, which TCL lets start at boot. Open the app once after
installing so it is switched on. Other TVs are unchanged and show no new input. This is unconfirmed
until it is tested on a real TCL.

**A fix confirmed on a real TCL (0.12, without the TV input):** from a computer, once, run
`adb shell appops set app.couchtv.launcher AUTO_START allow`, then on the TV itself open Settings,
Accessibility and switch on **Home button watch** and **Home gear button** with the remote (not over
ADB). After a real power cut at the wall the TV went straight to couch-tv with no flash of Google
TV, and TCL kept AUTO_START allowed. It is not yet known which of the two steps does it, so do both. If the two services are not in the Accessibility menu yet, open couch-tv once, then set AUTO_START and write `enabled_accessibility_services` and `accessibility_enabled 1` over ADB: on that TCL the services only appeared in the menu once they were actually running.

On some TVs, installing or removing any other app makes Android forget couch-tv as the home (the Home button watch still brings it back after a flash of Google TV). Running `cmd package set-home-activity app.couchtv.launcher/.MainActivity` again fixes it straight away.

If Home still reverts, press Back twice to leave Google TV, and
from a computer after each restart run: `cmd package set-home-activity
app.couchtv.launcher/.MainActivity`, start the app, `appops set app.couchtv.launcher AUTO_START
allow`, then write `enabled_accessibility_services` and `accessibility_enabled 1` again. On that TCL
a real double press of Home also stays on Google TV; Back twice escapes.

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

## Something else stuck

If the TV no longer asks "Allow USB debugging?", or the home will not go away, see "If something is stuck" in [UNINSTALL.md](UNINSTALL.md). Each TV guide in [the docs index](README.md) has its own limits and fixes, and the open issues often have a fix for your model.
