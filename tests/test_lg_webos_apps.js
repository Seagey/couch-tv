// lg/app/webos.js reads the TV's launch points into window.TVOS. LG's store ("Apps") takes the
// App Store tile, and an app with no entry in the app table (Fubo) is still listed with its icon.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '../lg/app/webos.js'), 'utf8');
const store = {
  'couch.webos.apps': JSON.stringify([
    { id: 'com.webos.app.discovery', title: 'Apps', icon: 'https://192.0.2.1:3001/resources/x/lgstore_130x130.png' },
    { id: 'app.couchtv.home', title: 'Couch TV', icon: '' },
    { id: 'app.couchtv.helper', title: 'Couch TV Home Button', icon: '' },
    { id: 'netflix', title: 'Netflix', icon: '' },
    { id: 'com.fubotv.app', title: 'Fubo: Watch Live TV & Sports', icon: '/usr/palm/applications/com.fubotv.app/icon.png' },
    { id: 'com.webos.app.livetv', title: 'Live TV', icon: '' },
  ]),
};
const window = {
  COUCH_WEBOS: {},
  COUCH_WEBOS_APPS: { 'com.netflix.ninja': { name: 'Netflix', ids: ['netflix'], logo: true } },
  COUCH_WEBOS_LOGOS: {},
  addEventListener() {},
};
const ctx = {
  window, location: { search: '' }, document: { addEventListener() {} },
  localStorage: { getItem: (k) => store[k] || null, setItem() {} },
};
vm.runInNewContext(src, ctx);

assert(window.TVOS, 'webos.js sets window.TVOS');
const apps = JSON.parse(window.TVOS.apps());
assert.deepStrictEqual(apps.map((a) => a.package), ['com.android.vending', 'com.netflix.ninja', 'com.fubotv.app']);
assert.strictEqual(window.TVOS.iconUrl('com.android.vending'), 'https://192.0.2.1:3001/resources/x/lgstore_130x130.png');
assert.strictEqual(window.TVOS.iconUrl('com.netflix.ninja'), 'logos/com.netflix.ninja.png');
assert.strictEqual(window.TVOS.iconUrl('com.fubotv.app'), 'file:///usr/palm/applications/com.fubotv.app/icon.png');
console.log('LG webOS app list tests passed.');

// With a bridge, an icon on the TV's self-signed port comes through the bridge instead.
const withBridge = { ...window, TVOS: undefined };
vm.runInNewContext(src, { ...ctx, window: withBridge, location: { search: '?api=http%3A%2F%2F192.0.2.9%3A5400&tv=lounge' } });
assert.strictEqual(withBridge.TVOS.iconUrl('com.android.vending'),
  'http://192.0.2.9:5400/api/webos/icon/com.webos.app.discovery?tv=lounge');
assert.strictEqual(withBridge.TVOS.iconUrl('com.fubotv.app'), 'file:///usr/palm/applications/com.fubotv.app/icon.png');
console.log('LG webOS icon through the bridge tests passed.');
