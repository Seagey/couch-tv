# Two TVs, one show (experimental)

Put the same show on two TVs and have them play within a few hundredths of a second of each other.
Useful when two rooms are watching the same match, or when you walk from one room to the other and
do not want to hear an echo.

**This is experimental.** It has run on two TVs in one house, with YouTube and Netflix. Everything
below says what was measured and what was not. If it works (or does not) on yours, please open an
issue and say which TV, which Android version and which app.

This page is for people and for the AI agent helping them. The agent's rules are in the last section.

## What it does

Two small things work together:

1. **A helper app on each TV** (`couch-tv-sync.apk`, package `dev.couchtv.sync`). It can see which
   app is playing, read where it is up to, and pause, jump or play it at an exact moment.
2. **A script on your computer** (`sync/sync.py`). It lines up the two TVs' clocks, then tells both
   to pause, jump to the same place, and press play at the same instant. It reads the two places
   back, and if they are further apart than 20 milliseconds it does it again.

Nothing is recorded or sent anywhere. Everything stays on your home network.

## Honest numbers

Our test: a living room Google TV (Android 14) and a bedroom Android TV (Android 11), both on home
Wi-Fi, controlled from a Mac. Both muted.

- **The timing is not the problem.** The helper fires a timed command within 0.03 ms on both TVs, and
  the two clocks agree to about 1 ms.
- **The TVs are.** After "play", each TV's player takes its own time to start, and that time is
  steady for each TV. In our house the living room started about 40 to 70 ms sooner than the bedroom,
  depending on the day. `calibrate` measures that and `play` holds the faster TV back by that much.
- **YouTube:** with the delay and up to six tries, 12 runs out of 12 ended under 20 ms apart (middle
  value 11 ms). Most runs needed one or two starts.
- **Netflix:** 6 runs out of 8 ended under 20 ms (middle value 11 ms). Netflix is rougher. In the two
  misses the gap jumped between 40 and 165 ms for all six tries.
- **The new `calibrate` and `play` commands, one run on YouTube:** calibrate found the living room
  about 40 ms ahead (readings from 3 to 95 ms). Four `play` runs then ended 7, 2, 15 and 13 ms apart.
  One of them needed a second start after a stall.

**These numbers are what the two apps report for their own position. We did not film the screens or
record the sound.** An app can be a few tens of milliseconds out from what is really on screen. The TVs'
own picture and sound delays (picture processing, a soundbar, Bluetooth speakers) are not in any of
these numbers, and software cannot read them. If one TV is on a soundbar and the other is not, you will
hear a gap that this tool cannot see. A TV's game mode helps, and some TVs have an audio delay setting.

Do not copy our delay numbers. They belong to our two TVs. Measure yours with `calibrate`.

## What works

- **Android TV and Google TV** (Android 7.1 or newer). Tested on two.
- **Fire TV sticks:** they are Android underneath, so in principle yes. Not tested. Amazon blocks some
  things on newer Fire OS, so the permission step may fail. Please report.
- **YouTube and Netflix:** tested. Both let another app move their place in the show.
- **Apple TV app, Disney+, Stan, Prime Video and anything else:** untested. An app can only be synced
  if it shows up as a media session that accepts seeking. `sync.py dry` tells you (it prints `seek=True`
  or `seek=False`). If `seek=False`, it cannot be done with that app.

## What does not work

- **Samsung, LG and Hisense VIDAA TVs.** They do not let another app read or move the place in a
  streaming app, so there is nothing for this to hold on to. A Google TV box or a Fire TV stick plugged
  into that TV's HDMI port fixes that: the box plays the show and the TV is just a screen.
- **Roku and Apple TV boxes:** same reason.
- **Two different apps.** Both TVs need the same app on the same show.
- **A phone button, or pause and resume together.** Not built. This only does the "start together" part.
- **Staying in sync for a whole film.** It lines them up once. We have not measured how far they drift
  over an hour, and a stall on one TV puts them out. Run `play` again to line them up. That jumps both
  TVs back to one place, so you lose a few seconds.

## What you need

- A computer on the same Wi-Fi, set up as in the [README](../README.md) steps 1 and 2 (the Python
  folder `.venv` with the packages in `bridge/requirements.txt`). It has to be on and awake whenever you
  press play. Once the show is playing it can go to sleep. This needs no couch-tv home screen and no
  bridge: the two TVs only need to be ready for ADB.
- **ADB debugging switched on, and this computer allowed, on each TV** (README, step 1). The TV asks
  "Allow USB debugging?" once.
