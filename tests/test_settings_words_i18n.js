// The TV's Settings words (the phone card, the new left list, More and the music card rows) are in every
// language the TV speaks, never English in a German home (28 Nov 2026). es-MX only lists what Mexico says
// differently and falls back to es.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Settings words i18n tests...');
const src = fs.readFileSync(path.join(__dirname, '../tv-home/web/i18n.js'), 'utf8');
const sandbox = { window: {}, navigator: { language: 'en' }, document: { documentElement: {} } };
vm.runInNewContext(src, sandbox);
const I18N = sandbox.window.I18N, S = I18N.strings;

const KEYS = ['set_title', 'set_phone', 'set_phone_sub', 'set_phone2_head', 'set_phone2_sub', 'sec_phone', 'sec_picture',
  'sec_remote', 'sec_thistv', 'sec_more', 'sec_help', 'set_more_hint', 'sec_music',
  'spotify_card_style', 'spotify_mini_align', 'spotify_heading_np', 'np_shuffle', 'np_repeat_one', 'music_sleep_set',
  'audio_output', 'audio_out_wired'];
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
I18N.langs.forEach(function (l) {
  if (l.id === 'en') return;
  I18N.set(l.id);
  KEYS.forEach(function (k) {
    const own = S[l.id][k] != null ? S[l.id][k] : (l.base && S[l.base][k]);
    assert(own != null, l.id + ' is missing ' + k);
    assert.strictEqual(holes(own), holes(S.en[k]), l.id + ' placeholders differ for ' + k);
    assert(!/[–—]/.test(own), l.id + ' ' + k + ' has a long dash');
  });
});
// the left list names come from the words, not English typed into app.js
const app = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8');
assert(!/"Picture and sound"|"Remote and buttons"|"\(Updates, help, reset\)"/.test(app), 'app.js still has the English list names');
assert(/t\("set_more_hint"\)/.test(app), 'the More hint is translated');
I18N.set('de');
assert.strictEqual(I18N.t('sec_picture'), 'Bild und Ton');
console.log('Settings words i18n tests passed.');
