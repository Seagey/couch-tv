## couch-tv 0.13.3: easier for beginners, guests greeted by name with no computer, and your home into couch-tv Studio

We set couch-tv up from scratch on two real Google TVs (a Toshiba and a TCL, both Android 11) the way a beginner would, with just a phone and then with a computer. This release fixes what got in the way. If you have not turned on couch-tv Studio, the classic home looks exactly as it did (checked pixel for pixel against 0.13.2).

### Do this after updating

- **Update the TV apps:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release, so they install over 0.13.2 and keep your settings.
- **Option B:** `git pull` and restart the bridge (for the guest's name from the phone).
- **Did you switch on "Couch TV home watch" in 0.13.2 or earlier?** Then install `couch-tv-ontv-watch.apk` from a computer, not the plain `couch-tv-ontv.apk`. That is every Fire TV, and also a TCL, a Haier, another Google TV or a Xiaomi PatchWall TV where the watch held the Home button. The watch is what makes the Home button open couch-tv. The plain APK no longer has it, so on those TVs the Home button would go back to the TV's own home without a word. After installing, switch **Couch TV home watch** on again in the TV's Settings, Accessibility if it is off. Everyone else uses the plain `couch-tv-ontv.apk`, which installs without the Play Protect block.

### Guests by name, with just a phone

- **Type the guest's name** on the TV (Home settings, couch-tv Studio, At home, Guests, Guest's name) or on the phone remote (More, Guest's name). The Welcome widget says "Welcome, Sarah". Leave it empty and it says just "Welcome".
- **A real TV never shows Studio's sample words** ("Welcome, Ella and friends", the sample house and "Night two of five"). They stay as the example in couch-tv Studio only.
- **The bookings calendar works on the phone only app.** The on-TV app now reads your Airbnb, Booking.com or VRBO calendar link itself (only https, only addresses on the internet, never anything in your house). Before, it said "Got it" and "did not answer" at the same time and never greeted anyone.
- **Long links from the phone.** Type on the TV in the phone remote now types into the TV's box even with no extra setup on the phone only app, and the phone remote can send the bookings link straight to the TV.

### Settings you can always find

- **Every design has a Settings button** at the top right. The remote reaches it with Up or Right at the edge of the screen, and OK opens Home settings.
- The home says, each time it opens until you have used it: hold OK, or press OK on the gear, for apps and settings. **The remote's own Settings button opens the TV's menu**, and now the home says so.
- **Hold OK** starts with Settings, so it never lands on a widget's own page (a clock's timers) by mistake.

### The phone only install

- **Aimed at the Google Play Protect block.** On a TCL Google TV, Play Protect said "App blocked to protect your device" because the app asked for the accessibility permission. The main app, `couch-tv-ontv.apk` (the one the Downloader code installs), no longer asks for it, so that is no longer what Play Protect sees. We have not yet tried it on a real TV, so Play Protect may still say something. The home watch moved to `couch-tv-ontv-watch.apk`, installed from a computer (see the top).
- **The Couch TV screen is plain words:** a QR code to scan with your phone (the address is under it too), "Your phone is paired" straight after pairing, and the extra tools (keys and typing from the phone, developer settings) under More. On Google TV it says plainly that the Home button stays Google's, and to open your home from Couch TV in the apps row. The button that wrapped one letter per line is fixed.
- **A couch-tv icon and banner** for both TV apps, so you can find Couch TV in the apps row.

### The Setup app (Mac and Windows)

- **No more "Something went wrong: OSError".** If your Mac has not let the app find devices at home, it says exactly where to switch it on (System Settings, Privacy and Security, Local Network). Windows gets its firewall steps.
- **Google TV on Android 11** (many 2021 and 2022 Hisense, Toshiba and TCL TVs) has no Wireless debugging: the app now offers "only USB debugging" (over Wi-Fi, no cable).
- **If the TV never asks "Allow USB debugging?"**, the app walks you through the fixes one at a time, each with Try again, and then the phone only way. It never stops at a dead end.
- **The Setup app is on this release:** `couch-tv-Setup-mac-apple-silicon.zip` (and the Intel Mac and Windows zips, which GitHub builds when the release is published).

### Weather, apps and photos

- **No made up town.** With no place set, the weather asks for your town (the tiles say "Set your town for the weather" and the classic home says where to pick one) instead of showing Sydney.
- **No false "Not on this TV".** The "Use this design?" preview no longer marks every app as missing before the TV has listed its apps.
- **Photo tiles stay readable:** an empty photo tile has a dark panel under its words, and captions sit on a stronger shade on any photo.
- **Screen time** says what it needs on the phone only app (the couch-tv home app, put on once from a computer), instead of "needs a newer couch-tv TV home".

### Open this home in couch-tv Studio

Already use couch-tv from GitHub and want to design on the new platform? You do not have to start again.

1. On the TV, open **Home settings**, then **couch-tv Studio**. couch-tv Studio does not need to be on for this.
2. Choose **Open this home in couch-tv Studio** (it was called Share this home). The TV shows a QR code and a 10 letter code.
3. Scan the QR code with your phone, or open couch-tv Studio and type the code under **Already use couch-tv from GitHub?**
4. Your home opens as a design: the same apps in the same order, the same scenes, clock, glass and dock. Change it, keep it in My designs, and send it back to the TV.

- It brings the Night dock's style (classic or Mac-style) and Moving tiles as well.
- The TV says on screen what stays on it: people's names, photos, places, smart home keys, AI keys and calendar links. A calendar file name (`.ics`) anywhere in the home stops the share too, like a link, a name, a place or a token already did.
- A TV older than 0.13: open couch-tv Studio on the computer that set the TV up and press **Open my config.json**, then pick `config.json` in your couch-tv folder. Your people, weather place, TVs, the computer at home, Home Assistant and Plex sections are left out on purpose. Never pick `.env`: it only holds keys, and couch-tv Studio never needs it.

### Taking couch-tv off

- `remove-all.sh` takes `EXTRA_APPS="<package>"` for a home app of your own from before couch-tv, removed in the same step. It refuses anything that looks like part of the TV itself.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C, the phone only download), `couch-tv-ontv-watch.apk` (option C with the home watch, for anyone who had it on: Fire TV, TCL, Haier, other Google TVs, Xiaomi PatchWall, from a computer), `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), `couch-tv-Setup-mac-apple-silicon.zip`, with `SHA256SUMS.txt`.
