// App logos (lane L2, 28 Nov 2026): the small vector logo on each Keep watching / Now playing card instead of the app's
// square picture shrunk to 26 px. Every catalogue app that has a vector logo resolves, each logo is plain SVG that an old
// Android TV WebView 91 draws (no filter, gradient, style or text), the files are small, and every app is accounted for
// in tv-home/web/app-logos/SOURCES.md (a source and a licence, or kept as the picture).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running app logo tests...');
const WEB = path.join(__dirname, '../tv-home/web');
const SRC = path.join(__dirname, '../tv-home/tools/app-logos-src');
const { APP_CATALOGUE, CouchApps } = require(path.join(WEB, 'app-catalogue.js'));
const LOGOS = require(path.join(WEB, 'app-logos/app-logos.js'));
const sources = fs.readFileSync(path.join(WEB, 'app-logos/SOURCES.md'), 'utf8');

const ids = Object.keys(LOGOS.logos);
assert.ok(ids.length >= 15, 'most of the apps have a vector logo: ' + ids.length);
const withPicture = APP_CATALOGUE.apps.filter((a) => a.icon).map((a) => a.id);
assert.strictEqual(withPicture.length, 25, 'the 25 apps that have a picture');

ids.forEach((id) => {
  const app = CouchApps.get(id);
  assert.ok(app && app.icon, id + ': is an app in the catalogue with a picture to replace');
  assert.ok(LOGOS.has(id), id + ': has()');
  // the card finds it from a package name, as app.js does
  const pkg = app.packages.android[0] || app.packages.lg || app.packages.samsung;
  if (pkg) assert.strictEqual(CouchApps.idOf(pkg), id, id + ': its package resolves back to it');
  const l = LOGOS.logos[id];
  const vb = l.vb.split(' ').map(Number);
  assert.strictEqual(vb.length, 4, id + ': viewBox has four numbers');
  assert.ok(vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0, id + ': viewBox is a real box');
  assert.ok(/^#[0-9a-f]{6}$/.test(l.c), id + ': brand colour');
  assert.ok(Array.isArray(l.d) && l.d.length >= 1 && l.d.length <= 3, id + ': one to three paths');
  l.d.forEach((d) => {
    assert.ok(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(d) && /^[Mm]/.test(d), id + ': a plain path');
    assert.ok(!/NaN|undefined/.test(d), id + ': no NaN in the path');
  });
  const s = LOGOS.svg(id, 1.75, 6);
  assert.ok(/^<svg class="alogo" viewBox="[^"]+" style="width:[\d.]+rem;height:[\d.]+rem" fill="currentColor" aria-hidden="true">(<path d="[^"]+"\/>)+<\/svg>$/.test(s), id + ': the markup');
  assert.ok(!/filter|gradient|<style|<text|<image|<use|font|clip-path|mask|url\(/i.test(s), id + ': nothing WebView 91 would draw differently');
  const w = +s.match(/width:([\d.]+)rem/)[1], h = +s.match(/height:([\d.]+)rem/)[1];
  assert.ok(h <= 1.75 + 1e-9 && w <= 6 + 1e-9 && h > 0.5, id + ': fits the box (' + w + ' x ' + h + ' rem)');
  assert.ok(Math.abs(w / h - vb[2] / vb[3]) < 0.02, id + ': keeps its shape');
  // the original file it came from is kept and is an SVG
  const files = fs.readdirSync(SRC).filter((f) => /\.svg$/.test(f));
  assert.ok(files.length >= ids.length, 'the original files are kept');
  assert.ok(new RegExp('\\| ' + id + '( |\\|)').test(sources), id + ': named in SOURCES.md with its source');
});

// an app with no logo gives "" (the card then keeps its picture)
assert.strictEqual(LOGOS.svg('iview', 1.75, 6), '');
assert.strictEqual(LOGOS.svg('nope', 1.75, 6), '');
assert.strictEqual(LOGOS.svg('__proto__', 1.75, 6), '');
withPicture.filter((id) => !LOGOS.has(id)).forEach((id) => assert.ok(new RegExp('\\| ' + id.replace('+', '\\+') + '[ |(]').test(sources), id + ': listed in SOURCES.md as kept as the picture'));

// every source file parses (opening and closing tags match) and is only a drawing
fs.readdirSync(SRC).filter((f) => /\.svg$/.test(f)).forEach((f) => {
  let t = fs.readFileSync(path.join(SRC, f), 'utf8');
  assert.ok(/<svg[\s>]/.test(t) && /<\/svg>\s*$/.test(t), f + ': an svg');
  assert.ok(!/<script|onload=|javascript:|<foreignObject/i.test(t), f + ': nothing that runs');
  t = t.replace(/<[^>]*\/>/g, '');
  const open = (t.match(/<(g|defs|svg|clipPath|linearGradient|radialGradient|style)[\s>]/g) || []).length, close = (t.match(/<\/(g|defs|svg|clipPath|linearGradient|radialGradient|style)>/g) || []).length;
  assert.strictEqual(open, close, f + ': tags match');
});

// small: the one file the TV loads, and the originals beside it
const size = fs.statSync(path.join(WEB, 'app-logos/app-logos.js')).size;
assert.ok(size < 30000, 'app-logos.js stays small: ' + size + ' bytes');
const srcSize = fs.readdirSync(SRC).reduce((n, f) => n + fs.statSync(path.join(SRC, f)).size, 0);
assert.ok(srcSize < 120000, 'the originals stay small: ' + srcSize + ' bytes');
assert.ok(!fs.readdirSync(path.join(WEB, 'app-logos')).some((f) => /\.svg$/.test(f)), 'only the one script is shipped, not the originals');

// wired in: loaded after the catalogue and before app.js, drawn on the card, with a switch to turn it off
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
assert.ok(html.indexOf('app-logos/app-logos.js') > html.indexOf('app-catalogue.js') && html.indexOf('app-logos/app-logos.js') < html.indexOf('<script src="app.js">'), 'script order');
const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
assert.ok(/\(lg \? lg\.html : pkg && iconUrl\(pkg\)/.test(app), 'the card draws the logo first, the picture otherwise');
assert.ok(LOGOS.word('stan') && LOGOS.word('binge') && !LOGOS.word('netflix') && !LOGOS.word('youtube'), 'wordmarks lose the name text, marks keep it');
assert.ok(/COUCHTV_APP_LOGOS === false/.test(app), 'a switch to turn it off');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8');
assert.ok(/\.ncard \.nap\.hasl \{ min-height: 1\.625rem; overflow: visible/.test(css), 'logo row as tall as the picture');
assert.ok(/\.ncard \.nap \.alogo \{[^}]*color: rgba\(255, 255, 255/.test(css), 'logo colour');
console.log('App logo tests passed (' + ids.length + ' logos, ' + size + ' bytes).');
