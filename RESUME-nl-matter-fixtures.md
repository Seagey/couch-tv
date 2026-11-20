# Resume: nl-matter-fixtures (Matter test kit)

Task: virtual Matter devices on the MacBook, a contract test that runs against any implementation of
the Matter API, docs/MATTER-TESTING.md, and a "Test kit" section at the bottom of the contract file
(matter-contract.md in the coordinator's scratchpad).

## Done
- MacBook builds (in ~/matter-spike/connectedhomeip/out): darwin-arm64-chip-tool-no-ble,
  all-devices-no-ble, thermostat-no-ble, lock-no-ble (+ the spike's darwin-arm64-light); chef window
  covering in ~/matter-spike/chef-bin/ (needs a guard in examples/chef/common/FakeAttributeAccess.cpp,
  applied by tests/matter/fixtures/build-fixtures.sh).
- tests/matter/fixtures/fx.py + fx (deployed to the MacBook in matter-fixtures/): start, stop, status, home, up,
  share, revoke, wrongcode, read, do, pipe, fabrics, evict, log, reset, codes. All 8 devices run and are in the
  "home" fabric (multi-admin share proven: a second controller joined, fabrics went 1 -> 2 -> 1).
- tests/matter_contract.py: 16 groups. tests/matter/reference_server.py: chip-tool reference API
  (with --break switches for negative control).
- Run 3 against the reference: 248 pass / 3 fail; run 4: 230 pass / 1 fail (a chip-tool storage race in fx, now retried). Run 5 next,
  with the fixed fx.py and reference (deployed to the MacBook).
- docs/MATTER-TESTING.md written.

## Left (next steps)
1. Read run 4 results (the run log); fix anything left until 0 FAIL against the reference.
2. Negative control: restart the reference with `--break cover-percent,lock-listed,no-live,raw-errors`
   and run the harness; it must FAIL on each of those (record counts).
3. Check build-fixtures.sh runs on the MacBook (stop the cover first: `fx stop cover`, then `fx start cover`).
4. Append "Test kit" section to the bottom of matter-contract.md; put the proven counts into docs/MATTER-TESTING.md.
5. Commit (not WIP), stop the reference server (`ssh macbook pkill -f reference_server.py; pkill -f "chip-tool interactive server"`), report.

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

Start: `ssh macbook matter-fixtures/fx up`. Stop: `ssh macbook matter-fixtures/fx stop`.
Wipe: `ssh macbook matter-fixtures/fx reset`. Shared code: `ssh macbook matter-fixtures/fx share light`.
Clean leftover controllers: `ssh macbook matter-fixtures/fx evict`.
Reference server: `ssh macbook ~/matter-spike/connectedhomeip/.environment/pigweed-venv/bin/python3 ~/matter-fixtures/reference_server.py --port 5490 --token test --reset`
Test: `python3 tests/matter_contract.py --api http://<macbook-ip>:5490 --token test`
