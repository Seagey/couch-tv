## Couch TV 0.13.12: Couch TV Studio knows your TV has Couch TV, and a steadier Now playing card

When you get a design by code on an Android TV, the TV now tells Couch TV Studio which Couch TV version it has and how much memory, so Studio's "Will it play on your TV?" can say "I have Couch TV". And the Now playing card from 0.13.11 gets a round of fixes.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.12 carries the same key as 0.13.11, so a TV on 0.13.11 or 0.13.10 updates as normal. On Android 9 and newer, a TV on 0.13.9 or older takes 0.13.10 first, as the 0.13.11 notes say.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **The TVs a computer at home runs without Android:** nothing to do on the TV. The computer hands out the new home after `git pull` and a restart.

### The TV tells Couch TV Studio it has Couch TV

- **Getting a design by code** on the Couch TV home app or the on-TV app now sends two more things with the code: the Couch TV version (like 0.13.12) and the TV's memory in MB. Nothing else: no ids, no model, no place.
- Couch TV Studio uses them for "Will it play on your TV?" on a TV in My TVs. An older store ignores them.
- docs/PRIVACY.md and docs/CONFIG.md say the same.

### Credits for the weather and places

- **The forecast, air quality and surf** a weather widget opens now say "Weather data by Open-Meteo.com" in a quiet line at the bottom, as Open-Meteo's licence (CC BY 4.0) asks.
- **Home settings, Location** says "Location data based on GeoNames": the town search is Open-Meteo's, built on GeoNames.
- In all 16 languages. The README's credits and docs/PRIVACY.md name both.

### Now playing: every music app, and Spotify fixes

- **Since 0.13.11 the Now playing card's new look reaches every music app, not only Spotify:** the wider card in the Night look, the progress bar with the time, and long titles that scroll. The 0.13.11 notes only spoke of Spotify.
- **App name, Long titles and Card alignment now sit under Now playing** in Home settings, Look, on every home. In 0.13.11 they showed only after switching Spotify on, though they shape every app's card.
- **Spotify's card follows at once.** The TV home app now changes the card the moment the song, play or pause changes, instead of up to 5 seconds later.
- **Nothing goes to Spotify.** A cover the Spotify app gives only as a link is no longer loaded, so the card truly sends nothing to Spotify. Such a song shows the music note instead.
- **The Spotify rows show only where the card works:** the Couch TV home app on an Android TV, with or without a computer at home. Not in a browser, on the on-TV app or on a TV a computer runs without Android.
- **No adb line when a computer is at home.** "Notification access required" shows the adb command only on a TV with no computer at home, because the computer gives the access when it sets up the TV.
- **Skip step:** 5, 10, 15 or 30 seconds everywhere, in config.json as in Home settings. Any other number is 10.
- **Fixes for people who run a computer at home:** `/api/spotify/control` answers 400 for an action it does not know or that is not text, and 503 when the TV cannot be reached, instead of a 500 for each.
- **Fixes in the TV home app:** the Spotify listener no longer keeps a closed home screen in memory, and Android lists it as "Couch TV Spotify Now playing".

### Fixes from a beginner run of the TV install

- **The "Allow USB debugging?" box no longer comes back again and again** on the on-TV app, after Update to or a restart. A background check now waits long enough for you to press Allow, and if nobody answers it does not ask again until you press Connect in Couch TV's Settings, Phone remote, Set it up.
- **The on-TV app says the box's own name**, "Allow USB debugging?", and how to reach its Allow button: tick Always allow, then Down, Left, press Allow.
- **The Settings menu on the home has Phone remote** on the on-TV app, with the code to scan, as the steps on couchtv.joshuaseage.com/get say. Back takes you home again.
- **Hold OK on a design:** the menu is solid, so a big clock no longer shows through it, its title and hint fit on the screen, and an app folder lists All apps once, with no Open Apps beside it.

### couch-tv Setup on every release

- **0.13.11 went out without the couch-tv Setup zips** for a while, because GitHub never found a Mac to build one of them on. They are on 0.13.11 now, and 0.13.12 has its own.
- For people who build their own releases: `scripts/release.sh publish` now ends by waiting for the Setup app workflow, runs its failed jobs again if GitHub gave up on one, and stops with exit 7 if the three zips and `SHA256SUMS-setup.txt` are not on the release. `scripts/release.sh setup --version 0.13.12` runs that check on its own, and the workflow checks the four files itself.
