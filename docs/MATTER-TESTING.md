# Testing Matter

How to prove a Matter controller in Couch TV works: the on-TV app (`Server.kt`, port 5400), the
bridge (`bridge/`, port 8765) or anything else that serves the Matter API. One test,
`tests/matter_contract.py`, runs against all of them, using real Matter devices that run as
programs on a Mac.

## What is in the kit

| Part | Where | What it does |
|---|---|---|
| Virtual devices | `tests/matter/fixtures/fx.py` (runs on the Mac) | Eight real Matter devices from connectedhomeip v1.6.1.0, each its own program on the home network |
| "Home" controller | inside `fx.py` (chip-tool, its own fabric) | Plays Google Home or Apple Home: owns every device, shares one with a fresh code, reads the device's own state |
| Contract test | `tests/matter_contract.py` (runs anywhere with Python 3.9+) | Calls the API under test, then checks the device itself |
| Reference server | `tests/matter/reference_server.py` (runs on the Mac) | A small chip-tool based implementation of the API, used to prove the test. Not shipped |
| Build | `tests/matter/fixtures/build-fixtures.sh` (runs on the Mac) | Builds the device programs |

## The devices

All run on the MacBook (`ssh macbook`). Factory passcode 20202021 for all of them. Each has its own
short discriminator, so no two codes can reach the same device.

| Name | Program | Port | Discriminator | Factory code | Home node | Should appear as |
|---|---|---|---|---|---|---|
| light | chip-lighting-app (extended colour light) | 5541 | 321 | 0169-331-2333 | 101 | `light` |
| plug | all-devices-app `on-off-plug-in-unit` | 5542 | 578 | 0333-171-2331 | 102 | `switch` |
| thermostat | thermostat-app | 5543 | 835 | 0497-011-2335 | 103 | `climate` |
| cover | chef `rootnode_windowcovering` | 5544 | 1092 | 1005-491-2339 | 104 | `cover` |
| fan | all-devices-app `fan` (FanControl and OnOff) | 5545 | 1349 | 1169-331-2331 | 105 | `fan` |
| sensors | all-devices-app, 4 endpoints: temperature 1, humidity 2, contact 3, occupancy 4 | 5546 | 1606 | 1333-171-2334 | 106 | 4 x `sensor` |
| lock | chip-lock-app (door lock) | 5547 | 1863 | 1497-011-2338 | 107 | never listed |
| alarm | all-devices-app `smoke-co-alarm` | 5548 | 2120 | 2005-491-2334 | 108 | never listed |

The factory codes only work while a device is new (after `fx reset`, before `fx home`). Normal runs
use **shared codes**: the home controller owns every device and opens a commissioning window with a
fresh random passcode for one device at a time, exactly as Google Home's "Share device" or Apple
Home's "Turn on pairing mode" does. A shared window uses discriminator `(n << 8) | 0x90` (light 400,
plug 656, thermostat 912, cover 1168, fan 1424, sensors 1680, lock 1936, alarm 2192).

## Running the devices (on the MacBook)

```sh
ssh macbook matter-fixtures/fx up          # start all eight, put them in the home fabric (10 s)
ssh macbook matter-fixtures/fx status      # JSON: running, ports, discriminators, nodes, expected domains
ssh macbook matter-fixtures/fx share light # JSON: {"manual": "<11 digits>", "qr": "MT:...", ...}, 5 min window
ssh macbook matter-fixtures/fx stop        # stop them all (they keep their storage)
ssh macbook matter-fixtures/fx reset       # stop, wipe device storage and the home fabric
```

Everything else `fx` can do:

| Command | What it does |
|---|---|
| `fx share <name> [secs]` | Open a commissioning window (180 to 900 s) with a fresh code. Prints the 11 digit code and the QR text |
| `fx revoke <name>` | Close the open window: the shared code stops working ("expired") |
| `fx wrongcode <name>` | A well formed code for the open window with the wrong passcode ("wrong_code") |
| `fx read <name> <cluster> <attribute> [endpoint]` | Read one attribute from the device itself, JSON |
| `fx do <name> <chip-tool args>` | Run any chip-tool command as the home controller, `NODE` is replaced by the node id. Example: `fx do light onoff toggle NODE 1` (a change "made in Google Home") |
| `fx pipe <name> '<json>'` | Change a sensor out of band: `fx pipe sensors '{"Name":"SetOccupancy","EndpointId":4,"Occupancy":1}'`, `'{"Name":"SetBooleanState","EndpointId":3,"NewState":true}'` |
| `fx fabrics <name>` | How many controllers the device has (1 = only home) |
| `fx evict [names]` | Remove every controller but home from the devices (cleans up after a run that did not remove its devices) |
| `fx log <name> [n]` | The device's own log |
| `fx codes` | The factory codes |

