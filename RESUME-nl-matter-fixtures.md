# Resume: nl-matter-fixtures (Matter test kit)

Task: virtual Matter devices on the MacBook, a contract test that runs against any implementation of
the Matter API, docs/MATTER-TESTING.md, and a "Test kit" section at the bottom of the contract file
(coord/matter-contract.md, the live copy).

## Status: test kit done and committed (8a8c089, eac44ae, 9621b8a and the last commit, 21 Nov 2026)

Coordinator fixes done: `fx fabrics <name>` answers {name, fabrics} again (no name: {devices: [...]}),
the harness reads both (fabrics_of); one-run-at-a-time lock (~/matter-fixtures.lock via `fx lock/unlock`,
harness waits up to --lock-wait 900 s, exit 3 when held, always unlocks, `fx unlock --force` after a dead run);
tests/matter/fixtures/private-copy.py + docs (One run at a time, or a private copy). Proof:
tests/test_matter_fixtures.py 10/10 OK; reference run 7 with the lock 261/0/0 (231 s); live second run
refused with exit 3. fx.py, private-copy.py and reference_server.py are deployed to ~/matter-fixtures.
A trial private copy sits in ~/mf-copy-check on the MacBook (not started; harmless).

Checker NO-GO at 6b82489 fixed (contract changes 13 and 14): light attributes may be missing only while off
and are checked while on; `already` only; reason keys (ready, not_allowed, address with <host>:1 and [fe80::1],
remove while offline with --remove-offline, rename of the plug to "Garage door" -> opens_house); device, removed,
version required; kept lock/alarm fabric FAIL; friendly_name, colour range, supported_color_modes, switch on/off,
rename name, device_ids [] and note on errors, contact on/off + reading, failed commission over 35 s WARN;
lock gap closed; fx chip-tool.lock stale by pid or 400 s; fx status "host"; private-copy name rule.
Reference server updated to match. Proof: unit tests 15/15; reference run 10 315/0/0; run 8 (--remove-offline) 314/0/0.
Change 15 (checker GO on 2a95557, then): busy while a commission runs (409/400, under 5 s), reason on every refusal
(commission errors, already, command, rename, remove), lock answer over 120 s = WARN, link local as [fe80::1]:5540,
hs_color, cover level, target_temp_step, hvac_action. Reference updated. Unit tests 15/15; reference run 12 343/0/0.

Left: run the harness against nl-matter-bridge once that branch has a final (non WIP) commit.
How: `git -C <bridge worktree> archive <commit> bridge scripts config.example.json | ssh macbook 'tar -x -C ~/mf-bridge'`
(~/mf-bridge already has .venv with bridge/requirements.txt, matter-server 1.6.0 installed by
scripts/matter-setup.sh, and config.json: port 5495, pairing_key mf_contract_test_key, matter test_devices true);
start it inside a live ssh session (run_in_background):
`ssh macbook 'cd ~/mf-bridge && exec .venv/bin/python bridge/server.py >> /tmp/mf-bridge.log 2>&1'`;
then `python3 tests/matter_contract.py --api http://<macbook-ip>:5495 --token mf_contract_test_key --report <scratchpad>/mf-bridge-runN.json`;
stop with `ssh macbook 'pkill -f mf-bridge/'`. Check `fx fabrics` is all 1 first (the bridge agent runs the
same harness against its own bridge on port 8796; never run at the same time).
Bridge WIP 0001e84, the bridge agent's own run (scratchpad nl-matter-bridge-live/run1.txt): 255 pass / 4 fail / 2 warn
(already answered unreachable; light brightness and color_temp_kelvin missing while off; offline never unavailable).
Earlier results: reference run 6 261/0/0, negative control 241/20/2, build-fixtures exit 0, Test kit appended to
coord/matter-contract.md. Note for the coordinator: the scratchpad copy of matter-contract.md has
changes 10 to 12 that coord/matter-contract.md lacks; the harness already accepts `not_allowed`
and `already` from them.

Running on the MacBook now: the 8 fixture devices only (leave them running). No reference server,
no chip-tool interactive server (both stopped). The deployed ~/matter-fixtures/reference_server.py
and build-fixtures.sh match this branch. No lock held.

- MacBook builds (in ~/matter-spike/connectedhomeip/out): darwin-arm64-chip-tool-no-ble,
  all-devices-no-ble, thermostat-no-ble, lock-no-ble (+ the spike's darwin-arm64-light); chef window
  covering in ~/matter-spike/chef-bin/ (needs a guard in examples/chef/common/FakeAttributeAccess.cpp,
  applied by tests/matter/fixtures/build-fixtures.sh). build-fixtures.sh checked on 21 Nov: exit 0,
  13 s incremental (no work to do).
- tests/matter/fixtures/fx.py + fx (deployed to the MacBook in matter-fixtures/): start, stop, status, home, up,
  share, revoke, wrongcode, read, do, pipe, fabrics, evict, log, reset, codes. All 8 devices run and are in the
  "home" fabric, each on 1 fabric. They are left running for the other Matter builders.
- tests/matter_contract.py: 16 groups, now also `already` (light shared twice) and `not_allowed`
  (lock and alarm). tests/matter/reference_server.py answers both.
- Run 6 against the reference (clean restart, --reset): 261 pass / 0 fail / 0 warn.
- Negative control (--break cover-percent,lock-listed,no-live,raw-errors): 241 pass / 20 fail / 2 warn,
  every bug caught (table in docs/MATTER-TESTING.md).
- "Test kit" section appended to coord/matter-contract.md; counts in docs/MATTER-TESTING.md.
- Reference server and its chip-tool interactive server are stopped.

## If someone needs to run it again
1. `ssh macbook matter-fixtures/fx status` (all running, in_home). If not: `ssh macbook matter-fixtures/fx up`.
2. Reference: `ssh macbook 'nohup ~/matter-spike/connectedhomeip/.environment/pigweed-venv/bin/python3 ~/matter-fixtures/reference_server.py --port 5490 --token test --reset > /tmp/mf-ref-server.log 2>&1 < /dev/null &'`
3. `python3 tests/matter_contract.py --api http://<macbook-ip>:5490 --token test` (about 4 min).
4. Stop: `ssh macbook 'pkill -f matter-fixtures/reference_server.py; pkill -f "chip-tool interactive server --port 9010"'`.
5. After a run that stopped half way: `ssh macbook matter-fixtures/fx evict`.

## Devices (MacBook <macbook-ip>, passcode 20202021 for all)
| name | port | discriminator | factory code | home node |
|---|---|---|---|---|
| light | 5541 | 321 | 01693312333 | 101 |
| plug | 5542 | 578 | 03331712331 | 102 |
| thermostat | 5543 | 835 | 04970112335 | 103 |
| cover | 5544 | 1092 | 10054912339 | 104 |
| fan | 5545 | 1349 | 11693312331 | 105 |
| sensors (temp 1, humidity 2, contact 3, occupancy 4) | 5546 | 1606 | 13331712334 | 106 |
| lock | 5547 | 1863 | 14970112338 | 107 |
| alarm (smoke/CO) | 5548 | 2120 | 20054912334 | 108 |
