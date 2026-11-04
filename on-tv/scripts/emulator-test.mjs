// End-to-end test of on-TV mode against an Android TV EMULATOR. Never point it at a real TV.
//
//   adb -s emulator-5554 install -r android/app/build/outputs/apk/release/app-release.apk
//   adb -s emulator-5554 forward tcp:15400 tcp:5400
//   PLAYWRIGHT_DIR=/path/to/node_modules node scripts/emulator-test.mjs
//
// The script plays both people: the phone (HTTP calls and a 390x664 browser page through the
// forwarded port) and the person on the couch (reads the code off the TV screen with uiautomator,
// accepts "Allow debugging?" with a tap). Results go to test-output/results.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERIAL = process.env.SERIAL || 'emulator-5554';
if (!SERIAL.startsWith('emulator-')) { console.error('Refusing: this test only runs against an emulator.'); process.exit(2); }
const ADB = process.env.ADB || 'adb';
const BASE = process.env.BASE || 'http://localhost:15400';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-output');
mkdirSync(OUT, { recursive: true });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', timeout: 30000 });
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail).slice(0, 220) : ''}`); }
async function check(name, fn) { try { const d = await fn(); record(name, true, d); return d; } catch (e) { record(name, false, String(e.message || e)); return null; } }
function assert(c, msg) { if (!c) throw new Error(msg); }

async function call(method, p, body, token) {
  const h = {};
  if (body) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, json: ct.includes('json') ? await r.json() : null, bytes: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
}

function uiDump() { return adb('exec-out', 'uiautomator', 'dump', '/dev/tty'); }
function pinOnScreen() { const m = uiDump().match(/Phone code\s+(\d{3}) (\d{3})/); return m ? m[1] + m[2] : null; }
function front() { const o = adb('shell', 'dumpsys activity activities | grep -m1 topResumedActivity'); return (o.match(/u0 ([^/\s]+)\//) || [])[1]; }
function tapText(re) {
  const xml = uiDump();
  for (const m of xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    if (re.test(m[1])) { const x = (+m[2] + +m[4]) >> 1, y = (+m[3] + +m[5]) >> 1; adb('shell', 'input', 'tap', String(x), String(y)); return m[1]; }
  }
  return null;
}

async function main() {
  // ---------- 1. server and auth ----------
  adb('shell', 'am', 'start', '-n', 'dev.couchtv.ontv/.SetupActivity');
  await sleep(2500);
  await check('server answers /api/health without a token, says auth required', async () => {
    const r = await call('GET', '/api/health'); assert(r.status === 200 && r.json.mode === 'on-tv' && r.json.auth === 'required', JSON.stringify(r.json)); return r.json;
  });
  await check('every control endpoint is 401 without a token', async () => {
    const eps = [['GET', '/api/now'], ['POST', '/api/key', { key: 'home' }], ['GET', '/api/apps'], ['POST', '/api/launch', { app: 'settings' }],
      ['GET', '/api/events'], ['GET', '/api/adb'], ['GET', '/api/settings'], ['POST', '/api/power', { state: 'off' }], ['GET', '/api/screenshot']];
    const got = {};
    for (const [m, p, b] of eps) got[`${m} ${p}`] = (await call(m, p, b)).status;
    assert(Object.values(got).every((s) => s === 401), JSON.stringify(got)); return got;
  });
  await check('a made-up token is 401', async () => { const r = await call('GET', '/api/now', null, 'f'.repeat(64)); assert(r.status === 401); return r.status; });
  await check('WebSocket upgrade without a token is 401', async () => {
    const u = new URL(BASE + '/api/ws');
    const status = await new Promise((res, rej) => {
      const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' } });
      r.on('response', (x) => { x.resume(); res(x.statusCode); }); r.on('upgrade', () => res(101)); r.on('error', rej); r.end();
    });
    assert(status === 401, 'status ' + status); return status;
  });
  await check('pairing: /api/pair/start puts a code on the TV screen', async () => {
    const r = await call('POST', '/api/pair/start'); assert(r.status === 200, JSON.stringify(r.json)); await sleep(1500);
    const pin = pinOnScreen(); assert(pin && pin.length === 6, 'no code on screen'); return { shown: 'yes (6 digits)' };
  });
  await check('pairing: wrong code is refused', async () => {
    const pin = pinOnScreen(); const wrong = pin === '000000' ? '111111' : '000000';
    const r = await call('POST', '/api/pair', { pin: wrong }); assert(r.status === 401 && !r.json.token, JSON.stringify(r.json)); return r.json.error;
  });
  await check('pairing: 5 wrong codes throw the code away', async () => {
    await call('POST', '/api/pair/start'); await sleep(1200);
    const pin = pinOnScreen(); const wrong = pin === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await call('POST', '/api/pair', { pin: wrong });
    const r = await call('POST', '/api/pair', { pin }); assert(r.status === 401, 'right code still worked after 5 wrong'); return r.json.error;
  });
  let token = null;
  await check('pairing: right code from the TV screen gives a token', async () => {
    await call('POST', '/api/pair/start'); await sleep(1200);
    const r = await call('POST', '/api/pair', { pin: pinOnScreen(), name: 'emulator-test' });
    assert(r.status === 200 && r.json.token && r.json.token.length === 64, 'status ' + r.status + ' ' + r.json.error); token = r.json.token; return 'token received (64 hex chars, not logged)';
  });
  if (!token) throw new Error('cannot go on without a token');
  await check('with the token, /api/now answers', async () => { const r = await call('GET', '/api/now', null, token); assert(r.status === 200 && r.json.mode === 'on-tv'); return { power: r.json.power, app: r.json.app, adb: r.json.adb }; });
  await check('the code is single use', async () => { const r = await call('POST', '/api/pair', { pin: pinOnScreen() || '123456' }); assert(r.status === 401); return r.json.error; });

  // ---------- 2. no ADB yet: what works ----------
  const st0 = await call('GET', '/api/adb', null, token);
  if (!st0.json.connected) {
    await check('without ADB: a key press answers 503 "needs ADB" and pops nothing on the TV', async () => {
      const r = await call('POST', '/api/key', { key: 'down' }, token); await sleep(1500);
      const popped = /Allow (USB |wireless )?debugging/i.test(uiDump());
      assert(r.status === 503 && !popped, JSON.stringify(r.json) + ' popped=' + popped); return r.json.error;
    });
    await check('without ADB: open an app with a plain intent', async () => {
      adb('shell', 'am', 'start', '-n', 'dev.couchtv.ontv/.SetupActivity'); await sleep(1500);
      const r = await call('POST', '/api/launch', { app: 'settings' }, token); await sleep(2500);
      const f = front(); assert(r.status === 200 && f === 'com.android.tv.settings', `status ${r.status} front ${f} ${JSON.stringify(r.json)}`); return { front: f };
    });
    await check('without ADB: volume up through the audio service', async () => {
      const a = (await call('GET', '/api/now', null, token)).json.volume;
      const r = await call('POST', '/api/volume', { action: 'up' }, token);
      assert(r.status === 200, JSON.stringify(r.json)); return { before: a, after: r.json.volume };
    });
  }

  // ---------- 3. loopback ADB on 127.0.0.1:5555 ----------
  adb('shell', 'am', 'start', '-n', 'dev.couchtv.ontv/.SetupActivity'); await sleep(1500);
  await check('loopback ADB: "Allow debugging?" appears on the TV and is accepted, app connects', async () => {
    await call('POST', '/api/adb/connect', {}, token);
    let tapped = null;
    for (let i = 0; i < 20 && !tapped; i++) {
      await sleep(1000);
      const xml = uiDump();
      if (/Allow (USB |wireless )?debugging/i.test(xml)) {
        writeFileSync(path.join(OUT, 'allow-dialog.xml'), xml);
        adb('shell', 'screencap', '-p', '/sdcard/ctv-allow.png'); adb('pull', '/sdcard/ctv-allow.png', path.join(OUT, 'allow-dialog.png'));
        // As a person with the TV remote would: down to "Always allow", OK to tick it, then over to "Allow", OK.
        const focused = () => (((uiDump().match(/<node [^>]*focused="true"[^>]*>/) || [''])[0]).match(/text="([^"]*)"/) || [])[1];
        const key = (k) => adb('shell', 'input', 'keyevent', 'KEYCODE_' + k);
        for (let n = 0; n < 4 && !/Always allow/.test(focused() || ''); n++) { key('DPAD_UP'); await sleep(400); }
        key('DPAD_CENTER'); await sleep(500);
        const ticked = /Always allow[^>]*checked="true"/.test(uiDump());
        key('DPAD_DOWN'); await sleep(400);
        for (let n = 0; n < 3 && focused() !== 'Allow'; n++) { key('DPAD_LEFT'); await sleep(400); }
        assert(focused() === 'Allow', 'could not move focus to Allow (on ' + focused() + ')');
        key('DPAD_CENTER'); tapped = 'Allow pressed, Always allow ticked: ' + ticked;
      }
    }
    let s;
    for (let i = 0; i < 20; i++) { s = (await call('GET', '/api/adb', null, token)).json; if (s.connected) break; await sleep(1000); }
    assert(s.connected && s.route === 'tcp', JSON.stringify(s)); return { dialog: tapped ? 'shown and accepted' : 'not shown (key already trusted)', route: s.route };
  });
  await check('after connecting, the app gave itself "draw over apps" (for intents from the background)', async () => {
    await sleep(2000); const o = adb('shell', 'appops', 'get', 'dev.couchtv.ontv', 'SYSTEM_ALERT_WINDOW'); assert(/allow/.test(o), o); return o.trim();
  });
  await check('after connecting, WRITE_SECURE_SETTINGS was granted (for switching wireless debugging back on)', async () => {
    const o = adb('shell', 'dumpsys package dev.couchtv.ontv | grep WRITE_SECURE_SETTINGS'); assert(/granted=true/.test(o), o); return o.trim();
  });

  // ---------- 4. control with ADB ----------
  await check('launch app: Settings opens (ADB route)', async () => {
    const r = await call('POST', '/api/launch', { app: 'settings' }, token); await sleep(1000);
    assert(r.status === 200 && front() === 'com.android.tv.settings', JSON.stringify(r.json)); return r.json.app;
  });
  // The Google TV emulator has no Bluetooth screen another app may open, so there the button falls
  // back to the main Settings (com.android.tv.settings).
  for (const [which, act] of [['bluetooth', /BLUETOOTH|[Bb]luetooth|com\.android\.tv\.settings\//], ['network', /WIFI|[Ww]ifi|[Nn]etwork/]]) {
    await check(`quick button: ${which} opens the TV's ${which} settings`, async () => {
      const r = await call('POST', '/api/launch', { app: which }, token); await sleep(1500);
      const top = adb('shell', 'dumpsys activity activities | grep -m1 topResumedActivity');
      assert(r.status === 200 && act.test(top), JSON.stringify(r.json) + ' ' + top.trim()); return top.trim().split(' ').pop();
    });
  }
  await check('key press in another app: BACK closes the top Settings screen', async () => {
    // Earlier steps stack several Settings screens, so the check is that the screen on top changed
    // (a different activity record), not that Settings closed.
    const rec = () => (adb('shell', 'dumpsys activity activities | grep -m1 topResumedActivity').match(/ActivityRecord\{(\S+)/) || [])[1];
    const before = rec();
    const t0 = Date.now(); const r = await call('POST', '/api/key', { key: 'back' }, token); const ms = Date.now() - t0;
    let after; for (let i = 0; i < 10; i++) { await sleep(300); after = rec(); if (after !== before) break; }
    assert(r.status === 200 && after !== before, `top screen unchanged (${before})`); return { before, after, front_after: front(), api_ms: ms };
  });
  await check('key press: HOME goes to the home screen', async () => {
    await call('POST', '/api/launch', { app: 'settings' }, token); await sleep(1500);
    await call('POST', '/api/key', { key: 'home' }, token); await sleep(1500);
    const n = (await call('GET', '/api/now', null, token)).json; const f = front();
    assert(/launcher/.test(f), f); return { front: f, now_app: n.app };
  });
  await check('D-pad moves focus in another app (Settings), seen in the UI tree', async () => {
    await call('POST', '/api/launch', { app: 'settings' }, token); await sleep(2000);
    const focus = () => (uiDump().match(/<node [^>]*focused="true"[^>]*>/g) || []).map((n) => (n.match(/bounds="([^"]+)"/) || [])[1]).join(',');
    const a = focus(); await call('POST', '/api/key', { key: 'down' }, token); await sleep(800); const b = focus();
    assert(a !== b, `focus did not move (${a})`); return { before: a, after: b };
  });
  await check('volume: up and down through ADB key events', async () => {
    const r1 = await call('POST', '/api/volume', { action: 'down', steps: 2 }, token);
    const r2 = await call('POST', '/api/volume', { action: 'up' }, token);
    assert(r1.status === 200 && r2.status === 200); return { after_down: r1.json.volume, after_up: r2.json.volume };
  });
  await check('volume: set a level (TV speaker)', async () => {
    const r = await call('POST', '/api/volume', { level: 20 }, token); assert(r.status === 200 || r.status === 409, JSON.stringify(r.json)); return r.json.volume || r.json.error;
  });
  await check('app list: installed apps flagged', async () => {
    const r = await call('GET', '/api/apps', null, token); const y = r.json.apps.filter((a) => a.installed).map((a) => a.id);
    assert(y.includes('settings') && y.includes('youtube'), y.join(',')); return y;
  });
  await check('type text into a search box (YouTube search)', async () => {
    await call('POST', '/api/launch', { app: 'https://www.youtube.com/results?search_query=x' }, token); await sleep(5000);
    const r = await call('POST', '/api/text', { text: 'couch' }, token); await sleep(1500);
    assert(r.status === 200, JSON.stringify(r.json)); return { status: r.status, note: 'command ran; whether text landed depends on a focused box' };
  });
  await check('deep link: a YouTube watch link opens the YouTube app', async () => {
    const r = await call('POST', '/api/launch', { app: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }, token);
    let f; for (let i = 0; i < 12; i++) { await sleep(1000); f = front(); if (f === 'com.google.android.youtube.tv') break; }
    assert(f === 'com.google.android.youtube.tv', `front ${f}`); return { front: f };
  });
  await check('what is playing: read from dumpsys media_session (YouTube)', async () => {
    let p = null;
    for (let i = 0; i < 12 && !p; i++) { await sleep(2500); p = (await call('GET', '/api/now', null, token)).json.playing; }
    assert(p, 'no playing info (YouTube may need sign-in or ads on the emulator)'); return p;
  });
  await check('find a show: JustWatch lookup from the TV', async () => {
    const r = await call('GET', '/api/find?title=Bluey', null, token); assert(r.status === 200 && r.json.result.title, JSON.stringify(r.json)); return { title: r.json.result.title, providers: r.json.result.providers.map((p) => p.service) };
  });
  await check('play a show: picks an installed app or says plainly where it streams', async () => {
    const r = await call('POST', '/api/play', { title: 'Bluey' }, token);
    assert(r.status === 200 || (r.status === 404 && /not on any app/.test(r.json.error)), JSON.stringify(r.json)); return r.json.note || r.json.error;
  });
  await check('screenshot over loopback ADB', async () => {
    const r = await call('GET', '/api/screenshot', null, token); assert(r.status === 200 && r.bytes && r.bytes[1] === 0x50, 'not a png');
    writeFileSync(path.join(OUT, 'api-screenshot.png'), r.bytes); return { bytes: r.bytes.length };
  });
  await check('ask is off by default (501, no API call)', async () => {
    const r = await call('POST', '/api/ask', { text: 'put on bluey' }, token); assert(r.status === 501, JSON.stringify(r.json)); return r.json.error;
  });
  await check('server-sent events: first "now" event arrives', async () => {
    const ctl = new AbortController(); const r = await fetch(BASE + '/api/events?token=' + token, { signal: ctl.signal });
    const rd = r.body.getReader(); const { value } = await rd.read(); ctl.abort();
    const t = Buffer.from(value).toString(); assert(t.startsWith('event: now'), t.slice(0, 80)); return t.slice(0, 60);
  });
  await check('WebSocket: gets "now", sends a key, gets ok', async () => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/api/ws?token=' + token);
    const msgs = []; await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); setTimeout(() => rej(new Error('ws timeout')), 5000); });
    ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
    await sleep(800); ws.send(JSON.stringify({ key: 'home' })); await sleep(1500); ws.close();
    assert(msgs.some((m) => m.event === 'now') && msgs.some((m) => m.ok === true && m.key === 'home'), JSON.stringify(msgs).slice(0, 200)); return { messages: msgs.length };
  });

  // ---------- 5. the phone remote page at a phone size ----------
  const req = createRequire(path.join(process.env.PLAYWRIGHT_DIR || '.', 'x.js'));
  const { chromium } = req('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await check('phone page: a new phone sees the pairing screen', async () => {
      await page.goto(BASE + '/'); await page.waitForSelector('#ctv-pair', { timeout: 8000 });
      await page.screenshot({ path: path.join(OUT, 'phone-1-pair.png') }); return 'pairing screen shown';
    });
    await check('phone page: "Show a code on the TV", type it, paired, remote loads', async () => {
      await page.click('#ctv-ask'); await sleep(2000);
      const pin = pinOnScreen(); assert(pin, 'no code on TV');
      await page.fill('#ctv-pin', pin); await page.click('#ctv-go');
      await page.waitForLoadState('load'); await sleep(2500);
      await page.screenshot({ path: path.join(OUT, 'phone-2-who.png') });
      // The remote's own first-run question ("Who's this phone for?"), from the shared remote build.
      const who = page.getByRole('button', { name: 'Person 1' });
      if (await who.count()) await who.first().click();
      await page.waitForSelector('[aria-label="Home"]', { timeout: 10000 }); await sleep(2500);
      await page.screenshot({ path: path.join(OUT, 'phone-3-remote.png') }); return 'remote loaded after pairing';
    });
    await check('phone page: tapping Home on the phone drives the TV', async () => {
      await call('POST', '/api/launch', { app: 'settings' }, token); await sleep(2000);
      await page.click('[aria-label="Home"]'); let f; for (let i = 0; i < 10; i++) { await sleep(400); f = front(); if (/launcher/.test(f)) break; }
      assert(/launcher/.test(f), f); return { front: f };
    });
    await check('phone page: tapping Volume up drives the TV', async () => {
      const before = (await call('GET', '/api/now', null, token)).json.volume.level;
      await page.click('[aria-label="Volume up"]'); await sleep(1500);
      const after = (await call('GET', '/api/now', null, token)).json.volume.level;
      assert(after >= before, `${before} -> ${after}`); return { before, after };
    });
    await check('setup page loads for a paired phone and shows ADB connected', async () => {
      await page.goto(BASE + '/setup'); await page.waitForFunction(() => /Connected/.test(document.getElementById('adb-status').textContent), null, { timeout: 8000 });
      await page.screenshot({ path: path.join(OUT, 'phone-4-setup.png'), fullPage: true }); return 'ok';
    });
  } finally { await browser.close(); }

  // ---------- 6. power ----------
  await check('power off over loopback ADB', async () => {
    const r = await call('POST', '/api/power', { state: 'off' }, token); await sleep(2000);
    const on = adb('shell', 'dumpsys power | grep -m1 mWakefulness='); assert(r.status === 200 && /Asleep|Dozing/.test(on), on.trim() + ' ' + JSON.stringify(r.json)); return on.trim();
  });
  await check('power on while still in light standby (app still running)', async () => {
    const r = await call('POST', '/api/power', { state: 'on' }, token); await sleep(1000);
    const on = adb('shell', 'dumpsys power | grep -m1 mWakefulness='); return { status: r.status, body: r.json, wakefulness: on.trim() };
  });
}

main().catch((e) => record('test run', false, String(e.stack || e))).finally(() => {
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), serial: SERIAL, results }, null, 2));
  const f = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - f} passed, ${f} failed. Details: ${path.join(OUT, 'results.json')}`);
});
