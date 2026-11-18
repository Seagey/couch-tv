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
assert.deepStrictEqual(d({ setting: 'auto', memory: 4 }), { low: false, why: 'memory' });
assert.deepStrictEqual(d({ setting: 'auto', memory: 8 }), { low: false, why: 'memory' });
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
assert(!/frost-lite|low_end/.test(js) && !/frost-lite/.test(css), 'no separate low end switch or style');
// the settled focus holds still
assert(/html\.settled \.tile\.focus \.face, html\.settled \.tile\.focus \.face::after \{ animation-play-state: paused; \}/.test(css), 'settled pauses the sway and the glint');
// the page settles after the focus last moved, and any key or pointer move starts it again
assert(/var SETTLE_MS = 6000/.test(js), 'it settles after 6 s');
assert(/var PTR = window\.PointerEvent \? "pointer" : "mouse";/.test(js), 'mouse events where there are no pointer events (Chrome 53, webOS 4)');
assert(/\["keydown", PTR \+ "move", PTR \+ "down", "wheel"\]\.forEach\(function \(ev\) \{ window\.addEventListener\(ev, unsettle, true\); \}\)/.test(js), 'keys and the pointer unsettle it');
console.log('Low end tests passed.');
