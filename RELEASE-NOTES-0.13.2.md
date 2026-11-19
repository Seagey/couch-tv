## couch-tv 0.13.2: Ask AI, your own AI agent, guests by name, smart home on every TV, and designs on Roku

On Google TV, Android TV, Fire TV and the web TVs, if you have not turned on couch-tv Studio, your home looks exactly as it did: the classic home was checked pixel for pixel against the main branch. On Roku the home gains a Settings tile at the end of the apps and a menu on the remote's \* key (below).

### Do this after updating

- **Update the TV apps:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release, so they install over 0.13.1 and keep your settings.
- **Option B:** run `git pull`, then `.venv/bin/pip install -r bridge/requirements.txt` (AirTouch 5 needs one new part, `airtouch5py`), and restart the bridge.
- **Roku:** build and sideload the channel again (docs/ROKU.md).

### New: Ask AI and your own AI agent

- **Ask AI** is a widget and a sheet on the TV. Ask by typing or with the TV keyboard's microphone, and the answer shows on the TV. It uses the AI you pick: Claude, OpenAI, Gemini, OpenRouter, Groq, Mistral, any OpenAI compatible service, a model on a computer at home (Ollama, LM Studio), or couch-tv at home. Your key stays on the TV, goes only to the address it was saved with, and never goes into a design or to couch-tv Studio ([docs/ASK-AI.md](docs/ASK-AI.md)).
- **Your own AI agent** can put a message on the TV or send it a design, through the bridge or the on-TV app and its MCP tools. A design from an agent is used only on a TV where couch-tv Studio is turned on, and always asks "Use this design?" first; an agent never turns couch-tv Studio on. The TV listens for messages only once you opt in (an Ask AI or From your AI widget on the home, or Ask AI set up on the TV), and the From your AI widget shows the last message ([docs/AI-AGENT.md](docs/AI-AGENT.md)).

### New: guests by name

- **At home, Guests** reads your bookings calendar link (Airbnb, Booking.com, VRBO or any calendar), with your check in and check out times. A Welcome widget set to the calendar says "Welcome, Sarah" and when they check out. The design never carries a name, a link or a time.
- Airbnb's calendar only says "Reserved", so with a computer at home couch-tv can read the guest's first name from Airbnb's emails (saved .eml files, or your mailbox read only with an app password, over a checked secure connection). It reads emails from Airbnb, or forwarded from it, whose subject says "Reservation confirmed" or "New booking" with "<name> arrives <month> <day>", in plain text or HTML, with the reservation code and the number of guests from the email itself; a "cancelled" email with the same code takes the booking away. The reader comes from guest-tv, our sibling project for guest TVs, and was checked against made up emails in that format. A name you type on the TV always wins.

### New: smart home on every TV

- **Set up Home Assistant on the TV itself:** Home settings, couch-tv Studio, Smart home. Type the address, paste a token, then tick what shows. On Samsung, LG and the other web TVs the same screen works through the computer at home. The token stays on the TV or that computer, never in a design.
- **Add a device we don't list** walks you through adding Tuya and Smart Life, Google Nest, Alexa devices, Apple Home, Matter and brand apps to Home Assistant.
- **Philips Hue and AirTouch 5 with no Home Assistant**, with a computer at home: pair the Hue bridge with its round button and tick up to 16 lights, and find the AirTouch 5 console on the Wi-Fi. Each AirTouch zone is a room you can switch on and off and set the temperature of; cooling or heating stays as set on the wall. A web page on a TV cannot open the AirTouch console's port, so both go through the computer at home, on every TV it serves, Google TV and Android TV included. AirTouch was read on a real console; the Hue side was checked against a pretend Hue bridge built from Hue's own API.

### New: couch-tv Studio designs on Roku, and a design renderer in the Apple TV source

- **Roku:** the channel draws a design itself, from `design` in `config.json` or a code you type on the Roku. What changes on every Roku home: a **Settings** tile after the apps, and the remote's **\*** key, which both open a menu with **Get a design by code**, **Go back to the plain home** and **Show the design**. A code asks **Use this design?** before anything changes. The background, the clock, date, weather, words, shapes, your apps, and these widgets in full: the clocks, date, month, countdown, weather, big temperature, moon, photo, art frame, Keep watching, people, card, quote, welcome, note and the app widgets. Every other widget shows as a tidy card with its name. Blur, the cut out in front of the clock and video backgrounds are left out on Roku. The channel's code was run in a BrightScript interpreter with test designs.
- **Apple TV source:** the Couch TV source gains a design renderer (Settings, Home design, Get a design) for the clocks, date, month, countdown, weather, photos, Keep watching, apps, people, quick buttons, cards, quotes, welcome and smart stacks, with a titled card for the rest. It was compiled and drawn on a Mac; it has not been built for tvOS. To try it, build Couch TV with Xcode (docs/APPLE-TV.md). No Apple TV app is part of this release.

### Also new

- **Batteries:** a widget with the battery of your paired Bluetooth remotes, controllers and headphones (Google TV and Android TV).
- Custom cards you type work on every TV; a timer started from a named Timer widget takes its name; more widgets take a label of their own.
- **Kept secrets stay with your TVs:** the computer at home answers smart home, Hue and guest name requests only from the TVs in config.json, from itself, or from a device with the pairing key; a token kept for Home Assistant is only ever sent to the address it was saved with.
- Plainer words for each TV: every path now just says what it needs, usually a computer at home that stays on.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C) and `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), with `SHA256SUMS.txt`.
