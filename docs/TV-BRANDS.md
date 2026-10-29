# Brands that sell more than one kind of TV

Many brands sell some TVs on Google TV or Android TV (these work) and others on a system that does
not (Fire TV, Roku, VIDAA, Titan OS and more). **The brand does not tell you. The model does.**

Research from public sources, October 2026. **None of these brands has been tested with couch-tv**
unless it says so in [TV-COMPATIBILITY.md](TV-COMPATIBILITY.md). Some rows rest on thin or older
sources (marked "not confirmed"). Always check your own TV with `scripts/check-tv.py` or the
settings menu.

**The quickest check:** on the TV open **Settings, System, About** (older TVs: **Settings, Device
Preferences, About**). "Android TV OS" means it works. A Google Assistant button on the remote is a
good sign. A Fire TV, Alexa-only or Roku button means it does not.

| Brand | Works (Google TV or Android TV models) | Does not work | How to tell |
|---|---|---|---|
| Hisense | Some Google TV models (US "G" suffix, some 2026 ranges) | VIDAA (most ranges, including many in Australia; being renamed V Home OS), Fire TV (US "F" suffix) | The retailer's "operating system" line. Australian model codes give no hint |
| Toshiba | Older Android TV models | Fire TV (US and Canada), VIDAA | "Fire TV" on the box or an Alexa remote means no |
| Sharp | Some Google TV models (US) | Roku TV (US), Titan OS (Europe, from mid 2026) | Region and series. Australian range not confirmed |
| TCL (and Ffalcon) | Google TV (most recent ranges), some Android TV | Roku TV (US), Fire TV (some models) | The listing's OS field, not the series name |
| Philips | 2020 to 2025 Google TV and Android TV models | Titan OS on all 2026 models, some older budget models on Titan OS or Roku | A 2026 Philips will not work |
| Panasonic | Google TV (some European models) | Fire TV (some UK models), Roku and TiVo (US), My Home Screen (older) | Model codes differ by region: check the OS field |
| Sony | Google TV or Android TV on most Bravias since 2015 | Sony's own Linux system on some cheaper Full HD Bravias, for example the 2018 W66F series (KDL-43W660F, KLV-50W662F) | "Android TV" or "Google TV" on the box or in Settings, About. A Linux Bravia cannot run couch-tv: use a Google TV box on HDMI |
| Xiaomi | Google TV (most models) | Fire TV (some 2026 models in Europe, "FireTV" in the name) | "FireTV" in the name or a Fire TV button |
| Kogan | Google TV (OLED and QLED ranges), older Android TV | Roku TV (some older models), basic "Smart TV" on cheaper models | The spec sheet. No webOS models found |
| Onn | Google TV (newer models) | Roku TV (older), Vizio OS (some 2025 models) | A Google button on the remote |
| Element | Some Google TV models | Fire TV and Roku models | Retailer spec only |
| Thomson | Google TV (recent models) | Older own "Smart TV" | Thomson Europe went bankrupt in 2026, so updates are uncertain |
| Hitachi, JVC, Insignia, Westinghouse, Haier | Not confirmed | Mostly Roku TV or Fire TV | Check the spec sheet |
| Metz, Grundig | Some Android or Google TV (not confirmed) | Fire TV, VIDAA, Saphi and others | No brand-wide rule: check the model |
| Nokia, Motorola (licensed brands) | Android TV in some countries | Not confirmed | Made by different companies in each country |
| Vizio | No | SmartCast, now Vizio OS | Never Google TV |
| Samsung | No | Tizen only | couch-tv as an app: [SAMSUNG.md](SAMSUNG.md) |
| LG | No | webOS only | As an app: possible, untested, [LG.md](LG.md) |

Have a TV that says no? A Google TV box (for example the Google TV Streamer) plugged into any HDMI
port gets you everything.

## Sources

- Hisense: [TechRadar 2026 range](https://www.techradar.com/televisions/hisenses-2026-mid-range-mini-led-tv-comes-in-sizes-up-to-116-inches-because-why-not-and-you-can-choose-to-have-google-tv-or-not), [Tom's Guide buying guide](https://www.tomsguide.com/tvs/buying-a-hisense-tv-in-2026-heres-my-expert-guide-to-their-new-rgb-mini-leds-qleds-and-more), [Appliances Online A4S listing](https://www.appliancesonline.com.au/product/hisense-40-inch-a4s-fhd-smart-tv-40a4sau-2026/)
- Toshiba: [Wikipedia, Fire TV](https://en.wikipedia.org/wiki/Fire_TV), [ChannelNews (older)](https://www.channelnews.com.au/toshiba-takes-on-hisense-with-new-55-4k-android-tv/)
- Sharp: [Tom's Guide](https://tomsguide.com/news/sharp-just-unveiled-the-first-roku-oled-tv-ever-and-its-available-now), [Titan OS](https://www.titanos.tv/blog/titan-os-announces-new-manufacturer-partnership-with-sharp)
- TCL: [What Hi-Fi](https://www.whathifi.com/news/tcl-launches-its-first-tvs-with-google-tv)
- Philips: [ChannelNews](https://www.channelnews.com.au/philips-drops-google-tv-for-titan-os-across-2026-range-in-major-platform-shift/), [9to5Google](https://9to5google.com/2026/03/23/google-tv-just-lost-a-big-tv-brand-to-web-app-based-titan-os/)
- Panasonic: [TechRadar 2026 line-up](https://www.techradar.com/televisions/panasonics-2026-tv-line-up-is-here-and-i-saw-it-in-action-but-it-was-one-of-its-demos-of-future-tech-that-impressed-me-most)
- Sony: [Home Clearance Bravia listing](https://www.homeclearance.com.au/p/sony-65-inch-bravia-3-ii-4k-hdr-ai-google-tv-with-gemini-and-antiglare-screen-2026-k65xr30m2)
- Xiaomi: [Notebookcheck](https://www.notebookcheck.com/Xiaomi-Bis-zu-75-Zoll-grosser-4K-QLED-TV-mit-Fire-TV-startet-dank-Rabatt-bereits-ab-299-Euro.1014393.0.html)
- Kogan: [EFTM review](https://eftm.com/2025/04/kogan-sells-oled-tvs-how-good-could-it-be-kogan-oled-4k-120hz-smart-ai-google-tv-x98j-review-261487)
- Onn and Vizio: [The Desk](https://thedesk.net/2025/11/walmart-begins-selling-onn-tv-powered-by-vizio-operating-system/)
- Thomson: [9to5Google](https://9to5google.com/2026/04/24/google-tv-thomson-partner-bankruptcy/)
- Nokia: [Nokia licensed TVs](https://nokia.com/support/licensed-products/tvs)
- Roku brands: [Wikipedia, Roku](https://en.wikipedia.org/wiki/Roku)
