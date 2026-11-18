// Keep watching follows the app the remote is on (home.shelf_follows_app): the row's own code from app.js
// runs here with a stand in page, the way tests/test_fire_app_store.js runs the dock. Run: node tests/test_shelf_follows_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Keep watching follows the app tests...');
const web = path.join(__dirname, '../tv-home/web');
const source = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const mock = fs.readFileSync(path.join(web, 'mock.js'), 'utf8');

// ---------------- a stand in for the page ----------------
function el() {
  const classes = new Set();
  const e = {
    textContent: '', _html: '', children: [], style: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined) on = !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
    },
  };
  // the cards drawn: one child per card, as the page's own children would be
  Object.defineProperty(e, 'innerHTML', {
    get: () => e._html,
    set: (html) => { e._html = html; e.children = (html.match(/<div class="tile /g) || []).map(() => el()); },
  });
  return e;
}
const els = { shelf: el(), 'shelf-section': el(), 'shelf-title': el() };
const storage = {};
const context = {
  console, Date, JSON, Math, String, Array, Object,
  setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; }, removeItem: (k) => { delete storage[k]; } },
  document: { documentElement: el(), createElement: el },
  $: (id) => els[id],
  t: (k, v) => (k === 'recently_on' ? 'Recently on ' + v.app : k),
  esc: (v) => String(v == null ? '' : v), slim: (u) => u, iconUrl: () => '',
  renderPeople() {}, addCards() {}, kidsOn: () => false, npVisible: () => false, gridKey: (a) => 'app:' + a.package,
  whoIndex: () => 0, peopleCount: () => 1,
  scrollCalls: 0, scrollShelf() { context.scrollCalls++; },
  KEEP_MAX: 10, KW_ON: true, NIGHT: false, CARDS: [], SHELF_FOLLOW: true, lift: null, touched: true,
  PEOPLE: [{ id: 'p1', name: 'Person 1' }], who: 'p1',
  data: { shows: [], showsBy: { p1: [] }, videosBy: { p1: [] }, apps: [] },
  zone: 'grid', s: 0, g: 0, shelfEls: [], gridItems: [],
};
vm.createContext(context);
function part(from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert(a >= 0 && b > a, 'app.js has ' + from.trim());
  return source.slice(a, b);
}
// the row's code: followPkg and its helpers, followSync, rowHasCards and renderShelf; subtitle; the focus memory
vm.runInContext(part('  var followPkg = null', '  // ---------------- custom cards'), context);
vm.runInContext(part('  function subtitle(it) {', '  function peopleCount()'), context);
vm.runInContext(part('  var FOCUS_KEY = ', '  function goHome()'), context);
// shelfReach (restoreFocus asks it), with designHides: no couch-tv Studio design here, so nothing is hidden
vm.runInContext(part('  function designHides(part)', '  function picLabel()'), context);

const FIRE_YOUTUBE = 'com.amazon.firetv.youtube', NETFLIX = 'com.netflix.ninja', DISNEY = 'com.disney.disneyplus';
const app = (pkg, name) => ({ kind: 'app', package: pkg, name });
const show = (id, pkg, name) => ({ id, title: 'Show ' + id, app: { package: pkg, name }, kind: 'continue' });
const video = (id, title) => ({ id, title, app: { package: FIRE_YOUTUBE, name: 'YouTube' }, kind: 'video', poster: null });
const ids = () => context.data.shows.map((it) => it.id);
const hidden = () => els['shelf-section'].classList.contains('empty');
const title = () => els['shelf-title'].textContent;
function reset(shows, videos, apps) {
  context.data = { shows: [], showsBy: { p1: shows }, videosBy: { p1: videos }, apps };
  context.gridItems = apps; context.zone = 'grid'; context.g = 0; context.s = 0;
  context.followPkg = null; context.shelfShown = ''; context.SHELF_FOLLOW = true; context.KW_ON = true; context.scrollCalls = 0;
  context.renderShelf();
}

