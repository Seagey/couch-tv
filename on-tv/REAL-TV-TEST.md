# Real-TV test for on-TV mode

For whoever runs the first test on a real TV. Run it only after the TV's owner has said go, and
only on the TV they named. Everything below talks to one TV at `<TV_IP>`; keep the real address
out of any file in this folder.

**Ground rules**
- Install as a **separate app** (`dev.couchtv.ontv`). Never replace, disable or re-enable any other
  package, never change the default home app, never touch an existing launcher or its keep-off list.
- **Sound off first**, and check it again after any restart.
- No playback and no volume changes during the test. `real-tv-check.mjs` only opens Settings and
  presses down and home.
- Restart the TV only to answer the "does port 5555 survive a restart" question, at most twice.
  If 5555 does not come back, every computer that uses ADB on that TV (including a computer bridge)
  loses its ADB features until network debugging is switched on again by hand.
- At the end: app left installed but **not** home, TV off.

Tools: `scripts/real-tv.py` (pure-Python ADB with your computer's existing key, so it works where the
`adb` binary is blocked by macOS Local Network) and `scripts/real-tv-check.mjs` (HTTP only).
Run `real-tv.py` with a Python that has `adb-shell` (the computer bridge's `.venv` has it).

## 0. Wake the TV and turn the sound off (computer bridge, if there is one)

```
curl -s -X POST localhost:5400/api/power -H 'content-type: application/json' -d '{"state":"on"}'
curl -s localhost:5400/api/now          # read "volume"
```
- If `volume.muted` is `true`: leave it.
- Else if `volume.known` is `true`: `curl -s -X POST localhost:5400/api/volume -H 'content-type: application/json' -d '{"level":0}'`
- Else: `... -d '{"action":"mute"}'` once, then read `/api/now` again and confirm `muted` is `true`.
  If it cannot be confirmed, stop and ask.

Without a computer bridge: mute with the TV's own remote.

**Mute does not survive a power cycle** on a TV whose sound goes out over HDMI ARC (seen on an
Android 14 Google TV): after any restart or off and on, mute again with the remote-protocol mute
key (`/api/volume {"action":"mute"}` on the computer bridge) and check `muted` again.
`cmd media_session volume --set 0` did not mute that TV.

## 1. Look before installing

```
python3 scripts/real-tv.py --ip <TV_IP> check
```
Write down: Android version, which home app is first, whether `service.adb.tcp.port` is 5555,
whether wireless debugging is on.

## 2. Install alongside, not instead

```
python3 scripts/real-tv.py --ip <TV_IP> install android/app/build/outputs/apk/github/release/app-github-release.apk
python3 scripts/real-tv.py --ip <TV_IP> check        # home app must be unchanged
python3 scripts/real-tv.py --ip <TV_IP> open         # Couch TV setup screen
python3 scripts/real-tv.py --ip <TV_IP> shot test-output/real-1-setup.png
```
The installer refuses any APK that is not `dev.couchtv.ontv`. It copies the APK as base64 through
plain shell commands in 32 KB chunks (each chunk retried on a fresh connection), checks the md5,
then runs `pm install`: about 45 s for the 22 MB APK. adb_shell's own file push stalled on an
Android 14 Google TV (TcpTimeoutException in `_filesync_flush`) and left the connection unusable,
so push is only tried with `--push`.

## 3. Pair a "phone" (this computer)

```
python3 scripts/real-tv.py --ip <TV_IP> code                       # reads the code off the TV screen
node scripts/real-tv-check.mjs pair --base http://<TV_IP>:5400 --code <code>
```
If `fetch` cannot reach the TV from this computer (macOS Local Network), do this step from a phone
browser instead and skip to step 4 by hand, or grant Local Network to the terminal.

## 4. Let the app connect to the TV's own ADB

**Android 13 and newer (most Google TVs): use wireless debugging pairing (4a).** On one Android 14
Google TV the app's plain 5555 connection reached the point where adbd should ask "Allow USB
debugging?" and the TV never asked (no dialog, nothing in the framework log). Pairing worked first
time. Use 4b only on older TVs.

### 4a. Wireless debugging pairing

Check focus before every OK (`real-tv.py focus`). In the Developer options list, **"Revoke USB
debugging authorizations" sits directly above "Wireless debugging". Never press OK on it**: it
signs out every computer that uses ADB on the TV, including a computer bridge.

1. `real-tv.py --ip <TV_IP> wireless-on` (sets `adb_wifi_enabled` to 1). If the TV shows
   "Allow wireless debugging on this network?": `focus` until "Always allow on this network",
   `keys DPAD_CENTER`, then `focus` until "Allow", `keys DPAD_CENTER`. Read the setting again: if
   it went back to 0, the TV is on Ethernet and this route cannot work.
2. Open Developer options: `real-tv.py --ip <TV_IP> devopts`.
   `keys DPAD_DOWN` one at a time, `focus` after each, until focus is "Wireless debugging"
   (one step past "Revoke USB debugging authorizations"), then `keys DPAD_CENTER`.
3. `focus` until "Pair device with pairing code", `keys DPAD_CENTER`.
4. `shot test-output/real-pair.png` and read the 6 digit code and the IP:port. Leave that screen
   open (do not open Couch TV). The screenshot may show the Wi-Fi name: it stays in test-output/,
   which is git-ignored.
5. Pair:
```
curl -s -X POST http://<TV_IP>:5400/api/adb/pair -H "authorization: Bearer $(cat test-output/real-tv-token)" -H 'content-type: application/json' -d '{"code":"<6 digits>","port":<pairing port>}'
```
6. Expect `"connected":true,"route":"tls"`, and in logcat (tag `couchtv.adb`): "wireless debugging
   on port N", "library connect returned true", "connected over tls".

### 4b. Port 5555 (older Android TV, Fire TV, Shield)

On the setup screen, focus starts on **Connect ADB**: `keys DPAD_CENTER`, then expect "Allow USB
debugging?" for key "couch-tv" (`shot test-output/real-2-allow.png`). Accept it with the remote
keys, checking focus between presses (emulator order: up to the tick box, OK, down, left to Allow,
OK). Never press OK while focus is on Cancel or on anything you did not expect. On Android 13+ the
app waits 45 s, then suggests pairing; older TVs get 2 minutes.

If nothing appears, `POST /api/adb/diag {"wait":90}` and `GET /api/adb/diag` show every packet:
reaching "sent AUTH type=3" with no dialog means the TV is holding back the question; use 4a.

## 5. Run the checks

```
node scripts/real-tv-check.mjs run --base http://<TV_IP>:5400
```
Results land in `test-output/real-tv-results.json`. Record each line as pass or fail.

## 6. Restart question (optional, at most twice)

Only if the owner wants the answer to "does port 5555 survive a restart on this TV":
```
python3 scripts/real-tv.py --ip <TV_IP> reboot      # or the TV's own menu: Settings, System, Restart
```
After it comes back (allow 2 minutes): sound off again (step 0), then `real-tv.py check` (5555 still set?), then
`real-tv-check.mjs run` (did the app start by itself and reconnect?). Confirm the original home
screen is still the home app.

## 6a. Checks still to do on a real TV (0.13.10)

Only on the Samsung or the TCL, sound off first (step 0). None of these has been done yet.

1. **Which sport apps fill Android's Continue watching.** Up next's "Your last game" (and "Last game when
   Scores is on") picks up the last game watched in Kayo, Foxtel, 9Now, 7plus, 10 or DAZN, read from Android's
   Continue watching on the home app alone. Whether each of those apps writes to it has never been checked.
   For each app that is installed: play a game (or any live or replay sport) for a minute, press Home, then
   read the rows with `TV_IP=<TV_IP> .venv/bin/python tv-home/tools/tvadb.py shell "content query --uri
   content://android.media.tv/watch_next_program --projection package_name:title:last_engagement_time_utc_millis"`
   (or look at Up next with "Your last game" picked). Write down per app: listed or not, and the title it gives.
   An app that never shows there cannot fill Up next's game on a TV without a home computer; say so in Up next's
   help if most of them are missing.
2. **The first open, timed.** Open the home from cold (after `am force-stop dev.couchtv.ontv`), twice, and read
   `performance.getEntriesByName("app-start")` and `"home-painted-from-cache"` (chrome://inspect on the
   computer, if the TV's WebView allows debugging). 0.13.10 lets the second open reuse the page's files (a 304
   from the app's server); the first open after an install still fetches and compiles about 3.3 MB of scripts.
3. **A video background on a 1 GB TV** (the TCL, 939 MB): the Aquarium design plays (about 27 fps before), the
   home stays alive after opening YouTube and coming back, and Designs, Your design says it plays a smaller copy.

## 7. Finish

```
python3 scripts/real-tv.py --ip <TV_IP> check        # home app unchanged, Couch TV installed
curl -s -X POST localhost:5400/api/power -H 'content-type: application/json' -d '{"state":"off"}'
```
Leave Couch TV installed and **not** home.

## Uninstall later

```
python3 scripts/real-tv.py --ip <TV_IP> uninstall
```
(`pm uninstall dev.couchtv.ontv`; touches nothing else.) Its debugging key stays in the TV's list
of allowed computers until someone revokes debugging keys in Developer options, which also signs out
every other computer, so leave that unless asked.
