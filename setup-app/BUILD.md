# couch-tv Setup: BUILD

## Intent

seagey, 11 November 2026: an official, free couch-tv Setup app in this repo, released from our
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
  Privacy and Security, Local Network, switch on couch-tv Setup, then press Look again." with a Look
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
