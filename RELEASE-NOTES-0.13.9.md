## couch-tv 0.13.9: one button updates, Home settings on your phone, settings for every widget, Matter devices, and plain words

Fewer presses with the TV remote. The on-TV app now updates itself with one button, Home settings can be changed from a phone or a computer, a phone pairs in one scan, and a couch-tv Studio design can be sent from the phone instead of typed on the TV. Every widget now has its own settings, Home settings only shows what your design uses, and the words in settings and setup are plain, in every language the home speaks. The smart devices you already have in Google Home, Apple Home, SmartThings or Alexa can join Couch TV by Matter, Home can be made to open Couch TV with one press, Home Assistant signs in with a QR code, and the problems people told us about on social media are fixed. The standard home (no design) looks as it did in 0.13.8, apart from the new switches you turn on yourself.

### Do this after updating

- **Option C (the on-TV app):** this one update still goes the old way, because the one button arrives with it. On the TV: Home settings, About, Update couch-tv, and follow the steps (in Downloader, type 8180170, press Go, then Install). If the steps say press Back in Downloader, press Up instead, again and again, until the Downloader button at the top left turns light, then Right twice to the # button. Or install the new `couch-tv-ontv.apk` (or `couch-tv-ontv-watch.apk`) over the old one from a computer. Your settings stay. Put the Home button version on from a computer before? Downloader gets the plain app, which has no Home button watch: after this update, press Make Home open Couch TV once (it needs Let the phone press keys), or install `couch-tv-ontv-watch.apk` from the computer again. From 0.13.9 on, the next update is one button.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one. All four APKs are signed with the same key as every earlier release.
- **Samsung:** download `couch-tv-samsung-setup.zip` below and run its installer again (steps 2 and 4 in `START HERE.txt`). Your settings stay.
- **Option B (a computer at home):** `git pull`, then install the bridge's one new part (Pillow, for photos sent from the phone). In the couch-tv folder run `.venv/bin/pip install -r bridge/requirements.txt` on a Mac or Linux, or `.venv\Scripts\pip install -r bridge\requirements.txt` on Windows, then restart the bridge. In Docker, build the image again: `docker compose -f examples/docker/compose.yaml up -d --build` ([docs/DOCKER.md](docs/DOCKER.md)).
- **Option B and Matter devices (only if you want them):** the home computer needs Node.js 22.13 or newer. In the couch-tv folder run `scripts/matter-setup.sh` once, then restart the bridge ([docs/MATTER.md](docs/MATTER.md)). On a Mac, Matter needs the Local Network permission: start the bridge once from Terminal and press Allow. If the bridge runs as a background service (launchd), macOS never asks, so switch it on yourself in System Settings, Privacy and Security, Local Network, or adding a device fails and the phone page says so.
- **Apple TV:** build Couch TV again with Xcode ([docs/APPLE-TV.md](docs/APPLE-TV.md)). It needs a Mac with Xcode, and a Mac left on at home: Apple's free signing runs out every 7 days.
- **Roku:** build the channel and put it on again the way you did before ([docs/ROKU.md](docs/ROKU.md)).

### What each TV gets

