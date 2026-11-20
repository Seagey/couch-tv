## couch-tv 0.13.9: one button updates, Home settings on your phone, settings for each widget, and plain words

Fewer presses with the TV remote. The on-TV app now updates itself with one button, Home settings can be changed from a phone or a computer, a phone pairs in one scan, and a couch-tv Studio design can be sent from the phone instead of typed on the TV. Each widget on a design now has its own settings, Home settings only shows what your design uses, and the words in settings and setup are plain English. The standard home (no design) looks exactly as it did in 0.13.8.

### Do this after updating

- **Option C (the on-TV app):** this one update still goes the old way, because the one button arrives with it. On the TV: Home settings, About, Update couch-tv, and follow the steps (in Downloader, type 8180170, press Go, then Install). Or install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one from a computer. Your settings stay. From 0.13.9 on, the next update is one button.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. All four APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (step 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull` and restart the bridge.
- **Apple TV:** build Couch TV again with Xcode ([docs/APPLE-TV.md](docs/APPLE-TV.md)).
- **Roku:** build the channel and put it on again the way you did before ([docs/ROKU.md](docs/ROKU.md)).

### What each TV gets

- **The on-TV app (option C, Android TV and Google TV):** Update to with one button, Home settings from your phone or a computer (with Widgets on this TV and the design's apps), pairing in one scan, Send a design from the phone remote, Get a design from your phone, settings for each widget (Hold OK, Edit on the TV or Edit on your phone), Home settings that follow your design, the Couch Original design, and the clearer line when the TV never asks "Allow debugging?".
- **The Couch TV home app with a computer at home (option B):** Send a design from the phone remote, Get a design from your phone, settings for each widget (the computer keeps them too), Home settings that follow your design, and the Couch Original design.
- **The Couch TV home app on its own (option A):** Get a design from your phone, settings for each widget, Home settings that follow your design, and the Couch Original design.
- **Samsung, LG and the other TVs a computer at home runs:** Get a design from your phone, Send a design from the phone remote, settings for each widget (kept by the computer at home), Home settings that follow your design, and the Couch Original design. On a Samsung, Home settings, About also shows a QR code that opens the update steps on your phone.
- **Apple TV and Roku:** designs show now, drawn by Couch TV itself, with the widgets it can't draw there left out and named ("Surf: not on this TV"). On an Apple TV, the Couch Original design shows its clock behind the mountains too. Get a design from your phone is in Couch TV's settings on an Apple TV. Send a design is not offered on an Apple TV or a Roku: the phone remote says to type the code on the TV instead.
- **Every TV:** the plain words below.

### Update to, with one button (on-TV app)

When a new version is out and the app can install it itself, Home settings, Updates shows one button: Update to, with the new version number. Press OK: it downloads the update from GitHub, checks it (the size and fingerprint GitHub lists, the same app and the same signing key), installs it, and opens Couch TV again. Your settings stay. The phone's setup page has the same button, under Couch TV version.

It needs the app's own link to the TV, the one you switch on once with Let the phone press keys on the app's setup screen. Without that link, or if a try fails (for example the TV is short of space), the page says why in one line, then shows the steps, with a QR code under them that opens the same steps on your phone, so you can follow them there.

The update button was tried on a real TCL, from 0.13.7 to 0.13.8.

### No crash after an update reopens Couch TV

On a real TCL, 0.13.8 crashed about ten seconds after an update opened Couch TV again: two starts of its background service landed at the same moment and Android stopped the app. Each start is now answered, so Couch TV stays open.

### Home settings on your phone or a computer (on-TV app)

Home settings on the TV shows a Change this on your phone QR code. Scan it and the phone opens the TV's own settings page, already paired. Under it is the address and a code to type for a computer. The app's setup screen also shows the address, as Home settings on your phone.

From there you can set the town for the weather (search by name, as on the TV), the people and their order, kids mode, your own photos (sent from the phone straight to the TV), At home (the family note, lists, guest Wi-Fi, the house guide and calendar links), and the Ask AI key. Everything stays changeable on the TV too, and a change made on the phone while the TV's Home settings is open is kept.

### Pair the phone in one scan (on-TV app)

The QR code on the app's setup screen now carries the pairing code, so scanning it pairs the phone with no typing. The code never goes into a web address the TV keeps: the phone takes it out at once. Typing the 6 digit code still works.

### Send a design from the phone

In the phone remote, the TV menu has Send a design: paste or type a code from couch-tv Studio and press Send. There is also a link to couch-tv Studio, and a design you pick there comes back to the phone and is sent to the TV. A code that arrives by a link someone else made is never sent without a tap: the phone asks Send this design to the TV? first.

The TV always asks Use this design? before it changes anything. Pick Use this design there, then press OK. If the Couch TV home is not open on the TV, the phone says so: open the home in the next 10 minutes and the design is there.

### Get a design from your phone

For TVs where typing a code with the remote is slow, such as Samsung, LG and Apple TV: Home settings, Designs, Get a design from your phone (on an Apple TV: Couch TV's Settings, Home design). The TV shows a QR code. Scan it, choose a design in couch-tv Studio and press Send to my TV. The TV asks before it changes anything. The code works once, for 10 minutes, while that screen is open.

### When the TV never asks "Allow debugging?"

On a real TCL the TV kept an earlier question it thought was still open and never showed a new one, so the app waited for nothing. When the whole wait passes with no answer, the setup screen and the phone page now say: "No answer from the TV. If it did not show its Allow debugging question, restart the TV, then try again."

### Settings for each widget

Each widget on a design now has its own settings, so two weather widgets can show two towns and two Commute widgets two drives. There are three ways in, and all three change the same settings:

- **Hold OK on any widget:** pick Edit on the TV to open its settings there. On the on-TV app, Edit on your phone shows a QR code: scan it and your phone opens that widget's settings, already paired (a computer can type the address and code under it). A widget with nothing to set on the TV says so, and a widget that only shows something but has settings, like a Countdown, can now be reached with the remote.
- **In Home settings on the TV:** Designs, Widgets on this home. Each widget is named by what it is and where it sits, like "Surf, middle left".
- **On your phone:** Home settings on your phone, Widgets on this TV (on-TV app).

What you choose is kept in the TV's Home settings, never in a design, so getting a new design or sharing this home never carries your town, your calendar or your drive. On a TV with a computer at home, the computer now keeps the widget settings and the Inputs tile switch with the rest of its copy of Home settings, so they are not lost.

What you can set now:

- **Temperatures in °F:** every widget shows the unit the home uses (Home settings, Weather), not only the main weather.
- **News:** the source, with Best for your country picking ABC News in Australia, BBC World in the UK and RNZ in New Zealand, and how many headlines show.
- **Scores:** the competition (AFL, NRL, A-League, Premier League, NBA, Big Bash or cricket) and your team.
- **Markets:** your own watchlist of up to six shares and prices, like BHP.AX, and whether the price shows or only the move.
- **Commute:** each Commute widget has its own Where to and Leave from. They are kept in this TV's Home settings, never in a design.
- **Bin night:** the night, and bins that take turns, so the widget shows this week's bins.
- **Countdown:** a year for a one off day, like a wedding, or every year for a birthday. Count in sleeps, days or weeks.

### Honest widget headings

A widget's heading says what it really shows. The surf widget names the real beach, and a device widget names the device, not the word Device.

### Home settings that follow your design

With a design on, Home settings on the TV and on your phone only show the settings for parts your design uses. One line at the top says so, with a Show all settings button for everything else. On the phone, each section opens and closes, and the apps in each app row or folder on your design are listed so you can change them there, the same as holding OK on an app on the TV.

### The Couch Original design

A new couch-tv Studio template. The clock sits behind the mountains in each scene. The scenes take turns, or you pick one. The apps sit in one long row, and Keep watching is there only if you want it.

### Designs on Apple TV and Roku

An Apple TV and a Roku now show couch-tv Studio designs, drawn by Couch TV itself. A widget it can't draw there is left out and says so by name, like "Surf: not on this TV", so nothing pretends to work.

### The app list scrolls

Add app (the "+" in an app row) and Change app now scroll with the remote, so every app on the TV can be reached.

### Plain words

The words in settings and setup are written for someone who has never set up a TV app:

- The app is called **Couch TV** everywhere on the TV and the phone.
- The Home settings section that was called couch-tv Studio is now **Designs**: Turn on designs, Back to the standard home. The design website is still couch-tv Studio.
- **Let the phone press keys** replaces ADB on the TV, with steps for **Newer TVs** and **Older TVs**. Android's own menu names (Developer options, USB debugging, Wireless debugging, Allow debugging?, Always allow) stay exact so you can find them, with a plain line beside them saying why.
- Widgets say **the Couch TV app on this TV** or **a home computer**, never setup option B or C. The phone remote says the home computer, not the bridge.
- Home Assistant's token is **the access key from Home Assistant**, and the list of things to show no longer shows Home Assistant's ids.
- A calendar link that does not work says where to find the right one (in Google Calendar: Secret address in iCal format).
- Going back to the first settings, kids mode and quiet hours no longer mention config.json.

Every language the home and the phone remote speak has the new words.

Not in this release: putting a photo in a widget from couch-tv Studio. Studio does not offer that option.

### From the community

- **An Inputs tile for a simple home, thanks Gil124** ([#296](https://github.com/Seagey/couch-tv/pull/296)). A switch in Home settings, Keep watching (or `home.input_tile`) puts an Inputs tile first in the dock, so each HDMI port is one press from the apps. It is off unless you turn it on.
- **The Classic and OLED grid keeps the focus on screen, thanks Gil124** ([#294](https://github.com/Seagey/couch-tv/pull/294)). With many apps, the grid now slides up a row at a time.
- **A way to measure a TV, thanks Gil124** ([#293](https://github.com/Seagey/couch-tv/pull/293)). `tv-home/tools/bench-tv.py` measures frames, memory and cold start; [docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the steps.
- **Two TVs in sync: review fixes, thanks FromTheGods** ([#295](https://github.com/Seagey/couch-tv/pull/295)).
- **Bring back an app the home hides:** `home.show_packages`, for example the Google TV app.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C, the Home button version, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
