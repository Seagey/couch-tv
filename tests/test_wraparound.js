// Going round at the ends: a single arrow press at the end of a row or a list goes round to the
// other end when the key is let go; a held arrow never does, whether or not the remote marks its
// extra key downs as repeats.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

const m = js.match(/function wrapIndex\([^)]*\) \{[^\n]*\}\n/);
assert(m, 'wrapIndex is in app.js');
const wrapIndex = new Function(m[0] + '; return wrapIndex;')();
assert.strictEqual(wrapIndex(10, 1), 0, 'forwards past the last goes to the first');
assert.strictEqual(wrapIndex(10, -1), 9, 'backwards past the first goes to the last');
assert.strictEqual(wrapIndex(1, -1), 0, 'a list of one stays put');
assert.strictEqual(wrapIndex(0, -1), 0, 'an empty list never goes below 0');

const a = js.match(/function arrowAgain\([^)]*\) \{[^\n]*\}\n/);
assert(a, 'arrowAgain is in app.js');
const arrowAgain = new Function(a[0] + '; return arrowAgain;')();
const p = { dir: '1,0', at: 1000, last: 1000 };
assert.strictEqual(arrowAgain(null, '1,0', 1000, false), false, 'the first key down is a new press');
assert.strictEqual(arrowAgain(p, '1,0', 1050, true), true, 'a key down marked as a repeat is the same press');
assert.strictEqual(arrowAgain(p, '1,0', 1050, false), true, 'the same arrow again before it was let go, not marked as a repeat, is still the same press (a held key on a Chromecast remote)');
assert.strictEqual(arrowAgain(p, '-1,0', 1050, false), false, 'another arrow is a new press');
assert.strictEqual(arrowAgain(p, '1,0', 2500, false), false, 'a press whose key up was lost long ago does not swallow the next one');

// keydown: only the first key down of a press, at an end, is remembered
assert(/var again = arrowAgain\(arrowPress, dir, now, e\.repeat\);[\s\S]{0,400}var before = again \? null : navState\(\);\n\s*move\(arrow\[0\], arrow\[1\]\);\n\s*wrapPending = before !== null && navState\(\) === before/.test(js),
  'keydown remembers only the first key down of a press at an end; any further key down clears it');
// keyup: the same arrow, let go quickly, goes round
assert(/var quick = p && Date\.now\(\) - p\.at <= HOLD_MS;\n\s*if \(w && quick && w\.dx === arrow\[0\] && w\.dy === arrow\[1\] && !isTyping\(\)\) \{\n\s*e\.preventDefault\(\);\n\s*wrapRound\(w\.dx, w\.dy\);/.test(js),
  'keyup goes round only for a quick press of the arrow that was pressed');
// carrying an app, a name or a settings row never goes round
assert(/function wrapRound\(dx, dy\) \{[\s\S]*?if \(lift \|\| plift \|\| SET\.lift\) return;/.test(js), 'no wrap while moving something');
// in Home settings left and right keep their meaning (change a value, change column)
assert(/if \(zone === "settings"\) \{\n\s*if \(!dy\) return;/.test(js), 'settings only wraps up and down');

console.log('Wraparound tests passed.');
