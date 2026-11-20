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
garage doors, gates and doors**. A blind or cover whose name says garage, gate, door or lock is left
out too. If someone shares only a lock, the computer leaves it again at once and says so.

## What it uses, and why

The controller is the **Open Home Foundation Matter Server** (npm package `matter-server`, Apache
2.0), the Matter controller Home Assistant itself runs. It is written on matter.js, Matter in
plain JavaScript, so the **same code runs on a Mac (Apple silicon or Intel), Linux and a Raspberry
Pi, with nothing to compile**. The bridge starts it as its own service, listening on this computer
only (`127.0.0.1`, port 5581), and talks to it over its WebSocket API (bridge/matter.py).

We looked at the two controllers the plan named first:

| Controller | macOS | Linux x86_64 | Raspberry Pi | Notes |
|---|---|---|---|---|
| python-matter-server 7.0.1 (Python, on the C++ SDK) | Apple silicon only, macOS 14 or newer (its pinned `home-assistant-chip-core` 2024.11.4 has a `macosx_14_0_arm64` wheel and nothing for Intel Macs) | yes (manylinux 2.31) | 64 bit Pi OS only (`manylinux_2_31_aarch64`; no 32 bit wheel) | Last release 31 Dec 2024. Home Assistant moved to the matter.js server below. Its own docs only support it on Linux (Thread routing, Bluetooth), and in Docker it needs host networking, which Docker Desktop on a Mac does not give the home network. |
| connectedhomeip's Python controller | build it yourself (the on-TV app builds the SDK on a Mac) | build it yourself | build it yourself | A full SDK build per computer: far too much for a beginner's bridge. |
| **matter-server 1.6.0 (matter.js)** | **yes, native** | **yes** | **yes, 32 and 64 bit** (Node.js has both) | Released 14 Nov 2026, maintained by the Open Home Foundation. Same WebSocket API as python-matter-server. **This is what the bridge uses.** |

Because the API is the same, `config.json` can point the bridge at a python-matter-server or
matter-server someone already runs (in Docker on a Linux box, for example) instead of starting its
own: `"matter": {"server": "ws://127.0.0.1:5580/ws"}`. Then that server's fabric is shared with
whatever else uses it (Home Assistant), so the bridge's own service is the better default.

## Setting it up

It needs **Node.js 22.13 or newer** on the home computer (option B already uses Node).

```sh
scripts/matter-setup.sh            # installs it into bridge/matter/node_modules (about 200 MB, 10 seconds)
scripts/matter-setup.sh --check    # says whether it is installed and Node.js is new enough
```

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
  "port": 5581,
  "server": "ws://127.0.0.1:5580/ws",
  "node": "/opt/homebrew/bin/node",
  "test_devices": false
}
```

- `enabled`: false switches Matter off.
- `port`: the port the bridge's own service listens on, on this computer only.
- `server`: use a Matter server already running instead of starting one.
- `node`: which Node.js to use, when the first `node` on the PATH is too old.
- `test_devices`: also accept development boards and the SDK's sample apps, whose certificates are
  test ones (`--enable-test-net-dcl`). Leave it off for real devices.

## Where the keys live

The bridge's Matter fabric (its root key and the devices it joined) is in `bridge/data/matter/`
(mode 700, git ignores it), names given on the TV in `bridge/data/matter-names.json` (mode 600).
Back up `bridge/data/` with the rest of the bridge: without that folder the devices have to be shared
again. `bridge/data/matter/service.log` is the service's log (kept under 5 MB).

## The API

Behind the same rule as the Home Assistant endpoints: a TV in `config.json`, this computer, or a
caller with `bridge.pairing_key`.

| | |
|---|---|
| `GET /api/matter/devices` | `{ ok, devices, ready, version, note? }`. `note` says in plain words why it is not ready (not installed, Node.js too old, starting). |
| `GET /api/matter/events` | Server sent events: `event: matter`, the same JSON as `/devices`, at once and within a quarter second of any change. `/api/events` carries the same event. |
| `POST /api/matter/commission {code, address?}` | `{ ok, device_ids }`, or HTTP 400 with `{ ok: false, error, note, device_ids: [] }`. `error` is `wrong_code`, `expired`, `unreachable` or `thread` (or `not_allowed` for a lock). `address` (`host`, `host:port` or `[v6]:port`) skips looking for the device. |
| `POST /api/matter/command {id, action, value?}` | `{ ok, state, device }`, answered once the device itself reported the change (at most about 2.5 seconds). |
| `POST /api/matter/remove {id}` | `{ ok, removed }`. A device is one Matter node: every id of it goes. Couch TV leaves the device's fabric; the device stays in the person's own home app. |
| `POST /api/matter/rename {id, name}` | `{ ok, name }`. 1 to 40 characters, kept on this computer only. |

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

- `tests/test_matter_bridge.py` (15 tests): every domain mapped from Matter attributes, including a
  real node (the SDK's virtual light, `tests/fixtures/matter-light-node.json`, read by the service
  after a share); locks, alarms, garage doors and a lock behind a Matter bridge never shown, never
  switched, never renamed or removed; what each action sends; the error keys; adding by address;
  names kept with mode 600; removing a whole node; the live event; the endpoints behind the
  pairing rule; the service only ever listening on 127.0.0.1.
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
  Python 3.11): `scripts/matter-setup.sh`, the 15 tests, the service ready (2.2 seconds on arm64,
  the Raspberry Pi 4 and 5 kind; 21 seconds on x86_64 under emulation), the `expired` answer from
  the real service, a clean stop, storage mode 700. Docker's own network on a Mac cannot reach
  the home network, so adding a real device on Linux was not tried.
- Not tried at all: a 32 bit Raspberry Pi (Node.js 22 has 32 bit ARM builds and nothing here is
  compiled, but there was no 32 bit machine or emulator), a real Thread device, and a real share
  from the Google Home or Apple Home app (the share was made by a second controller with the same
  Open Commissioning Window step those apps use).
