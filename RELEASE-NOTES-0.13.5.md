## couch-tv 0.13.5: fixes from a real beginner on a TCL, and from the 0.13.4 review

We put couch-tv 0.13.3 on a real TCL Android TV with just a phone, the way a beginner would, and fixed what got in the way. A few fixes from the review of 0.13.4 are in here too. A classic home looks exactly as it did in 0.13.4.

### Do this after updating

- **Option C (the on-TV app):** install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one. Your settings stay.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. Both APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge.

### Use as home screen (the on-TV app)

These are checked by tests on a computer. They have not been tried on the TCL again yet.

- **The first press asks the TV properly.** On the TCL the first press showed a black screen and no question; the second press worked. Now the app waits a moment for Android to take in the new home before it asks, and asks only while its own screen is in front. If something still covers it, the screen says to press Back once, and the question comes up.
- **Cancel means no.** After Cancel on Android's "Set Couch TV as your default home app?", the button used to change to "Stop being the home screen" anyway. Now Android's answer decides: Cancel leaves the TV's home as it was, the button still says Use as home screen, and the screen says how to ask again.
- **Google's home and the Home button, said plainly.** With the phone only download (`couch-tv-ontv.apk`), Google TV, and some Android TVs with Google's home (the TCL was one), keep opening Google's home when you press Home. That is expected: Google Play Protect blocks the Home button watch in an app installed from a phone. The setup screen now says so, and under More, Home button from a computer, gives the exact steps: download `couch-tv-ontv-watch.apk`, install it over the app from a computer with `adb install -r` (your settings stay; with Wireless debugging, `adb pair` comes first), switch on Couch TV home watch in the TV's Settings, Accessibility, then press Use as home screen on the Couch TV setup screen. The watch only brings couch-tv back while that is on, so with the watch version the button now shows on Google TV too.

### couch-tv Studio on the TV

- **The switch shows its real state at once.** After Turn on couch-tv Studio, the row above still said "Off" and the button still said "Turn on". Now both change the moment you press it, on and off.
- **Design codes are easy to get right with the remote.** The TV's on-screen keyboard dropped a letter from a code typed fast. Now case, spaces and the dash do not matter (`rstfd5eedn` is RSTFD-5EEDN), the box shows the code as you type with how many of the 10 letters are in, and OK shows the code big, a box per letter, on a Check page before anything is sent. A short code says a letter is missing and takes you back with what you typed; a letter that is never in a code (0, 1, I, L, O, U) is named.

### Samsung

- **On from the phone, tapped again, wakes again.** Tapping On a second time within 10 seconds of a TV that did not wake failed at once without trying. Now it sends the wake again.
- **Power is never held.** A long press of power from the MCP tool could switch a Frame fully off. Now a held power is one press, which is Art Mode on a Frame, as [docs/SAMSUNG.md](docs/SAMSUNG.md) says.
- **The installers check the tool every time.** The Apps2Samsung download is kept and checked against its SHA-256 fingerprint on every run, and the tool is unpacked again from it, so a tool changed on the computer later is never used.
- **Windows PowerShell 5.1:** the TV search no longer stops the setup when the tool writes a warning.
- `START HERE.txt` says that Apps2Samsung keeps your signing certificate on the computer, for the next update.

### Also

- **The bookings calendar on the on-TV app** tries each checked internet address in turn, so one that does not answer (an IPv6 address on a TV without IPv6) no longer stops the calendar.
- **The Setup app shows its real version** (0.13.5) in Finder and in the Windows file details, not 0.0.0.
- A made up test token is now built when the test runs, so secret scanners no longer flag the repo.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
