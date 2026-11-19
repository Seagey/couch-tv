## couch-tv 0.13.1: long video loops for official designs, and a QR fix

A small release on top of 0.13. If you have not turned on couch-tv Studio, your home looks exactly as it did: the classic home was checked pixel for pixel against the main branch.

### Do this after updating

- **Update the TV apps:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release, so they install over 0.13 and keep your settings.
- **Option B:** run `git pull` and restart the bridge.

### New: long video loops for official designs

- An official couch-tv Studio gallery design can now bring a long, seamless looping video (up to 4 minutes, the slow aquarium kind) instead of a 15 second clip.
- Only a TV with 2 GB of memory or more asks for it. A 1 GB TV, Lighter home, power save, data saver and less motion keep the still picture, as before.
- If the long loop does not arrive within 3 minutes, the TV takes the 15 second copy instead.
- Once a video has played, the TV keeps it (one video, the current design's), so the next start plays straight away without downloading it again.

### Also new since 0.13, thanks Gil124

- **Restart app and Quit app** in the hold OK menu on an app (option B, with the bridge connected) ([#280](https://github.com/Seagey/couch-tv/pull/280), closes #214). Their words are in Arabic, Polish, Romanian and Simplified Chinese too, not only English.
- **`home.app_keys`:** a remote button the TV hands to no app (seen on an XGIMI projector) can open an app you choose ([#279](https://github.com/Seagey/couch-tv/pull/279)). `apply.sh` also starts the Home button watch again after it stops the app.
- **`home.render_height`:** draws the home at a lower resolution (for example 720) for a slow TV, and the TV scales it up ([#278](https://github.com/Seagey/couch-tv/pull/278)).
- **XGIMI Elfin Flip Plus** notes in the docs ([#281](https://github.com/Seagey/couch-tv/pull/281)).

### Fixed

- **The Guest Wi-Fi join code was blank.** In a design, a style meant for the small line icons drew a white outline round every square of the QR code, so the widget showed a white square no phone could read. It draws properly again, and a test now photographs the code as the TV shows it and reads it back.
- **The phone remote says "Closed {name}"** in its own words after Quit app, in English, Polish and Simplified Chinese, like its other app messages.

### Docs

- A couch-tv Studio section in the README, a table of the Android permissions each app asks for, and couch-tv Studio's old name replaced in the code's comments too.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C) and `couch-tv-sync.apk` (two TVs in sync, experimental, unchanged since 0.13), with `SHA256SUMS.txt`.
