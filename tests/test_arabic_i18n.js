const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Arabic i18n tests...');

// The TV home (tv-home/web/i18n.js): load it the way the TV does, with an Arabic TV language.
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function loadTv(language) {
  const sandbox = { window: {}, navigator: { language: language }, document: { documentElement: {} } };
  vm.runInNewContext(src, sandbox);
  return { I18N: sandbox.window.I18N, html: sandbox.document.documentElement };
}

const tv = loadTv('ar-SA');
const I18N = tv.I18N;
const S = I18N.strings;
assert(S.ar, 'the TV home has an Arabic (ar) block');
assert(I18N.langs.some(function (l) { return l.id === 'ar'; }), 'ar is in LANGS');

// every home word has an Arabic one, with the same {placeholders}. Bridge messages (err_, note_)
// stay in English for now, as in Hebrew.
const holes = function (s) { return (s.match(/\{\w+\}/g) || []).slice().sort().join(','); };
Object.keys(S.en).filter(function (key) { return !/^(err|note)_/.test(key); }).forEach(function (key) {
  assert(key in S.ar, `S.ar is missing ${key}`);
});
Object.keys(S.ar).forEach(function (key) {
  assert(key in S.en, `S.ar has ${key}, which English does not`);
  assert.strictEqual(typeof S.ar[key], 'string', `${key} is a plain string`);
  assert.strictEqual(holes(S.ar[key]), holes(S.en[key]), `placeholders differ for ${key}: "${S.ar[key]}"`);
});

// a TV set to Arabic speaks Arabic without Home settings
assert.strictEqual(I18N.device(), 'ar', 'ar-SA picks ar');
assert.strictEqual(loadTv('ar').I18N.device(), 'ar', 'bare ar picks ar');
assert.strictEqual(loadTv('ar-EG').I18N.device(), 'ar', 'ar-EG picks ar');

// right to left, the same switch Hebrew uses, and back to left to right for English
I18N.set('ar');
assert.strictEqual(I18N.lang(), 'ar');
assert.strictEqual(tv.html.dir, 'rtl', 'Arabic lays the home out right to left');
assert.strictEqual(I18N.clock(), '12h');
assert.strictEqual(I18N.country(), 'SA');
// Gregorian calendar and Western digits, so the date under the clock matches the clock itself
assert.strictEqual(I18N.locale(), 'ar-SA-u-ca-gregory-nu-latn');
const day = new Date(2026, 10, 15).toLocaleDateString(I18N.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
assert(/15/.test(day), `the date uses Western digits: "${day}"`);
assert.strictEqual(I18N.t('kids_ep', { s: 1, e: 4 }), 'الموسم 1، الحلقة 4');
I18N.set('en');
assert.strictEqual(tv.html.dir, 'ltr', 'English goes back to left to right');

console.log('Arabic i18n tests passed.');
