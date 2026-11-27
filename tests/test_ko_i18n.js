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

console.log('Korean i18n tests passed.');
