## couch-tv 0.13.7: Hold OK on a TCL, the gear by arrow, and Samsung updates

We tried 0.13.6 on a real TCL Android TV, the way a beginner would, and on a real 2021 Samsung Frame, and fixed what they got wrong. A classic home looks exactly as it did in 0.13.6.

### Do this after updating

- **Option C (the on-TV app):** Home settings, About, Update couch-tv shows the steps, or install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one. Your settings stay.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. Both APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge. On a Samsung Frame this brings the new way of opening couch-tv after Art Mode.

### The remote

- **Hold OK never opens the app, on a TCL too.** 0.13.6 counted a held key as a hold only when Android marked it as a repeat. The TCL's WebView did not mark it, so a long press on Netflix still opened Netflix. Now a second key down with no key up between counts as a hold, marked or not. This is the same on a couch-tv Studio design and on the classic home.
- **The Settings gear by arrow.** On Guest Welcome the gear sat on the left, but only Up from the clock on the right reached it. Now the arrow that points at the gear reaches it, on whichever edge it sits, and the arrow back the way you came goes back. A gear hidden until the remote reaches it (Packed Bento) moves exactly as before. The tip on the home now says "the Settings gear at the edge of the screen".
- Widget help says to hold OK and pick Settings first, since the gear can be on any edge.

These were checked in a browser. They have not been tried on the TCL again yet.

### The on-TV app's update steps

On the TCL, Downloader had kept five old copies of the app, the TV ran short of space, and Android said only "App not installed". The steps on the TV now add: "If it says App not installed, the TV is usually short of space. In Downloader, open Files, delete the old couch-tv-ontv files, then type 8180170 again."

### Samsung

- **Home settings, About** said "Version: Web preview" and had no Update couch-tv row, though the 0.13.6 notes promised one. It now shows the real version, and an **Update couch-tv** row with the steps: run the Samsung setup again on the computer. Your settings stay.
- **Check for updates now** works. It says "This is the latest version" only after GitHub answered, never after a failed look.
- **Tell me about new versions** off now switches off both the daily look and the note on the home.
- **Opening couch-tv after Art Mode.** When the Frame came on or left Art Mode, one try at opening couch-tv could fail ("not answering on the network"), and the bridge gave up, leaving Samsung's screen. It now tries up to 3 times, 3 seconds apart, and stops if another app came forward.

Both were checked on a real 2021 Frame.

### Also

- **Design codes:** the line under the code box said "10 of 10 letters" with a stray `_` still in the box. It now says to take the mark out.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
