## Couch TV 0.13.11: add many apps at once, the right fonts on the TV, and the on-TV app's own signing key

Filling a folder, the Dock, an app grid or Games no longer means adding one app at a time: one sheet lists every app on the TV and you pick the ones you want. Widgets set in Jost or Cormorant Garamond in Couch TV Studio now draw in those fonts on the TV. And from this release the on-TV app is signed with its own release key.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. On Android 9 and newer, a TV still on 0.13.9 or older should take 0.13.10 first; see "The on-TV app's own signing key" below.
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

### Fixes

- **No weather line over your widgets.** On a design made of widgets with no date or weather of its own, the standard home's top line (the town, the moon and the weather) was drawn over a smart stack and behind a Wi-Fi tile. It now steps aside with the rest of the home's top, as the date and clock already did. A design without widgets still shows it.
- **The update question comes back.** After a design code from the welcome, "Tell you when a new Couch TV version is out?" waited for the home to come to the front again, but pressing Home never brought it. Now it asks a moment after you press Home or come back from an app, and never while "Use this design?", Home settings, Share this home or another sheet is on top: it waits until that has gone.
- **The design code error names Couch TV Studio** on the on-TV app and from the computer at home, as the TV does.

### The on-TV app's own signing key

0.13.11 is the first release where the on-TV app (`couch-tv-ontv.apk` and `couch-tv-ontv-watch.apk`) is signed with its own release key on TVs with Android 9 and newer. 0.13.10 knows how to accept it, so a TV on 0.13.10 takes this update the usual way with Update to. A TV on Android 6, 7 or 8 keeps seeing the old key and updates the usual way.

A TV on Android 9 or newer that skipped 0.13.10 says the file has another key in Update to. Install 0.13.11 once with Downloader (code 8180170) or over the old app from a computer instead, and your settings stay. Android checks the new key itself.

For people who build their own releases: `scripts/release.sh` now signs 0.13.11 and later with the new key by default (ONTV_SIGN defaults to 1), and refuses ONTV_SIGN=0 when publishing 0.13.11 or later to couch-tv. Test builds with ONTV_SIGN=0 and a fork's own releases work as before.
