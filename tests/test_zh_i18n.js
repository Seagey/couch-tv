const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Simplified Chinese i18n tests...');

// The TV home (tv-home/web/i18n.js): load it the way the TV does, with a Chinese TV language.
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function loadTv(language) {
  const sandbox = { window: {}, navigator: { language: language }, document: { documentElement: {} } };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.I18N;
}

const I18N = loadTv('zh-CN');
const S = I18N.strings;
assert(S['zh-CN'], "the TV home has a Simplified Chinese (zh-CN) block");
assert(I18N.langs.some(function (l) { return l.id === 'zh-CN'; }), 'zh-CN is in LANGS');
const zhLang = I18N.langs.filter(function (l) { return l.id === 'zh-CN'; })[0];
assert.strictEqual(zhLang.locale, 'zh-CN');
assert.strictEqual(zhLang.clock, '24h', 'zh-CN says 24 hour');
assert.strictEqual(zhLang.country, 'CN', 'zh-CN looks for places in China first');

// every English word has a Chinese one, with the same {placeholders}
const holes = function (s) { return (s.match(/\{\w+\}/g) || []).slice().sort().join(','); };
Object.keys(S.en).forEach(function (key) {
  assert(key in S['zh-CN'], `S["zh-CN"] is missing ${key}`);
  assert.strictEqual(holes(S['zh-CN'][key]), holes(S.en[key]), `placeholders differ for ${key}: "${S['zh-CN'][key]}"`);
});
Object.keys(S['zh-CN']).forEach(function (key) {
  assert(key in S.en, `S["zh-CN"] has ${key}, which English does not`);
});

// a TV set to Chinese speaks Chinese without Home settings
assert.strictEqual(I18N.device(), 'zh-CN', 'zh-CN picks zh-CN');
assert.strictEqual(loadTv('zh').device(), 'zh-CN', 'bare zh picks zh-CN');
assert.strictEqual(loadTv('zh-Hans-CN').device(), 'zh-CN', 'zh-Hans-CN picks zh-CN');

I18N.set('zh-CN');
assert.strictEqual(I18N.lang(), 'zh-CN');
assert.strictEqual(I18N.clock(), '24h');
assert.strictEqual(I18N.country(), 'CN');
assert.strictEqual(I18N.locale(), 'zh-CN');
assert.strictEqual(I18N.t('n_min', { n: 5 }), '5 分钟');
assert.strictEqual(I18N.t('keep_watching'), '继续观看');

assert.strictEqual(typeof I18N.tBridge, 'function', 'tv-home/web/i18n.js exposes I18N.tBridge');
assert.strictEqual(
  I18N.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  '电视上没有安装 Netflix',
  'tv-home tBridge returns the Chinese translation when lang is zh-CN'
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
// S.en and S['zh-CN'] object literals out of the text and evaluate just those.
const rsrc = fs.readFileSync(path.join(__dirname, '../remote/src/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function literal(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = rsrc.match(new RegExp('^S' + esc + ' = (\\{[\\s\\S]*?\\n\\});', 'm'));
  assert(m, `the phone remote has an S${name} block`);
  return new Function('return ' + m[1])();
}
const R = { en: literal('.en'), zh: literal("['zh-CN']") };
assert.deepStrictEqual(Object.keys(R.zh), Object.keys(R.en), 'the remote S[\'zh-CN\'] has the same keys as S.en, in the same order');
Object.keys(R.en).forEach(function (key) {
  assert.strictEqual(holes(R.zh[key]), holes(R.en[key]), `remote placeholders differ for ${key}: "${R.zh[key]}"`);
});
assert(rsrc.includes("{ id: 'zh-CN', name: '简体中文', locale: 'zh-CN' },\n"), 'the remote LANGS has 简体中文 (zh-CN)');
// a phone set to Chinese starts in Chinese before it has heard the TV's language
const guessFn = rsrc.match(/function guess\(\) \{[\s\S]*?\n\}/);
assert(guessFn && /\/\^zh\(\?:-\|\$\)\/i\.test\(n\)\) return 'zh-CN';/.test(guessFn[0]), 'guess() returns zh-CN for a Chinese phone');

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

const remoteZh = loadRemote('zh-CN');
assert.strictEqual(typeof remoteZh.tBridge, 'function', 'remote/src/i18n.js exports tBridge');
assert.strictEqual(
  remoteZh.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  '电视上没有安装 Netflix',
  'tBridge returns the Chinese translation when lang is zh-CN'
);
assert.strictEqual(
  remoteZh.tBridge(null, null, 'Fallback text'),
  'Fallback text',
  'tBridge returns fallback when key is null'
);
assert.strictEqual(
  remoteZh.tBridge(undefined, null, 'Fallback text'),
  'Fallback text',
  'tBridge returns fallback when key is undefined'
);
assert.strictEqual(
  remoteZh.tBridge('err_unknown_nonexistent_key', null, 'Fallback text'),
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
// error keys from remote/src/api.js) must exist in both S.en and S['zh-CN'].
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
  assert(key in R.zh, `remote S['zh-CN'] is missing bridge key ${key}`);
  if (/^(err|note)_/.test(key) && ![
    'err_bridge_timeout',
    'err_bridge_unreachable',
    'err_not_found',
    'err_something_wrong',
  ].includes(key)) {
    assert(key in S.en, `tv-home S.en is missing bridge key ${key}`);
    assert(key in S['zh-CN'], `tv-home S['zh-CN'] is missing bridge key ${key}`);
  }
}

console.log('Simplified Chinese (zh-CN) i18n tests passed.');
