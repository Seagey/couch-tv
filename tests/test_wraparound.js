// Going round at the ends: a single arrow press at the end of a row or a list goes round to the
// other end when the key is let go; a held (repeating) arrow never does.
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

// keydown: only a press that is not a repeat, and that moved nothing, is remembered
assert(/var before = e\.repeat \? null : navState\(\);\n\s*move\(arrow\[0\], arrow\[1\]\);\n\s*wrapPending = before !== null && navState\(\) === before/.test(js),
  'keydown remembers a single press at an end, and a repeat clears it');
// keyup: the same arrow, let go, goes round
assert(/var w = wrapPending;\n\s*wrapPending = null;\n\s*if \(w && w\.dx === arrow\[0\] && w\.dy === arrow\[1\] && !isTyping\(\)\) \{\n\s*e\.preventDefault\(\);\n\s*wrapRound\(w\.dx, w\.dy\);/.test(js),
  'keyup goes round only for the arrow that was pressed');
// carrying an app, a name or a settings row never goes round
assert(/function wrapRound\(dx, dy\) \{[\s\S]*?if \(lift \|\| plift \|\| SET\.lift\) return;/.test(js), 'no wrap while moving something');
// in Home settings left and right keep their meaning (change a value, change column)
assert(/if \(zone === "settings"\) \{\n\s*if \(!dy\) return;/.test(js), 'settings only wraps up and down');

console.log('Wraparound tests passed.');
