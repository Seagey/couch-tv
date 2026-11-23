## couch-tv 0.13.10: a simpler start on a new TV, widgets set up on your phone, and fixes from a fresh TCL

We set up a TCL from scratch with 0.13.9, the way a new person would, installed from Downloader, and fixed what got in the way. The on-TV app now sets up in two steps with the TV remote, and everything else sits in one Settings screen. A TV that was never set up opens on a welcome that asks one question: do you have a design code, or do you want Couch Original. Widgets that need something private, like your town or your calendar, are now set up on your phone, not with the TV remote. App folders stack their apps in rows, a video background plays on a 1 GB TV, the home opens faster the second time, and a countdown can count to Easter, Mother's Day or Father's Day.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to (one button, if Couch TV can press keys on your TV), or follow the steps there. Your settings stay.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Samsung, LG and the other TVs a computer at home runs:** nothing to do on the TV. The computer at home hands out the new home after `git pull` and a restart.

### Widgets are set up on your phone

The TV no longer asks you to type into a widget with the remote.

- **A widget that is waiting says what it is.** A weather widget with no town, a calendar with no link, a photo frame with no photos and the rest show their name, one short line ("Your next events") and **Set up on your phone**, with a QR code when there is room. Scan it and the phone opens that widget's step, already paired.
- **Hold OK puts the phone first.** "Calendar: set up on your phone" or "Edit on your phone" is the first choice, a smart stack included ("Edit the stack on your phone"). Under the code, **No phone? Set it up here** still opens the widget's page in Home settings.
- **A new design brings one code.** When a design arrives with widgets still to set up, the TV shows "Set up your widgets" and one code for 2 minutes. The phone walks through each widget, then says "All set. Look at your TV."
- **The agenda widget is called Calendar** while it waits, the word people know.
- **The TV never names kinds of TV** on a widget or in the Ask AI sheet. Whether a widget works on your TV is for Couch TV Studio to say before you place it.

### The phone page: Widgets on your screen

The TV's phone page (the QR code in Home settings) now starts with **Widgets on your screen**: one card for each widget, drawn the way your TV draws it.

- **Edit** opens that widget's settings as plain buttons and lists.
- **Connect** walks through the private parts: your calendar (Google, Apple, Outlook, Airbnb or a bookings calendar), your town, your photos, Spotify and the rest, in a few short steps each.
- **An apps card** shows the apps on your TV with their own icons.
- **Your town from Couch TV Studio:** Studio's "Set up my widgets" link can carry your town. The phone asks "Use this town for the weather?" and saves it only on Yes. The town is only ever in the link itself, never sent to a server.

### The on-TV app: setup in two steps

- **Step 1 of 2, Make Couch TV your home.** One big button where Android can ask. On a TV that keeps Google's own home on the Home button, one plain line says what to do instead, with Next and More help behind it.
- **Step 2 of 2, Open your new home.** It opens the home, where the new welcome takes over.
- **Later opens** say Couch TV is ready, with Open the home and Settings.
- **The Couch TV Studio look:** the same light blue wall, white cards and rounded fonts as the Studio website.

### The on-TV app: Settings

One list on the left, the chosen item on the right:

- **Edit your home:** a QR code to the TV's phone page, where widgets, the town, calendars and photos are set.
- **Phone remote:** pictures of the real phone remote, the pairing QR code and code, New code and Forget phones. On a TV where the phone cannot press keys yet, a yellow strip with Set it up walks through the TV's own menus, in the words that TV uses (Android TV, Google TV or Fire TV), and skips the switches that are already on.
- **Undo Couch TV:** asks first, then gives the Home button back to the TV's own home, switches the Home button watch off, and offers Android's own Uninstall question.
- **Help:** a QR code to the help site.

The More button is gone. Everything it had is in Settings. Words everywhere that pointed at it now say Settings, Phone remote, Set it up.

### The first-run welcome

A TV nobody has set up yet (the on-TV app, or the home app with no computer) now opens on one full screen question instead of the classic home:

- **I have a design code** goes straight to the box where you type the code from Couch TV Studio.
- **Use Couch Original** gives you the standard home. Back does the same.

It is asked once. A TV that was already set up before this update never sees it. It is in all 16 languages the home speaks, and it looks like the Studio website.

### App folders, the Dock and Games

- **App folders stack their apps in rows.** As many as fit now picks the layout with the biggest apps, so a small folder stacks two or more rows instead of one row of tiny apps. "4 across" is exactly 4 across.
- **The remote goes app by app.** Inside a folder Right at the end of a row goes to the first app of the next row, and every app is a stop.
- **The Dock and Games never drop an app without a word.** When more apps are chosen than fit, the last place shows "+3" and OK on it opens every app. Games holds up to 8 games.

### Video backgrounds on a 1 GB TV

A design with a video background, such as Aquarium, now plays its video on a TV with 1 GB of memory, Lighter home or not, using a smaller copy. It lets go of the video the moment you open an app. Under 1 GB, power saver, data saver and less motion still show the still picture. To keep the still picture on any TV: Home settings, Designs, **Show the still picture instead**.

### More from Couch TV Studio

- **Countdowns to Easter, Mother's Day and Father's Day.** The TV works out the date each year (Mother's Day the second Sunday in May; Father's Day the first Sunday in September, or the third Sunday in June).
- **More widget settings come with the design**: temperature units, where the moon is seen from, the air quality scale, surf heights and wind, the soundscape's volume, the doorbell and energy headings, and Guest Wi-Fi's Hide the password. Your town, beach, Home Assistant and other private settings stay on the TV. A setting changed on the TV still wins.
- **Up next says what it shows** in plain words: Your next show, Your last game, or Last game when Scores is on.

