## Couch TV 0.13.14: Couch TV Helper, apps on your TV in Studio, and fixes

Couch TV Setup can now stay on your computer as Couch TV Helper, a small app in your menu bar or tray that adds extras while it is on. Couch TV Studio can show which apps are on your TV. Home settings no longer stops with an error when nothing is saved yet.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.14 carries the same key as 0.13.13, so a TV on 0.13.13, 0.13.12 or 0.13.11 updates as normal. On Android 9 and newer, a TV on 0.13.9 or older takes 0.13.10 first, as the 0.13.11 notes say.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Couch TV Setup:** download it again from the Releases page to get the Helper. Nothing changes if you only use Setup once.

### Couch TV Helper

- **Extra features from this computer.** The last screen of Couch TV Setup asks: Done, or Add extra features. The TV works on its own either way.
- **What it adds:** turn the TV on from your phone, Ask AI on your home computer, picks, and the phone remote and opening Couch TV for a Samsung, LG or Roku TV. It has no AI of its own and needs no coding.
- **It stays out of the way:** a menu bar item on a Mac, a tray icon on Windows and Linux, or a small page on this computer when there is no tray. **Start with this computer** is a tick box that is off until you pick it. **Turn off extra features** stops it and removes the start item. Open Setup any time to turn it on again.
- **Turn it on from your account:** the link `couchtv://helper/on` opens Setup on the Add extra features screen.
- **It keeps itself up to date.** It looks for a newer version once a day. A new version is used only when it carries Couch TV's signature and matches its checksum, and only when you press **Update ready, restart**. The old version is kept in case you need it.
- **It keeps the computer awake only when a TV needs it:** a Samsung, LG or Roku TV is set up, and the computer is on power. **Let this computer sleep** overrides that.
- **Remove everything from this computer** in its menu stops the helper and deletes what Setup keeps here: the TV key, helper settings, bridge data and downloads. It reminds you to forget the key on each TV.
- **Your Samsung, LG or Roku TV** shows "Your TV needs the helper" in Setup, with what it does and what stops when the computer is off.

### Apps on your TV, in Couch TV Studio

- **Couch TV Setup and the Couch TV app tell Studio which apps are on a linked TV:** the package names of the apps that have a launcher icon, at most 300, so Studio can show the apps on your TV first.
- **Nothing else:** not who is signed in inside any app, no app data, no usage, nothing that names the one TV. Couch TV's own apps are left out. The list is read once when Setup connects or the TV fetches a design, never in the background.

### Fixes

- **Home settings:** the settings save a moment after a change no longer fails with "reading 's'" when nothing has been kept yet.
