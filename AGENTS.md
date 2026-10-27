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

The README's steps are numbered 1 to 6. Option A uses steps 1, 2 and 6. Option B uses steps 1 to
6. Option C follows [on-tv/README.md](on-tv/README.md) (the app `dev.couchtv.ontv`).

## 0. Before you start (quietly)

1. Run `python3 --version`. It must be **3.11 or newer**. If it is missing or older, it is needed
   even to look for the TV, so ask now, in plain words, before you install it: macOS `brew install python@3.11` (or the installer from
   python.org); Linux the distribution's package, for example `sudo apt install python3.11
   python3.11-venv`. On a Mac the first `python3` or `git` may pop up "install the command line
   developer tools": tell them to press Install and wait a few minutes. That is normal.
2. Note what else the computer has: macOS or Linux, Node 20+ (option B), and only if they will
   build the TV app themselves, JDK 21 and the Android SDK (platform 34). Most people should
   **download `couch-tv-home.apk` from the GitHub Releases page** instead of building it. Building
   is in the README ("Building the app"); `scripts/build-apk.sh` does it.
3. Windows is not supported for the bridge (option B); it can still install the app if Python is
   there.

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
- `find-tvs.py` says "No Android TV found": for a Samsung, LG or another brand that is expected.
  Ask the brand and model. To confirm with `check-tv.py`, ask for the TV's address:
  - **Samsung:** Settings, General (or Connection), Network, Network Status (or Network
    Information), the IP address.
  - **LG:** Settings, Network (or All Settings, General, Network), Wi-Fi Connection, the connected
    network, Advanced Wi-Fi Settings, the IP address.
  - **Google TV or Android TV:** Settings, Network and Internet, the Wi-Fi network.
- Ask them to open **Settings, System, About** (Google TV) or **Settings, Device Preferences,
  About** (Android TV 9 to 11) and read you the model and the "Android TV OS" line. No such line
  usually means it is not Android.
- Common reasons a Google TV is not found: TV asleep, TV or computer on a guest Wi-Fi, the router
  keeps devices apart ("client isolation"), or macOS's Local Network permission was refused
  (System Settings, Privacy and Security, Local Network). Phone, TV and computer must all be on the
  same network.

Check the answer against [docs/TV-COMPATIBILITY.md](docs/TV-COMPATIBILITY.md):
- **Google TV or Android TV** (Sony, TCL, Hisense Google TV, Philips, Xiaomi, Chromecast with
  Google TV, Google TV Streamer, Nvidia Shield, Onn): supported.
- **Fire TV on Fire OS** (Stick 4K Max, Cube): partly. Say what will not work before going on.
- **Samsung (Tizen):** do not say no. Offer the Samsung path in
  [docs/SAMSUNG.md](docs/SAMSUNG.md), with its honest limits, in plain words: "couch-tv goes on
  your Samsung as an app, and a computer at home that stays on opens it every time the TV is
  switched on. It is not a true home screen: the remote's Home button still opens Samsung's menu.
  The phone remote works. Netflix and YouTube open the show; other apps open on their own page.
  There is no 'what is playing' and no screenshots. You will sign in to your own Samsung account
  once on this computer, and press Allow on the TV once." Without a computer that stays on, only
  the app itself is possible (opened from Samsung's app row). Also offer the Google TV box as the
  way to get everything. If they choose Samsung, follow docs/SAMSUNG.md for steps 2 to 4 (most
  questions in step 2 still apply; skip picture mode, apply.sh and ADB).
- **LG (webOS):** possible but untested. Say so plainly: "An LG should be able to do what the
  Samsung does, but nobody has tried it yet, so I can't promise it." Point to
  [docs/LG.md](docs/LG.md) and offer the Google TV box. Do not attempt it unless they want to be
  the first to try, and then tell them nothing is tested.
- **Roku, Apple TV, Hisense VIDAA, Fire TV on Vega OS:** not supported. Say so kindly,
  explain what the README's "Will it work on my TV?" table says for their TV, and offer the way
  round it: a Google TV box (for example the Google TV Streamer) plugged into the TV's HDMI gets
  them everything. If they do not want a box, stop. Do not suggest rooting the TV.

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
> straight to the TV. You lose turning the TV on from the phone, and the Claude assistant only
> works if you add your own Anthropic API key, which costs a little per question. On newer Google
> TVs you may have to type a pairing code from the TV's settings again after the TV restarts."

Then: "Do you have a computer that is always on at home?" If yes, B is the best tested. If no,
recommend C (A if they only want the home screen). Write the choice down; the rest of the questions depend on it.

### 2.2 People (profiles)

- "Who watches this TV? Give me a name for each person, the way you want it on screen."
  One person: no switcher. Two: a switch at the top left. Three or more: a round head icon at the
  top left that opens a list.
- "What order should the names go in?" (They can change it later from the phone or the TV remote.)
- "Any kids or guest profiles?" Mark them in `config.json` with `"kid": true` or `"guest": true`.
  Option B: they are left out of the household's taste, so the shared picks are not full of
  cartoons or a visitor's shows. They still have their own row. Imported Netflix Kids profiles are
  left out the same way.
- Option B, optional: "Do you want to bring in your past Netflix or YouTube history so 'keep
  watching' and suggestions start smart?" If yes, walk them through
  [bridge/IMPORT.md](bridge/IMPORT.md) later. They download their own files. You never sign in to
  their accounts.

### 2.3 How the home looks

- Show them the pictures at the top of the README. "Do you want the five scenes taking turns, just
  some of them, your own photos, or the Classic look?" Own photos: 1920x1080 JPEGs into
  `tv-home/web/backgrounds/`.
- "How long should each scene stay?" (20 seconds is the default.)
- "12 hour or 24 hour clock?"
- "What suburb or city for the weather?" Look up its latitude, longitude and time zone yourself.
- "What country are you in?" (For where shows stream. Two letter code, for example AU, US, GB.)

### 2.4 Apps

- "Which apps do you use most? I'll put them first." The home shows 10 apps in a row, then
  Settings and More apps. Everything else sits behind More apps.
- "Any apps you never use that I should tuck away behind More apps?" A maker's own clutter (help
  apps, file browsers) can be hidden completely with `home.hide_packages`.
- Tell them: new apps come from the **App Store** tile (top of More apps) and turn up on the home by
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
- Tell them: it works on the home Wi-Fi only. Option B, optional: a private network (VPN) app
  they run themselves can make it work away from home. Never open a router port for it.
- Tell them plainly: **with option B there is no password, so anyone on the Wi-Fi can use the
  remote and the assistant, kids and visitors included.** Suggest a guest Wi-Fi network for
  visitors (most routers have one) so they cannot reach it. Option C asks for a PIN shown on the TV
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

## 3. Read the plan back and get a yes

Before you touch the TV, say back, in one short list: the TV, the option, the people, the look,
the apps first in line, the quick settings, and what will be switched off on the TV. Then explain
exactly what changes:

- Developer options and USB debugging go on (README step 1), plus Network debugging. The TV asks
  "Allow USB debugging?" once per computer. They tick Always allow.
- If `check-tv.py` said the TV only has Wireless debugging: you will pair once with Google's
  platform-tools and run `adb tcpip 5555` (README step 1, "Only Wireless debugging?"). On some TVs
  that port closes after a restart and has to be opened again the same way.
- Options A and B (`apply.sh`) switch off the Google TV home, ambient mode (the idle adverts), the
  setup wizard and any ad tracker you agree to. Nothing is deleted. Other makers' own homes are
  left alone. Warn them:
  - Some Google Home features and the YouTube button on the remote may stop working.
  - On some TVs, switching the setup wizard off made the TV forget its Wi-Fi. If that happens,
    they re-join the Wi-Fi at the TV. Have the TV remote ready.
  - Option A: after a Google TV update brings the Google home back, `apply.sh` has to run again.
    Option B's bridge does that check every day.
- **If `survey-tv.py` printed its Wi-Fi WARNING** (the setup wizard owns the saved Wi-Fi): tell
  them before they say yes that switching the wizard off may drop the TV off the Wi-Fi, and then
  the computer undo cannot reach the TV; the fix is the TV-remote route in
  [docs/UNINSTALL.md](docs/UNINSTALL.md). Recommend leaving the wizard on (`KEEP_SETUP=1`) if they
  prefer, and say that on some TVs the Google home then keeps the Home button. You can run
  `survey-tv.py` only after the yes (it uses ADB), so if the warning appears then, stop and ask
  again before `apply.sh`.
- Show them the undo ([docs/UNINSTALL.md](docs/UNINSTALL.md)) before you start.

Ask: "Ready for me to set it up? You can undo all of it." Wait for a clear yes.

## 4. Set it up, then check it

1. Install what was missing in step 0 (say what you are installing). Prefer the release APK
   (`couch-tv-home.apk` from the GitHub Releases page) over building.
2. Write `config.json` from their answers. Never commit it.
3. Developer options on (README step 1). Then, while they stand at the TV, run
   `.venv/bin/python scripts/check-tv.py <tv address> --adb` and have them tick **Always allow**
   and press Allow. Now settle B or C from its Android version.
4. **Allow every computer and app before `apply.sh`.** Seen on one Google TV (Android 14): once the
   Google TV home and the setup app were switched off, the TV stopped showing "Allow USB
   debugging?" for any new key; computers allowed before kept working. So, before step 5, make
   sure each computer that will talk to the TV has been allowed, and for option C that the on-TV
   app's **Connect ADB** has been allowed.
5. Follow the README for their option (A: steps 1, 2 and 6; B: steps 1 to 6;
   C: [on-tv/README.md](on-tv/README.md)). Run `tv-home/tools/survey-tv.py` before `apply.sh`.
   Option A: run `apply.sh` with no `BRIDGE_URL`. Option B: with `BRIDGE_URL`.
   - **Pairing (option B, README step 3):** you cannot type into `pair_tv.py`. Run
     `.venv/bin/python bridge/pair_tv.py <tv id>` in the background, ask them to read you the code
     on the TV, then run `.venv/bin/python bridge/pair_tv.py <tv id> --code <code>`. It prints
     `ok: ... is paired` and exits 0, or says the TV refused the code (then start again: each
     pairing shows a fresh code).
6. Check, with them watching the TV: press Home (the new home shows), open two apps, the sleep
   timer, the profile switch, and for B and C one press on the phone remote.
7. Hand over in plain words: how to rearrange apps (phone, or hold OK on the TV), how to add apps
   (App Store tile), how to change profiles, where the undo is, and for option A that a Google TV
   update may need `apply.sh` once more.

## Rules while you work

- `config.json`, `.env` and `bridge/data/` hold their settings and history. Git ignores them.
  Never commit them, and never paste their contents into issues or chat logs.
- If they want to share their own fork, run `scripts/privacy-scan.sh` first. It must find nothing.
- Option B runs `claude -p` with `ANTHROPIC_API_KEY` removed on purpose, so it uses their Claude
  plan, not a paid key. Leave that in place. Option C only uses an API key they typed in themselves.
- If anything on the TV fails, stop and tell them what happened. Do not keep switching apps off to
  make it work. The scripts stop on the first failure and say so in one line.
- If they say "take it off" or "I broke it", go straight to [docs/UNINSTALL.md](docs/UNINSTALL.md).
  Option B: stop the bridge first.