// ---------------- a person whose only history is YouTube videos (the Fire TV Cube case) ----------------
const cube = [app(FIRE_YOUTUBE, 'YouTube'), app(NETFLIX, 'Netflix')];
reset([], [video('v1', 'How Trains Work'), video('v2', 'Lo-fi beats')], cube);
assert(hidden(), 'with nothing on the go and the remote elsewhere the row is hidden');
assert.strictEqual(context.followSync(), true, 'on the YouTube tile the row is drawn again');
assert.deepStrictEqual(ids(), ['v1', 'v2'], 'the videos are the row');
assert.strictEqual(title(), 'Recently on YouTube');
assert(!hidden(), 'the row is on screen: the videos count, not only showsBy');
assert.strictEqual(context.shelfEls.length, 2);
assert(context.rowHasCards(), 'rowHasCards sees the videos');
assert(/var anyone = rowHasCards\(\);\n\s*\$\("shelf-section"\)\.classList\.toggle\("empty", !anyone && !on\);/.test(source), 'renderNp (Night look) hides the row on the same answer');
assert.strictEqual(context.subtitle(context.data.shows[0]), 'YouTube  ·  video_card', 'a video card says Video, no season or episode');
// the same tile again: nothing to do
assert.strictEqual(context.followSync(), false);
// across to Netflix, which has nothing: the whole row, which for this person is nothing
context.g = 1;
assert.strictEqual(context.followSync(), true);
assert.deepStrictEqual(ids(), []);
assert.strictEqual(title(), 'keep_watching');
assert(hidden());
assert(!context.rowHasCards());

// ---------------- a row of shows, the filter and the heading ----------------
const apps = [app(DISNEY, 'Disney+'), app(NETFLIX, 'Netflix'), app(FIRE_YOUTUBE, 'YouTube'), { kind: 'more' }];
const shows = [show('a', NETFLIX, 'Netflix'), show('b', DISNEY, 'Disney+'), show('c', NETFLIX, 'Netflix'), show('d', NETFLIX, 'Netflix'),
  show('e', NETFLIX, 'Netflix'), show('f', NETFLIX, 'Netflix'), show('g', NETFLIX, 'Netflix'), show('h', NETFLIX, 'Netflix'),
  show('i', NETFLIX, 'Netflix'), show('j', NETFLIX, 'Netflix')];
