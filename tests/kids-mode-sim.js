// Runs tv-home/web/kids.js with a stand-in page and TV, and prints what happened as JSON.
// Driven by tests/test_kids_mode.py (node tests/kids-mode-sim.js). No browser, no TV.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function el() {
  return {
    innerHTML: '', style: { setProperty() {} }, children: [],
    setAttribute() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}
const htmlClasses = new Set();
const sandbox = {
  window: {},
  document: {
    body: { appendChild() {} },
    createElement: el,
    documentElement: { classList: { add: (c) => htmlClasses.add(c), remove: (c) => htmlClasses.delete(c) } },
  },
  setInterval() {}, setTimeout() {}, clearTimeout() {}, Date, JSON, Math, String, Array, Object,
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../tv-home/web/kids.js'), 'utf8'), sandbox);
const K = sandbox.window.KidsMode;

// the parent PIN is 4826, hashed the way bridge/kids.py does
const salt = 'aabbccddeeff00112233';
const kid = {
  id: 'ruby', name: 'Ruby', kids_mode: {
    shows: [
      { id: 'bluey', title: 'Bluey', service: 'abc-iview', package: 'au.net.abc.iview', link: 'intent://video/ZW2653A001S00#Intent;scheme=iview;end', app: { name: 'ABC iview', package: 'au.net.abc.iview' } },
      { id: 'peppa-pig-1-3', title: 'Peppa Pig', service: 'abc-iview', season: 1, episode: 3, package: 'au.net.abc.iview', app: { name: 'ABC iview', package: 'au.net.abc.iview' } },
    ],
    apps: ['au.net.abc.iview', 'com.not.installed'],
    pin_hash: K.pinHash('4826', salt, 4000), pin_salt: salt, pin_rounds: 4000,
  },
};
const grown = { id: 'mum', name: 'Mum' };

const calls = { api: [], openLink: [], launch: [], unlocked: [] };
let online = true;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
K.init({
  t: (k, v) => k + (v ? JSON.stringify(v) : ''), esc: (v) => String(v), iconUrl: () => null,
  TV: { openLink: (u, p) => { calls.openLink.push([u, p]); return true; }, launch: (p) => { calls.launch.push(p); return true; } },
  api: (m, p, b) => { calls.api.push([m, p, b]); return { then(ok) { if (ok) ok({ note: '' }); } }; },
  keep() {}, kept() { return null; }, clock24: () => true, online: () => online,
  colour: () => '#ff9f0a', avatar: () => '<span class="avatar"></span>',
  appName: (p) => p, installed: (p) => p !== 'com.not.installed',
  launch: (p) => calls.launch.push(p),
  isOk: (e) => e.key === 'Enter', isBack: (e) => e.key === 'Escape', isMenu: (e) => e.key === 'ContextMenu',
  isSettings: (e) => e.key === 'Settings', arrowOf: (e) => ARROWS[e.key] || null,
  unlocked: (p, code) => calls.unlocked.push([p.id, code]),
});
const press = (key) => K.key({ type: 'keydown', key, keyCode: 0, repeat: false });
const root = () => (K.active() ? lastRoot.innerHTML : '');
let lastRoot = null;
sandbox.document.createElement = () => { lastRoot = el(); return lastRoot; };

const out = {};
K.sync(grown);
out.grownActive = K.active();
K.sync(kid);
out.kidActive = K.active();
out.htmlClass = htmlClasses.has('kids-on');
const html = root();
out.titles = (html.match(/class="ktitle">([^<]*)</g) || []).map((m) => m.replace(/.*>/, '').replace(/<$/, ''));
out.apps = (html.match(/class="kapp" [^>]*>/g) || []).length;
out.hasLock = html.includes('class="klock"');

// OK on the first show, with the bridge: /api/play with the show and the child
press('Enter');
out.playOnline = calls.api.filter((c) => c[1] === '/api/play').map((c) => c[2]);
// the second (season and episode), with no computer: the link if any, else the app
online = false;
press('ArrowRight'); press('Enter');
press('ArrowLeft'); press('Enter');
out.offline = { openLink: calls.openLink, launch: calls.launch.slice() };

// Back and Home stay on the shelf
press('Escape');
out.afterBack = K.active();
K.home();
out.afterHome = K.active();

// the PIN: Settings opens the pad, a wrong PIN keeps kids mode, the right one hands back
press('Settings');
out.padOpen = lastRoot.innerHTML.includes('class="kpin');
press('1'); press('1');
const dots = lastRoot.innerHTML.match(/class="kdots"[^>]*>(.*?)<\/div>/);
out.dotsOnly = !!dots && /^(<i class="(on)?"><\/i>)+$/.test(dots[1]) && (dots[1].match(/class="on"/g) || []).length === 2;
press('1'); press('1');
press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); press('ArrowRight'); press('ArrowRight');   // to the tick key
press('Enter');
out.afterWrong = { active: K.active(), unlocked: calls.unlocked.length, msg: lastRoot.innerHTML.includes('kids_pin_wrong') };
'4826'.split('').forEach(press);
out.afterRight = { active: K.active(), unlocked: calls.unlocked };

// picking the kids profile again goes straight back in: no PIN is needed to go into kids mode
K.sync(kid);
out.reentered = K.active();
console.log(JSON.stringify(out));
