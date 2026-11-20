// Low end TVs: Lighter home turns itself on when nobody has chosen (navigator.deviceMemory, else a
// measured frame time kept for a week), and the focused tile's sway and glint hold still a few seconds
// after the focus last moved. Measured on a 2 GB Android 11 TV: 60 frames a second at
// rest, 22 with a focused tile's sway, 47 with the blur off, 60 with the sway and glint still.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const web = path.join(__dirname, '..', 'tv-home', 'web');
const js = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');
const m = js.match(/function lowEndDecision\(o\) \{[\s\S]*?\n  \}/);
assert(m, 'lowEndDecision is in app.js');
const decide = new Function(m[0] + '; return lowEndDecision;')();
const now = Date.parse('2026-11-17T08:00:00Z'), day = 86400000;
const base = { now: now, days: 7 };
const d = (o) => decide(Object.assign({}, base, o));

// the setting wins, either way
assert.deepStrictEqual(d({ setting: true, memory: 8 }), { low: true, why: 'setting' });
assert.deepStrictEqual(d({ setting: false, memory: 1 }), { low: false, why: 'setting' });
// memory decides where it is clear
assert.deepStrictEqual(d({ setting: 'auto', memory: 1 }), { low: true, why: 'memory' });
assert.deepStrictEqual(d({ setting: 'auto', memory: 0.5 }), { low: true, why: 'memory' });
assert.deepStrictEqual(d({ setting: 'auto', memory: 8 }), { low: false, why: 'memory' });
// 4 GB is measured, not trusted (g01, #197, #213: a 4 GB Google TV Streamer, Homatics and TCL stuttered)
assert.strictEqual(d({ setting: 'auto', memory: 4 }), null, '4 GB is measured');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, medianMs: 30 }), { low: true, why: 'measured' }, '4 GB at 30 ms frames is low end');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, medianMs: 14 }), { low: false, why: 'measured' }, '4 GB at 14 ms frames is not');
assert.deepStrictEqual(d({ setting: false, memory: 4, medianMs: 30 }), { low: false, why: 'setting' }, 'a chosen setting always wins');
assert.deepStrictEqual(d({ setting: true, memory: 8, medianMs: 10 }), { low: true, why: 'setting' }, 'a chosen setting always wins');
// the frames while the focus moves along a row: two strikes (a stutter on a second start within a week)
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, medianMs: 15, navMs: 33 }), { low: false, why: 'strike' }, 'a first stutter is only a strike');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, medianMs: 15, navMs: 33, navStrike: true }), { low: true, why: 'moving' }, 'the second one turns it on');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, cached: { low: false, t: now - day }, navMs: 33, navStrike: true }), { low: true, why: 'moving' }, 'a kept "not low end" gives way to a second stutter');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, cached: { low: false, t: now - day }, navMs: 17, navStrike: true }), { low: false, why: 'measured' }, 'smooth this time: not low end');
// slow is against the screen's own refresh (#review: a smooth 30, 25 or 24 Hz screen is not a slow TV)
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 33.3, medianMs: 34 }), { low: false, why: 'measured' }, '30 Hz screen, 34 ms frames: smooth');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 40, medianMs: 41 }), { low: false, why: 'measured' }, '25 Hz screen: smooth');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 41.7, medianMs: 42 }), { low: false, why: 'measured' }, '24 Hz screen: smooth');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 16.7, medianMs: 30 }), { low: true, why: 'measured' }, '60 Hz screen, 30 ms frames: low end');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 33.3, medianMs: 50 }), { low: true, why: 'measured' }, '30 Hz screen, 50 ms frames: low end');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 33.3, medianMs: 15, navMs: 34, navStrike: true }), { low: false, why: 'measured' }, '30 Hz screen moving at its own rate: smooth');
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, idleMs: 200, medianMs: 60 }), { low: true, why: 'measured' }, 'a refresh over 42 ms counts as 42 (a stalled measurement is not a screen)');
// a stutter result is kept 30 days, a still measurement a week
assert.deepStrictEqual(d({ setting: 'auto', memory: 4, cached: { low: true, t: now - 20 * day, moving: true }, movingDays: 30 }), { low: true, why: 'measured' }, 'moving: kept 30 days');
assert.strictEqual(d({ setting: 'auto', memory: 4, cached: { low: true, t: now - 31 * day, moving: true }, movingDays: 30 }), null, 'and redone after');
assert.strictEqual(d({ setting: 'auto', memory: 4, cached: { low: true, t: now - 8 * day } }), null, 'a still measurement: a week');
assert.deepStrictEqual(d({ setting: 'auto', memory: 8, navMs: 40 }), { low: false, why: 'memory' }, '8 GB is not measured');
// 2 GB (the measured TV) or no figure: a measurement, unless one from this week is kept
assert.strictEqual(d({ setting: 'auto', memory: 2 }), null, '2 GB is measured');
assert.strictEqual(d({ setting: 'auto' }), null, 'no deviceMemory is measured');
assert.deepStrictEqual(d({ setting: 'auto', memory: 2, cached: { low: true, t: now - 2 * day } }), { low: true, why: 'measured' });
assert.strictEqual(d({ setting: 'auto', memory: 2, cached: { low: true, t: now - 8 * day } }), null, 'a week old measurement is redone');
// the measurement itself: slower than about 45 frames a second is low end
assert.deepStrictEqual(d({ setting: 'auto', memory: 2, medianMs: 45.5 }), { low: true, why: 'measured' });
assert.deepStrictEqual(d({ setting: 'auto', memory: 2, medianMs: 16.7 }), { low: false, why: 'measured' });
assert.deepStrictEqual(d({ setting: 'auto', memory: 2, medianMs: 22 }), { low: false, why: 'measured' });

