// The Mac-style dock (home.dock "mac"): the focused app and its neighbours grow in a wave, the dock
// stays centred, and its tray grows the same on both sides, so the first and last icons keep the
// same margin wherever the focus is. A dock too wide for the screen shrinks as a whole.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.css'), 'utf8');
const mag = js.match(/var MAG = (\[[^\]]*\]);/);
const fn = js.match(/  function magnify\(\) \{[\s\S]*?\n  \}\n/);
assert(mag && fn, 'MAG and magnify() are in app.js');
const MAG = JSON.parse(mag[1]);
assert.deepStrictEqual(MAG, [1.55, 1.45, 1.25, 1.05], 'the wave: focused, then 1, 2 and 3 apps away');

const REM = 16, TILE = 7 * REM, GAP = 1.625 * REM, PAD = 1.75 * REM;

// a dock of n tiles laid out the way app.css does it, measured from the tray's content box
function dock(n, focus, screen) {
  const tiles = [];
  for (let i = 0; i < n; i++) {
    tiles.push({ offsetTop: 0, offsetLeft: PAD + i * (TILE + GAP), offsetWidth: TILE, style: {},
      classList: { contains: (c) => c === 'focus' ? i === focus : false } });
  }
  const grid = { style: {}, querySelector: () => tiles[focus] };
  const root = { dir: 'ltr', classList: { contains: () => false } };
  const run = new Function('$', 'gridEls', 'DOCK_MAC', 'NIGHT', 'MAG', 'document', 'window', 'getComputedStyle',
    fn[0] + '; magnify();');
  run(() => grid, tiles, true, true, MAG, { documentElement: root }, { innerWidth: screen }, () => ({ fontSize: REM + 'px' }));
  // where each icon ends up on screen, relative to the tray's left edge without any growth
  const boxes = tiles.map((t) => {
    const m = t.style.transform.match(/translateX\((-?[\d.]+)px\) scale\(([\d.]+)\)/);
    const x = +m[1], s = +m[2], c = t.offsetLeft + TILE / 2 + x;
    return { left: c - s * TILE / 2, right: c + s * TILE / 2, scale: s };
  });
  const grow = parseFloat(grid.style.marginLeft || '0') * -1;
  assert.strictEqual(grid.style.marginLeft || '', grid.style.marginRight || '', 'the tray grows the same on both sides');
  const width = 2 * PAD + n * TILE + (n - 1) * GAP;
  return { boxes, trayLeft: -grow, trayRight: width + grow };
}

for (const [n, screen] of [[10, 1920], [12, 1920], [12, 1280]]) {
  for (let focus = 0; focus < n; focus++) {
    const d = dock(n, focus, screen);
    const left = d.boxes[0].left - d.trayLeft, right = d.trayRight - d.boxes[n - 1].right;
    assert(Math.abs(left - right) < 0.5, `${n} tiles, focus ${focus}: the same margin at both ends (${left.toFixed(1)} and ${right.toFixed(1)})`);
    assert(left > 0, `${n} tiles, focus ${focus}: the icons stay inside the tray`);
    assert(d.trayRight - d.trayLeft <= screen * 0.97 + 0.5, `${n} tiles on ${screen}px, focus ${focus}: the dock fits the screen`);
    const base = Math.min(...d.boxes.map((b) => b.scale));
    assert(Math.abs(d.boxes[focus].scale / base - MAG[0]) < 0.01, `${n} tiles, focus ${focus}: the focused app is ${MAG[0]} times the rest`);
    for (let i = 1; i < n; i++) assert(d.boxes[i].left >= d.boxes[i - 1].right - 0.5, `${n} tiles, focus ${focus}: icons ${i - 1} and ${i} do not overlap`);
  }
}

// off unless chosen, and only on the Night dock
assert(/DOCK_MAC = !LIGHTER && \(ST\.dock \|\| HOME\.dock\) === "mac";/.test(js), 'home.dock "mac" or Home settings turns it on; Lighter home holds it off');
assert(/if \(!DOCK_MAC \|\| !NIGHT \|\|/.test(js), 'magnify() does nothing unless the Mac-style dock is on');
assert(/html\.dock-mac\.theme-night \.app\.focus/.test(css), 'app.css styles it under html.dock-mac only');

console.log('Mac-style dock tests passed.');
