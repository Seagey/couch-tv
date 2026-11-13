// #166 (thanks IshMehta): after TV Settings or an app's settings, a home that Android dropped for
// memory must open on the row and tile that was focused, not the start. Home still goes to the first tile.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8');
const m = js.match(/function pickFocus\([\s\S]*?\n  \}\n/);
assert(m, 'pickFocus is in app.js');
const maxAge = js.match(/FOCUS_MAX_AGE = ([0-9 *]+),/);
assert(maxAge, 'FOCUS_MAX_AGE is in app.js');
const pickFocus = new Function('FOCUS_MAX_AGE', m[0] + '; return pickFocus;')(eval(maxAge[1]));

const now = 1000000000000;
const keys = ['app:a', 'app:b', 'app:c', 'app:d'];

// a recent grid tile comes back, found by its app so a changed order still lands on the same app
assert.deepStrictEqual(pickFocus({ t: now - 60000, zone: 'grid', s: 0, g: 1, key: 'app:c' }, now, 3, keys), { zone: 'grid', s: 0, g: 2 });
// the app is gone: the saved position, kept inside the grid
assert.deepStrictEqual(pickFocus({ t: now - 60000, zone: 'grid', s: 0, g: 9, key: 'app:zz' }, now, 3, keys), { zone: 'grid', s: 0, g: 3 });
// a Keep watching card
assert.deepStrictEqual(pickFocus({ t: now - 1000, zone: 'shelf', s: 2, g: 0, key: '' }, now, 3, keys), { zone: 'shelf', s: 2, g: 0 });
// the row got shorter: start fresh
assert.strictEqual(pickFocus({ t: now - 1000, zone: 'shelf', s: 5, g: 0 }, now, 3, keys), null);
// too old (a TV switched on the next evening starts at the first tile), or a clock that went backwards
assert.strictEqual(pickFocus({ t: now - 3 * 3600 * 1000, zone: 'grid', g: 1, key: 'app:b' }, now, 3, keys), null);
assert.strictEqual(pickFocus({ t: now + 60000, zone: 'grid', g: 1, key: 'app:b' }, now, 3, keys), null);
// nothing saved, junk, menus and settings are not restored
assert.strictEqual(pickFocus(null, now, 3, keys), null);
assert.strictEqual(pickFocus('x', now, 3, keys), null);
assert.strictEqual(pickFocus({ t: now, zone: 'settings', s: 0, g: 0 }, now, 3, keys), null);
assert.strictEqual(pickFocus({ t: now, zone: 'grid', g: 0 }, now, 3, []), null);

// Home forgets the saved focus, and the app saves it when it is paused
assert(/home: function \(\) \{ forgetFocus\(\);/.test(js), 'tv.home forgets the focus');
assert(/pause: function \(\) \{ saveFocusNow\(\);/.test(js), 'tv.pause saves the focus');
console.log('Focus restore tests passed.');