### Voice

- **The remote's mic and search button open your TV's own voice assistant from the Couch TV home.** The home no longer keeps the key for itself: it asks the TV for its own assistant.
- **The home app is called Couch TV** in the TV's app list (it said Home), so "Hey Google, open Couch TV" finds it.

### Clocks in another time zone

The digital, tall, glass, flip, analogue and word clocks in a Studio design can show another time zone, for family overseas. Leave it out and the clock shows the TV's own time, as before.

### Fixes

- **The town is just the town.** A town picked by search showed its whole name, such as "Town, Shire, State, Country", on the date line and in a design's weather, and on the Aquarium design it ran off the right edge. Now only the town's own name shows, and a very long one ends in "...". Home settings, Location still shows the full name.
- **The home opens faster the second time (on-TV app).** On a 1 GB TCL the home was nearly blank for about 5 seconds on every open, while the TV loaded 3 MB of the home's files again. Now the TV keeps its copy until the app is updated. The very first open after installing or updating still loads everything.

- **The update question no longer pops up over a new TV.** "Tell you when a new Couch TV version is out?" came up over the home about 5 seconds after the first open on the TCL. It now waits until the welcome is answered, and asks at a calm moment later: the next time you come back to the home. That includes I have a design code: the home starting again with your design no longer has the question behind "Use this design?".
- **"Guest Wi-Fi" stays whole** on a small tile, instead of "Guest Wi-" over "Fi".
- **A smart stack's dots no longer cover its words.** They have a thin strip of their own on the right, so a 4 by 2 stack's weather shows its temperature in full.
- **No thin line round the screen** on the welcome. The TV's own focus line round the whole home is off; the home shows where you are itself.
- **A video background gets another try after an update.** A TV that once could not keep up kept the still picture for a week, even after an update. Now an update tries the video again.
- **The Couch TV name everywhere.** The banner in the TV's app list says Couch TV, and Home settings says Couch TV Studio, like the welcome.
- **Share this home points to Couch TV Studio's own address,** couchtv.joshuaseage.com/design.
- **A hidden "Allow USB debugging?" box.** On the TCL an old Allow box was left open behind Couch TV after an earlier try ran out, and the TV would not show a new one, so Connect seemed to do nothing. Now, if no Allow box comes up over Couch TV within a few seconds, the screen says "The TV's Allow box may be hidden. Press Back once to see it, or switch USB debugging off and on." and Couch TV steps out of the way once, so the box can show. Couch TV never presses anything in that box. The screen stays on while it waits, so the screensaver can't cover the box, and when Couch TV gives up waiting it closes its link cleanly.
- **Use as home screen on a TV with Google's Android TV Home.** On the TCL it closed Couch TV and showed Google's home with no question. Now that kind of TV changes nothing and says what to do instead, and every other TV still gets Android's own question, with a fallback if Android shows nothing.
- **The date sits over the clock again.** On the Night and Golden scenes with four quick buttons, the date slid left onto the people switch. It now stays centred over the clock and moves down with the clock if there is no room.
- **The TV's screensaver starts again** after the home's idle time when a scene clip is playing. With Smart Idle on, your chosen action runs instead of the TV's screensaver.
- **The bins widget says "Tomorrow" in full.** On the small square tile it was cut to "Tomorro" the day before bin night. Its own name, Bins, now shows in the TV's language too.
- **A design sent again from Studio wins.** Send the same design again with one choice changed (a 24 hour clock, say) and that change now shows, even if the TV had changed that setting before. Changes on the TV to other settings stay.
- **Ask AI** no longer tells you to use a particular kind of TV to speak a question: press OK, then the microphone on the TV's keyboard.
- **Option B:** a failed connect to the TV's debugging port is now closed properly instead of being left open on the TV, and the bridge waits up to 60 seconds for someone to press Allow.
- **Option B: keep the TV's own keyboard (#318).** A new setting for each TV in `config.json`, `"phone_keyboard": false`, keeps the TV's own on-screen keyboard for text boxes instead of "Use the keyboard on your mobile device". The cost: the TV then stops saying which app is in front over the bridge's link, so the current app can show as empty. Left out, nothing changes (docs/CONFIG.md).

### Installed from Downloader

This release comes from fixing what a person hits when they put Couch TV on a TV with Downloader and no computer: the two step setup, Use as home screen on a TV with Google's Android TV Home, the hidden Allow box and the update question over the welcome are all from that test.

To update a TV that came from Downloader: Home settings, Updates, **Update to**, or type **8180170** in Downloader again and press Install. Your settings stay.

Downloader always installs the plain version of the on-TV app, without the Home button watch. If your TV used the Home button version (you pressed **Make Home open Couch TV**), open Couch TV after the update, check Couch TV can still press keys (Settings, Phone remote, Set it up: that is the step that lets it press keys), then press **Make Home open Couch TV** again, so the Home button opens Couch TV again. Update to keeps the version your TV has, so this only follows a Downloader install.

### Next time: a new signing key for the on-TV app

0.13.10 itself is signed the same way as before, so every TV takes it the usual way. From 0.13.11 the on-TV app moves to its own release key on TVs with Android 9 and newer, and 0.13.10 is the version that knows how to accept it: please update to 0.13.10 first. A TV on Android 6, 7 or 8 keeps seeing the old key and updates the usual way. A TV on Android 9 or newer that skips 0.13.10 and goes straight to 0.13.11 or later will say the file has another key in Update to; install that one with Downloader (code 8180170) or over the old app from a computer instead, once, and your settings stay. Android checks the new key itself.
