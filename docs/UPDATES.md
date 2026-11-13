# Updates

Everything that changed in couch-tv, newest first.

The newest release is **0.12** (9 November 2026). The TV apps come from [the Releases page](https://github.com/Seagey/couch-tv/releases), so anything marked "on main, in the next release" below is not in those apps yet: build them yourself ([Building the app](SETUP.md#building-the-app-instead-of-downloading-it)) if you want it now. The bridge, and with option B the home's own screen, run from your copy of this repo, so `git pull` brings their changes.

## November 2026

### 13 November 2026: Bell Streamer with Fibe TV as its home (Beta, on main, in the next release)

On a Bell Streamer (Bell Canada's Android TV 12 box) the home is Bell's Fibe TV app, so the Home key opened Fibe and never reached couch-tv. The Home button watch now knows Fibe's home screen and puts couch-tv back on top, and `apply.sh` switches the watch on when Fibe is installed. Fibe is never switched off. Opening Fibe from couch-tv's own tile works and is left alone while it stays in front. Untested on a real box so far (thanks Sparkybabcia, [#168](https://github.com/Seagey/couch-tv/issues/168)). What to expect: Fibe may flash up for a moment before couch-tv comes back, and a Fibe button on the remote will bring couch-tv back instead of Fibe, because the watch cannot tell it from a Home press.

### 13 November 2026: The home comes back to the tile you left (on main, in the next release)

After opening TV Settings or an app's settings, a TV that was short of memory could drop the home page and start it again at the first tile, because the page did not remember where you were. The home now saves the row and tile you were on when it goes into the background (and a moment after each move), and puts you back there for the next 20 minutes. Pressing Home still goes to the first tile. Reported on a Hisense Google TV with 1.8 GB of RAM (thanks IshMehta, [#166](https://github.com/Seagey/couch-tv/issues/166)).

### 13 November 2026: Privacy clean, Beta (on main)

`apply.sh` has a new opt in step, `PRIVACY=1`, that switches off known tracking, ad and ACR (automatic content recognition) apps it can find on your TV, reversibly: Samba TV on Sony, Alphonso, Xiaomi analytics and ads, Fire TV's ACR, ad ID and metrics apps, and Google's feedback and ad services apps. It goes through the same safety check as everything else `apply.sh` switches off, so the TV's home, setup, the remote (Bluetooth, voice, HDMI CEC) and Keep watching (the TV provider that holds Watch Next) are never touched, and `undo.sh` switches it all back on. `PRIVACY=1 DRY_RUN=1` shows what it would do first. It cannot remove every bit of tracking, so [PRIVACY.md](PRIVACY.md) also lists the menu switches to turn off on each brand, Samsung and LG included. Nothing changes unless you set it. The step runs on your computer, so `git pull` brings it.

### 13 November 2026: Fire OS 7 brings Couch TV back without the 5 second wait (on main, in the next release)

On a Fire TV Cube (3rd gen, Fire OS 7.7.1.7), Amazon's home stayed up for 5 seconds after a Home press, and a second press could bury Couch TV for good. Android 9 and older hold an app's start for 5 seconds after Home, so on Fire TV the home's own task is now moved to the front instead, and a press inside the 1.2 second gap is looked at again. Fire OS Settings screens still stay open, and other TVs and Android 10 and newer are unchanged. Thanks to atul016 (#162).

### 13 November 2026: The Next song button skips the track again (on main, in the next release)

On a Mi Box (Google TV), Next on the ambient music screen and on the Spotify card in Keep watching opened the gear menu (Home settings or TV settings) instead of skipping. The home's check for the remote's Settings key (key code 176) also matched the media Next key, which a browser engine reports with the same code. The home now tells them apart, in Kids mode too. Thanks NathanGlasby (#158).

### 13 November 2026: Your own scenes can move (on main, in the next release)

A scene in `home.my_scenes` can play a short looping clip behind its cut-out and the glass clock: add `"video": true` and put the clip at `backgrounds/mine/scene-<id>.mp4`. It is off unless you set it. Only the scene on screen plays, and it stops for an app, the ambient clock, screen off, Lighter home, the OLED and Classic looks, and the system's reduced motion setting; the photo stays if the clip cannot play. With option A the clip goes inside the app, so build it again (the built-in copy now serves `.mp4` as video). [MAKE-A-SCENE.md](MAKE-A-SCENE.md) step 7 explains making and looping one. Thanks digitaldarkmatterltd (#155).

### 13 November 2026: Home settings lists stay put on older Samsungs (on main, in the next release)

On a 2020 Samsung (Tizen 5.5), moving down a long Home settings list such as Apps flashed the list up to the top and back on every press. The list now keeps its place and only the step to the next row scrolls. Thanks vicenteveltri (#156).

### 13 November 2026: Nuvio in Keep watching (on main, the on-TV app in the next release)

Shows played in Nuvio, the Stremio-style player, now show as playing and count for Keep watching, with the bridge and in the on-TV app. A film played in Nuvio is no longer logged as the film "2012" or "1917": Nuvio sends the release year where other apps send the episode. With the bridge, a Nuvio card opens the show's page in Nuvio (by its IMDb id from JustWatch), where you pick the episode: Nuvio takes no episode links. In the on-TV app a Nuvio card opens Nuvio. With the bridge only Nuvio's GitHub build (`com.nuvio.tv`) is read, not the Play Store one (`com.nuvio.app`). Shows played in Nuvio can't reach Keep watching with option A, because Nuvio adds them to its own channel, not Android's Watch Next list. Thanks NathanGlasby (#157).

### 13 November 2026: Hebrew and right to left layout on the TV home (on main, in the next release)

The home now speaks Hebrew (עברית), including the TV's own `he` or older `iw` language setting. The layout mirrors for right to left: the settings list moves to the right, chevrons flip, popups open on the correct side, and the remote's left and right buttons move the way the screen reads. English and the other languages are unchanged. Thanks YuvalHir (#153).

### 13 November 2026: Ask on the TV with more AI services (on main, in the next release)

On-TV mode's Ask is no longer Claude only: the setup page has a service picker for Claude, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, another service that copies OpenAI's API, or a model on a computer at home (Ollama, LM Studio, llama.cpp). Claude Haiku 5.5 stays the default and an existing Claude key keeps working. A key only ever goes to the address it was saved for, `GET /api/settings` never returns it, plain http is allowed only on your home network, and Ask stays off for a kids profile. Ask is now told which apps the TV has, so it stops trying apps you do not have, and says what went wrong instead of a bare "Done.". See [ASK-PROVIDERS.md](ASK-PROVIDERS.md). Thanks iarhamanwaar (#140).

### 13 November 2026: Xiaomi TVs, Couch TV in PatchWall's place, and a lighter home page on 1 GB TVs (on main, in the next release)

In the on-TV app on a Xiaomi or Redmi TV, a setup page switch (off by default, Xiaomi only) makes the remote's PatchWall button, PatchWall's tile and power on open Couch TV, but never over an HDMI or TV input wake. The Home button is not changed. On low memory TVs the home page is now released only when Android says memory is critical, and comes back when the app does. See [on-tv/README.md](../on-tv/README.md). Thanks gauharjk (#151).

### 13 November 2026: An Open the home button on the on-TV setup screen (on main, in the next release)

On Google TV the Couch TV tile opens setup and Google's home keeps the Home button, so option C had no way to see the couch-tv home. Setup now starts with **Open the home**, which opens it and appears only when the Home button doesn't already open Couch TV, and the note under Use as home screen says how Google TV behaves. The Couch TV home watch accessibility service is for Fire TV only and switches itself off on other TVs, which is expected. The button opens the home, which applies Kids mode itself.

### 13 November 2026: VIDAA fixes from a Hisense 43A6N (on main)

A VIDAA trace now hides the refresh token as well as the access token. With `keep_home` on, the phone remote's Input key no longer has couch-tv jump back over VIDAA's source picker. Pairing now keeps the token a TV sends on its `tokenissuance` answer instead of saying there was none. A new opt in `"pointer": true` lets the page take clicks from the TV Browser's mouse cursor. Thanks Schielef (#145), whose 43A6N is now on the compatibility list.

### 13 November 2026: check-tv warns about Fire OS builds that block the TV's own ADB (on main, in the next release)

`scripts/check-tv.py <tv address> --adb` reads the Fire OS version and says whether this build blocks option C's phone remote from pressing keys and typing, may still allow it, or could not be read, and points to option B each time. Other Android TVs are unchanged. Not run on a real Fire TV yet. Thanks googlarz (#149).

### 13 November 2026: The Screensaver button on Philips and similar TVs (on main, in the next release)

On a Philips 43PUS8546/12 the TV home came back to the front half a second after the button cut the screen timeout and put it straight back, so the TV never napped and the button said "The TV did not start the photos". A return that soon is now ignored (the screensaver ending, the 25 second deadline and a restart still put the timeout back, so a TV is never left on five seconds). The button also keeps its name under the Night look, has an accessible name, and says in Home settings that it starts the photo screensaver and is not the day and night switch. Thanks digitaldarkmatterltd (#146).

### 13 November 2026: LG Developer Mode extend, five app logos and a Dutch home (on main, in the next release)

On an LG with no bridge, the home now asks once a week "Extend Developer Mode?" and stays on screen until answered, so LG does not remove couch-tv when the session runs out. There is an `extend` quick button (off until you add it) and a Dev mode tile in the dock that opens LG's own Developer Mode app. VTM GO, VRT MAX, Stremio, Amazon Alexa and YouTube Cobalt AdFree get their logos, and the TV home speaks Dutch (`nl`, Belgium). See [LG.md](LG.md). Thanks JensDevold (#142).

### 13 November 2026: A Hisense VIDAA home with no computer, and Spotify on the Now playing card (on main)

A VIDAA TV can now run couch-tv's home as a small website the Couch TV tile opens, so the clock, scenes or your photos, weather and Home settings keep working with the computer off (`scripts/build-standalone.sh`, [VIDAA.md](VIDAA.md), "No computer: a standalone home"). On Vercel it also shows what's playing on your Spotify account, with a Play on TV button that moves the music to the TV. With the bridge, a new optional Spotify login fills the Now playing card when the TV itself shows nothing (a VIDAA, LG, Samsung or Roku, or music on a phone). Both stay off until you set them up. VIDAA also gets a `tile_id` setting for moving the tile to a new address. Thanks Matthew-Klette (#141).

### 13 November 2026: Smaller fixes (on main, in the next release)

The home's quick buttons for Bluetooth and Network now open the TV's settings straight from the launcher, and the sleep timer button no longer says it needs the computer when the launcher can do it itself. The doorbell card also shows on Android 6 and 7 (Fire OS 6), and a failed app launch no longer crashes the launcher. Thanks ekagra-codes (#137). The LG page and the bridge on Windows are better covered (a time zone package, the firewall, starting at logon, and two minutes to press Accept), thanks BlueSpark911 (#136).

### 13 November 2026: Smart Idle, optional (on main, in the next release)

Off unless you switch it on in Home settings, under Look. After a wait on the home screen (5 minutes to an hour) it shows a dim, pure black clock that drifts a few pixels so nothing burns in, or turns the screen or the TV off. It can also turn the TV off after paused playback (Android TV and Roku; never an HDMI input or a game), with a "TV auto-off" warning and an "I'm still here" button on the phone remote for the last five minutes. Optional quiet hours shorten the wait overnight. See [CONFIG.md](CONFIG.md), `smart_idle`. Thanks ekagra-codes (#132).

### 13 November 2026: Hisense VIDAA, working on a real TV (Beta, on main, in the next release)

Matthew Klette (#128) got couch-tv running on a real Hisense 55U7N (VIDAA 9): login, pairing, the phone remote, opening apps and a native Couch TV tile all work. New `keep_home` option (off by default) brings couch-tv back when the TV falls to VIDAA's home. Setup: [VIDAA.md](VIDAA.md). Thanks Matthew.

### 13 November 2026: Quick Home presses on a Xiaomi TV (on main, in the next release)

On a Xiaomi TV the Home button watch now also catches the Home key and the Mi logo key as they are pressed, so pressing them quickly several times no longer leaves Google's home on screen (issue #54). Other TVs are not touched. Thanks AryanFelix (#135).

### 13 November 2026: Philips Titan OS, first read only look at a real TV (on main, in the next release)

A 43PUS8909/12 answered the check: its remote API, its network announcement and a browser activity are real. Pairing, keys, volume, apps and the home have not run on it yet, so Titan OS stays Beta, phone remote only. Also better: connections are reused, a TV that does not answer now says why, and the serial number is hidden in what the check prints. `scripts/find-tvs.py` lists a Philips TV and `scripts/philips-setup.py <address>` goes from address to a config entry. See [PHILIPS-TITAN.md](PHILIPS-TITAN.md). Thanks googlarz (#144).

### 12 November 2026: Kids mode, New and optional (on main, in the next release)

Off unless you switch it on for someone. A kids profile's home shows only a shelf of shows a parent picked, as big posters that open straight into each show, plus the few apps you allow. No other apps, no settings, no grown ups' Keep watching. Leaving it needs the parent PIN, typed with the remote's arrows. Now in the Apple TV app (Couch TV) too. See [Kids mode](../README.md#kids-mode). Idea from Natalie Bruss (@nataliebruss on Instagram).

### 12 November 2026: Philips, Panasonic and Fire TV on Vega OS, Beta

Four more paths, each with a computer at home that stays on, and on each the maker's own Home button still opens the maker's home:
- **Philips with Titan OS:** the phone remote (power, keys, volume, inputs, apps; one real TV has answered the read only check, pairing is still to be tried). couch-tv's home needs a Titan app, from Titan's store or its DevView developer app, which is not there yet ([PHILIPS-TITAN.md](PHILIPS-TITAN.md)).
- **Older Philips with Saphi:** the phone remote, and couch-tv's page in the TV's browser where the set offers one ([PHILIPS-SAPHI.md](PHILIPS-SAPHI.md)).
- **Panasonic Viera (My Home Screen):** the phone remote, and couch-tv's page opens itself in the TV's browser ([PANASONIC.md](PANASONIC.md)).
- **Fire TV on Vega OS:** an app you build once with Amazon's free tools, opened by the bridge ([FIRE-VEGA.md](FIRE-VEGA.md)).

If you have one of these TVs, each has a short read only first test, and an issue saying how it went helps everyone after you.

### 12 November 2026: VIZIO, New (Beta)

couch-tv can now drive a VIZIO on SmartCast or VIZIO OS from the phone remote: power, volume, inputs and opening apps, with a computer at home. couch-tv's own home page does not open on a VIZIO by itself (no browser, no sideloading, and VIZIO's app programme is closed to outsiders). It is new and has not been on a real VIZIO yet: if you have one, the first test only reads and takes about 15 minutes ([VIZIO-TESTING.md](VIZIO-TESTING.md)). Setup and limits: [VIZIO.md](VIZIO.md).

### 10 November 2026: Roku (built; first real Roku TV ran the channel on 12 November)

couch-tv now has a Roku version. Roku channels are not web pages, so the home is drawn again as a native channel (the Night scenes with the clock in them, date and weather, the people switch, Keep watching and your apps), and the bridge talks to the Roku over its own network protocol and opens the channel every time the TV is switched on. It was built from Roku's documentation and tested against a test Roku and a BrightScript simulator. **Update, 13 November 2026:** it has now run on a real Roku TV (an Element, Roku OS 16, channel only). Roku OS 16 refuses a channel's own network calls to its TV, so with no computer at home the app row came up empty. The build now has `roku/build.py --apps-from <roku address>`, which copies the Roku's apps and icons into the channel (rebuild after installing new apps; a computer at home does not have this limit), the dock opens apps directly when the Roku says no, and `--install` takes `--password` for Windows (thanks mjiles, #152). The bridge path and the power on hook are still not seen on a real Roku, so if you have one, please open an issue saying how it went. Setup and limits: [ROKU.md](ROKU.md).

### 10 November 2026: Android 6 (experimental, on main, in the next release)

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
