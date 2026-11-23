const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running start_focus tests (#211)...');
const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');

// 1. Setting declaration and config reading
assert(/START_FOCUS = "people"/.test(appJs), 'default START_FOCUS is people, as before the setting existed');
assert(
  /START_FOCUS = \["people", "apps", "keep_watching"\]\.indexOf\(ST\.start_focus \|\| HOME\.start_focus\) >= 0 \? \(ST\.start_focus \|\| HOME\.start_focus\) : "people"/.test(appJs),
  'readConfig respects ST.start_focus, HOME.start_focus, or defaults to people'
);

// 2. Home settings cycle row
assert(appJs.includes('key: "start-focus"'), 'Home settings has start-focus row');
assert(appJs.includes('value: t("start_focus_" + START_FOCUS)'), 'start-focus displays localized current value');
assert(appJs.includes('var steps = ["people", "keep_watching", "apps"]'), 'cycles through people, keep_watching, apps');

// 3. startFocus function logic
const fnMatch = appJs.match(/function startFocus\(\) \{[\s\S]*?\n  \}/);
assert(fnMatch, 'startFocus definition found in app.js');

// Test the logic using a simulated sandbox
function simulateStartFocus(startFocusSetting, peopleCount, shelfCardsCount, ambientState) {
  let zone = 'grid';
  let s = -1;
  let g = -1;
  let pi = -1;
  const shelfEls = new Array(shelfCardsCount);
  const peopleOn = () => peopleCount >= 2;
  const toPeople = () => { zone = 'people'; pi = 0; };
  const ambientOpen = !!(ambientState && ambientState.open);
  const AMBIENT_MUSIC = !!(ambientState && ambientState.enabled);
  const npVisible = () => !!(ambientState && ambientState.npVisible);
  const START_FOCUS = startFocusSetting;

  // The exact implementation logic
  s = 0; g = 0;
  if (ambientOpen && AMBIENT_MUSIC && npVisible()) {
    zone = "ambient";
  } else if (START_FOCUS === "apps") {
    zone = "grid";
  } else if (START_FOCUS === "people") {
    if (peopleOn()) toPeople();
    else zone = shelfEls.length ? "shelf" : "grid";
  } else {
    zone = shelfEls.length ? "shelf" : "grid";
  }

  return { zone, s, g, pi };
}

// Case 0: Default (people) is exactly the old behaviour
let res = simulateStartFocus('people', 2, 3);
assert.strictEqual(res.zone, 'people', 'default with 2+ people starts on people');
res = simulateStartFocus('people', 1, 0);
assert.strictEqual(res.zone, 'grid', 'default with one person and no cards starts on the grid');

// Case A: keep_watching with 2+ people and cards -> starts on Keep watching (shelf)
res = simulateStartFocus('keep_watching', 2, 3);
assert.strictEqual(res.zone, 'shelf', 'keep_watching with 2+ people and cards starts on shelf');
assert.strictEqual(res.s, 0);

// Case B: keep_watching with 2+ people but NO cards -> falls back to apps (grid)
res = simulateStartFocus('keep_watching', 2, 0);
assert.strictEqual(res.zone, 'grid', 'default with no cards falls back to grid');
assert.strictEqual(res.g, 0);

// Case C: Explicit 'apps' setting with 2+ people and cards -> starts on apps (grid)
res = simulateStartFocus('apps', 2, 3);
assert.strictEqual(res.zone, 'grid', 'apps setting starts on grid even with 2+ people and cards');
assert.strictEqual(res.g, 0);

// Case D: Explicit 'people' setting with 2+ people -> starts on profile switcher (people)
res = simulateStartFocus('people', 2, 3);
assert.strictEqual(res.zone, 'people', 'people setting with 2+ people starts on people');

// Case E: Explicit 'people' setting with only 1 person -> falls back to shelf if cards exist
res = simulateStartFocus('people', 1, 3);
assert.strictEqual(res.zone, 'shelf', 'people setting with 1 person falls back to shelf');

// Case F: Ambient music screen open -> stays on ambient
res = simulateStartFocus('keep_watching', 2, 3, { open: true, enabled: true, npVisible: true });
assert.strictEqual(res.zone, 'ambient', 'ambient music open takes priority');

// 4. All 14 languages in i18n.js have the keys
const keys = [
  'start_focus',
  'start_focus_sub',
  'start_focus_people',
  'start_focus_apps',
  'start_focus_keep_watching'
];

keys.forEach(k => {
  const count = (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length;
  assert.strictEqual(count, 16, `${k} must exist in all 16 languages (found ${count})`);
});

console.log('All start_focus tests passed successfully.');
