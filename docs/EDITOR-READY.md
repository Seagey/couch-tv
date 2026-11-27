# Editor-ready designs

<!-- Written by tools/tv-designer/scripts/editor-ready-doc.mjs from couch-tv Studio's own files. Do not edit by hand: run it again. -->

couch-tv Studio's editor is for people. AI does not use it. If you are an AI helping someone design their TV
home, you design here, in this repository, with these rules and the code in `tv-home/web`. Anything you make
can go on the person's own TV straight away. To **sell** a design in the couch-tv Studio gallery, or to **keep it
in their account**, it must be *editor-ready*: it opens in the editor and a buyer can change every part of it.

## The short version

1. Start from a preset (couch-tv Studio's MCP: `list_presets`, `start_from_preset`), or from a design file.
2. Use only the widgets in the table below. A widget of your own is fine on the person's own TV
   ([OWN-WIDGETS.md](OWN-WIDGETS.md)), but it is checked by us and added to the editor before it can be sold or kept.
3. Keep personal details out (below). The person adds their own in their account; buyers see example ones.
4. Check it: `validate_design` until it says Valid, then `submit_design` (target `sale` or `profile`).
5. The person opens the link `submit_design` gives, signed in, and finishes there (their own TV, their photos, the price).

## The checks every design meets before it is sold or kept

The same checks run on the website and in the MCP (`tools/tv-designer/server/lib/submit-checks.mjs`, one file).

| Check | Passes when |
|---|---|
| Opens in our editor | Every widget is in the table below, and the design meets the format (`/help/design-format.schema.json` on the site) |
| Size | Under 4 MB and 20 photos all together |
| No personal details | No names, town, Wi-Fi, calendar links, keys or tokens anywhere, in the design or in a new widget's code |
| Speed on a low cost TV | Up to the 1 GB TV budget (45 in `CouchDesign.cost` units, the Slow class in the editor's speed bar). Over it, take off the heaviest parts |
| Sent to your own TV | One of the person's own TVs has shown it (they send it there first) |
| Photos are yours | The person ticks that they took them or may sell them |
| New widgets | Each one comes with its code, is checked by us and added to the editor (usually 2 to 3 days) |

## Format limits

- A design file is at most 256 KB; at most 40 widgets; words up to 2000 characters each.
- Nested at most 8 levels; at most 120 keys in one object and 200 items in one list.
- Up to 3 Google Fonts families by name; no font files or links. Fonts from the TV: inter, antonio, serif, mono, condensed.
- Up to 16 apps in one widget.
- Pictures: one of the TV's own (`backgrounds/<name>.jpg`). A person's own photo is added by them, never by an AI.
- No links, web addresses, emails, @, markup or emoji in words. A line with a digit or a phone number is hidden by the TV.

## Personal details stay in the account

Names, photos of people, the town, Wi-Fi, calendar links, Home Assistant and Ask AI keys live in the person's
couch-tv account. The editor shows them on its TV picture, but they are never stored in a design. A design that
carries any of them (keys like `people`, `town`, `wifi_password`, `ical`, `token`, or text like a calendar subscription link,
`WIFI:`, a JWT, an `sk-` or `AIza` key) is refused on save, send, sale and share.

## The widgets the editor has (68)

Sizes are columns x rows of half cells on the 18 x 10 grid (each big tile is 2 x 2 half cells).

| kind | Name | What it shows | Sizes |
|---|---|---|---|
| `clock` | Digital clock | Big numerals, with the date under if you like | tile 2x2, wtile 4x2, small 4x4, medium 8x4, wide 12x4, xl 12x6, hero 18x7, full 18x10 |
| `tallclock` | Tall clock | Tall thin digits that fill the space, the Couch TV clock | tile, wtile 4x2, small 4x4, medium 8x4, wide, xl, hero, full |
| `glassclock` | Glass clock | The digits filled from the scene photo, Couch TV's signature | wtile 4x2, small 4x4, medium 8x4, wide, xl, hero |
| `analog` | Analogue clock | A face with hands and a coloured second hand | tile, small 4x4, large |
| `flipclock` | Flip clock | Split flap digits | wtile 4x2, medium 8x4, wide |
| `wordclock` | Time in words | "Twenty to eight, Wednesday morning" | wtile 4x2, small 4x4, medium 8x4, large |
| `solar` | Sun clock | The sun's arc today with sunrise and sunset | wtile 4x2, small 4x4, medium 8x4 |
| `worldclock` | World clocks | Two to four cities, faces or a list | tile, wtile 4x2, small 4x4, medium 8x4, wide |
| `countdown` | Countdown | "37 sleeps to Christmas" | tile, wtile 4x2, small 4x4 |
| `date` | Date | Today's date, long or short, with the weather if you like | line, wline, tile, small 4x4 |
| `month` | Month | This month's calendar, today marked | tile, small 4x4, large |
| `timer` | Timer | A ring counting down | tile, wtile 4x2, small 4x4 |
| `weather` | Weather | The place, the temperature, the sky, high and low | tile, wtile, small, medium |
| `bigtemp` | Big number | One huge temperature on the colour of the day | tile 2x2, small 4x4, medium 8x4, large |
| `hourly` | Hourly | The next hours: time, sky and temperature | wtile 4x2, small 4x4, medium 8x4, wide |
| `week` | This week | The next 7 days, with the range of each | wtile 4x2, small 4x4, tall, medium 8x4, large |
| `rain` | Rain soon | Rain in the next two hours, as bars | wtile 4x2, small 4x4, medium 8x4 |
| `uv` | UV index | Today's UV, its band and the sun protection window | tile, wtile 4x2, small 4x4 |
| `sun` | Sunrise and sunset | Two times and the sun's arc | tile, wtile 4x2, small 4x4 |
| `moon` | Moon | Tonight's moon, its name and the next full moon | tile, wtile 4x2, small 4x4 |
| `air` | Air quality | The air quality number and band | tile, wtile 4x2, small 4x4 |
| `surf` | Surf | Swell, period, wind and the tide | wtile 4x2, small 4x4, medium 8x4 |
| `photo` | Photo | One of the TV's photos, with a caption | tile, wtile 4x2, small 4x4, tall, medium 8x4, wide, large, xl, hero, full |
| `slideshow` | Slideshow | Flicks through your photos, dots show where it is up to | tile, wtile 4x2, small 4x4, tall, medium 8x4, wide, large, xl, hero, full |
| `mosaic` | Photo mosaic | Three to five photos in a collage | small 4x4, medium 8x4, large, xl |
| `artframe` | Art frame | A painting in a mat with a museum label | small 4x4, tall, large, xl, hero, full |
| `memory` | On this day | A photo from this date in past years | tile, wtile 4x2, small 4x4, medium 8x4 |
| `keep` | Keep watching | One show at a time, the next slides in | tile, wtile 4x2, small 4x4, medium 8x4 |
| `keeprow` | Keep watching row | Two to five shows with how far you got | medium 8x4, wide, hero |
| `upnext` | Up next | One show filling the space: Resume or Start over | medium 8x4, wide, xl, hero, full |
| `picks` | Picks for you | "Because you watched" posters | small 4x4, medium 8x4, wide |
| `app` | One app | A single app as a big icon | tile 2x2, small 4x4 |
| `folder` | App folder | A box of apps with a name: Streaming, Free to air | tile, small 4x4, tall, medium 8x4, large |
| `dock` | Dock | A row of your apps in a bar | any |
| `appgrid` | App grid | Two to four rows of apps with their names | small 4x4, medium 8x4, large, xl |
| `games` | Games | Game apps as tall tiles | small 4x4, medium 8x4, wide |
| `nowplaying` | Now playing | Cover, song, artist, play and pause | tile, wtile 4x2, small 4x4, medium 8x4, large |
| `soundscape` | Soundscape | Rain, fire, waves or brown noise | tile, wtile 4x2 |
| `queue` | Up next queue | The next songs | small 4x4, tall, large |
| `speakers` | Speakers | Each room's speaker and its volume | wtile 4x2, small 4x4, tall |
| `aircon` | Aircon | A dial with the setpoint and the other rooms | tile, wtile 4x2, small 4x4, tall, medium 8x4, large |
| `scenes` | Scenes | Movie night, Goodnight, Morning as big buttons | tile, wtile 4x2, small 4x4, medium 8x4 |
| `controls` | Control Centre | Lights, lamps, blinds and locks as toggles | tile, wtile 4x2, small 4x4, medium 8x4, wide, large |
| `camera` | Camera | A still from a camera, refreshed while on screen | wtile 4x2, small 4x4, medium 8x4, large |
| `doorbell` | Doorbell | The last ring with a still | tile, wtile 4x2, small 4x4, medium 8x4 |
| `energy` | Solar and energy | Made today, money back, the day's curve | tile, wtile 4x2, small 4x4, medium 8x4, wide |
| `sensor` | Sensor | One reading: pool, rain gauge, humidity | tile, wtile 4x2, small 4x4 |
| `battery` | Batteries | Remotes and controllers paired with the TV, and their charge | tile, wtile 4x2, small 4x4, medium 8x4 |
| `bins` | Bin night | Tonight's bins with their lid colours | tile, wtile 4x2, small 4x4 |
| `people` | People | Who is watching, switch with OK | line 4x1, wline 8x1, wtile |
| `agenda` | Agenda | Today's events with colours and times | tile, wtile 4x2, small 4x4, tall, medium 8x4, large |
| `note` | Family note | A sticky note typed at home | tile, wtile 4x2, small 4x4 |
| `list` | List | Reminders or shopping, ticked from the phone | wtile 4x2, small 4x4, tall, large |
| `card` | Custom card | Any household number: solar today, the pool | wtile 4x2, small 4x4 |
| `quote` | Quote | A short line for the day | wtile 4x2, small 4x4, medium 8x4, wide |
| `word` | Word of the day | A word and what it means | wtile 4x2, small 4x4, medium 8x4 |
| `news` | Headlines | One to four headlines from a news feed | wtile 4x2, small 4x4, tall, medium 8x4 |
| `sports` | Scores | Scores for your teams | wtile 4x2, small 4x4, tall, medium 8x4 |
| `stocks` | Markets | The ASX, a few shares and the dollar | tile, wtile 4x2, small 4x4, tall |
| `commute` | Commute | Drive time and when to leave | tile, wtile 4x2, small 4x4, medium 8x4 |
| `welcome` | Welcome words | A greeting in your own words | wline, wtile 4x2, medium 8x4, wide |
| `quick` | Quick buttons | Sleep timer, picture, input | line 4x1, wline 8x1, tile, wtile |
| `wifi` | Guest Wi-Fi | The network and a code to join | small 4x4, medium 8x4, wide |
| `guide` | House guide | House guide, check out, around here | wtile 4x2, small 4x4, tall |
| `screentime` | Screen time | Minutes left today and bedtime | tile, wtile 4x2, small 4x4, medium 8x4 |
| `ask` | Ask AI | Ask by voice or typing, answered on the TV by your own AI | wtile 4x2, small 4x4, medium 8x4, wide, large |
| `agent` | From your AI | Messages from your own AI agent, shown on the TV | wtile 4x2, small 4x4, medium 8x4, wide |
| `stack` | Smart stack | Two to five widgets taking turns in one place | any |

## A widget the editor does not have

Make it for the person's own TV first ([OWN-WIDGETS.md](OWN-WIDGETS.md)). To sell or keep a design with it, send its
code with the design: `submit_design` with `widgets: [{ kind, name, code }]` (up to 3 widgets, 64 KB of code each).
Until we have added it to the editor, the speed check counts it as 3 (one frosted panel), and the design stays on the
person's own TV only.
