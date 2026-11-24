## Couch TV 0.13.13: your home from your Couch TV account, Setup finds the TV for you, and Glass text

Your names, photos, town and guest Wi-Fi can now come to the TV from your Couch TV account. Couch TV Setup finds the TV on your Wi-Fi and links it to your account, and a design you send from your account goes on the TV with one click. Widgets get two new text colours: Glass and Liquid glass.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.13 carries the same key as 0.13.12, so a TV on 0.13.12, 0.13.11 or 0.13.10 updates as normal. On Android 9 and newer, a TV on 0.13.9 or older takes 0.13.10 first, as the 0.13.11 notes say.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **The TVs a computer at home runs without Android:** nothing to do on the TV. The computer hands out the new home after `git pull` and a restart.

### Your home details from your account

- **A design sent from your Couch TV account to your own TV can bring your home with it:** the people's names and colours, who is a kid, your town for the weather, and your guest Wi-Fi.
- The account's people come first, then anyone added on the TV. Change a name in your account and send again: the TV follows.
- **Home settings, People** says "From your account" under each of them, and has a row to take your account's names, town and guest Wi-Fi off this TV. Location and Guest Wi-Fi say "From your account" the same way.
- None of it is ever part of a design, a Share this home code or anything the TV sends back. A late code with older details never replaces newer ones.

### Photos on People

- **A person can have a photo.** It shows in the round head icon, its list, Home settings, People, kids mode and the People widget. The initial on its colour stays underneath, for anyone without one.
- Photos come only from your own account, only to a TV you picked, and stay on the TV. They never go to the phone page, a computer at home or a shared design.

### Couch TV Setup finds the TV on your Wi-Fi

- **No address to type.** Couch TV Setup lists every TV it hears on your Wi-Fi by name, and says what each one needs: Ready, Type the code, or 1 step on the TV with picture steps for that TV.
- **Signed in from the website:** on a Mac or Windows, Set up my TV on the website opens Setup already signed in to your Couch TV account. On Linux, sign in with the code Setup shows.
- Setup installs the newest Couch TV, checked against the release's sums, makes it the home, links the TV to your account, brings your home details and your design, and checks how smoothly it runs.
- **Or sign in with a code:** Setup shows a code like ABCD-EFGH to type on the Couch TV website.
- **Setting the same TV up again** keeps it as the same TV in your account, instead of adding a second one.
- **Couch TV Setup for Linux:** `couch-tv-Setup-linux.tar.gz`, for 64 bit Intel or AMD computers on Ubuntu, Debian, Fedora, Arch or Omarchy. Unpack it and open **couch-tv Setup** in the folder. It needs no adb, no USB cable and no udev rule.
- **Something not right?** The last page can show a health report. You see all of it first, and it goes to your account only if you press Send.

### Your account's inbox: one click Send

- **A TV that Setup linked to your account picks up designs you send to it.** Press Send in your account, and the TV gets it when it next wakes or you come back to the home after 30 minutes or more away, with no code to type and no second question, then says "New design from your account" once.
- **Undo:** Home settings, Designs, Undo the new design, for 24 hours. It puts back the design you had.
- **Unlink:** Home settings, Designs, Unlink this TV from your account. Press OK twice. The design and names on the TV stay. Running Setup again links it again.
- **Check for new designs now** in Home settings, Designs looks straight away. Otherwise the TV looks once a week, and never while an app or the screensaver is on.
- The link is kept in the app's own private storage, never shown, never in a design or a backup.
- The design Setup brings comes with no typing too. The TV asks "Use this design?" first, as for a typed code.

### Glass and Liquid glass text

- **Two new text colours for widgets in Couch TV Studio designs.** Glass draws the words as frosted, see through white, or smoked dark glass on a light box.
- **Liquid glass** draws the words as clear glass letters with the photo behind them showing through.
- On a 1 GB TV, the lighter look, or over a plain colour, Liquid glass draws as Glass, and Glass draws solid where the TV needs it.

### The TV says what kind of TV it is

- **Getting a design by code** on the Couch TV home app or the on-TV app now also sends the kind of TV with the version and memory from 0.13.12: the platform (Google TV, Android TV or Fire OS), the Android version number, the screen size and the model name (such as Smart TV Pro). Each is checked first.
- No serial number, no ids, no address, no place. Couch TV Studio uses it for "Will it play on your TV?" and to pick the TV in its editor. docs/PRIVACY.md and docs/CONFIG.md say the same.

### Credits

- The weather data credit to Open-Meteo.com and the place data credit to GeoNames from 0.13.12 stay where they were, on the forecast, air quality and surf a weather widget opens, and in Home settings, Location.
