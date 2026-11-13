const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Polish i18n tests...');

// The TV home (tv-home/web/i18n.js): load it the way the TV does, with a Polish TV language.
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8');
function loadTv(language) {
  const sandbox = { window: {}, navigator: { language: language }, document: { documentElement: {} } };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.I18N;
}

const I18N = loadTv('pl-PL');
const S = I18N.strings;
assert(S.pl, 'the TV home has a Polish (pl) block');
assert(I18N.langs.some(function (l) { return l.id === 'pl'; }), 'pl is in LANGS');

// every English word has a Polish one, with the same {placeholders}
const holes = function (s) { return (s.match(/\{\w+\}/g) || []).slice().sort().join(','); };
Object.keys(S.en).forEach(function (key) {
  assert(key in S.pl, `S.pl is missing ${key}`);
  assert.strictEqual(holes(S.pl[key]), holes(S.en[key]), `placeholders differ for ${key}: "${S.pl[key]}"`);
});
Object.keys(S.pl).forEach(function (key) {
  assert(key in S.en, `S.pl has ${key}, which English does not`);
});

// Polish plurals change with the number: never put a counted noun right after it
Object.keys(S.pl).forEach(function (key) {
  assert(!/\{\w+\} (sekund|minut|zdjęć|dni|godzin|cyfr|osób)/.test(S.pl[key]), `plural after a number in ${key}: "${S.pl[key]}"`);
});

// a TV set to Polish speaks Polish without Home settings
assert.strictEqual(I18N.device(), 'pl', 'pl-PL picks pl');
assert.strictEqual(loadTv('pl').device(), 'pl', 'bare pl picks pl');

I18N.set('pl');
assert.strictEqual(I18N.lang(), 'pl');
assert.strictEqual(I18N.clock(), '24h');
assert.strictEqual(I18N.country(), 'PL');
assert.strictEqual(I18N.locale(), 'pl-PL');
assert.strictEqual(I18N.t('n_min', { n: 5 }), '5 min');

console.log('Polish i18n tests passed.');
