# Instructions for the AI agent setting this up

You are helping someone put couch-tv on their TV. Assume they are not technical. Your job has four
parts, in this order, and you never skip ahead:

1. **Find the TV** and check it can run couch-tv.
2. **Ask the questions** below, one or two at a time, in plain words. Wait for each answer.
3. **Read the plan back** to them and wait for a clear yes.
4. **Set it up**, check it works, and show them how to undo it.

Nothing on the TV changes before step 3 is a yes: no pairing, no "Allow USB debugging?" prompt,
nothing installed, nothing switched off. Never ask for streaming passwords: they sign in to
Netflix and the rest themselves, on the TV.

**Allowed before the yes** (they change nothing on the TV and install nothing outside the repo
folder): checking versions, creating the Python virtual environment inside the repo folder
(`.venv`) with the packages in `bridge/requirements.txt`, `scripts/find-tvs.py`, and
`scripts/check-tv.py <tv address>` **without** `--adb`. Tell them you are doing it ("I'm setting up
a small private Python folder inside couch-tv to look for your TV. It changes nothing on the TV.").
Everything else waits for the yes, including `check-tv.py --adb` (it makes the TV ask "Allow USB
debugging?" and saves a key in `~/.android/adbkey`), Homebrew or system packages, Node, the JDK
and the Android SDK.

**No computer or a failed home step (issue #98).** If couch-tv installed as an app but is not the
home (the person came without a computer, or `apply.sh` could not run), on a plain Android TV 10 or
newer the app asks Android itself: it offers "Make couch-tv your home screen?" the first time it
opens, and Home settings, About repeats it. The on-TV app does the same from **Use as home screen**.
On Google TV that does not hold the Home key: run `apply.sh` from a computer for the Home button
watch. Never switch off or uninstall the TV's own home to make this work.

The steps in docs/SETUP.md are numbered 1 to 6. Option A uses steps 1, 2 and 6. Option B uses steps 1 to
6. Option C follows [on-tv/README.md](on-tv/README.md) (the app `dev.couchtv.ontv`).

## 0. Before you start (quietly)

1. Run `python3 --version`. It must be **3.11 or newer**. If it is missing or older, it is needed
   even to look for the TV, so ask now, in plain words, before you install it: macOS `brew install python@3.11` (or the installer from
   python.org); Linux the distribution's package, for example `sudo apt install python3.11
   python3.11-venv`. Debian ships Python without venv: if `python3 -m venv .venv` fails, install
   `python3-venv` or use `uv venv --seed .venv` instead. On a Mac the first `python3` or `git` may pop up "install the command line
   developer tools": tell them to press Install and wait a few minutes. That is normal.
2. **Get the TV apps from the Releases page first.** Download `couch-tv-home.apk` (options A
   and B) and `couch-tv-ontv.apk` (option C) from
   [the GitHub Releases page](https://github.com/Seagey/couch-tv/releases) into `dist/` (git
   ignores it), for example `curl -fL -o dist/couch-tv-home.apk
   https://github.com/Seagey/couch-tv/releases/latest/download/couch-tv-home.apk`. Only if that
   fails (no release, no network to GitHub) build them with `scripts/build-apk.sh` (docs/SETUP.md,
   "Building the app"). An Android 6 TV also needs a build: the 0.12 apps need Android 7.1, and
   Android 6 support is on main for the next release.
3. Note what else the computer has: macOS or Linux, and Node 20.19+ or 22.12+ (option B, and a build of the
   option C app). A build also needs JDK 21 and the Android SDK (platform 34), installed only
   after the yes (step 3). If a JDK is needed, do **not** use `brew install --cask temurin@21` or `sudo`: they ask for a password the agent
   cannot type. Download the Temurin 21 `.tar.gz` from Adoptium
   (`https://api.adoptium.net/v3/binary/latest/21/ga/<mac or linux>/<aarch64 or x64>/jdk/hotspot/normal/eclipse`)
   into `build/jdk` inside the repo (git ignores `build/`), unpack it there and set `JAVA_HOME`
   to it (on macOS the `Contents/Home` folder inside). The Android SDK command line tools unpack
   into a folder the same way, no password needed.
4. Windows is not supported for the bridge (option B); it can still install the app if Python is
   there.
5. **Mac: Local Network permission.** macOS asks once per program before it may talk to devices
   at home ("allow ... to find devices on your local network"). Tell them to say **Allow** for
   Terminal or for the app you run in. A program new to the Mac, such as Google's `adb` just
   downloaded, can be blocked without any prompt, and then cannot reach the TV although Python
   can. So use the repo's pure-Python tools for everything (`tv-home/tools/tvadb.py`,
   `on-tv/scripts/real-tv.py`, `scripts/check-tv.py`): they run inside the Python that is already
   allowed. Use Google's `adb` only for the one-off Wireless debugging pairing, and if it cannot
   reach the TV, ask them to switch on that app under System Settings, Privacy and Security, Local
   Network.

## 1. Find the TV

Ask: "Is the TV switched on and on the same Wi-Fi as this computer?" Then run:

```sh
python3 -m venv .venv && .venv/bin/pip install -r bridge/requirements.txt
.venv/bin/python scripts/find-tvs.py
```

It only listens, it changes nothing. On a Mac the first run may ask to find devices on the local
network: they say Allow. Read the list back by name ("I can see Living Room TV and Bedroom TV,
which one?"). If they have more than one TV, ask which ones they want. Each TV is set up on its
own. A line marked "Cast device" could be a speaker, a Chromecast or a Fire TV, not necessarily a
TV. Then test the one they picked:

```sh
.venv/bin/python scripts/check-tv.py <tv address>
```

It says which options (A, B, C) that TV can run, and whether it has Network debugging (fixed port
5555) or only Wireless debugging. Use its answer, not a guess from the brand. Do not use `--adb`
yet: that comes in step 4, after Developer options are on, and that is when you settle B or C.

If nothing Android is found, or they are not sure what they have:
- `find-tvs.py` lists an LG as "LG TV". It says "No Android TV found" for a Samsung or another
  brand, and that is expected.
  Ask the brand and model. To confirm with `check-tv.py`, ask for the TV's address:
  - **Samsung:** Settings, General (or Connection), Network, Network Status (or Network
    Information), the IP address.
  - **LG:** Settings, Network (or All Settings, General, Network), Wi-Fi Connection, the connected
    network, Advanced Wi-Fi Settings, the IP address.
  - **Roku:** Settings, Network, About (the IP address). `find-tvs.py` does not list a Roku, but
    `check-tv.py <address>` recognises one by its port 8060.
  - **Hisense VIDAA:** the IP address in the TV's network settings. `find-tvs.py` does not list one,
    but `check-tv.py <address>` recognises it by its port 36669 (36668 on older builds).
  - **Philips on Titan OS:** Settings, Network (or Wireless and networks), Network status. `find-tvs.py`
    lists one it hears announcing its network remote (as "Philips TV"; seen on one real TV), and `check-tv.py <address>` recognises it by its port 1926 when it is not Android.
  - **Older Philips with Saphi:** Settings, Wireless and networks (or Network), View network settings.
    `check-tv.py <address>` recognises it by plain port 1925 alone, and says whether it lists a browser.
  - **VIZIO:** Menu (or Settings), Network, Network information, the IP address. `find-tvs.py` may list
    it only as a Cast device, but `check-tv.py <address>` recognises it by its SmartCast answer on port
    7345 (9000 on older firmware).
  - **Panasonic Viera (My Home Screen or older):** Menu, Network, Network Status (the IP address).
    `find-tvs.py` does not list one, but `check-tv.py <address>` recognises it by its port 55000.
  - **Google TV or Android TV:** Settings, Network and Internet, the Wi-Fi network.
- Ask them to open **Settings, Device Preferences, About** (older Android TV) or **Settings,
  System, About** (Google TV) and read you the model and the "Android TV OS" line. Until you know
  which they have, give both. No such line usually means it is not Android.
- Common reasons a Google TV is not found: TV asleep, TV or computer on a guest Wi-Fi, the router
  keeps devices apart ("client isolation"), or macOS's Local Network permission was refused
  (System Settings, Privacy and Security, Local Network). Phone, TV and computer must all be on the
  same network.

Check the answer against [docs/TV-COMPATIBILITY.md](docs/TV-COMPATIBILITY.md):
- **Google TV or Android TV** (Sony, TCL, Hisense Google TV, Philips, Xiaomi, Chromecast with
  Google TV, Google TV Streamer, Nvidia Shield, Onn): supported.
- **Fire TV on Fire OS** (Fire OS 6, 7 or 8: Stick 4K 1st gen and newer, Stick 4K Max, Cube): partly.
  Fire OS 6 (Android 7.1) needs a release newer than 0.3, and port 5555 network debugging. Say what will not work before going on: Amazon's
  home still flashes up before couch-tv's comes back, and the on-TV app needs three one-off ADB grants
  (on-tv/README.md, "Fire TV (Fire OS)"). On current Fire OS (6.7.1.1, 7.6.6.9, 8.1.0.3 and newer), option C's
  phone remote cannot press keys or type, because Fire OS blocks an app from using the TV's own
  ADB; option B can, so if they want the full phone remote on a Fire TV, recommend B.
- **Samsung (Tizen):** do not say no. Offer the Samsung path in
  [docs/SAMSUNG.md](docs/SAMSUNG.md), with its honest limits, in plain words: "couch-tv goes on
  your Samsung as an app, and a computer at home that stays on opens it every time the TV is
  switched on. It is not a true home screen: the remote's Home button still opens Samsung's menu.
  The phone remote works. Netflix plays the show by itself and YouTube opens the video; Prime,
  Stan, Binge, Paramount+ and Apple TV are handed the show, and the others open on their own page.
  On a 'who's watching' screen it picks the first profile, not yours by name.
  There is no 'what is playing' and no screenshots. You will sign in to your own Samsung account
  once on this computer, and press Allow on the TV once." Without a computer that stays on, only
  the app itself is possible (opened from Samsung's app row). Also offer the Google TV box as the
  way to get everything. If they choose Samsung, follow docs/SAMSUNG.md for steps 2 to 4 (most
  questions in step 2 still apply; skip picture mode, apply.sh and ADB).
- **LG (webOS):** do not say no. Offer the LG path in [docs/LG.md](docs/LG.md) the way you offer
  the Samsung one, and say first, plainly, how little it has been tried: "There is an LG version
  of couch-tv. It was built from LG's own documentation and has run on eleven real LGs so far (from
  a 2018/2019 model on webOS 4.10 to a 2025 OLED on webOS 11.2), so on other LG models some of it may still need fixing. Like the Samsung one, it goes on your LG as an app, and a computer at home that
  stays on opens it every time the TV is switched on. It is not a true home screen: the remote's
  Home button still opens LG's menu. It needs LG's Developer Mode, which means a free LG developer
  account and LG's tools on this computer, and Developer Mode has to stay on, so the computer
  presses its Extend button once a day for you. The phone remote works. Netflix opens the show and
  YouTube the video; other apps open on their own page, and you press Play. There is no 'what is
  playing' and no screenshots. You press Accept on the TV once." Without a computer that stays on,
  only the app itself is possible, and LG removes it when Developer Mode runs out. Also offer the
  Google TV box as the way to get everything. If they choose LG, follow docs/LG.md for steps 2 to
  4 (most questions in step 2 still apply; skip picture mode, apply.sh and ADB). Afterwards ask
  them to open an issue on GitHub saying how it went, and write down for them what worked and what
  did not.
- **Roku (TV or box):** do not say no. Offer the Roku path in [docs/ROKU.md](docs/ROKU.md) the way you offer
  the LG one, and say first, and plainly, how little it has been tried: "There is a Roku version of
  couch-tv. It was built from Roku's own documentation and tested against a pretend Roku on a computer and
  a BrightScript simulator, and it has **not been run on a real Roku yet**, so you may be the first and
  something may need fixing. Roku channels are not web pages, so the home is drawn again as a channel: the
  scenes with the clock in them, the date and weather, your people, Keep watching and your apps. Like the
  Samsung and LG ones it goes on as an app, and a computer at home that stays on opens it every time the TV
  is switched on. It is not a true home screen: the remote's Home button still opens Roku's home. It needs
  Roku's Developer Mode (a password you make up on the Roku, no account), and newer Roku OS also limits
  remote control until Settings, System, Advanced system settings, Control by mobile apps, Network
  access is set to Permissive or Enabled. The phone remote works. Netflix opens the show and YouTube the
  video (the deep links are untested); other apps open on their own page, and you press Play. There is no
  'what is playing' title and no screenshots. A Roku holds one sideloaded channel, so installing another
  replaces couch-tv." Without a computer that stays on, only the channel itself is possible: it shows the
  clock, the date and the Roku's own apps. Also offer the Google TV box as the way to get everything. If
  they choose Roku, follow docs/ROKU.md for steps 2 to 4 (most questions in step 2 still apply; skip
  picture mode, apply.sh, ADB and the quick buttons). The ids and deep links in its table are unverified:
  if one does not open, find the Roku's real id with `query/apps` and say what you found. Afterwards ask
  them to open an issue on GitHub saying how it went, and write down for them what worked and what did not.
- **Beta paths: Hisense VIDAA, Philips (Titan OS and Saphi), Fire TV on Vega OS, VIZIO, Panasonic.** Each
  is a supported path, marked Beta. Do not say no. What they share, and what you say plainly every time:
  they need **a computer at home that stays on** (without one, nothing on these paths works), and **the
  maker's own Home button still opens the maker's own home**; couch-tv opens itself on top, it does not
  replace that home. None of them has run on a real TV yet, so ask them to open an issue on GitHub
  afterwards with what the read only check printed, and write down for them what worked and what did not.
  Also offer the Google TV box as the way to get everything. The checks below only read, but they still
  wait for the yes in step 3, and anything that shows a PIN or opens a page on the TV waits for it too.
- **Hisense VIDAA:** offer the VIDAA path in [docs/VIDAA.md](docs/VIDAA.md): "There is a VIDAA version of
  couch-tv, in Beta. There is nothing to install on the TV: a computer at home that stays on opens
  couch-tv's home in the TV's own browser every time the TV is switched on (on older firmware it may also
  go on the app row as a tile). It is not a true home screen: the remote's Home button still opens VIDAA's
  home, and that cannot change without rooting the TV, which couch-tv never does. The phone remote works:
  keys, volume up and down, Home, opening apps. Apps open on their own page and you pick the show. There is
  no 'what is playing', no volume level, no typing from the phone and no screenshots. You type a PIN the TV
  shows once. Newer TVs (2024 on, most Australian Hisense TVs bought in 2025 or 2026) also need a
  certificate you take from your own copy of Hisense's VIDAA phone app; couch-tv does not include it.
  Hisense documents none of this, so on your TV something may need fixing." If they have **no computer that
  stays on**, VIDAA is the exception to "nothing works": offer the standalone home (docs/VIDAA.md, "No
  computer: a standalone home"): the home as a website the Couch TV tile opens, with the clock, scenes or
  photos, weather and Home settings, and on Vercel a Spotify Now playing card with Play on TV. Say plainly
  what it lacks: the dock can't open apps (VIDAA lets no page do that), couch-tv doesn't open at power on
  and Home doesn't bring it back (the remote's ♡+ key can be set to open it), and there is no phone remote.
  A computer is still needed once, to point the tile at the site. Run
  `scripts/vidaa-check.py <tv address>` first, and never suggest or walk them through rooting the TV.
- **Philips on Titan OS** (no Google button, a home of "Lifestyle" rows; mostly Europe): offer the remote now
  and do not promise the home yet. "There is a Philips Titan OS version of couch-tv, in Beta. The **phone
  remote works now**: power, keys, volume, inputs, opening the TV's apps, and the assistant on top of those.
  couch-tv's own home **needs a Titan app** to open on the TV: a couch-tv app in Titan's store, or Titan's
  DevView developer app with a developer account. Neither is there yet, so for now the home stays Philips's.
  You type a PIN the TV shows once, and pairing needs a key from Philips's own TV Remote app that you save
  on this computer yourself; couch-tv does not include it." Follow
  [docs/PHILIPS-TITAN.md](docs/PHILIPS-TITAN.md): run `scripts/philips-check.py <tv address>` first
  (pairing with `--pair` shows a PIN on the TV). Never fetch, paste or suggest a source for Philips's
  pairing key: they save their own with `scripts/philips-secret.py`. Never use the TV's developer debug
  port. Testing guide: [docs/PHILIPS-TITAN-TESTING.md](docs/PHILIPS-TITAN-TESTING.md).
- **Older Philips with Saphi** (not Android, not Titan OS; roughly 2015 to 2019): offer the Saphi path and do
  not promise a home screen. "There is a Saphi version of couch-tv, in Beta. With a computer at home that
  stays on, you get the phone remote, and if your TV offers a browser to its network remote, couch-tv's
  page opens in that browser every time the TV is switched on. It is not a real home screen: the browser's
  bar can show and the remote's Home button still opens Philips's menu. Many of these TVs need no pairing;
  some want a PIN, and some have no network remote at all, so it depends on the model." Run
  `scripts/check-tv.py <tv address>` and `scripts/philips-check.py <tv address>` first. If it wants a
  login, pairing is the Titan OS path above. If they choose it, follow
  [docs/PHILIPS-SAPHI.md](docs/PHILIPS-SAPHI.md). Never send `activities/browser` before the yes: it opens
  a page on the TV. Testing guide: [docs/PHILIPS-SAPHI-TESTING.md](docs/PHILIPS-SAPHI-TESTING.md).
- **Fire TV on Vega OS:** offer the path in [docs/FIRE-VEGA.md](docs/FIRE-VEGA.md), and say plainly that it
  is Beta, that it needs a free Amazon Developer account, Amazon's Vega tools on a Mac or Linux computer, a
  USB cable once and a computer at home that stays on, that Amazon's Home button still opens Amazon's
  home, that the phone remote only works while couch-tv is in front (no volume, no power off), and that only
  Netflix and YouTube open from the phone. Follow docs/FIRE-VEGA-TESTING.md, and run `scripts/check-vega.py`
  first. Never root anything.
- **VIZIO (SmartCast or VIZIO OS):** offer the remote and do not promise the home. "There is a VIZIO version
  of couch-tv, in Beta, and it is the **phone remote only**: power, keys, volume, switching inputs, opening
  apps such as Netflix and YouTube, and the assistant on top of those, with a computer at home that stays
  on. couch-tv's own home page **cannot open on a VIZIO**: VIZIO OS has no browser, takes no outside apps,
  and its app programme is closed. The remote's Home button opens VIZIO's home. Apps open on their own page
  and you pick the show; there is no 'what is playing' title, no typing from the phone and no screenshots.
  You type a PIN the TV shows once." If they choose the remote, follow [docs/VIZIO.md](docs/VIZIO.md): run
  `scripts/vizio-check.py <tv address>` first (`--pair` shows a PIN on the TV). Do not set up the Cast
  experiment in VIZIO.md for them unless they ask and already run the tools it needs, and never open a
  router port. Testing guide: [docs/VIZIO-TESTING.md](docs/VIZIO-TESTING.md).
- **Panasonic Viera (My Home Screen, or older Vieras with network control):** offer the Panasonic path in
  [docs/PANASONIC.md](docs/PANASONIC.md): "There is a Panasonic version of couch-tv, in Beta. There is
  nothing to install on the TV: a computer at home that stays on opens couch-tv's home in the TV's web
  browser a few seconds after the TV is switched on. It is not a true home screen: the browser's own bar
  stays visible, and the remote's Home button still opens Panasonic's home. The phone remote works: keys,
  the volume slider, Home, opening apps. Apps open on their own page and you pick the show. There is no
  'what is playing', no typing from the phone and no screenshots. Newer sets (2018 on) show a PIN once to
  pair." A Panasonic Google TV model is a normal couch-tv TV, not this path. Run
  `scripts/panasonic-check.py <tv address>` first (it presses no key); pairing with `--pair` makes the TV
  show a PIN.
- **Apple TV (Beta):** do not say no. Offer the path in [docs/APPLE-TV.md](docs/APPLE-TV.md), and say first,
  plainly: "With a computer at home that stays on, the phone remote works on an Apple TV: arrows, OK, Back,
  Play, sleep and wake, and opening any app. You type a PIN the Apple TV shows once. couch-tv's home also
  comes as an Apple TV app, Couch TV, with the same scenes, clock, Keep watching and apps, and the computer
  opens it whenever the Apple TV wakes. Apple's own Home button still opens Apple's home: Apple lets no app
  replace it. Couch TV goes on the Apple TV free, from a Mac with Xcode and your own Apple ID, but Apple
  makes that run out after 7 days, so the Mac at home has to stay on and reinstall it each week (a script
  does it, twice a week to be safe), or you pay Apple US$99 a year for a one time install. Typing from the
  phone, what is playing and a volume level are not available." Neither part has run on a real Apple TV
  yet, so ask them to open an issue afterwards with what `scripts/appletv-check.py` printed and how Couch
  TV went. Run `scripts/appletv-check.py` (read only) before the yes, pair only after it. Couch TV needs a
  Mac: without one, offer the remote only. Signing in to Xcode is theirs to do (never ask for the Apple ID
  password), and their team id goes only in `tvos/Config/Signing.mine.xcconfig`, which git ignores.
- **TiVo OS on a TV built by Vestel (JVC, Telefunken and others, Beta):** do not say no. Offer the path in
  [docs/TIVO.md](docs/TIVO.md), and say first, plainly: "There is a TiVo OS version of couch-tv, in Beta,
  worked out on one real JVC. There is nothing to install on the TV. With a computer at home that stays on,
  the phone remote works, and couch-tv opens itself in the TV's own browser a little while after the TV is
  switched on. You add couch-tv once as the first Speed Dial tile in that browser, typing its address with
  the TV remote, which is slow. It is not a true home screen: TiVo's Home button still opens TiVo's home.
  The TV gives no volume level, only Netflix and Prime Video open from the phone, and there is no 'what is
  playing' and no screenshots." Run `scripts/tivo-check.py` first (it only reads, and finds the TV by
  itself). `--key volume_up` presses one key and waits for the yes like everything else that changes the
  TV. The computer needs a fixed address, because the tile holds it. Afterwards ask them to open an issue
  with what the check printed and how it went. A TiVo OS TV that does not answer Smart Center: say so
  kindly and offer the Google TV box. Do not suggest rooting the TV.

## 2. The questions

Ask them in this order. Each answer goes into `config.json` (keys in
[docs/CONFIG.md](docs/CONFIG.md)). Never put a home address in it: a suburb or city is enough for
the weather.

### 2.1 Which option (the big one)

**Always offer all three**, even when `check-tv.py` says C is only "likely" (that only means
Developer options are not on yet). Most people do not have a computer that stays on, so C is often
the right answer. Explain it like this, then ask which they want:

> "There are three ways to run this.
> **A. Just the new home screen.** A cleaner home with no ads. You use your normal TV remote.
> Nothing else to keep running. After a big Google TV update you may need me (or this computer)
> to put it back once.
> **B. Home screen and phone remote, with a computer at home that stays on.** You get the phone
> remote, 'put on Bluey' style search, turning the TV on from your phone, keep watching across
> apps, and optionally a Claude assistant that finds and plays shows using your own Claude plan.
> The computer (a Mac, a Linux box or a Raspberry Pi) has to stay on and awake. A laptop that
> sleeps or leaves the house does not count.
> **C. Home screen and phone remote, living on the TV.** No computer to keep on. The phone talks
> straight to the TV. You lose turning the TV on from the phone, and the AI assistant only
> works if you add your own API key (Claude, OpenAI or another AI service, or a model on a
> computer at home), which costs a little per question. On newer Google
> TVs you may have to type a pairing code from the TV's settings again after the TV restarts."

Then: "Do you have a computer that is always on at home?" If yes, B is the best tested. If no,
recommend C (A if they only want the home screen). Write the choice down; the rest of the questions depend on it.

### 2.2 People (profiles)

- "Who watches this TV? Give me a name for each person, the way you want it on screen."
  One person: no switcher. Two: a switch at the top left. Three or more: a round head icon at the
  top left that opens a list.
- "What order should the names go in?" (They can change it later from the phone or the TV remote.)
- Option B: "When Netflix, Stan or another app asks who's watching, which profile is yours?" Ask
  each person for every name they use across their apps (it is often different per app), and which
  profile to fall back on if theirs is not there. They go in `app_profiles` and
  `app_profile_fallback` ([docs/CONFIG.md](docs/CONFIG.md), People).
- "Any kids or guest profiles?" Mark them in `config.json` with `"kid": true` or `"guest": true`.
  Option B: they are left out of the household's taste, so the shared picks are not full of
  cartoons or a visitor's shows. They still have their own row. Imported Netflix Kids profiles are
  left out the same way.
- Optional, ask once, right after the people: "Any young kids who should only see shows you've
  picked? I can set up a kids mode with a PIN." Kids mode is off unless they say yes: with a no (or no
  answer) add nothing, no `kids_mode` and no PIN. If yes: whose home it is, which shows (and on which
  app, if it matters), which apps beside them (up to six, or none), and a PIN of 4 to 8 digits they
  choose. It goes in `kids_mode` on that person ([docs/CONFIG.md](docs/CONFIG.md), Kids mode). Say the
  limits plainly: inside Netflix or another app the child can browse that app, so set up the app's own
  kids profile too; and the PIN keeps a child out, it is not a password. Option A: `apply.sh` looks
  the shows up while it installs, so run it again after changing them. Option C: there is no
  `config.json`, so they turn it on later from the phone (TV, Kids mode) or the TV's setup page. Apple TV: it works
  in Couch TV with the bridge; say that the Apple TV's own TV button still opens Apple's home, and walk them through
  Apple's Restrictions and each app's kids profile ([docs/APPLE-TV.md](docs/APPLE-TV.md#kids-mode)). Roku: not yet.
- Option B, optional: "Do you want to bring in your past Netflix or YouTube history so 'keep
  watching' and suggestions start smart?" If yes, walk them through
  [bridge/IMPORT.md](bridge/IMPORT.md) later. They download their own files. You never sign in to
  their accounts.

### 2.3 How the home looks

- Show them the pictures at the top of the README. "Do you want the five scenes taking turns, just
  some of them, your own photos, or the Classic look?" Own photos: 1920x1080 JPEGs into
  `tv-home/web/backgrounds/`.
- "How long should each scene stay?" (20 seconds is the default.)
- "Which language for the home: English, Spanish, Mexican Spanish, Italian, German, Turkish, French or Serbian (Latin)?" Leave
  `home.language` out to follow the TV's own language.
- "12 hour or 24 hour clock?" (Left out: 24 hour in Italian, German, Turkish, French and Serbian, 12 hour otherwise.)
- Options A and B: "Do you want the TV to tell you when a new couch-tv version is out? It looks
  once a week and only shows a small dot. Or would you rather check yourself, in Home settings?"
  `home.updates`: `notify` or `manual`. Left out, the TV asks once the first time the home opens.
- "What suburb or city for the weather?" Look up its latitude, longitude and time zone yourself.
- "What country are you in?" (For where shows stream. Two letter code, for example AU, US, GB.)

### 2.3.1 Your own background (optional)

- "Want your own background? Describe a place, or give a photo." Any photo works, a landscape or
  a personal one. If yes, follow [docs/MAKE-A-SCENE.md](docs/MAKE-A-SCENE.md) once the plan has
  its yes: one command makes the photo and the clock's glass fill, and `home.my_scenes` designs the
  clock over it (where it sits, size, font, the date, light or dark). Putting the clock behind the
  skyline is an optional extra (step 6 there); offer it only for a photo with open sky.
  Making a picture from a description with a paid image model costs money: ask before using one.
- Option A: say plainly that their own scene needs the app built on this computer
  (`scripts/build-apk.sh`, so JDK 21 and the Android SDK) instead of the one from Releases.
- Their pictures stay in `tv-home/web/backgrounds/mine/`, which git ignores. Never commit them.

### 2.4 Apps

- "Which apps do you use most? I'll put them first." The home shows 10 apps in a row, then
  Settings and More apps. Everything else sits behind More apps.
- "Any apps you never use that I should tuck away behind More apps?" A maker's own clutter (help
  apps, file browsers) can be hidden completely with `home.hide_packages`.
- Tell them: new apps come from the **App Store** tile (in More apps, and it can be moved onto the home) and turn up on the home by
  themselves. They can rearrange later from the phone, or with the TV remote (hold OK on an app).

### 2.5 Quick settings

The small buttons at the top of the home. Ask which they want, in order:
- **Sleep timer** (turns the TV off after 15, 30, 60 or 90 minutes).
- **Picture mode switch**: flips between two picture modes they choose. Ask which two (for example
  "Calibrated" and "Dynamic"). Only offer it if the TV shows those modes in its picture settings.
- **Look switch**: flips between the scenes and the Classic look.
- **Input switch**: opens the TV's input list (for a games console or a set top box).
Option A has no bridge, so only the look switch works there, plus the input switch on TVs that
have an input screen. Leave the rest off.

### 2.6 Phone remote (options B and C)

- "Who will use the phone remote, and are they on iPhone or Android?" It is a web page added to the
  home screen, no app store. Show each person how to add it.
- On an Android 17 phone, Chrome may show `ERR_TOO_MANY_RETRIES` for the bridge's address until it has
  Settings, Apps, Chrome, Permissions, Nearby devices, Allow. Tell them before they hit it, and if they
  report that error, that is the fix.
- Tell them: it works on the home Wi-Fi only. Option B, optional: a private network (VPN) app
  they run themselves can make it work away from home. Never open a router port for it.
- Tell them plainly: **by default with option B there is no password, so anyone on the Wi-Fi can use the
  remote and the assistant, kids and visitors included.** To require a password, set `bridge.pairing_key` in
  `config.json` (12 to 128 letters, digits, `-` or `_`; the bridge refuses a shorter one at start, so pick a long enough one first time): the phone remote pairs once by typing it (or opening a `?pair=<key>` link). Suggest a guest
  Wi-Fi network for visitors (most routers have one) so they cannot reach it. Option C asks for a PIN shown on the TV
  the first time.

### 2.7 Extras (option B)

- **Claude assistant:** "Do you use Claude Code with a Claude plan on this computer?" Only if it
  is installed and logged in (check `claude --version`), set `ask.enabled` to `true` (the example
  has it off). It runs on their plan and never uses an API key. Remind them that anyone on the
  Wi-Fi can use it too. If no, leave it off.
- **Turning the TV on from the phone:** needs the TV's network (MAC) address and the TV allowed to
  wake over the network. Some TVs call it "Network standby" or "Wake on LAN". Offer to find it.
- **Screens** (streaming a computer to the TV with Moonlight): advanced, off by default. Only if
  they ask.

### 2.8 The TV address

Ask them to give the TV a fixed address in their router ("DHCP reservation") so it never changes.
If they cannot, the setup still works but may need the new address later.

### 2.9 Smart home (optional, options A and B)

Off unless they say yes. Ask only once, near the end: "Do you use Home Assistant at home? If you
do, the TV can show your air conditioning and a doorbell camera." No, or "what is that": leave it
out entirely (no `home_assistant` section) and move on. Do not suggest installing Home Assistant
just for this.

If they say yes to the air conditioning or the doorbell card:

1. Explain in plain words what it needs, and that nothing about it happens unless they want it:
   > "Three things. Home Assistant has to be running at home, on the same Wi-Fi or home network as
   > the TV. You make a separate Home Assistant user just for the TV, and a long-lived access token
   > for that user: it is like a password that only lets the TV in, and you can delete it any time.
   > And I need the names Home Assistant uses for each thing, which look like `climate.bedroom` or
   > `camera.front_door`. It all stays off unless you say yes, and taking it out later is one
   > change and one re-run."
2. **Air conditioning:** "Which rooms?" Their `climate.*` entity names, up to 8, and the name to
   show for each.
3. **Doorbell:** "What rings, and which camera shows the door?" The doorbell is usually an
   `event.*` entity (Ring, Reolink, Nest and most others make one per press); a `binary_sensor.*`
   or an `input_boolean.*` that is on while it rings also works. The camera is a `camera.*`. Tell
   them: "A card with a still picture of the door, new every two seconds, pops up at the top right
   over whatever is on. Any button on the remote hides it. For it to show over Netflix and the
   other apps, the TV has to allow couch-tv to 'display over other apps'. I only switch that on
   because you want the doorbell, and the undo switches it off." There is no live video and no
   sound.
4. **Then always ask: "Are there any other smart home devices you want on the TV?"** Map what they
   say to what couch-tv can do, and say plainly what it cannot:
   - Lights, blinds, fans, a "movie night" mood, a "good night" routine: a **scene or script
     tile**. If they have no scene for it yet, they make one in Home Assistant (Settings,
     Automations and scenes) and give you its `scene.*` or `script.*` name. Up to 10 tiles.
   - More air conditioners or heaters: more `climate` rooms.
   - Other cameras: only the doorbell's camera, and only as stills. Say so.
   - Locks, alarms, garage doors: **not supported, on purpose** (nothing that opens the house from
     a TV remote). Say so.
   - Anything that is not in Home Assistant (a separate app, a hub Home Assistant does not know):
     not supported yet. Say so; it may work if they add it to Home Assistant first.
5. Write it down for the plan. In step 3, read it back as one line ("Smart home: the living room
   and bedroom air conditioning, the Movie night and Good night tiles, and the front door doorbell
   card, which needs 'display over other apps' switched on"), along with everything else, and
   wait for the same yes. Nothing about it changes on the TV before that yes.
6. After the yes: they make the Home Assistant user and token themselves, on their own Home
   Assistant (Settings, People, add a user that is not an administrator; log in as it; its
   profile, Security, Long-lived access tokens). Ask them to paste the token into `.env` as
   `HOME_ASSISTANT_TOKEN=...` themselves, or give it to you only to write it there. Never put it
   in `config.json`, never repeat it back, never write it anywhere else. Add the
   `home_assistant` section to `config.json` ([docs/CONFIG.md](docs/CONFIG.md), Smart home).
   `apply.sh` hands it to the TV and prints one line ("smart home: 2 climate, 2 scenes,
   doorbell"); check that line matches the plan. You never call Home Assistant yourself to test
   it: they check on the TV that the rooms show and, if they want, ring the doorbell once.

## 3. Read the plan back and get a yes

Before you touch the TV, say back, in one short list: the TV, the option, the people, the look,
the apps first in line, the quick settings, and what will be switched off on the TV. Then explain
exactly what changes:

- Developer options and USB debugging go on (docs/SETUP.md step 1), plus Network debugging if the TV
  has that switch (many do not: on some, USB debugging alone opens the network port). The TV asks
  "Allow USB debugging?" once per computer. They tick Always allow.
- If `check-tv.py` said the TV only has Wireless debugging: you will pair once with Google's
  platform-tools and run `adb tcpip 5555` (docs/SETUP.md step 1, "Only Wireless debugging?"). On some TVs
  that port closes after a restart and has to be opened again the same way.
- Options A and B (`apply.sh`) make couch-tv the home and switch off ambient mode (the idle
  adverts) and any ad tracker you agree to. The TV's own home screen and setup app stay on, so the
  TV always has them when it starts; a small Home button watch (an accessibility service that only looks at which
  window came forward; it declares the screen reading capability only because some TVs send events to nothing else, and never reads the screen) puts couch-tv on top when the TV opens its own home, which may flash up for
  a moment. Nothing is deleted.
  - **Privacy clean (Beta, opt in):** only if they ask, `PRIVACY=1` adds the apps in
    `tv-home/tools/privacy-list.txt` that the TV has (ACR, ad and telemetry apps) to the switch off
    set, through the same safety check. Run it with `DRY_RUN=1` first and show them the list. Never
    tell them it removes all tracking; point them to docs/PRIVACY.md for the menu switches. Never add
    a launcher, setup, remote, voice, Bluetooth, CEC, keyboard or TV provider package to that list.
  - **Never switch off the Google TV home (`launcherx`, `tvlauncher`) or the setup app
    (`setupwraith`), by hand or through `EXTRA_OFF`.** couch-tv 0.10 and older did, and a Sony
    Bravia Google TV then looped at every restart (docs/TROUBLESHOOTING.md, "If your TV loops after a restart").
    `apply.sh` refuses them and anything else the TV may need to start.
  - **TCL: Home goes back to Google TV after every restart (#94, TCL Smart TV Pro, Android 14).**
    TCL's boot manager `TclAppBoot` blocks binding `FireWatch` and `KeyWatch` and the
    BOOT_COMPLETED to `FireWatch$Restore`, because the app lacks TCL's AUTO_START app-op, which TCL
    resets to ignore on every boot. The app now declares an empty placeholder TV input
    (`TclPlaceholderInput.kt`, manifest `android:enabled="false"`) that `App.onCreate` switches on
    only when `Build.MANUFACTURER` or `Build.BRAND` is TCL, so no other TV lists a new input. TCL is
    reported to let any app that provides a TV input start at boot (the Haven launcher's trick; its
    source was not found, so this was written from the Android docs, nothing copied). **Unconfirmed
    on a real TCL until the reporter tests it.** The app must be opened once after installing so the
    switch is made (Android keeps it across reboots). Not changed: FireWatch and KeyWatch are not
    marked `directBootAware`, because FireWatch reads CrashGuard's SharedPreferences (credential
    encrypted storage) on every window event, which is not available before unlock. **Confirmed on
    the reporter's real TCL (0.12, before the TV input):** `appops set app.couchtv.launcher AUTO_START
    allow` once, then switching both services on from the TV's own Settings, Accessibility with the
    remote (not by writing the setting over ADB) survived a real power cut, and TCL kept AUTO_START
    allowed. Which step matters is unknown, so on a TCL do both after `apply.sh`, and walk them
    through the Accessibility switches on the TV. If the services are missing from that menu, launch the app once, then set the app op and write the settings over ADB: on that TCL they only appeared in the menu once bound. Also seen there: installing or removing any app made Android drop couch-tv as the preferred home (role holder unchanged); `cmd package set-home-activity` again fixed it, so re-assert it after installing anything. Fallback from a
    computer after each reboot, if that fails: `cmd package set-home-activity
    app.couchtv.launcher/.MainActivity`, start the app, `appops set app.couchtv.launcher AUTO_START
    allow`, then rewrite `enabled_accessibility_services` and `accessibility_enabled 1`. Separate and
    not fixed: a real double press of Home on that TCL remote stays on Google TV (injected keys do
    not reproduce it); Back twice escapes.
  - If the TV was set up with couch-tv 0.10 or older, `apply.sh` switches those two back on: tell
    them that is the fix, not a fault.
  - Option A: after a Google TV update switches ambient mode back on, `apply.sh` can run again.
    Option B's bridge does that check every day.
- Options A and B: with `home.updates` set to `notify`, the TV home asks GitHub once a week
  whether a new couch-tv release is out; with `manual`, only when someone presses Check for updates
  now (either can be changed in Home settings, Updates). It installs nothing unless someone at the
  TV says yes on Android's own screen.
- Show them the undo ([docs/UNINSTALL.md](docs/UNINSTALL.md)) before you start.

Ask: "Ready for me to set it up? You can undo all of it." Wait for a clear yes.

## 4. Set it up, then check it

1. Install what was missing in step 0 (say what you are installing). Use the release APKs you
   downloaded into `dist/` in step 0; build only if that download failed.
2. Write `config.json` from their answers. Never commit it.
3. Developer options on (docs/SETUP.md step 1). Tell them: switch on **USB debugging**; if there is
   also a **Network debugging** (or Wireless debugging) switch, switch that on too. Do not insist
   on Network debugging: some TVs have no such switch and USB debugging alone opens port 5555 (a
   TCL with Android TV 11 did). Then check with `.venv/bin/python scripts/check-tv.py <tv address>`
   whether ADB answers on 5555. Then, while they stand at the TV, run
   `.venv/bin/python scripts/check-tv.py <tv address> --adb` and have them tick **Always allow**
   and press Allow. Now settle B or C from its Android version.
   **Use the Android version from `--adb` to pick your words from now on:**
   - **Android TV 9, 10 or 11** (an Android TV, not Google TV): menus are **Settings, Device
     Preferences, About** and **Settings, Device Preferences, Developer options**.
   - **Google TV, Android 12 or newer:** **Settings, System, About** and **Settings, System,
     Developer options**.
   - Say "Google TV home" only if the home it reports is `com.google.android.apps.tv.launcherx`.
     Otherwise (for example `com.google.android.tvlauncher`, or a maker's own home) call it **the
     TV's own home screen**.
4. **Allow every computer and app before `apply.sh`.** Seen on one Google TV (Android 14) set up
   by an older couch-tv: with the Google TV home and the setup app switched off, the TV stopped
   showing "Allow USB debugging?" for any new key. The current `apply.sh` leaves both on, but make
   sure each computer that will talk to the TV has been allowed first anyway, and for option C that
   the on-TV app's **Connect ADB** has been allowed.
5. Follow docs/SETUP.md for their option (A: steps 1, 2 and 6; B: steps 1 to 6;
   C: [on-tv/README.md](on-tv/README.md)). Run `tv-home/tools/survey-tv.py` before `apply.sh`.
   Option A: run `apply.sh` with no `BRIDGE_URL`. Option B: with `BRIDGE_URL`. It copies the app
   with `tvadb.py`, which falls back to a slower copy by itself if the TV stalls; let it finish.
   If it ends with "this computer can no longer reach it", ask them to check the TV is on and on
   the Wi-Fi, then run the same `apply.sh` command again.
   - **Pairing (option B, docs/SETUP.md step 3):** you cannot type into `pair_tv.py`. Run
     `.venv/bin/python bridge/pair_tv.py <tv id>` in the background, ask them to read you the code
     on the TV, then run `.venv/bin/python bridge/pair_tv.py <tv id> --code <code>`. It prints
     `ok: ... is paired` and exits 0, or says the TV refused the code (then start again: each
     pairing shows a fresh code).
   - **Keeping the bridge running (option B, docs/SETUP.md step 5):** if you started the bridge by hand to
     test it, stop it before installing the service (it holds the port), and never point your
     hand-started copy's output at the service's log file. After `launchctl bootstrap`, check
     `launchctl print gui/$(id -u)/app.couchtv.bridge` says `state = running`. Exit code 78
     (EX_CONFIG) with an empty log means launchd could not open a log file another program made:
     delete it or rename the log paths, then bootout and bootstrap again
     (`bridge/examples/couch-tv-bridge.plist.example`). Seen on a real Mac.
6. Check, with them watching the TV: press Home (the new home shows), open two apps, the sleep
   timer, the profile switch, and for B and C one press on the phone remote.
7. Hand over in plain words: how to rearrange apps (phone, or hold OK on the TV), how to add apps
   (App Store tile), how to change profiles, where the undo is, and for option A that a Google TV
   update may need `apply.sh` once more. Options A and B: if they said yes to update news, a new
   couch-tv release shows up as a dot on the gear tile within a week. Either way, Home settings,
   Updates checks for one and installs it (Android asks first, and once asks to let Home install
   apps), and the weekly look can be switched on or off there.

## Two TVs in sync (only if they ask)

If someone asks for two TVs to play the same show together, read [docs/SYNC.md](docs/SYNC.md) and
follow it, including its section for you. It is experimental: say so, say how little it has been
tried, and say that Samsung, LG, VIDAA, VIZIO, Panasonic and Roku cannot do it (a Google TV box or Fire TV stick
plugged in fixes that). It needs the same read back and the same clear yes as everything else
before it touches a TV: `sync/install.sh` changes each TV, and `calibrate` and `play` make both TVs
pause, jump and play. `sync.py dry` only reads and is fine before the yes.

## Rules while you work

- `config.json`, `.env` and `bridge/data/` hold their settings and history. Git ignores them.
  Never commit them, and never paste their contents into issues or chat logs.
- If they want to share their own fork, run `scripts/privacy-scan.sh` first. It must find nothing.
- Option B runs `claude -p` with `ANTHROPIC_API_KEY` removed on purpose, so it uses their Claude
  plan, not a paid key. Leave that in place. Option C only uses an API key they typed in themselves.
- If anything on the TV fails, stop and tell them what happened. Do not keep switching apps off to
  make it work, and never switch off a home screen, a setup app or a system app. The scripts stop on the first failure and say so in one line.
- If they say "take it off" or "I broke it", go straight to [docs/UNINSTALL.md](docs/UNINSTALL.md).
  Option B: stop the bridge first.
