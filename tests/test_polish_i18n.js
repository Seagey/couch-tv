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

// Polish plurals change with the number (1 minuta, 2 minuty, 5 minut), and there is no plural
// mechanism, so never put a word right after a number. Only the unit "min", the unit "s" and
// "z" ("{n} z {max}") may follow one; anything else is a noun that would need a plural form.
const NUMBER_THEN_WORD = /\{(n|m|s|e|t|p|days|left|max|total|minutes|seconds)\} (?!(?:min|s|z)(?![\p{L}]))\p{Ll}/u;
function noPluralAfterNumber(where, table) {
  Object.keys(table).forEach(function (key) {
    assert(!NUMBER_THEN_WORD.test(table[key]), `${where} has a word after a number in ${key}: "${table[key]}"`);
  });
}
// the guard itself: these must be caught, and the safe forms must pass
['{n} aplikacji', '{n} programów', '{days} dni', '{n} odcinki', '{max} zdjęć', '{n} sekund', '{n} minut']
  .forEach(function (bad) { assert(NUMBER_THEN_WORD.test(bad), `the plural guard misses "${bad}"`); });
['{n} min', '{n} s', '{n} z {max}', 'Zdjęcia: {n}', '{name} jest', '{n} min.', '{n} s,']
  .forEach(function (ok) { assert(!NUMBER_THEN_WORD.test(ok), `the plural guard wrongly flags "${ok}"`); });
noPluralAfterNumber('the TV home', S.pl);

// a TV set to Polish speaks Polish without Home settings
assert.strictEqual(I18N.device(), 'pl', 'pl-PL picks pl');
assert.strictEqual(loadTv('pl').device(), 'pl', 'bare pl picks pl');

I18N.set('pl');
assert.strictEqual(I18N.lang(), 'pl');
assert.strictEqual(I18N.clock(), '24h');
assert.strictEqual(I18N.country(), 'PL');
assert.strictEqual(I18N.locale(), 'pl-PL');
assert.strictEqual(I18N.t('n_min', { n: 5 }), '5 min');

assert.strictEqual(typeof I18N.tBridge, 'function', 'tv-home/web/i18n.js exposes I18N.tBridge');
assert.strictEqual(
  I18N.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'Aplikacja Netflix nie jest zainstalowana na telewizorze',
  'tv-home tBridge returns Polish translation when lang is pl'
);
assert.strictEqual(
  I18N.tBridge(null, null, 'Fallback text'),
  'Fallback text',
  'tv-home tBridge returns fallback when key is null'
);
assert.strictEqual(
  I18N.tBridge('err_unknown_nonexistent_key', null, 'Fallback text'),
  'Fallback text',
  'tv-home tBridge returns fallback when key is unknown'
);
const tvEs = loadTv('es-ES');
tvEs.set('es');
assert.strictEqual(
  tvEs.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'Netflix is not installed on the TV',
  'tv-home tBridge returns fallback (not S.en) when lang does not define key'
);

// The phone remote (remote/src/i18n.js) is an ES module that imports react, so cut the
// S.en and S.pl object literals out of the text and evaluate just those.
const rsrc = fs.readFileSync(path.join(__dirname, '../remote/src/i18n.js'), 'utf8');
function literal(name) {
  const m = rsrc.match(new RegExp('^S' + name.replace('.', '\\.') + ' = (\\{[\\s\\S]*?\\n\\});', 'm'));
  assert(m, `the phone remote has an S${name} block`);
  return new Function('return ' + m[1])();
}
const R = { en: literal('.en'), pl: literal('.pl') };
assert.deepStrictEqual(Object.keys(R.pl), Object.keys(R.en), 'the remote S.pl has the same keys as S.en, in the same order');
Object.keys(R.en).forEach(function (key) {
  assert.strictEqual(holes(R.pl[key]), holes(R.en[key]), `remote placeholders differ for ${key}: "${R.pl[key]}"`);
});
noPluralAfterNumber('the phone remote', R.pl);
assert(rsrc.includes("{ id: 'pl', name: 'Polski', locale: 'pl-PL' },\n"), 'the remote LANGS has Polski (pl-PL)');
// a phone set to Polish starts in Polish before it has heard the TV's language
const guessFn = rsrc.match(/function guess\(\) \{[\s\S]*?\n\}/);
assert(guessFn && /\/\^pl\/i\.test\(n\)\) return 'pl';/.test(guessFn[0]), 'guess() returns pl for a Polish phone');

// tBridge(key, vars, fallback) in remote/src/i18n.js
function loadRemote(language) {
  const cleaned = rsrc
    .replace(/^import .*?;\n/m, 'const useEffect = () => {}, useState = (v) => [v, () => {}];\n')
    .replace(/^export /gm, '');
  const sandbox = {
    navigator: { language },
    document: { documentElement: {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    Set,
  };
  vm.runInNewContext(cleaned + '\nthis.__exports = { tBridge, setChoice };', sandbox);
  return sandbox.__exports;
}

const remotePl = loadRemote('pl-PL');
assert.strictEqual(typeof remotePl.tBridge, 'function', 'remote/src/i18n.js exports tBridge');
assert.strictEqual(
  remotePl.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'Aplikacja Netflix nie jest zainstalowana na telewizorze',
  'tBridge returns Polish translation when lang is pl'
);
assert.strictEqual(
  remotePl.tBridge(null, null, 'Fallback text'),
  'Fallback text',
  'tBridge returns fallback when key is null'
);
assert.strictEqual(
  remotePl.tBridge(undefined, null, 'Fallback text'),
  'Fallback text',
  'tBridge returns fallback when key is undefined'
);
assert.strictEqual(
  remotePl.tBridge('err_unknown_nonexistent_key', null, 'Fallback text'),
  'Fallback text',
  'tBridge returns fallback when key is unknown'
);

const remoteEs = loadRemote('es-ES');
assert.strictEqual(
  remoteEs.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'Netflix is not installed on the TV',
  'tBridge returns fallback (not S.en) when lang does not define key'
);

// Cross-repo parity: every err_*, note_*, ask_* key emitted by bridge/*.py (plus client-side
// error keys from remote/src/api.js) must exist in both S.en and S.pl.
const bridgeDir = path.join(__dirname, '../bridge');
const bridgeKeys = new Set([
  'err_bridge_timeout',
  'err_bridge_unreachable',
  'err_tv_not_connected',
  'err_not_found',
  'err_something_wrong',
]);
for (const file of fs.readdirSync(bridgeDir)) {
  if (!file.endsWith('.py') || file.startsWith('test_')) continue;
  const py = fs.readFileSync(path.join(bridgeDir, file), 'utf8');
  const re = /['"]((?:err|note|ask)_[a-z0-9_]+)['"]/g;
  let m;
  while ((m = re.exec(py)) !== null) {
    const k = m[1];
    if (k === 'note_key' || k === 'note_vars' || k === 'error_key' || k === 'error_vars') continue;
    bridgeKeys.add(k);
  }
}
for (const key of Array.from(bridgeKeys).sort()) {
  assert(key in R.en, `remote S.en is missing bridge key ${key}`);
  assert(key in R.pl, `remote S.pl is missing bridge key ${key}`);
  if (/^(err|note)_/.test(key) && ![
    'err_bridge_timeout',
    'err_bridge_unreachable',
    'err_not_found',
    'err_something_wrong',
  ].includes(key)) {
    assert(key in S.en, `tv-home S.en is missing bridge key ${key}`);
    assert(key in S.pl, `tv-home S.pl is missing bridge key ${key}`);
  }
}

console.log('Polish i18n tests passed.');
