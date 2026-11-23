// #200: the Settings key (and the gear tile) opens a menu with Home settings and TV settings, and now also
// Wi-Fi, Bluetooth and Screen off where the TV or the on-TV app can open those screens. Nothing is
// toggled from the menu; each entry opens the same screen as its quick button.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-home', 'web', 'app.js'), 'utf8');
const m = js.match(/function gearItems\(\) \{[\s\S]*?\n    return items;\n  \}/);
assert(m, 'gearItems is in app.js');

function build(env) {
  const calls = [];
  const names = ['ICONS', 't', 'updReady', 'UPD', 'openSettings', 'openTvSettings', 'nativeSettingsScreen', 'ON_TV', 'OFFLINE',
    'closeGear', 'paintFocus', 'openSettingsScreen', 'toggleScreenOff', 'TV'];
  const vals = [
    new Proxy({}, { get: (_, k) => '<' + String(k) + '>' }),
    (k) => k,
    () => false, {},
    () => calls.push('home'), () => calls.push('tv'),
    () => env.native, env.onTv, env.offline,
    () => calls.push('close'), () => calls.push('paint'),
    (w) => calls.push('screen:' + w), (on) => calls.push('off:' + on),
    env.tv || null
  ];
  const gearItems = new Function(...names, m[0] + '; return gearItems;')(...vals);
  return { items: gearItems(), calls };
}
const titles = (r) => r.items.map((i) => i.ti);

// the launcher can open the system screens itself: all five
let r = build({ native: true, onTv: false, offline: true });
assert.deepStrictEqual(titles(r), ['gear_home', 'gear_tv', 'network', 'bluetooth', 'screen_off']);

// the on-TV app (not offline) can too
r = build({ native: false, onTv: true, offline: false });
assert.deepStrictEqual(titles(r), ['gear_home', 'gear_tv', 'network', 'bluetooth', 'screen_off']);

// nothing can open them: the two it always had, plus Screen off (it needs no bridge)
r = build({ native: false, onTv: false, offline: true });
assert.deepStrictEqual(titles(r), ['gear_home', 'gear_tv', 'screen_off']);
r = build({ native: false, onTv: true, offline: true });
assert.deepStrictEqual(titles(r), ['gear_home', 'gear_tv', 'screen_off'], 'the on-TV app without its server cannot open them');

// each entry does what its quick button does, and closes the menu first
r = build({ native: true, onTv: false, offline: true });
r.items[0].act(); r.items[1].act();
assert.deepStrictEqual(r.calls, ['home', 'tv']);
r.calls.length = 0; r.items[2].act();
assert.deepStrictEqual(r.calls, ['close', 'paint', 'screen:network']);
r.calls.length = 0; r.items[3].act();
assert.deepStrictEqual(r.calls, ['close', 'paint', 'screen:bluetooth']);
r.calls.length = 0; r.items[4].act();
assert.deepStrictEqual(r.calls, ['close', 'paint', 'off:true']);

// the on-TV app's own Phone remote screen (launch audit, 24 Nov 2026: /get says Settings, then Phone remote): before
// Screen off, and OK closes the menu and opens it
r = build({ native: false, onTv: true, offline: false, tv: { openPhoneRemote: () => { r.calls.push('phone'); return true; } } });
assert.deepStrictEqual(titles(r), ['gear_home', 'gear_tv', 'network', 'bluetooth', 'gear_phone', 'screen_off']);
r.calls.length = 0; r.items[4].act();
assert.deepStrictEqual(r.calls, ['close', 'paint', 'phone']);
// a TV whose app has no such screen (the TV home app, a browser): not listed
r = build({ native: true, onTv: false, offline: true, tv: { launch: () => true } });
assert(!titles(r).includes('gear_phone'));

// the menu's own movement and OK use the list, not a fixed two
assert(!/gi = Math\.max\(0, Math\.min\(1, gi \+ dy\)\)/.test(js), 'the arrows are not limited to two entries');
assert(!/gi = wrapIndex\(2, dy\)/.test(js), 'wrapping is not limited to two entries');
assert(!/if \(gi === 0\) openSettings\(\); else openTvSettings\(\)/.test(js), 'OK runs the entry that is focused');
console.log('Gear menu tests passed.');
