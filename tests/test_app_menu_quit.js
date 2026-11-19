// Hold OK on a dock tile: Restart app and Quit app (issue #214). Offered only with the bridge, which force stops.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../tv-home/web/app.js'), 'utf8');

function pull(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert(start >= 0, 'function exists: ' + name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

function setup({ OFFLINE = false, PREVIEW = false, bridge = true, api = () => Promise.resolve({ ok: true }) } = {}) {
  const calls = { flash: [], api: [] };
  const context = {
    TV: { uninstall() {}, appInfo() {} }, OFFLINE, PREVIEW, data: { bridge }, zone: 'grid', hintFlash: '',
    t: (key, vars) => key + (vars ? ':' + vars.name : ''),
    flash: text => calls.flash.push(text),
    setTimeout, paintFocus() {}, renderAppMenu() {}, closeAppMenu() {},
    api: (...args) => { calls.api.push(JSON.stringify(args.slice(0, 3))); return api(...args); }
  };
  vm.createContext(context);
  vm.runInContext('var amI = 0, amItems = [], amApp = null;', context);
  for (const name of ['openAppMenu', 'bridgeCanStop', 'stopApp', 'doAppMenu']) vm.runInContext(pull(name), context);
  return { context, calls };
}

const acts = c => Array.from(c.amItems, i => i.act);
const app = { kind: 'app', package: 'com.netflix.ninja', name: 'Netflix' };
const later = () => new Promise(r => setImmediate(r));
const choose = (context, act) => { context.amI = acts(context).indexOf(act); context.doAppMenu(); };

(async () => {
  // With the bridge, Restart and Quit sit above Uninstall
  let s = setup();
  s.context.openAppMenu(app);
  assert.deepStrictEqual(acts(s.context), ['move', 'hide', 'restart', 'quit', 'uninstall', 'info']);

  // ... and are left out where nothing could really stop the app
  for (const opts of [{ OFFLINE: true }, { bridge: false }, { PREVIEW: true }]) {
    s = setup(opts);
    s.context.openAppMenu(app);
    assert.deepStrictEqual(acts(s.context), ['move', 'hide', 'uninstall', 'info'], JSON.stringify(opts));
  }
  s = setup();
  s.context.openAppMenu({ kind: 'app', package: 'app.couchtv.launcher', name: 'couch-tv' });
  assert.deepStrictEqual(acts(s.context), ['move', 'hide', 'uninstall', 'info']);

  // Quit: the bridge is asked, and the TV says so when it is done
  s = setup();
  s.context.openAppMenu(app); choose(s.context, 'quit');
  assert.deepStrictEqual(s.calls.flash, []);
  await later();
  assert.deepStrictEqual(s.calls.api, [JSON.stringify(['POST', '/api/quit-app', { package: 'com.netflix.ninja' }])]);
  assert.deepStrictEqual(s.calls.flash, ['ctx_quit_done:Netflix']);

  // Restart: says what it is doing at once, since it takes a few seconds
  s = setup();
  s.context.openAppMenu(app); choose(s.context, 'restart');
  assert.deepStrictEqual(s.calls.flash, ['ctx_restarting:Netflix']);
  await later();
  assert.deepStrictEqual(s.calls.api, [JSON.stringify(['POST', '/api/restart-app', { app: 'com.netflix.ninja' }])]);
  assert.deepStrictEqual(s.calls.flash, ['ctx_restarting:Netflix']);

  // A bridge that refuses says why, instead of a success message
  s = setup({ api: () => Promise.reject(new Error('the TV is off')) });
  s.context.openAppMenu(app); choose(s.context, 'quit');
  await later();
  assert.deepStrictEqual(s.calls.flash, ['ctx_quit_failed:Netflix: the TV is off']);
  s = setup({ api: () => Promise.reject(new Error('unknown app: x')) });
  s.context.openAppMenu(app); choose(s.context, 'restart');
  await later();
  assert.deepStrictEqual(s.calls.flash, ['ctx_restarting:Netflix', 'ctx_restart_failed:Netflix: unknown app: x']);
  // An app the bridge does not list: Restart quits it and opens it again on the TV
  const launched = [];
  const unknown = Object.assign(new Error('unknown app: x'), { key: 'err_unknown_app' });
  s = setup({ api: (method, path) => path === '/api/restart-app' ? Promise.reject(unknown) : Promise.resolve({ ok: true }) });
  s.context.TV.launch = pkg => launched.push(pkg);
  s.context.openAppMenu(app); choose(s.context, 'restart');
  await later();
  assert.deepStrictEqual(s.calls.api.map(c => JSON.parse(c)[1]), ['/api/restart-app', '/api/quit-app']);
  await new Promise(r => setTimeout(r, 700));
  assert.deepStrictEqual(launched, ['com.netflix.ninja']);
  assert.deepStrictEqual(s.calls.flash, ['ctx_restarting:Netflix']);
  console.log('app menu quit/restart: ok');
})().catch(e => { console.error(e); process.exit(1); });
