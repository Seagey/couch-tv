## couch-tv 0.13.10: a simpler start on a new TV, and fixes from a fresh TCL

DRAFT: not released yet.

We set up a TCL from scratch with 0.13.9, the way a new person would, and fixed what got in the way. The on-TV app now sets up in two steps with the TV remote, and everything else sits in one Settings screen. A TV that was never set up opens on a welcome that asks one question: do you have a design code, or do you want Couch Original. Clocks can show another time zone, a design sent again from Studio wins over an old change on the TV, and the date sits back over the clock.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to (one button, if Couch TV can press keys on your TV), or follow the steps there. Your settings stay.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Samsung, LG and the other TVs a computer at home runs:** nothing to do on the TV. The computer at home hands out the new home after `git pull` and a restart.

### The on-TV app: setup in two steps

- **Step 1 of 2, Make Couch TV your home.** One big button where Android can ask. On a TV that keeps Google's own home on the Home button, one plain line says what to do instead, with Next and More help behind it.
- **Step 2 of 2, Open your new home.** It opens the home, where the new welcome takes over.
- **Later opens** say Couch TV is ready, with Open the home and Settings.
- **The couch-tv Studio look:** the same light blue wall, white cards and rounded fonts as the Studio website.

### The on-TV app: Settings

One list on the left, the chosen item on the right:

- **Edit your home:** a QR code to the TV's phone page, where widgets, the town, calendars and photos are set.
- **Phone remote:** pictures of the real phone remote, the pairing QR code and code, New code and Forget phones. On a TV where the phone cannot press keys yet, a yellow strip with Set it up walks through the TV's own menus, in the words that TV uses (Android TV, Google TV or Fire TV), and skips the switches that are already on.
- **Undo Couch TV:** asks first, then gives the Home button back to the TV's own home, switches the Home button watch off, and offers Android's own Uninstall question.
- **Help:** a QR code to the help site.

The More button is gone. Everything it had is in Settings. Words everywhere that pointed at it now say Settings, Phone remote, Set it up.

### The first-run welcome

A TV nobody has set up yet (the on-TV app, or the home app with no computer) now opens on one full screen question instead of the classic home:

- **I have a design code** goes straight to the box where you type the code from couch-tv Studio.
- **Use Couch Original** gives you the standard home. Back does the same.

It is asked once. A TV that was already set up before this update never sees it. It is in all 16 languages the home speaks, and it looks like the Studio website.

### Clocks in another time zone

The digital, tall, glass, flip, analogue and word clocks in a Studio design can show another time zone, for family overseas. Leave it out and the clock shows the TV's own time, as before.

### Fixes

- **The update question no longer pops up over a new TV.** "Tell you when a new Couch TV version is out?" came up over the home about 5 seconds after the first open on the TCL. It now waits until the welcome is answered, and asks at a calm moment later: the next time you come back to the home.
- **A hidden "Allow USB debugging?" box.** On the TCL an old Allow box was left open behind Couch TV after an earlier try ran out, and the TV would not show a new one, so Connect seemed to do nothing. Now, if no Allow box comes up over Couch TV within a few seconds, the screen says "The TV's Allow box may be hidden. Press Back once to see it, or switch USB debugging off and on." and Couch TV steps out of the way once, so the box can show. Couch TV never presses anything in that box. The screen stays on while it waits, so the screensaver can't cover the box, and when Couch TV gives up waiting it closes its link cleanly.
- **Use as home screen on a TV with Google's Android TV Home.** On the TCL it closed Couch TV and showed Google's home with no question. Now that kind of TV changes nothing and says what to do instead, and every other TV still gets Android's own question, with a fallback if Android shows nothing.
- **The date sits over the clock again.** On the Night and Golden scenes with four quick buttons, the date slid left onto the people switch. It now stays centred over the clock and moves down with the clock if there is no room.
- **The TV's screensaver starts again** after the home's idle time when a scene clip is playing. With Smart Idle on, your chosen action runs instead of the TV's screensaver.
- **The bins widget says "Tomorrow" in full.** On the small square tile it was cut to "Tomorro" the day before bin night. Its own name, Bins, now shows in the TV's language too.
- **A design sent again from Studio wins.** Send the same design again with one choice changed (a 24 hour clock, say) and that change now shows, even if the TV had changed that setting before. Changes on the TV to other settings stay.
- **Option B:** a failed connect to the TV's debugging port is now closed properly instead of being left open on the TV, and the bridge waits up to 60 seconds for someone to press Allow.
