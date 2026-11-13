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

for (const storePkg of ['com.amazon.venezia', 'com.android.vending']) {
  const store = app(storePkg, 'App Store');
  const video = app('com.netflix.ninja', 'Netflix');
  const unknown = app('video.other', 'Other video');
  context.data = { apps: context.sortApps([store, unknown, video]), screens: [], order: null };
  context.expanded = false;
  assert.deepStrictEqual(packages(context.arrangeItems().items), [video.package, unknown.package, storePkg],
    'store follows regular apps in the default order');
  assert(!packages(context.dockList()).includes(storePkg), 'store defaults to More apps');
  context.expanded = true;
  const listed = context.dockList().filter(item => item.package === storePkg);
  assert.equal(listed.length, 1, 'store appears exactly once');
  assert.strictEqual(listed[0], store, 'store is the original app, without a special tile');

  context.renderGrid();
  context.g = packages(context.gridItems).indexOf(storePkg);
  context.holdApp();
  assert.strictEqual(context.menuApp, store, 'hold OK opens the regular app menu');
  assert(context.startMove(), 'store can move out of More apps');
  assert(!context.expanded);
  assert(packages(context.dockList()).includes(storePkg), 'store moves into the dock');
  assert.equal(context.arrangeItems().line, 3, 'store uses a normal dock slot');

  context.startMove();
  context.moveLift(-1, 0);
  assert.deepStrictEqual(packages(context.dockList()).slice(0, 3), [video.package, storePkg, unknown.package],
    'store reorders among ordinary apps');
  context.dropLift();
  assert.equal(context.data.order.packages[1], storePkg, 'saved order includes store');
  context.startMove();
  context.moveLift(0, 1);
  assert(!packages(context.dockList()).includes(storePkg), 'store moves back to More apps');
  context.expanded = true;
  assert(packages(context.dockList()).includes(storePkg));

  context.data.apps = context.sortApps([store, ...Array.from({ length: 15 }, (_, i) => app('video.' + i))]);
  context.data.order = null;
  context.renderGrid();
  context.g = packages(context.gridItems).indexOf(storePkg);
  context.startMove();
  assert.equal(context.dockList().length, 12, 'adding store to a full dock preserves one row');
  assert.equal(context.arrangeItems().line, 10);
  assert(packages(context.dockList()).includes(storePkg));
  assert.equal(context.arrangeItems().items.length, 16, 'displaced app remains available');

  context.HIDDEN_TV = [storePkg];
  context.expanded = true;
  assert(!packages(context.dockList()).includes(storePkg), 'store respects hidden-app settings');
  context.HIDDEN_TV = [];
}
context.data = { apps: [app('com.netflix.ninja')], screens: [], order: null };
assert(!packages(context.dockList()).some(pkg => context.TUCKED.includes(pkg)), 'no synthetic store');
console.log('App Store ordering and movement tests passed.');
