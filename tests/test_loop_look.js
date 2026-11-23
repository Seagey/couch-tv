// The Loop look (home.look "loop", docs/TV-HOME.md "The Loop look"): the look's own code from app.js runs
// here with a stand in page, the way tests/test_shelf_follows_app.js runs the row. Covers the look
// selection and the body class, the variant from sunPhase() and the bridge's list, the glass mask for the
// quick buttons, the no glass fallbacks, tv.pause and tv.resume, the ambient clock and kids mode, the switch at the loop boundary, the card
// subtitles, the More apps panel's rows and clip, Now playing's place in the top row and the date line's room
// for it, and that the Night look's own code is untouched. Run: node tests/test_loop_look.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running Loop look tests...');
const web = path.join(__dirname, '../tv-home/web');
const source = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const mock = fs.readFileSync(path.join(web, 'mock.js'), 'utf8');

// ---------------- a stand in for the page ----------------
function classes() {
  const set = new Set();
  return {
    add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c),
    toggle: (c, on) => { if (on === undefined) on = !set.has(c); if (on) set.add(c); else set.delete(c); return on; },
    list: () => Array.from(set),
  };
}
function el(tag) {
  const attrs = {}, listeners = {};
  const e = {
    tag, id: '', className: '', textContent: '', _html: '', children: [], style: {}, classList: classes(),
    parentNode: null,
    setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute: (k) => { delete attrs[k]; },
    addEventListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    removeEventListener: (n, f) => { listeners[n] = (listeners[n] || []).filter((x) => x !== f); },
    fire: (n) => { (listeners[n] || []).slice().forEach((f) => f()); },
    listeners: (n) => (listeners[n] || []).length,
    appendChild: (c) => { c.parentNode = e; e.children.push(c); return c; },
    insertBefore: (c, ref) => { c.parentNode = e; const i = e.children.indexOf(ref); if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c; },
    removeChild: (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; },
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0,
  };
  Object.defineProperty(e, 'firstChild', { get: () => e.children[0] || null });
  Object.defineProperty(e, 'nextSibling', { get: () => (e.parentNode ? e.parentNode.children[e.parentNode.children.indexOf(e) + 1] || null : null) });
  Object.defineProperty(e, 'innerHTML', {
    get: () => e._html,
    set: (h) => { e._html = h; e.children = (h.match(/<div class="tile /g) || []).map(() => el('div')); },
  });
  if (tag === 'video') {
    Object.assign(e, {
      currentTime: 0, duration: 30, playbackRate: 1, seeking: false, ended: false, paused: true, readyState: 4, loads: 0, plays: 0, pauses: 0,
      pause: () => { e.pauses++; e.paused = true; }, play: () => { e.plays++; e.paused = false; return { catch: () => {} }; }, load: () => { e.loads++; },
    });
    Object.defineProperty(e, 'src', { get: () => attrs.src || '', set: (v) => { attrs.src = v; } });
    Object.defineProperty(e, 'poster', { get: () => attrs.poster || '', set: (v) => { attrs.poster = v; } });
  }
  return e;
}

// the page: the scrim, the body, the quick buttons laid out at (1680, 64) and (1760, 64), 64 px each
const root = el('html'), body = el('body'), scrim = el('div'), quick = el('div'), qbtns = el('div');
scrim.className = 'scrim'; body.appendChild(scrim);
const sleepBtn = el('span'), inputBtn = el('span');
Object.assign(sleepBtn, { offsetLeft: 0, offsetTop: 0, offsetWidth: 64, offsetHeight: 64 });
Object.assign(inputBtn, { offsetLeft: 80, offsetTop: 0, offsetWidth: 64, offsetHeight: 64 });
qbtns.children = [sleepBtn, inputBtn];
qbtns.getBoundingClientRect = () => ({ left: 1680, top: 64, width: 144, height: 64 });
const grid = el('div');
// the header's clock column: #time, then the date line (the cut-out goes in between)
const clockCol = el('div'), timeEl = el('div'), dateEl = el('div'), head = el('head');
timeEl.id = 'time'; dateEl.id = 'date';
clockCol.appendChild(timeEl); clockCol.appendChild(dateEl);
const els = { qbtns, quick, grid, time: timeEl, shelf: el('div'), 'shelf-section': el('div'), 'shelf-title': el('div') };
const storage = {};
let decoded = [];
function Image() {
  const im = this;
  Object.defineProperty(im, 'src', { set: (v) => { decoded.push(v); if (im.onload) im.onload(); } });
  im.decode = () => Promise.resolve();
}
const timers = [];
const context = {
  console: { log: () => { context.logged.push(Array.prototype.join.call(arguments, ' ')); } }, logged: [],
  Date, JSON, Math, String, Array, Object, Number, isFinite, Infinity, encodeURIComponent, Promise, Image,
  setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
  innerWidth: 1920, innerHeight: 1080,
  localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = v; }, removeItem: (k) => { delete storage[k]; } },
  document: { documentElement: root, body, head, createElement: el, querySelector: (q) => (q === '.scrim' ? scrim : null),
    getElementById: (id) => head.children.find((c) => c.id === id) || null },
  $: (id) => els[id],
  t: (k) => ({ video_card: 'Video', live_card: 'Live' }[k] || k),
  esc: (v) => String(v == null ? '' : v), slim: (u) => u, iconUrl: (pkg) => (pkg ? 'icon:' + pkg : null),
  renderPeople() {}, addCards() {}, kids: false, kidsOn: () => context.kids, idleAmbientActive: false, npVisible: () => false, gridKey: (a) => 'app:' + a.package,
  whoIndex: () => 0, peopleCount: () => 1, scrollShelf() {},
  API: '', HOME: {}, ST: {}, TV: null, MOCK: false, LIGHTER: false, SUN_SYNC: false, LOOP: false, NIGHT: true, KW_POSTER: false, LOCAL_SPOTIFY: false, OLED: false, THEME: 'night',
  KEEP_MAX: 10, KW_ON: true, CARDS: [], SHELF_FOLLOW: false, lift: null, touched: true,
  PEOPLE: [{ id: 'p1', name: 'Person 1' }], who: 'p1',
  data: { shows: [], showsBy: { p1: [] }, videosBy: { p1: [] }, apps: [], weather: null },
  zone: 'grid', s: 0, g: 0, shelfEls: [], gridItems: [], gridEls: [], expanded: false, GRID_COLS: 12,
  phase: 'day', sunPhase: () => context.phase,
  mayChange: true, sceneMayChange: () => context.mayChange,
  isActive: true, active: () => context.isActive,
  kept: (k) => { try { return JSON.parse(storage[k]); } catch (e) { return null; } },
  keep: (k, v) => { storage[k] = JSON.stringify(v); },
};
context.console.log = function () { context.logged.push(Array.prototype.join.call(arguments, ' ')); };
vm.createContext(context);
function part(from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert(a >= 0 && b > a, 'app.js has ' + from.trim());
  return source.slice(a, b);
}
vm.runInContext(part('  function lookSetting() {', '  function glassAmount()'), context);
vm.runInContext(part('  // ---------------- the Loop look', '  // ---------------- the video background'), context);
vm.runInContext(part('  var followPkg = null', '  // ---------------- custom cards'), context);
vm.runInContext(part('  function nearestInRow(', '  // which app a grid tile is'), context);
const tick = () => new Promise((r) => setImmediate(r));

(async function () {
  // ---------------- the look: a fourth value, the body class, NIGHT stays on (the dock and the cards) ----------------
  assert(/if \(THEME !== "classic" && THEME !== "oled" && THEME !== "loop"\) THEME = "night";/.test(source), 'readConfig accepts loop');
  context.setLook('loop');
  assert.strictEqual(context.LOOP, true);
  assert.strictEqual(context.NIGHT, true, 'Loop is laid out like Night');
  assert(root.classList.contains('theme-loop') && body.classList.contains('theme-loop'), 'html and body carry theme-loop');
  assert(root.classList.contains('theme-night'), 'the Night rules (dock, cards, More apps) still apply');
  context.setLook('night');
  assert.strictEqual(context.LOOP, false);
  assert(!root.classList.contains('theme-loop') && !body.classList.contains('theme-loop'), 'Night has no theme-loop');
  context.setLook('classic');
  assert(!context.NIGHT && !context.LOOP && !root.classList.contains('theme-night'), 'Classic as before');
  storage['tvhome.look'] = '"loop"';
  assert.strictEqual(context.lookSetting(), 'loop', 'kept("tvhome.look") may say loop');
  storage['tvhome.look'] = '"bogus"';
  assert.strictEqual(context.lookSetting(), 'night');
  delete storage['tvhome.look'];
  context.HOME = { look: 'loop' };
  assert.strictEqual(context.lookSetting(), 'loop', 'home.look may say loop');
  assert(/else if \(THEME === "classic"\) ST\.look = "loop";\n\s*else ST\.look = "night";/.test(source), 'the Look button cycles through Loop');
  assert(/\["night", "oled", "classic", "loop"\]\.forEach/.test(source), 'Home settings, Look lists Loop');
  assert(/THEME === "classic" \? t\("look_loop"\)/.test(source), 'the Look button names Loop next after Classic');

  // ---------------- the variant: sunPhase() with Follow the sun, else day; a missing file falls back ----------------
  context.setLook('loop');
  context.HOME = { loop: { variants: ['dawn', 'day', 'dusk', 'night'], blur: true } };
  context.loopReadConfig();
  context.SUN_SYNC = true; context.phase = 'dusk';
  assert.strictEqual(context.loopVariant(), 'dusk');
  context.phase = 'night';
  assert.strictEqual(context.loopVariant(), 'night');
  context.SUN_SYNC = false;
  assert.strictEqual(context.loopVariant(), 'day', 'Follow the sun off: day all day');
  context.SUN_SYNC = true;
  context.HOME = { loop: { variants: ['day', 'night'] } };
  context.loopReadConfig();
  context.phase = 'dusk';
  assert.strictEqual(context.loopVariant(), 'day', 'no dusk file: day');
  context.HOME = { loop: { variants: ['night'] } };
  context.loopReadConfig();
  assert.strictEqual(context.loopVariant(), 'night', 'no day file either: the first the bridge has');
  context.HOME = { loop: { variants: ['night', 'bogus'] } };
  context.loopReadConfig();
  assert.deepStrictEqual(context.loopVariants, ['night'], 'only the four phases count');
  context.HOME = {};
  context.loopReadConfig();
  assert.strictEqual(context.loopVariant(), '', 'no home.loop: no variants');
  assert.strictEqual(context.loopBlurOn, false);

  // ---------------- the accent from the weather code and the phase ----------------
  context.data.weather = null;
  assert.strictEqual(context.loopAccent(), '#F2A33C', 'no weather: the unknown accent');
  context.data.weather = { code: 63 }; assert.strictEqual(context.loopAccent(), '#7FB2E5', 'rain');
  context.data.weather = { code: 73 }; assert.strictEqual(context.loopAccent(), '#DCE8F5', 'snow');
  context.data.weather = { code: 95 }; assert.strictEqual(context.loopAccent(), '#C9A3FF', 'storm');
  context.data.weather = { code: 45 }; assert.strictEqual(context.loopAccent(), '#A9B4C2', 'fog');
  context.data.weather = { code: 0 };
  context.phase = 'dawn'; assert.strictEqual(context.loopAccent(), '#F2B463');
  context.phase = 'day'; assert.strictEqual(context.loopAccent(), '#7CC4F5');
  context.phase = 'dusk'; assert.strictEqual(context.loopAccent(), '#F08A6B');
  context.phase = 'night'; assert.strictEqual(context.loopAccent(), '#8E9CFF', 'clear: the same phase as the variant');
  context.data.weather = null;

  // ---------------- the page: two videos, the glass container after the scrim, the mask of the two buttons ----------------
  context.HOME = { loop: { variants: ['dawn', 'day', 'dusk', 'night'], blur: true } };
  context.SUN_SYNC = true; context.phase = 'day'; context.LIGHTER = false;
  root.style = {}; root.style.setProperty = (k, v) => { root.style[k] = v; };
  context.loopInit();
  const sharp = context.loopSharp, blur = context.loopBlur, box = context.loopBox;
  assert(sharp && body.children[0] === sharp, 'the sharp clip is the first thing in the body');
  assert.strictEqual(sharp.getAttribute('preload'), 'auto');
  assert.strictEqual(sharp.getAttribute('playsinline'), '');
  assert(sharp.muted && sharp.loop, 'muted and looping');
  assert.strictEqual(sharp.src, 'loop/day.mp4');
  assert.strictEqual(sharp.poster, 'loop/day.jpg');
  assert(box && body.children[body.children.indexOf(scrim) + 1] === box, 'the glass container sits just after the scrim');
  assert.strictEqual(blur.src, 'loop/day-blur.mp4');
  assert.strictEqual(blur.poster, 'loop/day-blur.jpg');
  assert(root.classList.contains('loop-glass'), 'html.loop-glass: the lighter tint');
  assert.strictEqual(root.style['--accent'], '#F2A33C');
  assert.strictEqual(sharp.plays, 0, 'no play() until both can play through');
  sharp.fire('canplaythrough');
  assert.strictEqual(sharp.plays, 0);
  blur.fire('canplaythrough');
  assert.strictEqual(sharp.plays, 1); assert.strictEqual(blur.plays, 1);
  assert.strictEqual(sharp.loads, 1, 'load() once, to let the old codec go before the file is set');
  assert(context.loopSeekAt > 0, 'the first play() aligns the blur copy with a seek');
  blur.fire('seeked');
  assert.strictEqual(context.loopSeekAt, 0);
  // the mask
  context.loopMask('sleep,input');
  assert.strictEqual(box.style.left, '1680px'); assert.strictEqual(box.style.top, '64px');
  assert.strictEqual(box.style.width, '144px'); assert.strictEqual(box.style.height, '64px');
  const svg = decodeURIComponent(box.style.maskImage.replace(/^url\("data:image\/svg\+xml,/, '').replace(/"\)$/, ''));
  assert(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="144" height="64" viewBox="0 0 144 64">/.test(svg), svg);
  assert(svg.indexOf('<rect x="0" y="0" width="64" height="64" rx="32" fill="#000"/>') > 0, 'the sleep button is a circle at the box origin');
  assert(svg.indexOf('<rect x="80" y="0" width="64" height="64" rx="32" fill="#000"/>') > 0, 'the input button 80 px along');
  assert.strictEqual(box.style.webkitMaskImage, box.style.maskImage);
  assert.strictEqual(blur.style.left, '-1680px'); assert.strictEqual(blur.style.top, '-64px');
  assert.strictEqual(blur.style.width, '1920px'); assert.strictEqual(blur.style.height, '1080px');
  // the same buttons again: nothing is rebuilt (a focus never rebuilds the mask either: renderQuick passes the same key)
  inputBtn.offsetLeft = 200;
  context.loopMask('sleep,input');
  assert.strictEqual(box.style.width, '144px', 'the same key leaves the mask alone');
  context.loopMask('sleep');
  assert.strictEqual(box.style.width, '264px', 'a new set of buttons: measured again');
  inputBtn.offsetLeft = 80;
  quick.classList.add('none');
  context.loopMask('');
  assert.strictEqual(box.style.display, 'none', 'no buttons: the container hides');
  assert(blur.paused && context.loopGlassIdle, 'and the blur copy stops: no decoder for glass nobody sees');
  const blurPlays = blur.plays;
  sharp.currentTime = 7; sharp.paused = false; context.loopLastT = 6.75;
  blur.currentTime = 2;
  context.loopTimeUpdate();
  assert.strictEqual(blur.currentTime, 2, 'no sync or seek on the stopped copy');
  quick.classList.remove('none');
  context.loopMask('sleep,input');
  assert.strictEqual(box.style.display, '');
  assert.strictEqual(blur.plays, blurPlays + 1, 'buttons back: the blur copy plays again');
  assert(Math.abs(blur.currentTime - 7 - context.loopSeekLat) < 0.001 && context.loopSeekAt > 0, 'seeked to the sharp clip');
  assert.strictEqual(context.loopGlassIdle, false);
  blur.fire('seeked');
  assert(/if \(LOOP\) loopMask\(key\);/.test(source), 'renderQuick rebuilds the mask only when the set of buttons changes');

  // ---------------- sync: the dead band, the rate pull, the seek, the wrap ----------------
  sharp.currentTime = 10; blur.currentTime = 10.1;
  context.loopLastT = 9.75;
  context.loopTimeUpdate();
  assert.strictEqual(blur.playbackRate, 1, 'under 0.2 s: nothing');
  blur.currentTime = 10.4; context.loopTimeUpdate();
  assert.strictEqual(blur.playbackRate, 0.97, 'ahead by up to 0.5 s: slowed');
  blur.currentTime = 9.6; context.loopTimeUpdate();
  assert.strictEqual(blur.playbackRate, 1.03, 'behind: hurried');
  blur.currentTime = 12; context.loopTimeUpdate();
  assert.strictEqual(blur.playbackRate, 1);
  assert(Math.abs(blur.currentTime - 10 - context.loopSeekLat) < 0.001, 'more than 0.5 s out: a seek to the sharp time (plus the measured seek lag)');
  blur.fire('seeked');
  // a wrap: the sharp time went back; the blur copy is seeked to it once
  sharp.currentTime = 0.2; blur.currentTime = 29.9; context.loopLastT = 29.8;
  context.loopTimeUpdate();
  assert(Math.abs(blur.currentTime - 0.2 - context.loopSeekLat) < 0.001, 'after the wrap the blur copy is seeked to the sharp time (plus the measured seek lag)');
  blur.fire('seeked');

  // ---------------- the switch: posters first, then the cut at the loop boundary, held while keys move ----------------
  decoded = [];
  context.phase = 'dusk';
  context.loopTick();
  assert.strictEqual(context.loopPending, 'dusk');
  assert.deepStrictEqual(decoded, ['loop/dusk.jpg', 'loop/dusk-blur.jpg'], 'both posters are decoded first');
  await tick();
  assert.strictEqual(context.loopArmed, true);
  context.loopTick();
  assert.strictEqual(decoded.length, 2, 'the same pending variant is not decoded again');
  const plays = sharp.plays, loads = sharp.loads;
  sharp.currentTime = 12; context.loopLastT = 11.75;
  context.loopTimeUpdate();
  assert.strictEqual(sharp.src, 'loop/day.mp4', 'mid clip: no cut');
  context.mayChange = false;
  sharp.currentTime = 29.8; context.loopLastT = 29.5;
  context.loopTimeUpdate();
  assert.strictEqual(sharp.src, 'loop/day.mp4', 'at the boundary with keys moving: held');
  assert.strictEqual(context.loopPending, 'dusk', 'and still pending for the next loop');
  context.mayChange = true;
  sharp.currentTime = 29.9; context.loopLastT = 29.8;
  context.loopTimeUpdate();
  assert.strictEqual(sharp.src, 'loop/dusk.mp4', 'at the boundary with the remote still: the cut');
  assert.strictEqual(sharp.poster, 'loop/dusk.jpg');
  assert.strictEqual(blur.src, 'loop/dusk-blur.mp4');
  assert.strictEqual(sharp.loads, loads + 1, 'the old file was let go with load()');
  assert.strictEqual(context.loopCur, 'dusk'); assert.strictEqual(context.loopPending, '');
  assert.strictEqual(sharp.plays, plays, 'no play() before both can play through');
  sharp.fire('canplaythrough'); blur.fire('canplaythrough');
  assert.strictEqual(sharp.plays, plays + 1);
  // the wrap itself also counts as the boundary (the loop attribute never fires ended)
  context.phase = 'night'; context.loopTick(); await tick();
  sharp.currentTime = 0.1; context.loopLastT = 29.9;
  context.loopTimeUpdate();
  assert.strictEqual(sharp.src, 'loop/night.mp4', 'a wrap is the boundary too');
  sharp.fire('canplaythrough'); blur.fire('canplaythrough');
  assert(timers.some((x) => x.ms === 4000), 'a 4 s timer plays anyway if canplaythrough never comes');
  // the playing variant wanted again before the cut (Follow the sun switched off): nothing stays pending
  context.phase = 'dawn'; context.loopTick(); await tick();
  assert.strictEqual(context.loopPending, 'dawn'); assert.strictEqual(context.loopArmed, true);
  context.phase = 'night'; context.loopTick();
  assert.strictEqual(context.loopPending, ''); assert.strictEqual(context.loopArmed, false, 'the playing variant wanted again: no cut armed');
  sharp.currentTime = 0.1; context.loopLastT = 29.9;
  context.loopTimeUpdate();
  assert.strictEqual(sharp.src, 'loop/night.mp4', 'and the wrap cuts to nothing');

  // ---------------- a second load inside 4 s of the first: the first one's timer and listeners go ----------------
  context.loopLoad('day');
  const firstTimer = timers[timers.length - 1];
  assert.strictEqual(firstTimer.ms, 4000);
  context.loopLoad('dusk');
  assert.strictEqual(sharp.listeners('canplaythrough'), 1, 'one listener on the sharp clip, the earlier load\'s gone');
  assert.strictEqual(blur.listeners('canplaythrough'), 1, 'and one on the blur copy');
  const plays2 = sharp.plays;
  firstTimer.f();
  assert.strictEqual(sharp.plays, plays2, 'the earlier load\'s 4 s timer starts nothing');
  sharp.fire('canplaythrough');
  assert.strictEqual(sharp.plays, plays2, 'not before the blur copy can play through too');
  blur.fire('canplaythrough');
  assert.strictEqual(sharp.plays, plays2 + 1, 'then one play()');
  assert.strictEqual(sharp.src, 'loop/dusk.mp4'); assert.strictEqual(context.loopCur, 'dusk');
  timers[timers.length - 1].f();
  assert.strictEqual(sharp.plays, plays2 + 1, 'its own timer, after it played, does nothing more');
  // back to night for what follows
  context.loopLoad('night'); sharp.fire('canplaythrough'); blur.fire('canplaythrough');

  // ---------------- screen off and covered: both let go of their files; back: the files again ----------------
  const p = sharp.plays, loadsBefore = sharp.loads;
  context.loopPause();
  assert.strictEqual(sharp.src, ''); assert.strictEqual(blur.src, '');
  assert(sharp.classList.contains('off') && blur.classList.contains('off'));
  assert.strictEqual(sharp.loads, loadsBefore + 1, 'load() after the src is removed releases the decoder');
  assert.strictEqual(sharp.poster, 'loop/night.jpg', 'the poster stays for the way back');
  context.loopPause();
  assert.strictEqual(sharp.loads, loadsBefore + 1, 'pausing twice does nothing more');
  context.isActive = false;
  context.loopResume();
  assert.strictEqual(sharp.src, '', 'not active (covered, or the screen off): stays released');
  context.isActive = true;
  context.loopResume();
  assert.strictEqual(sharp.src, 'loop/night.mp4'); assert.strictEqual(blur.src, 'loop/night-blur.mp4');
  assert(!sharp.classList.contains('off') && !blur.classList.contains('off'));
  sharp.fire('canplaythrough'); blur.fire('canplaythrough');
  assert.strictEqual(sharp.plays, p + 1, 'play() once both are back');
  assert(/function pauseVideo\(\) \{[^\n]*if \(LOOP\) loopPause\(\); \}/.test(source), 'tv.pause and the page hidden release the clips');
  assert(/function startVideo\(\) \{\n\s*var v = \$\("bgvid"\), root = document\.documentElement;\n\s*if \(LOOP\) loopResume\(\);/.test(source), 'tv.resume and the page shown bring them back');
  assert(/if \(LOOP\) \{ if \(screenOffActive\) loopPause\(\); else loopResume\(\); \}/.test(source), 'screen off releases them, waking brings them back');

  // ---------------- a pause while a cut is armed: the emptying load() is not a wrap, and a load under way plays nothing ----------------
  context.phase = 'dawn'; context.mayChange = true; context.loopTick(); await tick();
  assert.strictEqual(context.loopArmed, true, 'a cut to dawn is armed');
  sharp.currentTime = 12; context.loopLastT = 11.75;
  context.loopPause();
  assert.strictEqual(context.loopLastT, 0, 'the last time goes back to 0 with the files');
  sharp.currentTime = 0; context.loopTimeUpdate();   // the timeupdate load() queues, with the time back at 0
  assert.strictEqual(sharp.src, '', 'it loads nothing behind the cover');
  assert.strictEqual(blur.src, '');
  context.loopLastT = 11.75; context.loopTimeUpdate();   // even a time that reads as a wrap: timeupdate does nothing while let go
  assert.strictEqual(sharp.src, '');
  assert.strictEqual(context.loopPending, 'dawn', 'the cut stays pending for the way back');
  context.loopLoad('dawn');
  assert.strictEqual(sharp.src, '', 'nor does any other load while let go');
  context.loopResume();
  assert.strictEqual(sharp.src, 'loop/dawn.mp4', 'back: the phase it is now');
  const underWay = timers[timers.length - 1], p2 = sharp.plays, b2 = blur.plays;
  context.loopPause();
  assert.strictEqual(sharp.listeners('canplaythrough'), 0, 'the load under way loses its listeners');
  underWay.f(); sharp.fire('canplaythrough'); blur.fire('canplaythrough');
  assert.strictEqual(sharp.plays, p2, 'and its 4 s timer plays nothing on the emptied clips');
  assert.strictEqual(blur.plays, b2, 'the blur copy neither');

  // ---------------- the ambient clock and kids mode cover the home: let go, and back after ----------------
  context.isActive = true; context.idleAmbientActive = true;
  context.loopCover();
  assert.strictEqual(sharp.src, '', 'still let go under the ambient clock');
  context.loopResume();
  assert.strictEqual(sharp.src, '', 'toggleScreenOff(false) or startVideo under the ambient clock bring nothing back');
  context.idleAmbientActive = false; context.loopCover();
  assert.strictEqual(sharp.src, 'loop/dawn.mp4', 'the clock goes: the clips come back');
  assert(!sharp.classList.contains('off') && !blur.classList.contains('off'));
  sharp.fire('canplaythrough'); blur.fire('canplaythrough');
  assert(context.loopSeekAt > 0, 'the blur copy is seeked to the sharp clip again');
  blur.fire('seeked');
  context.idleAmbientActive = true; context.loopCover();
  assert(sharp.src === '' && blur.src === '' && sharp.classList.contains('off'), 'the ambient clock comes: both let go');
  context.idleAmbientActive = false; context.loopCover();
  sharp.fire('canplaythrough'); blur.fire('canplaythrough'); blur.fire('seeked');
  context.kids = true; context.loopCover();
  assert(sharp.src === '' && blur.src === '', 'kids mode: let go behind the shelf');
  context.loopResume();
  assert.strictEqual(sharp.src, '', 'and kept let go while it is up');
  context.kids = false; context.loopCover();
  assert.strictEqual(sharp.src, 'loop/dawn.mp4', 'kids mode ends: back');
  sharp.fire('canplaythrough'); blur.fire('canplaythrough'); blur.fire('seeked');
  context.LOOP = false; context.kids = true; context.loopCover();
  assert.strictEqual(sharp.src, 'loop/dawn.mp4', 'another look: nothing to do');
  context.LOOP = true; context.kids = false;
  assert(/designVideo\("idle", idleAmbientActive\);\n\s*loopCover\(\);/.test(source), 'setIdleAmbient tells the look');
  assert(/if \(kidsOn\(\) !== was\) loopCover\(\);/.test(source), 'kidSync tells it when kids mode comes or goes');
  assert(/function kidsUnlocked\(kid, code\) \{\n[^\n]*\n\s*touched = true;\n\s*loopCover\(\);/.test(source), 'and so does the parent PIN (kids.js has left kids mode before kidSync runs)');
  context.phase = 'night';

  // ---------------- no glass: the blur file fails, Lighter home, or home.loop.blur off ----------------
  blur.onerror();
  assert.strictEqual(context.loopBox, null); assert.strictEqual(context.loopBlur, null);
  assert(!body.children.includes(box), 'the container is gone');
  assert(!root.classList.contains('loop-glass'), 'the buttons take the darker tint');
  sharp.currentTime = 5; context.loopLastT = 4.75;
  context.loopTimeUpdate();   // nothing to sync, nothing thrown
  body.children = [scrim];
  context.LIGHTER = true;
  context.loopInit();
  assert.strictEqual(context.loopBox, null, 'Lighter home: no blur element at all');
  assert(!root.classList.contains('loop-glass'));
  // Lighter switched on while the look is up (Home settings, or lowEnd() deciding late): the blur copy goes
  body.children = [scrim];
  context.LIGHTER = false;
  context.loopInit();
  assert(context.loopBox && root.classList.contains('loop-glass'), 'the glass is back for this check');
  context.LIGHTER = true; context.loopLighter();
  assert.strictEqual(context.loopBox, null); assert.strictEqual(context.loopBlur, null);
  assert(!root.classList.contains('loop-glass'), 'Lighter on while the look is up: no blur copy, the darker tint');
  assert.strictEqual(context.loopBlurOn, false);
  context.LIGHTER = false; context.loopLighter();
  assert.strictEqual(context.loopBox, null, 'Lighter off again: the glass waits for the next start');
  assert(/document\.documentElement\.classList\.toggle\("lighter", LIGHTER\); if \(LOOP\) loopLighter\(\); ambientSync\(\);/.test(source), 'the Lighter row tells the look');
  assert(/LIGHTER = LOW_END;\n\s*document\.documentElement\.classList\.toggle\("lighter", LIGHTER\);\n\s*if \(LOOP\) loopLighter\(\);/.test(source), 'and so does lowEnd()');
  body.children = [scrim];
  context.LIGHTER = false;
  context.HOME = { loop: { variants: ['day'], blur: false } };
  context.loopInit();
  assert.strictEqual(context.loopBox, null, 'home.loop.blur false: no blur element');
  // no variants: the scrim alone, one line logged; in a preview the night scene stands in
  body.children = [scrim]; context.logged = [];
  context.HOME = { loop: { variants: [] } };
  context.loopInit();
  assert.strictEqual(context.loopSharp.src, '');
  assert.strictEqual(context.loopSharp.getAttribute('poster'), null);
  assert.strictEqual(context.logged.length, 1);
  body.children = [scrim]; context.MOCK = true;
  context.loopInit();
  assert.strictEqual(context.loopSharp.getAttribute('poster'), 'backgrounds/scene-night.jpg', 'the preview shows a still');
  context.MOCK = false;

  // ---------------- More apps: the grid moves by whole rows so the focused row is in view ----------------
  // the rows outside the three in view carry .off-window: the clip leaves room for the focus, so it no longer hides them
  context.gridEls = Array.from({ length: 60 }, () => el('div')); context.GRID_COLS = 12; context.expanded = true; context.zone = 'grid';
  const offRows = () => [0, 1, 2, 3, 4].filter((r) => r * 12 < context.gridEls.length && context.gridEls.slice(r * 12, r * 12 + 12).every((t) => t.classList.contains('off-window')));
  const onRows = () => [0, 1, 2, 3, 4].filter((r) => r * 12 < context.gridEls.length && context.gridEls.slice(r * 12, r * 12 + 12).every((t) => !t.classList.contains('off-window')));
  context.g = 0; context.loopPanel(); assert.strictEqual(grid.style.transform, '');
  assert.deepStrictEqual([onRows(), offRows()], [[0, 1, 2], [3, 4]], 'rows 0 to 2 show, the fourth and fifth are hidden');
  context.g = 30; context.loopPanel(); assert.strictEqual(grid.style.transform, '', 'row 2 is still in view');
  context.g = 40; context.loopPanel(); assert.strictEqual(grid.style.transform, 'translateY(-8.5rem)', 'row 3: one row up');
  assert.deepStrictEqual([onRows(), offRows()], [[1, 2, 3], [0, 4]], 'the row above goes too');
  context.g = 59; context.loopPanel(); assert.strictEqual(grid.style.transform, 'translateY(-17rem)', 'the last row');
  assert.deepStrictEqual([onRows(), offRows()], [[2, 3, 4], [0, 1]]);
  context.g = 30; context.loopPanel(); assert.strictEqual(grid.style.transform, 'translateY(-17rem)', 'row 2 is in view, no move');
  context.g = 12; context.loopPanel(); assert.strictEqual(grid.style.transform, 'translateY(-8.5rem)', 'row 1: back up one');
  context.gridEls.length = 30; context.g = 29; context.loopPanel();   // two and a half rows: nothing to hide
  assert.deepStrictEqual(offRows(), [], 'three rows or fewer: every tile shows');
  context.gridEls = Array.from({ length: 60 }, () => el('div')); context.g = 59; context.loopPanel();
  context.expanded = false; context.loopPanel(); assert.strictEqual(grid.style.transform, '');
  assert.deepStrictEqual(offRows(), [], 'the dock: no tile hidden');
  context.gridEls = [];
  assert(/if \(LOOP\) \{ loopPanel\(\); return; \}/.test(source), 'slideDock hands the Loop look to loopPanel');
  assert(/<div class="grid-clip" id="grid-clip"><div class="grid" id="grid"><\/div><\/div>/.test(html), 'the grid sits in its clip');

  // ---------------- the cards: the subtitle carries the app ----------------
  const yt = { package: 'com.google.android.youtube.tv', name: 'YouTube' };
  assert.strictEqual(context.loopSub({ title: 'Friends', season: 1, episode: 3, app: { name: 'HBO Max' } }), 'HBO Max · S1 E3');
  assert.strictEqual(context.loopSub({ title: 'How trains work', kind: 'video', app: yt }), 'YouTube · Video');
  assert.strictEqual(context.loopSub({ title: 'Al Jazeera English', kind: 'video', live: true, app: yt }), 'YouTube · Live');
  assert.strictEqual(context.loopSub({ title: 'Al Jazeera English', kind: 'live', app: yt }), 'YouTube · Live');
  assert.strictEqual(context.loopSub({ title: 'Kingdom of Heaven', app: { name: 'Plex' } }), 'Plex');
  assert.strictEqual(context.loopSub({ title: 'The Pacific', episode_title: 'Basilone', app: { name: 'Plex' } }), 'Plex · Basilone');
  // renderShelf draws them as bare thumbnails, with a plate where there is no picture
  context.LOOP = true; context.NIGHT = true;
  context.data = { shows: [], showsBy: { p1: [
    { id: 'a', title: 'The Pacific', season: 1, episode: 6, progress: 0.08, app: { package: 'tv.plex', name: 'Plex' }, backdrop: 'http://x/pacific.jpg' },
    { id: 'b', title: 'Lofi beats', kind: 'video', app: yt, poster: null },
  ] }, videosBy: { p1: [] }, apps: [] };
  context.renderShelf();
  const h = els.shelf._html;
  assert(/<div class="tile lcard"><div class="lthumb"><img class="thumb" src="http:\/\/x\/pacific.jpg"[^>]*><img class="lbadge" src="icon:tv.plex"/.test(h), 'a thumbnail with the app badge');
  assert(/<span class="lbar"><i style="width:8%"><\/i><\/span>/.test(h), 'the 3 px progress bar');
  assert(/<b>The Pacific<\/b><i>Plex · S1 E6<\/i>/.test(h), 'the title and the subtitle under it');
  assert(/<div class="tile lcard"><div class="lthumb plate"><img class="picon" src="icon:com.google.android.youtube.tv"/.test(h), 'no picture: the plate with the app icon');
  assert(/<b>Lofi beats<\/b><i>YouTube · Video<\/i>/.test(h));
  assert.strictEqual(context.shelfEls.length, 2);
  assert(!/ncard/.test(h), 'no glass cards in the Loop look');
  assert(/<img class="thumb" src="http:\/\/x\/pacific.jpg" alt="" decoding="async" data-err="kwretry">/.test(h), 'a picture that fails is asked for again (#274)');
  assert(/<img class="lbadge" src="icon:tv\.plex" alt="" data-err="remove">/.test(h) && /<img class="picon" src="icon:com\.google\.android\.youtube\.tv" alt="" data-err="remove">/.test(h), 'an icon that fails goes, through data-err');
  assert(!/onerror=/.test(h), 'no inline onerror (a page policy allows no inline script)');
  context.LOOP = false;
  context.renderShelf();
  assert(/class="tile ncard"/.test(els.shelf._html), 'the Night look still draws its glass cards');

  // ---------------- the Night look's own code is untouched; what Night draws is off in Loop ----------------
  assert(/if \(NIGHT && !LOOP\) \{   \/\/ the scenes, their clocks and the weather canvas: Night only/.test(source), 'no scenes in Loop');
  assert(/VIDEO_ON = !!VIDEO_URL && \(typeof ST\.video === "boolean" \? ST\.video : true\) && !LOOP;/.test(source), 'home.video_url is off in Loop');
  assert(/a\.setSunGradeEnabled\(WX_SUN_GRADE && !LIGHTER && !OLD_ENGINE && !LOOP\);/.test(source), 'the ambient lighting layer is off in Loop');
  assert(/DOCK_BANNERS = NIGHT && !LOOP && /.test(source) && /if \(LOOP\) DOCK_MAC = false;/.test(source));
  assert(/function updateAmbientWeather\(\) \{\n\s*if \(LOOP\) \{ loopTick\(\); return; \}/.test(source), 'the clock tick and a new weather reading check the phase and the accent');
  assert(/if \(LOOP\) document\.querySelector\("\.top-left"\)\.appendChild\(\$\("np"\)\);[^\n]*\n\s*else if \(NIGHT\) \$\("np-slot"\)\.appendChild\(\$\("np"\)\);/.test(source), 'Now playing is a line at the top left; Night keeps its card');
  assert(/var anyone = rowHasCards\(\);\n\s*\$\("shelf-section"\)\.classList\.toggle\("empty", !anyone && !on\);/.test(source), 'renderNp (Night look) as it was');
  // app.css: the look's section, no filter in it, the scrim, the ring, the clock, the Lighter durations
  const sec = css.slice(css.indexOf('/* ================= The Loop look'));
  assert(sec.length > 1000, 'app.css has the Loop section');
  assert(!/(?<!backdrop-)filter:(?! none)/.test(sec), 'no filter in the Loop look');
  assert(/html\.theme-loop \*, html\.theme-loop \*::before, html\.theme-loop \*::after \{ -webkit-backdrop-filter: none !important; backdrop-filter: none !important; \}/.test(sec));
  assert(!/mix-blend-mode/.test(sec));
  assert(/rgba\(11, 10, 16, 0\.66\) 0%, rgba\(11, 10, 16, 0\.56\) 28%, rgba\(11, 10, 16, 0\.20\) 37%, rgba\(11, 10, 16, 0\) 43%/.test(sec), 'the top scrim');
  assert(/rgba\(11, 10, 16, 0\) 44%, rgba\(11, 10, 16, 0\.55\) 55%, rgba\(11, 10, 16, 0\.74\) 64%, rgba\(11, 10, 16, 0\.84\) 76%, rgba\(11, 10, 16, 0\.84\) 100%/.test(sec), 'the bottom scrim');
  assert(/--loop-ring: 0 0 0 0\.125rem #0B0A10, 0 0 0 0\.3125rem #FFF;/.test(sec), 'the ring with its gap');
  assert(/--loop-tint: rgba\(20, 18, 24, 0\.80\);/.test(sec) && /html\.theme-loop\.loop-glass \{ --loop-tint: rgba\(20, 18, 24, 0\.65\); \}/.test(sec), 'the tints');
  assert(/font-size: 15rem; line-height: 0\.9; font-weight: 300; letter-spacing: -0\.03em; font-variant-numeric: tabular-nums;/.test(sec), 'the clock');
  assert(/html\.theme-loop \.app\.focus \{ transform: scale\(1\.12\) translateY\(-0\.375rem\); transition-duration: 160ms; will-change: transform; z-index: 1; \}/.test(sec), 'the focused tile paints over the next row of the panel');
  assert(!/html\.glass\.theme-loop/.test(sec), 'no rule waits on html.glass: the class is off in Loop');
  assert(/toggle\("glass", GLASS !== "off" && !LOOP\);\n\s*document\.documentElement\.classList\.toggle\("glass-lite", GLASS === "lite" && !LOOP\);/.test(source), 'readConfig keeps html.glass off in the Loop look');
  assert(/html\.theme-loop \.people\.head \{ transition: transform 120ms var\(--ease\); \}/.test(sec), 'the head icon: only the transform glides');
  // the row's clip: to the screen's edge after the sixth card, 16 px before the first (scale 1.05 and the ring reach
  // 13.25 px), and mirrored right to left, where the row starts at the right (dir sits on html itself)
  assert(/html\.theme-loop \.shelf-clip \{ padding: 0\.75rem 6rem 0\.75rem 1rem; margin: -0\.75rem -6rem -0\.75rem -1rem; \}/.test(sec), 'the sixth card is cut by the screen edge; the first card\'s ring is whole');
  assert(/html\.theme-loop\[dir="rtl"\] \.shelf-clip \{ padding: 0\.75rem 1rem 0\.75rem 6rem; margin: -0\.75rem -1rem -0\.75rem -6rem; \}/.test(sec), 'right to left: the clip reaches the left edge');
  {
    const rem = 16, card = 320, ring = 5, scale = 1.05;
    const reach = (card * (scale - 1)) / 2 + ring * scale;
    assert(reach < 1 * rem, 'the focused first card fits in the 16 px (' + reach + ' px)');
    assert(1 * rem < 1.25 * rem, 'and a card that scrolled out, 20 px away, stays hidden');
  }
  // the quick button at the screen's edge: its label runs inwards from its outer side (the last child, at the
  // right; right to left the row runs the other way and the last is at the left)
  // the picture and screensaver buttons' base label rule is by id (1,1,2), so the edge rule names them by id too
  assert(/html\.theme-loop \.qbtns \.qbtn:last-child span, html\.theme-loop \.qbtns #q-picture:last-child span, html\.theme-loop \.qbtns #q-screensaver:last-child span \{ left: auto; right: 0; transform: none; \}/.test(sec), 'the last button\'s label is not cut by the edge, the id buttons included');
  assert(/html\.theme-loop\[dir="rtl"\] \.qbtns \.qbtn:last-child span, html\.theme-loop\[dir="rtl"\] \.qbtns #q-picture:last-child span, html\.theme-loop\[dir="rtl"\] \.qbtns #q-screensaver:last-child span \{ left: 0; right: auto; \}/.test(sec), 'right to left, the other side');
  // More apps: the clip has room round the tiles for the focus, the grid starts at (96, 596), the rows outside the
  // three are hidden after the grid's move (at once in Lighter and with reduced motion)
  assert(/html\.theme-loop\.expanded \.grid-clip \{ position: absolute; top: 0\.5rem; right: 0\.5rem; bottom: 0\.25rem; left: 0\.5rem; overflow: hidden; \}/.test(sec), 'the clip: x 80 to 1840, y 568 to 1032');
  assert(/html\.theme-loop\.expanded \.grid, html\.lighter\.theme-loop\.theme-night\.expanded \.grid \{ padding: 1\.75rem 1rem 0; \}/.test(sec), 'the grid from (96, 596), Lighter too');
  assert(/html\.theme-loop\.expanded \.app\.off-window \{ visibility: hidden; transition: transform 120ms var\(--ease\), visibility 0s linear 160ms; \}/.test(sec));
  assert(/html\.lighter\.theme-loop\.expanded \.app\.off-window \{ transition: none; \}/.test(sec));
  assert(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}\n\s*html\.theme-loop\.expanded \.grid, html\.theme-loop\.expanded \.app\.off-window \{ transition: none; \}/.test(sec));
  {
    // the panel's geometry, in design px: clip and the focused tile (112 px, scale 1.12 about its centre, 6 px up
    // scaled, the 5 px ring scaled) and the third row's label (8 px under the tile, 32 px tall, scaled with it)
    const clip = { left: 72 + 8, top: 560 + 8, right: 1848 - 8, bottom: 1036 - 4 };
    const x0 = clip.left + 16, y0 = clip.top + 28, tile = 112, pitch = 136, s = 1.12, up = 6 * s, ring = 5 * s;
    assert.deepStrictEqual([x0, y0], [96, 596], 'the first tile where the design puts it');
    const cx = x0 + tile / 2, cy = y0 + tile / 2 - up;
    assert(cx - (tile / 2) * s - ring >= clip.left, 'the first column\'s ring is inside the clip');
    assert(cy - (tile / 2) * s - ring >= clip.top, 'the first row\'s ring is inside the clip');
    const lx = 1840 - 16 - tile / 2;   // right to left, the first column at the right
    assert(lx + (tile / 2) * s + ring <= clip.right, 'right to left too');
    const c3 = y0 + 2 * pitch + tile / 2;
    assert(c3 + (tile / 2 + 8 + 32) * s - up <= clip.bottom, 'the third row\'s label is inside the clip');
    assert(y0 + 3 * pitch < clip.bottom, 'the fourth row would show inside the clip, so app.js hides it');
  }
  assert(/html\.lighter\.theme-loop \.qbtn:not\(\.focus\), html\.lighter\.theme-loop \.qbtn\.set,\n[^{]*\{ transition-duration: 0ms; \}/.test(sec), 'Lighter: the unfocused quick buttons too');
  assert(/html\.theme-loop \.lcard\.focus, html\.theme-loop \.ncard\.focus \{ transform: scale\(1\.05\);/.test(sec));
  assert(/html\.theme-loop \.qbtn\.focus, html\.lighter\.theme-loop \.qbtn\.focus \{\n\s*background: #fff; color: var\(--loop-ink\); transform: scale\(1\.10\);/.test(sec));
  assert(/html\.lighter\.theme-loop \.tile, [^{]*html\.lighter\.theme-loop \.qbtn\.focus \{ transition-duration: 0ms; \}/.test(sec), 'Lighter: nothing glides');
  assert(!/html\.lighter\.theme-loop \.toast/.test(sec), 'Lighter: the toast keeps its fade');
  assert(/\.theme-night \.qbtn \{ min-width: 5\.5rem; height: 5\.5rem;/.test(css), 'the Night rules are still there');
  // the glass box is not inside the buttons: it fades with them under Hide rows when idle and the Ambient music screen
  assert(/html\.idle-photo \.loop-glass, html\.ambient-active \.loop-glass \{ opacity: 0; visibility: hidden; transition: opacity 400ms ease, visibility 0s linear 400ms; \}/.test(sec), 'the glass hides with the buttons');
  assert(/^\.loop-glass \{[^}]*transition: opacity 400ms ease; \}/m.test(sec), 'and fades back with them');
  // Home settings, Look: no Glass or Mac-style dock row in Loop (neither does anything there)
  assert(/if \(!LOOP\) rows\.push\(\{ kind: "cycle", key: "glass",/.test(source), 'no Glass row in Loop');
  assert(/if \(NIGHT && !LOOP\) rows\.push\((heldByLighter\()?\{ kind: "toggle", key: "dock-mac",/.test(source), 'no Mac-style dock row in Loop');
  // a Couch TV Studio design does not start in the Loop look (the Loop look wins); in the other looks as before
  assert(/var designOn = typeof CouchDesign !== "undefined" && !!\(GATE\.design \|\| GATE\.preview\);\n(\s*\/\/[^\n]*\n)*\s*if \(designOn && LOOP\) \{ designOn = false; console\.log\(/.test(source), 'no design in Loop');
  assert(source.indexOf('if (designOn && LOOP)') < source.indexOf('if (designOn && typeof CouchDesigner !== "undefined") CouchDesigner.lockPage'), 'decided before the page policy and CouchDesign.start');
  assert(source.indexOf('if (designOn) CouchDesign.start(CFG.design') > 0);
  // the files' folder: the bridge's address when the page has one, else next to the page
  {
    const line = source.match(/^\s*var LOOP_DIR = [^\n]*$/m)[0];
    const dir = (api) => vm.runInNewContext(line + '; LOOP_DIR', { API: api });
    assert.strictEqual(dir(''), 'loop/', 'no ?api=: next to the page (/tv/loop/ on the bridge and offline, /loop/ standalone)');
    assert.strictEqual(dir('http://192.0.2.5:8765'), 'http://192.0.2.5:8765/tv/loop/', 'an LG or Samsung build asks its bridge');
  }
  assert(/kind: "video", live: true,/.test(mock), 'mock.js shows a live video card');
  // mock.js and the words
  assert(/if \(arg\("look"\) === "loop"\) \{\n\s*cfg\.home\.loop = \{ variants: \[\], blur: false, fg: arg\("depth"\) !== "0",\n\s*meta: \{ still: true, seconds: 34, fps: 30, zoom: 0, sway: 0, fg: \{ x: 0, y: 0, w: 1920, h: 1080 \} \} \};/.test(mock),
    'mock.js answers home.loop with no variants, and depth with the whole frame cut-out at the full screen and no motion');
  assert(/no scrim\n[^\n]*baked in, so it looks brighter than the TV's/.test(mock), 'mock.js says its cut-out has no scrim');
  ['look_loop', 'live_card', 'video_card'].forEach(function (k) {
    const count = (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length;
    assert.strictEqual(count, 16, `${k} must exist in all 16 languages (found ${count})`);
  });
  assert.strictEqual((i18n.match(/look_loop: "Loop"/g) || []).length, 16, 'Loop is a name, the same everywhere');

  // ---------------- depth: the moving cut-out over the clock (docs/LOOP.md, the depth effect) ----------------
  const META = { still: true, seconds: 34, fps: 30, zoom: 0.06, sway: 0.3, fg: { x: 480, y: 162, w: 960, h: 318 } };
  body.children = [scrim]; head.children = []; clockCol.children = [timeEl, dateEl];
  context.LOOP = true; context.MOCK = false; context.LIGHTER = false; context.SUN_SYNC = true; context.phase = 'day';
  root.classList.remove('loop-depth');
  // no cut-out unless the bridge says fg and meta has its rectangle
  context.HOME = { loop: { variants: ['day', 'night'], blur: false, meta: META, fg: false } };
  context.loopInit();
  assert.strictEqual(context.loopFg, null, 'home.loop.fg false: no cut-out');
  assert(!root.classList.contains('loop-depth'), 'and the clock stays where it was');
  context.HOME = { loop: { variants: ['day', 'night'], blur: false, meta: Object.assign({}, META, { fg: null }), fg: true } };
  context.loopInit();
  assert.strictEqual(context.loopFg, null, 'meta without a rectangle: no cut-out');
  context.HOME = { loop: { variants: ['day', 'night'], blur: false, meta: { seconds: 'x' }, fg: true } };
  context.loopInit();
  assert.strictEqual(context.loopFg, null, 'meta that makes no sense: no cut-out');
  // with it: one <img> right after #time, its rectangle in rem, the screen centre as its origin
  body.children = [scrim];
  context.HOME = { loop: { variants: ['day', 'night'], blur: false, meta: META, fg: true, version: 'v1' } };
  context.loopInit();
  const fg = context.loopFg, sharp2 = context.loopSharp;
  assert(fg && fg.id === 'loop-fg' && fg.className === 'loop-fg');
  assert.strictEqual(clockCol.children.indexOf(fg), clockCol.children.indexOf(timeEl) + 1, 'right after the clock, before the date line');
  assert.strictEqual(fg.getAttribute('aria-hidden'), 'true');
  assert.deepStrictEqual([fg.style.left, fg.style.top, fg.style.width, fg.style.height], ['30rem', '10.125rem', '60rem', '19.875rem']);
  assert.strictEqual(fg.style.transformOrigin, '30rem 23.625rem', 'the screen centre (960, 540) from the box at (480, 162)');
  assert.strictEqual(fg.style.clipPath, undefined, 'no clip on the real cut-out');
  assert(root.classList.contains('loop-depth'), 'html.loop-depth moves the clock down');
  assert.strictEqual(fg.src, 'loop/day-fg.png?v=v1', 'the variant playing, with the version mark');
  // the keyframes, injected once
  assert.strictEqual(head.children.length, 1);
  const kfText = head.children[0].textContent;
  assert.strictEqual(head.children[0].id, 'loop-depth-kf');
  assert.strictEqual((kfText.match(/% \{ transform:/g) || []).length, 41, '41 stops, every 2.5 percent');
  const stop = (pct) => {
    const m = kfText.match(new RegExp(' ' + pct.replace('.', '\\.') + '% \\{ transform: translateX\\((-?[0-9.e-]+)vw\\) scale\\(([0-9.]+)\\); \\}'));
    assert(m, 'a stop at ' + pct + '%');
    return [Number(m[1]), Number(m[2])];
  };
  const want = (f) => { const a = 2 * Math.PI * f, z = 1 + 0.06 * (1 - Math.cos(a)) / 2; return [-(0.3 * (z - 1) / 2 * 100) * Math.sin(a), z]; };
  [['0', 0], ['25', 0.25], ['50', 0.5], ['75', 0.75], ['100', 1], ['2.5', 0.025]].forEach(([pct, f]) => {
    const [x, z] = stop(pct), [wx, wz] = want(f);
    assert(Math.abs(x - wx) < 1e-5 && Math.abs(z - wz) < 1e-6, pct + '%: ' + x + ' ' + z + ' against ' + wx + ' ' + wz);
  });
  assert.deepStrictEqual(stop('0'), [0, 1], 'the start is the neutral position (frame 0, the poster)');
  assert.deepStrictEqual(stop('25'), [-0.45, 1.03], 'a quarter in: the window has moved right, so the picture left, at half the zoom');
  assert.deepStrictEqual(stop('50'), [0, 1.06], 'halfway: the deepest zoom, centred');
  assert.deepStrictEqual(stop('75'), [0.45, 1.03]);
  assert(!/filter/.test(kfText));
  context.loopInit();
  assert.strictEqual(head.children.length, 1, 'the keyframes go in once');
  body.children = [scrim]; clockCol.children = [timeEl, dateEl];
  context.loopInit();
  const fg2 = context.loopFg, s2 = context.loopSharp;
  // before the video plays: held at 0, the poster's position
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite paused', 'loading: paused at 0');
  // the 4 s timer's play() before the file can play: waiting comes with paused false, and it stays held at 0
  s2.paused = false; s2.readyState = 1; s2.fire('waiting');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite paused', 'play() with no data yet: still held at 0');
  s2.paused = true; s2.readyState = 4;
  s2.fire('canplaythrough');
  assert.strictEqual(s2.plays, 1);
  // playing: the delay is minus the video's time
  s2.currentTime = 12.25; s2.paused = false;
  s2.fire('playing');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -12.250s infinite running', 'running from the video time');
  // a stall holds it where the frame stopped (paused stays false, as on a real media element, and readyState
  // drops to HAVE_CURRENT_DATA); playing again starts it from there
  s2.currentTime = 13.5; s2.readyState = 2; s2.fire('waiting');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -13.500s infinite paused', 'a stall holds it');
  s2.readyState = 4; s2.fire('playing');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -13.500s infinite running');
  // the wrap the Loop code already finds restarts it from the new time
  s2.currentTime = 33.9; context.loopLastT = 33.6; context.loopTimeUpdate();
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -13.500s infinite running', 'no restart mid loop');
  s2.currentTime = 0.2; context.loopLastT = 33.9; context.loopTimeUpdate();
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -0.200s infinite running', 'restarted at the wrap');
  assert.strictEqual(context.loopFgAnim(70.5, true), 'loop-depth 34s linear -2.500s infinite running', 'a time past one loop is taken modulo its length');
  // the variant switch: the cut-out is decoded with the poster, then swapped with it, held until the new file plays
  decoded = [];
  context.phase = 'night'; context.loopTick();
  assert.deepStrictEqual(decoded, ['loop/night.jpg?v=v1', 'loop/night-fg.png?v=v1'], 'the poster and the cut-out are decoded first');
  await tick();
  assert.strictEqual(fg2.src, 'loop/day-fg.png?v=v1', 'not before the boundary');
  s2.currentTime = 33.9; context.loopLastT = 33.6; context.loopTimeUpdate();
  assert.strictEqual(s2.src, 'loop/night.mp4?v=v1');
  assert.strictEqual(fg2.src, 'loop/night-fg.png?v=v1', 'swapped together with the poster');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite paused', 'held at 0 while the new file loads');
  s2.currentTime = 0; s2.paused = false; s2.fire('playing');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite running');
  // tv.pause: hidden with the videos and stopped; tv.resume: back, held, then running with the video
  context.loopPause();
  assert(fg2.classList.contains('off'), 'hidden on tv.pause');
  assert.strictEqual(fg2.style.animation, 'none');
  s2.fire('pause');
  assert.strictEqual(fg2.style.animation, 'none', 'the pause event after it changes nothing while away');
  context.isActive = true;
  context.loopResume();
  assert(!fg2.classList.contains('off'));
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite paused');
  s2.fire('canplaythrough'); s2.currentTime = 1; s2.paused = false; s2.fire('playing');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -1.000s infinite running', 'and runs again once the video plays');
  // kids mode hides the header (display: none drops a running animation): the clips let go with it, and when
  // it ends the cut-out waits at 0 with the poster and runs from the video's time once it plays, in step
  context.kids = true; context.loopCover();
  assert(fg2.classList.contains('off') && fg2.style.animation === 'none', 'kids mode: the cut-out stops with the clips');
  context.kids = false; context.loopCover();
  assert(!fg2.classList.contains('off'));
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear 0.000s infinite paused', 'kids mode ends: held at 0 while the file loads');
  s2.fire('canplaythrough'); s2.currentTime = 0.5; s2.paused = false; s2.fire('playing');
  assert.strictEqual(fg2.style.animation, 'loop-depth 34s linear -0.500s infinite running', 'then running from the video time');
  // a kids profile on the couch when the page starts (kidSync runs before loopInit): let go straight away
  body.children = [scrim]; clockCol.children = [timeEl, dateEl]; context.kids = true;
  context.loopInit();
  const s3 = context.loopSharp;
  assert(context.loopOff && s3.src === '' && s3.classList.contains('off'), 'kids mode at start: no clip decoding behind the shelf');
  const p3 = s3.plays; timers[timers.length - 1].f(); s3.fire('canplaythrough');
  assert.strictEqual(s3.plays, p3, 'and the start load plays nothing');
  assert.strictEqual(s3.getAttribute('poster'), 'loop/night.jpg?v=v1', 'the poster stays');
  context.kids = false; context.loopCover();
  assert.strictEqual(s3.src, 'loop/night.mp4?v=v1', 'kids mode ends: the clip');
  body.children = [scrim]; clockCol.children = [timeEl, dateEl];
  context.loopInit();
  assert.strictEqual(context.loopOff, false, 'a new start is not let go');
  const fg3 = context.loopFg, s4 = context.loopSharp;
  s4.fire('canplaythrough'); s4.currentTime = 1; s4.paused = false; s4.fire('playing');
  assert.strictEqual(fg3.style.animation, 'loop-depth 34s linear -1.000s infinite running');
  // the file does not load: hidden, and the clock goes back up; a later one that loads brings both back
  fg2.onerror();
  assert(fg2.classList.contains('failed') && !root.classList.contains('loop-depth'));
  fg2.onload();
  assert(!fg2.classList.contains('failed') && root.classList.contains('loop-depth'));
  // the preview: the whole frame stand-in, cut to make-loop.sh's rectangle so the row and the dock stay in view
  body.children = [scrim]; clockCol.children = [timeEl, dateEl]; context.MOCK = true;
  context.HOME = { loop: { variants: [], blur: false, fg: true, meta: { still: true, seconds: 34, fps: 30, zoom: 0, sway: 0, fg: { x: 0, y: 0, w: 1920, h: 1080 } } } };
  context.loopInit();
  assert.strictEqual(context.loopFg.src, 'backgrounds/scene-night-fg.webp');
  assert.strictEqual(context.loopSharp.getAttribute('poster'), 'backgrounds/scene-night.jpg');
  assert.deepStrictEqual([context.loopFg.style.left, context.loopFg.style.width, context.loopFg.style.transformOrigin], ['0rem', '120rem', '60rem 33.75rem']);
  assert.strictEqual(context.loopFg.style.clipPath, 'inset(10.125rem 30rem 37.5rem 30rem)');
  assert.strictEqual(context.loopFg.style.animation, 'loop-depth 34s linear 0.000s infinite paused', 'the preview does not move');
  context.MOCK = false;
  // app.css: the cut-out only in the Loop look with depth on, no filter, hidden when off or failed; the clock lower
  assert(/^\.loop-fg \{ display: none; \}$/m.test(sec), 'no cut-out in any other look');
  assert(/html\.theme-loop\.loop-depth \.loop-fg \{ display: block; position: fixed; margin: 0; pointer-events: none; will-change: transform; \}/.test(sec));
  assert(/html\.theme-loop\.loop-depth \.loop-fg\.off, html\.theme-loop \.loop-fg\.failed \{ display: none; \}/.test(sec));
  assert(/html\.theme-loop\.loop-depth \.time \{ top: 12\.75rem; \}/.test(sec), 'the clock from y 204');
  assert(/html\.theme-loop\.loop-depth \.date \{ top: 9\.5rem; \}/.test(sec), 'the date line from y 152');
  // the Ambient music screen opens under the header: the cut-out hidden there, keeping time, and the clock back up
  assert(/html\.theme-loop\.loop-depth\.ambient-active:not\(\.ambient-minimized\) \.loop-fg \{ visibility: hidden; \}/.test(sec), 'no cut-out over the music screen');
  assert(/html\.theme-loop\.loop-depth\.ambient-active:not\(\.ambient-minimized\) \.time \{ top: 7\.75rem; \}/.test(sec), 'the clock clear of the album art');
  assert(/html\.theme-loop\.loop-depth\.ambient-active:not\(\.ambient-minimized\) \.date \{ top: 4\.5rem; \}/.test(sec));
  assert(/html\.theme-loop \.time \{\n\s*display: block; position: fixed; left: 0; right: 0; top: 7\.75rem;/.test(sec), 'without depth the clock stays at y 124');
  assert(!/animation:\s*none/.test(sec.replace(/html\.theme-loop \.tile\.focus \.face \{ animation: none; \}/, '')), 'no Loop rule (Lighter included) stops the cut-out');

  // ---------------- a design in the Loop look: the preview opens in Night, a code switches to Night, the row says so ----------------
  assert(/if \(THEME === "loop" && GATE\.preview\) THEME = "night";/.test(source), 'Studio\'s preview opens in Night');
  assert(/if \(LOOP\) \{ ST\.look = "night"; keep\("tvhome\.look", "night"\); saveSettings\(\); \}/.test(source), 'a design got by code switches the home to Night');
  assert(/if \(on && has && !held && CFG\.design && LOOP\) rows\.push\(\{ kind: "action", key: "dz-loop"/.test(source), 'in Loop the design row says where it shows');

  // ---------------- the dock centred; the More apps panel keeps its full width; down finds the nearest tile ----------------
  assert(/html\.theme-loop \.apps \{ top: auto; bottom: 3\.5rem; left: 50%; right: auto; transform: translateX\(-50%\); \}/.test(sec), 'the dock is centred');
  assert(/html\.theme-loop\.expanded \.apps \{ top: 35rem; bottom: auto; left: 4\.5rem; right: 4\.5rem; transform: none;/.test(sec), 'the panel runs from x 72 to 1848');
  assert(!/html\.theme-loop[^{]*\.apps[^{]*\{[^}]*transition/.test(sec), 'no transition on the dock');
  assert(/html\.theme-loop \.shelf \{ top: 37\.25rem; left: 6rem; right: 6rem;/.test(sec), 'the row stays on the left axis');
  assert(/\(GRID_COLS - 1\) \* 1\.625 \+ \(LOOP \? 0 : 3\.5\)\) \+ "rem"/.test(source), 'an old WebView sizes the Loop dock without the Night padding, so it centres');
  // twelve 112 px tiles with 24 px gaps, centred: from x 156; the row's cards from x 96, 340 apart
  const rect = (l, w) => ({ getBoundingClientRect: () => ({ left: l, width: w, top: 0, height: w }) });
  context.GRID_COLS = 12;
  context.gridEls = Array.from({ length: 12 }, (_, i) => rect(156 + i * 136, 112));
  const cardCentre = (i) => 96 + i * 340 + 160;
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => context.nearestInRow(0, cardCentre(i))), [0, 3, 5, 8, 10], 'each card lands on the dock tile under it');
  context.gridEls = Array.from({ length: 6 }, (_, i) => rect(564 + i * 136, 112));   // six apps: a shorter dock, still centred
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((i) => context.nearestInRow(0, cardCentre(i))), [0, 0, 2, 5, 5], "tile centres 620 to 1300");
  assert(/g = nearestInRow\(0, b\.left \+ b\.width \/ 2\);/.test(source), 'down from a card measures its centre');
  console.log('Loop look tests passed.');
})().catch(function (e) { console.error(e); process.exit(1); });


// the bridge's mark of the files goes on every address, so a new encode is fetched past the TV's cache.
// The shared context's loop state is put back afterwards: the switch tests above finish on later ticks.
{
  const keep = { HOME: context.HOME, v: context.loopVariants, b: context.loopBlurOn, ver: context.loopVersion };
  context.HOME = { loop: { variants: ['day'], blur: true, version: 'abc123def0' } };
  context.loopReadConfig();
  const f = context.loopFiles('day');
  assert.strictEqual(f.video, 'loop/day.mp4?v=abc123def0');
  assert.strictEqual(f.blur, 'loop/day-blur.mp4?v=abc123def0');
  assert.strictEqual(f.poster, 'loop/day.jpg?v=abc123def0');
  assert.strictEqual(f.bposter, 'loop/day-blur.jpg?v=abc123def0');
  context.HOME = { loop: { variants: ['day'], blur: true } };
  context.loopReadConfig();
  assert.strictEqual(context.loopFiles('day').video, 'loop/day.mp4', 'no mark, no suffix');
  context.HOME = keep.HOME; context.loopVariants = keep.v; context.loopBlurOn = keep.b; context.loopVersion = keep.ver;
}
console.log('Loop look version tests passed.');

// a Loop card's picture that never loads (kwArtRetry gives up after six tries): the plate with the app's icon,
// like a card that had no picture; any other card's picture gives way to the show's title (g03: it was left
// as an empty tile; with an app it first tries the app's banner, see tests/test_social_bugs_browser.mjs)
{
  const w = {}, ctx = { window: w, setTimeout: () => 0, iconUrl: () => null, document: { documentElement: { contains: () => true }, createElement: (t) => el(t) } };
  vm.createContext(ctx);
  vm.runInContext(part('  var ART_RETRY_MS', '  function glassSetting()'), ctx);
  const card = (cls) => {
    const box = el('div'), img = el('img'), badge = el('img');
    if (cls) box.classList.add(cls);
    badge.className = 'lbadge';
    box.appendChild(img); box.appendChild(badge);
    box.querySelector = (q) => (q === '.lbadge' ? badge : null);
    box.replaceChild = (nw, old) => { const i = box.children.indexOf(old); box.children[i] = nw; nw.parentNode = box; old.parentNode = null; };
    img.setAttribute('src', 'http://x/a.jpg');
    return { box, img, badge };
  };
  const c = card('lthumb');
  for (let i = 0; i < 6; i++) w.kwArtRetry(c.img);
  assert(!c.box.classList.contains('plate') && c.box.children.includes(c.img), 'asked for again six times first');
  w.kwArtRetry(c.img);
  assert(c.box.classList.contains('plate'), 'then the plate');
  assert(!c.box.children.includes(c.img), 'without the broken picture');
  assert.strictEqual(c.badge.className, 'picon', 'the badge is the plate\'s icon');
  const n = card('');
  for (let i = 0; i < 7; i++) w.kwArtRetry(n.img);
  assert(!n.box.children.includes(n.img) && n.box.children[0].className === 'no-art' && n.badge.className === 'lbadge', 'a picture outside a Loop card gives way to the title');
  console.log('Loop card picture fallback tests passed.');
}

// Now playing in the Loop look is a line at the top left, under the people and above the row: a stop in the
// top row (Left from the sleep button), Down to the row under it, Up from the row to it, Up from it to the people
{
  const rect = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const np = el('div');
  np.getBoundingClientRect = () => rect(96, 76, 565, 32);
  const ctx = {
    document: { documentElement: { dir: 'ltr' } }, touched: false,
    LOOP: true, NIGHT: true, footballEnabled: false, LOCAL_SPOTIFY: false, expanded: false, AMBIENT_MUSIC: false, music: { state: 'playing' }, lift: null,
    zone: 'shelf', s: 0, g: 0, qi: 0, pi: 0, npI: 1, currentNpBtns: [], GRID_COLS: 12, people: 1, quick: 2, reach: true,
    shelfEls: [1, 2, 3, 4, 5], gridItems: [], PEOPLE: [{ id: 'a' }, { id: 'b' }],
    gridEls: Array.from({ length: 6 }, (_, i) => ({ getBoundingClientRect: () => rect(564 + i * 136, 912, 112, 112) })),
    $: (id) => (id === 'np' ? np : null),
    designHides: () => false, npButtons: () => [1, 2, 3], npReach: () => ctx.reach, hasQuick: () => ctx.quick > 0,
    quickVisible: () => Array(ctx.quick), peopleOn: () => ctx.people >= 2, toPeople: () => { ctx.zone = 'people'; ctx.pi = 0; },
    isHead: () => false, paintFocus() {}, renderGrid() {}, gridKey: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(part('  function nearestInRow(', '  // which app a grid tile is'), ctx);
  vm.runInContext(part('  function move(dx, dy) {', '  // ---------------- going round at the ends'), ctx);
  const at = (zone, extra) => Object.assign(ctx, { zone }, extra || {});
  // one person, music playing, cards in the row
  at('quick', { qi: 0 }); ctx.move(-1, 0);
  assert.deepStrictEqual([ctx.zone, ctx.npI], ['np', 2], 'Left from the sleep button: Now playing, on its last button');
  ctx.move(-1, 0); assert.deepStrictEqual([ctx.zone, ctx.npI], ['np', 1], 'along its buttons');
  ctx.move(1, 0); ctx.move(1, 0); assert.deepStrictEqual([ctx.zone, ctx.qi], ['quick', 0], 'right past the last button: the sleep button');
  at('np', { npI: 1, s: 0 }); ctx.move(0, 1);
  assert.deepStrictEqual([ctx.zone, ctx.s], ['shelf', 0], 'Down: the row under it, not the dock');
  at('shelf', { s: 2 }); ctx.move(0, -1); assert.strictEqual(ctx.zone, 'np', 'Up from the row: Now playing');
  at('shelf', { s: 0 }); ctx.move(-1, 0); assert.strictEqual(ctx.zone, 'shelf', 'Left from the first card stays in the row (no jump up to the top left)');
  at('np'); ctx.move(0, -1); assert.strictEqual(ctx.zone, 'np', 'one person: Up from Now playing goes round (wrapRound), not here');
  // two people: the people sit above Now playing
  ctx.people = 2;
  at('np'); ctx.move(0, -1); assert.strictEqual(ctx.zone, 'people', 'Up: the people');
  ctx.move(0, 1); assert.strictEqual(ctx.zone, 'np', 'Down from the people: Now playing');
  at('shelf', { s: 1 }); ctx.move(0, -1); assert.strictEqual(ctx.zone, 'np', 'Up from the row: Now playing, under the people');
  at('quick', { qi: 0 }); ctx.move(-1, 0); assert.strictEqual(ctx.zone, 'np', 'Left from the sleep button still lands on it');
  // no cards: Down lands on the dock tile nearest under it
  ctx.shelfEls = [];
  at('np'); ctx.move(0, 1); assert.deepStrictEqual([ctx.zone, ctx.g], ['grid', 0], 'no row: the dock');
  ctx.shelfEls = [1, 2, 3, 4, 5];
  // no song: as before
  ctx.reach = false;
  at('quick', { qi: 0 }); ctx.move(-1, 0); assert.strictEqual(ctx.zone, 'people', 'no Now playing: Left from sleep goes to the people');
  at('shelf', { s: 1 }); ctx.move(0, -1); assert.strictEqual(ctx.zone, 'people');
  ctx.people = 1;
  at('shelf', { s: 1 }); ctx.move(0, -1); assert.deepStrictEqual([ctx.zone, ctx.qi], ['quick', 0]);
  // the Night look keeps its card in the row: left from the first card, Down to the dock
  Object.assign(ctx, { LOOP: false, reach: true });
  at('shelf', { s: 0 }); ctx.move(-1, 0); assert.strictEqual(ctx.zone, 'np', 'Night: Now playing is the card left of the row');
  at('quick', { qi: 0 }); ctx.move(-1, 0); assert.strictEqual(ctx.zone, 'quick', 'Night: Left from sleep as before');
  at('np', { npI: 2 }); ctx.move(1, 0); assert.deepStrictEqual([ctx.zone, ctx.s], ['shelf', 0], 'Night: right past the last button, the row');
  at('np'); ctx.move(0, 1); assert.strictEqual(ctx.zone, 'grid', 'Night: Down, the dock');
  console.log('Loop Now playing navigation tests passed.');
}

// the date line makes room for the Now playing line: it shares the people's column at the top left, at the date
// line's height with one person, or under a tall head icon with the depth cut-out (the date line at y 152)
{
  const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
  const box = (r) => { const e = el('div'); e.getBoundingClientRect = () => r; return e; };
  const run = (o) => {
    const date = el('div'), line = box(o.date);
    date.appendChild(line); date.scrollWidth = 0; date.clientWidth = 0;
    const np = box(o.np || rect(0, 0, 0, 0)); if (o.np) np.classList.add('on');
    const els2 = { date, quick: el('div'), qbtns: box(o.q), people: box(o.people || rect(0, 0, 0, 0)), np };
    const ctx = { LOOP: o.loop !== false, NIGHT: true, innerWidth: 1920, document: { documentElement: { dir: o.rtl ? 'rtl' : 'ltr' } }, $: (id) => els2[id] };
    vm.createContext(ctx);
    vm.runInContext(part('  function fitDate() {', '  // Sun-synchronized'), ctx);
    ctx.fitDate();
    return [date.style.left || '', date.style.right || ''];
  };
  const DATE = rect(537, 72, 1384, 112), Q = rect(1760, 64, 1824, 128);
  assert.deepStrictEqual(run({ date: DATE, q: Q }), ['', ''], 'no song: centred');
  assert.deepStrictEqual(run({ date: DATE, q: Q, np: rect(96, 76, 661, 108) }), ['685px', '184px'],
    'one person and a song: the date line starts 24 px after the song, and stays clear of the quick buttons');
  assert.deepStrictEqual(run({ date: DATE, q: rect(96, 64, 160, 128), np: rect(1259, 76, 1824, 108), rtl: true }), ['184px', '685px'], 'right to left: mirrored');
  assert.deepStrictEqual(run({ date: rect(537, 152, 1384, 192), q: Q, people: rect(96, 64, 184, 152), np: rect(96, 164, 661, 196) }), ['685px', ''],
    'three people and depth: the song under the head icon, at the date line\'s height');
  assert.deepStrictEqual(run({ date: DATE, q: Q, people: rect(96, 64, 600, 112), np: rect(96, 76, 300, 108) }), ['624px', '184px'], 'whichever reaches further in');
  assert.deepStrictEqual(run({ date: DATE, q: Q, np: rect(96, 124, 661, 156) }), ['', ''], 'a song below the date line\'s band: centred');
  assert.deepStrictEqual(run({ date: DATE, q: Q, np: rect(96, 76, 661, 108), loop: false }), ['', ''], 'Night: the song is a card in the row, not measured');
  // it runs again as the song comes, goes or changes, and when the people above it change
  const calls = [];
  const ctx = { LOOP: true, fitDate: () => calls.push(1) };
  vm.createContext(ctx);
  vm.runInContext(part('  var npFitKey', '  function renderNp()'), ctx);
  ctx.npFit('a'); ctx.npFit('a'); ctx.npFit(''); ctx.npFit('');
  assert.strictEqual(calls.length, 2, 'once per change, not on every key press');
  ctx.LOOP = false; ctx.npFit('b'); assert.strictEqual(calls.length, 2, 'only in the Loop look');
  assert(/if \(!on\) \{[^}]*el\.innerHTML = "";[^}]*npFit\(""\);\s*return;\s*\}/.test(source) && /npFit\(\[music\.title, music\.artist \|\| music\.album \|\| "", btns\.length\]\.join\("\\n"\)\);\n  \}/.test(source), 'renderNp refits the date line');
  assert(/renderPop\(\);\n\s*if \(LOOP && npVisible\(\)\) fitDate\(\);/.test(source), 'so does renderPeople');
  console.log('Loop date line and Now playing tests passed.');
}
