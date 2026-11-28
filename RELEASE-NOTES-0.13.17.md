## Couch TV 0.13.17: your account's home on the TV, a smart home step, a pool widget, Fast TV looks and every widget at any size

Send a design to a TV you trust and it arrives with your people, places, photos and keys already in place. Couch TV Setup has a Smart home step, Matter and Home Assistant work from a computer or on their own, there is a pool widget, two Fast TV looks for slower TVs, new looks to pick from, and every widget can be any size.

### Do this after updating

- **Option C (the on-TV app):** Home settings, Updates, Update to. Your settings stay. 0.13.17 carries the same key as 0.13.16, so a TV on 0.13.16, 0.13.15 or 0.13.14 updates as normal.
- **Every other Android TV:** Home settings, Updates, check now, or install `couch-tv-home.apk` over the old one.
- **Option B (a computer at home):** `git pull`, then restart the bridge. Nothing new to install.
- **Couch TV Setup and the Helper:** a Helper updates itself when you press Update ready, restart. Otherwise download Couch TV Setup again from the Releases page.

### Couch TV Setup

- **A Smart home step.** Connect Home Assistant, Hue, AirTouch or Matter once, then pick which air con, lights and speakers each room's TV can see and control. A TV only ever sees its own room.
- **Matter gets itself ready.** The first time you add a Matter device, Setup fetches what it needs and sets it up in the Helper's own folder. It takes about two minutes, once. If you type a Matter code on the TV's phone page before that, the code is kept and added when Matter is ready.
- **Your Home Assistant is not overwritten.** If a TV already had Couch TV on it, Setup leaves a Home Assistant set up you made on the TV exactly as it is, unless you choose to replace it.
- **Ask AI, Spotify and music from Setup.** Set up your Ask AI key, and let the TV see what is playing in any music app, from your computer.
- **Widget permissions.** Turn on the doorbell card, screen time and battery readings from Setup.
- **Easier to find a TV.** Find a TV by its name, and plain words when a TV is asleep in standby.

### On your account and the TV

- **Send arrives with your details.** A design sent to a trusted TV lands complete with your people, places, photos, calendar links and keys. A TV that is not trusted gets none of the private parts, and a code or a QR carries only the basics. The locked house guide (a door code or alarm word) goes only to a trusted TV, like a key.
- **A room for each TV.** Each TV shows and controls only its own room's air con, lights and speakers. Locks, alarms, garage doors and gates never show on a TV.
- **Pool widget.** Water temperature, pump, chlorinator, heater and lights from Home Assistant or Connect 10 on web TVs and the on-TV app.
- **AirPlay speaker groups.** Pick speakers from Setup and play to several at once.
- **Keep watching, Up next and Now playing** work on an Android TV with no computer at home. The Spotify queue widget is gone: an old one shows Now playing.
- **Every widget at any size.** Make a widget as big or as small as the design needs.
- **New looks.** Card styles, textures, app icon styles, a TV settings widget, and a night and day that follows sunrise and sunset.
- **Fast TV, Paper and Ink.** Two plain colour looks for slower TVs: a big clock, the day and the weather, your apps, and Keep watching on Ink. No pictures, no glass, no shadows.
- **Faster Couch Original.** The glass and glint on the Night look are drawn once and moved, so it keeps up better on slower TVs. Keep watching cards use sharp app logos.
- **TV settings in your language.** The Settings screen words are in every language the TV speaks.

### Not in this release

- Nothing about a TV is sent anywhere unless you press Yes to link it.
- Locks, alarms, garage doors and gates are never listed or controlled.
