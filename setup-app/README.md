# Couch TV Setup

The free, official way to put couch-tv on your TV **without a command line and without an AI
agent**. You open one app on your computer, it opens a page in your browser, and it walks you
through it. About ten minutes, most of it with the TV remote. You can undo all of it.

It puts couch-tv's home screen on the TV (option A in the main README): no computer needs to stay
on afterwards. It can add the phone remote too (the "lives on the TV" app).

## Which TVs

**Works with:**

| TV | |
|---|---|
| **Google TV** (Sony, TCL, Hisense, Toshiba, Philips, Panasonic Google TVs, Chromecast with Google TV, Google TV Streamer and others) | Yes. Android 12 or newer: you type a 6 digit code from the TV's Wireless debugging screen. Android 11 (many 2021 and 2022 Hisense, Toshiba and TCL Google TVs, which have no Wireless debugging): you switch on USB debugging and press Allow when the TV asks; no cable. |
| **Android TV** 7.1 and newer | Yes if Developer options has Wireless debugging (then as above), or if the TV asks "Allow USB debugging?" over Wi-Fi once Network or USB debugging is on (then you press Allow). |
| **Fire TV on Fire OS** 6, 7 and 8 (sticks, Cubes, Fire TV TVs) | Yes, with ADB debugging and Allow. Amazon's home flashes up for a moment before couch-tv comes back. |

**Does not work with this app:**

