# Two TVs, one show (sync spike)

A spike, not a feature. It answers one question: how close can two Android TVs playing the same
streaming app be put, using only what Android lets an ordinary app and ADB do? Background and the
research are in `SYNC-TWO-TVS.md` (kept next to the repo, not in it).

**Using it? Read [docs/SYNC.md](../docs/SYNC.md).** It has the steps (`sync/install.sh`, then
`sync.py calibrate`, then `sync.py play`), the undo and the honest numbers. This file is the tester's
notes: how it works inside and every measurement.

Aim: within one video frame (about 20 to 40 ms). Perfect zero is not on offer: two TVs are two
separate players on two separate streams. See "What limits the precision".

## What is here

| File | What it is |
| --- | --- |
| `android/` | The helper app `dev.couchtv.sync` (minSdk 25, signed with `~/.android/debug.keystore`). |
| `sync.py` | The Mac side. Measures each TV's clock, reads both positions, lines them up. |
| `testplayer/` | A small video player with a media session, for an emulator only. Never goes on a real TV. |
| `make-test-video.sh` | Makes a 3 minute test video (running counter, a beep each second). Needs ffmpeg. |
| `build.sh` | `sync/build.sh` builds the helper, `sync/build.sh test` builds the test player. |

### How it works

1. **The helper.** `dev.couchtv.sync` is a notification listener. Being an enabled listener is what
   lets an app ask Android for other apps' media sessions (`MediaSessionManager.getActiveSessions`)
   and get a `MediaController` for them. Nothing is read from notifications.
2. **Commands** arrive by ADB broadcast and the answer comes back as JSON in the broadcast result
   (`am broadcast` prints it as `data="..."`):
   `state pkg`, `pause`, `play`, `seek pos_ms`, `speed x` (Android 10 and newer), `sessions`,
   `ping`, `last`. Only the ADB shell can send them (the receiver needs the `DUMP` permission).
3. **Timed commands.** Any of pause, play, seek or speed can carry `at_elapsed_ms`: a moment on the
   TV's own `SystemClock.elapsedRealtime`. The helper sleeps until about 15 ms before, spins until the
   moment, and calls the controller. `last` reports when it really fired.
4. **A clock server.** The helper also answers UDP packets on port 5417 with the TV's
   `elapsedRealtimeNanos`. This matters, see "Measured numbers".
5. **`sync.py`** works out `tv_time = mac_time + offset` for each TV (NTP style: keep the fastest
   round trips), reads each app's `PlaybackState`, moves its position on to one common Mac instant
   using the app's own timestamp and speed, and prints the gap. `sync` then pauses both, seeks both
   to one position, arms `play` on both for the same Mac instant about 1.5 s ahead, and reads the
   gap again.

## Build

Needs JDK 21 and the Android SDK (platform 34), the same as `scripts/build-apk.sh`.

```sh
sync/build.sh                  # sync/build/couch-tv-sync.apk
sync/build.sh test             # sync/build/synctest-player.apk  (emulator only)
```

`sync/build/` is ignored by git. Use the bridge's virtual environment for `sync.py`
(`.venv/bin/python sync/sync.py ...`): it needs the `adb_shell` package from `bridge/requirements.txt`.

## Install and grant (per TV, needs the TV's yes)

`sh sync/install.sh <tv address>` does all three steps below and checks the result (and
`sh sync/install.sh --undo <tv address>` takes it off). By hand, it is this: the repo's pure Python ADB
means a Mac needs no new Local Network permission. `TV_IP` is the TV's address (keep it out of anything
you commit).

```sh
export TV_IP=<tv address>
.venv/bin/python tv-home/tools/tvadb.py install sync/build/couch-tv-sync.apk
.venv/bin/python tv-home/tools/tvadb.py shell "cmd notification allow_listener dev.couchtv.sync/dev.couchtv.sync.Listener"
.venv/bin/python tv-home/tools/tvadb.py shell "am broadcast -a dev.couchtv.sync.CMD -n dev.couchtv.sync/.CmdReceiver --es op ping"
```

The last line should print `data="{"sdk":...}"`. Undo: `tvadb.py shell "pm uninstall dev.couchtv.sync"`
(removing the app removes the listener grant with it).

Android 14 and newer may need the listener allowed once in Settings if `allow_listener` is refused
(`install.sh` checks and prints where). The bedroom (Android 11) accepted the command. Both of our TVs,
the living room being Android 14, now list the helper as an enabled listener; we did not record whether
the Android 14 one took the command or was switched on by hand.

## Commands

