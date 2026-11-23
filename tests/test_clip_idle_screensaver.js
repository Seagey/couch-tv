// After the home's idle time the scene clips pause and Couch TV starts the TV's own screensaver.
// 0.13.9 read a soundscape flag that lived only inside checkSmartIdle, so the timer threw and the
// screensaver never started. With Smart Idle on, its own action runs (ambient clock, screen off, TV off),
// so the timer leaves the TV's screensaver alone.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running clip idle screensaver tests...');
const app = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const match = app.match(new RegExp(`^  function ${name}\\([^)]*\\) \\{[\\s\\S]*?^  \\}`, 'm'));
  assert(match, `app.js defines ${name}()`);
  return match[0];
}

const clipWake = extractFunction('clipWake');
const soundscapePlaying = extractFunction('soundscapePlaying');
assert(!/sndPlaying/.test(clipWake), 'clipWake reads no name from another function');
assert(/soundscapePlaying\(\)/.test(extractFunction('checkSmartIdle')), 'Smart Idle uses the same soundscape check');

let checks = 0;
function run(opts) {
  const timers = [];
  const calls = { start: 0, videos: [] };
  const ctx = {
    SMART_IDLE: { enabled: !!opts.smart, home_idle_minutes: 15, quiet_hours: { enabled: false } },
    HOME: {},
    isQuietHours: () => false,
    clipsIdle: false, clipIdleTimer: null,
    screenOffActive: false, idleAmbientActive: false,
    document: { hidden: false },
    window: { Soundscape: opts.sound ? { current: () => opts.sound } : undefined },
    TV: { canStartScreensaver: () => true, startScreensaver: () => { calls.start++; } },
    sceneVideos: (on) => { calls.videos.push(on); },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: () => {},
  };
  vm.runInNewContext(`var clipsIdle = false, clipIdleTimer = null;\n${soundscapePlaying}\n${clipWake}\nthis.clipWake = clipWake;`, ctx);
  ctx.clipWake();
  assert.strictEqual(timers.length, 1, 'one idle timer is set');
  assert.strictEqual(timers[0].ms, 15 * 60000, 'after the home idle time');
  assert.doesNotThrow(() => timers[0].f(), 'the idle timer runs without an error');
  assert.deepStrictEqual(calls.videos, [false], 'the clips pause');
  checks += 3;
  return calls.start;
}

assert.strictEqual(run({}), 1, 'Smart Idle off: the TV screensaver starts'); checks++;
assert.strictEqual(run({ sound: 'off' }), 1, 'a soundscape set to off does not hold it'); checks++;
assert.strictEqual(run({ sound: 'rain' }), 0, 'a playing soundscape keeps the screensaver away'); checks++;
assert.strictEqual(run({ smart: true }), 0, 'Smart Idle on: its own action runs, not the TV screensaver'); checks++;

console.log(`Clip idle screensaver tests passed (${checks} checks).`);
