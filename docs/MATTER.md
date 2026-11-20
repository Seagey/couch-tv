# Matter devices on the home computer

Couch TV can show and work the smart devices people already have in **Google Home, Apple Home,
SmartThings or Alexa**, with no Home Assistant. The person shares a device from their own home app
with Matter's "share" (multi admin): the app gives a pairing code (11 digits, or a QR code), they
type it on the phone page, and the TV or the home computer joins the device as one more controller.
The device stays in their own home app, which keeps working exactly as before.

On a Google TV or Android TV the on-TV app is the controller itself. On Samsung, LG, the web TVs,
Roku, Apple TV and a launcher with a bridge, **the home computer is** (the bridge, option B): this
page is about that one. Both answer the same API, so the phone page and the TV screens are the same.

Never shown and never switched, the same rule as Home Assistant: **locks, alarms (smoke and CO),
garage doors, gates and doors**. A blind, a plug or an on/off only light (what a garage door opener
usually is) whose name says garage, gate, door or lock is left out too. The name rule goes by whole
words ("Outdoor blind" and "Margate blind" are blinds) in every language the home speaks: English,
German, Dutch, French, Spanish, Italian, Portuguese, Turkish, Serbian, Polish, Czech, Hebrew and
Arabic ("Garagentor", "Portail", "Puerta del garaje", "Cancello", "Brama garażowa"). A name typed on
the TV that would hide the device is refused (reason `opens_house`), so nothing can be hidden for good.
If someone shares a lock, an alarm, a garage door or a kind of device Couch TV cannot show (a speaker,
a switch that only sends), the computer leaves it again at once and says so: nothing is kept that the
TV cannot show or remove.

## What it uses, and why

The controller is the **Open Home Foundation Matter Server** (npm package `matter-server`, Apache
2.0), the Matter controller Home Assistant itself runs. It is written on matter.js, Matter in
plain JavaScript, so the **same code runs on a Mac (Apple silicon or Intel), Linux and a Raspberry
Pi, with nothing to compile**. The bridge starts it as its own service and talks to it over its
WebSocket API (bridge/matter.py). That API can do anything to the devices and has no login, so it
**listens on no network port at all**: only on a unix socket, `bridge/data/matter/ws.sock`, in a
folder only the bridge's user can open (mode 700). When that path is too long for a socket (104 bytes
on macOS), the socket goes in a short folder of its own under the system's temporary folder, also
mode 700 and owned by that user. No web page and no other user on the computer can reach it. The
service runs with `--disable-dashboard --disable-ota --disable-thread-diagnostics`. It does open
Matter's own port (UDP and TCP, a random number): that is the Matter protocol itself, where every
message is encrypted and only devices that joined this fabric are answered.

We looked at the two controllers the plan named first:

| Controller | macOS | Linux x86_64 | Raspberry Pi | Notes |
|---|---|---|---|---|
| python-matter-server 7.0.1 (Python, on the C++ SDK) | Apple silicon only, macOS 14 or newer (its pinned `home-assistant-chip-core` 2024.11.4 has a `macosx_14_0_arm64` wheel and nothing for Intel Macs) | yes (manylinux 2.31) | 64 bit Pi OS only (`manylinux_2_31_aarch64`; no 32 bit wheel) | Last release 31 Dec 2024. Home Assistant moved to the matter.js server below. Its own docs only support it on Linux (Thread routing, Bluetooth), and in Docker it needs host networking, which Docker Desktop on a Mac does not give the home network. |
| connectedhomeip's Python controller | build it yourself (the on-TV app builds the SDK on a Mac) | build it yourself | build it yourself | A full SDK build per computer: far too much for a beginner's bridge. |
| **matter-server 1.6.0 (matter.js)** | **yes, native** | **yes** | **yes, 32 and 64 bit** (Node.js has both) | Released 14 Nov 2026, maintained by the Open Home Foundation. Same WebSocket API as python-matter-server. **This is what the bridge uses.** |

