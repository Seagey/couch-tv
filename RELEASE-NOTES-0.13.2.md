## couch-tv 0.13.2: Ask AI, your own AI agent, guests by name, smart home on every TV, and designs on Roku and Apple TV

If you have not turned on couch-tv Studio, your home looks exactly as it did: the classic home was checked pixel for pixel against the main branch.

### Do this after updating

- **Update the TV apps:** Home settings, Updates, check now, or install the APKs below over the old ones. They are signed with the same key as every earlier release, so they install over 0.13.1 and keep your settings.
- **Option B:** run `git pull`, then `.venv/bin/pip install -r bridge/requirements.txt` (AirTouch 5 needs one new part, `airtouch5py`), and restart the bridge.
- **Roku:** build and sideload the channel again (docs/ROKU.md). **Apple TV:** reinstall Couch TV from your Mac (docs/APPLE-TV.md).

### New: Ask AI and your own AI agent

- **Ask AI** is a widget and a sheet on the TV. Ask by typing or with the TV keyboard's microphone, and the answer shows on the TV. It uses the AI you pick: Claude, OpenAI, Gemini, OpenRouter, Groq, Mistral, any OpenAI compatible service, a model on a computer at home (Ollama, LM Studio), or couch-tv at home. Your key stays on the TV, goes only to the address it was saved with, and never goes into a design or to couch-tv Studio ([docs/ASK-AI.md](docs/ASK-AI.md)).
- **Your own AI agent** can put a message on the TV or send it a design, through the bridge or the on-TV app and its MCP tools. A design from an agent always asks "Use this design?" first. The From your AI widget shows the last message ([docs/AI-AGENT.md](docs/AI-AGENT.md)).

### New: guests by name

- **At home, Guests** reads your bookings calendar link (Airbnb, Booking.com, VRBO or any calendar), with your check in and check out times. A Welcome widget set to the calendar says "Welcome, Sarah" and when they check out. The design never carries a name, a link or a time.
- Airbnb's calendar only says "Reserved", so with a computer at home couch-tv can read the guest's first name from Airbnb's "reservation confirmed" emails (saved emails, or your mailbox read only with an app password). A name you type on the TV always wins.

### New: smart home on every TV

- **Set up Home Assistant on the TV itself:** Home settings, couch-tv Studio, Smart home. Type the address, paste a token, then tick what shows. On Samsung, LG and the other web TVs the same screen works through the computer at home. The token stays on the TV or that computer, never in a design.
- **Add a device we don't list** walks you through adding Tuya and Smart Life, Google Nest, Alexa devices, Apple Home, Matter and brand apps to Home Assistant.
- **Philips Hue and AirTouch 5 with no Home Assistant**, with a computer at home: pair the Hue bridge with its round button and tick up to 16 lights, and find the AirTouch 5 console on the Wi-Fi. Each AirTouch zone is a room you can switch on and off and set the temperature of; cooling or heating stays as set on the wall. A web page on a TV cannot open the AirTouch console's port, so both go through the computer at home, on every TV it serves, Google TV and Android TV included. AirTouch was read on a real console; the Hue side was checked against a pretend Hue bridge built from Hue's own API.

### New: couch-tv Studio designs on Roku and Apple TV

- **Roku:** the channel draws a design itself, from `design` in `config.json` or a code you type on the Roku (press \*). The background, the clock, date, weather, words, shapes, your apps, and these widgets in full: the clocks, date, month, countdown, weather, big temperature, moon, photo, art frame, Keep watching, people, card, quote, welcome, note and the app widgets. Every other widget shows as a tidy card with its name. Blur, the cut out in front of the clock and video backgrounds are left out on Roku. Checked in a BrightScript interpreter; it has not run on a real Roku yet, so tell us how it goes.
- **Apple TV:** Couch TV draws a design itself the same way (Settings, Home design, Get a design), with the clocks, date, month, countdown, weather, photos, Keep watching, apps, people, quick buttons, cards, quotes, welcome and smart stacks in full, and a titled card for the rest. Checked by compiling for the Mac and drawing test designs; build it for your Apple TV with Xcode as before.

### Also new

- **Batteries:** a widget with the battery of your paired Bluetooth remotes, controllers and headphones (Google TV and Android TV).
- Custom cards you type work on every TV; a timer started from a named Timer widget takes its name; more widgets take a label of their own.
- Plainer words for each TV: every path now just says what it needs, usually a computer at home that stays on.

### Files

`couch-tv-home.apk` (the TV home, options A and B), `couch-tv-ontv.apk` (option C) and `couch-tv-sync.apk` (two TVs in sync, unchanged since 0.13), with `SHA256SUMS.txt`.
