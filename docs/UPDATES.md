# Updates

Everything that changed in couch-tv, newest first.

The newest release is **0.13.15**. The TV apps come from [the Releases page](https://github.com/Seagey/couch-tv/releases). The bridge, and with option B the home's own screen, run from your copy of this repo, so `git pull` brings their changes.

## November 2026

### 25 November 2026: release 0.13.15, a redesigned Couch TV Setup that links your TV to your account, Tidy up your TV, and Make it yours

0.13.15 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Option C: Home settings, Updates, Update to; it carries the same key as 0.13.14, so a TV on 0.13.14, 0.13.13 or 0.13.12 updates as normal. Other Android TVs: Home settings, Updates, check now.

- **Couch TV Setup, new look and name:** it finds more TVs, shows the TVs set up in the session, and keeps working with a Helper that is older than 0.13.15.
- **Links the TV to your account, after asking whose account it is:** nothing is used until you press Yes, and the TV is called linked only when it said it took the link.
- **Tidy up your TV (optional):** fewer ads, shorter menu animations, a smoothness check, undo, and Stop idle screen adverts that reads back what the TV says and covers Android TV's Backdrop screen.
- **Make it yours:** a new TV opens on a card that fetches your design; Get my new design is the first row of Home settings on a linked TV.

### 24 November 2026: release 0.13.14, Couch TV Helper, apps on your TV in Studio, and a fix for Home settings

0.13.14 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Option C: Home settings, Updates, Update to; it carries the same key as 0.13.13, so a TV on 0.13.13, 0.13.12 or 0.13.11 updates as normal. Other Android TVs: Home settings, Updates. Option B: `git pull` and restart the bridge. Full notes: [RELEASE-NOTES-0.13.14.md](../RELEASE-NOTES-0.13.14.md).

- **Couch TV Helper:** the last screen of Couch TV Setup asks Done, or Add extra features. The helper stays in your menu bar or tray and adds turning the TV on from your phone, Ask AI at home, picks, and the phone remote for a Samsung, LG or Roku TV. Start with this computer is off until you pick it, and Turn off extra features removes it. The link `couchtv://helper/on` opens Setup on that screen.
- **It updates itself, only when you say so:** a new version must carry Couch TV's signature and checksum, and is used only when you press Update ready, restart.
- **It sleeps when it can:** it keeps the computer awake only for a Samsung, LG or Roku TV on power, and Let this computer sleep overrides that. Remove everything from this computer deletes what Setup keeps.
- **Apps on your TV, in Couch TV Studio:** Setup and the Couch TV app send the package names of the apps on a linked TV, at most 300, for Studio to show first. Nothing about what is signed in inside them.
- **Fix:** the settings save in Home settings no longer fails when nothing has been kept yet.

### 24 November 2026: release 0.13.13, your home from your Couch TV account, Setup finds the TV for you, and Glass text

0.13.13 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Option C: Home settings, Updates, Update to; it carries the same key as 0.13.12, so a TV on 0.13.12, 0.13.11 or 0.13.10 updates as normal. Other Android TVs: Home settings, Updates. Option B: `git pull` and restart the bridge. Full notes: [RELEASE-NOTES-0.13.13.md](../RELEASE-NOTES-0.13.13.md).

- **Your home details from your account:** a design sent from your Couch TV account to your own TV can bring the names, colours, kids, town and guest Wi-Fi, marked "From your account" in Home settings, with a row to take them off this TV.
- **Photos on People:** a photo from your account shows in the head icon, Home settings, People, kids mode and the People widget, and stays on the TV.
- **Couch TV Setup finds the TV on your Wi-Fi:** no address to type; Setup lists the TVs it hears by name, says what each needs, installs Couch TV, links the TV to your account and brings your design. New: a Linux download, `couch-tv-Setup-linux.tar.gz`.
- **Your account inbox, one click Send:** a TV Setup linked picks up a design you send from your account when it wakes, when you press Check for new designs now, or once a week, with Undo for 24 hours and Unlink in Home settings, Designs.
- **Glass and Liquid glass text:** two new text colours for widgets, frosted glass words, and clear glass letters with the photo showing through.
- **The kind of TV:** getting a design by code also sends the platform, Android version, screen size and model name, for Couch TV Studio's "Will it play on your TV?". No serial number, no ids.
- **Credits:** the Open-Meteo.com and GeoNames credits from 0.13.12 stay where they were.

### 24 November 2026: release 0.13.12, the TV tells Couch TV Studio it has Couch TV, and a steadier Now playing card

0.13.12 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Option C: Home settings, Updates, Update to; it carries the same key as 0.13.11, so a TV on 0.13.11 or 0.13.10 updates as normal. Other Android TVs: Home settings, Updates. Option B: `git pull` and restart the bridge. Full notes: [RELEASE-NOTES-0.13.12.md](../RELEASE-NOTES-0.13.12.md).

- **The TV tells Couch TV Studio it has Couch TV:** getting a design by code on an Android TV also sends the Couch TV version and the TV's memory, nothing else, for Studio's "Will it play on your TV?".
- **Fixes from a beginner run:** the on-TV app's "Allow USB debugging?" box no longer comes back in a loop and its words match the TV's, the home's Settings menu has Phone remote, and the Hold OK menu on a design is solid and fits the screen.
- **Couch TV Setup on every release:** `scripts/release.sh publish` now checks the Setup zips are on the release.
- **Credits:** the forecast, air quality and surf a widget opens say "Weather data by Open-Meteo.com", and Home settings, Location says "Location data based on GeoNames".
- **Now playing reaches every music app:** since 0.13.11 the wider Night card, the progress bar and scrolling long titles show for every music app, not only Spotify, and App name, Long titles and Card alignment sit under Now playing on every home.
- **Spotify's card:** follows a song change at once, never loads a cover from Spotify, shows its Home settings rows only where it works, shows the adb line only with no computer at home, and takes a skip step of 5, 10, 15 or 30 seconds everywhere.

### 24 November 2026: release 0.13.11, add many apps at once, Jost and Cormorant on the TV, and the on-TV app's own signing key

0.13.11 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). 0.13.11 is signed with a new key. Option C: a TV on 0.13.10 updates as normal with Home settings, Updates, Update to. On Android 9 and newer, a TV on 0.13.9 or older must take 0.13.10 first, or install 0.13.11 once with Downloader (code 8180170); its Update to says the file has another key. Your settings stay. Other Android TVs: Home settings, Updates. Option B: `git pull` and restart the bridge. Full notes: [RELEASE-NOTES-0.13.11.md](../RELEASE-NOTES-0.13.11.md).

- **Add apps:** Hold OK on an app in a folder, the Dock, an app grid or Games, then Add apps: one sheet with every app on the TV, pick as many as you want, Back saves. Also in Home settings, on the widget's page.
- **Fonts from Couch TV Studio:** widgets set in Jost or Cormorant Garamond now draw in those fonts on the TV.
- **Spotify's Now playing card and Night posters:** Home settings, Look, Spotify shows what the Spotify app on the TV is playing, read on the TV with no account; Home settings, Look, Keep watching as posters gives the Night look the Classic look's tiles.
- **The on-TV app's own signing key:** 0.13.11 is signed with a new key, the on-TV app's own release key, on Android 9 and newer. 0.13.10 knows how to accept it; 0.13.9 and older do not.
- **Fixes:** no weather line over a widget design's smart stack, the update question comes back when you press Home, Back on an Android TV closes the Ask AI sheet, and the design code error names Couch TV Studio.

### 23 November 2026: release 0.13.10, a simpler start on a new TV and widgets set up on your phone

0.13.10 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). From setting up a TCL from scratch with Downloader, the way a new person would. Option C: Home settings, Updates, Update to, or Downloader's code 8180170 again; please take this one before 0.13.11, which moves the on-TV app to its own signing key. Other Android TVs: Home settings, Updates. Option B: `git pull` and restart the bridge. Full notes: [RELEASE-NOTES-0.13.10.md](../RELEASE-NOTES-0.13.10.md).

- **Setup in two steps (on-TV app):** Make Couch TV your home, then Open your new home. Everything else is in one Settings screen; the More button is gone.
- **A first-run welcome:** a TV nobody set up asks once: I have a design code, or Use Couch Original.
- **Widgets set up on your phone:** a widget waiting for your town, calendar, photos or another private thing says what it is and shows a code; Hold OK puts the phone first, with No phone? Set it up here under it. The phone page starts with Widgets on your screen.
- **App folders in rows**, a Dock and Games that show "+N" instead of dropping apps, and the remote stopping on every app.
- **Video backgrounds play on 1 GB TVs**, with Show the still picture instead in Home settings, Designs.
- **Voice:** the remote's mic and search button open your TV's own voice assistant from the Couch TV home, and the home app is called Couch TV in the app list, so "Hey Google, open Couch TV" finds it.
- **Countdowns to Easter, Mother's Day and Father's Day**, clocks in another time zone, and more widget settings carried in the design.
- **Fixes:** the town shows as just its own name, the home opens faster after the first time on the on-TV app, the update question waits for the welcome, a hidden Allow box is noticed, Use as home screen on a TV with Google's Android TV Home, the date over the clock, the screensaver after a scene clip, "Tomorrow" in full on the bins tile, and a design sent again from Studio wins.

### 20 November 2026: release 0.13.9, one button updates, Home settings on your phone, settings for each widget, and plain words

0.13.9 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Fewer presses with the TV remote, settings for each widget, and plain words. The standard home (no design) looks as it did, apart from the new switches you turn on yourself (and Lighter home can now turn itself on for a slow TV). Option C: this one update still goes the old way (Home settings, About, Update couch-tv, then Downloader, or install the new on-TV APK over the old one); the next one is one button. If the TV's 0.13.8 steps say press Back in Downloader, press Up instead until the Downloader button at the top left turns light, then Right twice to # and type 8180170. Put the Home button version on from a computer before? Downloader gets the plain app, so after this update Home opens Google TV again: press Make Home open Couch TV once (it needs Let the phone press keys), or install `couch-tv-ontv-watch.apk` from the computer again. Samsung: run the new `couch-tv-samsung-setup.zip` installer again. Option B: `git pull`, then install the bridge's one new part (Pillow, for photos sent from the phone): in the couch-tv folder run `.venv/bin/pip install -r bridge/requirements.txt` on a Mac or Linux, or `.venv\Scripts\pip install -r bridge\requirements.txt` on Windows, then restart the bridge. In Docker, build the image again: `docker compose -f examples/docker/compose.yaml up -d --build` ([DOCKER.md](DOCKER.md)).

