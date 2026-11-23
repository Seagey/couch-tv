## couch-tv 0.13.4: Samsung with couch-tv Studio and a setup that needs no AI agent, and Studio designs on Apple TV

We put couch-tv on a real 2021 Samsung Frame the way a beginner would, and fixed what got in the way. Most of this release is Samsung. It also brings couch-tv Studio designs to the Apple TV app and three fixes to the on-TV app. The TV home app only changed its version number, and the classic home looks exactly as it did in 0.13.3.

### Do this after updating

- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). A Samsung app never updates itself. Your settings stay.
- **Samsung with a computer at home (the bridge):** `git pull` and restart the bridge, for the Frame changes below.
- **Option C (the on-TV app):** install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one.
- **Apple TV:** build Couch TV again with Xcode ([docs/APPLE-TV.md](docs/APPLE-TV.md)).
- **Every other TV:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release and keep your settings.

### Put couch-tv on a Samsung with no AI agent

- **`couch-tv-samsung-setup.zip`** has everything: the app, a double-click installer for Mac (`Install on Mac.command`) and Windows (`Install on Windows.cmd`), and `START HERE.txt` with every step in plain words. About 30 minutes, free, no paid plan.
- The installer shows your computer's address for Developer mode, finds the TV, says what to fix if Developer mode is not right, and explains each thing the TV or Samsung's sign-in page asks. Your Samsung password goes only to Samsung's own page.
- It uses Apps2Samsung's free command line tool (version 3.3.1, open source under GPL-3.0) to sign and install the app. The installer downloads it and checks it against a fixed SHA-256 fingerprint before it runs.
- When it is done, couch-tv opens on the TV. If it is not on screen, open Couch TV from the TV's row of apps.
- **`couch-tv-samsung.wgt`** is the app on its own, if you already use Apps2Samsung or Tizen Studio.

### couch-tv Studio on Samsung

- The Samsung app now has couch-tv Studio, the same as the Android home: the gear tile, couch-tv Studio, Get a design.
- **Done on Samsung's keyboard sends the code.** Samsung's on-screen keyboard has no Enter, so before, a typed code was never sent.
- **A design no longer cuts off the bridge.** With a design on, the phone remote and the bridge kept working (tested on the Frame).
- **The TV says when a newer couch-tv is out**, at most once a day, and that you run the setup again to get it.

### The Frame

These need the bridge (a computer at home that stays on).

- **couch-tv opens after Art Mode.** Switch the Frame on, or leave Art Mode with a short press of power, and couch-tv opens a few seconds later. Before, a Frame on its way out of Art Mode could look like it was going to sleep, and couch-tv never opened.
- **Off on the phone is Art Mode**, as on the Frame's own remote. The phone never switches a Frame fully off. When the Art Mode sleep timer runs out, couch-tv leaves the TV asleep.
- **On from the phone never hangs.** If the TV cannot be woken over the network, the phone says within about 15 seconds to use the TV's remote. The bridge learns the TV's network address from the TV itself, so `"mac"` in `config.json` is no longer needed.

### Apple TV

- **Couch TV draws couch-tv Studio designs.** It builds with Xcode and was checked in the tvOS 27.2 Simulator on an Apple TV 4K. It has not run on a real Apple TV yet, so please tell us how it goes ([docs/APPLE-TV.md](docs/APPLE-TV.md#a-design-from-couch-tv-studio)).
- A widget the Apple TV does not know yet keeps its place as a plain card, and short cards (a smart home pill) fit their words to the box.
- A video background shows its still picture.

### The on-TV app (option C)

- **The phone only APK leaves the accessibility settings alone.** `couch-tv-ontv.apk` has no Home button watch, but with the secure settings grant it still listed one there. Now only `couch-tv-ontv-watch.apk` does, and the plain APK takes out an entry an earlier one left.
- **The bookings calendar link is read from the address that was checked.** The TV checks that the calendar's address is out on the internet, not in your house, and now connects to exactly that address, so a link cannot switch to an address in the house between the check and the read.
- **Xiaomi:** the PatchWall switch on the setup page says the Home button watch is in `couch-tv-ontv-watch.apk`, installed from a computer.

### Files

`couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (new, for Samsung), `couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, for Fire TV, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
