## couch-tv 0.13.8: Home settings pages open at the top

We tried 0.13.7 on a real TCL Android TV, the way a beginner would, and fixed what it got wrong. A classic home looks exactly as it did in 0.13.7.

### Do this after updating

- **Option C (the on-TV app):** install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one. Your settings stay. See "Updating from 0.13.7" below.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. All four APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge.

### Home settings pages open at the top

On the TCL, the Update couch-tv page opened scrolled to its first button, so the version line and step 1 were off the top and Up could not reach them. Now a page whose first button fits opens at the top, and Up or Down with no row to move to scrolls the hidden lines into view instead of going round to the other end. A redraw while you read leaves the list where you put it.

The home's tip says Up or Right to the edge again on designs where the gear is hidden until reached.

This was checked in a browser. It has not been tried on the TCL again yet.

### Updating from 0.13.7

The fix arrives with the update, so the page you update from is still the 0.13.7 one. With the on-TV app, Home settings, About, Update couch-tv may open with step 1 off the top, and Up will not bring it back. Step 1 is: press Home, then open Downloader from your apps. The rest of the steps are on the page: in Downloader, type 8180170, press Go, then Install. If it says App not installed, the TV is usually short of space: in Downloader, open Files, delete the old couch-tv-ontv files, then type 8180170 again.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
