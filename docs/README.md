# couch-tv documentation

Every couch-tv guide in one place, grouped by what you want to do.

## Start here

| Guide | What it is for |
|---|---|
| [SETUP.md](SETUP.md) | Every setup step, from developer mode to the TV home, and how to undo it |
| [Setup site](https://couchtv.sites.underseage.studio) | Set it up the easy way, from your phone, with the free Setup app or with your AI agent. It also checks whether your TV will work |
| [README](../README.md) | The front page: what couch-tv is and the three options |
| [AGENTS.md](../AGENTS.md) | Instructions for the AI agent setting couch-tv up for someone who is not technical |
| [PLATFORMS.md](PLATFORMS.md) | What works on each kind of TV, in full |
| [TV-COMPATIBILITY.md](TV-COMPATIBILITY.md) | Which TVs work, per platform and per option (A, B and C) |
| [TV-BRANDS.md](TV-BRANDS.md) | Brands that sell more than one kind of TV, and how to tell which one you have |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Fixes for problems seen on real TVs, starting with a TV that loops after a restart |
| [UNINSTALL.md](UNINSTALL.md) | Take couch-tv off your TV and switch everything back on |

## Using couch-tv

| Guide | What it is for |
|---|---|
| [TV-HOME.md](TV-HOME.md) | Every feature of the TV home and the Home settings |
| [MAKE-A-SCENE.md](MAKE-A-SCENE.md) | Make your own home scene, with its own glass clock, from any picture |
| [REMOTE.md](REMOTE.md) | The phone remote: how it is hosted and how to install it |
| [REMOTES.md](REMOTES.md) | TV remotes, game controllers and keyboards: which keys do what |
| [ASK-PROVIDERS.md](ASK-PROVIDERS.md) | Which AI services on-TV mode can use to answer "put on Bluey", and how to set one up |
| [IMPORT.md](../bridge/IMPORT.md) | Bring in your past Netflix and YouTube history so the picks start smart (option B) |
| [SYNC.md](SYNC.md) | Two TVs, one show: play the same show on two TVs in step (experimental) |
| [UPDATES.md](UPDATES.md) | The full update history, release by release |

## Configuration and running

| Guide | What it is for |
|---|---|
| [CONFIG.md](CONFIG.md) | `config.json`, every setting |
| [DOCKER.md](DOCKER.md) | Run the bridge in Docker on a NAS or any other always-on machine |
| [on-tv/README.md](../on-tv/README.md) | On-TV mode (option C): the bridge inside an app on the TV, the remote with no computer |
| [NO-BRIDGE.md](../NO-BRIDGE.md) | No always-on computer? The two options that need none |

## Per TV

| TV | Guide | First test |
|---|---|---|
| Samsung (Tizen) | [SAMSUNG.md](SAMSUNG.md) | |
| LG (webOS) | [LG.md](LG.md) | |
| Roku | [ROKU.md](ROKU.md) | |
| Fire TV Stick (Fire OS) | [FIRE-TV-STICK.md](FIRE-TV-STICK.md) | |
| Fire TV on Vega OS | [FIRE-VEGA.md](FIRE-VEGA.md) | [FIRE-VEGA-TESTING.md](FIRE-VEGA-TESTING.md) |
| Hisense VIDAA | [VIDAA.md](VIDAA.md) | [VIDAA-TESTING.md](VIDAA-TESTING.md) |
| Philips with Titan OS | [PHILIPS-TITAN.md](PHILIPS-TITAN.md) | [PHILIPS-TITAN-TESTING.md](PHILIPS-TITAN-TESTING.md) |
| Older Philips (Saphi) | [PHILIPS-SAPHI.md](PHILIPS-SAPHI.md) | [PHILIPS-SAPHI-TESTING.md](PHILIPS-SAPHI-TESTING.md) |
| Panasonic Viera | [PANASONIC.md](PANASONIC.md) | [PANASONIC-TESTING.md](PANASONIC-TESTING.md) |
| VIZIO (SmartCast and VIZIO OS) | [VIZIO.md](VIZIO.md) | [VIZIO-TESTING.md](VIZIO-TESTING.md) |
| Apple TV | [APPLE-TV.md](APPLE-TV.md) | [APPLE-TV-TESTING.md](APPLE-TV-TESTING.md) |
| TiVo OS (JVC, Telefunken and other Vestel built sets) | [TIVO.md](TIVO.md) | `scripts/tivo-check.py` (read only, in TIVO.md) |

## For developers

| Guide | What it is for |
|---|---|
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | How the parts fit together, privacy and safety, and the limits |
| [bridge/API.md](../bridge/API.md) | The TV bridge API: the contract for the phone remote and the TV home |
| [bridge/DEEPLINKS.md](../bridge/DEEPLINKS.md) | How the bridge opens a show on a Google TV, and what was tested on one TV |
| [on-tv/REAL-TV-TEST.md](../on-tv/REAL-TV-TEST.md) | The first test of on-TV mode on a real TV, for whoever runs it |
| [sync/README.md](../sync/README.md) | The tester's notes for two TVs, one show: how it works inside and every measurement |
| [tests/fake-player/README.md](../tests/fake-player/README.md) | A tiny Android app for the Keep watching simulation (tests only, never shipped) |
| [tv-home/web/backgrounds/CREDITS.md](../tv-home/web/backgrounds/CREDITS.md) | The background photos: place, photographer, licence and source |
