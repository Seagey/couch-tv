# couch-tv Setup

The free, official way to put couch-tv on your TV **without a command line and without an AI
agent**. You open one app on your computer, it opens a page in your browser, and it walks you
through it. About ten minutes, most of it with the TV remote. You can undo all of it.

It puts couch-tv's home screen on the TV (option A in the main README): no computer needs to stay
on afterwards. It can add the phone remote too (the "lives on the TV" app).

## Which TVs

| TV | |
|---|---|
| **Google TV** (Sony, TCL, Hisense, Philips, Chromecast with Google TV, Google TV Streamer and others) | Yes. You type a 6 digit code from the TV's Wireless debugging screen. |
| **Android TV** | Yes if Developer options has Wireless debugging (then as above) or Network or USB debugging that opens the network port (then you press Allow on the TV). Some older Android TVs never ask to Allow a new computer over Wi-Fi: the app says so and stops, and those need a computer with a USB cable once. |
| **Fire TV** on Fire OS 6, 7 and 8 | Yes, with ADB debugging and Allow. Amazon's home flashes up for a moment before couch-tv comes back. |
| **Samsung, LG, Roku** | Not with this app. couch-tv runs on them with a computer at home that stays on: see the main README. |
| **Apple TV, Hisense VIDAA, Fire TV on Vega OS** | No. A Google TV box plugged into the TV works. |

## Get it

From the newest [release](https://github.com/Seagey/couch-tv/releases/latest), download the zip
for your computer and unzip it:

| Computer | Download | Open |
|---|---|---|
| Mac with Apple silicon (M1 and newer) | `couch-tv-Setup-mac-apple-silicon.zip` | **couch-tv Setup** |
| Mac with an Intel chip | `couch-tv-Setup-mac-intel.zip` | **couch-tv Setup** |
| Windows 10 or 11 | `couch-tv-Setup-windows.zip` | **couch-tv Setup.exe**, inside the unzipped folder |

Not sure which Mac? Apple menu, **About This Mac**: "Chip: Apple M..." is Apple silicon,
"Processor: ... Intel" is Intel. `SHA256SUMS-setup.txt` in the same release lists each zip's
checksum, if you want to check your download.

### The first time you open it

The app is free and not signed with a paid Apple or Microsoft developer account, so your computer
asks once whether you trust it.

**Mac:**
1. Double-click **couch-tv Setup**. macOS says it cannot check it for malicious software. Press **Done** (or OK).
2. Open **System Settings, Privacy and Security**. Scroll down to the message about couch-tv Setup and press **Open Anyway**. Type your Mac password if it asks.
3. Double-click the app again and press **Open**.
4. When it asks to **find devices on your local network**, press **Allow**. That is how it reaches the TV.

**Windows:**
1. Double-click **couch-tv Setup.exe**. If "Windows protected your PC" (SmartScreen) shows, press **More info**, then **Run anyway**.
2. If Windows asks whether couch-tv Setup may use networks, allow **Private networks**.
3. Keep `couch-tv Setup.exe` in its folder: it needs the `_internal` folder next to it.

The app has no window of its own: the setup is the page in your browser. When you are done, press
**Close setup**. If you just close the tab, it stops by itself a few minutes later.

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

## What stays on your computer

Its own folder: `~/Library/Application Support/couch-tv Setup/` on a Mac, `%APPDATA%\couch-tv Setup\`
on Windows: the key the TV allowed (`adbkey`, `adbkey.pub` and a certificate made from it), and
`changed.json` (what it changed on which TV). The downloaded apps are cached in
`~/Library/Caches/couch-tv Setup/` or `%LOCALAPPDATA%\couch-tv Setup\Cache\`. Delete the folders to
forget everything. The TV lists the key as **couch-tv-setup** under Wireless debugging, Paired
devices, where you can Forget it.

**Nothing is sent anywhere** except the download from GitHub and, only if you type one, a place
name to Open-Meteo for the weather. No accounts, no tracking, no AI.

## For developers

```sh
cd setup-app
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r requirements.txt
.venv/bin/python -m couchtv_setup                    # opens the page
.venv/bin/python -m unittest discover -s tests       # 44 tests, no TV needed
.venv/bin/python couch-tv-setup.py --self-test       # pairs with itself, as the built app does in CI
```

| Variable | Use |
|---|---|
| `COUCHTV_SETUP_APK_DIR=<folder>` | Install `couch-tv-home.apk` and `couch-tv-ontv.apk` from that folder (your own build) instead of the release |
| `COUCHTV_SETUP_PORT` | A fixed port for the page (otherwise any free one) |
| `COUCHTV_SETUP_NO_BROWSER=1` | Do not open the browser |
| `COUCHTV_SETUP_HOME` | Keep the setup's own files somewhere else |
| `COUCHTV_SETUP_ADBKEY` | Use another ADB key file |

How it fits together, and why there is no Google `adb` inside: [BUILD.md](BUILD.md). The pairing
protocol is in `couchtv_setup/pairing.py` and `spake2.py`, each with a description at the top.
The builds come from `.github/workflows/setup-app.yml`.

## Credits

The Fire TV setup builds on [couch-tv-setup](https://github.com/killy10o10/couch-tv-setup) by
killy10o10 (MIT). Which parts, and the security review done before reusing them:
[REVIEW-killy10o10.md](REVIEW-killy10o10.md) and [THIRD-PARTY.md](THIRD-PARTY.md).
