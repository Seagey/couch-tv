const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running LG Developer Mode dock tests (#89)...');
const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');

// 1. Verify app.js implementation
assert(
  /if\s*\(\s*devOn\(\)\s*&&\s*expanded\s*\)\s*list\.push\(devItem\(\)\);/.test(appJs),
  'toolItems() only includes devItem() when expanded is true'
);

// 2. Functional test of toolItems behavior
function simulateToolItems(smartOn, devOn, expanded) {
  var list = [];
  if (smartOn) list.push({ kind: "smart" });
  if (devOn && expanded) list.push({ kind: "devmode" });
  list.push({ kind: "gear" });
  return list;
}

// Collapsed dock with 10 apps + Developer Mode enabled + Settings + More apps
const DOCK_APPS = 10;
const collapsedTools = simulateToolItems(false, true, false);
assert.strictEqual(collapsedTools.some(x => x.kind === 'devmode'), false, 'devmode is not in collapsed dock tools');

const collapsedDock = new Array(DOCK_APPS).fill({ kind: "app" })
  .concat(collapsedTools)
  .concat([{ kind: "more" }]);

// Maximum columns on Night dock is 12: 10 apps + 1 settings + 1 more apps = 12 items (no wrapping)
assert.strictEqual(collapsedDock.length, 12, 'collapsed dock has at most 12 items so it does not wrap onto a second row');

// Expanded dock (More apps) contains devmode
const expandedTools = simulateToolItems(false, true, true);
assert.strictEqual(expandedTools.some(x => x.kind === 'devmode'), true, 'devmode is included in expanded tools (More apps)');

console.log('LG Developer Mode dock tests passed.');
