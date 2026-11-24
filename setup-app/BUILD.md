# Couch TV Setup: BUILD

## Intent

seagey, 11 November 2026: an official, free Couch TV Setup app in this repo, released from our
GitHub, so a non technical person can put couch-tv on their TV with **no AI and no command line**.
It covers Google TV (the 6 digit Wireless debugging pairing code), Android TV and Fire TV.
killy10o10 built a Fire TV setup app first; where his steps are good we reuse them and credit him,
"but I don't want to give him full credit because we are kind of designing the same thing so
must've some way we can attribute but not turn it all over to him". Approved: "Yes to go".

**It worked if:** someone who has never opened a terminal downloads one file from our GitHub,
opens it, and ends with the couch-tv home on their Google TV, Android TV or Fire TV, or is told
plainly, early and with nothing changed, that their TV cannot do it this way and what can.

## Plan

1. Security review of killy10o10/couch-tv-setup first (`REVIEW-killy10o10.md`). Reuse only what
   passes, his MIT notice at the top of each reused file and in `THIRD-PARTY.md`.
2. A desktop app (macOS Apple silicon and Intel, Windows) that opens a page on this computer only
   (127.0.0.1, a random port, a secret per run) and walks through:
   find the TV (mDNS names and port 5555 on the home Wi-Fi), say what it is (`check-tv.py`'s
   knock), stop kindly for Samsung, LG and Roku; Developer options; Google TV: Wireless debugging
   and the pairing code, Android TV and Fire TV: debugging and the Allow prompt; read the plan back
   and wait for a yes; download the latest `couch-tv-home.apk` from our Releases and check its
   SHA-256; set it up exactly as `apply.sh` does for option A; press Home and check; offer the
   phone remote (the on-TV app); offer to switch debugging off; Undo as in `docs/UNINSTALL.md`.
3. Pairing in Python, no Google `adb` (see "Pairing" below).
4. GitHub Actions builds the three apps, runs the tests and a smoke test on each, and adds them to
   a couch-tv release when one is published.
5. Checksums for every release file: `scripts/release-checksums.sh` writes `SHA256SUMS.txt`.
6. README: a short section for the app, the credit line "The Fire TV setup builds on
   couch-tv-setup by killy10o10", and killy10o10's app under "Community tools", under ours.

### Non goals

- No paid signing or notarisation: the apps are unsigned, and the README says how to open them.
- No Linux build (it runs from source there: `python -m couchtv_setup`).
- No USB. A TV that cannot be reached over Wi-Fi is told so and stops.
- No Samsung, LG or Roku setup in the app (they need the computer bridge: the GitHub guide).
- No option B (the bridge) and no Claude, no API key, nothing that costs money.
- No telemetry. The only calls out are GitHub (the release), Open-Meteo (only if a weather place
  is typed) and the TV itself.
- Nothing of Amazon's switched off on Fire TV, and no ad tracker list: only what `apply.sh`
  switches off (ambient mode, with a yes).
- killy10o10's two couch-tv fixes (a paired POST /api/home on the on-TV app, and a push to the home
  after /api/settings and /api/app-order saves) are his pull requests, not built here.
- Not merged, not released, no tags: a draft pull request.

### The numbers

| | |
|---|---|
| Download | about 13 to 14 MB zipped: Apple silicon 13 MB (built here, 32 MB unpacked), Intel Mac 14 MB and Windows 13 MB (CI) |
| Time to set up | about 10 minutes: 5 at the TV with the remote (Developer options), pairing and connecting 4 s, the home app download 2 s and copy about 45 s over Wireless debugging (21.8 MB measured), the rest a minute |
| Which TVs | Google TV on Android 11 and newer (pairing code); Android TV with Network or USB debugging on port 5555 (Allow prompt); Fire TV on Fire OS 6 to 8. Not: Samsung, LG, Roku (the bridge), Apple TV, VIDAA, Vega OS Fire TV |
| What leaves the computer | the release download from GitHub; a typed place to Open-Meteo; nothing else |

