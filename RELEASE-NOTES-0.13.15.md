## Couch TV 0.13.15: a redesigned Couch TV Setup that links your TV to your account, Tidy up your TV, and Make it yours

Couch TV Setup has a new look and a new name, finds more TVs, and links the TV it sets up to your Couch TV account after asking whose account it is. There is an optional Tidy up your TV step. A new TV opens on a Make it yours card that fetches your design.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.15 carries the same key as 0.13.14, so a TV on 0.13.14, 0.13.13 or 0.13.12 updates as normal.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Couch TV Setup and the Helper:** a Helper updates itself when you press Update ready, restart. Otherwise download Couch TV Setup again from the Releases page.

### Couch TV Setup

- **New look, new name.** The app, its folder and the program are called Couch TV Setup (they were "couch-tv Setup"). A Helper that is older than 0.13.15 still finds the program after it updates.
- **Finds more TVs.** One unanswered probe no longer hides a TV, and the TVs' own announcements show first.
- **Links the TV to your account, after asking.** Whether you type a code or press Allow on the website, Setup shows "Link as (email)?" and uses nothing until you press Yes. After Yes it registers the TV, writes the link into Couch TV, and says the TV is linked only when the TV said it took the link. If the TV cannot say, Setup says it was sent. The finish screen can link a TV that is already set up, with no reinstall.
- **Plain ways on when linking fails:** sign in again, Find the TV, or Update Couch TV.
- **Tidy up your TV (optional, between the progress screen and Finish).** Fewer ads, shorter menu animations, a smoothness check, and undo. Stop idle screen adverts now covers Android TV's Backdrop screen as well as Google TV's ambient mode, and reads back what the TV says about its screen saver. If the TV refuses, it says so.
- **The finish screen** shows the TVs set up in this session, and its main button no longer runs under the TV picture on a window about 1280 wide.

### On the TV

- **Make it yours.** A new TV opens on a Make it yours card. If the TV is linked, it looks for your design every 20 seconds while the card is open, at most 45 times in the TV's life, and stops when you leave the card. A TV that is not linked asks nothing.
- **Fire TV (the on-TV app).** The home comes to the front when the watch connects just after a restart.
- **Get my new design** is the first row of Home settings on a linked TV. One press is one look.

### Not in this release

- Nothing about a TV is sent anywhere unless you press Yes to link it.
