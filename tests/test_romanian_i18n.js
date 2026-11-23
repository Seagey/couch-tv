const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Romanian i18n tests...');

const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8').replace(/\r\n/g, '\n');
function loadTv(language) {
  const sandbox = { window: {}, navigator: { language }, document: { documentElement: {} } };
  vm.runInNewContext(src, sandbox);
  return { I18N: sandbox.window.I18N, html: sandbox.document.documentElement };
}

const tv = loadTv('ro-RO');
const I18N = tv.I18N;
const S = I18N.strings;
assert(S.ro, 'the TV home has a Romanian (ro) block');
assert(I18N.langs.some((lang) => lang.id === 'ro'), 'ro is in LANGS');

const holes = (text) => (text.match(/\{\w+\}/g) || []).slice().sort().join(',');
Object.keys(S.en).filter((key) => !/^(err|note)_/.test(key)).forEach((key) => {
  assert(key in S.ro, `S.ro is missing ${key}`);
});
Object.keys(S.ro).forEach((key) => {
  assert(key in S.en, `S.ro has ${key}, which English does not`);
  assert.strictEqual(typeof S.ro[key], 'string', `${key} is a plain string`);
  assert.strictEqual(holes(S.ro[key]), holes(S.en[key]), `placeholders differ for ${key}: "${S.ro[key]}"`);
});

assert.strictEqual(I18N.device(), 'ro', 'ro-RO picks Romanian');
assert.strictEqual(loadTv('ro').I18N.device(), 'ro', 'bare ro picks Romanian');
assert.strictEqual(loadTv('ro-MD').I18N.device(), 'ro', 'ro-MD picks Romanian');

I18N.set('ro');
assert.strictEqual(I18N.lang(), 'ro');
assert.strictEqual(tv.html.lang, 'ro-RO');
assert.strictEqual(tv.html.dir, 'ltr');
assert.strictEqual(I18N.clock(), '24h');
assert.strictEqual(I18N.country(), 'RO');
assert.strictEqual(I18N.locale(), 'ro-RO');
assert.strictEqual(I18N.t('kids_ep', { s: 2, e: 4 }), 'Sezonul 2, episodul 4');
assert.strictEqual(I18N.t('loc_none', { q: 'Sâmburești' }), 'Nu s-a găsit nimic pentru „Sâmburești”.');
assert.strictEqual(
  I18N.tBridge('err_app_not_installed', { app: 'Netflix' }, 'Netflix is not installed on the TV'),
  'Netflix is not installed on the TV',
  'bridge messages without Romanian translations use their supplied fallback'
);

console.log('Romanian i18n tests passed.');