- **Update to, with one button (on-TV app):** with the app's own link to the TV (Let the phone press keys, once), Home settings, Updates has one Update to button that downloads, checks and installs the update and opens couch-tv again, settings kept. The phone's setup page has it too. Without the link, or after a failed try, the steps show with a QR code that opens them on your phone. Tried on a real TCL.
- **No crash after an update reopens couch-tv (on-TV app):** on a real TCL, 0.13.8 crashed about ten seconds after an update opened it again. Fixed.
- **Home settings on your phone or a computer (every TV with a Couch TV home):** a Change this on your phone QR code in Home settings, with the address and a code to type for a computer. On the on-TV app the TV serves the page; with a computer at home (option B, Samsung, LG, Roku, Apple TV and the other TVs it runs) the computer serves it; the Couch TV home app with no computer (option A) serves it itself. The town, your photos and At home can be set there; the people too with the on-TV app or a computer, and on the on-TV app also kids mode and the Ask AI key. On a Roku or an Apple TV it is the town and the people, on a VIZIO the people. Everything stays changeable on the TV.
- **Pair the phone in one scan (on-TV app):** the QR on the app's setup screen carries the pairing code. Typing the code still works.
- **Send a design from the phone:** the phone remote's TV menu has Send a design, and a link to couch-tv Studio that sends the design you pick. The TV asks Use this design? first. Not on a Roku or an Apple TV: type the code on the TV there.
- **Get a design from your phone:** Home settings, Designs, Get a design from your phone shows a QR code; choose a design on the phone and press Send to my TV. On the couch-tv home on Android TV, Samsung and LG, and in Couch TV's settings on an Apple TV. On a Roku, type the code.
- **When the TV never asks "Allow debugging?":** after the whole wait, the setup screen and the phone page say "No answer from the TV. If it did not show its Allow debugging question, restart the TV, then try again."
- **Samsung:** Home settings, About shows a QR code under the update steps that opens them on your phone.
- **Settings for each widget:** hold OK on any widget and pick Edit on the TV, or on the on-TV app Edit on your phone (a QR code that opens that widget on your phone, already paired), or Home settings, Designs, Widgets on this home, or on the on-TV app's phone page, Widgets on this TV. Two weather widgets can show two towns, and each Commute widget has its own Where to and Leave from. Kept in the TV's Home settings (and the computer at home, if there is one), never in a design.
- **What you can set:** °F in every widget, news by country (Best for your country picks ABC News, BBC World or RNZ) and how many headlines, the scores competition and your team, a markets watchlist of up to six, bin night with bins that take turns, and a countdown to a one off year or every year.
- **Honest widget headings:** the surf widget names the real beach, and device widgets their own names.
- **Home settings that follow your design:** on the TV and the phone, only the settings your design uses, with Show all settings for the rest. On the phone each section opens and closes, and the design's apps are listed to change there.
- **The Couch Original design:** a new couch-tv Studio template with the clock behind the mountains, the scenes taking turns or one picked, one long app row, and Keep watching only if you want it.
- **Apple TV and Roku show designs:** drawn by Couch TV itself, with a widget it can't draw there left out and named, like "Surf: not on this TV". Apple TV: build Couch TV again (designs have run in Apple's simulator; not yet tried on a real Apple TV; with a free Apple ID the signing runs out every 7 days, so a Mac at home signs it again). Roku: put the channel on again, and type a design's code on the Roku (the star button, Get a design by code).
- **The app list scrolls:** Add app (the "+") and Change app keep the app you are on in view.
- **Plain words:** the app is called Couch TV on screen (the Couch TV home app is still listed as Home in Android's app list); the Home settings section couch-tv Studio is now Designs (one Your design switch, Delete this design); ADB on the TV is now Let the phone press keys, with Newer TVs and Older TVs steps and Android's own menu names kept exact; widgets say the Couch TV app on this TV or a home computer, never option B or C; the phone remote says the home computer, not the bridge; Home Assistant's token is the access key. Every language has the new words.
- **Matter devices, with no Home Assistant:** share a light, plug, fan, blind, air conditioner or sensor from Google Home, Apple Home, SmartThings or Alexa and type its code on the phone page. The on-TV app joins it itself; with a computer at home, run `scripts/matter-setup.sh` once ([MATTER.md](MATTER.md)). On a Mac whose bridge runs as a background service, allow Local Network for it in System Settings, Privacy and Security, Local Network.
- **Make Home open Couch TV (on-TV app):** one press, no computer, once Let the phone press keys is on. New in 0.13.9 and not yet tried on a real Google TV; the computer way still works. After a later update with Downloader (the plain app, with no Home button watch), press it again: Update to keeps the Home button version.
- **Home Assistant by QR code:** Home settings, Designs, Smart home; sign in on your phone.
- **Every widget has settings**, a photo can go in a Photo or Art frame widget from couch-tv Studio, and a Can't connect check with Copy a report is on the setup screen and phone page.
- **Fixes from social media:** Lighter home checks 4 GB TVs, Show the clock, Show seconds, Sharp pictures on a 4K TV, Icon style, Keep watching banners, photo link reasons, the Fire TV black background, green video backgrounds, the air mouse, quick buttons kept, Samsung More keys, Next and Previous scene buttons on the phone remote, and smoother Home settings on a slow TV.
- **Couch TV home app on its own (option A), off until turned on:** Bing Picture of the Day, a Spotify card and FotMob football scores (#299).

### 20 November 2026: Hisense Google TV comes back on couch-tv after a restart (option C, in 0.13.9)

On a Hisense Google TV ("SmartTV 4K", Android 11), Hisense's framework stops every outside app at standby and refuses to start one in the background until the TV wakes. The only exception is a list the TV empties about 25 seconds after each boot. So the TV woke on the Google home, and Home from inside an app showed the Google home for a few seconds first (#202). Checked on one real TV, three restarts in a row. [TROUBLESHOOTING.md](TROUBLESHOOTING.md#hisense-google-tv-the-google-home-after-every-restart-or-wake) explains how it works.

- **Back on couch-tv after a restart or wake:** the on-TV app writes itself back into Hisense's list (`allowed_self_launch_3rd_packages`) whenever it runs, so the name is there at the next boot. When the Home button watch connects and the Google home is already in front, it opens couch-tv.
- **Home goes straight to couch-tv:** on a Hisense the Home button watch catches the remote's Home key, in the on-TV app and the TV home app, with no flash of the Google home. When Hisense left the watch marked as crashed, the app binds it again.
- **No error page at start:** after a cold start the home waits for its own server before it loads, instead of showing Chrome's `ERR_CONNECTION_REFUSED` page for about 10 seconds. This helps every TV.
- **Also:** the TV home app wakes the on-TV app each time it comes forward, for a TV that has both.

### 20 November 2026: release 0.13.8, Home settings pages open at the top

0.13.8 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). One fix from testing 0.13.7 on a real TCL Android TV. Option C: install the new on-TV APK over the old one. Samsung: run the new `couch-tv-samsung-setup.zip` installer again. Option B: `git pull` and restart the bridge.

- **Home settings pages open at the top:** on the TCL, the Update couch-tv page opened scrolled to its first button, so the version line and step 1 were off the top and Up could not reach them. Now a page whose first button fits opens at the top, and Up or Down with no row to move to scrolls the hidden lines into view instead of going round to the other end. A redraw while you read leaves the list where you put it. Checked in a browser, not yet on the TCL again.
- **The tip for a hidden gear:** on designs where the gear is hidden until reached, the home's tip says Up or Right to the edge again.
- **Updating from 0.13.7 with the on-TV app:** the 0.13.7 page you update from still opens scrolled down, so its step 1 may be off the top: press Home, then open Downloader from your apps.

### 20 November 2026: release 0.13.7, Hold OK on a TCL, the gear by arrow, and Samsung updates

0.13.7 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Fixes from testing 0.13.6 on a real TCL Android TV and a real 2021 Samsung Frame. A classic home looks exactly as it did. Option C: install the new on-TV APK over the old one (or follow Home settings, About, Update couch-tv). Samsung: run the new `couch-tv-samsung-setup.zip` installer again. Option B: `git pull` and restart the bridge.

- **Hold OK on a TCL:** the TCL's WebView did not mark the held key as a repeat, so 0.13.6 still opened Netflix on a long press. A second key down with no key up between now counts as a hold, on a couch-tv Studio design and on the classic home. Checked in a browser, not yet on the TCL again.
- **The Settings gear by arrow:** the arrow that points at the gear reaches it, on whichever edge it sits. A gear hidden until reached (Packed Bento) moves as before. The tip says "the Settings gear at the edge of the screen".
- **On-TV app update steps:** if Downloader says App not installed, the TV is usually short of space, and the steps say how to delete the old copies in Downloader's Files.
- **Samsung:** Home settings, About shows the real version (it said "Web preview") and an Update couch-tv row with the steps; Check for updates now works; Tell me about new versions switches the daily look and the note off. When the TV comes on or leaves Art Mode, the bridge tries opening couch-tv up to 3 times. The About row and opening after Art Mode were checked on a real Frame; the Tell me switch by tests.
- **Also:** the line under the design code box says to take out a stray mark.

### 19 November 2026: the Loop look, one place at four times of day (option B, from your copy of the repo)

A fourth look, Loop, next to Night, Classic and OLED, which stay exactly as they are: one video of a place (the design: a jagged peak reflected in a lake, a slow drone push over the water), looping with no seam, graded for dawn, day, dusk and night, under a centred clock and date line, a row of bare thumbnails, a centred dock with no bar, and frosted glass on the two quick buttons (the toast and the rest take the same recipe without the blur). `home.look: "loop"`, or Look in Home settings, which cycles to Loop whether or not the files are there (without them the look shows its scrim over a dark ground). Follow the sun (`sun_sync`) picks the variant from the sun's height at your place, cutting at the loop's wrap; off, it is day all day. A loop made from a photo with `make-loop.sh --matte` puts the clock slightly behind the peak, as the original design did: a cut-out of the first frame (scrim baked in) is drawn over the clock and moved by the push's own formula on the compositor, in step with the video, from `loop.json`, which the bridge passes on as `home.loop.meta` with `home.loop.fg`; every encode is tagged BT.709 so the cut-out's colours match the video's. Option B only: the bridge serves the footage. [LOOP.md](LOOP.md).

- **The footage, made on the bridge computer.** `scripts/make-loop.sh <clip or photo>` runs ffmpeg 7 and writes `tv-home/web/loop/` (git ignores it): per variant a 1280x720 H.264 file at 30 fps, 4 Mbps at most, a 160x90 blurred copy at 10 fps for the glass and two 960x540 posters, plus `loop.json`, seventeen files (twenty-one with `--matte`, a cut-out per variant). A clip's last second dissolves into its first so no frame repeats at the wrap; a photo becomes a slow push in and back out with a little sway, the same frame at both ends, and a photo that is not 16:9 is cut to its centre 16:9 band (the matte with it). Everything is made in a hidden staging folder and moved into place only once every encode has worked, `loop.json` last, so a TV that loads the home during a run never gets half a file, and a run that fails or is stopped leaves the folder as it was. `--seconds` (15 to 60), `--slow` for a 60 fps clip, `--only` for one variant, `--dry-run` to see the commands. Apple's aerials may not be used. `tests/test_make_loop.py`.
- **The bridge.** `home.look` takes `loop`; `home.loop` in `/tv/config.js` (read only) lists the variants whose file is there, whether every one has its blurred copy, a version mark of the files, `meta` and `fg`. It is read afresh from the folder each time the home loads `/tv/config.js`, so a new `make-loop.sh` run needs no restart. When `config.json` sets the look to `loop` and there are no files, the bridge says so once in its log as it starts. The files are served under `/tv/loop/` with byte ranges (the TV's media player seeks with them, and a seek at the wrap must not fetch the whole file again), the usual hour of caching and no compression. `/tv/manifest.json` leaves only the video (`loop/*.mp4`) out, so the launcher never saves 80 MB as its offline copy and still keeps the posters (a sharp and a blurred one per variant), the cut-outs and `loop.json`: with the computer off, the home shows the still of its loop with the clock behind the peak. bridge/API.md, [CONFIG.md](CONFIG.md); `tests/test_loop_serving.py`, `tests/test_loop_config.py`.
- **The other builds leave the footage out.** The TV home app (`scripts/build-apk.sh`) takes only the posters; the on-TV app, the LG app and the Samsung app take nothing from `loop/`; the standalone site takes only the posters and turns the cut-out off (it is public, and the posters are stills of your photo, which the script says when it finishes). So a computer that has run `make-loop.sh` still builds apps of the usual size. `tests/test_loop_serving.py`.
- **The home.** A couch-tv Studio design is not drawn in the Loop look (it shows again in the other looks), and Home settings leaves out the Glass panels and Mac-style dock rows there. The videos pause while Smart Idle's OLED Ambient Clock or a kids mode home covers the home, and start again in step when it comes back; the glass fades with the quick buttons under Hide rows when idle and the Ambient music screen, and the blurred copy pauses when there is no quick button. Down from a card lands on the dock tile under it. A YouTube live stream's card says "YouTube · Live". [TV-HOME.md](TV-HOME.md); `tests/test_loop_look.js`.
- **Measured on a Fire TV Cube (Fire OS 7.7, 2 GB), 18 November,** in the real launcher with the bridge serving a 720p 4 Mbps 30 s test loop, before the photo loop and the cut-out were added: the sharp video alone put the home at 156 MB (80 MB of GPU textures, 21 percent CPU, frames at 10 ms typical and 25 ms at the worst hundredth, none dropped out of 2800), about 100 MB under what today's home peaks at. With the blurred copy playing behind the two 64 px quick buttons: 153 MB, 82 MB of textures, 31 percent CPU, the two videos within 0.16 s of each other, and the blurred copy dropped about three frames in four, which does not show behind a blur (so it is encoded at 10 fps). The same glass at a toast's size cost 18 MB more and 38 percent CPU, so a toast takes the glass recipe without the blur. [LOOP.md](LOOP.md) has the numbers and says what to do if it stutters.

### 19 November 2026: a YouTube video card opens the exact video, with its thumbnail (option B, from your copy of the repo)

Opening a YouTube video card from Keep watching now plays that very video instead of searching for its title, and the card shows the video's own picture. The media session gives the title, the channel and the length, not the video's id, so the line keeps those three (a live stream has no length, so there the channel decides) and the id is found on YouTube's public results page: no key, no sign in, the same lookup the move feature uses, started in the background as soon as the line is written and remembered for six hours, so the card's OK press usually has it at once. The lookup only says yes when the title matches and the channel or the length agrees: a title many channels reuse is told apart by them, and a wrong video is worse than none, so otherwise it says unsure, and an unsure answer is remembered ten minutes so the next press goes straight to the search instead of waiting on the lookup again. A line with neither channel nor length (one an older bridge wrote, or a session that gave neither) is not looked up at all, because a title alone cannot be sure of the video: that card searches. A sure id goes to the installed build as its watch link with no time in it, and YouTube resumes it from the account's own history (tested on the Cube: Amazon's YouTube played that very video, from 420 s in where it was left). Where the lookup is unsure, fails, or takes longer than 15 s, or the watch link does not take, the card searches that build for the title instead: Amazon's YouTube shows its home for the web search link, so on a Fire TV the bridge sends the `youtube://search?query=` link Alexa's voice search uses, which opens its results page (tested on the Cube, cold and already open); the app opens by itself where a link does not take. Once the video is found, its card shows YouTube's own thumbnail for it (`https://i.ytimg.com/vi/<id>/mqdefault.jpg`, which the TV fetches straight from YouTube's image host, as it already fetches JustWatch posters), and the id is kept on disk in `bridge/data/video-ids.json` with the video's length (the newest 500), so a bridge restart or the six hours do not lose it and a press on a card already found never waits on the network; a channel's second video of the same title, at another length, is looked up afresh and kept beside the first rather than given its id. Until then the card shows its title alone, and fetching the row starts the lookup in the background so the next fetch has the picture. A video the lookup stays unsure of is asked about less often each time while its card sits in the row (ten minutes, then twice as long each time, up to once a day), and the bridge fetches YouTube's results page two at a time at most, so a row of new videos never sends a burst of searches from your home. A live stream's card carries `live`, and the Loop look's row says "YouTube · Live" under it. Tested on the Cube: the lookup finds the household's videos in under a second and the watch link plays the exact video. Not yet tested on a real TV: the thumbnail on the screen. Removing a video by hand never removes a show of the same name from Keep watching, or the other way round. Spotify, Twitch and Moonlight are still never logged. bridge/API.md, docs/CONFIG.md; `tests/test_youtube_videos.py`.

