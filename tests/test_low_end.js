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
const decide = new Function(js.match(/var LOW_END_STALL = \d+;/)[0] + m[0] + '; return lowEndDecision;')();
const now = Date.parse('2026-11-17T08:00:00Z'), day = 86400000;
const base = { now: now, days: 7 };
const d = (o) => decide(Object.assign({}, base, o));

// a kept answer from the future (a clock set back) is not trusted: measured again
assert.strictEqual(d({ setting: 'auto', memory: 4, cached: { low: true, t: now + day } }), null, 'a kept answer dated tomorrow is redone');
assert.strictEqual(d({ setting: 'auto', memory: 4, cached: { low: true, t: now + 60 * day, moving: true }, movingDays: 30 }), null, 'a moving answer from the future too');
// a strike: this week counts, older or from the future does not
const sk = js.match(/function strikeOk\(k, now, days\) \{[^\n]*\}/);
assert(sk, 'strikeOk is in app.js');
const strikeOk = new Function(sk[0] + '; return strikeOk;')();
assert.strictEqual(strikeOk({ strike: 1, t: now - 2 * day }, now, 7), true, 'a strike two days old counts');
assert.strictEqual(strikeOk({ strike: 1, t: now - 8 * day }, now, 7), false, 'a strike eight days old does not');
assert.strictEqual(strikeOk({ strike: 1, t: now + day }, now, 7), false, 'a strike dated tomorrow does not');
assert.strictEqual(strikeOk(null, now, 7), false, 'no strike');
assert.strictEqual(strikeOk({ strike: 1 }, now, 7), false, 'a strike with no time does not');
// the rest frame time: the 20th percentile of 20 frames, read again 2 s later after an arrow press
const idf = js.match(/  function idleFrames\(done\) \{[\s\S]*?\n  \}\n/);
assert(idf, 'idleFrames is in app.js');
{
  const runIdle = (frames, keyAgo) => {
    let i = 0, now = 5000, waits = [], got;
    const raf = (cb) => { const t = frames[Math.min(i, frames.length - 1)]; i++; cb(t); };
    const perf = { now: () => now };
    const st = (fn, ms) => { waits.push(ms); now += ms; fn(); };
    const f = new Function('requestAnimationFrame', 'performance', 'setTimeout', 'LOW_END_KEY_AT', idf[0] + '; return idleFrames;')(raf, perf, st, now - keyAgo);
    f((ms) => { got = ms; });
    return { got, waits };
  };
  // 21 timestamps: 16 frames of 16.7 ms and 4 slow ones of 50 ms; the median would still be 16.7, the 20th percentile is
  const ts = [0]; for (let k = 0; k < 20; k++) ts.push(ts[ts.length - 1] + (k % 5 === 4 ? 50 : 16.7));
  const r1 = runIdle(ts, 10000);
  assert(Math.abs(r1.got - 16.7) < 0.01 && r1.waits.length === 0, 'no recent press: read at once, the 20th percentile (' + r1.got + ')');
  // a 30 Hz screen with a few 66 ms frames: 33.3
  const ts2 = [0]; for (let k = 0; k < 20; k++) ts2.push(ts2[ts2.length - 1] + (k % 4 === 3 ? 66.6 : 33.3));
  assert(Math.abs(runIdle(ts2, 10000).got - 33.3) < 0.01, '30 Hz screen: 33.3');
  const r2 = runIdle(ts, 300);
  assert.deepStrictEqual(r2.waits, [2000], 'an arrow 0.3 s ago: read again 2 s later');
  assert(Math.abs(r2.got - 16.7) < 0.01, 'and then read');
}
// a screen that was not being drawn (#lowend-fix, a 2021 Samsung Frame, Tizen 6, 21 Nov 2026): Lighter home had been
// on for days from a reading taken in Art Mode, kept as {"low":true,"ms":2849.7}; with the screen on it measured
// a 19.2 ms median (idle 13.1 ms). A reading over 250 ms, kept or new, decides nothing and is measured again.
const decideS = new Function(js.match(/var LOW_END_STALL = \d+;/)[0] + m[0] + '; return lowEndDecision;')();
const ds = (o) => decideS(Object.assign({}, base, o));
assert.strictEqual(ds({ setting: 'auto', memory: 2, cached: { low: true, t: now - 2 * day, ms: 2849.7 } }), null, "the Frame's kept Art Mode reading is measured again");
assert.deepStrictEqual(ds({ setting: 'auto', memory: 2, cached: { low: true, t: now - 2 * day, ms: 2849.7 }, medianMs: 19.2, idleMs: 13.1 }), { low: false, why: 'measured' }, 'and its screen on reading leaves Lighter home off');
assert.strictEqual(ds({ setting: 'auto', memory: 2, medianMs: 2849.7, idleMs: 13.1 }), null, 'a new stalled reading decides nothing');
assert.strictEqual(ds({ setting: 'auto', memory: 2, medianMs: 251 }), null, 'over 250 ms: stalled');
assert.deepStrictEqual(ds({ setting: 'auto', memory: 2, medianMs: 249 }), { low: true, why: 'measured' }, 'just under: a very slow TV');
assert.deepStrictEqual(ds({ setting: 'auto', memory: 2, cached: { low: true, t: now - day, ms: 45 } }), { low: true, why: 'measured' }, 'a real slow reading is still kept');
assert.deepStrictEqual(ds({ setting: 'auto', memory: 2, cached: { low: false, t: now - day, ms: 19 }, navMs: 900, navStrike: true }), { low: false, why: 'measured' }, 'moving frames from a stalled screen are no strike');
assert(/if \(!m\) \{ if \(\+\+tries < 5\) whenShown\(60000, measure\); else lowEnd\.pending = false; return; \}/.test(js), 'a stalled reading is not kept, and measured again a minute later, up to five times');
assert(/if \(o\.navMs > LOW_END_STALL\) return;/.test(js), 'a stalled moving reading leaves the strike as it was');
assert(/el\.classList\.remove\("on"\); toastTimer = setTimeout\(function \(\) \{ el\.innerHTML = ""; \}, 1000\);/.test(js), "the note's words leave the page once it has faded");
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
