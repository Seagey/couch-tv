# RESUME: nl-matter-bridge (builder "matter-bridge")

Read first: coord/nolater-common.md and coord/matter-contract.md (changes 1 to 13).

## Done
- bridge/matter.py: the bridge's Matter controller. Starts the Open Home Foundation Matter Server
  (npm matter-server 1.6.0, matter.js; pinned in bridge/matter/package-lock.json) as its own service,
  on a unix socket only (bridge/data/matter/ws.sock, or a short private folder when that path is
  over 100 bytes), never a network port; `--disable-dashboard --disable-ota --disable-thread-diagnostics`.
  Device model with HA attribute names; locks, alarms, garage doors filtered; the name rule (whole
  words, 13 languages) on blinds, plugs and on/off only lights; commands; commission errors
  wrong_code/expired/unreachable/thread/already/not_allowed (+reason); address rules (port 5540 only,
  no fe80); rename (refuses a name that would hide the device); remove (whole node, offline device
  forgotten anyway, matter-forgotten.json, left again later); liveness probe (unavailable within
  about 70 s, contract change 13); reason keys for not ready; log trimmed every minute.
- bridge/server.py (shared file) hunks: `import matter`; block after h_ha_forget (push_matter only to
  /api/matter/events listeners, never /api/events; matter_clients; 6 handlers, all @tv_or_paired);
  6 routes after /api/ha/direct; `await MATTER.start()` in on_startup; `await MATTER.stop()` in on_cleanup.
- scripts/matter-setup.sh (`--omit=optional` plus @matter/nodejs put back), docs/MATTER.md,
  docs/CONFIG.md (Matter section), docs/DOCKER.md (Matter in Docker), AGENTS.md (Matter needs no HA),
  bridge/API.md, tests/test_matter_bridge.py (31 tests), tests/fixtures/fake_matter_service.py,
  tests/fixtures/matter-light-node.json.
- Fable NO-GO (coord/fable-1121-nl-matter-bridge.md): items 1-4 and 6-15 fixed and tested. Item 5
  (launchd) NOT done: see below.

## Test results (21 Nov)
- `<repo>/.venv/bin/python -m unittest discover -s tests -p "test_matter_bridge.py"`: 31/31 OK.
- Full suite `-p "test_*.py"`: see the final report / commit message.
- Contract harness (wt-nl-matter-fixtures tests/matter_contract.py) against this bridge on the
  MacBook (~/mb-nlb, port 8796, test_devices on): run 1 (WIP 0001e84) 255 pass / 4 fail / 2 warn;
  the four fails and two warns were fixed (already, light attrs, unavailable probe, leave only once
  connected). Later runs: see the commit message and the final report.
- SIGTERM to the bridge (what `launchctl bootout` sends): the Matter service ended, pid file removed.

## Not done, and why
- Item 5, the bridge as a launchd job adding a device: `launchctl bootstrap` on the MacBook was refused
  by this session's permission classifier (twice: once with the plist in ~/Library/LaunchAgents, once
  with it in ~/mb-nlb). Needs the owner to allow it, or to run it: copy
  bridge/examples/couch-tv-bridge.plist.example with the REPLACE paths set, bootstrap, `fx share light`,
  add it from the phone page or POST /api/matter/commission, write the result into docs/MATTER.md
  ("Mac: the bridge as a launchd service"), then bootout and delete the plist.
- A real share from the Google Home or Apple Home app, and a real Thread device: these need the
  owner at home with his phone and his own devices. An agent cannot do them.

## How to run it again (MacBook)
- Copy: `rsync -a --exclude .git --exclude node_modules --exclude bridge/data <worktree>/ macbook:mb-nlb/`,
  config.json there is a test one (port 8796, a random pairing key; the key is in the scratchpad
  nl-matter-bridge-live/token, never commit it). `.venv` made with `uv venv --python 3.11`.
- Start: `ssh macbook 'cd ~/mb-nlb; export PATH=/opt/homebrew/bin:/usr/bin:/bin; exec .venv/bin/python bridge/server.py'`
  (in the background). Stop: find the pid with `lsof -tiTCP:8796 -sTCP:LISTEN` and `kill -TERM` it
  (its command line is relative, so `pkill -f mb-nlb/` does not match it).
- Check `fx fabrics <name>` is 1 for all eight first; never run at the same time as the fixtures
  agent's run on ~/mf-bridge (port 5495).
- Harness: `MATTER_TOKEN=<key> python3 tests/matter_contract.py --api http://<macbook ip>:8796`.
