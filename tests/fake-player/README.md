# Fake player (tests only)

A tiny Android app for the Keep watching simulation (`tests/keep-watching-sim.mjs`). It pretends to
be a streaming app on an **emulator**: it opens full screen and publishes a media session ("playing
The Bear, S3 E2") the way Netflix or Prime would, so the on-TV app records it.

- Never shipped. `scripts/build-apk.sh` and the release builds never touch this folder.
- Built under a real app's package name (`com.netflix.ninja`, `com.spotify.tv.android` or
  `com.amazon.amazonvideo.livingroom`) only so couch-tv treats it as that app. It is signed with a
  throwaway key made in `build/` (git ignores it), never the couch-tv key, so it can never install
  over the real app on a real TV. Install it only on an emulator.
- `build.sh <package>` builds `build/fake-<package>.apk`.

Launch extras (`adb -s emulator-NNNN shell am start -n <package>/dev.couchtv.fakeplayer.Player ...`):

| extra | what it does |
| --- | --- |
| `--es title "Dark"` | the title in the media session (MediaDescription title) |
| `--es subtitle "Secrets"` | the second line (episode name) |
| `--es queue "Man of Steel"` | the session's queue title |
| `--ez nometa true` | no metadata at all, as Netflix on some TVs |
| `--es rotate "A\|B\|C" --ei rotate_s 15` | a new title every 15 s with the position back at 0 (autoplay previews) |
| `--ei pos_s 120` | start at 2 minutes in |
| `--ez stop true` | stop playing and release the session |
| `--es songs "A~Artist\|B~Artist2" --es album "X"` | Now playing (#31): a playlist; the media keys play, pause, step next and previous, each logged as `fakeplayer key ...` |
| `--es wn "The Night Agent" --es wn_ep "Pilot" --ei wn_s 1 --ei wn_e 1` | write this app's one Watch Next row ("Continue watching"), as Netflix and Prime do |
| `--ez wn_only true` | with `wn` or `wn_clear`: only change the Watch Next row, do not play |
| `--ez wn_clear true` | remove this app's Watch Next rows |
| `--ez wn_read true` | log every Watch Next row this app can see (with READ_TV_LISTINGS granted: other apps' rows too; ADB's shell user sees none) |

Opening a link (`VIEW`, as couch-tv does to open a show) logs `fakeplayer opened <link>` and plays
with no title, so couch-tv sees playback start but records nothing from it.
