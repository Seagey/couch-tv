// #158 (thanks NathanGlasby): the Next song button sends MEDIA_NEXT, which Chromium reports with
// keyCode 176, the same number the page used for the remote's Settings key, so it opened the gear
// menu (Home settings / TV settings) instead of skipping the track. Media keys must not count as Settings.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8');
const m = js.match(/function isSettings\(e\) \{[^\n]*\}/);
assert(m, 'isSettings is in app.js');
const isSettings = new Function(m[0] + '; return isSettings;')();

// the Next song key as Chromium sends it, and the other media keys
assert.strictEqual(isSettings({ key: 'MediaTrackNext', keyCode: 176 }), false, 'Next track is not Settings');
assert.strictEqual(isSettings({ key: 'MediaTrackPrevious', keyCode: 177 }), false);
assert.strictEqual(isSettings({ key: 'MediaPlayPause', keyCode: 179 }), false);
// the Settings key still opens it, by name or by code
assert.strictEqual(isSettings({ key: 'Settings', keyCode: 0 }), true);
assert.strictEqual(isSettings({ key: 'TvSettings', keyCode: 0 }), true);
assert.strictEqual(isSettings({ key: 'Unidentified', keyCode: 176 }), true);
assert.strictEqual(isSettings({ keyCode: 176 }), true);
assert.strictEqual(isSettings({ key: 'Enter', keyCode: 13 }), false);
console.log('Settings key tests passed.');
