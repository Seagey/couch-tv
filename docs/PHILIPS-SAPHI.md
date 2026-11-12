# couch-tv on an older Philips TV (Saphi)

**New (Beta).** Read this first.

- **What you get:** the phone remote (power, keys, volume, inputs, the Claude ask on top of those), and, if
  your set offers it, couch-tv's page opening in the TV's own browser each time the TV is switched on.
- **What you do not get:** a real home screen. The page opens in Philips's browser, so the browser's own bar
  can show, the remote's Home button still opens Philips's menu, and a page that opens itself is the most
  couch-tv can do on these sets. No "what is playing", no screenshots, no typing from the phone, and apps open
  on their own page, not inside a show.
- **Beta:** it was built from public notes on Philips's network remote and checked against a pretend Philips
  on a computer (`tests/philips_standin.py`, Saphi mode). The first real set will probably show something to
  fix. The quickest test takes two minutes and needs nothing installed:
  [PHILIPS-SAPHI-TESTING.md](PHILIPS-SAPHI-TESTING.md).
- **It depends on the model and the firmware.** Some Saphi sets answer Philips's network remote (JointSpace)
  with no pairing at all, one owner's set wanted a PIN and then refused it, and others are reported to have no
  network remote at all. The test tells you which one you have.

Want everything today? Plug a Google TV box (for example the Google TV Streamer) into the TV's HDMI and set
couch-tv up on that.

## Which TVs

Philips smart TVs that are not Android TVs, roughly the 2015 to 2019 ranges, run Philips's own Linux system,
Saphi. Many cheaper Philips models of those years have it. It shows a row of app tiles with no Google Play
Store and no "Android TV OS" line under Settings, About.

This page also covers any Philips (Titan OS included) whose network remote lists a **browser** among its
activities: couch-tv uses that browser for its page, whatever the system.

Philips's Android and Google TV sets get the full couch-tv instead (README). Titan OS sets: see
[PHILIPS-TITAN.md](PHILIPS-TITAN.md).

**How to tell:** `scripts/check-tv.py <tv address>` says "Philips Saphi path" when the TV answers only the plain
port 1925 and is not Android, and says whether it lists a browser.

## What works, and what does not

Checked against the stand in only:

