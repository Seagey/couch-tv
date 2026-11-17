// A Look switch (or a settings change) starts the page again. The settings it just saved go to the
// bridge before the reload, in one go, and the page that comes back skips the asks the old one made
// seconds ago. The launcher's bridge probe on resume takes two misses, not one, and none right after
// the page loaded. (A Fire TV Cube on weak Wi-Fi showed seconds of lag on that button.)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Look restart tests...');
const app = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8').replace(/\r\n/g, '\n');
const kt = fs.readFileSync(path.join(__dirname, '../tv-home/android/app/src/main/java/app/couchtv/launcher/MainActivity.kt'), 'utf8');

function extractFunction(name) {
  const match = app.match(new RegExp(`^  function ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}`, 'm'));
  assert(match, `app.js defines ${name}()`);
  return match[0];
}

// restart() flushes first and leaves the mark the next page reads
const restart = extractFunction('restart');
assert(restart.indexOf('flushSettings();') >= 0, 'restart flushes the pending settings');
assert(restart.indexOf('flushSettings();') < restart.indexOf('location.reload()'), 'and does so before reloading');
assert(/sessionStorage\.setItem\("tvhome\.restarted"/.test(restart), 'restart marks the page for the one that follows');
assert(/var hello = OFFLINE \|\| JUST_RESTARTED \? Promise\.resolve\(\)/.test(app), 'the restarted page does not ask who is watching again');
assert(/if \(JUST_RESTARTED\) setTimeout\(refreshQuick, 3000\); else refreshQuick\(\);/.test(app), 'the quick buttons come back a moment later, not never');
assert(/if \(JUST_RESTARTED && !STANDALONE\) setTimeout\(refreshMusic, 1500\); else refreshMusic\(\);/.test(app), 'so does the music card; a standalone site asks at once');
assert(/function restartHome\(\) \{\n    flushSettings\(\);/.test(app), 'the launcher-driven restart flushes too');
assert(/rec\.pending && rec\.flushed && Date\.now\(\) - rec\.flushed < 10000 && remote && canon\(remote\) === canon\(ST\)/.test(app), 'a flushed push that landed is not sent again');

// flushSettings: one keepalive request with the key, never a blocking one, only when a push is pending
const calls = [];
const store = { 'tvhome.settings': { s: { look: 'oled' }, updated: 1, pending: true } };
const sb = {
  pushTimer: 7, clearTimeout: () => {}, kept: (k) => store[k], keep: (k, v) => { store[k] = v; },
  OFFLINE: false, data: { bridge: true }, MOCK: false, PREVIEW: false, API: 'http://bridge:5400', KEY: 'secret-key', TV_ID: 'living-room',
  ST_KEY: 'tvhome.settings', JSON, Date,
  fetch: (u, o) => { calls.push({ u, o }); return Promise.resolve({ ok: true }); },
  XMLHttpRequest: function () { throw new Error('a blocking request would freeze the home'); },
};
vm.runInNewContext(`${extractFunction('flushSettings')}\nthis.flush = flushSettings;`, sb);
sb.flush();
assert.strictEqual(calls.length, 1, 'one request');
assert.strictEqual(calls[0].u, 'http://bridge:5400/api/settings');
assert.strictEqual(calls[0].o.method, 'POST');
assert.strictEqual(calls[0].o.keepalive, true, 'the request outlives the reload');
assert.strictEqual(calls[0].o.headers.Authorization, 'Bearer secret-key', 'the pairing key goes in the header');
assert.deepStrictEqual(JSON.parse(calls[0].o.body), { tv: 'living-room', settings: { look: 'oled' } });
assert.strictEqual(store['tvhome.settings'].pending, true, 'the record stays pending until the next page sees it landed');
assert(store['tvhome.settings'].flushed > 0, 'and remembers when it was flushed');
store['tvhome.settings'].pending = false; sb.flush();
assert.strictEqual(calls.length, 1, 'nothing to flush without a pending push');
store['tvhome.settings'].pending = true; sb.OFFLINE = true; sb.flush();
assert.strictEqual(calls.length, 1, 'nothing goes anywhere without a bridge');
sb.OFFLINE = false; sb.fetch = undefined; sb.flush();
assert.strictEqual(calls.length, 1, 'no fetch: no flush, the next page pushes as before');

// the launcher: two strikes, and a grace period after the page loaded
assert(/probeBridge\(base, 2\)/.test(kt), 'the resume probe takes two misses');
assert(/gen == pageGen/.test(kt) && /pageGen\+\+/.test(kt), 'a strike for a page that has since been replaced is dropped');
assert(/if \(!offline && !url\.startsWith\("http:\/\/\$OFFLINE_HOST\/"\)\) pageFinishedAt = /.test(kt), 'only the live page is timed');
assert(/elapsedRealtime\(\) - pageFinishedAt > PROBE_GRACE_MS\) probeBridge/.test(kt), 'no probe right after the page loaded');
assert(/pageFinishedAt = android\.os\.SystemClock\.elapsedRealtime\(\)/.test(kt), 'the page load is timed');
console.log('Look restart tests passed.');
