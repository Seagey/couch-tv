## couch-tv 0.13: Android 6, Serbian, new looks and sounds, a safer bridge

Thank you to everyone who sent a report, a fix or a whole feature. This is the biggest release so far, and almost all of it came from you. Names are GitHub usernames.

### Do this after updating

- **Update the TV apps** (Home settings, Updates, check now, or reinstall the two APKs). The bridge and the option B home run from your copy of this repo, so run `git pull` and restart the bridge.
- **Android TV 10 or newer:** the first time you open couch-tv it asks "Make couch-tv your home screen?". Choose Yes, pick couch-tv and press **Always**. Missed it? Home settings, About, **Make couch-tv your home screen**.
- **TCL:** open couch-tv once after updating so the new TV input is switched on. If Home still goes back to Google TV after a restart, the steps in the README under "TCL" still apply.
- **If you wrote your own scripts for the bridge:** POST requests now need `Content-Type: application/json` (curl: `-H 'Content-Type: application/json'`), and `/api/home` takes JSON only. Anything else gets a 415. Web pages on other sites are refused.
- **Pairing key:** unchanged. It is still off unless you switch it on, and a key you already set keeps working. To use it on the TV apps you need 0.13 or newer ([how](docs/CONFIG.md#switching-the-pairing-key-on)).
- LG, Samsung and Roku apps are built on your computer, so rebuild them to get the changes below.

### New features
- **Android 6 TVs** can install both apps (experimental, checked on an emulator only) (#59, thanks @Harshrajp676).
- **Make couch-tv the home with no computer** on Android TV 10 or newer, plus an optional **Home button watch** in the on-TV app for TVs that ignore the default home (#98, thanks @whyashpaliwal).
- **Look:** OLED Cinema (pure black), Follow the sun (@ekagra-codes, #79, #57), Lighter home for slow boxes (#58, thanks @likith007156), Moving tiles switch (#52, thanks @farmersdance), and ambient weather effects over the scenes, off to start (@ekagra-codes, #88).
- **Now playing:** a full screen view with album art, animated soundwaves and remote controls, off to start (@ekagra-codes, #84, #91).
- **New quick buttons:** Soundscapes (rain, fireplace, ocean, brown noise) (@ekagra-codes, #81), Screen off for audio only listening (@ekagra-codes, #100) and a Bluetooth headphones button (@ekagra-codes, #92).
- **Stremio:** its own Continue Watching shows in Keep watching, with no account (@haydenbudd, #87). You can also hide the whole Keep watching row (#106, thanks @Bronze133).
- **HDMI inputs on the dock**, hide a Keep watching card, and bedtime dimming (@ekagra-codes, #74).
- **Down from the dock** opens the full apps view. Your own photo limit is now 50 (#99, thanks @marko96).
- **Roku:** a first Roku version, built from Roku's documentation and not yet run on a real Roku.
- **Two TVs in sync** (experimental): the same show on two TVs within a few hundredths of a second. See docs/SYNC.md.
- **Docker** example for the bridge, from @ChrisFWCB's setup (#56).
- **Setup apps:** a paired `/api/home` switch, so a phone or setup tool can turn Use as home screen on and off, and saves show on the TV straight away (@killy10o10, #104, #105).

### New TVs and languages
- **Serbian (Latin)** for the TV home and the phone remote (@marko96, #103).
- **LG:** the phone touchpad drives the Magic Remote pointer, Developer Mode countdown and warning (translated), power on that survives a stale connection, Italian logos, and the build fetches the TV's own icons (@whitexcdghk, @atishay-kasliwal, @Akdex, @wojowar, @BireshwarChakravarty, @ChrisFWCB). webOS 26 notes. Nine real LGs reported so far.
- **Samsung:** a Sky tile for a box on HDMI, Prime Video opens, sound blips and Wi-Fi dropouts fixed, opens at once from a saved app list, and new US apps (@philehaynes, @alexdurkinbrown). A Smart Monitor M8 is reported working (@getriri).
- **Fire TV and Google TV:** TCL and Google TV home fixes (@farmersdance, @jkriek7, @frankelsteve-a11y), Fire OS 6 fixes (@drharcho), Settings no longer pulls you back to couch-tv (@Tarzansaurus), and a burst of Home presses ends on couch-tv (@jcalmeida).

### Fixes
- The Screensaver button now shows on Android 11 and newer (@haydenbudd, #86).
- The Home button watch works on more TVs (@ImCodingCat, #83).
- At power on the home waits for Wi-Fi before its first try at the bridge (@frankelsteve-a11y, #95).
- The TV's own TV and channels keys work again (@digitaldarkmatterltd, #90).
- The home follows a person switch made on the phone (@whitexcdghk, #68).
- Old Android WebViews lay the home out properly (#59).
- Watch Next says why an untitled play finds no row, and `GET /api/watch-next` shows it (@alonmustafa, #23).
- If Disney+ signs you out when the TV turns off, `close_on_off` can close it first.

### Security
- Optional **pairing key** for the bridge API, a tighter origin list, a Host name check, JSON only POSTs, and a limit on wrong keys (@ekagra-codes, #73, #78, #85).
- App names with shell characters are refused before they reach the TV's shell (#72).
- A missing Local Network or Nearby devices permission is explained (@whitexcdghk, #69).

### Docs and tests
- The README was checked line by line against the code and corrected. TCL, LG, Samsung and Fire TV notes, and tests that run on the real config (@ekagra-codes, #76).

### Files and checksums
`couch-tv-home.apk`, `couch-tv-ontv.apk` and `couch-tv-sync.apk`, with `SHA256SUMS.txt`. They are signed with the same key as every earlier release, so they install over 0.12.