For people: `calibrate` (about six plain syncs, saves each TV's play delay to `sync-delays.json` next to
`config.json`, keyed by package and TV id) and `play` (starts both with the saved delays and redoes until
under `--target`, then says "In sync, about N ms apart"). `sync` also reads the saved delays now; an
explicit `--delay label=ms` wins. The sums and the saved file are covered by
`tests/test_sync_calibrate.py`. The commands below are for testers.

`--tv` takes an id or name from `config.json` (set `COUCH_CONFIG` or `--config` if it is not in the
repo root), or `[label=]host[:adbport[:udpport]]`. `--pkg` is the streaming app's package name
(for example `com.netflix.ninja`, `com.google.android.youtube.tv`).

```sh
# Read only. Runs only `cat /proc/uptime` and `dumpsys media_session` on each TV. Safe any time.
.venv/bin/python sync/sync.py dry --tv living-room --tv bedroom --samples 20 --repeat 3 --every 20

# With the helper installed: UDP clock (much tighter), and the helper's state op.
.venv/bin/python sync/sync.py dry --tv living-room --tv bedroom --helper --pkg <package>

# The sync: pause both, seek both to where the first TV is, timed play on both.
.venv/bin/python sync/sync.py sync --tv living-room --tv bedroom --pkg <package>

# How precisely does a timed command fire on this TV? (arms a seek to where it already is, 10 times)
.venv/bin/python sync/sync.py firetest --tv bedroom --pkg <package> --count 10
```

```sh
# Retry mode: after the timed play, read the gap and redo until it is under --target (default 20 ms),
# at most --tries starts in all (default 6, the first start counts). --runs repeats and summarises.
# --delay label=ms starts that TV's play later (a TV that is always ahead). --log appends JSON per run.
.venv/bin/python sync/sync.py sync --retry --tv living-room --tv bedroom --pkg <package> \
    --pos 60000 --runs 10 --delay living-room=60 --log runs.jsonl
# The same with the cheaper correction (pause only the TV that is ahead): --fix trim (worse, see Real TVs)
```

`sync` has options for the target position (`--pos`), the lead time (`--lead`), and `--trim`
(try to close what is left; off by default, see below).

## Test steps for when seagey is at the TVs

Do these in order and stop if anything surprises you. Nothing here needs a key press on a TV except
the one to start the show.

1. On both TVs, open the same app and start the same episode (a show with a clear action, a
   countdown, or a clapperboard moment is easiest to judge by eye). Check the app lets one account play
   it on two screens.
2. Read only look: `dry --tv living-room --tv bedroom --pkg <package>`. It prints each TV's state,
   whether the app advertises seek (`seek=True`) and speed control (`speed_ctl=`), and the gap as the
   apps report it. Note which apps advertise SEEK_TO (Netflix, YouTube and Spotify do on the living
   room TV, none advertises speed control there).
3. Install and grant the helper on both TVs (above), then `dry ... --helper --pkg <package>` once more.
   The clock lines should say `udp helper clock` with an uncertainty near 1 ms.
4. `firetest --tv bedroom --pkg <package>`: shows how late the helper fires against the moment it was
   armed for. It should say well under 1 ms median. (This sends a seek to the playing position, so
   expect a brief hiccup in picture.)
5. `sync --tv living-room --tv bedroom --pkg <package>`. It prints each step. Watch both screens.
6. Judge the real gap. The numbers the script prints are what the apps report, not what is on screen
   (see below). Point a phone camera at both screens in one shot, or better, a phone recording
   audio from a spot where both are audible: put the two recordings into any editor and line up the
   waveforms. A frame at 30 fps is 33 ms, so a camera at 60 fps resolves about 17 ms.
7. Repeat steps 5 and 6 three times and write down each result. Then leave both playing for 10 minutes and
   run `dry ... --helper --pkg <package>` again to see how much they drifted apart.
8. Only if the gap is clearly visible or audible: `sync ... --trim` and judge again.

## What limits the precision

- **What the app reports.** The script can only read the app's `PlaybackState`: position plus the
  moment the app wrote it. Many apps update it only when something changes (play, pause, seek), not
  continuously. The number can be tens of milliseconds off the picture on the screen, in either
  direction. An app that reports a rounded or stale position makes the printed gap wrong by that much.
- **Start latency after play.** A `play` command lands on both TVs at the same moment, but each
  player then takes its own time to resume (decoder wake up, audio start). That difference is the
  gap after sync, and the script cannot see it directly.
- **Seeks.** A seek to a position lands on the nearest keyframe in some apps, which can be seconds
  away, and nearly always costs buffering after it. Syncing by seek is therefore coarse; the plan
  pauses first so both players are idle when the timed play fires.