### 19 November 2026: release 0.13.6, the TV tells you about updates, and the Settings gear stays clear

0.13.6 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). A second real beginner test on a TCL Android TV, fixed on the TV side. A classic home looks exactly as it did. Option C: install the new on-TV APK over the old one (from now on the TV tells you about the next one). Samsung: run the new `couch-tv-samsung-setup.zip` installer again. Option B: `git pull` and restart the bridge.

- **Update couch-tv:** Home settings, About has an Update couch-tv row with a version line. The on-TV app now looks on GitHub too (weekly if you said yes, or Check for updates now). It cannot install the update itself (that needs a permission the phone only app leaves out, so Play Protect has nothing new to stop), so OK shows the exact Downloader steps and code on the TV.
- **The Settings gear never covers a widget:** it goes where the design leaves room, or, on a design with none, hides until the remote reaches it (Up or Right at the edge of the screen).
- **Hold OK never opens the app on a Studio design:** Android's long press counts as a hold at once, so the Home menu opens with Settings first. The classic looks keep their own hold.
- **The on-TV app says what is true:** the setup screen reads the TV's real home each time instead of a saved switch, and About says "On its own, no computer" on the on-TV app.
- **Also:** a stray `_` or `.` in a design code is named; a Folder widget app with no icon shows its name; the Samsung installer says to switch the TV on first when it finds none.

### 19 November 2026: release 0.13.5, fixes from a real beginner on a TCL

0.13.5 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). We put couch-tv on a real TCL Android TV with just a phone, the way a beginner would, and fixed what got in the way. A classic home looks exactly as it did. Option C: install the new on-TV APK over the old one. Samsung: run the new `couch-tv-samsung-setup.zip` installer again. Option B: `git pull` and restart the bridge.

- **Use as home screen (on-TV app):** the first press waits for Android to take in the new home before asking (the TCL showed a black screen); Cancel on Android's question leaves the button at Use as home screen; and with the phone only download the setup screen says plainly that Google's home keeps the Home button, with the exact steps to put `couch-tv-ontv-watch.apk` on from a computer and then press Use as home screen (under More; with the watch version the button shows on Google TV too). Checked by tests, not yet on the TCL again.
- **couch-tv Studio:** the switch row says On or Off the moment you press it. Design codes ignore case, spaces and the dash, show as ABCDE-FGHJK with a letter count while you type, and a big Check page comes before anything is sent.
- **Samsung:** On tapped again after a TV that did not wake sends the wake again; power is never held (a Frame is never switched fully off from the phone); the installers check the kept Apps2Samsung download every run; the Windows installer no longer stops on a tool warning in PowerShell 5.1; `START HERE.txt` says where the signing certificate is kept.
- **Also:** the on-TV app's bookings calendar tries each checked address in turn, and the Setup app shows its real version.

### 19 November 2026: release 0.13.4, Samsung with couch-tv Studio and a setup that needs no AI agent

0.13.4 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Most of it is Samsung: we put couch-tv on a real 2021 Frame the way a beginner would. It also brings couch-tv Studio designs to the Apple TV app and three fixes to the on-TV app. The TV home app only changed its version number, and the classic home looks exactly as it did. Samsung: download `couch-tv-samsung-setup.zip` and run its installer (a Samsung app never updates itself; your settings stay). Option B: `git pull` and restart the bridge. Option C: install the new on-TV APK over the old one. Apple TV: build Couch TV again with Xcode.

