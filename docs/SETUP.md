# Set up couch-tv

This page has every step to put couch-tv on your TV, and to take it off again.

**Before you start:** the easy way is the setup site, [couchtv.sites.underseage.studio](https://couchtv.sites.underseage.studio), from your phone, with the free Setup app on a Mac or Windows computer, or with your AI agent. Not sure about your TV? See [Will it work on my TV?](../README.md#will-it-work-on-my-tv) and [PLATFORMS.md](PLATFORMS.md).

**On this page**

- [Three ways to run it](#three-ways-to-run-it) and [which steps for your option](#which-steps-for-your-option)
- [Setting it up with an AI agent](#setting-it-up-with-an-ai-agent)
- [What you need](#what-you-need)
- [Step 1. Developer mode on the TV](#step-1-developer-mode-on-the-tv-every-option)
- [Step 2. Get the code and set up Python](#step-2-get-the-code-and-set-up-python-every-option)
- [Step 3. Pair the TV with the bridge](#step-3-pair-the-tv-with-the-bridge-option-b)
- [Step 4. Build the phone remote](#step-4-build-the-phone-remote-option-b)
- [Step 5. Run the bridge](#step-5-run-the-bridge-option-b)
- [Step 6. Put the TV home on the TV](#step-6-put-the-tv-home-on-the-tv-options-a-and-b-it-becomes-the-home-the-google-home-stays-on)
- [Building the app (instead of downloading it)](#building-the-app-instead-of-downloading-it)
- [Undo: put the Google home screen back](#undo-put-the-google-home-screen-back)

## Three ways to run it

Pick your option, then follow only its steps.

| | A. TV home only | B. Computer bridge | C. Lives on the TV |
|---|---|---|---|
| **What you get** | The new home screen, nothing else. You use your normal TV remote. | The home screen plus the phone remote, "put on Bluey" search, turning the TV on from the phone, keep watching across apps and an optional Claude assistant. | The home screen and the phone remote with no computer: the bridge runs inside an app on the TV. |
| **A computer that stays on** | No | Yes: a Mac, a Linux box or a Raspberry Pi at home runs the bridge | No |
| **Follow** | Steps 1, 2 and 6 below. With no computer at all: step 1, then "Option A with no computer" in step 6. | Steps 1 to 6 below. | [on-tv/README.md](../on-tv/README.md) (it has its own developer mode and install steps). |

### Which steps for your option

| Option | Follow |
|---|---|
| A. TV home only | [Step 1](#step-1-developer-mode-on-the-tv-every-option), [step 2](#step-2-get-the-code-and-set-up-python-every-option) and [step 6](#step-6-put-the-tv-home-on-the-tv-options-a-and-b-it-becomes-the-home-the-google-home-stays-on). With no computer at all: step 1, then "Option A with no computer" in step 6. |
| B. Computer bridge | [Step 1](#step-1-developer-mode-on-the-tv-every-option) to [step 6](#step-6-put-the-tv-home-on-the-tv-options-a-and-b-it-becomes-the-home-the-google-home-stays-on). |
| C. Lives on the TV | [on-tv/README.md](../on-tv/README.md) |

## Setting it up with an AI agent

Open this folder in Claude Code (or any coding agent) and say "set this up on my TV". It reads
[AGENTS.md](../AGENTS.md), finds your TV, asks which option you want and a few questions (who
watches, the look, your apps), reads the plan back, and changes nothing on the TV until you say
yes.

This repo is **two separate things**. You can use the first without the second, but the second
needs the first's TV set up the same way (developer mode on).

| | 1. The TV home | 2. The phone remote and bridge |
|---|---|---|
| What it is | An Android TV app that becomes the TV's home screen (the Google TV home stays installed and on behind it). Scenes, clock, weather, your app row, "keep watching". | A phone web app (the remote) and a small Python service (the bridge) that runs on a computer at home and talks to the TV. |
| Where it lives | `tv-home/` (`android/` is the app, `web/` is its screen) | `remote/` (phone app) and `bridge/` (the service) |
| Runs on | The TV | Your phone, plus a computer that stays on |
| Options | A and B | B (C has its own app, in `on-tv/`) |

## What you need

**For every option:**
- A **Google TV or Android TV** (Android 7.1 or newer; Android 6 is experimental and needs apps built from main for now) with Developer options and debugging on
  (step 1).
- A computer on the same Wi-Fi to set it up from: macOS or Linux with **Python 3.11 or newer**
  (`python3 --version`). Missing or older: on macOS `brew install python@3.11` or the installer
  from python.org; on Linux your distribution's package (for example `sudo apt install python3.11
  python3.11-venv`; Debian ships Python without the venv part, so if `python3 -m venv .venv` fails
  install `python3-venv`, or use `uv venv --seed .venv`). On a Mac the first `python3` or `git` may ask to install the developer tools:
  say Install, it takes a few minutes. For option A that computer can go back in the cupboard
  afterwards.
- The TV app, `couch-tv-home.apk`: **download it from the GitHub Releases page**, or build it
  yourself ("Building the app" below).

**Option B also needs:**
- An **always-on computer on the same Wi-Fi**: a Mac or a Linux box (a Raspberry Pi is fine).
  The bridge has to be running whenever you want the remote.
- **Node 20.19 or newer** (or 22.12 or newer), once, to build the phone app.
- Optional, **Claude "ask"** ("put on something funny"): the Claude Code program, installed and
  logged in to your own Claude plan. It runs `claude -p` and strips `ANTHROPIC_API_KEY` from the
  environment first, so it never bills an API key. It is off in `config.example.json`; turn it on
  (`"ask": {"enabled": true}`) once Claude Code works on that computer.
- Where a show streams: nothing to set up. The bridge asks JustWatch's public search (no key) for
  the country in `config.json` (`"country": "AU"`, or `"US"`, `"GB"` and so on).
- A free **TMDB key is not needed** by this code. If you add your own poster lookup, put the key in
  `.env` (copied from `env.example`, which has no TMDB line of its own). Never commit it.

**The home with the computer off (option B):** the app carries its own copy of the home and also
keeps the bridge's latest copy. If the computer is off, the TV still shows the clock, the weather
and your app row. It only loses "keep watching" and the picks. With option A that copy is the home.

## Step 1. Developer mode on the TV (every option)

Do this on the TV itself.

1. Open **Settings**, then **System**, then **About** (Google TV). On Android TV 9 to 11 it is
   **Settings, Device Preferences, About**.
2. Go right down to **Android TV OS build** (or **Build**). Press OK on it **seven times**. A
   countdown appears, then "You are now a developer!".
3. Go back. There is a new menu called **Developer options** (under System, or Device Preferences).
4. Find **USB debugging** and switch it on.
5. If there is also a **Network debugging** switch (also called ADB over network or ADB
   debugging), switch it on too. Some TVs have no such switch: on a TCL with Android TV 11, USB
   debugging alone opened the network port. The opposite happened on a 2015 Sony Bravia (Android
   8.0): port 5555 only opened after **Network debugging** was switched on as well. Either way, check from the computer:
   `.venv/bin/python scripts/check-tv.py <tv address>`. If it says ADB is open on port 5555,
   everything in this repo works as it is. If it says only Wireless debugging is on, see the box
   below.
6. Find the TV's address: **Settings, Network and Internet, your Wi-Fi** (or **Settings, Network,
   your Wi-Fi, details**). It looks like four numbers with dots. Give the TV a fixed address in your
   router if you can, so it never changes.

The first time a computer connects, the TV asks "Allow USB debugging?". Tick **Always allow**
and press **Allow**. You never see it again.

> **Allow every computer before step 6.** Seen on one Google TV (Android 14) set up by couch-tv
> 0.10 or older, whose `apply.sh` switched off the Google TV home and its setup app: the TV no longer
> showed "Allow USB debugging?" for any new computer. Computers allowed before that kept working.
> The current `apply.sh` leaves both on, but to be safe connect each computer you will use (`check-tv.py <tv address> --adb`, and for option C the
> app's **Connect ADB**) and press Allow **before** step 6. If it already happened, see "If
> something is stuck" in [UNINSTALL.md](UNINSTALL.md).

<details>
<summary><b>Only Wireless debugging?</b> Open this to turn the fixed port on once.</summary>

Newer Google TVs (Android 11 and up) may offer only **Wireless
debugging**, which pairs with a code and uses a random port that changes after a restart.
couch-tv's scripts and the bridge speak plain ADB on a fixed port, so turn the fixed port on once
with Google's own tools ([Android platform-tools](https://developer.android.com/tools/releases/platform-tools)):
1. On the TV: Developer options, **Wireless debugging** on, then **Pair device with pairing
   code**. It shows a code and an address with a port, for example `<tv address>:37123`.
2. On the computer: `adb pair <tv address>:<pairing port> <code>`.
3. Back on the Wireless debugging screen, note the port under "IP address and port", then
   `adb connect <tv address>:<that port>`.
4. `adb tcpip 5555`. Port 5555 is now open and `check-tv.py` should say ADB is open on port 5555.

On some TVs port 5555 closes again after a restart. Then run steps 2 to 4 again (option B's
daily guard and the remote need it open). If your TV keeps a different fixed port open, set
`"adb_port"` on that TV in `config.json` (or `ADB_PORT=<port>` for the scripts). The Wireless
debugging port itself needs Google's `adb`; couch-tv cannot use it directly.

</details>

<details>
<summary><b>Mac: "allow devices on your local network"</b></summary>

macOS asks once per program before it lets it
talk to devices at home. Say **Allow** for Terminal (or the app your AI agent runs in). A program
that is new to the Mac, like Google's `adb` straight after downloading it, can be blocked
silently: it then cannot reach the TV although everything else can. couch-tv's own tools
(`tv-home/tools/tvadb.py`, `on-tv/scripts/real-tv.py`, `check-tv.py`) are plain Python and run
inside the Python you have already allowed, so use them for everything except the one-off
Wireless debugging pairing above. If `adb` is blocked: System Settings, Privacy and Security,
Local Network, and switch on the app it runs in.

</details>

## Step 2. Get the code and set up Python (every option)

```sh
git clone https://github.com/Seagey/couch-tv.git
cd couch-tv
python3 --version                    # 3.11 or newer
python3 -m venv .venv
.venv/bin/pip install -r bridge/requirements.txt
cp config.example.json config.json
```

Edit `config.json` (it is private, it never gets committed):

- `tvs`: put your TV's address in `ip`. Give it a name. Add more TVs by adding more entries.
- `people`: the names that show on the "who is watching" switch, any number. None or one: no
  switch. Two: a switch. Three or more: a round head icon that opens a list. It shows even before
  anyone has watched anything. Mark children with
  `"kid": true` and visitors with `"guest": true` so they stay out of the household's picks.
- `weather`: your latitude, longitude, place name and time zone (Open-Meteo, free, no key). A
  suburb or city, never a home address.
- `country`: two letter code, for where shows stream.
- Option B: `bridge.host`, the name of the computer that runs the bridge, for example
  `my-computer.local`.
- Optional: `home` (scenes, how long each stays, 12 or 24 hour clock, how many apps in the dock,
  apps to hide), `quick` per TV (sleep timer, picture mode, look, input, screensaver and the other quick buttons), `ask` and
  `phone_remote`.

Every key, with its default: [CONFIG.md](CONFIG.md). Which TV remotes work and which
keys do what: [REMOTES.md](REMOTES.md). How the phone remote is hosted and how to add it to
your phone: [REMOTE.md](REMOTE.md).

Optional settings (port, Claude location) go in `.env`. Copy `env.example` to `.env`.

## Step 3. Pair the TV with the bridge (option B)

```sh
.venv/bin/python bridge/pair_tv.py living-room
```

The TV shows a 6 character code. Type it in and press Enter. That pairs the bridge as a remote (the
TV lists it as "Couch TV bridge"). An AI agent cannot type into the waiting script: it runs that
command in the background, asks you to read the code off the TV, then runs
`.venv/bin/python bridge/pair_tv.py living-room --code <the code>`.

Then:

```sh
.venv/bin/python bridge/pair_tv.py living-room --adb
```

The TV asks "Allow USB debugging?". Tick Always allow, then Allow. The keys it makes are stored on
your computer (`bridge/data/` and `~/.android/adbkey`). They are in `.gitignore`.

## Step 4. Build the phone remote (option B)

```sh
cd remote
npm ci
npm run build
cd ..
```

## Step 5. Run the bridge (option B)

```sh
.venv/bin/python bridge/server.py
```

Open `http://your-computer.local:5400` on your phone (same Wi-Fi). Add it to your home screen.
On an Android 17 phone, if Chrome says `ERR_TOO_MANY_RETRIES` for that address, allow Chrome to reach
devices on your network: Settings, Apps, Chrome, Permissions, Nearby devices, Allow (#69).
To keep the bridge running all the time, use `bridge/examples/couch-tv-bridge.plist.example`
(macOS) or `bridge/examples/couch-tv-bridge.service.example` (Linux). Both set `CLAUDE_BIN` and a
`PATH`, because a background service does not see your shell's.
To run it in Docker on a NAS instead, see [DOCKER.md](DOCKER.md).

<details>
<summary><b>The macOS service logs <code>No route to host</code>, or a laptop bridge stops</b></summary>

If the macOS service logs `No route to host` while a bridge you start by hand works, that is
macOS Local Network privacy, and the Local Network switch alone may not fix it for an interpreter
that is ad-hoc signed with no app bundle (python-build-standalone, for one). Easiest: use a
python.org or Homebrew Python for the venv. Otherwise copy the interpreter into a small app bundle
with its own identity (an `Info.plist` with a `CFBundleIdentifier` and an
`NSLocalNetworkUsageDescription`, then `codesign -s - --force` on the bundle) and point the plist
at it, as described in issue #42.

A laptop bridge must not sleep, or the bridge stops: Battery, Options, Prevent automatic sleeping
on power adapter when the display is off, or `sudo pmset -c sleep 0`.
A MacBook also sleeps when its lid is shut, even on power and with `caffeinate`: keep the lid open, or attach an external display.

</details>

**Anyone on your Wi-Fi can use the remote and the assistant.** By default the bridge has no password, so
everyone on the network, kids included, can change the channel, turn the TV off or ask Claude for
a show. Put visitors on a guest Wi-Fi network (most routers have one) so they cannot reach it.

To require a password on your home network, set `"pairing_key"` under `"bridge"` in `config.json`. The
phone remote pairs once by typing it (or opening `http://your-computer.local:5400/?pair=<key>`), and the
TV homes carry their key. On a Google TV, Android TV or Fire TV that needs a TV home app newer than
0.12 (on main, in the next release: build it until then), and the Samsung, LG and Roku apps are built
again with the key. See [Switching the pairing key on](CONFIG.md#switching-the-pairing-key-on)
for how to switch it on and update your TVs.

**Never forward a port to the bridge.** The bridge is built for your home network only. Never expose it
to the internet or forward port 5400 on your router. A private network (VPN) app you run yourself
is the safe way to use the phone remote away from home.

`"phone_remote": false` is for a house that only wants the TV home and its quick settings from the
bridge. The bridge still serves the API (the TV home needs it), and the phone page still loads if
someone opens it, so the same rule applies.

## Step 6. Put the TV home on the TV (options A and B; it becomes the home, the Google home stays on)

Get `couch-tv-home.apk` from the GitHub Releases page (or build it, below). Look at the TV first
(it changes nothing):

```sh
TV_IP=<your tv address> .venv/bin/python tv-home/tools/survey-tv.py
```

It lists the TV's home screens and the packages `apply.sh` touches.

Then install it. **Option A** (no computer stays on):

```sh
TV_IP=<your tv address> APK=couch-tv-home.apk sh tv-home/tools/apply.sh
```

**Option B** (the home loads from the bridge):

```sh
TV_IP=<your tv address> APK=couch-tv-home.apk BRIDGE_URL=http://my-computer.local:5400 sh tv-home/tools/apply.sh
```

This installs the app and makes it the TV's home. The TV's own home screen (Google TV's or a
maker's own) and the setup app stay installed and switched on, so the TV always has them when it starts: a small
Home button watch puts couch-tv on top whenever the TV opens its own home, which may flash up for a
moment first. Only ambient mode (the idle adverts) and any ad trackers you name in `EXTRA_OFF` are
switched off, and `apply.sh` refuses to switch off anything the TV may need to start. Add
`PRIVACY=1` to also switch off the known tracking and ad apps it finds (Beta,
[PRIVACY.md](PRIVACY.md)). Nothing is deleted. It also hands the app your `config.json` settings (people, weather, clock, look, quick
buttons) for its built-in copy. **Read the Undo section before you run it.** It is safe to run as
often as you like, and on a TV set up by couch-tv 0.10 or older it switches the Google TV home and
the setup app back on ([why](TROUBLESHOOTING.md#if-your-tv-loops-after-a-restart)).

- **A Google TV update can switch ambient mode back on.** With option B the bridge checks once a
  day and switches it off again. With option A there is no bridge: run `apply.sh` again after an
  update (and after you change `config.json`).

**Option A with no computer** (reported by
[udhava2-stack](https://github.com/udhava2-stack), not tested by us). Apps on the TV and the phone
do the install instead of `apply.sh`:

1. Do step 1 (developer mode and USB debugging). Step 2 is not needed.
2. Copy `couch-tv-home.apk` from the Releases page onto a USB stick and plug it into the TV.
3. Install a file manager on the TV, for example
   [File Manager +](https://play.google.com/store/apps/details?id=com.alphainventor.filemanager).
   Open the APK on the USB stick and install it. The TV may ask you to allow installs from the file
   manager first.
4. On your phone, install
   [TV Launcher Manager](https://play.google.com/store/apps/details?id=com.tv.launcher.manager.adb.tvboxtools).
   It connects to the TV over Wi-Fi with ADB, so the TV asks you to allow it. Open **Setup
   Launcher**, pick couch-tv, then restart the TV.

**Option A with no computer at all, making it the home** (issue #98, on main, in the next release). If couch-tv installed and
shows up as an app but the Home button still opens the TV's own home, there is no computer step
left. On a plain Android TV 10 or newer, couch-tv asks Android to make it the home:

- Open couch-tv. The first time, it asks "Make couch-tv your home screen?" Choose Yes, then pick
  couch-tv in Android's own screen and press **Always**. Missed it? Home settings, About, **Make
  couch-tv your home screen** asks again. (The on-TV app, option C, does the same when you press
  **Use as home screen** on its setup screen.)
- Some Android TV 11 builds also show **Select a home app** the first time you press Home. Pick
  couch-tv and **Always**.
- **Home still opens the TV's own home?** Some TVs (a Haier, issue #98) open their own launcher by
  name and ignore Android's default home. In the on-TV app press **Home button watch** and switch
  on **Couch TV home watch**: it brings couch-tv back when the TV's own home comes forward. It sees
  which screen came forward and reads nothing else.
- **Google TV is different.** Google's own home can keep the Home button, so asking Android is not
  enough there. A computer runs `apply.sh` once, which switches on the Home button watch that
  brings couch-tv back when Home opens Google's.
- Never switch off or uninstall the TV's own home. couch-tv does not need that.

Good to know:

- Neither app is part of couch-tv and we have not checked them. TV Launcher Manager gets the same
  ADB access to your TV that a computer would.
- It may switch off the Google TV home. If it does, switch **Google TV Home** and **Setup** back
  on (Settings, Apps, See all apps, Show system apps, Enable) before you restart the TV: on some
  Google TVs a restart without them loops ([why](TROUBLESHOOTING.md#if-your-tv-loops-after-a-restart)). The app does
  not get your `config.json`. Change the look and the people in
  [Settings on the TV](../README.md#settings-on-the-tv).
- If a Google TV update brings the Google home back, run **Setup Launcher** again.
- To undo, use the TV-remote steps in [Undo](#undo-put-the-google-home-screen-back).

## Building the app (instead of downloading it)

You need **JDK 21** and the **Android SDK** with platform 34 and build tools 34. Gradle is not
needed: `tv-home/android/gradlew` fetches Gradle 8.11.1 by itself.

1. JDK 21. The simplest way, with no password needed: download the Temurin 21 JDK `.tar.gz`
   for your computer from [adoptium.net](https://adoptium.net/temurin/releases/?version=21), unpack
   it into a folder you own (for example `couch-tv/build/jdk`, which git ignores) and point
   `JAVA_HOME` at it (on macOS the `Contents/Home` folder inside). Or install it system-wide:
   macOS `brew install --cask temurin@21` (asks for your password), Linux
   `sudo apt install openjdk-21-jdk`.
2. The Android SDK command line tools: download "Command line tools only" from
   [developer.android.com/studio](https://developer.android.com/studio), unzip into
   `~/Library/Android/sdk/cmdline-tools/latest` (macOS) or `~/Android/Sdk/cmdline-tools/latest`
   (Linux).
3. Then, with `ANDROID_HOME` set to that `sdk` folder:
   ```sh
   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0"
   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses     # answer y to each licence
   ```
4. Build:
   ```sh
   JAVA_HOME=/path/to/jdk-21 ANDROID_HOME=/path/to/android-sdk sh scripts/build-apk.sh
   ```
   It prints where the APKs are (`dist/couch-tv-home.apk`, plus `dist/couch-tv-ontv.apk` for
   option C, and `dist/couch-tv-sync.apk`, the experimental two TV sync helper,
   [SYNC.md](SYNC.md)). The on-TV app carries the phone remote inside it, so for that one the script builds
   `remote/` first, which needs **Node 20.19 or newer**. `apply.sh` finds `dist/couch-tv-home.apk`
   by itself.

The release APK is signed with your local debug key, which is fine for your own TV. The built-in
copy uses `config.example.json` unless you pass `CONFIG=config.json`; `apply.sh` hands the TV your
own settings either way. Home settings, Updates offers the releases of `Seagey/couch-tv`, which
your own build cannot take (another key): a fork with releases of its own builds with
`UPDATE_REPO=owner/name sh scripts/build-apk.sh`, and `UPDATE_REPO=` (empty) switches updates off.

## Undo: put the Google home screen back

The full guide, with the TV-remote-only way and what to do if something is stuck:
[UNINSTALL.md](UNINSTALL.md). In short:

1. **Option B: stop the bridge first**, or its daily check switches ambient mode off again
   (macOS: `launchctl bootout gui/$(id -u)/app.couchtv.bridge`; Linux:
   `systemctl --user disable --now couch-tv-bridge`).
2. Everything off, including developer mode:
   `TV_IP=<your tv address> DEV_OFF=1 sh tv-home/tools/remove-all.sh`. If the computer cannot reach
   the TV it says so, changes nothing and prints the TV-remote steps.

Only the home screen, keeping the app (10 seconds): `TV_IP=<your tv address> sh tv-home/tools/undo.sh`.
It switches back on what `apply.sh` switched off (and the Google TV home and setup app, in case an
older couch-tv switched them off), and makes the home the TV had before the home again. To remove the app as well, after that:
`TV_IP=<your tv address> .venv/bin/python tv-home/tools/tvadb.py shell "pm uninstall app.couchtv.launcher"`.

With only the TV remote (no computer):

1. On the couch-tv home, open the **Settings** tile (the gear at the end of the app row), or press
   the Settings button on your remote, and pick **TV settings**.
2. **Apps**, then **See all apps**, then **Show system apps**.
3. If **Google TV Home** or **Setup** (the Google TV setup app) says Disabled, open it and press
   **Enable** (couch-tv 0.10 and older switched them off). Ambient mode and the ad tracker are
   optional. Then open **Settings, Accessibility** and switch off **Home button watch**.
4. Back in **Apps**, open **Home** (the new one) and press **Uninstall**.
5. Press the Home button. Google TV is back.

Do step 3 before step 4. If the new home is removed while Google TV Home is still off, the TV has
no home screen. Apps still open from the remote's app buttons, and the computer undo above still
works.

If the TV ever lost its saved Wi-Fi after an older couch-tv switched the setup app off, enable
**Setup** again (step 3) and set the Wi-Fi from there.