## Pairing (how, and why not Google's adb)

**Choice: our own Python, MIT, no Google binary.**

- **Bundling Google's platform-tools `adb`:** the binaries come under the Android SDK License
  Agreement, section 3.4: "you may not copy (except for backup purposes), modify, adapt,
  redistribute ... the SDK or any part of the SDK", except where an open source licence applies
  (3.5). adb's source is Apache-2.0 (AOSP), but whether Google's prebuilt binary counts as that
  open source component is not something to bet a public release on. Building adb from AOSP for
  three platforms is a project of its own. And on a Mac a newly downloaded `adb` can be blocked by
  Local Network permission without a prompt (seen here, AGENTS.md step 0.5), which a
  non technical person cannot diagnose. So no.
- **Existing Python:** `adb-shell` (Apache-2.0, already used by the bridge) has no pairing and no
  TLS. `adb-shell-wifi` (a fork, one release, May 2026) adds pairing through `spake2-cffi`, an
  LGPL-2.1 compiled C library: too young to trust, and awkward to bundle. warner's `python-spake2`
  (MIT) is a different SPAKE2 (other M and N points, other transcript), so it would not pair.
- **What we built:** `spake2.py` (SPAKE2 over edwards25519 exactly as BoringSSL does it, pure
  Python, about 150 lines), `pairing.py` (the AOSP pairing protocol: TLS 1.3, exported keying
  material, SPAKE2, AES-128-GCM PeerInfo exchange), `adbtls.py` (the STLS upgrade so adb-shell
  works over Wireless debugging), `mdns.py` (finds the pairing and connect ports). TLS with
  keying material export needs pyOpenSSL (Apache-2.0) and cryptography (pinned at 48.0.1, the last
  with an Intel Mac build).

## Changes to the plan

- **Phone remote:** planned as "offer the on-TV app's phone remote pairing". Built as: install the
  on-TV app with its grants (on-tv/README.md), re-assert couch-tv as the home (a TCL drops it after
  any install), then show the phone address and put a code on the TV. Giving the on-TV app its own
  Wireless debugging pairing (for keys and typing) is left to its own setup page, which already
  does it, rather than relayed through this app.
- **Settings:** names and a weather place are asked (optional) and sent the way `apply.sh` sends
  `config.json` (`config_b64`); everything else is set later on the TV (Home settings).
