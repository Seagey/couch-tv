// The home does nothing while an app or the TV's screensaver covers it, and its scenes survive a lost
// picture and cost less while they wait (a 2 GB Fire TV Cube swung 115 to 260 MB of GPU memory at every
// scene change, and showed a black scene for a whole turn when one photo was lost on weak Wi-Fi).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running home idle and scene tests...');
const app = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8').replace(/\r\n/g, '\n');
const kt = fs.readFileSync(path.join(__dirname, '../tv-home/android/app/src/main/java/app/couchtv/launcher/MainActivity.kt'), 'utf8');

function extractFunction(name) {
  const match = app.match(new RegExp(`^  function ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}`, 'm'));
  assert(match, `app.js defines ${name}()`);
  return match[0];
}

// 1. the launcher pauses the WebView after telling the page, and resumes it before telling the page
const onPause = kt.slice(kt.indexOf('override fun onPause()'), kt.indexOf('override fun dispatchKeyEvent'));
assert(onPause.indexOf('tv.pause') < onPause.indexOf('if (pageReady) { web?.onPause(); web?.pauseTimers() }'), 'onPause tells the page before pausing its timers, and only once the page is up');
assert(/if \(pageReady\) js\("window\.tv && tv\.resume\(\)"\)/.test(kt), 'every copy of the page is told the home is back, the saved one included');
const onResume = kt.slice(kt.indexOf('override fun onResume()'), kt.indexOf('override fun onPause()'));
assert(onResume.indexOf('web?.resumeTimers(); web?.onResume()') < onResume.indexOf('tv.resume()'), 'onResume resumes the timers before telling the page');

// 2. the page's own guards: timers wait while covered, the clock redraws on a new minute only
assert(/setInterval\(clockTick, 15000\)/.test(app), 'the clock ticks through clockTick');
assert(/setInterval\(function \(\) \{ if \(!covered\(\)\) refreshMusic\(\); \}, 5000\)/.test(app), 'the music poll waits while covered');
assert(/if \(!covered\(\)\) \{ if \(!screenOffActive\) renderQuick\(\); refreshBedtimeDim\(\); \}/.test(app), 'the soundscape still follows the sleep timer in the dark');
assert(/if \(zone !== "settings" && active\(\) && sceneMayChange\(\)\)/.test(app), 'scenes wait while covered and in the dark');
assert(/setTimeout\(followWhoTick, 3000\)/.test(app) && !/setInterval\(followWho, 3000\)/.test(app), 'the profile poll is a backing-off tick');
assert(/if \(!SMART_IDLE\.enabled \|\| covered\(\)/.test(app), 'smart idle waits while covered');
assert(/resume: function \(\) \{ PAGE_PAUSED = false; clock\(\);/.test(app), 'tv.resume redraws the clock first');

let clockCalls = 0;
const tick = { active: () => true, clock: () => { clockCalls++; }, clockMinute: '', NIGHT: true, glassShown: '21:07', Date: class extends Date { constructor() { super(2026, 10, 16, 21, 7, 30); } } };
vm.runInNewContext(`${extractFunction('clockTick')}\nthis.tick = clockTick;`, tick);
tick.tick(); assert.strictEqual(clockCalls, 1, 'a new minute redraws');
tick.clockMinute = '21:7'; tick.tick(); assert.strictEqual(clockCalls, 1, 'the same minute does not');
tick.glassShown = ''; tick.tick(); assert.strictEqual(clockCalls, 2, 'a glass setting change is redrawn on the next tick');
tick.glassShown = '21:07'; tick.clockMinute = ''; tick.active = () => false; tick.tick(); assert.strictEqual(clockCalls, 2, 'nothing while covered');

// 3. scenes: every picture is watched, a built-in one is asked for again, a faded scene gives its pictures back
assert(/watchImage\(el\.querySelector\("\.sbg"\), s, true\)/.test(app), 'every scene photo gets an error handler');
assert(/img\.src = base \+ \(base\.indexOf\("\?"\) < 0 \? "\?" : "&"\) \+ "retry=" \+ \(tries \+ 1\)/.test(app), 'a lost built-in picture is asked for again, keeping its own query');
assert(/if \(s\.lost \|\| !photoIn\(el\)\) \{/.test(app), 'a scene without its photo is passed over, never faded in');
assert(/function unreadyScene\(k\)[\s\S]*?img\.removeAttribute\("src"\)/.test(app), 'a faded scene releases its pictures');
assert(/var lead = SCENE_MS > 10000 \? SCENE_MS - PRE_READY_MS : 2000;/.test(app), 'the next scene is readied just before its turn on long turns');

// sceneLoaded: resolves at once for a decoded photo, on load for one still on its way, and never hangs
const sl = { setTimeout, clearTimeout, Promise };
vm.runInNewContext(`${extractFunction('sceneLoaded')}\nthis.sceneLoaded = sceneLoaded;`, sl);
function fakeImg(complete) {
  const h = {};
  return { complete, naturalWidth: complete ? 1920 : 0, addEventListener: (n, f) => { h[n] = f; }, removeEventListener: () => {}, fire: (n) => h[n] && h[n]() };
}
(async () => {
  let img = fakeImg(true);
  await sl.sceneLoaded({ querySelector: () => img }, 50);
  img = fakeImg(false);
  let done = false;
  const p = sl.sceneLoaded({ querySelector: () => img }, 5000).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert(!done, 'a photo still loading keeps the fade waiting');
  img.fire('load');
  await p;
  assert(done, 'the fade goes once the photo is in');
  img = fakeImg(false);
  const t0 = Date.now();
  await sl.sceneLoaded({ querySelector: () => img }, 30);
  assert(Date.now() - t0 < 1000, 'a photo that never comes does not hold the fade for ever');
  console.log('Home idle and scene tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