// a low end TV gets Lighter home itself (no second switch), only when nobody has chosen
assert(/function lowEnd\(\) \{\n    var chosen = typeof ST\.lighter === "boolean" \|\| typeof HOME\.lighter === "boolean";\n    if \(chosen \|\| OLD_ENGINE\) return;/.test(js), 'a choice in Home settings or home.lighter, or an old WebView, is never overridden');
assert(/LIGHTER = LOW_END;\n      document\.documentElement\.classList\.toggle\("lighter", LIGHTER\);/.test(js), 'a low end TV turns on Lighter home');
assert(/if \(LIGHTER === LOW_END \|\| typeof ST\.lighter === "boolean" \|\| typeof HOME\.lighter === "boolean"\) return;/.test(js), 'a choice made meanwhile, here or in config.json, is never overridden');
assert(/LOW_END_WAIT = 20000, LOW_END_NAV_FROM = 30000/.test(js), 'the still check 20 s after start, presses counted from 30 s');
assert(/if \(performance\.now\(\) < LOW_END_NAV_FROM \|\| document\.hidden \|\| !o\.idleMs\) return;/.test(js), 'presses at start up, or with an app in front, do not count');
assert(/function whenShown\(ms, fn\) \{\n    setTimeout\(function go\(\) \{ if \(document\.hidden\) setTimeout\(go, 5000\); else fn\(\); \}, ms\);/.test(js), 'nothing is measured while the home is hidden');
assert(!/frost-lite|low_end/.test(js) && !/frost-lite/.test(css), 'no separate low end switch or style');
// the settled focus holds still
assert(/html\.settled \.tile\.focus \.face, html\.settled \.tile\.focus \.face::after \{ animation-play-state: paused; \}/.test(css), 'settled pauses the sway and the glint');
// the page settles after the focus last moved, and any key or pointer move starts it again
assert(/var SETTLE_MS = 6000/.test(js), 'it settles after 6 s');
assert(/var PTR = window\.PointerEvent \? "pointer" : "mouse";/.test(js), 'mouse events where there are no pointer events (Chrome 53, webOS 4)');
assert(/\["keydown", PTR \+ "move", PTR \+ "down", "wheel"\]\.forEach\(function \(ev\) \{ window\.addEventListener\(ev, unsettle, true\); \}\)/.test(js), 'keys and the pointer unsettle it');
console.log('Low end tests passed.');
