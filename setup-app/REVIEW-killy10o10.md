# Security review: couch-tv-setup by killy10o10

Reviewed 11 November 2026, before reusing any of it in couch-tv Setup.

- Repo: https://github.com/killy10o10/couch-tv-setup, `main` at `b2de550` (v0.1.2), cloned and read in full.
- What it is: a Python app that opens a page in the browser and puts couch-tv's "lives on the TV"
  app (`dev.couchtv.ontv`) on a **Fire TV** stick from a Mac or Windows PC. MIT licence, Copyright
  (c) 2026 killy10o10. Its `tv.py` is adapted from our own `tv-home/tools/tvadb.py`, credited.
- About 1,600 lines: `server.py` (238), `steps.py` (410), `tv.py` (144), `finder.py` (76),
  `adbkey.py` (78), `couchtv.py` (62), `paths.py` (39), the page (`web/`, 729), tests, a GitHub
  Actions workflow.

**Verdict: safe to use as it is, nothing malicious, no telemetry.** Three things we would not ship
the same way (the page server, the download check, the ad app list), all fixed or left out in our
app. Details below.

## 1. What it downloads

| What | Where from | Checked |
|---|---|---|
| The release list | `https://api.github.com/repos/Seagey/couch-tv/releases/latest` | TLS, with certifi's CA list |
| `couch-tv-ontv.apk` | the `browser_download_url` GitHub gives for that asset | **size only** |
| Place names for the weather | `https://geocoding-api.open-meteo.com/v1/search`, called **from the page** with the words typed | none needed |

- Only Seagey/couch-tv's own release, only that one file name. `COUCHTV_APK=<file>` swaps in a
  local build (for developers).
- **Gap:** no SHA-256 check, and the download host is not checked. GitHub publishes a SHA-256
  `digest` for every release file; the size check catches a cut download, not a changed one.
  Android still checks the signature on an update over an existing install, but not on a first
  install. **Our app:** checks the GitHub digest and, when present, a `SHA256SUMS.txt` in the
  release; any mismatch or a missing checksum means nothing is installed. Only GitHub hosts over
  HTTPS are fetched.

## 2. What it runs on the TV

Every `adb shell` command in `steps.py` and `tv.py`:

| Command | When |
|---|---|
| `getprop ...`, `dumpsys package dev.couchtv.ontv`, `pm list packages [-d]`, `dumpsys accessibility`, `dumpsys activity activities`, `settings get secure enabled_accessibility_services` | reading only |
| copy to `/data/local/tmp/couchtv-setup.*`, `md5sum`, `pm install -r`, then `rm` | install (push in 64 KB parts, base64 fallback, md5 checked: our `tvadb.py` method) |
| `pm uninstall dev.couchtv.ontv` | only on "replace" (a different signing key) or Undo |
| `pm grant dev.couchtv.ontv WRITE_SECURE_SETTINGS`, `appops set dev.couchtv.ontv SYSTEM_ALERT_WINDOW allow` | home screen step (the grants on-tv/README.md documents) |
| `am force-stop` / `am start -n dev.couchtv.ontv/.SetupActivity`, `uiautomator dump`, `input keyevent DPAD_LEFT/RIGHT/CENTER` | presses the on-TV app's own **Use as home screen** button, because Fire OS refuses `pm enable` of the home alias from ADB. It only presses select when the highlighted button reads exactly "Use as home screen", so it cannot land on Forget phones. Careful and fine |
| `settings put secure enabled_accessibility_services '<existing>:<watcher>'`, `accessibility_enabled 1` | adds the app's watcher, **keeps every other service** |
| `input keyevent KEYCODE_HOME` | checks and refreshes |
| `reboot` | only when the person presses Restart; sent once, never retried |
| `pm disable-user --user 0 <pkg>` on 13 Amazon packages, `pm enable` on Undo | optional step 8, "Ads and tracking", opt in |
| `mkdir`, `printf ... > /data/local/tmp/couchtv-setup/switched-off.txt`, `rm -rf /data/local/tmp/couchtv-setup*` | the undo list kept on the TV |
| Undo: watcher taken out (others kept; if it was the only one, `settings delete` and `accessibility_enabled 0`), app uninstalled, the 13 switched back on, Home pressed | Undo everything |