- **Speed control.** Only apps that advertise `ACTION_SET_PLAYBACK_SPEED` can run at 1.02x to creep
  up on the other TV. On the living room TV, Netflix, YouTube and Spotify advertise seek but not speed,
  so a trim there would have to be a seek, which is not accurate below about 100 ms.
- **Each TV's own delay.** Picture processing (game mode on or off, motion smoothing) and audio
  (HDMI or ARC to a soundbar, Bluetooth) add delays of tens to hundreds of ms that no software on the
  TV can read. Two TVs with different delays will sound and look out by the difference even when the
  players agree perfectly. Only a camera or microphone check shows it. Turning game mode on in both
  usually helps; a settable audio delay on one TV can then close what is left.
- **Two streams.** Each TV pulls its own copy of the video over the internet, so they can stall at
  different times. After a stall the gap changes. Re-run `sync` (or the read only `dry`) to see.
- **The ADB clock reading.** `cat /proc/uptime` is printed to 10 ms and truncated, and the read
  includes a process start on the TV. See the numbers below; the UDP clock does not have these problems.

## Measured numbers

Everything below up to "Real TVs" is from this build, 10 Nov 2026, with nothing played on either real TV. The "Real TVs" section below is from a later run the same day with YouTube and Netflix actually playing (both muted).

**Clock offset on the real TVs, from this Mac over Wi-Fi.**

| | Method | Round trip | Offset repeatability | Offset error |
| --- | --- | --- | --- | --- |
| Bedroom (Android 11), helper installed | UDP clock server | 2.1 ms minimum | 0.1 ms over 22 s | about 1 ms |
| Bedroom (Android 11) | `cat /proc/uptime` over ADB | 34 to 36 ms minimum | 4 ms over 46 s | about 15 to 18 ms too high |
| Living room (Android 14) | `cat /proc/uptime` over ADB | 77 to 81 ms minimum | 4 ms over 46 s | not known, expect about the same bias |

The ADB figure's error is known on the bedroom because the UDP clock gave the true offset on the same
TV in the same minute. The cause is the shell process being started on the TV between the request
arriving and `/proc/uptime` being read. So over ADB alone the clock is good to about 20 ms, too coarse
for a 15 ms target; with the helper's UDP clock it is good to about 1 ms. Installing the helper on both
TVs is what makes the timing target reachable.

**On two emulators (Android 14), same Mac.**

- The UDP clock and the ADB clock agree to 1.5 ms (the ADB figure carries only the +5 ms
  truncation correction here, because there is no Wi-Fi and a fast shell start).
- A timed command fires on the armed moment: median 0.005 ms late, worst 7.9 ms in 40 fires. The
  two emulators fire together to within 0.03 ms in nearly every case (one 7.9 ms outlier).
- From the helper's call to the player's own callback: about 1 ms (worst 8 ms).
- `state`, `pause`, `play`, `seek` and `speed 1.02` all worked on the test player, which advertises
  seek and speed.