| TV system | |
|---|---|
| **Samsung (Tizen)** | couch-tv still works, through a computer at home that stays on (the bridge): [docs/SAMSUNG.md](../docs/SAMSUNG.md). Not through this app. |
| **LG (webOS)** | The same, through the bridge: [docs/LG.md](../docs/LG.md). Not through this app. |
| **Roku OS** (Roku TVs and sticks) | The same, through the bridge: [docs/ROKU.md](../docs/ROKU.md) (not yet tried on a real Roku). Not through this app. |
| **VIDAA** (Hisense's own system) | No. |
| **Apple TV (tvOS)** | No. |
| **Fire TV sticks on Vega OS** (Fire TV Stick 4K Select, Fire TV Stick HD 2026, Fire TV Stick 4K 3rd gen) | No: Vega OS cannot install apps. |
| **Panasonic with My Home Screen or TiVo OS**, and **TiVo OS** on any brand | No. (Panasonic's Fire TV models run Fire OS and work like a Fire TV; its Google TV models work.) |
| **Philips with Saphi or Titan OS** (most 2025 and all 2026 Philips TVs) | No. (Philips Google TV and Android TV models work.) |

A Google TV box (for example the Google TV Streamer) plugged into any of these gets everything.

**When the TV never asks "Allow USB debugging?":**
- Some Android TVs and Android 11 Google TVs never ask for a new computer over Wi-Fi (seen on a Toshiba Google TV, Android 11). The app then walks through what usually fixes it, one screen at a time with a Try again each: go to the home screen and wait, switch USB debugging off and on, clear the computers the TV remembers (only when this computer was never allowed), restart the TV. If the TV still says no, it shows how to put couch-tv on with just a phone (the Downloader app, code 8180170, then the Couch TV app shows the address to open on the phone). Nothing is changed on the TV.

**Android 6 and 7.0 TVs** (for example the Xiaomi Mi TV 4A with PatchWall): couch-tv is set up from a computer with the guide in this README. The app stops and says so.

## Get it

From the newest [release](https://github.com/Seagey/couch-tv/releases/latest), download the file
for your computer and unzip it:

| Computer | Download | Open |
|---|---|---|
| Mac with Apple silicon (M1 and newer) | `couch-tv-Setup-mac-apple-silicon.zip` | **Couch TV Setup** |
| Mac with an Intel chip | `couch-tv-Setup-mac-intel.zip` | **Couch TV Setup** |
| Windows 10 or 11 | `couch-tv-Setup-windows.zip` | **Couch TV Setup.exe**, inside the unzipped folder |
| Linux, 64 bit Intel or AMD (Ubuntu 22.04 or newer, Debian 12, Fedora, Arch and Omarchy) | `couch-tv-Setup-linux.tar.gz` (from 0.13.13) | **Couch TV Setup**, inside the unpacked folder |

From 0.13.15 the app, its folder and the program are called **Couch TV Setup** (they were "couch-tv Setup"). The zip and tar.gz file names are unchanged. An installed Helper that updates itself moves its start with the computer entry (and the Windows link) to the new name.

Not sure which Mac? Apple menu, **About This Mac**: "Chip: Apple M..." is Apple silicon,
"Processor: ... Intel" is Intel. `SHA256SUMS-setup.txt` in the same release lists each file's
checksum, if you want to check your download.

### The first time you open it

The app is free and not signed with a paid Apple or Microsoft developer account, so your computer
asks once whether you trust it.

**Mac:**
1. Double-click **Couch TV Setup**. macOS says it cannot check it for malicious software. Press **Done** (or OK).
2. Open **System Settings, Privacy and Security**. Scroll down to the message about Couch TV Setup and press **Open Anyway**. Type your Mac password if it asks.
3. Double-click the app again and press **Open**.
4. When it asks to **find devices on your local network**, press **Allow**. That is how it reaches the TV. If you missed it, the app says "Your Mac blocked this app from finding the TV": open **System Settings, Privacy and Security, Local Network**, switch on **Couch TV Setup**, then press **Look again**.

**Windows:**
1. Double-click **Couch TV Setup.exe**. If "Windows protected your PC" (SmartScreen) shows, press **More info**, then **Run anyway**.
2. If Windows asks whether Couch TV Setup may use networks, allow **Private networks**.
3. Keep `Couch TV Setup.exe` in its folder: it needs the `_internal` folder next to it.

**Linux:**
1. Unpack it: `tar -xzf couch-tv-Setup-linux.tar.gz` (or open it in your file manager).
2. Run `"Couch TV Setup/Couch TV Setup"` from a terminal, or double-click it in the folder. Keep it in its folder: it needs the `_internal` folder next to it.
3. It opens the setup page in your browser. Nothing else to install: it talks to the TV over your Wi-Fi with its own ADB, so it needs no `adb` program, no USB cable and no udev rule. The website's Set up my TV button cannot open it on Linux: sign in with the code it shows instead.
4. If a firewall is on (ufw, firewalld), allow it on your home network, or it cannot hear the TV: the app says "This computer blocked this app from finding the TV". With ufw: `sudo ufw allow 5353/udp` for the TV's name announcements.

The app has no window of its own: the setup is the page in your browser. When you are done, press
**Close setup**. If you just close the tab, it stops by itself after a few minutes.

## What it does to the TV

Nothing changes on the TV until you press **Yes, set it up** on the plan it shows you. Then, the
same as the repo's `tv-home/tools/apply.sh`:
- installs the couch-tv home from our GitHub release, after checking its SHA-256 checksum;
- makes it the home screen, and switches on its Home button watch (it only notices when the TV's
  own home comes forward, and puts couch-tv back on top);
- switches off ambient mode (the idle adverts), only if you leave that ticked;
- **never** switches off or deletes the TV's own home screen or setup app, so the TV always has
  them when it starts;
- writes down what it changed, on the TV and on this computer, so Undo puts it back from any computer.

**Undo:** open the app and choose **Take couch-tv off a TV**. It switches back on what it switched
off, puts the TV's own home back, then removes the couch-tv apps. Or by hand, with the remote:
[docs/UNINSTALL.md](../docs/UNINSTALL.md).

## Extra features (Couch TV Helper)

The last screen asks: **Done**, or **Add extra features**. The TV works on its own either way. The helper
is a small part of this same app that stays in your menu bar (Mac) or tray (Windows, Linux) and adds:
turn the TV on from your phone, Ask AI on your home computer, picks. A Samsung, LG or Roku TV needs it to
open Couch TV and run the phone remote. It has no AI of its own and needs no coding. **Start with this
computer** is a tick box, off until you pick it. **Turn off extra features** in its menu stops it and
removes the start-up item. Reopen Setup any time to turn it on again.

It checks for a newer version of itself (the new version must carry Couch TV's signature, and is only used when you press **Update ready, restart**), keeps the computer awake on power only when a Samsung, LG or Roku TV needs it (**Let this computer sleep** overrides that), and **Remove everything from this computer** deletes what Setup keeps here.

## What stays on your computer

Its own folder: `~/Library/Application Support/couch-tv Setup/` on a Mac, `%APPDATA%\couch-tv Setup\`
on Windows, `~/.local/share/couch-tv-setup/` on Linux: the key the TV allowed (`adbkey`, `adbkey.pub` and a certificate made from it), and
`changed.json` (what it changed on which TV), and, once a TV was linked to an account, `linked-tvs.json` (which row of My
TVs it is, under a hash of the TV and the account). The downloaded apps are cached in
`~/Library/Caches/couch-tv Setup/`, `%LOCALAPPDATA%\couch-tv Setup\Cache\` or `~/.cache/couch-tv-setup/`. Delete the folders to
forget everything. The TV lists the key as **couch-tv-setup** under Wireless debugging, Paired
devices, where you can Forget it.

**Nothing is sent anywhere** except the download from GitHub and, only if you type one, a place
name to Open-Meteo for the weather. No tracking, no AI.

**If you link your Couch TV account** (the website's **Set up my TV** button, or its code typed on the
first page): Setup first shows whose account it is (the name, and the email with most of it covered) and waits for
your **Yes, link it**. Before that Yes it sends only the code, and nothing about any TV. After it, Setup sends your account:

- the room name you typed, and the TV's make, model, system, Android version, memory, screen size, whether it lets
  Couch TV be its home, and its Couch TV version;
- the package names of the apps with an icon on that TV (such as `com.netflix.ninja`, at most 300). Never what is
  in them, who is signed in, or what is watched. Couch TV Studio uses them to put the apps you have first;
- after an install, how smoothly the TV drew Couch TV for 8 seconds, with its chip and graphics names.

Setup gets your design and Your home details for that TV (people, their colours, which are kids, and the town, which
Setup looks up with Open-Meteo to set the weather; photos and guest Wi-Fi only when the website's button opened
Setup), and writes the TV's own account link into Couch TV on the TV. Studio keeps the TV's details, its app names and when it last
checked in until you remove the TV in My TVs (last checked in: until you unlink it). Setup's sign in ends after 2 hours, with **Sign out** in Setup, or with
**Sign out Couch TV Setup** on the website's account page. A health report (Couch TV's versions, free space, memory, its last crash and its own log
lines, addresses and e-mails blanked out) is only sent if you press **Send a health report** after
seeing all of it, and is kept 30 days. The account link is kept in memory only, never on this computer's disk.

## Finding the TV

Setup looks on the Wi-Fi by itself and keeps looking while the list is open: the TVs' own
announcements (Android TV Remote, Cast, Wireless debugging and its pairing screen, plain ADB), a knock on
ports 5555 and 6466 across this computer's network, confirmed by the first ADB message (CONNECT, which
holds no key, so the TV shows nothing), and DIAL names. Each TV shows **Ready**, **Type the code** or
**1 step on the TV** with the steps for its Android version. TVs Setup cannot put Couch TV on (Tizen,
webOS) are listed as found, with no button.

## For developers

```sh
cd setup-app
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/python -m couchtv_setup                    # opens the page
.venv/bin/python -m unittest discover -s tests       # 157 tests, no TV needed
COUCHTV_SETUP_ADBKEY=~/.android/adbkey .venv/bin/python tests/emulator_check.py --port 5591 --install   # Android TV emulator only
.venv/bin/python couch-tv-setup.py --self-test       # pairs with itself, as the built app does in CI
```

| Variable | Use |
|---|---|
| `COUCHTV_SETUP_APK_DIR=<folder>` | Install `couch-tv-home.apk` and `couch-tv-ontv.apk` from that folder (your own build) instead of the release |
| `COUCHTV_SETUP_PORT` | A fixed port for the page (otherwise any free one) |
| `COUCHTV_SETUP_NO_BROWSER=1` | Do not open the browser |
| `COUCHTV_SETUP_HOME` | Keep the setup's own files somewhere else |
| `COUCHTV_SETUP_ADBKEY` | Use another ADB key file |
| `COUCHTV_SETUP_STUDIO=off` | Do not talk to the Couch TV Studio account API (linking is on by default) |
| `COUCHTV_SETUP_STUDIO_URL` | Another Studio address (https, or http on 127.0.0.1 for development) |
| `COUCHTV_SETUP_STUDIO_STUB=<file.json>` | Answer the account calls from a file instead (development) |
| `COUCHTV_SETUP_FAKE_SCAN=<file.json>` | Use recorded discovery answers instead of the network (screenshots) |

How it fits together, and why there is no Google `adb` inside: [BUILD.md](BUILD.md). The pairing
protocol is in `couchtv_setup/pairing.py` and `spake2.py`, each with a description at the top.
The builds come from `.github/workflows/setup-app.yml`.

## Credits

The Fire TV setup builds on [couch-tv-setup](https://github.com/killy10o10/couch-tv-setup) by
killy10o10 (MIT). Which parts, and the security review done before reusing them:
[REVIEW-killy10o10.md](REVIEW-killy10o10.md) and [THIRD-PARTY.md](THIRD-PARTY.md).
