// The TV's English words use Australian spelling (28 Nov 2026: the emulator test saw "Sunlight color grading").
// Every English string on the TV home is swept for the usual US spellings.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running TV words spelling tests...');
const sandbox = { window: {}, navigator: { language: 'en' }, document: { documentElement: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8'), sandbox);
const en = sandbox.window.I18N.strings.en;
const US = /\b(colors?|colored|coloring|center(s|ed)?|favorites?|gray|organiz\w*|customiz\w*|personaliz\w*|realiz\w*|recogniz\w*|behaviors?|theaters?|canceled|canceling|labeled|traveled|analyz\w*|synchroniz\w*|prioritiz\w*|authoriz\w*|initializ\w*|optimiz\w*|minimiz\w*|maximiz\w*|humor|honor\w*|flavor\w*|neighbor\w*|catalog|meters?|liters?)\b/i;
const bad = Object.keys(en).filter((k) => US.test(String(en[k]))).map((k) => k + ': ' + en[k]);
assert.deepStrictEqual(bad, [], 'US spellings in the TV words:\n' + bad.join('\n'));
assert.strictEqual(en.wx_sun_grade, 'Sunlight colour grading');
console.log('TV words spelling tests passed.');