The bridge always runs its own service. An earlier version could also use a Matter server someone
already ran (`matter.server`), but then removing a device on the TV removed it from Home Assistant
too, and that path was never tested, so it is gone: `server` and `port` in `config.json` are
ignored now, with one line in the bridge's log saying so.

## Setting it up

It needs **Node.js 22.13 or newer** on the home computer (option B already uses Node).

```sh
scripts/matter-setup.sh            # installs it into bridge/matter/node_modules (about 170 MB, 4 seconds)
scripts/matter-setup.sh --check    # says whether it is installed and Node.js is new enough
```

It installs as little as it can: `--omit=optional` leaves out the Bluetooth and USB add ons (94
packages in the lock, three of them with install scripts that compile code), which the bridge never
uses, and `--ignore-scripts` runs nothing that was downloaded. matter.js marks its Node.js network
layer (`@matter/nodejs`) optional too and cannot start without it, so the script puts that one back
at the version and checksum in the lock file, and stops if the installed copy's checksum differs.
matter-server 1.6.0 pins a nightly build of matter.js (`0.18.1-alpha.0-20261114-e4326a175`), not a
numbered release; the lock file holds it at that exact build and checksum. Tried on an Apple silicon Mac (Node.js 26.13): 87
packages, the service started and added the test devices.

Then restart the bridge. It starts the Matter service by itself, and again if it ever stops. The
exact versions are pinned in `bridge/matter/package-lock.json`; run the setup again after updating
couch-tv. Nothing else is needed: no Bluetooth (a shared device is always added over the home
network, because it is already on it), no Wi-Fi or Thread credentials.

**Mac: Local Network permission.** macOS lets a program talk to devices at home only after someone
said Allow ("node would like to find devices on your local network"). Start the bridge once from
Terminal and press **Allow** when it asks. Without it Matter finds nothing: on a test Mac a service
started outside a logged in session got `EHOSTUNREACH` for every mDNS message, and the same service
started inside the session added the light in 2.3 seconds. If it was refused: System Settings,
Privacy and Security, Local Network, switch on Terminal (or node).

**Mac: the bridge as a launchd service** (docs/SETUP.md step 5). The Matter service is a child of the
bridge, so it runs inside the same launchd job, and stopping the job (`launchctl bootout`, which sends
SIGTERM) stops the service too (tried: the service ended and its pid file was removed).

