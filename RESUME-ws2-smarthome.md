# Resume: ws2-smarthome (widget swarm round 2, smart home group)

Brief: coord/swarm2-common.md (group smarthome), coord/resume-builder-brief.md. Kinds: aircon, controls, camera, doorbell, sensor, energy, solar, battery, speakers, scenes, bins.
Last review: coord/fable-1121-ws2-smarthome-partial.md (NO-GO, partial). Every finding there is fixed on this branch (21 Nov), see below.

## Done (committed on ws2-smarthome)
- Round 2 work (348f99c): every setting of the 11 kinds wired and pre:true; device pick lists on the TV and phone; Home Assistant's own aircon unit.
- Fable 21 Nov fixes:
  1. Owner's rule: locks, alarms, garage doors and gates never show on the TV. A garage door by its id (cover/switch/script/scene named garage, gate, door, lock, alarm) is never kept (bridge parse, Android parse, home-config.py), never listed in Smart home's tick list (pickable, both sides), and the page leaves it out of every list too (smarthome.js houseSafe: info, devices pick lists, the phone; widgets.js houseSafe: Control Centre widget and OK layer, Scenes). A blind Home Assistant calls a garage door, gate or door reads "blocked": the page then hides it everywhere. "set" still refuses all of them.
  2. Scenes and scripts: named for an opener are never kept or listed; a scene whose entity_id attribute sets a lock, an alarm panel or an opener cover is never listed (pickable) and never run ("scene" refused), bridge and Android.
  3. home-config.py: nl-haqr's own lines applied byte for byte (matches anywhere in the id, scenes too).
  4. bridge unit: a failed /api/config read is no longer kept; asked again.
  5. Stale picks: a tick list keeps only ids still offered (app.js); Control Centre, Speakers and Scenes all fall back to every one when no pick is still there (widgets.js pickedOf).
  6. Batteries layer uses the widget's Red below (5 to 50, else 20).
  7. Sun clock hint: "Hold OK, then Edit on the TV, then Place".
  8. Android tests for haUnit (asked once, failure asked again, odd unit none) and for scenes and openers.
  9. Sensor heading test types "Tank" and checks "Rain gauge" is gone; the phone now changes energy and doorbell headings and the aircon room (checked on the TV).
  10. "Leaving" is tested for all 11 kinds (TV list and phone).
- Words: controls help and steps say locks, alarms, garage doors and gates never show on Couch TV; scenes help says the same and that a script does what it was built to do.
- Re-check fixes (coord message 21 Nov, NO-GO at e969815), all done:
  1. One token-aware house test in every copy (bridge/smarthome.py OPENS_HOUSE, HaReadings.kt OPENS_HOUSE which HomeAssistant.kt uses, home-config.py with ^$, smarthome.js and widgets.js as a lookbehind-free opensHouse() function): garage, gate (not gateway), door (not doorbell, not after in/out), lock (not clock or block), alarm, disarm. tests/fixtures/opens_house_ids.json: 52 refuse, 32 pass (Fable's 51 and the haqr checker's 49, doorbell_relay now passes); tests/test_opens_house.js runs it on the two JS copies, the bridge and home-config.py (343 checks); HomeAssistantTest, test_smarthome_bridge.py, test_ha_widgets_config.py and test_ws2_smarthome.mjs run it too.
  2. Home Assistant's friendly name: domain + "." + slug(name) goes through the same test: pickable skips it, control() sets blocked for cover/switch, the scene action reads the state (scripts too) and refuses. Names in other languages are not caught.
  3. A scene whose blind or switch cannot be read runs nothing ("failed"); members' names count too.
  4. Smart home, Lights and Scenes groups: an info row says what is left out (English: this screen has no other language block on this branch).
  5. pickable: binary_sensor door, garage_door, lock, opening, window never listed; a sensor with no unit whose "switch." + id fails the test never listed; doorbells stay.
  6. "group." members make a scene refused.
  7. control() sets blocked before the not-answering return; a blocked one is remembered, so "set" refuses it; the bridge's info() drops it. (Android info() lives in nl-haqr's moved file: add the same filter there at merge, see below; the page already drops it, smarthome.js OPENERS.)
  9. test_widget_detail_browser counts one check on every path. 10. widget-detail.js comment indent.

## Merge notes
- nl-haqr (trial merge in a scratch worktree, then removed): conflicts in bridge/smarthome.py, tv-home/tools/home-config.py, HomeAssistant.kt (the OPENS_HOUSE lines: take this branch's; keep nl-haqr's REFUSED_WAIT line), tests/test_ha_widgets_config.py (keep both sides), docs/CONFIG.md (take this branch's two table rows, nl-haqr's paragraph). Resolved that way (scratchpad/ws2sh-resolve.py), everything passed: Android tv-home app.couchtv.ha HomeAssistantTest 22, HaReadingsTest 15, HaSignInTest 11, HaPhoneTest 5, HaRealTest 1 skipped; on-tv unit tests all passed; pytest smarthome_bridge + ha_widgets_config + ha_phone_bridge 32; test_opens_house.js 343.
- After the nl-haqr merge: add "self.unit = None" to keep_sign_in and keep_picks in bridge/smarthome.py; in HomeAssistant.kt info(ctx) use names(s.controls.filter { readControls[it.entity] != true }).
- Other branches: see the Fable review's merge notes (widget-caps.js, app.js wsOptions, nl-remote English lines; the new Smart home row is English only).

## Tests (all green, 21 Nov, at ca013e4 and the final commit)
- node: test_opens_house.js 343, test_ws_schema.js 3760, test_widget_caps.js 4548, test_ha_token_never_leaves.js 28, test_design_widgets.js 221, test_design_sections.js passed.
- pytest tests/test_smarthome_bridge.py tests/test_ha_widgets_config.py: 20 passed.
- Android (scratchpad/ws2sh-gradle.sh, gradle lock): HomeAssistantTest 22, HaReadingsTest 15.
- Browser (scratchpad/smarthome-run.sh under browser.lock, logs scratchpad/smarthome-results/): test_ws2_smarthome 238, test_smart_widgets_browser 56, test_widget_detail_browser 296, test_widget_fit_all 8 (1640 boxes, 0 problems), test_design_settings_browser 107, test_phone_settings_browser 129, test_integrations_browser 34, test_ws_tv 1115.
- In browser tests press Back slowly: five Back presses within 4 s switch a design off (design.js escapeDesign).

## Left
- Nothing in scope. No real Home Assistant was used (mock.js ?ha=1 and the test fakes). Nothing running on the MacBook or an emulator.
