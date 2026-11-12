# Apple TV: what was checked and the first real test

## What was checked (November 2026)

`tests/test_appletv.py` runs the driver (`bridge/appletv.py`) against `tests/appletv_standin.py`, a small program that
speaks the Companion link the way the public protocol notes describe it. It covers:

- The binary format (OPACK) and the pairing container (TLV8), including long values and garbage input.
- The 3072 bit pairing group being a genuine safe prime.
- Pairing with the right PIN (keys kept in a private file), a wrong PIN (refused, nothing kept), asking to finish
  without starting, an Apple TV that has forgotten the pairing, and a different Apple TV answering on the same address.
- Every remote key sent as press and release, a held key, power as sleep and wake, unknown keys.
- The app list, mapping to couch-tv's app names, opening by bundle id, an app that is not installed, a refused launch
  and bundle ids that could never be valid.
- A dropped connection (it verifies again by itself), the wake hook, the quiet time after a phone command, and no hook
  without Couch TV installed or an `app_id`.

Because the driver and the stand-in were written from the same notes, passing proves they agree with each other,
not with a real Apple TV. **The most likely places for a surprise on a real one:**

- The pairing messages: the field names around the PIN steps, and whether this tvOS wants extra fields.
- The first messages after verify (session set up) and the exact shape of replies.
- OPACK details: the driver understands back references, but how they are numbered is from a description.
- Whether `FetchAttentionState` reports screensaver as a separate state on your tvOS.
- The Companion port, which changes; the app list answering before any app has been launched after a restart.
- The bundle ids in the table (Netflix, YouTube, Disney+, Prime Video, Apple TV, Apple Music, Plex, Spotify). Others
  come from the Apple TV's own list by name.

## Couch TV, the home app (November 2026)

- `tests/test_appletv.py` also covers the bridge side: finding Couch TV on the Apple TV by its bundle id without
  `app_id` (and not a lookalike id), opening it on wake and from Home, `open_on_power_on` off, and the endpoints the
  app uses behind the real middleware with a pairing key (`hello`, `apps` in the phone's order without Couch TV
  itself, `open` by bundle id with bad, missing and refused apps, `code` and `claim` once only, codes that ran out,
  wrong codes rate limited, other TVs refused) and the Bonjour record never carrying the key.
- The app builds with Xcode 27.2 for the tvOS Simulator and for a real Apple TV (unsigned build).
- `tvos/preview/render.sh` ran the app's own SwiftUI code on a Mac against `tests/appletv_home_standin.py` (the real
  bridge with the stand-in Apple TV): it swapped a code for the key, read the people, weather, Keep watching and apps,
  drew the home in each scene, focus on an app, a card, a person and Settings, the Settings screen and All apps, then
  opened Disney+ from the dock and a Keep watching card through the bridge (the stand-in logged both launches).
- **Not yet run in the tvOS Simulator or on a real Apple TV**, so the focus engine (moving with the Siri remote),
  the blur behind the glass panels, Bonjour discovery and the keychain have not been seen working. Those are the
  first things to check.

First real test of Couch TV: follow "Install it free with your own Apple ID" in [APPLE-TV.md](APPLE-TV.md), then
check that the home shows and the clock is right, the remote moves between the people, the cards and the dock, an
app opens from the dock, a Keep watching card opens its app, Settings connects with a code, and that the Apple TV
opens Couch TV after it wakes with the bridge running. Say which tvOS version and model.

## First real test of the remote (about 10 minutes, changes nothing except adding a remote)

1. Update the repo and run `.venv/bin/pip install -r bridge/requirements.txt`.
2. Wake the Apple TV. `.venv/bin/python scripts/appletv-check.py` lists Apple TVs it can see (it only listens).
3. `.venv/bin/python scripts/appletv-check.py <address> --port <port>` says whether the port is open and whether
   this computer is paired. It sends nothing.
4. `... --pair` (the Apple TV shows a PIN) adds this computer to Settings, Remotes and Devices. Remove it there to undo.
5. The same command again with no flag reads awake or asleep and lists the apps. Paste the output (the PIN and keys are never printed) into an issue.
6. Start the bridge with the Apple TV in `config.json` and try arrows, OK, Back, sleep, wake and opening an app from the phone.

If it fails, say which step, the tvOS version and the model.
