# RESUME: nl-matter-bridge (builder "matter-bridge")

Read first: scratchpad nolater-common.md and matter-contract.md (the contract's Changes 1 to 9 are implemented here too).

## Done
- bridge/matter.py: the bridge's Matter controller. Starts the Open Home Foundation Matter Server
  (npm matter-server 1.6.0, matter.js; pinned in bridge/matter/package-lock.json) as its own
  service on 127.0.0.1:5581, storage bridge/data/matter (700), names bridge/data/matter-names.json (600),
  ends a leftover service from a killed bridge (service.pid), atexit stop. Device model with HA attribute
  names, locks/alarms/garage doors filtered (a lock shared alone is removed again: error not_allowed),
  commands (on/off/toggle/level/colour/temp/target/mode/position), commission errors
  wrong_code/expired/unreachable/thread, address commissioning, rename, remove (whole node), version.
- bridge/server.py hunks (shared file): `import matter`; block after h_ha_forget (push_matter,
  matter_clients, h_matter_events/devices/commission/command/remove/rename, all @tv_or_paired);
  6 routes after /api/ha/direct; `await MATTER.start()` in on_startup; `await MATTER.stop()` in on_cleanup.
- scripts/matter-setup.sh, docs/MATTER.md, bridge/API.md (short Matter section), tests/test_matter_bridge.py
  (15 tests), tests/fixtures/matter-light-node.json.

## Test results so far
- Here: `<main checkout>/.venv/bin/python -m unittest discover -s tests -p "test_matter_bridge.py"` 15/15 OK;
  full suite `-p "test_*.py"` Ran 1363, OK (skipped 58).
- build Mac live (light): 9/9 commands through a tunnel; bridge-spawned service: setup 8 s, ready 2.7 s,
  added by share code 2.5 s, 3/3 commands, clean stop, kill -9 leftover ended at restart.
- Linux Docker on build Mac (colima): arm64 and x86_64 both: setup, 15/15, ready, `expired`, clean stop.
- Thermostat live (thermostat-app on port 5781, other agents hold 5641-5671): 7/7 commands; lock (chip-lock-app) refused not_allowed and left.

## Next steps
Nothing left in scope: all done, test processes stopped (19:06). Optional later: a real share from the
Google Home or Apple Home app and a real Thread device (needs the owner at home).

## Nothing runs now. To test again on the build Mac (its ssh alias is in the brief)
- chip-lighting-app (~/matter-bridge-test/light1, port 5641), thermostat-app (thermo/kvs3, 5781), chip-lock-app (lock/, 5661). Stop only ours: `pkill -f "KVS $HOME/matter-bridge-test/"` (other agents run their own lights: never pkill by app name).
- Two matter-server instances (A "Google Home" port 5591, B port 5592) run by ~/matter-bridge-test/servers.sh
  inside a live ssh session (macOS Local Network rule: a detached process gets EHOSTUNREACH). Stop: `touch ~/matter-bridge-test/STOP`.
- Tunnel from this computer: `ssh -f -N -L 15592:127.0.0.1:5592 <build Mac alias from the brief>` (stop: pkill -f "15592:127.0.0.1").
- colima VM (Docker): `colima stop` when done.
