// frost.js (lane L, 28 Nov 2026): the Night glass drawn once per scene. What it reads from the page, and when it
// must leave the live blur alone. The pixels themselves are checked in test_frost_browser.mjs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running frost tests...');
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/frost.js'), 'utf8');
function load(classes) {
  const list = new Set(classes);
  const root = { classList: { contains: (k) => list.has(k), add: (k) => list.add(k), remove: (k) => list.delete(k) }, className: classes.join(' ') };
  const win = {};
  const doc = { readyState: 'complete', documentElement: root, body: { className: '' }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  win.window = win; win.document = doc;
  vm.runInNewContext(src, Object.assign(win, { setTimeout, clearTimeout, getComputedStyle: () => ({}) }));
  return { F: win.CouchFrost, list };
}
const { F } = load(['theme-night']);
const G = (s) => Array.from(F.parseGlass(s));

// the glass it can draw: a blur, with or without a saturation, in px as getComputedStyle writes it
assert.deepStrictEqual(G('blur(28px) saturate(1.7)'), [28, 1.7]);
assert.deepStrictEqual(G('blur(14px) saturate(1.7)'), [14, 1.7], 'a TV laid out at 960 px wide has a 14 px blur');
assert.deepStrictEqual(G('blur(12px)'), [12, 1]);
for (const s of ['none', '', 'blur(28px) brightness(1.1)', 'saturate(1.7) blur(28px)', 'blur(1.75rem)']) assert.strictEqual(F.parseGlass(s), null, s + ' is left live');

// the scrim and the scenes' shades: vertical gradients of colour stops, nothing else
function fakeCtx() {
  const stops = [];
  return { stops, createLinearGradient: (x0, y0, x1, y1) => { assert.deepStrictEqual([x0, y0, x1], [0, 0, 0], 'top to bottom'); return { addColorStop: (o, c) => stops.push([o, c]) }; }, fillRect() {} };
}
let c = fakeCtx();
assert.ok(F.vgrad(c, 'linear-gradient(rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.5) 100%)', 100, 50));
assert.deepStrictEqual(c.stops, [[0.6, 'rgba(0, 0, 0, 0)'], [1, 'rgba(0, 0, 0, 0.5)']], 'the Night scrim');
c = fakeCtx();
assert.ok(F.vgrad(c, 'linear-gradient(rgba(0, 12, 24, 0.42) 0%, rgba(0, 12, 24, 0.12) 40%, rgba(0, 0, 0, 0) 52%, rgba(0, 20, 40, 0.5) 100%)', 100, 50), 'the waterline shade');
assert.strictEqual(c.stops.length, 4);
c = fakeCtx();
assert.ok(F.vgrad(c, 'linear-gradient(rgb(1, 2, 3), rgba(4, 5, 6, 0.5))', 10, 10), 'stops without places are spread evenly');
assert.deepStrictEqual(c.stops.map((s) => s[0]), [0, 1]);
assert.ok(F.vgrad(fakeCtx(), 'none', 1, 1), 'no shade is fine');
for (const s of ['linear-gradient(90deg, red, blue)', 'radial-gradient(red, blue)', 'url("x.png")',
  'linear-gradient(rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 26%), linear-gradient(rgba(0, 0, 0, 0) 32%, rgba(0, 0, 0, 0.86) 100%)']) {
  assert.strictEqual(F.vgrad(fakeCtx(), s, 1, 1), false, s + ' is not drawn here');
}

// where it stays off: the live blur is kept
for (const k of ['lighter', 'glass', 'old-engine', 'depth-zoom', 'has-video', 'np-sync-colors', 'theme-loop', 'amb-fx']) {
  assert.strictEqual(load(['theme-night', k]).F.allowed(), false, k + ' keeps the live blur');
}
assert.strictEqual(load(['theme-classic']).F.allowed(), false, 'only the Night look');
assert.strictEqual(load(['theme-night', 'cd', 'settled']).F.allowed(), true, 'Couch Original (a design) and the focus settling');

// wiring: loaded after app.js, and the rule that shows the picture under the tint
const html = fs.readFileSync(path.join(__dirname, '../tv-home/web/index.html'), 'utf8');
assert.ok(html.indexOf('<script src="frost.js"></script>') > html.indexOf('<script src="app.js"></script>'), 'frost.js is loaded after app.js');
const css = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.css'), 'utf8');
assert.ok(/html\.frost\.theme-night \.fz \{[^}]*backdrop-filter: none;[^}]*background-image: linear-gradient\(var\(--ft\), var\(--ft\)\), var\(--fz\)/.test(css), 'the tint over the drawn glass, no live blur');
assert.ok(/^\.theme-night \.people, \.theme-night \.qbtn, \.theme-night \.grid, \.theme-night \.ncard \{\n  background: rgba\(30, 20, 28, 0\.32\); -webkit-backdrop-filter: blur\(1\.75rem\) saturate\(170%\)/m.test(css), 'the live glass itself is unchanged');
console.log('Frost tests passed.');
