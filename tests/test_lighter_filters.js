// Lighter home runs no filter at all: not the night dim on the scene layers, not the glass clock's shadows and
// saturation, not the dock icons' brightness (a Fire TV Cube drew the home at a 15-21 ms frame with them on).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Lighter home filter tests...');
const css = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.css'), 'utf8');
const block = css.slice(css.indexOf('/* Lighter home, the filters it still left on'), css.indexOf("/* webOS: LG's pointer"));
assert(block.length > 0, 'the Lighter filter block exists');
for (const sel of ['html.lighter .night .scene .sbg', 'html.lighter .night .scene .fg', 'html.lighter .night .scene .gclock', 'html.lighter .gclock', 'html.lighter .s-night .gclock .fill', 'html.lighter .clock-liquid.night .scene .gclock']) {
  assert(block.indexOf(sel) >= 0, `${sel} is covered`);
}
assert(/\{ filter: none; \}/.test(block), 'and set to no filter');
assert(/html\.lighter \.night \.scene\.ready::after \{[^}]*background: rgba\(0, 0, 0, 0\.28\)/.test(block), 'the night dim is one dark sheet over the scene');
assert(/html\.lighter \.s-fog \.gclock \.fill \{[^}]*filter: none;[^}]*-webkit-text-fill-color/.test(block), 'the fog clock keeps a dark fill without a filter');
assert(/html\.lighter\.theme-night \.app:not\(\.focus\) \.face img \{ filter: none; opacity: 0\.85; \}/.test(block), 'dock icons that are not focused dim without a filter');
// the full look keeps its filters
assert(/^\.night \.scene \.sbg, \.night \.scene \.fg, \.night \.scene \.gclock \{ filter: brightness\(0\.72\); \}/m.test(css), 'the full look still dims with a filter');
console.log('Lighter home filter tests passed.');