The MacBook's address on the home network was <macbook-ip> on 20 Nov 2026 (`ssh macbook ipconfig getifaddr en0`).

## Running the contract test

From any computer that can `ssh macbook` and reach the API under test:

```sh
ssh macbook matter-fixtures/fx up
python3 tests/matter_contract.py --api http://<tv>:5400 --token <token>      # on-TV app
python3 tests/matter_contract.py --api http://127.0.0.1:8765 --token <key>   # bridge
```

- `--token`: the on-TV app's pairing token, or the bridge's pairing key (or set `MATTER_TOKEN`).
  It is sent as `Authorization: Bearer`. Never commit it.
- `--only errors,light` or `--skip offline` picks groups: `auth, errors, commission, list, light,
  plug, thermostat, cover, fan, sensors, live, events, rename, forbidden, offline, remove`. Groups
  that need devices commission them first.
- `--keep` leaves the devices commissioned (no remove), to look at them on the TV afterwards.
- `--address <macbook-ip>` sends `address: "<mac>:<port>"` with every commission, which skips
  network discovery. Use it for the Android emulator (no multicast there).
- `--slow` also waits out a real 3 minute window to test "expired" honestly.
- `--report out.json` writes every check; `-v` prints every request and answer.
- `--fx "<command>"` if the devices run somewhere else (default `ssh macbook matter-fixtures/fx`).

It prints `PASS`/`FAIL`/`WARN` per check, then the counts, and exits 1 on any FAIL. A full run takes
about 4 minutes. If a run stops half way, the devices may still belong to the implementation:
the test refuses to start then. Remove them in the implementation, or `fx evict` (and the
implementation then holds stale entries: remove those too).

## What it checks

Every state check reads the device itself through the home controller, never the implementation's
own answer.

