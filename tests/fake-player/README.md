# Fake player (tests only)

A tiny Android app for the Keep watching simulation (`tests/keep-watching-sim.mjs`). It pretends to
be a streaming app on an **emulator**: it opens full screen and publishes a media session ("playing
The Bear, S3 E2") the way Netflix or Prime would, so the on-TV app records it.

- Never shipped. `scripts/build-apk.sh` and the release builds never touch this folder.
- Built under a real app's package name (`com.netflix.ninja` or
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

Opening a link (`VIEW`, as couch-tv does to open a show) logs `fakeplayer opened <link>` and plays
with no title, so couch-tv sees playback start but records nothing from it.