- **TCL:** also `appops set app.couchtv.launcher AUTO_START allow` on TCL TVs only, and a note to
  check the Accessibility switches, from the TCL fix in AGENTS.md (#94).
- **A TV already running couch-tv:** the plan warns that a bridge (option B) TV would be switched
  to the TV only home, and Undo says to stop the bridge first.
- **Fire TV, from killy10o10's review on his Fire TV Stick 4K (2nd gen, Fire OS 8.1.8.5), 11 Nov:**
  (1) Fire OS keeps Amazon's home as the chosen one, so the "did the TV take couch-tv as its home"
  hard stop no longer applies on Fire OS: the Home button watch and the Home check decide there
  (Google TV and Android TV still stop). (2) The Fire OS version comes from `ro.build.version.name`
  (`ro.build.version.fireos` said 8.0 on 8.1.8.5). (3) After switching the watch on, the app reads
  the whole "Bound services" list of `dumpsys accessibility` (it runs over several lines when
  another service is bound) and, if the watch is not running yet, asks for one restart and a check
  again. (4) Another launcher with its own accessibility service switched on (Projectivy, Wolf, or
  any app with a home screen) gets a one line warning, in the plan and after setup; it is never
  switched off.
- **The Android 11 test TV result changed the "honest stop" wording:** see Verified. The stop screen still
  exists for TVs that never ask.

## Verified

Run on 11 November 2026 on a Mac (macOS 27, Apple silicon), Python 3.11, with two real TVs that both run a live couch-tv bridge home.

| What | How | Result |
|---|---|---|
| SPAKE2, pairing framing, TLS keying material, AES-GCM | our pairing **server** against Google's own `adb pair` (Android Debug Bridge 1.0.41), localhost, throwaway HOME | "Successfully paired"; a wrong code refused |
| Pairing **client** on a real TV | TV 1: a 98 inch Google TV, Android 14, Wireless debugging pairing code | paired, then a full shell (uid 2000, input group) over TLS, no Allow prompt |
| The app end to end on that TV, through its own API | find (both TVs by their own names, 9 s), pairing port found by mDNS by itself (matched the screen), pair and connect 4.0 s, facts, plan, undo plan | all as expected. **No install there:** that TV runs the live bridge home (option B) and must not be switched to option A |
| Download and copy on that TV | `couch-tv-home.apk` v0.12 from Releases, SHA-256 checked against GitHub's digest (2.1 s); 21.8 MB pushed over TLS in 43.7 s; md5 matched on the TV; deleted | ok, nothing left in /data/local/tmp |
| TV 2: an Android 11 TV with the Google TV home, port 5555 open | the app's new key over 5555 | **the TV showed "Allow USB debugging?"** (an earlier test that day saw none). Allowed for this session only (Always allow left unticked); connected in 25 s; facts, plan and undo plan read. Reconnecting after showed the prompt again, so nothing was kept. No install (live bridge TV) |
| Not allowed in time | the same TV, prompt left unanswered | `not_allowed`, which shows the stop screen |
| Unit tests | `python -m unittest discover -s setup-app/tests`: 51 tests, a pretend TV for every apply.sh and undo step, pairing client against server, a pretend Wireless debugging TV for the TLS upgrade, mDNS parsing, the release checks, the page server's locks | OK |
| Clean install from hashes | `pip install --require-hashes -r requirements.txt` in a fresh venv, then the tests | OK |
| Built app | PyInstaller 6.16.0 on this Mac; `--self-test` pairs with itself inside the bundle; `tests/smoke.py` | OK, 13.3 MB zip |
| The repo's own checks | `py_compile` of bridge, scripts and tools; shell scripts parse; the repo's 169 Python tests | OK |
| CI (`setup-app.yml`) | Apple silicon Mac, Intel Mac and Windows: hash checked install, 51 tests, PyInstaller build, `--self-test` and smoke test inside the built app | passed on the pull request |
| Privacy scan | `scripts/privacy-scan.sh` (working tree, as the pre-commit hook runs it) | 0 findings |

Put back afterwards: TV 1's Wireless debugging off again (was off), YouTube in front as
before, Home and the Home button watch unchanged, the two keys this test paired forgotten under
Paired devices (two older entries from an earlier test left alone: which is which is not
knowable); TV 2 off again, its home unchanged, no key kept. The live bridge's key
and port 5555 were only used, never changed.

**Not verified yet (before a release):** a full install and Undo on a spare Google TV, an Android
TV and a Fire TV (both test TVs run the live bridge); the Intel Mac and Windows builds on real
machines (CI builds and smoke tests them); the page in a browser by a person.

## Changes to the plan: killy10o10's second review (12 Nov 2026)

- The kind question now defaults from what is known (a TV this app connected to before, then what it announces: Google TV and Android TV announce themselves, a Fire TV only has ADB on 5555) and focuses that button. In Undo, a TV answering on 5555 skips the question.
- The device list shows the model once this app has connected to that TV (kept in known-tvs.json beside the ADB key).
- Undo's plan says "Amazon's home" and so on; the raw component is in a details line.
- A TV whose home is already the on-TV app (HomeAlias enabled, or its WatchService in enabled_accessibility_services): the plan says so and offers to switch that home and watch off (pm disable of the HomeAlias, watch taken out of the list, its WRITE_SECURE_SETTINGS grant revoked so it cannot put its watch back; the app stays installed). Untick it to keep the on-TV app as the home: nothing is installed. The post setup check names the on-TV app when it is what is in front.
- Verified: unit tests (58) and the smoke test pass against the pretend TV. NOT verified on a real stick: that `pm disable` of the alias and the revoke behave on Fire OS, and that the on-TV app does not re-enable its own alias. That is the re-run asked of the tester.

- Fire OS refuses `pm disable` of the on-TV app's HomeAlias ("Shell cannot change component state", killy10o10, 12 Nov): that is not reported as a failure. The on-TV app's watch is still taken out and its grant revoked, which is what stops it winning. If a phone token for it is ever held, `POST /api/home {"on": false}` on port 5400 is tried; the Setup app holds none today, so on Fire the plan says the home entry is left and why. Before the first connection the device list also shows a name the TV announces over DIAL (SSDP), when it gives one. NOT verified on a real TV: the DIAL name.

## Changes to the plan: a Toshiba beginner test (19 November 2026, setup app 0.13.3)

A beginner test on a Toshiba (Hisense made) Google TV on Android 11, from a Mac
(`tools/tv-designer/checks/beginner-test-toshiba.md`, items 2, 6 and 9 and Run 2), hit two walls:
"Something went wrong: OSError" on the first launch, and "This TV did not ask ... needs a USB cable", a
dead end. seagey: every feature must work or say plainly what it needs, in plain words.

- **Errors are plain words, always.** `errors.py` maps every exception to a sentence and a code; the
  technical part goes in `detail`, which the page keeps behind a **Details** disclosure. No raw
  exception name reaches the page (the job runner, the page server's 500 path, the TV's "stopped
  answering", install and uninstall failures all go through it).
- **macOS Local Network permission** (the OSError): "No route to host" (EHOSTUNREACH, errno 65 on a
  Mac) or "Operation not permitted" (EPERM) on a send to a home address (192.168, 10, 172.16) or to the
  mDNS group, while the internet route is there, or nearly every knock on the /24 failing that way at
  once, now shows its own screen: "Your Mac blocked this app from finding the TV. Open System Settings,
  Privacy and Security, Local Network, switch on Couch TV Setup, then press Look again." with a Look
  again button. Windows gets the firewall's Private networks wording.
- **Google TV no longer assumes Wireless debugging.** Developer options first (both menu names, System
  and Device Preferences), then the person picks what the TV shows: Wireless debugging (Android 12 or
  newer, the 6 number code) or only USB debugging (Android 11 Google TVs, many 2021 and 2022 Hisense,
  Toshiba and TCL: USB debugging over Wi-Fi, port 5555, no cable, then Allow). A TV already answering on
  5555 goes straight to the Allow screen.
- **Which way in, before the steps:** `finder.route_hint()` from what the TV shows unpaired: 5555 open
  (Allow), Wireless debugging announced over mDNS (code), or an Android version read from the TV's own
  Cast info (`http://<tv>:8008/setup/eureka_info`) only when a field says it outright (an Android or OS
  version key, or the SDK level; Cast's own build numbers are ignored). Otherwise the page says both
  ways. NOT verified on a real TV: whether any TV's Cast info carries such a field. Usually it will
  not, and then the page shows both, which is the safe answer.
- **No prompt is never a dead end.** Each try waits 45 seconds (30 on later tries), counted down on
  the page. When the TV does not let this computer in, the server names the next screen
  (`steps.no_allow_fixes`), each with a Try again: go to the home screen and wait 10 seconds; switch USB
  debugging off and on; Revoke USB debugging authorisations (only when this computer was never allowed
  on this TV, and it says other computers will ask again; not on Fire TV); restart the TV (hold Power,
  or unplug 10 seconds) and check USB debugging is still on. After those: "This TV will not let a
  computer in over Wi-Fi. You can still put couch-tv on it with just your phone", the Downloader steps
  with code 8180170, then the Couch TV app on the TV shows the address to open on the phone. The old
  "needs a USB cable" stop is gone.
- **Words:** "experimental" and "later" gone from the page; the TCL line no longer says AUTO_START;
  the download line says "the couch-tv home", not a file name; "debugging port" gone.
- **Phone route steps match the real screens** (from a TCL Google TV test the same day): Downloader 2.0.4
  opens on a news site with adverts and the code box is the # button; the unknown apps prompt is
  CANCEL or SETTINGS, then a list with a warning; and Google Play Protect can block the install ("App
  blocked to protect your device"). The page says why Play Protect does it, Install anyway when offered,
  otherwise pausing its app scan in the Play Store app and switching it back on, or the computer again.
  NOT verified: the Play Store menu path on every Google TV.

### Verified (19 November 2026, on a Mac, Python 3.11.3, no TV touched)

| What | How | Result |
|---|---|---|
| Unit tests | `build/venv/bin/python -m unittest discover -s tests`: 95 tests (63 before, 32 new in `tests/test_beginner.py`: the errno mapping including EHOSTUNREACH 65 and EPERM to each home range, not a block without the internet route or to an internet address or for a file; every other error plain; a TV that never authorises a new key (`faketv.never_allows`) walks home, toggle, revoke, restart, phone route, and without revoke when this computer was allowed before or on Fire TV; port closed ends on the phone route too; each fix is a screen with Try again; the route hint and Cast info parser; banned words on the screens) | OK |
| The screens | the page run against a pretend network (no scan, no TV), clicked through in a browser: Google TV, Only USB debugging, Done, then each Try again | home, toggle, revoke, restart, phone route, in that order; the blocked Mac screen with Look again |
| Built app | PyInstaller 6.16.0 as `.github/workflows/setup-app.yml` does, ad hoc signed, `tests/smoke.py` (pairing self test inside the bundle, page, secret, Close setup) | smoke test ok, 13.3 MB zip |

NOT verified: the new screens on a real TV (a Toshiba Google TV on Android 11 would be the test: it should reach the Allow
screen at once, since 5555 is open, then the fix screens); the Local Network message on a Mac that
really refused the permission (simulated by errno only); the Intel Mac and Windows builds of this
commit (CI builds them after a push).

## Linking a TV to the account (security gate, 25 Nov 2026)

What Setup and the website agree on. `tests/fakestudio.py` answers it, `tests/test_link_e2e.py` runs it.

- A code from the website is looked at first (`POST /v1/setup/who {handoff}` gives `{account: {name, email, design}}`, the email covered) and used only
  after **Yes, link it** (`/api/link-yes`, enforced by `server.py`). The website's Allow asks the same way. A signed in Setup never changes accounts without that Yes.
- `POST /v1/setup/tv` makes a waiting link. The TV's old link works until the new one is confirmed: the TV asks its inbox with it, or Setup's
  `done` says `linked: true` with that `link`. `"sent"`: an older Couch TV that cannot answer. `false`: dropped.
- The TV: `am broadcast -n app.couchtv.launcher/.SetupLink` answers `couchtv-link ok <first 16 of sha256 of the link>`. Settings go to
  `.FromComputer`. Both need `android.permission.DUMP`, which ADB's shell holds and TV apps do not. Couch TV 0.13.13 and 0.13.14 have neither: `am start` on MainActivity, and "sent".
- `POST /v1/setup/seen {tv_id}`, `/end` (Setup's Sign out), `/leave` (the TV let go of a link), `/signout` (the account page).
- A TV's My TVs row is remembered by the TV and the account (`linked-tvs.json`, hashes), never by its address.
- Order: the migration, then the website, then Couch TV on the TV, then Setup. Setup against an older website says so and uses nothing.

## Couch TV Helper (extra features from this computer)

Same app, same download. The last screen offers **Done** or **Add extra features**; the second sets
`helper.json` to mode `helper` in Setup's own folder and starts `Couch TV Setup --helper`.

- `couchtv_setup/helper/config.py`: `helper.json` and the bridge's config (written from `known-tvs.json` and the TVs that need the helper: Samsung, LG, Roku). The pairing key is made once and kept.
- `bridge_proc.py`: runs `bridge/server.py` as a child process (`--bridge`, in the app's own Python) and restarts it with a growing wait.
- `tray.py`: rumps on a Mac, pystray on Windows and Linux. No tray or no library: `fallback.py` shows the same menu (`menu.py`) as a page on 127.0.0.1.
- `autostart.py`: LaunchAgent (Mac), `HKCU\...\Run` (Windows), `~/.config/autostart/couch-tv-helper.desktop` (Linux). Removed on turn off.
- `couchtv://helper/on`: the Couch TV account page's **Turn on extra features** link (Studio side, not changed here). Setup opens on the Add extra features screen. `deeplink.py` documents it.
- Packages: `requirements-helper.in` is the list to edit; `requirements-helper.txt` is made from it with `uv pip compile requirements-helper.in --universal --python-version 3.12 --generate-hashes -o requirements-helper.txt` (a hash for every file, Mac, Windows and Linux in one file, cryptography kept at the version Setup uses). The build installs it with `--require-hashes` in a separate step and bundles the bridge only when that worked, so Setup alone builds if it fails; a release build fails instead.
- Smoke test: `tests/smoke_helper.py` starts the built app with `--helper` (no tray: `COUCHTV_HELPER_NO_TRAY=1`), checks the bundled bridge runs as its child and answers, the menu page says Running and refuses a call without its secret, and Quit stops both. The Setup workflow runs it on all four runners after `smoke.py`.
- Tests: `tests/test_helper.py` (config, login item in a temp folder and a fake registry, menu state, supervisor, page API).

### Helper phase 2: updates, keep awake, remove everything

- `helper/update.py`: asks GitHub for the newest release at start and every 24 hours, downloads the archive for this computer into the cache, and only keeps it when `SHA256SUMS-setup.txt` has a valid Ed25519 signature (`SHA256SUMS-setup.txt.sig`, public key inside the app) and the archive matches its line in that file (and GitHub's own digest). The menu then says **Update ready, restart**. Pressing it unpacks the update (no links, nothing outside its folder) and runs a small script that waits for the helper to exit, keeps the old version in the cache folder (`helper-update/previous`) and starts the new one.
- **Signing a release** (the private key is not in this repo): `bash scripts/release.sh setup --version X` (the last step of `publish`) signs the release's `SHA256SUMS-setup.txt` with `scripts/sign-setup-sums.py`, checks it with `scripts/verify-setup-sig.py` (the app's own check), uploads the `.sig` and checks the release copy again. By hand: `python3 scripts/sign-setup-sums.py SHA256SUMS-setup.txt`, then upload the `.sig` to the same release. The key is `~/.couch-tv-signing/update-ed25519.pem` (mode 600; `COUCHTV_SIGNING_KEY` names another). Until a release carries the `.sig`, installed helpers say "Could not check for updates" and change nothing. To rotate the key, make a new pair and change `PUBLIC_KEY_B64`; helpers built before that need a manual download.
- `helper/keepawake.py`: only while a Samsung, LG or Roku TV is set up, the helper is on, and the computer is on mains power (Mac `caffeinate -i -s`, Windows `SetThreadExecutionState`, Linux `systemd-inhibit`). Menu: **Let this computer sleep** switches it off. Google TV only homes never hold it.
- `helper/remove.py`: menu **Remove everything from this computer...** stops the helper, removes the start-up item, and deletes the files in Setup's own folders (TV key, helper settings, bridge data, downloads). It tells the person to Forget the key on each TV.

### Home Assistant without the helper (checked in the code, 24 Nov 2026)

Works without the helper on Google TV, Android TV and Fire TV. The Couch TV home talks to Home Assistant through the launcher itself (`tv-home/web/smarthome.js`, `window.TVHA`, app.couchtv.ha), and the on-TV app answers `/api/ha/*` (`on-tv/.../Server.kt`, `HaPhone.kt`) so a phone can sign the TV in. The bridge's `/api/ha` (`bridge/smarthome.py`) is used only where there is no launcher (Samsung, LG, Roku, which need the helper anyway) and for Philips Hue and AirTouch 5, which are set up from the computer. Not run against a real Home Assistant here.

## Changes to the plan: the light redesign (25 November 2026, branch setup-ui)

The owner approved pictures for Setup's page (welcome, Which TV is yours, plan, progress, finish, installed but not linked, the app icon B). Built as:

- **Page:** light brand theme (`web/style.css`), Nunito and Inter bundled in `web/fonts/` (no remote requests; the page's CSP still says `default-src 'self'`). Welcome with Start; TV cards (any number, none too) with Details; a "My TV isn't here" help page that holds the address box; a card for a TV Setup cannot install on, with its old action; the plan asks only the TV's name (people and weather place are no longer asked, but the server still takes them, so an account's home details and names already saved still go on the TV); progress with steps; Finish and the installed-not-linked Finish; Back on every screen (off while installing); a step bar; Set up another TV (`/api/reset-tv` forgets the connection, facts, report and the account's row for that TV, then the page clears its own per TV state); a session TV list; Open Couch TV Studio.
- **Linked** is shown only when the server's setup answer says `account.linked`. The finish screen has a hook for "Link it to your account" (shown when `/api/info` lists the feature `link-tv`) and one for Tidy up (shown when `window.CouchTidy` exists).
- **Icon B** is packaged as `assets/icon/couch-tv-setup.icns` (Mac), `.ico` (Windows) and `-linux.png`, and used by the workflow.
- **Name:** the app, its folder and the program are renamed to **Couch TV Setup** (0.13.15). Proved on this Mac, 25 Nov 2026, with two tiny ad hoc signed test apps: a bundle still called `couch-tv Setup.app` with `CFBundleName`, `CFBundleDisplayName`, `CFBundleLocalizations` and `en.lproj/InfoPlist.strings` all saying "Couch TV Setup" is still named "couch-tv Setup" by `NSFileManager displayNameAtPath` (what Finder shows) and by Spotlight (`kMDItemDisplayName`); the same bundle named `Couch TV Setup.app` is named "Couch TV Setup" by both. So the file name had to change. Release zip and tar.gz names (`couch-tv-Setup-*`), `SHA256SUMS-setup.txt` and the site's download links are unchanged. The Helper's updater (`helper/update.py`) now puts the new copy under its own name next to the old one (never over something already there) and starts it by that name; the Helper's start with the computer entry is rewritten when it points at another path (`autostart.refresh`), and the Windows link is registered again at helper start. The data folder name (`paths.APP`) is unchanged so saved keys and settings are found.
- **Tests:** `tests/test_ui.py` drives the real page in Chromium (Playwright) against `tests/ui_harness.py` fakes; `tests/ui_shots.py` makes the screenshots. They skip when Playwright is not installed.
- **Old Helpers still update (0.13.15).** A Helper from 0.13.14 or older runs the updater it shipped with (`tests/fixtures/helper_update_v0_13_14.py`, byte for byte from tag v0.13.14). It moves the one folder or .app in the archive to where the old copy was, then starts `<that folder>/couch-tv Setup` (Windows `couch-tv Setup.exe`, Mac `open -a` on the .app). So the archives also hold the old program name: `compat_names.py` (run by the workflow right after PyInstaller) copies `Couch TV Setup.exe` to `couch-tv Setup.exe` on Windows and writes a one-line launcher called `couch-tv Setup` on Linux. A Mac needs nothing in the folder. `tests/test_old_updater.py` runs the real old `apply()` and its swap script in temp folders, including a failed second move (the old version comes back and starts again), and the build smoke-tests the old name too. When a release changes the program name, the archive layout or the updater, add the previous release's `update.py` as another fixture and run the same tests. Known cost: after an old updater, the folder is still called `couch-tv Setup` (Windows, Linux) or `couch-tv Setup.app` (Mac, where Finder shows the file name, so it still reads "couch-tv Setup" there) until the next update, which the new updater puts under the new name.