| Group | Checks |
|---|---|
| auth | devices and command refuse a call without the token (401/403); devices answers `{devices, ready}` |
| errors | malformed code, bad check digit, bad QR text: `wrong_code` in under 15 s. A code no device answers to, and a shared code whose window was closed: `expired` or `unreachable`. The right device with the wrong passcode: `wrong_code`. Every `note` is plain words (no "CHIP", hex, stack traces, under 240 characters). The light is not joined after any of them |
| commission | each device by its shared 11 digit code (sensors by the QR text): `ok`, `device_ids` like `matter:<node>:<ep>`, one node, new, under 120 s, and the device now really has 2 fabrics. The light shared a second time: error `already` (or its same ids), no new entry, still 2 fabrics |
| list | exactly the expected endpoints per device, domain, not unavailable, `device_class` and `unit_of_measurement` (°C, %) for sensors, sensor readings match the device, climate has `current_temperature temperature min_temp max_temp hvac_modes` and its state is one of `hvac_modes`, cover `current_position`, fan `percentage`, light `brightness` or `level` and `color_temp_kelvin` |
| light | on, off, toggle; level 50 (%) = CurrentLevel 120 to 134; temp 2700 (K) = 370 mireds; colour `#0000ff` = hue 240° (or xy blue) and `"120,100"`; the entity shows about 50% |
| plug | on, off, toggle, toggle; `level` refused |
| thermostat | mode heat = SystemMode 4; target 22.5 = heating setpoint 2250; mode cool = 3 and target 24 = cooling setpoint 2400 (if `cool` is offered); mode off = 0; an unknown mode refused; the state follows |
| cover | position 30 (% open) = target 7000 (Matter counts % closed, in hundredths); position 100 = 0; off closes (10000), on opens (0); the entity shows 100 and open |
| fan | on + level 60 = PercentSetting 60 and PercentCurrent 60; off = PercentCurrent 0 |
| sensors | a command on a sensor is refused; an unknown id is refused |
| live | changes made elsewhere (the home controller, like Google Home or a wall switch) show in the list within 10 s: light off, on, 25%; plug on; blind closed; setpoint 19 °C; fan 30%; occupancy 1 and 0; contact closed and open |
| events | `version` goes up after a change; `GET /api/matter/events` sends `event: matter` with the device list at once and again after a change (WARN, not FAIL, if there is no stream) |
| rename | to "Lounge lamp" and the list shows it; empty, 41 characters and unknown ids refused |
| forbidden | the lock and the smoke alarm: no `device_ids` (an `ok: false` answer must carry error `not_allowed`), a plain `note`, never listed, no domain outside the six, their state untouched; WARN if the implementation keeps its keys to them (it should leave their fabric) |
| offline | the plug stopped: `unavailable` within 90 s; started again: on/off within 90 s |
| remove | `ok`, `removed` lists every id of the node, every endpoint leaves the list, the device is back to 1 fabric, and it still answers the home controller (it stays in the person's Google or Apple home) |

## Proven on 21 Nov 2026

Against the reference server on the MacBook, after a clean restart with `--reset`:
**261 passed, 0 failed, 0 warnings, 261 checks, 230 s.** By group: auth 2, errors 25, commission 34,
list 53, commands 78 (light, plug, thermostat, cover, fan, sensors), live 13, events 3, rename 6,
forbidden 14, offline 2, remove 31. The reference server is also the worked example of every
mapping in the contract.

```sh
ssh macbook ~/matter-spike/connectedhomeip/.environment/pigweed-venv/bin/python3 \
    ~/matter-fixtures/reference_server.py --port 5490 --token test --reset
python3 tests/matter_contract.py --api http://<macbook-ip>:5490 --token test
```

**The test catches real bugs (negative control).** The reference has four known bugs it can switch
on: `--break cover-percent,lock-listed,no-live,raw-errors`. With all four on, the same test gave
**241 passed, 20 failed, 2 warnings, 263 checks**, and every bug was caught:

| Bug switched on | What it does | Caught by |
|---|---|---|
| `raw-errors` | a failed commission answers "CHIP Error 0x00000032: Timeout" as the note | 2 FAIL (errors: note is plain words) |
| `cover-percent` | cover position sent as % closed instead of % open | 2 FAIL (command: cover position 30 and 100) |
| `no-live` | a device's state is read once and never again | 11 FAIL (8 live, 2 events, 1 offline), plus 1 FAIL in remove: the plug kept the reference's fabric because its stale session never reconnected |
| `lock-listed` | the lock and the alarm are listed as a switch | 4 FAIL (no device ids, not listed, for each) and 2 WARN (keys kept) |

After a broken run, `ssh macbook matter-fixtures/fx evict` takes the leftover controller off the
devices (it took the reference's fabric off the plug, the lock and the alarm).

`build-fixtures.sh` ran on the MacBook on 21 Nov 2026: exit 0, 13 s with everything already built
(ninja: no work to do; the chef patch already in place, so not applied twice). A build from nothing
takes about 3 minutes.

## Things the reference server ran into (so the real ones do not)

- A QR text has dashes and dots of its own (`MT:-24J0...`): strip spaces and dashes only from an 11
  digit code, never from `MT:` text.
- After a device restarts, chip-tool kept its old secure session and every read timed out until it
  was restarted. A controller has to drop the session and set up a new one (CASE) when a device stops
  answering, or "unavailable" never turns back into a state.
- A wrong passcode takes about 30 s to fail: the controller waits in case another device answers to
  the same discriminator. A code nobody answers to takes as long as the discovery timeout.
- Matter's WindowCovering counts % closed in hundredths; Home Assistant's `current_position` is % open.
- A fan with an OnOff cluster turns only while OnOff is on: PercentSetting alone does not start it.
- A commissioning window must be 180 to 900 s; shorter is refused with INVALID_COMMAND.
- A device shared a second time to a controller that already has it fails in about 1.5 s with
  CHIP error 0x7E (the fabric exists): answer `already`, and keep the one entry it has.
- A lock or an alarm: read its device types right after commissioning, leave its fabric at once
  and answer `not_allowed` with a plain note (HTTP 400).

## Rebuilding the devices

On the MacBook (connectedhomeip v1.6.1.0 bootstrapped in `~/matter-spike`):

```sh
scp tests/matter/fixtures/{build-fixtures.sh,fx,fx.py} tests/matter/reference_server.py macbook:matter-fixtures/
ssh macbook matter-fixtures/build-fixtures.sh
```

The window covering comes from chef (`examples/chef`, `rootnode_windowcovering`): its Linux target
builds on macOS once `FakeAttributeAccess.cpp`, which only Pigweed RPC builds use, is left out. The
script makes that one guarded change in the spike tree and says so.
