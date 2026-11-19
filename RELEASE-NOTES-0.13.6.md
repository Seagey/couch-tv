## couch-tv 0.13.6: the TV tells you about updates, and the Settings gear stays clear

We tested couch-tv again on a real TCL Android TV, the way a beginner would, and fixed what the TV got wrong. A classic home looks exactly as it did in 0.13.5.

### Do this after updating

- **Option C (the on-TV app):** install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one. Your settings stay. From this version on, the TV tells you when the next one is out.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. Both APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge.

### Update couch-tv, on the TV

A TCL owner on 0.13.3 was never told that a newer version existed. Now **Home settings, About** has an **Update couch-tv** row with a version line ("Version 0.13.7 is out (this TV has 0.13.6)", or that this is the latest).

- **The on-TV app** looks on GitHub once a week if you said yes when the home asked, or straight away with Check for updates now. It cannot install the update itself: Android's installer needs a permission that the phone only app leaves out on purpose, so Google Play Protect has nothing new to stop. So OK on Update couch-tv opens the exact steps on the TV: open Downloader, type 8180170, press Install (with the full address as a fallback). The watch version gives the computer steps instead.
- **The TV home app** shows the same row, and OK opens its Updates page, which installs through Android's own installer as before.

### The Settings gear

- **It never covers a widget.** On Guest Welcome it sat over the clock, and when focused it grew over the clock entirely; on Packed Bento it covered the Holidays card. Now it goes to a corner or an edge where it covers nothing, wide enough for the word Settings when focused. A design with no clear spot at all (Packed Bento fills the screen) hides it until the remote reaches it: Up or Right at the edge of the screen, as the tip on the home now says.
- Widgets that say where to set something now say "Settings (hold OK)" instead of "Settings (top right)", since the gear can move.

### The remote

- **Hold OK never opens the app.** A long press on Netflix opened Netflix. Android sends a held key as a repeat, and the home used to wait for its own timer; a press that let go quickly after the repeat counted as a short one. Now, on a couch-tv Studio design, the repeat counts as a hold at once: the Home menu opens with Settings first, and the app does not open. Settings is first on an app's menu too. The classic looks keep their own hold: the night look opens the app's menu (Move, Hide).

### The on-TV app's setup screen says what is true

- 0.13.3 said "Couch TV is your home screen" and offered "Stop being the home screen" while Google's home was still the TV's default. The screen and the button now follow what Android reports, read each time the screen refreshes, not a saved switch: if the TV's own home still opens on Home, it says so and the button asks again.
- **Home settings, About** on the on-TV app said "Running: With the computer" and "Settings are kept: On this TV and the computer". There is no computer with the on-TV app: it now says "On its own, no computer" and "On this TV".

### Also

- **Design codes:** a stray `_` or `.` typed with the remote said "That is 10 letters. A code has 10." Now it names the mark and says to type only the letters and numbers.
- **Folder widget:** an app whose icon fails to load shows its name instead of an empty square.
- **Samsung:** when the installer finds no TV, or the TV is not ready, the first thing it says is to switch the TV on with its remote (on The Frame, a short press), and `START HERE.txt` and docs/SAMSUNG.md say how to keep it reachable.
- Screen time on the on-TV app says plainly that it needs couch-tv set up once from a computer.

These are checked by tests on a computer. They have not been tried on the TCL again yet.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