**Against our rule (never switch off a TV's own home or setup app):** passes. Amazon's home
(`com.amazon.tv.launcher`) is named in a comment as never to be touched, and it is not on the
list. Nothing it runs deletes anything.

**Where it goes further than we would:** the 13 packages are not all adverts. Besides ACR, the
advertising ID, sneak peeks, sponsored rows and ambient adverts, it switches off telemetry and
logging services (`com.amazon.device.telemetry.emitter`, `com.amazon.dp.logger`, `com.amazon.logan`,
`com.amazon.wirelessmetrics.service`), release notes and tutorials. They are system apps, and
unlike our `apply.sh` it does not refuse persistent or boot critical packages before switching one
off (apply.sh's `needed()`), so the safety rests on the list being right for every Fire OS build.
It is opt in, never deletes, and has an Undo, and it was tested on one stick. Undo also switches
back on every listed package that is off, "whoever switched it off", which could undo a choice the
person made themselves. **Not reused:** our app switches off exactly what `apply.sh` does (ambient
mode on Google TV, and only with a yes) and nothing of Amazon's.

**Small one:** the undo list read back from the TV goes into `pm enable <pkg>` and a `printf`
command after only a `startswith("com.")` check, so a crafted line in that file could run a shell
command, on the same TV, as the shell user. Low impact (it needs write access to that folder
already). **Our app:** package and activity names are matched against a strict pattern before any
use, with a test for it.

## 3. What it opens on the computer

- `ThreadingHTTPServer` bound to **127.0.0.1 only**, any free port. Nothing on the network can
  reach it. Good.
- A per run secret (`secrets.token_urlsafe(16)`) is put into the page and required in an
  `X-Setup-Key` header on every API call. Another website cannot read the page (same origin rule)
  and cannot send that header without a CORS preflight, which the server never answers. So plain
  CSRF is blocked. Good.
- **Gap, DNS rebinding:** the server does not check the `Host` header. A web page the person has
  open could point its own host name at 127.0.0.1, read the page (and with it the secret), then call
  the API, which can install apps and press keys on the TV. It needs the random port while the
  setup is running (minutes), so the risk is low, but the fix is one line. **Our app:** only
  `127.0.0.1:<port>` and `localhost:<port>` are served, an `Origin` header must match too, with tests.
- **Gap, HTML injection:** the page puts text from the network into `innerHTML`: names from reverse
  DNS of devices on the Wi-Fi, the TV's model and OS (from the TV), the release tag (GitHub),
  Open-Meteo's place names, and app names from the on-TV app. A device on the Wi-Fi that names
  itself with HTML, or a hostile place result, would run script inside the page that holds the
  secret. Medium. **Our app:** never uses `innerHTML` (a test checks), a strict Content Security
  Policy, `X-Frame-Options: DENY`, `nosniff`.
- Static files: the path is resolved and must stay inside `web/`. Good.
- It stops by itself three minutes after the page stops asking, and on **Close setup**. Good.
- Request logging is off unless `COUCHTV_SETUP_DEBUG` is set; error tracebacks go to the
  terminal only.
- The ADB key is its own (`~/Library/Application Support/Couch TV Setup/adbkey`, `%APPDATA%` on
  Windows), not `~/.android`. Good. The key is made with the pure Python `rsa` package (to avoid
  `cryptography` on Intel Macs, see section 5).

## 4. What it sends anywhere

**No telemetry, no analytics, no crash reporting.** Every network call in the code:
- GitHub, as in section 1.
- Open-Meteo place search, from the browser, only the place typed.
- The TV: ADB on 5555, and the on-TV app's API on port 5400 (`/api/pair/start`, `/api/pair`,
  `/api/app-order`, `/api/settings`).
- Finding the TV: a TCP connect to port 5555 on every address of the computer's home /24
  networks (96 at a time), plus a reverse DNS lookup of each one that answers (which asks the
  router). Nothing is sent to those devices.
- `ifconfig` / `ipconfig` is run locally to list the computer's addresses.

## 5. How the apps are built

- GitHub Actions (`.github/workflows/build.yml`) on every push, pull request and `v*` tag: Apple
  silicon Mac (`macos-latest`), Intel Mac (`macos-15-intel`), Windows. Tests run, PyInstaller
  6.16.0 builds, a smoke test starts the built app and closes it, and a tag attaches the zips to a
  release. That chain is good and we use the same shape.
- **Not reproducible:** PyInstaller bundles are not byte for byte repeatable, and the Mac app is
  ad hoc signed. There are no checksums next to the release zips, so a download cannot be compared
  with what CI built.
- **Supply chain:** the packages are pinned by version (`adb-shell==0.4.4`, `rsa==4.9.1`,
  `certifi==2025.10.5`) but not by hash, `pyasn1` (which `adbkey.py` imports) is not pinned at all,
  the actions are pinned by tag, not commit, and `permissions: contents: write` covers every job
  and every branch push. **Our workflow:** hash checked installs, actions pinned to commits,
  read only by default, and write access only in the one job that adds files to a release that
  was just published, plus `SHA256SUMS-setup.txt` for the zips.
- `cryptography` was left out because its new versions have no Intel Mac build. True: 48.0.1 is
  the last with a macOS universal2 wheel. We need it for TLS 1.3 pairing, so we pin 48.0.1 and
  pyOpenSSL 26.2.0 (the last that allows it).

## 6. What we reused

Each reused file keeps his MIT notice at the top and is listed in `THIRD-PARTY.md`.

| Ours | From his | Changed |
|---|---|---|
| `couchtv_setup/paths.py` | `paths.py` | app folder name, a test override for the cache |
| `couchtv_setup/finder.py` (`home_networks`, `answers`, the /24 scan) | `finder.py` | adds the TVs' own mDNS names and Wireless debugging ports, port 6466, home addresses only |
| `couchtv_setup/server.py` (the shape: 127.0.0.1, the per run secret, the job the page asks about, stopping by itself) | `server.py` | Host and Origin checks, CSP and other headers, new API |
| `couchtv_setup/web/index.html` (the Fire TV Developer options steps, the "Look at your TV" Allow card, the Mac and Windows network hints) | `web/index.html` | new page around them |
| `FIRE_MODELS` in `steps.py` | `steps.py` | none |
| `.github/workflows/setup-app.yml` (the three computer matrix, LSUIElement, ad hoc codesign, Windows folder zip, smoke test) | `.github/workflows/build.yml` | see section 5 |
| The Gatekeeper and SmartScreen steps in `setup-app/README.md` | `README.md` | updated for macOS 15 and newer |

Not reused: the Amazon ad and telemetry list (section 2), `adbkey.py` (we bundle `cryptography`
for pairing, so adb-shell's own key maker is enough), the "Use as home screen" presser (our app
puts on the home app, `app.couchtv.launcher`, the way `apply.sh` does, rather than the on-TV app's
home switch), `tv.py` (it is our own `tvadb.py`, which we took again from the source), the restart
button, and his weather, names and app order step through the on-TV app's API (ours hands names
and a weather place to the home app the way `apply.sh` does; his two open fixes to the on-TV app
touch that API and come in as his own pull requests).
