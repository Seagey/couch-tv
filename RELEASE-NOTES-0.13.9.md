## couch-tv 0.13.9: one button updates, Home settings on your phone, and designs sent from the phone

Fewer presses with the TV remote. The on-TV app now updates itself with one button, Home settings can be changed from a phone or a computer, a phone pairs in one scan, and a couch-tv Studio design can be sent from the phone instead of typed on the TV. A classic home looks exactly as it did in 0.13.8.

### Do this after updating

- **Option C (the on-TV app):** this one update still goes the old way, because the one button arrives with it. On the TV: Home settings, About, Update couch-tv, and follow the steps (in Downloader, type 8180170, press Go, then Install). Or install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one from a computer. Your settings stay. From 0.13.9 on, the next update is one button.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. All four APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge.
- **Apple TV:** build Couch TV again with Xcode ([docs/APPLE-TV.md](docs/APPLE-TV.md)).

### What each TV gets

- **The on-TV app (option C, Android TV and Google TV):** Update to with one button, Home settings from your phone or a computer, pairing in one scan, Send a design from the phone remote, Get a design from your phone, and the clearer line when the TV never asks "Allow debugging?".
- **The couch-tv home app with a computer at home (option B):** Send a design from the phone remote, and Get a design from your phone.
- **The couch-tv home app on its own (option A):** Get a design from your phone.
- **Samsung and LG:** Get a design from your phone, and Send a design from the phone remote. On a Samsung, Home settings, About also shows a QR code that opens the update steps on your phone.
- **Apple TV:** Get a design from your phone, in Couch TV's settings. Send a design is not offered on an Apple TV or a Roku: the phone remote says to type the code on the TV instead.

### Update to, with one button (on-TV app)

When a new version is out and the app can install it itself, Home settings, Updates shows one button: Update to, with the new version number. Press OK: it downloads the update from GitHub, checks it (the size and fingerprint GitHub lists, the same app and the same signing key), installs it, and opens couch-tv again. Your settings stay. The phone's setup page has the same button, under Couch TV version.

It needs the app's own link to the TV, the one you switch on once with Let the phone press keys on the app's setup screen. Without that link, or if a try fails (for example the TV is short of space), the page says why in one line, then shows the steps, with a QR code under them that opens the same steps on your phone, so you can follow them there.

The update button was tried on a real TCL, from 0.13.7 to 0.13.8.

### No crash after an update reopens couch-tv

On a real TCL, 0.13.8 crashed about ten seconds after an update opened couch-tv again: two starts of its background service landed at the same moment and Android stopped the app. Each start is now answered, so couch-tv stays open.

### Home settings on your phone or a computer (on-TV app)

Home settings on the TV shows a Change this on your phone QR code. Scan it and the phone opens the TV's own settings page, already paired. Under it is the address and a code to type for a computer. The app's setup screen also shows the address, as Home settings on your phone.

From there you can set the town for the weather (search by name, as on the TV), the people and their order, kids mode, your own photos (sent from the phone straight to the TV), At home (the family note, lists, guest Wi-Fi, the house guide and calendar links), and the Ask AI key. Everything stays changeable on the TV too, and a change made on the phone while the TV's Home settings is open is kept.

### Pair the phone in one scan (on-TV app)

The QR code on the app's setup screen now carries the pairing code, so scanning it pairs the phone with no typing. The code never goes into a web address the TV keeps: the phone takes it out at once. Typing the 6 digit code still works.

### Send a design from the phone

In the phone remote, the TV menu has Send a design: paste or type a code from couch-tv Studio and press Send. There is also a link to couch-tv Studio, and a design you pick there comes back to the phone and is sent to the TV. A code that arrives by a link someone else made is never sent without a tap: the phone asks Send this design to the TV? first.

The TV always asks Use this design? before it changes anything. Pick Use this design there, then press OK. If the couch-tv home is not open on the TV, the phone says so: open the home in the next 10 minutes and the design is there.

### Get a design from your phone

For TVs where typing a code with the remote is slow, such as Samsung, LG and Apple TV: Home settings, couch-tv Studio, Get a design from your phone (on an Apple TV: Couch TV's Settings, Home design). The TV shows a QR code. Scan it, choose a design in couch-tv Studio and press Send to my TV. The TV asks before it changes anything. The code works once, for 10 minutes, while that screen is open.

### When the TV never asks "Allow debugging?"

On a real TCL the TV kept an earlier question it thought was still open and never showed a new one, so the app waited for nothing. When the whole wait passes with no answer, the setup screen and the phone page now say: "No answer from the TV. If it did not show its Allow debugging question, restart the TV, then try again."

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