- **The on-TV app (option C, Android TV and Google TV):** Update to with one button, Home settings from your phone or a computer (with Widgets on this TV and the design's apps), pairing in one scan, Send a design from the phone remote, Get a design from your phone, settings for each widget (Hold OK, Edit on the TV or Edit on your phone), Home settings that follow your design, the Couch Original design, and the clearer line when the TV never asks "Allow debugging?".
- **The Couch TV home app with a computer at home (option B):** Send a design from the phone remote, Get a design from your phone, settings for each widget (the computer keeps them too), Home settings that follow your design, and the Couch Original design.
- **The Couch TV home app on its own (option A):** Get a design from your phone, settings for each widget, Home settings that follow your design, and the Couch Original design.
- **Samsung, LG and the other TVs a computer at home runs:** Get a design from your phone, Send a design from the phone remote, settings for each widget (kept by the computer at home), Home settings that follow your design, and the Couch Original design. On a Samsung, Home settings, About also shows a QR code that opens the update steps on your phone.
- **Apple TV and Roku:** designs show now, drawn by Couch TV itself, with the widgets it can't draw there left out and named ("Surf: not on this TV"). On an Apple TV, the Couch Original design shows its clock behind the mountains too. Get a design from your phone is in Couch TV's settings on an Apple TV. Send a design is not offered on an Apple TV or a Roku: the phone remote says to type the code on the TV instead.
- **Matter devices:** the on-TV app and the Couch TV home app on its own join them themselves; every other TV a computer at home runs, including an Android TV with the Couch TV home app, gets them through the computer. Home Assistant by QR code: the on-TV app, the Couch TV home app, and the computer at home. Make Home open Couch TV: the on-TV app.
- **Every TV:** settings for every widget, the plain words in every language, and the fixes below.

### Update to, with one button (on-TV app)

When a new version is out and the app can install it itself, Home settings, Updates shows one button: Update to, with the new version number. Press OK: it downloads the update from GitHub, checks it (the size and fingerprint GitHub lists, the same app and the same signing key), installs it, and opens Couch TV again. Your settings stay. The phone's setup page has the same button, under Couch TV version.

It needs the app's own link to the TV, the one you switch on once with Let the phone press keys on the app's setup screen. Without that link, or if a try fails (for example the TV is short of space), the page says why in one line, then shows the steps, with a QR code under them that opens the same steps on your phone, so you can follow them there.

The update button was tried on a real TCL, from 0.13.7 to 0.13.8. The update from 0.13.8 to 0.13.9 has not yet been tried on a real TV.

The Home button version (put on from a computer, or by Make Home open Couch TV) keeps its Home button through Update to. Downloader's code gives the plain app, which has no Home button watch, so after an update with Downloader, Home opens Google's home again: press Make Home open Couch TV once more. The update page says so.

### No crash after an update reopens Couch TV

On a real TCL, 0.13.8 crashed about ten seconds after an update opened Couch TV again: two starts of its background service landed at the same moment and Android stopped the app. Each start is now answered, so Couch TV stays open.

### Home settings on your phone or a computer (every TV with a Couch TV home)

Home settings on the TV shows a Change this on your phone QR code. Scan it and the phone opens the TV's own settings page, already paired. Under it is the address and a code to type for a computer. The on-TV app's setup screen also shows the address, as Home settings on your phone.

On the on-TV app the TV serves the page. With a computer at home, the computer serves it for every TV it runs (Samsung, LG, VIDAA, Roku, Apple TV, an Android TV with the Couch TV home app and the rest), and the phone pairs with the code from the TV's QR. The Couch TV home app with no computer serves it itself. On a Roku or an Apple TV the page sets the town and the people; on a VIZIO, which shows its own home, the people.

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
- **On your phone:** Home settings on your phone, Widgets on this TV (the phone remote's More, on the on-TV app and with a computer at home).

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

An Apple TV and a Roku now show couch-tv Studio designs, drawn by Couch TV itself. A widget it can't draw there is left out and says so by name, like "Surf: not on this TV", so nothing pretends to work. On a Roku you type the design's code on the Roku (the star button, Get a design by code). Apple TV: designs have run in Apple's simulator; not yet tried on a real Apple TV.

### The app list scrolls

Add app (the "+" in an app row) and Change app now scroll with the remote, so every app on the TV can be reached.

### Plain words

The words in settings and setup are written for someone who has never set up a TV app:

- The app is called **Couch TV** on the TV's screens and the phone. In Android's own list of apps, the Couch TV home app (options A and B) is still listed as **Home**, with the Couch TV picture.
- The Home settings section that was called couch-tv Studio is now **Designs**: one **Your design** switch (On, or Off to go back to the standard home, and On again brings your last design back), **Delete this design** (shown whenever a design got by code is kept, on or off), Get a design, Get a design from your phone and Open this home in couch-tv Studio, with Smart home and At home under their own heading. A typed code goes straight to the "Use this design?" question (no second Check page when the code is whole), whose preview now sketches the clock, date, Keep watching and dock. Open this home in couch-tv Studio also opens the TV's phone inbox, so Send to my TV on the phone comes straight back. The first arrow press on a design only shows the focus, and Down on the dock no longer opens More apps. The design website is still couch-tv Studio.
- **Let the phone press keys** replaces ADB on the TV, with steps for **Newer TVs** and **Older TVs**. Android's own menu names (Developer options, USB debugging, Wireless debugging, Allow debugging?, Always allow) stay exact so you can find them, with a plain line beside them saying why.
- Widgets say **the Couch TV app on this TV** or **a home computer**, never setup option B or C. The phone remote says the home computer, not the bridge.
- Home Assistant's token is **the access key from Home Assistant**, and the list of things to show no longer shows Home Assistant's ids.
- A calendar link that does not work says where to find the right one (in Google Calendar: Secret address in iCal format).
- Going back to the first settings, kids mode and quiet hours no longer mention config.json.

Every language the home and the phone remote speak has the new words, and so do the phone's Home settings page, the Home Assistant phone page, the widget settings and the lines the widgets draw.

### Settings for every widget

All 68 widgets now have something to set, each tried at every size it comes in: clocks (seconds, the date, 12 or 24 hour, the cities), weather (the town, the high and low, °F), sports (all seven competitions, live scores and your team), news, markets, commute, now playing and the app widgets, smart home devices picked from a list, agenda, notes, guest Wi-Fi, photos and the rest. A widget's settings show only while it is on your design, and with nothing set up a widget shows how to set it up, never made up readings.

### A photo in a widget

In couch-tv Studio, a Photo or Art frame widget can hold a photo of your own (Put a photo in). It travels with the design to the TV. Sharing the home leaves your photos out.

### Matter devices, with no Home Assistant

Lights, plugs, fans, blinds, air conditioners and sensors you already have in Google Home, Apple Home, SmartThings or Alexa can join Couch TV. In your home app, share the device with Matter's "share", and type the 11 digit code it gives on the phone's Home settings page, Matter devices (the Couch TV home app on its own: on the TV, Home settings, Designs, Smart home, Add a Matter device). The page says where each app keeps the code. The device stays in your own home app, which works as before. It then shows in the smart home widgets and the TV's Smart home screen, where you can rename or remove it.

On the on-TV app and the Couch TV home app on its own the TV itself joins the device (Android 7 or newer). On Samsung, LG, Roku, Apple TV and the other TVs a computer at home runs, including an Android TV with the Couch TV home app, the computer does (see Do this after updating). Locks, alarms and garage doors are never shown or switched: if one is shared by mistake, Couch TV leaves it again at once. A Thread device also needs a Thread hub at home (a Nest hub, an Apple TV or HomePod, a SmartThings hub). Tested with virtual Matter devices shared the same way; sharing from the real Google Home and Apple Home apps has not been tried yet.

### Make Home open Couch TV, with one press (on-TV app)

On Google TV and other TVs with Google's home, Home settings, About, the setup screen and the phone page have Make Home open Couch TV. With the app's own link to the TV (Let the phone press keys), one press puts on the Home button version, switches its watch on and makes Couch TV the home. No computer needed. On a Fire TV whose Fire OS blocks the link, the page shows the steps instead. This is new in 0.13.9 and has not yet been tried on a real Google TV; the computer way (the Setup app, or `couch-tv-ontv-watch.apk`) still works. Let the phone press keys needs Wireless debugging, which is on Android 11 or newer; Android 10 or older has none and uses Network debugging (on some TVs, USB debugging).

### Home Assistant signs in with a QR code

Home settings, Designs, Smart home shows a QR code. Scan it, sign in on Home Assistant's own page on your phone and tick what shows on the TV. No access key to copy, no config.json. It works on the Couch TV home app on its own, the on-TV app, and with a computer at home. If Home Assistant asks again later, the TV says Sign in again.

### Can't connect?

When the phone or the setup screen cannot get the TV to press keys, a Can't connect check says the one thing that is wrong (the TV on Ethernet, no Wireless debugging, the debugging question never answered, the port closed after a restart, and more) and the next step for it. Copy a report puts the TV's model, Android version and the last error in one block for a GitHub issue, with no addresses or keys. New Start here pages walk a beginner through Google TV, Android TV and Samsung, and the LG guide says what to do when LG says no.

### Fixes for what people told us

- **Lag on mid range TVs:** Lighter home now checks 4 GB TVs too, measures while the focus moves along a row, and judges slow by the screen's own speed. When it turns itself on, the home says so once and where to change it. The Night look's panels cost less to draw.
- **Mac style dock and Moving tiles** say "Off while Lighter home is on" instead of doing nothing, and OK offers to turn Lighter home off.
- **Show the clock** (Home settings, Look): switch the home clock off.
- **Show seconds** (Home settings, Look): seconds next to the home clock.
- **Sharp pictures on a 4K TV** (Home settings, Look): Auto, Off or Always.
- **Icon style** (Home settings, Look): the home's own tiles in Standard, Line, Solid, Two tone, Colour tile, Glass or Playful icons.
- **Keep watching tiles** that lost their picture show the app's banner, or the title.
- **Keep watching and Play with a computer at home:** Keep watching and Play no longer wait a minute when the computer has lost its link to the TV. The show opens straight away, or the TV says how to fix the link. Once the link is back, the next show plays the usual way.
- **Photos from a web link** that cannot show now say why (not found, not a picture, blocked, too big).
- **Fire TV:** the background comes back after a video link instead of staying black.
- **A video background that shows green** on some TVs is noticed, and the home goes back to the photo, with Try the video again in Look.
- **Air mouse:** moving an air mouse pointer now wakes the home.
- **Quick buttons** you choose are kept after a restart.
- **Samsung smart monitors:** the phone remote has More keys (Return, Exit and the rest).
- **Phone remote:** added Next and Previous scene buttons on the phone remote.
- **Home settings on a slow TV:** Up and Down move the focus in place, with no scroll animation or fade, so presses land on time (#301).
- **Hisense Google TV:** back on Couch TV after a restart or wake, and Home goes straight to Couch TV with no flash of Google's home (#202, #297). After a cold start the home waits for its own page instead of showing an error page.
- **Home button watch on the Couch TV home app:** when the TV stops the app and its Home button watch with it, the watch comes back on by itself within about 15 minutes. A watch you switched off stays off (#314).
- **On-TV app:** holding OK on an app no longer offers Restart app and Quit app, which the on-TV app cannot do (#308).
- **Fire TV on Fire OS 6 (on-TV app):** an app icon Fire OS 6 cannot draw no longer stops the app, and Home comes back to Couch TV more reliably after switching apps (#315).
- **Roku OS 16:** Roku's own home is noticed again, so Couch TV comes back on top of it (#307).
- **More apps:** opening and closing it no longer draws every icon again, and Up from its top row folds it back to the dock first (#303, #304).
- **Designs:** the weather line no longer starts with a stray dot (#317).
- **LG:** a loading screen in place of LG's still splash, LG's store as the App Store tile, app icons through the computer at home, and an app that closes straight to an HDMI input reopens Couch TV when `back_to_couch_inputs` is on (#302, #316).
- **LG Home button Helper:** an optional second app that makes the Magic Remote's Home open Couch TV, with no root. It is off unless you install it and set `home_helper`; tried on one LG so far ([docs/LG.md](docs/LG.md), #316).

### New on the Couch TV home app on its own (option A), thanks alisalehi02 (#299)

Each is off until you turn it on in config.json:

- **Bing Picture of the Day** as the Night background (`home.bing_daily_background`). It keeps the last picture when the TV is offline.
- **A Spotify card** with Open Spotify, and previous, play or pause and next for the Spotify TV app (`home.spotify_player`, after you allow Spotify playback controls in Android's Notification access). It reads no notifications.
- **Football scores** from FotMob (`home.football_scores`), with the competitions to show in Home settings, Football scores.

### From the community

- **An Inputs tile for a simple home, thanks Gil124** ([#296](https://github.com/Seagey/couch-tv/pull/296)). A switch in Home settings, Keep watching (or `home.input_tile`) puts an Inputs tile first in the dock, so each HDMI port is one press from the apps. It is off unless you turn it on.
- **The Classic and OLED grid keeps the focus on screen, thanks Gil124** ([#294](https://github.com/Seagey/couch-tv/pull/294)). With many apps, the grid now slides up a row at a time.
- **A way to measure a TV, thanks Gil124** ([#293](https://github.com/Seagey/couch-tv/pull/293)). `tv-home/tools/bench-tv.py` measures frames, memory and cold start; [docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the steps.
- **Two TVs in sync: review fixes, thanks FromTheGods** ([#295](https://github.com/Seagey/couch-tv/pull/295)).
- **Bring back an app the home hides:** `home.show_packages`, for example the Google TV app.
- **Reminders** (#313): a quick button you can add at the top of the home. Say a reminder into the remote's mic, like "call the plumber tomorrow at 6 pm", check the day and time, and it pops up when it is due. Kept on this TV. The reminder words are in English for now.
- **A greeting under the clock** (#312): in the Night look, a greeting for whoever is watching and a short line under the clock (`home.greeting`, with a gentle or electric style per person in `home.person_styles`). Off unless you turn it on, and only shown when the home is in English.
- **A slow zoom on the built-in scenes** (#311): the scenery drifts slowly past the clock (`home.scene_zoom`). Off unless you turn it on.
- **Your own scene clips** (#310): a clip keeps its place when its scene comes back, can play with Lighter home on (`home.scene_clips_lighter`), and pauses after the home's idle time so the TV's screensaver can still start.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C, the Home button version, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-samsung-setup.zip` and `couch-tv-samsung.wgt` (Samsung), with `SHA256SUMS.txt`. The Setup app zips for Mac (Apple silicon and Intel) and Windows are built on GitHub when the release is published, with their own `SHA256SUMS-setup.txt`.
