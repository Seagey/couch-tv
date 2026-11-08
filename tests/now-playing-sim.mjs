// Now playing (#31) on the on-TV app (option C), on one EMULATOR. Never a real TV.
//
//   tests/fake-player/build.sh com.spotify.tv.android   (and the Netflix and Prime ones setup() installs)
//   env -u COUCHTV_KEYSTORE sh scripts/build-apk.sh
//   (boot an Android TV emulator, for example couchtv_gtv34 on port 5562)
//   SERIAL=emulator-5562 node tests/now-playing-sim.mjs
//
// The fake player, under Spotify's package name, plays a two song playlist and is sent behind the
// home. The script then checks /api/music (title, artist, album, app, playing), that the cover is
// found, that play or pause, next and previous reach the song through /api/key, that a paused song
// stays on the card, and that it goes once the app stops; and screenshots the home with the card.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERIAL = process.env.SERIAL || 'emulator-5562';
if (!/^emulator-\d+$/.test(SERIAL)) { console.error('Refusing: give an emulator serial.'); process.exit(2); }
const ADB = process.env.ADB || 'adb';
const OUT = path.join(ROOT, 'on-tv', 'test-output', 'now-playing');   // git ignores on-tv/test-output
mkdirSync(OUT, { recursive: true });
const SPOTIFY = 'com.spotify.tv.android', ONTV = 'dev.couchtv.ontv', PORT = 15402;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + JSON.stringify(detail).slice(0, 240) : ''}`); }
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', timeout: 60000 });
const sh = (c) => adb('shell', c);
let token = null;
async function call(method, p, body) {
  const h = {};
  if (body) h['content-type'] = 'application/json';
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`http://localhost:${PORT}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const ui = () => adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
const music = async () => { await sleep(3500); return ((await call('GET', '/api/music')).json || {}).music; };
// after a key: wait up to 12 s for the song to show it (input keyevent takes a moment on an emulator)
const musicUntil = async (ok) => { let m; for (let i = 0; i < 4; i++) { m = await music(); if (ok(m)) break; } return m; };
const keyLog = () => sh('logcat -d -s fakeplayer:I').split('\n').filter((l) => /fakeplayer key/.test(l)).map((l) => l.replace(/.*fakeplayer key /, '').trim());

async function setup() {
  adb('install', '-r', path.join(ROOT, 'dist/couch-tv-ontv.apk'));
  adb('install', '-r', path.join(ROOT, `tests/fake-player/build/fake-${SPOTIFY}.apk`));
  sh(`pm clear ${ONTV}`);
  if (!/5555/.test(sh('getprop service.adb.tcp.port'))) { adb('tcpip', '5555'); await sleep(4000); adb('wait-for-device'); }
  adb('forward', `tcp:${PORT}`, 'tcp:5400');
  sh(`am start -n ${ONTV}/.SetupActivity`);
  await sleep(4000);
  await call('POST', '/api/pair/start'); await sleep(1500);
  const m = ui().match(/Phone code\s+(\d{3}) (\d{3})/);
  if (!m) throw new Error('no pairing code on screen');
  token = (await call('POST', '/api/pair', { pin: m[1] + m[2], name: 'now-playing-sim' })).json?.token;
  if (!token) throw new Error('pairing failed');
  await call('POST', '/api/adb/connect', {});
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    if ((await call('GET', '/api/adb')).json?.connected) break;
    if (/Allow (USB |wireless )?debugging/i.test(ui())) {
      const focused = () => (((ui().match(/<node [^>]*focused="true"[^>]*>/) || [''])[0]).match(/text="([^"]*)"/) || [])[1];
      for (let n = 0; n < 4 && !/Always allow/.test(focused() || ''); n++) { sh('input keyevent KEYCODE_DPAD_UP'); await sleep(400); }
      sh('input keyevent KEYCODE_DPAD_CENTER'); await sleep(500); sh('input keyevent KEYCODE_DPAD_DOWN'); await sleep(400);
      for (let n = 0; n < 3 && focused() !== 'Allow'; n++) { sh('input keyevent KEYCODE_DPAD_LEFT'); await sleep(400); }
      sh('input keyevent KEYCODE_DPAD_CENTER');
    }
  }
  if (!(await call('GET', '/api/adb')).json?.connected) throw new Error('ADB did not connect');
}

async function main() {
  await setup();
  record('setup: paired, ADB connected', true);
  record('nothing playing: no card', (await music()) === null);
  sh('logcat -c');
  sh(`am start -n ${SPOTIFY}/dev.couchtv.fakeplayer.Player --es songs 'Golden Hour~JVKE|Espresso~Sabrina Carpenter' --es album 'this is what falling in love feels like'`);
  await sleep(3000);
  // the home alias is off until "Use as home screen" on the setup screen is pressed, as a person would
  sh(`am start -n ${ONTV}/.SetupActivity`); await sleep(3000);
  for (const t of ui().matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g))
    if (/^Use as home screen$/.test(t[1])) { sh(`input tap ${(+t[2] + +t[4]) >> 1} ${(+t[3] + +t[5]) >> 1}`); await sleep(1500); break; }
  sh(`am start -n ${ONTV}/.HomeAlias`);   // the song carries on behind the home
  await sleep(8000);
  let m = await music();
  record('a song behind the home shows: title, artist, album, app, playing',
    !!m && m.title === 'Golden Hour' && m.artist === 'JVKE' && /falling in love/.test(m.album || '') && m.app?.package === SPOTIFY && m.state === 'playing', m);
  for (let i = 0; i < 4 && !(m && m.art); i++) m = await music();
  record('the cover is found (Apple music search)', !!(m && m.art && /^https:\/\//.test(m.art)), m && m.art);
  await call('POST', '/api/key', { key: 'play_pause' });
  m = await musicUntil((x) => x?.state === 'paused');
  record('play or pause reaches the song: paused, and it stays on the card', keyLog().includes('pause') && m?.state === 'paused' && m?.title === 'Golden Hour', { keys: keyLog(), m });
  await call('POST', '/api/key', { key: 'play_pause' });
  m = await musicUntil((x) => x?.state === 'playing');
  record('play again', m?.state === 'playing', m);
  await call('POST', '/api/key', { key: 'next' });
  m = await musicUntil((x) => x?.title === 'Espresso');
  record('next: the second song', keyLog().includes('next') && m?.title === 'Espresso' && m?.artist === 'Sabrina Carpenter', { keys: keyLog(), m });
  await call('POST', '/api/key', { key: 'previous' });
  m = await musicUntil((x) => x?.title === 'Golden Hour');
  record('previous: back to the first', keyLog().includes('previous') && m?.title === 'Golden Hour', m);
  await sleep(6000);   // the home polls every 5 s
  sh('screencap -p /sdcard/np.png'); adb('pull', '/sdcard/np.png', path.join(OUT, 'home-now-playing.png'));
  record('screenshot of the home with the card', true, path.relative(ROOT, path.join(OUT, 'home-now-playing.png')));
  sh(`am force-stop ${SPOTIFY}`);
  m = await music();
  record('the app stops: the card goes', m === null, m);
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