| | |
|---|---|
| Finding the TV | Plain http on port 1925 first; no login when the TV answers without one |
| Pairing | None when the TV answers without a login. When it asks for one, the paired path of [PHILIPS-TITAN.md](PHILIPS-TITAN.md) (a PIN on the TV, a key you save yourself), on https port 1926 if the TV answers there, else over 1925 |
| Power | Off to standby (the remote's own Standby key when the TV has no power path). On again: Wake on LAN to the TV's network (MAC) address, when the TV allows it |
| Keys | Arrows, OK, Back, Home, play and pause, numbers, colour keys, channel up and down, Source |
| Volume | Up, down and mute, and the level when the TV reports it |
| Inputs | The inputs the TV lists, by name or number |
| Apps | Only if the TV lists them (many Saphi sets do not) |
| couch-tv's page | Opens in the TV's browser at power on and from the phone's Home, only when the TV lists a browser |
| What is in front | Only if the TV says. Some sets give nothing or an error, and that is fine |

## The page in the TV's browser

When the TV's `system` answer lists a `browser` activity, the bridge asks the TV to open couch-tv's page
there (`POST activities/browser` with `{"url": ...}`), each time the TV comes on with nothing else in front,
and when Home is pressed on the phone. The page is the bridge's `/titan/` start page: it asks for the bridge's
pairing key once with the TV remote (if you set one), keeps it in the TV's browser, then opens the home. The
key is never in the address the bridge sends.

What to expect:

- The browser (Vewd, on most of these sets) shows couch-tv as a web page. Its address bar or a loading bar may
  show, and an old browser may draw parts of the home slower or plainer than a Google TV does.
- The TV's Home button opens Philips's menu, not couch-tv. Press Home on the phone remote to come back.
- An app, an input or the browser already in front when the TV comes on is left alone.
- If the TV lists no browser, nothing opens at power on, Home on the phone presses the TV's own Home, and the
  bridge logs "no couch-tv app and no browser on this TV (remote only)".

Nobody has reported this working on a real set yet. If it does nothing on yours, the phone remote still works.

## Setting it up

You need a computer at home that stays on, running the bridge (README, option B). Then:

1. **The TV's address.** Settings, Wireless and networks (or Network), View network settings. Give it a fixed
   address in the router if you can, and note the TV's network (MAC) address on the same screen.
2. **Wake on LAN.** Without it the TV cannot be switched on from the phone once it is fully off. Look for
   "Switch on with Wi-Fi (WoWLAN)" or similar under the network settings and switch it on. Not every set has
   it, and not every set honours it.
3. **Check it** (reads only, with the bridge stopped):

   ```sh
   .venv/bin/python scripts/philips-check.py <tv address>
   ```

   It knocks on 1925 and 1926, uses 1925 first, and says whether the TV wants a login and whether it lists a
   browser. "Login: none needed" means you are done with this step. If it wants a login, follow
   [PHILIPS-TITAN.md](PHILIPS-TITAN.md), steps 2 and 3, to pair.
4. **config.json**, in `tvs`:

   ```json
   {"id": "lounge", "name": "Lounge", "kind": "philips", "saphi": true, "ip": "<tv address>", "mac": "<tv mac>"}
   ```

5. Start the bridge. `GET /api/tvs` shows a `philips` block: the port, `no_login`, `browser`, `home`
   (`browser`, `app` or none), power and any problem in plain words.

| Key | Meaning |
|---|---|
| `kind` | `"philips"` |
| `saphi` [false] | Plain port 1925 first. With no `tls` or `port`, a TV that wants a login on 1925, or does not answer there, is tried on https 1926 with the paired login |
| `tls` [true] | `false`: plain 1925 only (also turns `saphi` on), with the login over it when the TV asks for one |
| `port` | A fixed port. Leave it out with `saphi` |
| `mac`, `wake_on_lan` [true] | Wake on LAN from fully off |
| `browser_home` [true] | `false`: never open couch-tv's page in the browser; the phone remote only |
| `home_url` [the bridge's `/titan/` page] | Another page to open instead, a plain `http://` or `https://` address |
| `open_on_power_on` [true] | Open the page when the TV comes on and nothing else is in front |
| `leave_inputs` [false] | An HDMI input in front counts as in use, and is left alone |
| `trace` [false] | Log every request and answer (PINs and keys hidden), for an issue |

**Security.** A set that answers without a login can already be driven by anything on your Wi-Fi; couch-tv
does not change that and cannot switch it off. The bridge itself still asks for its own pairing key if you set
one ([SETUP.md step 5](SETUP.md#step-5-run-the-bridge-option-b)). A guest Wi-Fi for visitors keeps them off the TV's port.

## PROTOCOL: what is known, and from where

Nothing on this page has been seen on a real Saphi set by couch-tv yet, so every line is **UNCONFIRMED** until
a tester's output settles it. The same guesses sit in `PROTOCOL` in `bridge/philips.py`, so one change fixes
them.

| What | Status | Source |
|---|---|---|
| Non Android Philips sets answer `http://<tv>:1925/<version>/...` with no pairing and no login | UNCONFIRMED | pylips documentation ([Home.md](https://github.com/eslavnov/pylips/blob/master/docs/Home.md)) |
| The version is `1`, `5` or `6` depending on the model | UNCONFIRMED | pylips documentation |
| One Saphi 43PUS7607/12 reported API 6.1.0, and PIN pairing was refused | UNCONFIRMED (one owner) | A Home Assistant community forum thread on Saphi |
| Some Saphi sets have no JointSpace at all | UNCONFIRMED (owners' reports) | The same thread |
| `GET audio/volume` answered without a login means no pairing is needed | UNCONFIRMED (our reading) | Android sets guard it with the login |
| `system` lists `browser` in an `activities` list when there is a browser | UNCONFIRMED (one v1 answer seen in public notes) | Public notes on JointSpace `system` answers |
| `POST activities/browser {"url": ...}` opens that page in the TV's browser | UNCONFIRMED (no user report of it working) | [ha-philipsjs](https://github.com/danielperna84/ha-philipsjs) (its open URL call) |
| A set with no `powerstate` path counts as on while it answers | UNCONFIRMED (our reading) | v1 has no power path in the notes we read |
| `activities/current` and `sources/current` can fail or answer oddly | Expected | Owners' reports; the driver treats them as unknown |
| Wake on LAN switches on a set in deep standby | UNCONFIRMED (no source says every set does) | Philips's network settings |

## What the first tester settles

[PHILIPS-SAPHI-TESTING.md](PHILIPS-SAPHI-TESTING.md) is the step by step guide. It settles whether the set
answers on 1925 without a login, on which version, whether it lists a browser, and, with one optional step,
whether the browser really opens couch-tv's page.

## How it was written

From protocol facts only: the port, the paths and the field names, as described in the public notes linked
above. No code, comments or layout were taken from any other project. Philips's pairing key is never in this
repository.
