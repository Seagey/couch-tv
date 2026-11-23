# On-TV mode: the remote with no computer

Couch TV normally needs a computer on the network running the bridge. **On-TV mode puts the bridge
inside an app on the TV.** The phone remote is served by the TV itself, and the TV controls itself
through its own debugging port. Nothing else has to stay switched on.

It is a separate app (`dev.couchtv.ontv`, shown as **Couch TV** in the TV's app list). It installs
next to anything else, including the computer-bridge home screen, and it does not take over the
home button unless you switch that on.

## What works, compared with the computer bridge

| Feature | Computer bridge | On-TV mode | Notes for on-TV mode |
|---|---|---|---|
| Phone remote page | yes | yes | Served by the TV at `http://<tv-ip>:5400`. Same remote build as the computer bridge. |
| Pairing a phone | not needed (home network only) | **required** | A 6 digit code on the TV, once per phone. Every call needs the phone's token. |
| Open an app | yes | yes | Plain Android intents, even without ADB. |
| D-pad, back, home, playback keys | yes | yes, with ADB | Through the TV's own ADB (see below). Home works without ADB. |
| Volume | yes | yes | With ADB: key presses, so HDMI soundbars follow. Without ADB: the TV's own speaker only. |
| Type into a search box | yes | yes, with ADB | |
| Turn the TV off | yes | yes, with ADB | |
| **Turn the TV on** | yes (Wake-on-LAN) | **no** | Once the TV sleeps, this app sleeps too. See "Power on" below. |
| What is playing | yes | yes, with ADB | Same `dumpsys media_session` reading as the bridge. Apps that report no title show the app only. |
| Play a show by name | yes | yes | Same JustWatch lookup and deep-link table as the bridge, no key needed. |
| Keep watching | yes | partial, with ADB | Built on this TV: shows started from the phone, and shows an app says it is playing for a minute or more. No imported history, no progress bar. See "Keep watching and people". |
| Sleep timer | yes | yes, with ADB | Pause, then off. |
| Screenshot (`/api/screenshot`) | yes | yes, with ADB | |
| Picks and taste profile | yes | no | Needs "ask". |
| Ask (AI assistant) | yes (computer's Claude Code) | **off by default** | Optional: your own API key on the setup page, for Claude, OpenAI, Gemini and others, or a model at home. See below. |
| Picture mode, screens, Moonlight | yes | no | |
| Home screen (TV home page) | yes | yes, optional | Same page, served from the app. Replacing Google's home needs one ADB command, see below. |
| Input tiles (HDMI ports in the dock) | yes (`home.inputs`) | yes | Set on the setup page, Input tiles. OK switches the TV straight to that port. |
| Live updates (`/api/events`) | yes | yes | Server-sent events, plus a WebSocket at `/api/ws`. |
| Kids mode (New) | yes | yes | A kids profile's home is a shelf of chosen shows behind a parent PIN ([docs/CONFIG.md](../docs/CONFIG.md#kids-mode)). With no `config.json` here, set it up on the phone remote: TV, Kids mode. |

## Which TVs

- **Yes:** Android TV and Google TV (Chromecast with Google TV, Google TV Streamer, Sony, TCL,
  Hisense, Philips and other Google TV sets), Nvidia Shield, and Fire TV on Fire OS. Android 7.1 or newer
  (Android 6 works from 0.13).
- **No:** Samsung (Tizen), LG (webOS), Roku, Apple TV, Hisense VIDAA, and Fire TV sticks on Vega OS.
  These do not run Android apps. Use the computer bridge for those where it can reach them.

### The one setup step: let the TV control itself (ADB)

Opening apps works straight away. Keys, typing, "what's playing" and power off need the TV's
debugging switched on once. There are two ways. **On Android 13 and newer (most Google TVs), use
pairing (1).** Use port 5555 (2) on older TVs.

1. **Wireless debugging pairing** (Android 11 and newer, TV on Wi-Fi). The port is random and
   changes after every restart, so the app pairs with the TV once, then finds the port by itself
   and switches wireless debugging back on after a restart. With the TV remote:
   1. Settings, System, About (on Android TV 9 to 11: Settings, Device Preferences, About), press
      **Build** seven times (unlocks Developer options).
   2. Settings, System (or Device Preferences), **Developer options**, scroll to **Wireless debugging**, OK, switch it on.
      On "Allow wireless debugging on this network?" tick **Always allow on this network**, then
      **Allow**.
      **Careful:** in the Developer options list, **Revoke USB debugging authorizations** sits
      directly above Wireless debugging. Never press OK on it: it signs out every computer that
      uses ADB on the TV. Check what is highlighted before each OK.
   3. In Wireless debugging choose **Pair device with pairing code**. Leave that screen open.
   4. On the phone, open `http://<tv-ip>:5400/setup` and type the 6 digit code. The port is
      optional (the app finds it). The setup page shows "connected (wireless debugging)".

   **Wireless debugging needs Wi-Fi.** On Ethernet, Android refuses to turn it on; use 2, or put the
   TV on Wi-Fi.
2. **Network debugging on port 5555** (older Android TV, Fire TV, Nvidia Shield, and any TV where a
   computer has run `adb tcpip 5555`). Turn on network (or USB) debugging, open Couch TV, Settings,
   Phone remote, **Set it up**, then **Connect**, and on the TV tick **Always allow** and press **Allow**. **Some Android 13+
   Google TVs never show that question for a new key** (seen on one TV after its Google home screen
   had been switched off): the app gives up after 45 seconds and points you to pairing.

After the first connection the app gives itself two permissions over ADB, for itself only:
"draw over other apps" (so it can open apps from the background) and "write secure settings" (so
it can switch wireless debugging back on after a restart, the way Shizuku does).

## Install

1. **Download `couch-tv-ontv.apk` from the GitHub Releases page** (easiest; on a Fire TV or a Xiaomi
   that should use PatchWall's place, `couch-tv-ontv-watch.apk` instead), or build it from the
   repo root with `sh scripts/build-apk.sh` (JDK 21, the Android SDK and Node 20+, no Gradle
   needed; docs/SETUP.md, "Building the app"). It builds the phone remote first if `remote/dist` is
   missing, then copies the remote and the TV home page into the app, and leaves it at
   `dist/couch-tv-ontv.apk`.
2. Install from a computer once (developer options and debugging must be on). With network
   debugging on port 5555, the repo's own helper needs nothing else installed, and copies the app
   in small pieces (some TVs stall on a normal push):
   ```
   .venv/bin/python on-tv/scripts/real-tv.py --ip <tv-ip> install couch-tv-ontv.apk   # from the repo root, after docs/SETUP.md step 2
   ```
   If the TV only has **Wireless debugging** (many Android 13 and newer Google TVs), use Google's
   platform-tools once instead:
   ```
   adb pair <tv-ip>:<pairing port> <6 digit code>    # from "Pair device with pairing code"
   adb connect <tv-ip>:<port shown under Wireless debugging>
   adb install -r couch-tv-ontv.apk
   ```
   Or copy the APK to the TV with a file app and open it there.
3. On the TV, open **Couch TV**. A new TV gets two steps, done with the TV remote alone:
   **Step 1 of 2, Make Couch TV your home** (one press asks Android where it can; a TV that keeps
   Google's home on the Home button, like a TCL with Android TV 11, says so in one line, with More help
   behind it), then **Step 2 of 2, Open your new home**, where the home's own welcome offers a design code
   or Couch Original. Later opens show **Couch TV is ready** with Open the home and **Settings**.
   Settings is a list and a panel: **Edit your home** (a QR to the phone page, where widgets, the town,
   calendars and photos are set), **Phone remote** (pictures of the phone remote's two pages, the pairing QR
   and code, New code, Forget phones, and, only on a TV where the phone cannot press keys yet, **Set it up**:
   three screens to Developer options, the debugging switch and Connect, with Wireless debugging pairing on
   Android 13 and newer), **Undo Couch TV** (the TV's own home back on Home, the Home button watch off, then
   Android's own Uninstall question for Couch TV) and **Help** (a QR to couchtv.joshuaseage.com/help).
   Older names in this file: **Use as home screen** is step 1's Make it my home (Undo Couch TV switches it
   off), and **Connect ADB** / **Let the phone press keys** is Settings, Phone remote, Set it up.

## Updates

Home settings, About, **Update couch-tv** says which version this TV has and whether a newer one is out
(it looks on GitHub once a week if you said yes when the home asked, or when you press Check for updates
now). Once the phone remote can press keys (the app's own link to the TV, "Let the phone press keys"),
**Update to ...** does it all: it downloads the new version from GitHub, checks it (GitHub only, the
size and SHA-256 GitHub lists, this app, newer, the same signing key) and installs it over that link,
then Couch TV opens again if it was on screen (an update started from a phone leaves the show on). Your settings stay. The app still leaves out Android's install permission
on purpose, so Play Protect lets it through. Without that link (or on a Fire TV that blocks it), the
page shows the steps instead, with a QR code that opens them on your phone: open Downloader, type
8180170, Install. The watch version (the Home button version, put on from a computer or by Make Home open
Couch TV) keeps its Home button through Update to, or from a computer with `adb install -r couch-tv-ontv-watch.apk`.
Downloader's code gives the plain app, which has no Home button watch, so after a Downloader update Home
opens Google's home again: press Make Home open Couch TV once more. The update page says so.

If Downloader says **App not installed**, the TV is usually short of space: Downloader keeps every copy
it fetched (a real TCL had five). In Downloader, open Files, delete the old couch-tv-ontv files, then
type 8180170 again.

## Pair a phone

1. On the TV, open Couch TV, then **Settings**: the phone remote is at the top. Scan its QR code with the phone's camera. While a code is showing, the QR holds it
   too (after a `#`, so it is never sent in a request line or kept in a log), and the phone pairs
   with no typing. The page takes the code out of its address at once.
2. Or open the address the TV shows, for example `http://192.0.2.10:5400`, and type the 6 digit code
   from the TV. (Tap "Show a code on the TV" if it has gone.)
3. That phone now has its own token, stored in the browser. Add the page to the home screen.

To send a design from the phone: in the phone remote, pull down the TV menu, **Send a design**, and
paste the code from couch-tv Studio (or tap **Choose a design in couch-tv Studio**, which brings the
code back by itself). The TV asks "Use this design?": pick **Use this design**, then press OK.

A code lasts 3 minutes, works once, and is thrown away after 5 wrong tries. **Forget phones** on
the TV, or on the setup page, signs every phone out.

## Use it as the home screen (optional)

Press **Make it my home** on Couch TV's first setup step (the setting called **Use as home screen** below). On a plain Android TV with the maker's own home that is enough
(Android asks "make Couch TV your home screen?"); with Google's Android TV Home see "When it does not ask" below. On Google TV the
system launcher still wins the Home button, and **do not switch it off**: on some Google TVs (a
Sony Bravia among them) the TV then loops at every restart
([docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md#if-your-tv-loops-after-a-restart)). The Couch TV tile in the app row opens
setup, so choose **Open the home** there to see the home (it appears when the Home button doesn't already open Couch TV), or use option A's `apply.sh`, which takes
the Home button with a watch and leaves the Google home on.
The **Couch TV home watch** accessibility service is for Fire TV, for a TV that opens its own home by name, and for the Xiaomi PatchWall switch below.
On a TV where the Home key opens the maker's own home by name (a Haier, a TCL, another Google TV), it also brings
couch-tv back when that home comes forward, while **Use as home screen** is on. **It is only in
`couch-tv-ontv-watch.apk`**, which you install from a computer. The plain `couch-tv-ontv.apk` (the
phone only download, from Downloader) leaves it out, because Google Play Protect blocks a sideloaded
app that has an accessibility service ("App blocked to protect your device", seen on a TCL Google TV
in November 2026). Both are the same app with the same name and key, so one installs over the other.
With the plain APK, the Couch TV setup screen says that Google's home keeps the Home button (on Google TV,
and on a TCL with Google's Android TV Home, which opened it by name although Couch TV held the home role),
and More help behind step 1 (a QR to couchtv.joshuaseage.com/help/home-button) gives the steps: `adb connect <tv-ip>:5555` (with Wireless debugging,
`adb pair` with the address, port and code from Pair device with pairing code first), then
`adb install -r couch-tv-ontv-watch.apk` (settings stay), then Couch TV home watch on in Settings, Accessibility,
then **Use as home screen** on the Couch TV setup screen: the watch only acts while that is on. With the watch APK
the button shows on Google TV too (with the plain APK it is hidden there while off).
**Make Home open Couch TV, no computer (0.13.9 or newer).** Once Couch TV can press keys on the TV (its own link to the
TV, Settings, Phone remote, Set it up: the same link Update to ... uses), the setup screen, the phone's Home settings
page and Home settings, About on the TV show **Make Home open Couch TV** on Google TV, on a TV with Google's
Android TV Home, and on a Fire TV whose Fire OS still allows the link. One press (HomeKey.kt, rules in
HomeKeyRules.kt): it downloads `couch-tv-ontv-watch.apk` from GitHub's latest release with Update's checks (https
on GitHub's hosts only, the size and SHA-256 GitHub lists, this app's package and signer, not older than this
app; the same version is fine), copies it to the TV and installs it over this app as ADB's shell user (`pm install
-r`, settings stay), then switches **Use as home screen** on and the watch on: `enabled_accessibility_services`
gets the watch added after whatever is there (never replaced), `accessibility_enabled 1`, and `cmd package
set-home-activity` again (installing anything made a TCL drop the home). On a TCL it also allows the AUTO_START
app op first. Android restarts the app as the watch version, which checks the watch actually connected; if not,
it writes the list without the watch and then with it again (what rebound it on a second TCL). If it still does
not connect, the screen says to switch on Couch TV home watch in Settings, Accessibility. With the watch version
already on, the press only switches the watch on. Without the link (or on a Fire TV that blocks it) the screens
show the computer steps below and a QR code for them on the help page (couchtv.joshuaseage.com/help/home-button/).
GitHub's release must be the same version or newer: a TV with a newer build than the latest release is told so
and nothing is installed.

**Use as home screen** waits a moment after switching the home on before asking Android (a first press
showed a black screen on that TCL), and if the question is cancelled it switches the home off again.
**When it does not ask (the release after 0.13.9).** On a TV with Google's Android TV Home (`com.google.android.tvlauncher`,
plain Android TV, not Google TV) the press changes nothing until Couch TV can press keys on the TV. On a TCL on
Android TV 11 installed from Downloader with no computer (23 Nov 2026), switching the home on put Google's home in
front, and Android only lets the app bring its setup screen back from behind with "draw over apps", which it gets
over its own key link; so the person was left on Google's home with no question. Now the setup screen stays in front
and says: Couch TV stays one press away in the apps row; let Couch TV press keys (Settings, Phone remote, Set it up),
then press **Make Home open Couch TV**; or the computer steps behind More help. Once Couch TV can press keys, Use as
home screen asks Android again. The same note (HomeAsk.kt, SetupWords.noAskNote) comes up on any TV where Android
answered at once with no question, had no request or Home settings screen at all, or where the setup screen was
covered by the TV's own home and the person only came back later; that TV is remembered and not asked the same way
again. The old fallback of a Home intent in a chooser is gone: it never set a default and opened Google's home at once.
If an older guide had you switch it off, switch it back on before the next restart:

```
adb shell pm enable com.google.android.apps.tv.launcherx
adb shell pm enable com.google.android.tungsten.setupwraith
```

The app never switches anything off by itself.

### Fire TV (Fire OS)

Step by step on a Fire TV Stick, with the things that will save you time: [docs/FIRE-TV-STICK.md](../docs/FIRE-TV-STICK.md).

Works on Fire TV sticks, Cubes and TVs that run **Fire OS** (6 on Android 7.1, 7 on Android 9, 8 on
Android 11). Fire OS 6 (Fire TV Stick 4K 1st gen and older sticks) needs a release newer than 0.3,
and network debugging on port 5555, because wireless pairing starts at Android 11. It does
**not** work on the newer sticks that run **Vega OS**, which cannot sideload apps at all.

Amazon's launcher cannot be switched off, and the Home key starts it by name, so no setting can
hand the Home key to another app. Instead, with **Use as home screen** on, Couch TV notices
Amazon's home coming on screen and puts its own home back on top. It does nothing on any other
kind of TV. Two things to know:

- **Amazon's home still flashes up for a moment** before Couch TV's comes back. Without root,
  that is as good as Fire OS allows.
- It needs three one-off grants, over ADB from a computer (they survive reboots, so the computer is
  only needed once):

```
adb shell pm grant dev.couchtv.ontv android.permission.WRITE_SECURE_SETTINGS
adb shell appops set dev.couchtv.ontv SYSTEM_ALERT_WINDOW allow
adb shell appops set dev.couchtv.ontv GET_USAGE_STATS allow
```

The first lets the app switch on its own small accessibility watcher (it sees which window came
forward and reads nothing else) and switch it back on if an update turns it off. The second lets
the app come forward from the background. The third is for Fire OS 6, which runs Amazon's own
accessibility manager and never connects the watcher (the setting reads as on, but nothing is
listening): with usage access the app polls the system's usage events instead, and Home comes back
to Couch TV within a second or two. Where the watcher does connect, the third grant is not used, so
it is safe to give on every Fire TV. If you would rather not use an accessibility service at all,
give the third and skip the first. Where a Fire OS build still lets the TV use its own ADB, the
activity log is followed as a last option.

On a Fire TV the quick buttons also gain **Input** (the TV's own HDMI picker).

**Current Fire OS (6.7.1.1, 7.6.6.9, 8.1.0.3 and newer) blocks apps on the TV from using the
TV's own ADB** (Amazon's fix for CVE-2024-27350, 2024, which it backported to Fire OS 6). So on an up
to date Fire TV, the key link cannot work, and Settings, Phone remote says so (no Set it up button there). The phone remote's keys, typing, power off and "what's
playing" do not work there; opening apps, playing a show by name, volume on the TV's own speaker
and the sleep timer still do. ADB from another computer is not blocked, so for the full phone
remote on a Fire TV use option B (the bridge), or Amazon's own Fire TV phone app for the keys.

**Keep watching on such a Fire TV** comes from Android's own "Continue watching" (Watch Next) rows
instead (#122), the way the TV home app (option A) does it: the shows each app keeps there, newest
first, with how far in, and OK opens the app's own link. It needs one more grant from a computer:

```
adb shell pm grant dev.couchtv.ontv android.permission.READ_TV_LISTINGS
```

Only apps that keep Watch Next rows show (Nuvio does, on a Fire TV Stick 4K 2nd gen); the rows are
the same for everyone at the TV (never on a kids profile). `skip_watch_next` and `watch_next_per_app` (POST /api/settings,
the same names and limits as docs/CONFIG.md) hide an app or cap its cards. A TV whose app has ever
connected its own ADB keeps Keep watching exactly as before.
Reported in [issue #12](https://github.com/Seagey/couch-tv/issues/12) (Fire TV Stick, Fire OS 7.7.1.7)
and [issue #50](https://github.com/Seagey/couch-tv/issues/50) (an Insignia Fire TV Edition on Fire OS 6.7.1.1,
where Option C works as a home screen with the usage access grant).

Confirmed on a **Fire TV Stick 4K (2nd gen, Fire OS 8.1, Android 11)** by
[killy10o10](https://github.com/Seagey/couch-tv/issues/3), who also wrote a step-by-step setup guide:
[FIRE-TV-STICK.md](https://github.com/killy10o10/couch-tv/blob/main/docs/FIRE-TV-STICK.md). Two tips
from that report:

- **After updating the app with `adb install -r`, restart the stick** if Home lands on Amazon's
  home. Fire OS can leave the watcher switched on but not connected until a restart.
- **Only one launcher can do this at a time.** If another launcher (Projectivy, for example) also
  has its Home override on, the two fight. Turn the other one's override off.

Ported from the Fire TV work in [dlandman27's fork](https://github.com/dlandman27/couch-tv). Thanks
to them.

The home's gear tile opens **Home settings** here too (language, weather place and units, look,
scenes, glass panels, a video background, apps, people, quick buttons; README, "Settings on the TV"). They are kept in this app
(`/api/settings`, next to the setup page's own settings), and the people list is the same one the
setup page edits. One difference: this app has no file picker, so your own photos come from a web
address.

### Input tiles: HDMI ports in the app row

A set-top box, a camera or a console on an HDMI port can sit in the home's app row as its own tile,
next to Settings, the way `home.inputs` does for the computer-bridge home ([docs/CONFIG.md](../docs/CONFIG.md)).
On the setup page (`http://<tv-ip>:5400/setup`), **Input tiles** lists the inputs the TV reports
(Android's TV input list, with the TV's own names, for example "HDMI 1" and "HDMI 2(ARC)"): tick the
ones you want and give each a name. Up to 6. If an app order was saved (Arrange apps), the new tiles
go in just above the More apps line, so they show at once.

OK on a tile opens Android's passthrough channel for that port, which the TV's own input app plays,
so the TV switches straight to it; a TV that does not take that opens its input list instead. The
home's Input quick button now lists the same inputs. Checked on a Xiaomi MiTV-MSSP3 (Android 9,
MediaTek): HDMI 1 and HDMI 3 tiles both switched straight to their port.

### Xiaomi and Redmi (PatchWall)

On Xiaomi's Android TV builds (seen on a Redmi MiTV-AXFR0, Android 11) the Home button opens
Google's Android TV home, and PatchWall is a separate launcher app that Xiaomi opens by name: from
the remote's PatchWall button and when the screen comes on. Android's default-home setting cannot
reach either. If you would rather have Couch TV there, keep the Home button as it is and switch on
**Couch TV in PatchWall's place** on the setup page (`http://<tv-ip>:5400/setup`; the card only
shows on a Xiaomi). It needs the Home button watch (**Couch TV home watch** in Settings,
Accessibility), so install `couch-tv-ontv-watch.apk`. Then:

- **The PatchWall button opens Couch TV.** The remote sends `KEYCODE_BUTTON_5` (scan code 580), and
  Xiaomi's `partnercustomizer` turns it into a start of PatchWall by name. The watch catches that
  one key, opens Couch TV and swallows it. With the switch on it checks every remote key for it, at
  about 2 to 4 ms per key press on that TV; with the switch off, or on any other TV, the watch does
  not ask for keys at all. Keys sent with `adb shell input` skip this check (Android does not pass
  injected keys to accessibility services), so test it with the real remote.
- **PatchWall opens Couch TV instead**, from its tile too. Its own settings screens are left alone.
- **Power on opens Couch TV**, about 2 seconds after the screen comes on, unless the TV is going back
  to an HDMI or TV input (the TV app, `com.android.tv`), so a set-top box or console stays on screen.
  PatchWall opening itself in the first 6 seconds after the screen comes on (or the TV starts) is left to this
  check, so it cannot cover an HDMI input. After a full restart, Xiaomi hands apps the boot signal late: Couch TV came up about a minute after
  the TV did.

Nothing is switched off: PatchWall stays installed and on. The same Mi key on another Xiaomi
(MiTV-MOOQ1, #54) opens Google TV's home instead, which the TV home app handles in #135.

## Keep watching and people

**Keep watching** fills itself on the TV. A show lands there when:

- it was started from the phone (search, Ask, or a Keep watching tile), or
- an app says it is playing it for a minute or more, however it was started (the TV remote, the
  phone's arrow keys, the app's own menus). The same title has to play for the whole minute, and
  the app's own position has to pass a minute too, so a preview that autoplays on an app's browse
  screen never counts. This needs ADB connected, because the TV reads it from Android's media
  sessions, the same reading as "What is playing". Netflix, Disney+, Prime Video and most others
  say what is playing. Some say nothing (Netflix on some boxes) or only their own name ("PrimeVideo"
  while a film plays, seen on a Sony): that is never kept as a show by itself. Instead the app reads
  that app's row in Android's "Continue watching" (Watch Next), which Netflix and Prime keep up to
  date, usually as you leave the show, and names the play from it, for the person picked when it
  played. The app gives itself the permission to read those rows over its own ADB when it
  connects. An app that says nothing and keeps no such row still cannot land there.

Each card opens exactly the show it shows. One card per show (the latest episode), newest first,
**up to 10**: the row slides along as you move right. A show drops off after **30 days** with no
watching. The finder looks in the country on the setup page for the show's picture; left empty,
that is the TV's own region when the TV is not in English (a German TV in Germany looks in DE),
else AU. A title it cannot match exactly still goes in, with no picture, rather than another show's.
YouTube videos, music and Twitch stay out. There is no progress bar and no imported history; those
need the computer bridge (option B).

**People** (the names at the top left, set on the setup page or in Home settings) decide whose
Keep watching row the home shows. In on-TV mode, switching person:

- shows that person's Keep watching row, and only theirs: what they watched on this TV;
- tags what starts playing next as theirs, from the TV and from the phone (the phone remote follows
  the TV's choice, and the other way round). The TV remembers who it is on, also after a restart;
- tells Ask who is watching, if Ask is on.

It does not pick your profile inside Netflix or the other apps, and there are no picks per person;
both need the computer bridge (`app_profiles` in [docs/CONFIG.md](../docs/CONFIG.md)). With one
person or none, there is no switcher and Keep watching shows everything watched on this TV.

From 0.9 the row starts fresh: what was watched before then is not shown, because it does not say
who watched it. It fills again as you watch.

## Power on

The TV cannot wake itself: in standby the app is not running. Use the TV's own remote, HDMI-CEC
from another device, or Wake-on-LAN from anything that stays on (a phone shortcut, a router, a
Raspberry Pi running the computer bridge). On some TVs `POST /api/power {"state":"on"}` works for
a minute or so after "off", while the TV is still in light standby.

## Ask (optional, off by default)

On-TV mode has no AI unless you pick a service on the setup page, add your own key and switch
"ask" on. The default is Claude Haiku 5.5, and it can also use OpenAI, Google Gemini, OpenRouter,
Groq, Mistral, or any service or home server that copies OpenAI's chat completions API (Ollama,
LM Studio, llama.cpp and the like). It has a few tools (play, open an app, press a key, what is
on). On Claude Haiku 5.5 that is about a fifth of a US cent per ask at October 2026 prices; other
services and models price differently. Make a key just for the TV and set a monthly spend limit
with the service: the key is stored on the TV, and anyone with ADB access to the TV could read it.
A key is only ever sent to the service it was saved for: change the service and the saved key is
removed. Without a key (or a home server that needs none), "Ask for a show" answers that ask is
off. Details, the settings API and what a model must support are in
[docs/ASK-PROVIDERS.md](../docs/ASK-PROVIDERS.md).

## Uninstall

```
adb uninstall dev.couchtv.ontv
```
or Settings, Apps, Couch TV, Uninstall. This removes the app, its tokens and its ADB key. If you
switched off Google's launcher, switch it back on first (see above). To also remove the app's
debugging key from the TV, use the revoke option for debugging keys in Developer options (it signs
out every computer, so reconnect yours afterwards).

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| Phone shows "Pair this phone" again | The token was cleared (new phone, private browsing, or Forget phones). Type a new code. |
| "Pressing keys needs ADB on the TV" | ADB is not connected. Open Couch TV and press Connect ADB, or pair wireless debugging on the setup page. |
| "App not installed" | An older Couch TV signed differently is on the TV (uninstall it first), the download was cut short (download it again), there is too little space (keep 100 MB free), or Play Protect blocked it: in Google Play, your profile, Play Protect, switch off "Scan apps with Play Protect" while you install, then switch it back on (thanks prabakaran-offc, #138). |
| "Allow debugging?" never appears | Network debugging is off, or the TV suppresses the question (seen on an Android 14 Google TV). Use wireless debugging pairing instead. |
| Worked, then stopped after a restart | Port 5555 is often switched off by a restart. Pair wireless debugging once: the app then turns it back on and finds the new port after every restart. |
| Wireless debugging will not switch on | The TV is on Ethernet. Android only allows it on Wi-Fi. |
| The phone page does not load | Phone and TV must be on the same network. The address changes if the router gives the TV a new one; reserve it in the router. iPhone asks for Local Network access once. On an Android 17 phone, Chrome showing `ERR_TOO_MANY_RETRIES` means Chrome needs Settings, Apps, Chrome, Permissions, Nearby devices, Allow. |
| Apps do not open from the phone | Android blocked an app start from the background. Connect ADB once: the app then has the permission it needs. |
| Home button still goes to Google's home | See "Use it as the home screen". |
| Server not answering after a TV update | Open Couch TV once; it also starts at boot. |
| Keep watching stays empty | Connect ADB (the TV reads what is playing through it), then watch a show for a minute. Apps that do not say what is playing, YouTube and music never land there. See "Keep watching and people". On a current Fire TV, where Connect ADB cannot work, grant READ_TV_LISTINGS instead (Fire TV (Fire OS), above). |
| App icons look soft on a big TV | Update the app: icons are now drawn at 256 px from the sharpest icon each app ships. Older versions drew them at the TV's own density, often 96 px. |

## How it works

- `BridgeService`: a foreground service that starts at boot and runs the HTTP and WebSocket
  server (NanoHTTPD) on port 5400.
- `Adb.kt`: ADB to 127.0.0.1 with libadb-android (plain TCP, TLS and pairing, mDNS discovery). The
  app's RSA key and certificate are made on first run and kept in its private storage.
- `Finder.kt` and `Apps.kt`: the computer bridge's JustWatch lookup, app table and deep-link rules.
- `web/shim.js`: added to the phone remote's page by the TV app. It pairs the phone and adds the
  token to every call, so the remote itself is unchanged and the same build works with both modes.
- `web/setup.html`: Home settings on the phone (`http://<tv-ip>:5400/setup`): the town (the same
  Open-Meteo search as the TV), people (through the phone remote's People sheet), photos sent from the
  phone straight to the TV (made screen size there, `Photos.kt`), At home (note, lists, guest Wi-Fi,
  house guide, calendar and bookings links, handed into the home page's own store by
  `HomeActivity.atHome`), Ask, Use as home screen, Smart home where the TV has it, and ADB. Home
  settings on the TV shows a QR to it (with the pairing code, `#pin=`), and the phone remote's More
  sheet links to it. Everything stays on the TV and the home Wi-Fi; every setting can still be changed
  on the TV.
- Endpoints are those in `bridge/API.md`, plus `/api/pair`, `/api/pair/start`, `/api/adb`,
  `/api/adb/connect`, `/api/adb/pair`, `/api/settings`, `/api/home`, `/api/phones/forget` and `/api/ws`.
- `GET /api/home` and `POST /api/home {"on": true|false}` (paired, like the rest): the same switch as
  **Use as home screen**, for a setup tool on a computer or phone. On Fire OS a computer cannot flip
  it over ADB (`pm enable dev.couchtv.ontv/.HomeAlias` fails with "Shell cannot change component
  state"). Both answer `{"on", "held", "fire_tv", "watch"}`: `held` says whether Android already
  sends the Home key here (on a plain Android TV the person still answers Android's own chooser
  once), `watch` whether the Home button watch is running. `POST` needs `Content-Type:
  application/json` and a real `true` or `false` (anything else is a 400), switches only couch-tv's
  own home (never the TV's launcher or setup app), and answers 429 if asked to flip it again within
  two seconds.
- A save from a phone or setup tool (`POST /api/settings`, `/api/app-order` or `/api/people`) shows
  on the TV straight away: the home page reads them again as if it had just come back on screen.
  Saves the home page makes itself are left alone.
- Home settings on the phone (all paired, like the rest):
  - `POST /api/settings {"settings_patch": {"place": {name, area, lat, lon, timezone} | null}}`
    changes only the town (the home's own place shape); any other key is a 400.
  - `POST /api/settings {"settings": {...}, "seen": "<updated>"}` is the home's whole copy. `seen` is
    the `updated` the home last read (`"none"` if there was no copy then). When it is not the server's
    current `updated`, the home's copy is older, so `place` and `photos` stay as the server has them
    (present or not). The answer carries the copy kept, which the home takes.
  - `POST /api/photos` with the picture itself as the body (JPEG, PNG and the like, up to 25 MB and
    100 megapixels): turned upright, made no bigger than 1920 by 1080, kept on the TV, added to the
    photos. Answers `{"photo": {id, file}, "count"}`; 413 too big, 415 not a picture, 409 when 50 are
    on the TV already. `GET /api/photo/<file>` gives one back (the phone page's list).
    `POST /api/photos/remove {"id"}` takes one off and deletes its file.
  - `GET /api/athome`: the home page's At home words (`live: false` when the home page is not
    loaded). A calendar or bookings link comes back as its host only.
  - `POST /api/athome {"edit": {note, lists, wifi, guide, cal_url, stay_url, checkin, checkout}}`:
    handed into the home page's own store. With the page not loaded, the change waits in the app's
    storage (`queued: true`) until it loads, except lists and the guide (sent whole), which answer
    409, as does a 21st waiting change.
  - `GET /api/phone-link`: `{"url": "http://<tv>:5400/setup#pin=NNNNNN", "pin_expires_in"}` for Home
    settings' QR and its computer line. The code is the live one, or a new one when that has 30
    seconds or less left.

## Tests

`KeepMergeTest` (plain JUnit, `gradlew -p on-tv/android testDebugUnitTest`, run by CI) checks how
Keep watching lists Android's Watch Next rows and merges them with this TV's own history.

`scripts/emulator-test.mjs` drives an Android TV emulator end to end (pairing, 401s, loopback ADB
with the real "Allow debugging?" dialog, keys, launch, deep link, volume, power, the phone page at
390x664). It refuses to run against anything that is not an emulator.
