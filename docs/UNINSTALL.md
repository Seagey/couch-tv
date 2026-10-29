# Take couch-tv off your TV

Use this if something went wrong, or you just do not want it any more. Nothing couch-tv does
deletes anything from the TV. It only switches things off, so everything can be switched back on.

## Option B: stop the bridge first

The bridge checks once a day that the Google home is still off and switches it off again. Stop it
**before** you touch the TV, or it can undo your undo.

- **macOS:** `launchctl bootout gui/$(id -u)/app.couchtv.bridge`, then delete
  `~/Library/LaunchAgents/app.couchtv.bridge.plist`.
- **Linux:** `systemctl --user disable --now couch-tv-bridge` (the name you gave the `.service`
  file), delete `~/.config/systemd/user/couch-tv-bridge.service`, then
  `systemctl --user daemon-reload`. If you ran `loginctl enable-linger $USER` only for couch-tv,
  `loginctl disable-linger $USER` undoes it.
- **Running in a terminal:** press Ctrl+C there.

Options A and C have no bridge on a computer: go straight on.

## The quick way (a computer, 1 minute)

From the couch-tv folder on the computer you set it up with:

```sh
TV_IP=<your tv address> DEV_OFF=1 sh tv-home/tools/remove-all.sh
```

It first checks the computer can still reach the TV. If it cannot, it changes nothing, prints the
TV-remote steps below and stops. Otherwise it does all of this, in order, and stops at the first
thing that fails:
1. Switches the Google TV home, ambient mode, the setup wizard and anything else `apply.sh`
   switched off back on, and makes the home the TV had before couch-tv the home again.
2. Removes the couch-tv apps (the home screen app `app.couchtv.launcher` and the "lives on the TV"
   app `dev.couchtv.ontv`).
3. Switches off network debugging, USB debugging and Developer options. Leave out `DEV_OFF=1` to
   keep Developer options on.

Press Home on the TV. You should see the normal Google TV home.

To remove only one app by hand, without the rest:
`TV_IP=<your tv address> .venv/bin/python tv-home/tools/tvadb.py shell "pm uninstall app.couchtv.launcher"`
(nothing else to install: `tvadb.py` is the small ADB client in this repo).

## Then tidy up

- **The remote pairing (option B).** The TV remembers the bridge as a remote called "Couch TV
  bridge" (or your `client_name`). On the TV: **Settings, Remotes and accessories** (on some TVs
  **Settings, System, Remotes and accessories**, or **Paired devices**), pick it and choose
  **Forget** or **Unpair**. Leaving it does no harm: nothing can use it once the bridge is gone.
- **The computer's ADB key.** `~/.android/adbkey` and `~/.android/adbkey.pub` are the key the TV
  said "Always allow" to. Delete them if nothing else on the computer uses ADB (Android Studio
  and Google's `adb` use the same files). "Revoke USB debugging authorisations" below forgets it
  on the TV's side.
- **Smart home (if you set it up).** `undo.sh` takes back "display over other apps" (the doorbell
  card). In Home Assistant, delete the TV's long-lived access token (its user's profile, Security)
  or the whole TV user. Removing the app from the TV removes its copy of the token too.
- **The couch-tv folder.** Delete it if you want your watch history gone too (`bridge/data/` holds
  it, plus `config.json` and `.env`).
- **Phones.** On each phone, press and hold the remote's icon and remove it.

## With only the TV remote (no computer)

1. On the couch-tv home, open the **Settings** tile (the gear at the end of the app row; in the
   Classic look it is a tile in the grid). Or press the Settings button on your remote.
2. **Apps**, then **See all apps**, then **Show system apps**.
3. Open **Google TV Home** (it says Disabled) and press **Enable**. Do the same for **Setup**.
   Ambient mode and the ad tracker are optional.
4. Back in **Apps**, open the couch-tv **Home** app and press **Uninstall**. Do the same for
   **Couch TV** (the "lives on the TV" app) if you have it.
5. Press the Home button. Google TV is back.

**Do step 3 before step 4.** If the couch-tv home is removed while Google TV Home is still off, the
TV has no home screen. Apps still open from the remote's app buttons, and the computer way above
still works.

## Leave developer mode

1. **Settings, System, Developer options** (Android TV 9 to 11: **Settings, Device Preferences,
   Developer options**).
2. Press **Revoke USB debugging authorisations**. Every computer that was allowed in is forgotten.
3. Switch off **Network debugging** or **Wireless debugging**, then **USB debugging**.
4. At the top of Developer options, switch **Developer options** itself off. The menu disappears.

On some TVs the switch is under **Settings, System, About** instead. If there is no off switch, a
restart after step 3 is enough: nothing can connect any more.

## If something is stuck

- **The TV forgot its Wi-Fi.** It can happen right after the setup wizard is switched off or on.
  Open Settings, Network, and join your Wi-Fi again. Your apps and logins are still there.
- **The computer cannot reach the TV any more** (for example after the Wi-Fi was forgotten).
  The computer undo cannot work then. Use "With only the TV remote" above.
- **A new computer never gets "Allow USB debugging?".** Seen on one Google TV (Android 14): with
  the Google TV home and the setup app switched off, the TV no longer shows that question for a
  computer (or app) it has not allowed before. Computers allowed earlier still work. Fix: do steps
  2 and 3 of "With only the TV remote" to switch **Google TV Home** and **Setup** back on, connect
  the new computer and press Allow, then run `apply.sh` again to put couch-tv back.
- **Home goes to a blank or "setup" screen.** Do "With only the TV remote" above, step 3, to switch
  Google TV Home and Setup back on.
- **A Google TV update brought the old home back.** That is fine if you were removing couch-tv.
  If you want to keep couch-tv, run `apply.sh` again.
- **Nothing works and you want it like new.** A factory reset (Settings, System, About, Reset)
  puts the TV back to how it came out of the box. It also deletes every app and login on the TV, so
  it is the last resort, not the first.
