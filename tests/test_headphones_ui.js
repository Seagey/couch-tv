const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Headphones UI tests...');

const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const mockJs = fs.readFileSync(path.join(web, 'mock.js'), 'utf8');

// 1. app.js: one "headphones" button that opens the Bluetooth screen, never on by default
assert(/var QUICK_ALL = \[[^\]]*"headphones"/.test(appJs), 'QUICK_ALL must list "headphones"');
assert(!appJs.includes('bluetooth_audio'), 'no bluetooth_audio alias');
assert(appJs.includes("headphones: '<svg"), 'ICONS must have a headphones icon');
assert(appJs.includes('function openBluetoothScreen'), 'app.js must define openBluetoothScreen');
assert(appJs.includes('api("POST", "/api/bluetooth-audio")'), 'the bridge path posts to /api/bluetooth-audio');
assert(!/api\("POST", "\/api\/bluetooth-audio", \{/.test(appJs), 'the POST carries no body of its own');
const def = appJs.match(/TVCFG\.quick \|\| (\[[^\]]*\])/);
assert(def && !def[1].includes('headphones'), 'headphones is not in the default quick buttons');

// 2. i18n.js: all 10 languages (English, Spanish, Mexican Spanish, Italian, German, Turkish, French, Serbian Latin, Dutch, Hebrew)
// have the strings the button uses. Mexican Spanish is an overlay on Spanish, so it is counted by hand.
const langs = 10;
['quick_headphones', 'headphones', 'headphones_not_found'].forEach(function (key) {
  const count = (i18n.match(new RegExp('\\b' + key + ':', 'g')) || []).length;
  assert.strictEqual(count, langs, `${key} must exist in all ${langs} languages (found ${count})`);
});

// 3. mock.js answers the GET
assert(mockJs.includes('/api/bluetooth-audio'), 'mock.js must support /api/bluetooth-audio');

console.log('All Headphones UI tests passed successfully!');