- **Install on a Samsung with no AI agent:** `couch-tv-samsung-setup.zip` has the app, double-click installers for Mac and Windows and `START HERE.txt` with every step in plain words. About 30 minutes, free. The installers use the free Apps2Samsung command line tool (3.3.1, GPL-3.0), checked by its SHA-256 fingerprint before it runs. `couch-tv-samsung.wgt` is the app on its own ([docs/SAMSUNG.md](SAMSUNG.md#the-quick-way-no-ai-agent-no-paid-plan)).
- **couch-tv Studio on Samsung:** the gear tile, couch-tv Studio, Get a design. Done on Samsung's keyboard sends the code, and a design no longer cuts off the bridge.
- **Honest updates:** the Samsung app says on the home, at most once a day, when a newer couch-tv is out and that the setup is run again.
- **The Frame (with the bridge):** couch-tv opens after Art Mode; off on the phone is Art Mode, as on the Frame's own remote, never fully off; on from the phone says within about 15 seconds to use the TV's remote if the TV cannot be woken. The bridge learns the TV's network address itself, so `"mac"` is no longer needed.
- **Apple TV:** Couch TV draws couch-tv Studio designs. It builds with Xcode and was checked in the tvOS 27.2 Simulator on an Apple TV 4K, not yet on a real Apple TV. A widget it does not know keeps its place as a plain card, short cards fit their box, and a video background shows its still ([APPLE-TV.md](APPLE-TV.md#a-design-from-couch-tv-studio)).
- **On-TV app (option C):** `couch-tv-ontv.apk` no longer lists a Home button watch it does not have in the accessibility settings (and takes out one an earlier copy left); the bookings calendar is read from exactly the address that was checked to be on the internet; the Xiaomi PatchWall switch says the watch is in `couch-tv-ontv-watch.apk`.

### 19 November 2026: release 0.13.3, easier for beginners, guests by name with no computer, and your home into couch-tv Studio

0.13.3 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Both TV apps are 0.13.3 and install over 0.13.2. A classic home, with couch-tv Studio off and a town set, looks exactly as it did. Option B: `git pull` and restart the bridge. We set couch-tv up from scratch on two real Google TVs (Android 11) the way a beginner would, and fixed what got in the way:

- **Guests by name with just a phone:** type the guest's name on the TV (At home, Guests) or the phone remote (More, Guest's name); the on-TV app reads the bookings calendar itself; the phone can send the bookings link to the TV. A TV never shows couch-tv Studio's sample guest or house.
- **Aimed at the Google Play Protect block:** the main app, `couch-tv-ontv.apk`, no longer asks for the accessibility permission that Play Protect flags. This is not yet tried on a real TV. If you switched on "Couch TV home watch" in 0.13.2 or earlier (Fire TV, TCL, Haier, other Google TVs, Xiaomi PatchWall), install `couch-tv-ontv-watch.apk` from a computer, or the Home button stops opening couch-tv.
- **Settings you can always find:** a Settings button on every design, Hold OK starts with Settings (also on TVs that send a held OK as quick presses), and the home says the remote's own Settings button opens the TV's menu.
- **Plain words:** the Couch TV screen has a QR code, says when the phone is paired, and keeps the tools under More. The Setup app (now on the release) explains the Mac's Local Network switch and walks an Android 11 Google TV through USB debugging over Wi-Fi, with no dead end.
- **No made up town** for the weather (the classic home says where to pick one), no false "Not on this TV" in the card that asks before a new design is used, readable photo tiles, and the couch-tv logo on both TV apps.
- **Open this home in couch-tv Studio** (it was Share this home) brings a GitHub home onto couch-tv Studio.
- `remove-all.sh` takes `EXTRA_APPS` for a home app of your own from before couch-tv.

### 19 November 2026: release 0.13.2, Ask AI, your own AI agent, guests by name, smart home on every TV, and designs on Roku

0.13.2 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Both TV apps are 0.13.2 and install over 0.13.1. A classic home, with couch-tv Studio off, looks exactly as it did, except on Roku, which gains a Settings tile and a menu on the \* key. Option B: `git pull`, then `.venv/bin/pip install -r bridge/requirements.txt` (AirTouch 5 needs `airtouch5py`), and restart the bridge.

- **Ask AI** ([docs/ASK-AI.md](ASK-AI.md)): a widget and a sheet on the TV, answered by the AI you pick (Claude, OpenAI, Gemini, OpenRouter, Groq, Mistral, any OpenAI compatible service, a model at home, or couch-tv at home). The key stays on the TV.
- **Your own AI agent** ([docs/AI-AGENT.md](AI-AGENT.md)) can put a message on the TV or send it a design, which asks "Use this design?" first.
- **Guests by name:** At home, Guests reads your bookings calendar link with your check in and check out times, and a Welcome widget set to the calendar greets the guest by name. With a computer at home, the name can come from Airbnb's "reservation confirmed" emails ([CONFIG.md, Guests](CONFIG.md#guests-names-and-times-from-a-bookings-calendar)).
- **Smart home set up on the TV:** Home settings, Designs, Smart home, on Google TV and Android TV and, through the computer at home, on Samsung, LG and the other web TVs. **Add a device we don't list** says how to bring Tuya, Nest, Alexa, Apple Home, Matter and brand apps into Home Assistant.
- **Philips Hue and AirTouch 5 with no Home Assistant**, with a computer at home ([CONFIG.md](CONFIG.md#philips-hue-and-airtouch-5-with-no-home-assistant-option-b)): pair the Hue bridge with its button and tick lights; find the AirTouch console and each zone becomes a room (on, off, temperature; the mode stays as set on the wall).
- **couch-tv Studio designs on Roku**, drawn by the channel itself, from `design` in `config.json` or a code typed on the Roku ([ROKU.md](ROKU.md#couch-tv-studio-designs)). Every Roku home gains a Settings tile after the apps and a menu on the \* key (Get a design by code, Go back to the plain home, Show the design). Widgets it cannot draw show as a tidy card with their name.
- **Apple TV source:** Couch TV's source gains a design renderer ([APPLE-TV.md](APPLE-TV.md#a-design-from-couch-tv-studio)). It was compiled and drawn on a Mac and has not been built for tvOS; build Couch TV with Xcode to try it.
- **Batteries** widget for paired Bluetooth remotes, controllers and headphones (Google TV and Android TV), typed custom cards on every TV, named timers, and plainer words for what each TV needs.

### 19 November 2026: release 0.13.1, long video loops for official designs, and the Wi-Fi join code draws again

0.13.1 is on [the Releases page](https://github.com/Seagey/couch-tv/releases). Both TV apps are 0.13.1 and install over 0.13. A classic home, with couch-tv Studio off, looks exactly as it did.

- **Long video loops for official designs.** An official couch-tv Studio gallery design can now bring a long, seamless looping video (up to 4 minutes, the slow aquarium kind) instead of the 15 second clip. Only a TV with 2 GB of memory or more asks for it; a 1 GB TV, Lighter home, power save, data saver and less motion keep the still picture, as before. If the long loop does not arrive within 3 minutes, the TV takes the 15 second copy. Once a video has played, the TV keeps it (one video, the current design's), so the next start plays it without downloading it again. `tests/test_design_video.js`, `tests/test_design_video_browser.mjs`.
- **The Guest Wi-Fi join code draws again.** In a design, a style meant for the small line icons also drew a white outline round every square of the QR code, so the Guest Wi-Fi widget showed a blank white square that no phone could read. The code now draws its squares with no outline. `tests/test_athome_browser.mjs` now photographs the code as the TV draws it and reads it back.
- **Docs:** a couch-tv Studio section in the README, a table of the Android permissions each app asks for, and couch-tv Studio's old name replaced in the code's comments too.

### 19 November 2026: release 0.13, and TV home designs from couch-tv Studio (opt in)

0.13 is on [the Releases page](https://github.com/Seagey/couch-tv/releases), with everything below marked "since 0.13". It also brings designs from couch-tv Studio: make a home there, then type its code on the TV in Home settings, Designs, Get a design (the section was called couch-tv Studio before 0.13.9). A design can place the clock, the dock and the rest anywhere, and add any of 66 widgets on a 9 by 5 grid (Scores and Markets were new and had not yet run on a real TV), including Home Assistant ones such as Control Centre and Camera (a still picture every two seconds, never video), and a short looping video background. Nothing changes until someone at the TV turns it on, and turning **Your design** off (before 0.13.9, Back to my classic home) puts the old home back in one step. Things typed at home (a note, lists, the guest Wi-Fi, a calendar address) and a Home Assistant token never leave the TV in a design or in Share this home. Keys are in [CONFIG.md](CONFIG.md).

### 18 November 2026: Fire TV app packages, YouTube videos as a list of their own, and a Keep watching row that follows the app (options A and B, since 0.13)

Two changes for the bridge and one for the home, worked out on a Fire TV Cube (Fire OS 7.7, Android 9).

- **Amazon's builds of YouTube, Prime Video and HBO Max.** A Fire TV ships these as Amazon's own builds, under other package names than the Google TV ones the bridge knew (`com.amazon.firetv.youtube`, `com.amazon.firebat`, `com.hbo.hbonow`; Fire OS's own Settings is `com.amazon.tv.settings.v2`). The bridge took them for apps it had no name for: it never watched what played in them, so their shows never reached Keep watching, it said they were not installed, and every launch and link went to a package the TV did not have. Each app in `bridge/apps.py` can now list its other builds (`packages`), and the bridge opens, links, watches and cards whichever build this TV has, so a Keep watching card's app is the package the TV home's tile has and the two match. `GET /api/apps` lists the packages where there are several. The bridge reads the TV's installed list before the first launch, link or card after it starts, so the first open after a restart goes to Amazon's build too, and with the bridge the kids home's allowed apps and shows carry the build this TV has (without a bridge, option A, the kids home only knows the Google TV package, so on a Fire TV its YouTube, Prime Video and HBO Max tiles do not show). A Google TV with the usual packages behaves exactly as before. bridge/API.md; `tests/test_fire_os_packages.py`.
- **YouTube videos, a list of their own.** YouTube stayed out of Keep watching on purpose (it buries everything else, and a video's name matched to a film put that film in the household's taste, issue #23), and that stays true. Now a video that has played the minute is written down by the name YouTube gave it, with no lookup, no picture and no year, and `GET /api/continue` returns those as `videos`, next to the `items` it always had: one card per title, newest first, at most 10, within 30 days, for that person on that TV, with the same remove by hand as any card. The home can show them under the YouTube tile alone; they never appear in the shared row, the picks, the taste, the Ask context or `GET /api/history`. Opening one searches YouTube's installed build for the title, never the show finder (Amazon's YouTube lists `https://www.youtube.com` links in its intent filter, read with `dumpsys package` on the Cube; opening the search link there has not been tried yet, and the app opens by itself where the link does not take). Removing a video by hand never removes a show of the same name from Keep watching, or the other way round. Spotify, Twitch and Moonlight are still never logged. bridge/API.md, docs/CONFIG.md; `tests/test_youtube_videos.py`.
- **The home: Keep watching follows the app the remote is on (option B from your copy of the repo; with option A the launcher needs a build, `scripts/build-apk.sh`).** Switched on in Home settings, Look (Keep watching follows the app) or with `home.shelf_follows_app`, off unless you ask. While the outline is on an app tile in the dock or the grid, the row shows only that app's cards, as "Recently on <app>", and under the YouTube tile that person's YouTube videos, the `videos` the bridge now sends, which the row never shows otherwise (someone whose only history is YouTube videos sees the row there and nowhere else); a video card has no picture, so it shows its title and "Video", and OK opens it the way any card opens. The filter stays while the remote goes up from that tile into the row (or holds OK on a card there), and the whole row comes back on More apps, Settings, an input, a Screen, a tool, the people, the quick buttons, Now playing or any menu. An app with nothing on the go changes nothing, so the row never empties or flickers as the remote runs along the dock; it is drawn again, and scrolled back to its start, only when its cards would change. A home that Android dropped and brought back within 20 minutes comes back on the same card in the same "Recently on" row. Both looks, with Android's Watch Next list too (option A, no videos there). docs/CONFIG.md, docs/TV-HOME.md; `tests/test_shelf_follows_app.js`.

### 17 November 2026: Keep watching from the Plex server's own Continue Watching (option B, from your copy of the repo)

The bridge only learned of a Plex play it saw on the TV, a minute into playback, so a show left half way on a phone, on another TV or before couch-tv existed never got a card. With a `plex` section in `config.json` (the server's address, and optionally whose cards they are) and `PLEX_TOKEN` in `.env`, the bridge now reads the Plex Media Server's own Continue Watching list every five minutes and gives each show and film a Keep watching card next to the plays it logs itself: the show with its season, episode and a progress bar, or the film, newest first, one card per show across both lists. The card opens the show in Plex the way a Plex card already did, and removing it keeps it off until it is watched again. The token stays on the bridge: the TV and the phone get the posters through the bridge, never the token or the server's address. Off unless configured; one Plex account per bridge. docs/CONFIG.md, Plex; `tests/test_plex_keep_watching.py`.

### 17 November 2026: Keep watching, one card per show when the app names the episode first (option B, from your copy of the repo)

Plex (and some others) report what plays as the episode first and the show second, and name the show with its country, "The Office (US)". The bridge took the episode's name for the show, so every episode became its own Keep watching card, and the picture came from whatever JustWatch has under that episode's name: an Office episode called "The Sting" got the 1973 film's poster, most got none. The bridge now treats a title the same but for a trailing bracket as the same title, and when one of the two names is a show that has the other as one of its episodes, that show wins, even when the episode's name is also a film's. One card per show again, with the show's own picture and the latest episode on it. Cards from plays logged before this still carry the episode's name: hold OK on one and choose Remove from Keep watching, and the next play of that show makes a proper card.

### 17 November 2026: Sony Bravia, a double Home press stays on the home (options A and B, since 0.13)

On a Sony Bravia (Google TV, Android 14) two quick presses of Home left the Google home in front. The Home button watch now catches the Home key on Sony, the same as it already does on Xiaomi and KTC, so every press goes straight to couch-tv. Tested on the real remote by the person who reported it (#258). The Kotlin part needs a build.

### 17 November 2026: the focused tile holds still after a few seconds, and a low end TV turns on Lighter home by itself (option B, from your copy of the repo)

Measured on a 2 GB Android TV (Android 11, four Cortex A55 cores, 1.8 GB, WebView 157) with the home's own frame clock: at rest the home drew 52 frames a second, but with a dock tile focused only 22, and moving along the dock 21. Anything that moves makes the TV draw every frosted panel again each frame, and the focused tile's slow sway and glint never stop moving. Switching parts off one by one on that TV: the glint alone 24, the sway alone 18, every blur off 47, the sway and glint still 60; the shadows, the photo, its filters, the clock's filters and the rain and snow canvas made no difference. Now the sway and glint play for 6 s after the focus moves, then hold still where they are until the next press, so a home left alone draws nothing. And when nobody has chosen Lighter home (Home settings, Look, or `home.lighter`), the TV checks itself: 1 GB of memory or less turns Lighter home on, 4 GB or more leaves it off, and otherwise (that TV's WebView does not say) the home measures its frame time for 1.5 s with something moving, a few seconds after it opens, and keeps the answer for a week. On that TV it measured 33 ms. With the hold and the blur off (a first version of this change, before it used the rest of Lighter home too): at rest 56, a dock tile focused 56 to 59, moving along the dock 42 to 44. A TV that measures smooth looks exactly as before. docs/CONFIG.md, `lighter`; `tests/test_low_end.js`.

### 17 November 2026: the home rests while something covers it, and a scene survives a lost picture (option B from your copy of the repo; the launcher part needs a build)

Measured on a Fire TV Cube (2 GB): while Netflix or the TV's screensaver covered the home, the page went on redrawing its clock every 15 s, asking the bridge who is watching every 3 s and what is playing every 5 s (each a `dumpsys` on the TV), and the scene after the one on screen stayed decoded for the whole turn, so the page's GPU memory swung between 115 MB and 260 MB at every change. Now the launcher pauses the page's timers and script while an app or the screensaver is in front (`MainActivity.onPause`), and the page itself holds its clock (which redraws once a minute, on the minute), its polls and its smart idle while covered; the profile poll backs off to 30 s while the bridge does not answer. Scenes: the next one is readied 3 s before its turn instead of right after the fade, a faded-out scene gives its pictures back, a fade waits (up to 8 s) for the new scene's photo instead of showing a black scene, and a built-in picture lost on the way is asked for again at 2, 6 and 15 s, after which the scene on screen moves on. Own scenes keep their behaviour (a missing file leaves the turns). `tests/test_home_idle.js`.
### 17 November 2026: Lighter home turns off the filters it had left on (option B, from your copy of the repo)

On a Fire TV Cube (2 GB) the home drew at a 15-21 ms frame whenever it animated, over the 16.7 ms of a 60 Hz frame, with Lighter home on: the night dim after 9 pm was a brightness filter on three full-screen layers, the glass clock kept its drop-shadow and saturation filters, and every dock icon that is not focused had a brightness filter of its own. Under Lighter none of those run now: the night dim is one dark sheet over the scene, the fog clock's dark fill is a dark colour, and an icon that is not focused is a little see-through instead. Measured on that Cube with the same run of presses: the Keep watching row went from a 15 ms frame with a third of them late to 8 ms with none. The full look is unchanged.

### 17 November 2026: back on the home, the first presses no longer wait (option B; the launcher part needs a build)

A Chromium trace on a Fire TV Cube showed a D-pad press waiting about 6 s for its frame right after every return to the home: the page refreshed twice (the Home button watch's ask, then the launcher's) and each refresh waited, on the page's own thread, for the launcher to rescan every installed app with its label and to read Android's Watch Next rows. The launcher now keeps both ready in the background: the app list is read again only when an app is installed, removed or renamed (or the TV's language changes) and replaces the old one in a single step, and Watch Next is read on a background thread when the home comes back and whenever Android says it changed. The page runs one refresh for the two asks. `tests/test_home_return.js`.

### 17 November 2026: the scenes wait while something covers the home (option B, from your copy of the repo)

The Night look's scenes went on taking turns while an app or the TV's screensaver was in front. Each change decodes and uploads a fresh set of 1080p layers, and on a Fire TV Cube (2 GB of memory) the home's GPU memory was seen swinging between about 115 MB and 260 MB with every change while the screensaver covered it, which is what pushes a small box into swapping and makes the first presses after Home slow. The page now holds the scene while the launcher has told it to pause (an app in front, the screensaver) and while it is hidden, and carries on when the home is back. The date line of the Night look also gets a middle dot between the day and the weather place, the same as between the other parts.

### 17 November 2026: the bridge compresses the home and the remote, and lets the TV cache pictures (option B, from your copy of the repo)

The bridge sent every file of the TV home and the phone remote uncompressed and marked `no-cache`: a reload of the home (the Look button is one) fetched 920 KB of script and style and revalidated each background one by one, which on a Fire TV Cube over weak Wi-Fi showed as seconds of lag and a late photo. Script, style, HTML and JSON are now gzipped on the fly (about a quarter of the size) and still revalidated on every load, so an edit lands at once; pictures, fonts and video are cached for an hour (a replaced picture under the same name shows within the hour); the phone remote's built files, whose names carry a content hash, are cached for a year. An unchanged file answers 304 with no body, worked around a quirk of this aiohttp with compression on.

### 16 November 2026: own scenes follow the sun, a 4K copy for own scenes, and a date line with bars (since 0.13)

Three small, opt-in additions, found while putting couch-tv on a Sony Bravia XBR-65X850G (Android TV 10, option A with the on-TV app). None changes anything unless you set it.

- **Own scenes follow the sun.** A scene in `home.my_scenes` can say `"when": "dawn"`, `"day"`, `"dusk"` or `"night"`. With `home.sun_sync` on, the home shows the built-in scene for the time of day, and the scenes tagged with that time take turns with it, one every `home.sun_rotate_minutes` (25 by default). That lets a long list of your own photos follow the sun without a clock of their own. With no `when` anywhere, Follow the sun is exactly as it was. ([MAKE-A-SCENE.md](MAKE-A-SCENE.md), [CONFIG.md](CONFIG.md))
- **A 4K copy for own scenes.** `make-scene.py --4k` also writes `scene-<id>@2x.jpg`. On a 4K screen the home tries it first and falls back to the 1080 file if it is missing, so scenes made before this still show. Built-in scenes already had 4K copies; own scenes had none.
- **A date line with bars.** `home.date_bars: true` puts a thin vertical bar between the day, the place and the weather instead of the dots. Off by default.

Also written down: `smart_idle.home_idle_minutes` only takes 5, 10, 15, 30 or 60, and any other number is read as 15 without a warning ([CONFIG.md](CONFIG.md)).

### 17 November 2026: option B on a Fire TV, over ADB alone (since 0.13)

Fire OS ships no Android TV Remote protocol (ports 6466 and 6467 are closed on a Fire TV Cube 3rd gen), so the bridge could never pair with a Fire TV and option B's phone remote failed with "not paired". A TV with `"adb_only": true` in `config.json` now runs on ADB alone: keys, typing, links, power and the app in front all go over the bridge computer's ADB connection, which current Fire OS does not block (it only blocks apps on the TV). `bridge/pair_tv.py <tv id>` skips the code pairing for such a TV and only checks ADB, and `scripts/check-tv.py --adb` says when to set the flag. Tested end to end on a Fire TV Cube (3rd gen, Fire OS 7, Android 9) with the bridge in a Debian container. Typing is limited to letters, digits and plain punctuation, and there is no volume level. docs/CONFIG.md, The TVs.

### 14 November 2026: custom cards with a web link open on Android TV, LG and Samsung (since 0.13)

Thanks ekagra-codes ([#207](https://github.com/Seagey/couch-tv/pull/207)). A custom card with a `url` now opens in the TV's browser: on a standalone Android TV through the home app or the on-TV app, on an LG through its browser app and on a Samsung through its browser app (the Samsung one opens the browser, but the TV's own launch call may not pass the address on, so it is untried). Only plain http and https links with a host are opened. The home also reads the card file again when you come back to it (`/api/custom-cards?force=1`, kept at least 5 seconds apart), and some tests now run on Windows too.

### 14 November 2026: choose where the home starts, profiles, Keep watching or apps (since 0.13)

Thanks nidhalmouldi (#211) for the request and ekagra-codes (#212) for the code. With two or more people set up, every Home press landed on the profile switcher, so a home that rarely changes profile needed two presses Down to reach the apps. Home settings, Look, has a new Start on row (or set `home.start_focus` in `config.json`): Profiles (the default, exactly as before), Keep watching, or Apps. An unknown value is ignored. See [TV-HOME.md](TV-HOME.md) and [CONFIG.md](CONFIG.md).

### 15 November 2026: the clock follows the TV's 12 or 24 hour setting, and Keep watching stays in view while you remove a show (since 0.13)

Thanks devmaliakbar (#221) and Hiren-Patel1 (#218). On an Android TV the home's clock now follows the TV's own setting (System, Date and time, Use 24-hour format) until you pick 12 or 24 hour in Home settings, Look, or set `clock` in `config.json`. Before, it only went by the language, so a 24 hour TV in English showed 12 hour. In the Night look, the Keep watching row no longer vanishes while the hold OK menu is open: the row stays on screen with the other cards dimmed, and "Removed" now shows in the status line instead of hiding the row for 4 seconds. The clock needs the 0.13 app on the TV; the row fix is in the home page.

### 14 November 2026: Restart home in Home settings, About (since 0.13)

Home settings, About now has a **Restart home** row. It starts the home again from scratch, the way a force-stop in the TV's Settings, Apps and then Home would: a new WebView, the bridge looked for again, nothing kept from the old page's cache. Every setting stays. It is for seeing a change made on the computer without walking to the TV settings. With an app from before this row, or outside the TV home app, it reloads the page instead. Thanks janooh37-hue (#217).
### 14 November 2026: two more real LGs, and `--apps tv` pairs by itself (since 0.13)

Thanks Anshul7171 (#219) and adri07 (#220). An LG NANO80TNA (webOS 5.6.2) ran app only with no bridge, and an LG 28TQ515S smart monitor (webOS 7.6.0) ran the bridge in Docker on a Synology; both work, so LG is now at thirteen real TVs. `lg/build.py --apps tv` no longer stops when the TV has not accepted the remote: it asks for it itself, with no bridge, and says to move the highlight to Accept before pressing OK. `check-tv.py` no longer calls the LG path untested. [LG.md](LG.md) now says to keep the Developer Mode app open while `--getkey` runs, to prefer `--apps tv` over a saved list (the icon addresses go stale), that the dock follows couch-tv's own order, and that `prisoner` cannot read `/usr/palm/applications`. [DOCKER.md](DOCKER.md) has the Windows `scp -O` and `cmd /c` notes for a Synology.

### 14 November 2026: VIZIO, couch-tv's home in the TV's own webview, tried on one set (since 0.13)

Thanks lukionsp (#206). On a VIZIO, `scripts/vizio-web.py` can now load couch-tv's home (the bridge's `/tv/`) in the TV's own webview, through VIZIO OS's web app launcher. `--probe` finds which launcher id your set accepts with a test page that reports back, and `--url` puts the home up. It has been tried on one set, a V4K65X-0810 on VIZIO OS 86.920.9.3; the webview is slow, so a single scene works best. It is off unless you run it: the bridge never opens it by itself, and a new install behaves exactly as before. For safety, couch-tv only sends a page with name space 4 and an allow listed launcher id (3001 or 17), checked in the one function that builds the request, and only a plain `http://` or `https://` address. It refuses `APP_ID` 1, the TV's main menu, where a saved address can leave the menus dead until a factory reset. Steps and the safety note: [VIZIO.md](VIZIO.md#the-home).

### 14 November 2026: input tiles for each TV, and a picture on an input tile (since 0.13)

A TV can now have its own input tiles, `tvs[].inputs` in `config.json`, with the same items as `home.inputs`. That suits two TVs with different consoles; `[]` gives one TV no input tiles. An input tile can also have an `image`: a picture file inside the app (SVG, PNG, JPEG or WebP, such as `backgrounds/mine/console.svg`) shown in place of the drawn icon, which comes back if the picture does not load. Web addresses, absolute paths and `..` are refused. Both are off unless configured, so a `config.json` without them behaves exactly as before. Thanks BireshwarChakravarty (#205, from #89).

### 14 November 2026: LG goes back to couch-tv in about half a second, and input tiles switch straight to HDMI (since 0.13)

On an LG, backing out of an app took 3 to 4.5 seconds to land on couch-tv. The bridge now subscribes to the TV's foreground app, so it hears the moment the app in front changes, and while another app is in front it also looks every quarter of a second as a fallback for a firmware that sends no message (it does not look that often at any other time). The waits after an app closes and after the TV comes on are shorter too. The false "couch-tv is no longer installed" warning no longer shows while couch-tv is on screen. A pinned input tile on an LG (`home.inputs`, a `port` of 1 to 9 or an id like `HDMI_1`) opens `com.webos.app.hdmi<N>` directly instead of LG's input list. Eight more LG app names were added to `bridge/apps.py`. Thanks BireshwarChakravarty (#204, from #89), measured on an LG QNED88T6A and an LG NANO83A6A.

### 14 November 2026: Home button on Android 10 TVs comes back faster (since 0.13)

On a Hisense Android TV 10, the TV's own home stayed up for about 5 seconds after a Home press before couch-tv came back (option A), and the on-TV app did not come back at all. Android 10 still holds new app starts for that long after Home. Both apps now try moving couch-tv's task to the front first on Android 10 (the way they already did on Android 9), check under a second later that couch-tv really is in front, and fall back to the normal start if Android refused the move. Android 11 and newer behave exactly as before. Thanks vladyslav-makar (#202) for the very detailed report.

### 14 November 2026: app names checked before closing or switching off apps (since 0.13)

The bridge now checks every app name before it closes apps when a TV turns off (`close_on_off` in `config.json`) and before its daily keep-disabled check switches apps off or back on. A name that is not a plain Android package name is skipped with a line in the log, and the rest still run, so a mistyped or tampered file can never send anything else to the TV. Nothing changes for a normal setup. Thanks ekagra-codes (#177).

### 14 November 2026: remove a card from Keep watching on the phone remote (since 0.13)

Thanks poinch (#176). Each poster in Keep watching on the phone remote now has a small X. Tap it and that show leaves the row for that TV and that person, and a line says it was removed. It stays gone, including after the bridge restarts, until the show is played again, and then it comes back. Removing a card on the TV home does the same on the phone. The bridge keeps the list in `bridge/data/hidden.json` and the phone uses a new `POST /api/continue/hide`, which needs the pairing key like the other `/api` routes. The phone strings are in English, Italian and Polish.

### 14 November 2026: your own cards on the home, without changing couch-tv (since 0.13)

The home can now show your own cards at the end of the Keep watching row: the solar output today, bin night, a message for the family. Point `home.custom_cards` in `config.json` at a small JSON file, either a file on the bridge computer or an `http` or `https` link (a raw GitHub file, a Raspberry Pi on your Wi-Fi), and whatever you like writes that file. couch-tv only shows the cards: a title, a value, a subtitle and a picture, and OK opens an installed app or a link. Nothing in the file is ever run, at most 8 cards show, and a bad file keeps the last good cards. It is read every 10 minutes and is off unless you set it ([TV-HOME.md](TV-HOME.md#custom-cards)). Thanks geissmannz on Instagram for the idea.

### 14 November 2026: Polish bridge messages, and the assistant answers in Polish (since 0.13)

With the home set to Polish, the bridge's own messages (an app that will not open, a TV that is not answering, what an input switch did) now show in Polish on the phone remote and the TV home, and the Claude assistant answers in Polish, quick reply buttons and the reasons on its picks included. The assistant follows the TV home's language in every language: Home settings on that TV first, then `home.language` in `config.json`, then English. The bridge still sends every message in English exactly as before, with a key beside it, so the other languages show the English text until someone translates the new keys. Thanks Azumi0 (#196). The on-TV app follows in part 3.

### 14 November 2026: the phone remote is complete in Brazilian Portuguese (since 0.13)

The phone remote now has every sentence in Brazilian Portuguese: the 27 Kids mode lines that showed in English after #193 are translated, so the remote has all 166. The TV home was already complete and is unchanged. Thanks scursel (#195).

### 14 November 2026: TV home over paired Wireless debugging, tested on an Epson LS300 (since 0.13)

`tv-home/tools/tvadb.py` can now install and test the TV home over a Wireless debugging connection you have already paired with Google's `adb`, without opening port 5555. `apply.sh` goes through `tvadb.py` too, but has not been tried this way yet. It is opt in: set `TV_ADB_BINARY` to that `adb` and `ADB_PORT` to the current connection port. Without `TV_ADB_BINARY` nothing changes, and the bridge, the phone remote and the other tools still use plain ADB on the fixed port. Tested on one Epson LS300 projector (Android TV 14): install, apps, the projector remote's buttons and a restart worked. The Home button on stock LS300 firmware, and the LS650, LS800 and LS500, are untested ([EPSON.md](EPSON.md)). Thanks mazzanfar (#194).

### 14 November 2026: Brazilian Portuguese on the TV home and the phone remote (since 0.13)

The TV home and the phone remote now speak Brazilian Portuguese (Português (Brasil), `pt`). A TV or phone set to Portuguese picks it by itself, and Home settings can switch to it. The clock is 24 hour unless you pick 12 hour, and the country for where shows stream is `BR` when `config.json` does not set one. All 398 TV home sentences are translated; the phone remote has 139 of its 166 (the newest few show in English for now). Thanks scursel (#193).

### 14 November 2026: a TV settings quick button, and Settings opens on its own screen (since 0.13)

TV settings, Bluetooth and Network now open on the screen you asked for. Android's Settings app keeps a single task, so opening TV settings after visiting Network used to bring back the Network page. The launcher now clears that task first. There is also a new **tvsettings** quick button for people who reach the TV's Settings often: add it in Home settings (or `home.quick`), it is off unless you add it. It uses the same route as Home settings, TV settings, so it works on the TV home launcher (option A) and with the bridge. Thanks syedhabibtirmizi ([#190](https://github.com/Seagey/couch-tv/pull/190)).

### 14 November 2026: Polish on the TV home and the phone remote (since 0.13)

The TV home and the phone remote now speak Polish (Polski). A TV or phone set to Polish picks it by itself, and Home settings can switch to it. The clock is 24 hour unless you pick 12 hour, and the country for where shows stream is `PL` when `config.json` does not set one. English and the other languages are unchanged. Thanks Azumi0 (#184), who wrote it and plans two follow ups: the bridge's own messages, and the on-TV app.

### 14 November 2026: the Look button and Home settings changes show at once on the TV home (since 0.13)

On the TV home app, pressing the Look quick button, or changing a look or other setting in Home settings, saved the choice but the screen did not change until the app next restarted. The page restarts itself after those changes, and the app's WebView was refusing that reload along with every other navigation. It now lets the home page reload itself (same address, under `/tv/`, for both the bridge home and the saved offline copy) and still refuses every other address. The reload also uses `location.reload()` when the address would not change. Thanks clembgrn for the diagnosis ([#185](https://github.com/Seagey/couch-tv/issues/185)) and syedhabibtirmizi for the fix ([#189](https://github.com/Seagey/couch-tv/pull/189)). It may also be the cause of [#186](https://github.com/Seagey/couch-tv/issues/186).

### 14 November 2026: Czech is complete, and the phone remote speaks Czech too (since 0.13)

The Czech TV home now has every sentence translated, including Ambient, the quick buttons, Kids mode and the LG Developer Mode lines, so nothing shows in English any more. The phone remote now speaks Czech as well (Čeština, picked in the TV menu under Language, or by itself on a phone set to Czech). Thanks slezaCZ, who wrote both sets of translations (#180).

### 14 November 2026: sharper scenes on a 4K TV that draws its interface at 1080 (since 0.13)

Some 4K TVs (a TCL Google TV) draw apps at 1080 and upscale them, so the home thought the screen was 1080 and loaded the softer 1080 scene pictures. `home.hi_res: "always"` in `config.json` now loads the 4K copies anyway. It is off by default and there is no Home settings switch yet (thanks Hiren-Patel1, [#191](https://github.com/Seagey/couch-tv/issues/191)).

### 14 November 2026: an app banner that is not 16:9 is no longer squeezed (since 0.13)

The app row draws each app's TV banner as a 16:9 tile. A banner of another shape was stretched to fit, which is how Prime Video looked squeezed on a Fire TV Stick (thanks niravsaxena30, [#181](https://github.com/Seagey/couch-tv/issues/181)). Such a banner now keeps its proportions, fitted inside the tile with its own edge colour filling the gap. Banners that are already 16:9 draw exactly as before. This is a likely cause rather than a confirmed one, so #181 stays open until it is checked on the stick.

### 14 November 2026: the bridge's web pages stay inside their own folder (since 0.13)

The bridge serves the phone remote and the TV home from their folders. A folder next to one of them whose name started the same way (for example `dist_old` beside `dist`) could be read through it. Now only files inside the folder itself are served. Thanks ekagra-codes (#179).

### 13 November 2026: Czech on the TV home (since 0.13)

The TV home now speaks Czech (Čeština), with a 24 hour clock and Czechia as the country for where shows stream. It is picked in Home settings, `home.language: "cs"`, or by itself on a TV set to Czech. 298 of the home's sentences are translated; the newest ones (such as Ambient and the LG Developer Mode lines) show in English for now. The phone remote is not in Czech yet. Thanks slezaCZ, who tested it on a Gogen Android TV 11 (#178).

### 13 November 2026: Chromecast with Google TV keeps couch-tv after two quick Home presses (since 0.13)

On a Chromecast with Google TV (Android 14), pressing Home twice quickly from an app could leave the Google home in front for good. The app that was closing (Jellyfin here) sent its window event after the Google home's, so the Home button watch read that as the home having gone, and later Home presses sent no new event. The watch now keeps when the TV's own home last came forward and when couch-tv last did, and its one re-check brings couch-tv back when the home came last and the only events since were another app closing within about 2 seconds. An app you really opened from the home still keeps the screen. Fire TV, Bell Fibe, Xiaomi and the Android 9 path are unchanged. Reported with the logcat trace by goldimpala ([#175](https://github.com/Seagey/couch-tv/issues/175)). Untested on a real Chromecast so far.

### 13 November 2026: Hold OK on a Keep watching card (since 0.13)

Holding OK on a card in Keep watching opens a small menu with **Remove from Keep watching**, the same way holding OK on a dock app opens its menu. It is on main and not in 0.12, so a TV running the 0.12 release app does nothing on that hold (a Chromecast and an NVIDIA Shield both showed this, [#175](https://github.com/Seagey/couch-tv/issues/175), thanks goldimpala). Build the app from main ([Building the app](SETUP.md#building-the-app-instead-of-downloading-it)) to have it now. A click beside the open menu now closes it, as it does for the dock menu.

### 13 November 2026: Android TV 9 brings couch-tv back without the 5 second wait (since 0.13)

On a Xiaomi MiTV-AXSO2 (Android TV 9, Google's older Android TV home), a Home press left the Google home up for 5 seconds, and a second press in that time kept it there. It is the same Android 9 hold as on Fire OS 7 (#162), so the Home button watch now moves couch-tv's own task to the front on every TV with Android 9 or older, not only on Fire TV. Android 10 and newer are unchanged.

### 13 November 2026: Bell Streamer with Fibe TV as its home (since 0.13)

On a Bell Streamer (Bell Canada's Android TV 12 box) the home is Bell's Fibe TV app, so the Home key opened Fibe and never reached couch-tv. The Home button watch now knows Fibe's home screen and puts couch-tv back on top, and `apply.sh` switches the watch on when Fibe is installed. Fibe is never switched off. Opening Fibe from couch-tv's own tile works and is left alone while it stays in front. Untested on a real box so far (thanks Sparkybabcia, [#168](https://github.com/Seagey/couch-tv/issues/168)). What to expect: Fibe may flash up for a moment before couch-tv comes back, and a Fibe button on the remote will bring couch-tv back instead of Fibe, because the watch cannot tell it from a Home press.

### 13 November 2026: The home comes back to the tile you left (since 0.13)

After opening TV Settings or an app's settings, a TV that was short of memory could drop the home page and start it again at the first tile, because the page did not remember where you were. The home now saves the row and tile you were on when it goes into the background (and a moment after each move), and puts you back there for the next 20 minutes. Pressing Home still goes to the first tile. Reported on a Hisense Google TV with 1.8 GB of RAM (thanks IshMehta, [#166](https://github.com/Seagey/couch-tv/issues/166)).

### 13 November 2026: Privacy clean, opt in (on main)

`apply.sh` has a new opt in step, `PRIVACY=1`, that switches off known tracking, ad and ACR (automatic content recognition) apps it can find on your TV, reversibly: Samba TV on Sony, Alphonso, Xiaomi analytics and ads, Fire TV's ACR, ad ID and metrics apps, and Google's feedback and ad services apps. It goes through the same safety check as everything else `apply.sh` switches off, so the TV's home, setup, the remote (Bluetooth, voice, HDMI CEC) and Keep watching (the TV provider that holds Watch Next) are never touched, and `undo.sh` switches it all back on. `PRIVACY=1 DRY_RUN=1` shows what it would do first. It cannot remove every bit of tracking, so [PRIVACY.md](PRIVACY.md) also lists the menu switches to turn off on each brand, Samsung and LG included. Nothing changes unless you set it. The step runs on your computer, so `git pull` brings it.

### 13 November 2026: Fire OS 7 brings Couch TV back without the 5 second wait (since 0.13)

On a Fire TV Cube (3rd gen, Fire OS 7.7.1.7), Amazon's home stayed up for 5 seconds after a Home press, and a second press could bury Couch TV for good. Android 9 and older hold an app's start for 5 seconds after Home, so on Fire TV the home's own task is now moved to the front instead, and a press inside the 1.2 second gap is looked at again. Fire OS Settings screens still stay open, and other TVs and Android 10 and newer are unchanged. Thanks to atul016 (#162).

### 13 November 2026: The Next song button skips the track again (since 0.13)

On a Mi Box (Google TV), Next on the ambient music screen and on the Spotify card in Keep watching opened the gear menu (Home settings or TV settings) instead of skipping. The home's check for the remote's Settings key (key code 176) also matched the media Next key, which a browser engine reports with the same code. The home now tells them apart, in Kids mode too. Thanks NathanGlasby (#158).

### 13 November 2026: Your own scenes can move (since 0.13)

A scene in `home.my_scenes` can play a short looping clip behind its cut-out and the glass clock: add `"video": true` and put the clip at `backgrounds/mine/scene-<id>.mp4`. It is off unless you set it. Only the scene on screen plays, and it stops for an app, the ambient clock, screen off, Lighter home, the OLED and Classic looks, and the system's reduced motion setting; the photo stays if the clip cannot play. With option A the clip goes inside the app, so build it again (the built-in copy now serves `.mp4` as video). [MAKE-A-SCENE.md](MAKE-A-SCENE.md) step 7 explains making and looping one. Thanks digitaldarkmatterltd (#155).

### 13 November 2026: Home settings lists stay put on older Samsungs (since 0.13)

On a 2020 Samsung (Tizen 5.5), moving down a long Home settings list such as Apps flashed the list up to the top and back on every press. The list now keeps its place and only the step to the next row scrolls. Thanks vicenteveltri (#156).

### 13 November 2026: Nuvio in Keep watching (the on-TV app since 0.13)

Shows played in Nuvio, the Stremio-style player, now show as playing and count for Keep watching, with the bridge and in the on-TV app. A film played in Nuvio is no longer logged as the film "2012" or "1917": Nuvio sends the release year where other apps send the episode. With the bridge, a Nuvio card opens the show's page in Nuvio (by its IMDb id from JustWatch), where you pick the episode: Nuvio takes no episode links. In the on-TV app a Nuvio card opens Nuvio. With the bridge only Nuvio's GitHub build (`com.nuvio.tv`) is read, not the Play Store one (`com.nuvio.app`). Shows played in Nuvio can't reach Keep watching with option A, because Nuvio adds them to its own channel, not Android's Watch Next list. Thanks NathanGlasby (#157).

### 13 November 2026: Hebrew and right to left layout on the TV home (since 0.13)

The home now speaks Hebrew (עברית), including the TV's own `he` or older `iw` language setting. The layout mirrors for right to left: the settings list moves to the right, chevrons flip, popups open on the correct side, and the remote's left and right buttons move the way the screen reads. English and the other languages are unchanged. Thanks YuvalHir (#153).

### 13 November 2026: Ask on the TV with more AI services (since 0.13)

On-TV mode's Ask is no longer Claude only: the setup page has a service picker for Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, another service that copies OpenAI's API, or a model on a computer at home (Ollama, LM Studio, llama.cpp). Claude Haiku 5.5 stays the default and an existing Claude key keeps working. A key only ever goes to the address it was saved for, `GET /api/settings` never returns it, plain http is allowed only on your home network, and Ask stays off for a kids profile. Ask is now told which apps the TV has, so it stops trying apps you do not have, and says what went wrong instead of a bare "Done.". See [ASK-PROVIDERS.md](ASK-PROVIDERS.md). Thanks iarhamanwaar (#140).

### 13 November 2026: Xiaomi TVs, Couch TV in PatchWall's place, and a lighter home page on 1 GB TVs (since 0.13)

In the on-TV app on a Xiaomi or Redmi TV, a setup page switch (off by default, Xiaomi only) makes the remote's PatchWall button, PatchWall's tile and power on open Couch TV, but never over an HDMI or TV input wake. The Home button is not changed. On low memory TVs the home page is now released only when Android says memory is critical, and comes back when the app does. See [on-tv/README.md](../on-tv/README.md). Thanks gauharjk (#151).

### 13 November 2026: An Open the home button on the on-TV setup screen (since 0.13)

On Google TV the Couch TV tile opens setup and Google's home keeps the Home button, so option C had no way to see the couch-tv home. Setup now starts with **Open the home**, which opens it and appears only when the Home button doesn't already open Couch TV, and the note under Use as home screen says how Google TV behaves. The Couch TV home watch accessibility service is for Fire TV only and switches itself off on other TVs, which is expected. The button opens the home, which applies Kids mode itself.

### 13 November 2026: VIDAA fixes from a Hisense 43A6N (on main)

A VIDAA trace now hides the refresh token as well as the access token. With `keep_home` on, the phone remote's Input key no longer has couch-tv jump back over VIDAA's source picker. Pairing now keeps the token a TV sends on its `tokenissuance` answer instead of saying there was none. A new opt in `"pointer": true` lets the page take clicks from the TV Browser's mouse cursor. Thanks Schielef (#145), whose 43A6N is now on the compatibility list.

### 13 November 2026: check-tv warns about Fire OS builds that block the TV's own ADB (since 0.13)

`scripts/check-tv.py <tv address> --adb` reads the Fire OS version and says whether this build blocks option C's phone remote from pressing keys and typing, may still allow it, or could not be read, and points to option B each time. Other Android TVs are unchanged. Not run on a real Fire TV yet. Thanks googlarz (#149).

### 13 November 2026: The Screensaver button on Philips and similar TVs (since 0.13)

On a Philips 43PUS8546/12 the TV home came back to the front half a second after the button cut the screen timeout and put it straight back, so the TV never napped and the button said "The TV did not start the photos". A return that soon is now ignored (the screensaver ending, the 25 second deadline and a restart still put the timeout back, so a TV is never left on five seconds). The button also keeps its name under the Night look, has an accessible name, and says in Home settings that it starts the photo screensaver and is not the day and night switch. Thanks digitaldarkmatterltd (#146).

### 13 November 2026: LG Developer Mode extend, five app logos and a Dutch home (since 0.13)

On an LG with no bridge, the home now asks once a week "Extend Developer Mode?" and stays on screen until answered, so LG does not remove couch-tv when the session runs out. There is an `extend` quick button (off until you add it) and a Dev mode tile in the dock that opens LG's own Developer Mode app. VTM GO, VRT MAX, Stremio, Amazon Alexa and YouTube Cobalt AdFree get their logos, and the TV home speaks Dutch (`nl`, Belgium). See [LG.md](LG.md). Thanks JensDevold (#142).

### 13 November 2026: A Hisense VIDAA home with no computer, and Spotify on the Now playing card (on main)

A VIDAA TV can now run couch-tv's home as a small website the Couch TV tile opens, so the clock, scenes or your photos, weather and Home settings keep working with the computer off (`scripts/build-standalone.sh`, [VIDAA.md](VIDAA.md), "No computer: a standalone home"). On Vercel it also shows what's playing on your Spotify account, with a Play on TV button that moves the music to the TV. With the bridge, a new optional Spotify login fills the Now playing card when the TV itself shows nothing (a VIDAA, LG, Samsung or Roku, or music on a phone). Both stay off until you set them up. VIDAA also gets a `tile_id` setting for moving the tile to a new address. Thanks Matthew-Klette (#141).

### 13 November 2026: Smaller fixes (since 0.13)

The home's quick buttons for Bluetooth and Network now open the TV's settings straight from the launcher, and the sleep timer button no longer says it needs the computer when the launcher can do it itself. The doorbell card also shows on Android 6 and 7 (Fire OS 6), and a failed app launch no longer crashes the launcher. Thanks ekagra-codes (#137). The LG page and the bridge on Windows are better covered (a time zone package, the firewall, starting at logon, and two minutes to press Accept), thanks BlueSpark911 (#136).

### 13 November 2026: Smart Idle, optional (since 0.13)

Off unless you switch it on in Home settings, under Look. After a wait on the home screen (5 minutes to an hour) it shows a dim, pure black clock that drifts a few pixels so nothing burns in, or turns the screen or the TV off. It can also turn the TV off after paused playback (Android TV and Roku; never an HDMI input or a game), with a "TV auto-off" warning and an "I'm still here" button on the phone remote for the last five minutes. Optional quiet hours shorten the wait overnight. See [CONFIG.md](CONFIG.md), `smart_idle`. Thanks ekagra-codes (#132).

### 13 November 2026: Hisense VIDAA, working on a real TV (one set so far, since 0.13)

Matthew Klette (#128) got couch-tv running on a real Hisense 55U7N (VIDAA 9): login, pairing, the phone remote, opening apps and a native Couch TV tile all work. New `keep_home` option (off by default) brings couch-tv back when the TV falls to VIDAA's home. Setup: [VIDAA.md](VIDAA.md). Thanks Matthew.

### 13 November 2026: Quick Home presses on a Xiaomi TV (since 0.13)

On a Xiaomi TV the Home button watch now also catches the Home key and the Mi logo key as they are pressed, so pressing them quickly several times no longer leaves Google's home on screen (issue #54). Other TVs are not touched. Thanks AryanFelix (#135).

### 13 November 2026: Philips Titan OS, first read only look at a real TV (since 0.13)

A 43PUS8909/12 answered the check: its remote API, its network announcement and a browser activity are real. Pairing, keys, volume, apps and the home have not run on it yet, so on Titan OS it is the phone remote only, and pairing has not been tried on a real TV yet. Also better: connections are reused, a TV that does not answer now says why, and the serial number is hidden in what the check prints. `scripts/find-tvs.py` lists a Philips TV and `scripts/philips-setup.py <address>` goes from address to a config entry. See [PHILIPS-TITAN.md](PHILIPS-TITAN.md). Thanks googlarz (#144).

### 12 November 2026: Kids mode, New and optional (since 0.13)

Off unless you switch it on for someone. A kids profile's home shows only a shelf of shows a parent picked, as big posters that open straight into each show, plus the few apps you allow. No other apps, no settings, no grown ups' Keep watching. Leaving it needs the parent PIN, typed with the remote's arrows. Now in the Apple TV app (Couch TV) too. See [Kids mode](../README.md#kids-mode). Idea from Natalie Bruss (@nataliebruss on Instagram).

### 12 November 2026: Philips, Panasonic and Fire TV on Vega OS, not yet run on real TVs

Four more paths, each with a computer at home that stays on, and on each the maker's own Home button still opens the maker's home:
- **Philips with Titan OS:** the phone remote (power, keys, volume, inputs, apps; one real TV has answered the read only check, pairing is still to be tried). couch-tv's home needs a Titan app, from Titan's store or its DevView developer app, which is not there yet ([PHILIPS-TITAN.md](PHILIPS-TITAN.md)).
- **Older Philips with Saphi:** the phone remote, and couch-tv's page in the TV's browser where the set offers one ([PHILIPS-SAPHI.md](PHILIPS-SAPHI.md)).
- **Panasonic Viera (My Home Screen):** the phone remote, and couch-tv's page opens itself in the TV's browser ([PANASONIC.md](PANASONIC.md)).
- **Fire TV on Vega OS:** an app you build once with Amazon's free tools, opened by the bridge ([FIRE-VEGA.md](FIRE-VEGA.md)).

If you have one of these TVs, each has a short read only first test, and an issue saying how it went helps everyone after you.

### 12 November 2026: VIZIO, the phone remote (not yet run on a real VIZIO then)

couch-tv can now drive a VIZIO on SmartCast or VIZIO OS from the phone remote: power, volume, inputs and opening apps, with a computer at home. couch-tv's own home page does not open on a VIZIO by itself (no browser, no sideloading, and VIZIO's app programme is closed to outsiders). It is new and has not been on a real VIZIO yet: if you have one, the first test only reads and takes about 15 minutes ([VIZIO-TESTING.md](VIZIO-TESTING.md)). Setup and limits: [VIZIO.md](VIZIO.md).

### 10 November 2026: Roku (built; first real Roku TV ran the channel on 12 November)

couch-tv now has a Roku version. Roku channels are not web pages, so the home is drawn again as a native channel (the Night scenes with the clock in them, date and weather, the people switch, Keep watching and your apps), and the bridge talks to the Roku over its own network protocol and opens the channel every time the TV is switched on. It was built from Roku's documentation and tested against a test Roku and a BrightScript simulator. **Update, 13 November 2026:** it has now run on a real Roku TV (an Element, Roku OS 16, channel only). Roku OS 16 refuses a channel's own network calls to its TV, so with no computer at home the app row came up empty. The build now has `roku/build.py --apps-from <roku address>`, which copies the Roku's apps and icons into the channel (rebuild after installing new apps; a computer at home does not have this limit), the dock opens apps directly when the Roku says no, and `--install` takes `--password` for Windows (thanks mjiles, #152). The bridge path and the power on hook are still not seen on a real Roku, so if you have one, please open an issue saying how it went. Setup and limits: [ROKU.md](ROKU.md).

### 10 November 2026: Android 6 (checked on an emulator only, since 0.13)

Both TV apps now install on Android 6.0 (a Xiaomi Mi TV 4A with PatchWall, for example, [issue #59](https://github.com/Seagey/couch-tv/issues/59)). The 0.12 apps on the Releases page still need Android 7.1, so for now build them yourself ([Building the app](SETUP.md#building-the-app-instead-of-downloading-it)). Checked on an Android 6 emulator only, not a real TV. There both apps install and open, but that emulator's built in browser engine (Chrome 44, the oldest a TV can ship) lays the home out badly: the shelf stacks up instead of running across. A TV whose engine is newer may look right. The on-TV app (option C) cannot pair by Wi-Fi on Android 6 (that needs Android 11): set it up from a computer with USB or network debugging (port 5555), as the steps in [SETUP.md](SETUP.md) already do. If you try it, please open an issue saying what you see.

### 8 November 2026: A restart could loop some Google TVs

Fixed. A Sony Bravia Google TV owner found that after couch-tv went on, a restart left the TV going round: blank screen, restart, blank screen. couch-tv 0.10 and older switched off the Google TV home and the setup app, and on some Google TVs the TV cannot start without them. From 0.11 couch-tv never switches either off, the updated on-TV app and the bridge switch them back on by themselves where they have ADB, and if couch-tv itself keeps crashing the TV's own home takes over. **If you set couch-tv up with 0.10 or older, read [If your TV loops after a restart](TROUBLESHOOTING.md#if-your-tv-loops-after-a-restart) before you next restart your TV.** Sorry, and thank you to the person who reported it.

### 4 November 2026: Fire TV extras, from a fork

Thirty four people have forked couch-tv now. From [killy10o10](https://github.com/killy10o10/couch-tv), who runs it on a Fire TV Stick 4K (2nd gen):

- **Bluetooth and Network buttons** at the top right of the home. Fire OS's long-press Home menu has neither. On a Fire TV they open Amazon's own screens; any other TV gets Android's standard ones. They need the "lives on the TV" app (option C): on a Fire TV they are on by default, on other TVs switch them on in Home settings, quick buttons.
- **Amazon's own YouTube app** on Fire TV is now recognised, with its logo, so it sorts and opens like YouTube does everywhere else.
- **A Fire TV Stick guide**, written on the stick itself: [FIRE-TV-STICK.md](FIRE-TV-STICK.md).

And from [Justin1491](https://github.com/Justin1491/couch-tv): the bridge stops trying to reach a TV that has not been paired yet, instead of retrying in the background. The two buttons came in 0.5.

### 3 November 2026: Older Fire TV sticks (Fire OS 6)

Both TV apps now install on Android 7.1, so the Fire TV Stick 4K (1st gen) and other Fire OS 6 sticks can run them. Options A and B also take the Home key back on any Fire TV now, the way the "lives on the TV" app already did: `apply.sh` switches on a small Home button watch, and the undo switches it off. Checked on Android 7.1, 9 and 14 emulators with a stand-in for Amazon's home, not yet on a real Fire OS 6 stick: if you have one, please open an issue saying how it went. It came in 0.4.

### 1 November 2026: LG TVs

couch-tv now has an LG version, done the same way as the Samsung one: it goes on your LG as an app through LG's Developer Mode, and the computer at home opens it every time the TV is switched on. It was built from LG's own documentation and tested against a stand-in, so if you have an LG, you would be among the first to run it: give this repo to your agent, and please open an issue saying how it went. Setup and limits: [LG.md](LG.md). (It has since run on ten real LGs.)

## October 2026

### 30 October 2026: Fire TV sticks, older TVs, smart home and your own scenes

Sixteen people have forked couch-tv so far, and six of them built something worth having. The best of it is now in the main repo, credited to each of them. Download the new apps from [the Releases page](https://github.com/Seagey/couch-tv/releases) (or ask your agent to update).

- **Fire TV sticks and Fire TV Cube (Fire OS).** The "lives on the TV" app now takes the Home key back: Amazon's own home cannot be switched off, so the app sees it come up and puts couch-tv's home straight back on top. Amazon's home still flashes up for a moment first. It needs three one-off grants from a computer: [on-tv/README.md](../on-tv/README.md#fire-tv-fire-os). Confirmed on a Fire TV Stick 4K (2nd gen, Fire OS 8) by [killy10o10](https://github.com/Seagey/couch-tv/issues/3).
- **Older TVs no longer crash on open.** Both TV apps used a part of Android that only Android 11 and newer have. On Android 9 and 10 (most Fire TV sticks, and many older Android TVs) the home crashed as it opened. Fixed and checked on an Android 9 emulator: the old apps crash, the new ones open.
- **Keep watching with no computer.** With no bridge (option A), Keep watching now fills from Android's own Watch Next list: what each app says you are part way through, with its picture and how far in you are.
- **Smart home, if you want it.** If you run Home Assistant, the home can show your air conditioning (each room, warmer, cooler, on, off, mode), your scenes as tiles, and a doorbell card with the door camera over whatever is playing. It is off for everyone unless they set it up, and your agent asks first ([CONFIG.md](CONFIG.md), Smart home).
- **Design your own scene.** Put the glass clock over any photo: a landscape, your own holiday shot, anything. Optionally let the skyline sit in front of the clock, like the built-in scenes. [MAKE-A-SCENE.md](MAKE-A-SCENE.md).
- **Safer setup.** `apply.sh` now makes couch-tv the chosen home and checks the TV took it before it switches anything off (on some TVs the other order can leave Home on a crash-looping setup screen). The TV app also checks the settings it is handed more strictly.
- **A build on every change.** GitHub now builds both TV apps for every push and pull request, so a change that breaks the build shows straight away.

Thank you to [fifarsi](https://github.com/fifarsi/couch-tv) and [ishanboss20](https://github.com/ishanboss20/couch-tv) (the Android 9 crash), [gurpritsingh81](https://github.com/gurpritsingh81/couch-tv) (Watch Next), [herocode1](https://github.com/herocode1/couch-tv-hero) (the safety fixes and the install order), [dlandman27](https://github.com/dlandman27/couch-tv) (Fire TV) and [roliusz](https://github.com/roliusz/couch-tv) (the doorbell, Home Assistant and own scenes).

### 29 October 2026: Samsung TVs

couch-tv now works on Samsung TVs too. It was tested on a 2021 Samsung Frame. It is the same link and the same setup: give this repo to your agent and it offers the Samsung path when it finds a Samsung.

What is the same on a Samsung: the home (scenes, clock, weather, your apps in your order), the phone remote, and the Claude assistant. "Put on that show about the lawyer who never went to law school" finds Suits and plays it.

What is different on a Samsung:

- **You need a computer that stays on at home** (a Mac, a Linux box or a Raspberry Pi on the same Wi-Fi, [option B](../README.md#three-ways-to-run-it)). It opens couch-tv every time the TV is switched on, and it is what the phone remote and the assistant talk to. Without it you open couch-tv yourself from Samsung's app row, or Samsung's Autorun Last App setting reopens it when the TV comes on (reported on a Samsung Smart Monitor M8, [SAMSUNG.md](SAMSUNG.md)).
- **It is an app that opens itself, not a true home screen.** Samsung does not let any app replace its home. The TV remote's own Home button still opens Samsung's menu; Home on the phone remote brings couch-tv back.
- **Playing a show.** Netflix opens the show and starts it by itself. YouTube opens the video. Prime Video, Stan, Binge, Paramount+ and Apple TV are handed the title by the couch-tv app on the TV, the way Samsung's own guide does it; so far Prime has been seen opening, the title page itself is still to be confirmed. Disney+ and the rest open on their home page and you pick the show.
- **No reading the screen.** Samsung gives no screenshots and no "what is playing" to the network. So Play is pressed by timing, not by looking (only Netflix's timing is tested so far), and on a "Who's watching?" screen couch-tv takes the highlighted profile, usually the first, rather than yours by name.
- **You install the app yourself**, with a free tool and your own Samsung account sign-in, after turning on the TV's Developer Mode. A firmware update can turn Developer Mode off again; then you repeat one step.
- No picture mode switch and no ADB tools (those are Android only).

One bridge can run your Google TVs and your Samsung together, and the phone remote switches between them. Full guide, limits and undo: [SAMSUNG.md](SAMSUNG.md).

### 28 to 29 October 2026: Every TV

- "Put on X" now gets past "Who's watching?" on Android TVs: it presses your profile (you list your names per person, [CONFIG.md](CONFIG.md)) and then Play.
- The phone remote no longer opens to a white page when the phone has just woken up ([REMOTE.md](REMOTE.md)).
- The TV home works on older TV browsers too (the 2021 Frame showed no photos and two clocks).