- The same app on both TVs, signed in, with the same show open.

## Steps

Each TV is changed in step 1. Nothing else on the TV is touched. You can undo it (below).

**1. Put the helper on each TV.** Download `couch-tv-sync.apk` into `dist/`:
`curl -fL -o dist/couch-tv-sync.apk https://github.com/Seagey/couch-tv/releases/latest/download/couch-tv-sync.apk`
(or build it yourself with `sync/build.sh`). Then, for each TV:

```sh
sh sync/install.sh <tv address>
```

It installs the helper, switches on its one permission (notification access, so Android lets it see
the playing app; it reads no notifications) and checks it answers. If Android refuses the permission
(newer Google TV does this sometimes), the script prints where to switch it on by hand on the TV:
Settings, Privacy, Special app access (on some TVs Settings, Apps, Special app access), Notification
access, then "couch-tv sync". Run the script again afterwards to check.

**2. Find the app's package name.** Open the show on one TV and press play. Then:

```sh
.venv/bin/python sync/sync.py dry --tv <name>=<tv address>
```

It only reads. It lists every app with a media session on that TV. Two we have used:
`com.google.android.youtube.tv` (YouTube) and `com.netflix.ninja` (Netflix).

A `--tv` is either an `id` from your `config.json` (if you set up option B) or `<name>=<tv address>`,
where the name is whatever you like (`lounge`, `bedroom`). Use the same names every time: the saved
delays are filed under them.

**3. Calibrate once for each app.** Open the same show on both TVs and press play on each. Then:

```sh
.venv/bin/python sync/sync.py calibrate --tv lounge=<address> --tv bedroom=<address> --pkg <package>
```

It does about six plain starts (a minute or two). Both TVs pause, jump to one place and play, again
and again. It reads how far apart they ended up each time, takes the middle value, and saves which TV
needs to start later, and by how many milliseconds, to `sync-delays.json` next to `config.json`. It
prints what it found in plain words. Git ignores that file.

Run it again if you change a TV's picture mode, add a soundbar, or switch to a different app.

**4. Every time you want them together.** Open the same show on both TVs, then:

```sh
.venv/bin/python sync/sync.py play --tv lounge=<address> --tv bedroom=<address> --pkg <package>
```

It reads the saved delays, starts both TVs together, checks, and starts again if they are more than
20 ms apart, up to six tries. It ends with "In sync, about N ms apart", or says in plain words what went
wrong. Both TVs jump to where the first `--tv` is up to (or add `--pos 60000` for one minute in).

## Undo

```sh
sh sync/install.sh --undo <tv address>
```

That takes the helper and its permission off the TV. Delete `sync-delays.json` too if you like. Nothing
else was changed. By hand: `pm uninstall dev.couchtv.sync` over ADB.

## Good to know

- **Ads.** If one TV shows an ad and the other does not, the places differ. Let ads finish first. We did
  not test this.
- **Both TVs may ask a streaming account to play on two screens.** Some plans do not allow it.
- **The helper answers anyone on your Wi-Fi who asks for its clock time** (a small UDP service on port
  5417). It does nothing else for them: commands only come through ADB. A token for it is not built yet.
- **After a TV restarts** the permission should stay. If `play` says the helper is not set up, run
  `sh sync/install.sh <tv address>` again.
- The `sync`, `dry` and `firetest` commands are for testers. How it works inside, and every number, is in
  [sync/README.md](../sync/README.md).

## For the AI agent

Someone has handed you this repo and asked for two TVs in sync.

1. **Be straight about the limits first** (the "What works" and "What does not work" sections). If a
   TV is a Samsung, LG, VIDAA or Roku, say so kindly and offer the Google TV box or Fire stick. Do not
   promise a number. Say what our numbers are and how they were judged.
2. **Read only first.** You may run `sync.py dry --tv ...` and `scripts/check-tv.py <address>` without
   the yes: they change nothing on a TV. Everything else needs the same read back and the same clear yes
   as in [AGENTS.md](../AGENTS.md): installing the helper (`sync/install.sh`) changes each TV, and
   `calibrate` and `play` make the TVs pause, jump and play the show. Tell them that before you run
   them.
3. **Check both TVs are free.** Ask them to open the same show on both. Do not run `calibrate` or
   `play` while someone is watching something else on either TV.
4. Install the helper on each TV, calibrate once per app, then `play`. Read the output back in plain
   words. If `play` says it could not get under 20 ms, say so. Do not call it a success.
5. Show them the undo. If anything fails, stop and say what happened in one plain sentence.
