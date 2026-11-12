const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Keep watching toggle tests...');
const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');

// Home settings win over home.keep_watching, and the default is on
assert(/KW_ON = typeof ST\.keep_watching === "boolean" \? ST\.keep_watching : HOME\.keep_watching !== false/.test(appJs), 'setting wins over config, default on');
// a toggle row in Home settings
assert(appJs.includes('key: "keep-watching"'), 'Home settings has the Show Keep watching row');
// off means no fetching: the per person calls and the Watch Next report are both gated
assert(/if \(!KW_ON\) return null;[^\n]*\n\s*return Promise\.all\(PEOPLE\.map/.test(appJs), '/api/continue is not called when off');
assert(appJs.includes('KW_ON ? sendWatchNext() : Promise.resolve()'), 'Watch Next report is skipped when off');
// off hides the section and leaves no shelf cards to focus
assert(/data\.shows = KW_ON \?/.test(appJs), 'no shows when off');
assert(/if \(!KW_ON\) \{ track\.innerHTML = ""; shelfEls = \[\]; return; \}/.test(appJs), 'no focusable cards when off');
assert(css.includes('html.kw-off #shelf-title'), 'css hides the heading when off');

// all 10 languages have the string
const count = (i18n.match(/\bkeep_show:/g) || []).length;
assert.strictEqual(count, 10, `keep_show must exist in all 10 languages (found ${count})`);
console.log('Keep watching toggle tests passed.');
