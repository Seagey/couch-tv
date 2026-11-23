## Couch TV 0.13.11: add many apps at once, the right fonts on the TV, and the on-TV app's own signing key

Filling a folder, the Dock, an app grid or Games no longer means adding one app at a time: one sheet lists every app on the TV and you pick the ones you want. Widgets set in Jost or Cormorant Garamond in Couch TV Studio now draw in those fonts on the TV. And from this release the on-TV app is signed with its own release key.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.11 is signed with a new key: a TV on 0.13.10 updates as normal, but on Android 9 and newer a TV on 0.13.9 or older must take 0.13.10 first, or install 0.13.11 once with Downloader (code 8180170). See "The on-TV app's own signing key" below.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Samsung, LG and the other TVs a computer at home runs:** nothing to do on the TV. The computer at home hands out the new home after `git pull` and a restart.

### Add apps: one sheet for a folder, the Dock, an app grid or Games

- **Hold OK on an app in a folder, the Dock, an app grid or Games, and choose Add apps.** The Add app place at the end of the row opens it too. A tile with one app still has Change app.
- **The sheet lists every app on your TV**, seven across, with the same icons as the Dock. The folder's name and "3 of 12 picked" sit at the top, and the apps you picked come first, numbered in order.
- **OK picks an app or takes it out.** The apps stay where they are while you pick, so the remote never jumps. Hold OK on a picked app to move it: Left and Right, then OK puts it down.
- **Back saves** and says Saved. Back with nothing changed changes nothing. A full folder says "That holds 12 apps. Take one out first."
- **An app that is no longer on this TV** shows dimmed, so you can take it out.
- **Home settings, the widget's page** has Add apps too, with how many are picked.
- In all 16 languages the home speaks.

### Fonts from Couch TV Studio

A widget set in **Jost** or **Cormorant Garamond** in Couch TV Studio drew in the home's own font on the TV, because the home had no copy of either. The home now carries both, and fetches them only when a design uses them.

### Also new

- **Spotify's own Now playing card, thanks TheOfficialTAGM** ([#321](https://github.com/Seagey/couch-tv/pull/321), [#324](https://github.com/Seagey/couch-tv/pull/324)). Switch on Spotify in Home settings, Look (under Now playing), and the home shows the song the Spotify app on your Android TV is playing, with its cover, how far in it is, and buttons to go back, rewind, play or pause, fast forward and skip. It reads the TV's own player: no Spotify account, and nothing is sent to Spotify. The home needs notification access once, which `apply.sh` gives it (docs/CONFIG.md, Spotify). Long titles can scroll, and the card can sit in line with the Dock.
- **Keep watching as posters in the Night look, thanks atishay-kasliwal** ([#323](https://github.com/Seagey/couch-tv/pull/323)). Home settings, Look, Keep watching as posters shows the row as the Classic look's plain picture tiles, about six across where three cards fit.

### Fixes

- **No weather line over your widgets.** On a design made of widgets with no date or weather of its own, the standard home's top line (the town, the moon and the weather) was drawn over a smart stack and behind a Wi-Fi tile. It now steps aside with the rest of the home's top, as the date and clock already did. A design without widgets still shows it.
- **The update question comes back.** After a design code from the welcome, "Tell you when a new Couch TV version is out?" waited for the home to come to the front again, but pressing Home never brought it. Now it asks a moment after you press Home or come back from an app, and never while "Use this design?", Home settings, Share this home or another sheet is on top: it waits until that has gone.
- **Home settings keeps the row you are on in view.** On a long page, pressing Down quickly at the last row could leave that row under the bottom edge of the screen. The page now always scrolls far enough to show it.
- **Back closes the Ask AI sheet on Android TVs.** Pressing Back while Ask AI was open went past it to the home behind. Now Back closes Ask AI first.
- **The design code error names Couch TV Studio** on the on-TV app and from the computer at home, as the TV does.

### The on-TV app's own signing key

0.13.11 is signed with a new key. The on-TV app (`couch-tv-ontv.apk` and `couch-tv-ontv-watch.apk`) now carries its own release key on TVs with Android 9 and newer.

- **A TV on 0.13.10** updates as normal: Home settings, Updates, Update to. 0.13.10 knows how to accept the new key.
- **A TV on 0.13.9 or older** (Android 9 or newer) must take 0.13.10 first, then 0.13.11. Or install 0.13.11 once with Downloader (code 8180170), or over the old app from a computer. Your settings stay, and Android checks the new key itself. If you press Update to on 0.13.9 or older, it says the file has another key: that is this, and nothing is wrong with the file.
- **A TV on Android 6, 7 or 8** keeps seeing the old key and updates as normal from any version.

For people who build their own releases: `scripts/release.sh` now signs 0.13.11 and later with the new key by default (ONTV_SIGN defaults to 1), and refuses ONTV_SIGN=0 when publishing 0.13.11 or later to couch-tv. Test builds with ONTV_SIGN=0 and a fork's own releases work as before.
