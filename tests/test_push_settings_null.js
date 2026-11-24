// The 400 ms settings save in a fresh frame: kept(ST_KEY) can be null, and pushSettings(null) threw
// "Cannot read properties of null (reading 's')". Both the call and pushSettings itself now cope.
// A source check plus the function run on its own. Run: node tests/test_push_settings_null.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running push settings null tests...');
const source = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8').replace(/\r\n/g, '\n');

assert(!/pushSettings\(kept\(ST_KEY\)\)/.test(source), 'a bare pushSettings(kept(ST_KEY)) is back');
assert(/pushSettings\(kept\(ST_KEY\) \|\| keepSettings\(true\)\)/.test(source), 'the save timer must fall back to keepSettings(true)');

// run pushSettings itself, cut out of app.js, with a null record
const start = source.indexOf('  function pushSettings(rec) {');
const end = source.indexOf('  // the server\'s copy is newer', start);
assert(start > 0 && end > start, 'pushSettings not found');
let posted = null;
const ctx = {
  ST: { a: 1 }, SEEN: null, ON_TV: false, canon: JSON.stringify, ST_KEY: 'k',
  keep() {}, takeServerSettings() {},
  keepSettings(pending) { return { s: ctx.ST, updated: 1, pending }; },
  api(method, url, body) { posted = body; return { then(ok) { ok({}); return this; } }; },
  Object, Array,
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end) + '\nthis.pushSettings = pushSettings;', ctx);
ctx.pushSettings(null);
assert.deepStrictEqual(posted.settings, { a: 1 });
console.log('ok');