- The full `sync` run, 10 runs without trimming, then measured independently by logging each
  player's own position every 50 ms and lining the logs up on the Mac clock: the gap left was between
  about 5 and 17 ms (size of each run's median gap: 5, 5, 6, 6, 9, 9, 9, 13, 13, 17 ms, in either direction).
  The script's own printed gap was within 3 ms every time, which shows the app's position report is
  not the whole truth: it follows the commanded timing, not the player's actual output.
- `--trim` made it worse on the test player. After a speed change or a seek, MediaPlayer's
  published position is not accurate to better than about 60 ms, so the loop "converged" on its own
  readings and left a real gap of 60 ms or more (60 to 125 ms in the runs). That is why `--trim` is off by default. A different player
  (ExoPlayer based apps report position more carefully) might trim well; that is untested.

### Real TVs: YouTube and Netflix, retry mode (10 Nov 2026, evening)

Living room (Android 14) and bedroom (Android 11), both muted, same home Wi-Fi, helper UDP clocks good to
about 1 ms. Gap = what each app reports for its position, moved onto one Mac instant (living room minus
bedroom, so positive means the living room is ahead). **No camera or microphone was used, so these are the
apps' own numbers, not what is on the screens.** Each run is a fresh sync to the same position, then retries
until under 20 ms or 6 starts. YouTube was Big Buck Bunny (aqz-KE-bpKQ) as a guest; Netflix was Ozark
S1E10.

**Finding 1: the gap is mostly a steady bias, not luck.** Without any delay the living room was ahead on
nearly every start: 61 starts over 12 runs, none negative, median 68 ms. YouTube's resume latency is random
per start, but the living room's is consistently about 60 to 70 ms shorter than the bedroom's. So
`--delay living-room=60` (start its play 60 ms later) is the single biggest win. (An earlier test found a fixed
`--delay` did not help; that was a handful of single syncs spread over -192 to +722 ms, too few to see a
bias of this size under the noise.) Whether the bias is the players or the
apps' position reports cannot be told without a camera.

**YouTube, 12 runs each, `--pos 60000`, final gap |ms|, sorted:**

| Mode | Final gaps | Within 20 ms | Starts per run | Time per run |
| --- | --- | --- | --- | --- |
| redo, no delay | 5 9 14 27 32 53 67 70 71 74 100 100 | 3 of 12 | 5.1 mean (gave up at 6 starts in 8 runs) | 26 s median |
| redo, `--delay living-room=60` | 2 5 6 7 8 10 11 11 12 14 14 18 | 12 of 12 | 2.1 mean, 1 to 5 | 9 s median |
| pause-trim, `--delay living-room=60` | 1 2 3 6 8 8 9 12 12 14 14 14 | 12 of 12 | 3.3 mean, 1 to 6 | 11 s median |

The first start with the delay: median 33 ms, 5 of 11 under 20 ms (one start came out +2169 ms from a stall
and is left out). So expect to need one or two corrections.

**Redo against pause-trim, per correction.** Per correction attempt, a full redo (pause, seek, timed play)
landed under 20 ms 7 of 12 times (median 16 ms). A pause-trim (pause only the TV that is ahead at an exact
moment, resume it `gap` ms later) landed under 20 ms 7 of 28 times (median 36 ms). Pause-trim loses: the
paused TV loses the pause length plus its own resume latency, about 90 ms, so it overshoots any gap under
about 90 ms and swings from ahead to behind (for example +42, -47, +41, +29, +8). The per TV bias it learns
stops that only slowly, and a pause cannot be shorter than nothing. A redo has the same random latency but
no systematic overshoot, and with the delay it centres on zero. Verdict: use redo. Pause-trim is kept as
`--fix trim` for gaps over about 150 ms only.

**Netflix.** It obeys the helper: pause, seek and timed play all worked, the seek lands within about a second
and the timed play fires within 0.03 ms. Differences from YouTube: a seek while paused is applied but the
reported position does not change until the next play (so `settle` waits its 10 s timeout and a try costs
about 14 s, not 4 s), and the position updates about every 2 s. The same bias showed (no delay, 2 runs: gaps
+47 to +121 ms, never negative). With `--delay living-room=70`, 8 runs: final gaps 0 4 6 9 14 15 67 165 ms,
6 of 8 under 20 ms, median 11 ms, 2.9 starts per run, 35 s median. The two failures hit all 6 starts, with
gaps jumping between +40 and +165, so Netflix is rougher than YouTube.

**Honest best.** About 10 ms median, 20 ms or better most of the time (12 of 12 on YouTube, 6 of 8 on
Netflix) with `--retry` and a per TV `--delay`, as the apps report it. One hundredth of a second (10 ms) is
reachable on a good run (best runs 0 to 5 ms) but not guaranteed on any one try. Anything under a frame is
below what the apps' own position reports can be trusted for, and the TVs' picture and sound delays are not
in these numbers at all. The delay value is specific to this pair of TVs and apps: measure it, do not copy it.

## Honest expected numbers on the real TVs

These are guesses with reasons, not measurements, until the live test:

- Clocks aligned to about 1 ms (helper on both) or about 20 ms (ADB only, no helper).
- Timed play firing together to within a few ms.
- Gap after play: dominated by each app's resume latency. The emulator figure (5 to 17 ms) is the
  best case: a local file, no network, no buffering, no audio route. Real streaming apps will be
  worse. Plan on 50 to 150 ms and be pleased with less.
- Then whatever the two TVs' picture and audio paths add, which can be as large again.
- Drift over an hour: unknown. Clocks alone would move about 0.1 s per hour; stalls matter more.

If the live test shows a stable gap, the fix is a fixed offset on the timed play for the TV that starts
sooner. That is `--delay`, and `calibrate` now measures and saves it.

## Not done

- No fan out into the bridge API (no `POST /api/play` with two TVs), no phone remote button.
- No continuous re-sync every 10 s. This is a one shot line up.
- No Fire TV test, and no check that Apple TV's app advertises SEEK_TO or accepts it.
- The helper's receiver and UDP port are for a spike. Before shipping: pair the UDP clock with a
  token, and think about how the listener grant survives a TV restart.
