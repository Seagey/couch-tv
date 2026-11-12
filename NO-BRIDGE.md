# No always-on computer?

Two of the three options need no computer left on:

- **A. TV home only.** The home app carries its own copy of the home screen (scenes, clock,
  weather, your app row, people and quick buttons from your `config.json`). A computer is only
  needed once, to install it, and again after a Google TV update brings the Google home back
  (run `tv-home/tools/apply.sh` again). [docs/SETUP.md](docs/SETUP.md) steps 1, 2 and 6.
- **C. Lives on the TV.** The bridge runs inside an app on the TV, so the phone remote works with
  no computer. See [on-tv/README.md](on-tv/README.md).

Option B (the computer bridge) is the only one that needs a computer (or a Raspberry Pi) that
stays on. With B the TV home still works when that computer is off: it falls back to its saved
copy and only loses "keep watching" and the picks.
