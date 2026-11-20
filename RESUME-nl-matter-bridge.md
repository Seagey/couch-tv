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

## 21 Nov: fixing the Fable NO-GO list (coord/fable-1121-nl-matter-bridge.md, 15 items). STATE: WIP, TESTS NOT RUN YET
Code written (uncommitted work moved into the WIP commit), none of it run yet:
- bridge/matter.py: new Matter class (spliced from scratchpad nl-matter-bridge-fix/class.py). Items 1-4, 6-13, 15 coded:
  unix socket only (`--listen-address <sock>`, short private dir via short_private_dir(), aiohttp.UnixConnector,
  `--disable-ota --disable-thread-diagnostics`, no TCP port, config "server"/"port" ignored with a warning: item 4, 7, 15);
  OPENS_HOUSE whole words in 13 languages + hidden_by_name on cover/switch/on-off-only light, rename refuses
  (reason opens_house), remove by node id even when hidden (_node_of) (items 3, 6); commission leaves anything
  devices_of() shows nothing for -> not_allowed, reason blocked|unsupported (item 2); address_problem(): port other than
  5540 -> reason port, fe80 -> link_local, discovery_timeout_s 30 on commission_on_network (item 8); remove of an
  offline/unanswering device -> ok + reason offline|not_answering + note, matter-forgotten.json (600), left again on
  next connect (item 9); xy_to_hs (item 10); tidy_name on device names (item 11); async _end_leftover (/proc or ps),
  already() skips the 2.5 s wait, pid file removed on stop (item 12); answer() reason keys off/not_installed/
  node_missing/node_old/starting/stopped (item 13); _trim_log + _log_loop every 60 s (item 14 part).
- bridge/server.py: push_matter only to matter_clients (item 1). bridge/API.md updated (item 1).
- tests/test_matter_bridge.py rewritten (fake service on a unix socket, ProcessTest with tests/fixtures/fake_matter_service.py).

## Next steps (exact)
1. Run `<repo>/.venv/bin/python -m unittest discover -s tests -p "test_matter_bridge.py"` in the worktree; fix failures.
   Then the full suite `-p "test_*.py"` (was 1363 OK, 58 skipped).
2. Still left, not started: item 5 (launchd on the MacBook: bootstrap bridge/examples/couch-tv-bridge.plist.example
   with this branch's bridge, share the light with `~/matter-fixtures/fx share light`, add it, write the real result
   into docs/MATTER.md, boot it out, remove the plist); item 14 docs (CONFIG.md matter section, AGENTS.md ~line 468
   "Matter ... shows once it is added to Home Assistant" is stale, docs/DOCKER.md Matter section, MATTER.md: socket,
   no port/server options, address rules, reason keys, name rule languages, log trimming); item 13: tell the
   coordinator `not_allowed` (+ reasons) for coord/matter-contract.md; the "Also" line: live fan, cover and sensors
   against the fixtures (`fx share fan|cover|sensors`, never `fx evict`, `fx revoke` after), and try
   `npm ci --omit=optional` (scripts/matter-setup.sh) on the MacBook.
3. A real share from the Google Home or Apple Home app and a real Thread device need the owner at home: that is the
   one thing that cannot be done in an agent run.
Nothing is running: no launchd job was loaded, no lock held, nothing started on the MacBook in this session.

## Nothing runs now. To test again on the build Mac (its ssh alias is in the brief)
- chip-lighting-app (~/matter-bridge-test/light1, port 5641), thermostat-app (thermo/kvs3, 5781), chip-lock-app (lock/, 5661). Stop only ours: `pkill -f "KVS $HOME/matter-bridge-test/"` (other agents run their own lights: never pkill by app name).
- Two matter-server instances (A "Google Home" port 5591, B port 5592) run by ~/matter-bridge-test/servers.sh
  inside a live ssh session (macOS Local Network rule: a detached process gets EHOSTUNREACH). Stop: `touch ~/matter-bridge-test/STOP`.
- Tunnel from this computer: `ssh -f -N -L 15592:127.0.0.1:5592 <build Mac alias from the brief>` (stop: pkill -f "15592:127.0.0.1").
- colima VM (Docker): `colima stop` when done.