**It needs the Local Network permission, and with launchd nobody is asked.** Tried on the MacBook
(macOS 27, Apple silicon) on 21 Nov 2026 with `bridge/examples/couch-tv-bridge.plist.example` (a test
label, the venv's Python from `uv`, port 8796): the job started (`state = running`), the bridge
answered and Matter was ready in 2 seconds, but adding the shared test light failed 3 times out of 3
after 30 seconds ("the device did not answer"). The cause, measured with a small probe run as a
launchd job: **every multicast send failed with errno 65, No route to host** (mDNS to 224.0.0.251 and
ff02::fb, which is how Matter finds a device), while the same probe from a Terminal or ssh session
sent all of them. The same happened with the Python copied into a small app bundle with its own
identity and `NSLocalNetworkUsageDescription` (issue #42's way), started by launchd or by `open`: macOS
blocks it until someone switches it on. No one was at the Mac to press Allow, so a working add under
launchd is still to be seen.

What the bridge does about it: when an add fails because nothing answered and the bridge itself cannot
send multicast, it answers error `unreachable`, reason `local_network`, with a note saying where to
switch it on, instead of "expired" (tried live under launchd: that answer, in 30 seconds). What the
person does, once, at the Mac: System Settings, Privacy and Security, Local Network, switch on the
program the job runs (the Python, or the app bundle), then add the device again. If the Python is not
listed there, start the bridge once from Terminal (Terminal then asks), or use a python.org or Homebrew
Python for the venv, as docs/SETUP.md step 5 says. Starting the bridge from Terminal works at once: every
live test here ran that way.

**Linux and Raspberry Pi: Thread devices.** A Matter device on Thread (most Eve, Nanoleaf and
IKEA ones) is reached through a Thread border router (a Google Nest hub, an Apple TV or HomePod, a
SmartThings hub), which tells the home network the way in with an IPv6 route. macOS takes that route
by itself. Linux does only with:

```sh
sudo sysctl -w net.ipv6.conf.all.accept_ra=1 net.ipv6.conf.all.accept_ra_rt_info_max_plen=64
```

(and the same for the network interface, for example `wlan0`; put it in `/etc/sysctl.d/` to keep
it). Without it, adding a Thread device fails with the "Thread network not reachable" message.

## config.json

All optional; Matter is on when it is installed.

```json
"matter": {
  "enabled": true,
  "node": "/opt/homebrew/bin/node",
  "test_devices": false
}
```

- `enabled`: false switches Matter off.
- `node`: which Node.js to use, when the first `node` on the PATH is too old (a launchd job has a
  bare PATH: the example plist adds Homebrew's).
- `server` and `port` are no longer used (above): the bridge logs one line and carries on. A value of
  the wrong type anywhere in this section never stops the bridge from starting.
- `test_devices`: also accept development boards and the SDK's sample apps, whose certificates are
  test ones (`--enable-test-net-dcl`). Leave it off for real devices.

## Where the keys live

The bridge's Matter fabric (its root key and the devices it joined) is in `bridge/data/matter/`
(mode 700, git ignores it), names given on the TV in `bridge/data/matter-names.json` (mode 600), and
devices removed while they did not answer in `bridge/data/matter-forgotten.json` (mode 600: they are
never shown again and are told to leave the next time the service reaches them). Back up
`bridge/data/` with the rest of the bridge: without that folder the devices have to be shared again.
`bridge/data/matter/service.log` is the service's log. It is looked at every minute while the service
runs: over 5 MB, it is copied to `service.log.1` and starts again, so the two never pass 10 MB.

## The API

Behind the same rule as the Home Assistant endpoints: a TV in `config.json`, this computer, or a
caller with `bridge.pairing_key`.

| | |
|---|---|
| `GET /api/matter/devices` | `{ ok, devices, ready, version, reason?, note? }`. While not ready, `reason` says why as a key the TV screens translate (`off`, `not_installed`, `node_missing`, `node_old`, `starting`, `stopped`) and `note` says it in plain English. |
| `GET /api/matter/events` | Server sent events: `event: matter`, the same JSON as `/devices`, at once and within a quarter second of any change. Only here, behind the pairing rule: never on `/api/events`, which any device on the Wi-Fi may open. A page that reads slowly keeps at most the 20 newest lists. |
| `POST /api/matter/commission {code, address?}` | `{ ok, device_ids }`, or HTTP 400 with `{ ok: false, error, reason?, note, device_ids: [] }`. `error` is `wrong_code`, `expired`, `unreachable`, `thread`, `already` (the device is on Couch TV already) or `not_allowed` (`reason` `blocked`: a lock, an alarm or a garage door; `unsupported`: a kind of device Couch TV cannot show). A failed add answers within about 30 seconds (the service looks for the device for 30 seconds). See the address rules below. |
| `POST /api/matter/command {id, action, value?}` | `{ ok, state, device }`, answered once the device itself reported the change (at most about 2.5 seconds; at once when the action changes nothing). |
| `POST /api/matter/remove {id}` | `{ ok, removed, reason?, note? }`. A device is one Matter node: every id of it goes, also one the name rule hides. Couch TV leaves the device's fabric: it asks the device itself to drop Couch TV (RemoveFabric), checks it can no longer reach it, tries twice more if it still can, then lets the service forget it. The device stays in the person's own home app. A device that is `unavailable` is forgotten anyway (`reason` `offline`, a note to remove Couch TV in the other app too if it is listed there), and one that does not answer the leave is forgotten here and left properly the next time it answers (`reason` `not_answering`). |
| `POST /api/matter/rename {id, name}` | `{ ok, name }`. 1 to 40 characters, no control characters, no `<` or `>`, kept on this computer only. A name the name rule would hide is refused: `{ ok: false, error: "refused", reason: "opens_house", note }`. |

**Every refusal has a `reason`** (contract changes 14 and 15), a key the TV screens word in every
language. Commission: `wrong_code`, `expired`, `thread`, `unreachable`, `already`, `not_certified`,
`failed`, `not_ready`, `local_network` (a Mac that does not let the bridge look on the home network), `busy` (another device is still being added: answered at once, never queued),
`blocked` or `unsupported` (with error `not_allowed`), `address`, `port` or `link_local`, and while
Matter is not ready the reason it is not. Command: `not_found` (no such device), `bad_request` (an
action or value this device does not take), `not_ready` (the device is not answering),
`device_refused` (the device said no), `failed`. Rename: `not_found`, `bad_name`, `opens_house`.
Remove: `not_found`.

**Address rules** (`address` on commission, contract change 5): `host`, `host:5540`, `[v6]` or
`[v6]:5540`. The Matter service only ever tries port 5540 (the port every Matter device uses), so
another port is refused with reason `port` and a plain note rather than silently tried on 5540. An
`fe80` (link local) address is refused with reason `link_local`, because the service drops those and
would look for the device instead. Anything else that is not an IP address: reason `address`. All
three answer error `unreachable`, HTTP 400.

**Unavailable** (contract change 13). The service itself only notices a device that went away when
its subscription runs out, which can take many minutes. So a device the bridge has not heard from for
45 seconds is asked for one value (every 15 seconds); no answer within 10 seconds and it shows
`unavailable` (and pushes that to the TV) until it answers again, when it is read once in full. A
sleepy battery device (one with Matter's ICD cluster) is never asked, so it is not woken up: the
service's own timing applies to those.
Each device is `{ id: "matter:<node>:<endpoint>", name, domain, state, attributes }` with Home
Assistant's attribute names (the Matter contract):

| Matter device | domain | state | attributes |
|---|---|---|---|
| On/off, dimmable, colour temperature and extended colour light | `light` | on, off | `brightness` 0 to 255, `level` 0 to 100, `color_temp_kelvin`, `min_color_temp_kelvin`, `max_color_temp_kelvin`, `hs_color` or `xy_color`, `color_mode`, `supported_color_modes` |
| Plug in unit, mounted on/off control | `switch` | on, off | |
| Fan | `fan` | on, off | `percentage`, `preset_mode` |
| Window covering (not a garage door) | `cover` | open, closed, opening, closing | `current_position` 0 (closed) to 100 (open) |
| Thermostat, room air conditioner | `climate` | the mode: off, heat, cool, heat_cool, dry, fan_only | `current_temperature`, `temperature`, `target_temp_low`, `target_temp_high`, `min_temp`, `max_temp`, `target_temp_step` 0.5, `hvac_modes`, `hvac_action`, `fan_mode` |
| Temperature, humidity, light, pressure, motion, contact, air quality sensor | `sensor` | the reading as text (motion and contact: on, off, as Home Assistant's binary sensors; contact on means open) | `device_class`, `unit_of_measurement`, contact `reading` (open or closed), air quality `pm25` and `co2` |

Every device also has `attributes.friendly_name`; a device that does not answer has state
`unavailable`. The names come from the device (its label, or its product name); Google Home and
Apple Home do not share their own names over Matter, so renaming on the TV is expected.

Actions: `on`, `off`, `toggle` (all), `level` (light brightness, fan speed, cover position, 0 to
100), `temp` (light colour temperature in kelvin), `colour` (`#rrggbb`, `"h,s"`, `[h, s]` or
`{h, s}`), `position` (cover), `mode` (climate, one of `hvac_modes`), `target` (climate set
point, °C, in half degrees). A cover's `on` opens it and `off` closes it. Sensors only read.

## What was tested, and how

- `tests/test_matter_bridge.py` (41 tests, all pass): every domain mapped from Matter attributes, including a
  real node (the SDK's virtual light, `tests/fixtures/matter-light-node.json`, read by the service
  after a share); locks, alarms, garage doors and a lock behind a Matter bridge never shown, never
  switched, never renamed or removed; what each action sends; the error keys; adding by address;
  names kept with mode 600; removing a whole node; the live event, only on `/api/matter/events`;
  the endpoints behind the pairing rule; the name rule in every language, whole words only; a device
  Couch TV cannot show left again (only once the service is connected to it); `already`; the
  address rules; a device that does not answer forgotten anyway and left later; a device that stops
  answering shown `unavailable` and back again; xy colour as `hs_color`; the reason keys. Against a
  pretend service on a unix socket, and the real start, restart and stop of a pretend service
  process: the service on no network port, a leftover from a killed bridge ended without freezing
  the bridge, the pid file, the atexit stop, the log kept under 5 MB, bad settings never crashing.
- Live, on an Apple silicon Mac (macOS 27), against connectedhomeip's `chip-lighting-app`:
  a second matter-server played "Google Home" (commissioned the light, then shared it with Open
  Commissioning Window), and the bridge's own service added it by the share code in 2.3 to 2.5
  seconds; on, off, toggle, level, colour temperature and colour worked and were read back from the
  light's own reports (9 of 9); rename; remove left only the bridge's fabric (the light kept the
  other); a mistyped code was refused before reaching the network; a stale code with the right
  discriminator answered `wrong_code` (in 60 seconds, then 30 after the discovery limit was cut);
  a code nobody answers took 30 seconds; the bridge's service (installed by
  `scripts/matter-setup.sh` in 8 seconds) started in 2.7 seconds, added the light, worked it
  (3 of 3) and stopped with the bridge, and one left running by a killed bridge (kill -9) was
  ended at the next start.
- Live, on the same Mac, the SDK's virtual thermostat (`thermostat-app`): added in seconds as
  `climate` with modes off, heat, cool and heat_cool; mode heat, set point 21.5, mode cool, set
  point 25, off, on (back to cool), mode heat_cool: 7 of 7, each read back from the thermostat's
  own report. The SDK's virtual lock (`chip-lock-app`): refused with `not_allowed`, the bridge left
  its fabric again, and it never showed in the device list.
- Linux, in Docker (colima) on that Mac, from a clean copy with `node:22-bookworm` (Node.js 22.23.5,
  Python 3.11): `scripts/matter-setup.sh`, the bridge's Matter tests (15 then), the service ready (2.2 seconds on arm64,
  the Raspberry Pi 4 and 5 kind; 21 seconds on x86_64 under emulation), the `expired` answer from
  the real service, a clean stop, storage mode 700. Docker's own network on a Mac cannot reach
  the home network, so adding a real device on Linux was not tried.
- The Matter contract test (`tests/matter_contract.py`, branch nl-matter-fixtures, 16 groups, every
  state read back from the device itself) against this bridge on the MacBook, with eight real Matter
  devices from connectedhomeip v1.6.1.0 (light, plug, thermostat, cover, fan, four sensors, lock,
  smoke alarm) shared one at a time by a second controller the way Google Home shares them:
  **261 passed, 0 failed, 0 warnings, 261 checks, 249 s** (21 Nov 2026). That covers adding by code
  and QR, the error keys, every command on every device, changes made elsewhere showing within
  10 seconds, the event stream, rename, the lock and the alarm refused and left (back to 1 fabric),
  a plug switched off showing `unavailable` and coming back, and every device back to 1 fabric after
  remove. The first run found four faults (a second share answered `unreachable`, an off light had no
  level, a stopped plug never showed `unavailable`, the lock and alarm kept Couch TV's keys); each
  was fixed and has its own test in `tests/test_matter_bridge.py`. One run in four also showed an
  occupancy report arriving late and a third fabric on the light for a moment after a second share;
  neither came back in the last run.
- Not tried at all: a 32 bit Raspberry Pi (Node.js 22 has 32 bit ARM builds and nothing here is
  compiled, but there was no 32 bit machine or emulator), a real Thread device, and a real share
  from the Google Home or Apple Home app (the share was made by a second controller with the same
  Open Commissioning Window step those apps use). The real share from those apps and a real Thread
  device need someone at home with their own phone and devices; they are the first thing to try
  there. Adding a device with the bridge as a launchd job needs one Allow at the Mac first (above).
