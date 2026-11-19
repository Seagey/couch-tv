# couch-tv living on a rooted LG (webOS 4, no computer)

How couch-tv was set up to run entirely on a rooted LG 75UM7600PLB (2019, webOS TV Lite 4.10.2,
Chromium 53, soft-float ARMv7, 1 GB RAM). The bridge runs on the TV itself, so the phone remote and
"open by itself" work with no computer left on. Not an upstream-supported mode; these are the pieces
and the lessons.

## Pieces

| File | Where it lives on the TV | What it does |
|---|---|---|
| `run-bridge.py` | `~root/couchtv/` | Starts `bridge/server.py`. Stubs the Android and Apple TV libraries (`cryptography`, `adb_shell`, `androidtvremote2`, ...) that cannot be installed on this TV; only the LG driver is used. |
| `bridge-loop.sh` | `~root/couchtv/` | Runs the bridge and restarts it if it stops. |
| `home-keeper.sh` | `~root/couchtv/` | Closes the home when another app takes the screen (frees its memory); opens the home when an input is on screen only because an app closed or the TV just started; opens the home when the Home button is pressed anywhere else (it reads the TV's own log line for the press, nothing is injected). |
| `blocklist.hosts` | `~root/couchtv/` | LG ad, ACR and diagnostics servers, plus SoundCloud ad servers. |
| `init.d/*` | `/var/lib/webosbrew/init.d/` | Started by the Homebrew Channel at boot: hosts block, bridge, home keeper. |
| `config.example.json` | `couch-tv/config.json` | The config used (add a `bridge.pairing_key`). TV `ip` is `127.0.0.1`: the bridge talks to the TV it runs on. |

Python is a standalone CPython 3.12 (`python-build-standalone`, target
`armv7-unknown-linux-gnueabi`, the soft-float one: the TV's userland is soft-float, the `gnueabihf`
build does not start) in `~root/couchtv/python` (`~root` is the TV root user's home, /home/root), with `aiohttp` installed without C extensions
(`AIOHTTP_NO_EXTENSIONS=1 MULTIDICT_NO_EXTENSIONS=1 YARL_NO_EXTENSIONS=1 FROZENLIST_NO_EXTENSIONS=1
PROPCACHE_NO_EXTENSIONS=1`). The bridge needs `couch-tv/bridge`, `remote/dist`, `tv-home/web`,
`lg/app` and `config.json` next to it.

Build the app with `python lg/build.py --bridge http://127.0.0.1:5400 --apps <list>` and install the
`.ipk` as root with `luna://com.webos.appInstallService/dev/install`.

## Lessons from this TV

- **Do not install LG Input Hook here.** On webOS 4.10.2 its injection crashed `tvservice` and
  `lginput2` 45 s into boot (`unhandled page fault` in the kernel log). With `tvservice` broken,
  starting video playback later hung the audio/video coprocessor and the kernel panicked
  (`RPC timeout in release mode!!! need micom reset`), restarting the TV.
- **Keep app storage free.** Python and the bridge live on `/home` (`/mnt/lg/cmn_data`), not on
  `/media/developer`: torrent players refuse to start with less than about 150 MB free there.
- **The Night look's five scenes cost about 200 MB** of this TV's 1 GB when they rotate. With
  `home.sun_sync: true` one scene loads at a time (about 60 MB).
- **Home on webOS 4 is an overlay**, not an app: `getForegroundAppInfo` does not change when the
  Home button is pressed. The launcher does log `NL_HOME_SHOWN ... "launch_type":"homeKey"` with the
  app it was pressed in to `/var/log/messages`, and launching the home puts the launcher bar away.
- The app's web inspector is on port 9998 while it runs (Chrome DevTools protocol), which gives
  DOM access and `Page.captureScreenshot` when the TV offers no screenshot service.

## StremioBrew subtitle size

StremioBrew 5.0.6 (`io.strem.tv.beta`) lists subtitle sizes up to 160% but its player never reads
the setting: subtitles are a fixed 38 px. `stremiobrew-subtitle-size.py` (run on the TV with the
Python above) adds 200% to 400% to the list and makes the player apply the chosen size. It keeps
`.orig` copies next to the two files it changes. Run it again after a StremioBrew update.
