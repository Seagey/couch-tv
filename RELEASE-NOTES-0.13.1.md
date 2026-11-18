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

### Fixed

- **The Guest Wi-Fi join code was blank.** In a design, a style meant for the small line icons drew a white outline round every square of the QR code, so the widget showed a white square no phone could read. It draws properly again, and a test now photographs the code as the TV shows it and reads it back.

### Docs

- A couch-tv Studio section in the README, a table of the Android permissions each app asks for, and couch-tv Studio's old name replaced in the code's comments too.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C) and `couch-tv-sync.apk` (two TVs in sync, experimental, unchanged since 0.13), with `SHA256SUMS.txt`.