reset(shows, [video('v1', 'How Trains Work')], apps);
assert.deepStrictEqual(ids(), shows.map((x) => x.id), 'the whole row to start with');
assert.strictEqual(title(), 'keep_watching');
// the remote is deep in the row, then comes down onto the Disney+ tile (one card): the row shrinks, s is
// clamped and the track is scrolled back, else the one card would sit off screen under the heading
context.zone = 'shelf'; context.s = 7; context.followSync();
context.zone = 'grid'; context.g = 0;
assert.strictEqual(context.followSync(), true);
assert.deepStrictEqual(ids(), ['b']);
assert.strictEqual(title(), 'Recently on Disney+');
assert.strictEqual(context.s, 0, 's is clamped to the shorter row');
assert.strictEqual(context.scrollCalls, 1, 'the track is scrolled to the new row');
// up into the row and into the card's menu: the filter stays
context.zone = 'shelf';
assert.strictEqual(context.followSync(), false);
context.zone = 'shelfmenu';
assert.strictEqual(context.followSync(), false);
assert.deepStrictEqual(ids(), ['b']);
// the Netflix tile: its nine, under its own heading, newest first as the row had them
context.zone = 'grid'; context.g = 1;
assert.strictEqual(context.followSync(), true);
assert.deepStrictEqual(ids(), ['a', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
assert.strictEqual(title(), 'Recently on Netflix');
// the YouTube tile: no shows there, so the videos alone
context.g = 2;
context.followSync();
assert.deepStrictEqual(ids(), ['v1']);
assert.strictEqual(title(), 'Recently on YouTube');
// More apps is not an app: the whole row comes back
context.g = 3;
assert.strictEqual(context.followSync(), true);
assert.deepStrictEqual(ids(), shows.map((x) => x.id));
assert.strictEqual(title(), 'keep_watching');
// the people, the quick buttons, a menu: the whole row stays
['people', 'quick', 'np', 'menu'].forEach((z) => { context.zone = z; assert.strictEqual(context.followSync(), false, z); });
// an app with nothing on the go changes nothing: the row is not drawn again
context.zone = 'grid'; context.gridItems = [app('com.spotify.tv.android', 'Spotify')]; context.g = 0;
assert.strictEqual(context.followSync(), false, 'an app with no cards leaves the whole row as it is');
assert.strictEqual(context.followPkg, 'com.spotify.tv.android');
assert.deepStrictEqual(ids(), shows.map((x) => x.id));
// a lifted app, kids mode, or the setting off: the whole row, and the setting off clears the filter
context.gridItems = apps; context.g = 0; context.followSync();
assert.deepStrictEqual(ids(), ['b']);
context.lift = { pkg: DISNEY };
assert.strictEqual(context.followSync(), true);
assert.strictEqual(context.followPkg, null);
assert.deepStrictEqual(ids(), shows.map((x) => x.id));
context.lift = null; context.followSync();
context.SHELF_FOLLOW = false;
assert.strictEqual(context.followSync(), true);
assert.deepStrictEqual(ids(), shows.map((x) => x.id));
context.SHELF_FOLLOW = true;

// ---------------- the remembered focus carries the row it was in ----------------
reset(shows, [], apps);
context.zone = 'grid'; context.g = 0; context.followSync();   // "Recently on Disney+", one card
context.zone = 'shelf'; context.s = 0; context.focusRestored = true;
context.saveFocusNow();
assert.strictEqual(JSON.parse(storage['tvhome.focus']).pkg, DISNEY, 'the saved focus names the app the row followed');
// a fresh page: the whole row is drawn first, then the saved place is put back in the Disney+ row
reset(shows, [], apps);
context.focusRestored = false;
assert.strictEqual(context.restoreFocus(), true);
assert.strictEqual(context.zone, 'shelf');
assert.strictEqual(context.s, 0);
assert.strictEqual(context.followPkg, DISNEY);
assert.deepStrictEqual(ids(), ['b'], 'the outline lands on the Disney+ card, not the newest show of any app');
// that show is gone since: a fresh start, with the whole row
reset(shows.filter((x) => x.id !== 'b'), [], apps);
context.focusRestored = false;
assert.strictEqual(context.restoreFocus(), false);
assert.strictEqual(context.followPkg, null);
assert.deepStrictEqual(ids(), shows.filter((x) => x.id !== 'b').map((x) => x.id));
// the setting went off since: the saved place means nothing
reset(shows, [], apps);
context.SHELF_FOLLOW = false; context.focusRestored = false;
assert.strictEqual(context.restoreFocus(), false);
assert.strictEqual(context.followPkg, null);
context.SHELF_FOLLOW = true;
// a focus saved in the whole row has no app and restores as before
reset(shows, [], apps);
context.zone = 'shelf'; context.s = 3; context.focusRestored = true; context.saveFocusNow();
assert.strictEqual(JSON.parse(storage['tvhome.focus']).pkg, '');
reset(shows, [], apps);
context.focusRestored = false;
assert.strictEqual(context.restoreFocus(), true);
assert.strictEqual(context.s, 3);
assert.strictEqual(context.followPkg, null);

// ---------------- the setting, the wiring and the preview ----------------
assert(/SHELF_FOLLOW = typeof ST\.shelf_follows_app === "boolean" \? ST\.shelf_follows_app : HOME\.shelf_follows_app === true/.test(source), 'Home settings win over config, default off');
assert(/key: "keep-watching"[\s\S]{0,900}key: "shelf-follows-app", label: t\("shelf_follow"\), sub: t\("shelf_follow_sub"\)/.test(source), 'the Home settings row sits next to Show Keep watching');
assert(/saveFocusSoon\(\);\n\s*followSync\(\);/.test(source), 'paintFocus syncs the row with the tile on every press');
assert(/data\.videosBy\[p\.id\] = \(j\.videos \|\| \[\]\)/.test(source), '/api/continue videos are stored per person');
assert(/if \(data\.videosBy\[p\.id\]\) data\.videosBy\[p\.id\] = data\.videosBy\[p\.id\]\.filter\(keepIt\);/.test(source), 'removing a card by hand takes a video out too');
assert(/JSON\.stringify\(\{ showsBy: data\.showsBy, videosBy: data\.videosBy,/.test(source), 'the saved copy keeps the videos');
assert(/if \(arg\("follow"\)\) cfg\.home\.shelf_follows_app/.test(mock), 'mock.js has the follow preset');
assert(/videos: videos/.test(mock), 'mock.js sends videos with /api/continue');

// all 16 languages have the strings, and every recently_on keeps its {app}
['shelf_follow', 'shelf_follow_sub', 'recently_on', 'video_card'].forEach(function (k) {
  const count = (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length;
  assert.strictEqual(count, 16, `${k} must exist in all 16 languages (found ${count})`);
});
const ro = i18n.match(/recently_on: "[^"]*"/g) || [];
assert.strictEqual(ro.length, 16, 'recently_on in 16 languages');
ro.forEach(function (l) { assert(l.includes('{app}'), 'recently_on keeps {app}: ' + l); });
console.log('Keep watching follows the app tests passed.');
