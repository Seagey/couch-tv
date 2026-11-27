const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Korean i18n tests...');

// The TV home (tv-home/web/i18n.js): load it the way the TV does, with a Korean TV language.
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function loadTv(language) {
  const sandbox = { window: {}, navigator: { language: language }, document: { documentElement: {} } };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.I18N;
}

const I18N = loadTv('ko-KR');
const S = I18N.strings;
assert(S.ko, 'the TV home has a Korean (ko) block');
const koLang = I18N.langs.filter(function (l) { return l.id === 'ko'; })[0];
assert(koLang, 'ko is in LANGS');
assert.strictEqual(koLang.name, '한국어');
assert.strictEqual(koLang.locale, 'ko-KR');
assert.strictEqual(koLang.clock, undefined, 'ko keeps the 12 hour clock (오전/오후)');
assert.strictEqual(koLang.country, 'KR', 'ko looks for places in South Korea first');

// every English word has a Korean one, with the same {placeholders}
const holes = function (s) { return (s.match(/\{\w+\}/g) || []).slice().sort().join(','); };
Object.keys(S.en).forEach(function (key) {
  assert(key in S.ko, `S.ko is missing ${key}`);
  assert.strictEqual(holes(S.ko[key]), holes(S.en[key]), `placeholders differ for ${key}: "${S.ko[key]}"`);
});
Object.keys(S.ko).forEach(function (key) {
  assert(key in S.en, `S.ko has ${key}, which English does not`);
});

// a TV set to Korean speaks Korean without Home settings
assert.strictEqual(I18N.device(), 'ko', 'ko-KR picks ko');
assert.strictEqual(loadTv('ko').device(), 'ko', 'bare ko picks ko');

I18N.set('ko');
assert.strictEqual(I18N.lang(), 'ko');
assert.strictEqual(I18N.clock(), '12h');
assert.strictEqual(I18N.country(), 'KR');
assert.strictEqual(I18N.locale(), 'ko-KR');
assert.strictEqual(I18N.t('n_min', { n: 5 }), '5분');
assert.strictEqual(I18N.t('keep_watching'), '이어서 보기');
assert.strictEqual(I18N.t('am'), '오전');
assert.strictEqual(
  I18N.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'TV에 Netflix이(가) 설치되어 있지 않아요',
  'tBridge returns the Korean translation when lang is ko'
);

// The phone remote (remote/src/i18n.js) is an ES module that imports react, so cut the
// S.en and S.ko object literals out of the text and evaluate just those.
const rsrc = fs.readFileSync(path.join(__dirname, '../remote/src/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function literal(name) {
  const m = rsrc.match(new RegExp('^S\\.' + name + ' = (\\{[\\s\\S]*?\\n\\});', 'm'));
  assert(m, `the phone remote has an S.${name} block`);
  return new Function('return ' + m[1])();
}
const R = { en: literal('en'), ko: literal('ko') };
assert.deepStrictEqual(Object.keys(R.ko), Object.keys(R.en), 'the remote S.ko has the same keys as S.en, in the same order');
Object.keys(R.en).forEach(function (key) {
  assert.strictEqual(holes(R.ko[key]), holes(R.en[key]), `remote placeholders differ for ${key}: "${R.ko[key]}"`);
});
assert(rsrc.includes("{ id: 'ko', name: '한국어', locale: 'ko-KR' },\n"), 'the remote LANGS has 한국어 (ko)');
const guessFn = rsrc.match(/function guess\(\) \{[\s\S]*?\n\}/);
assert(guessFn && guessFn[0].includes("if (/^ko(?:-|$)/i.test(n)) return 'ko';"), 'guess() returns ko for a Korean phone');

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
  vm.runInNewContext(cleaned + '\nthis.__exports = { t, tBridge, setChoice, locale };', sandbox);
  return sandbox.__exports;
}
const remoteKo = loadRemote('ko-KR');
assert.strictEqual(remoteKo.locale(), 'ko-KR', 'a Korean phone starts in Korean');
assert.strictEqual(remoteKo.t('turn_on'), 'TV 켜기');
assert.strictEqual(remoteKo.t('min_left', { n: 12 }), '12분 남음');
assert.strictEqual(
  remoteKo.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'TV에 Netflix이(가) 설치되어 있지 않아요'
);

console.log('Korean i18n tests passed.');
