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

## Merge notes
- nl-haqr: trial merge (git merge-tree HEAD nl-haqr) is clean for every code and test file; HomeAssistant.kt, HaReadings.kt and HomeAssistantTest.kt follow the rename to tv-home/android/shared (the OPENS_HOUSE lines, the two HomeAssistantTest lines and home-config.py are byte for byte nl-haqr's). Only docs/CONFIG.md conflicts (the scenes and controls rows of the table): take this branch's two rows (a garage door "never shows", not "is shown but never switched"), keep nl-haqr's paragraph.
- After the nl-haqr merge: add "self.unit = None" to keep_sign_in and keep_picks in bridge/smarthome.py (they clear limits there).
- Other branches: see the Fable review's merge notes (widget-caps.js, app.js wsOptions, nl-remote English lines).

## Tests (all green, 21 Nov, at 20f7792 plus this notes commit)
- node: test_ws_schema.js 3760, test_widget_caps.js 4548, test_ha_token_never_leaves.js 28, test_design_widgets.js 221, test_design_sections.js passed.
- pytest tests/test_smarthome_bridge.py tests/test_ha_widgets_config.py: 15 passed.
- Android (scratchpad/ws2sh-gradle.sh, gradle lock): HomeAssistantTest 18 (6 new), HaReadingsTest 15, BUILD SUCCESSFUL.
- Trial merge with nl-haqr 5964f11 in a scratch worktree (removed after): tv-home app.couchtv.ha HomeAssistantTest 18, HaReadingsTest 15, HaSignInTest 11, HaPhoneTest 5, HaRealTest 1 skipped; on-tv testDebugUnitTest all passed; pytest smarthome_bridge + ha_widgets_config + ha_phone_bridge 27 passed. nl-haqr since moved to a0d4474 (no change to HomeAssistant.kt, HaReadings.kt or smarthome.py); merge-tree still conflicts only in docs/CONFIG.md.
- Browser (scratchpad/smarthome-run.sh under browser.lock, logs scratchpad/smarthome-results/): test_ws2_smarthome 236, test_smart_widgets_browser 56, test_widget_detail_browser 296, test_widget_fit_all 8 (1640 boxes, 0 problems), test_design_settings_browser 107, test_phone_settings_browser 129, test_integrations_browser 34, test_ws_tv 1115.
- In browser tests press Back slowly: five Back presses within 4 s switch a design off (design.js escapeDesign).

## Left
- Nothing in scope. No real Home Assistant was used (mock.js ?ha=1 and the test fakes). Nothing running on the MacBook or an emulator.
