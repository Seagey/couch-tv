const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../tv-home/web/app.js'), 'utf8');

const context = {
  data: { apps: [], screens: [], order: null }, expanded: false,
  STANDALONE: false, NIGHT: true, HIDDEN_TV: [], g: 0, lift: null,
  gridItems: [], gridEls: Array(12), hintFlash: '',
  resolveInputs: () => [], toolItems: () => [{ kind: 'gear' }],
  moreItem: () => ({ kind: 'more' }), t: key => key,
  renderGrid() { context.gridItems = context.dockList(); },
  paintFocus() {}, persistOrder() {}, flash() {},
  openAppMenu(app) { context.menuApp = app; }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  var APP_ORDER ='), source.indexOf('  var HOLD_MS =')), context);
for (const name of ['sortApps', 'tucked', 'shownApps', 'arrangeItems', 'dockList', 'materialise', 'nameOf', 'holdApp', 'startMove', 'moveLift', 'dropLift']) {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0, 'function exists: ' + name);
  const firstLine = source.slice(start, source.indexOf('\n', start)).trimEnd();
  const body = firstLine.endsWith('}') ? firstLine : source.slice(start, source.indexOf('\n  }', start) + 4);
  vm.runInContext(body, context);
}

const app = (pkg, name = pkg) => ({ kind: 'app', package: pkg, name });
const packages = items => Array.from(items, item => item.package);

// Audible app on Fire TV
const audiblePkg = 'com.audible.application.firetv';
const audible = app(audiblePkg, 'Audible');
const netflix = app('com.netflix.ninja', 'Netflix');
const youtube = app('com.amazon.firetv.youtube', 'YouTube');
const prime = app('com.amazon.amazonvideo.livingroom', 'Prime Video');

// 1. Initial discovery and default sort
context.data = { apps: context.sortApps([prime, audible, netflix, youtube]), screens: [], order: null };
context.expanded = false;

// Audible is sorted with ordinary apps
const allSorted = packages(context.arrangeItems().items);
assert(allSorted.includes(audiblePkg), 'Audible is in the arranged app items');

// 2. Audible can be placed in the dock via saved order
context.data.order = { packages: [netflix.package, audiblePkg, prime.package, youtube.package], line: 3, saved: true };
const dock = packages(context.dockList());
assert(dock.includes(audiblePkg), 'Audible appears in dock when ordered');
assert.equal(dock[1], audiblePkg, 'Audible is in second position in dock');
assert.equal(context.arrangeItems().line, 3, 'Dock line is 3');

// 3. Reordering Audible in dock
context.renderGrid();
context.g = packages(context.gridItems).indexOf(audiblePkg);
assert(context.holdApp(), 'Audible can be picked up');
assert(context.startMove(), 'Audible can be moved');
context.moveLift(-1, 0); // move left
assert.equal(packages(context.dockList())[0], audiblePkg, 'Audible moves to first position');
context.dropLift();
assert.equal(context.data.order.packages[0], audiblePkg, 'Audible saved in first position');

console.log('Audible dock ordering and movement tests passed.');
