// Keep watching simulation for the on-TV app (option C), on two EMULATORS. Never a real TV.
//
//   tests/fake-player/build.sh com.netflix.ninja && tests/fake-player/build.sh com.amazon.amazonvideo.livingroom
//   env -u COUCHTV_KEYSTORE sh scripts/build-apk.sh
//   (boot two Android TV emulators, for example couchtv_gtv34 on port 5562 and couchtv_api28 on 5560)
//   SERIALS=emulator-5562,emulator-5560 PLAYWRIGHT_DIR=/path/to/node_modules node tests/keep-watching-sim.mjs
//
// Each emulator gets the on-TV app and the fake player (tests/fake-player, under Netflix's and Prime's
// package names, signed with a throwaway key). The script pairs like a phone, accepts "Allow debugging?",
// then plays scripted shows in the fake player for different people on each TV, restarts the app, and
// checks Keep watching per TV and per person, the 10 card limit, trailers, "PrimeVideo" placeholders,
// rotating previews, Netflix with no metadata, every card opening its own title, the 30 day drop off
// (debug.couchtv.clock_offset_s), the Night row sliding (screenshots in on-tv/test-output/keep-watching/), and plays
// named from Android's Watch Next rows when the app gives no title (Netflix) or only its own name (Prime).
// A title counts after 20 s here (debug.couchtv.seen_after_s), not the real 60 s, so a run takes about 30 minutes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERIALS = (process.env.SERIALS || 'emulator-5562,emulator-5560').split(',');
if (SERIALS.length !== 2 || SERIALS.some((s) => !/^emulator-\d+$/.test(s))) { console.error('Refusing: give two emulator serials.'); process.exit(2); }
const ADB = process.env.ADB || 'adb';
const OUT = path.join(ROOT, 'on-tv', 'test-output', 'keep-watching');   // git ignores on-tv/test-output
mkdirSync(OUT, { recursive: true });
const NETFLIX = 'com.netflix.ninja', PRIME = 'com.amazon.amazonvideo.livingroom', ONTV = 'dev.couchtv.ontv';
const AFTER = 20, PLAY = 60;           // a title counts after AFTER s of play; a real watch lasts PLAY s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && detail ? '  ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

class Emu {
  constructor(serial, port, name) { this.serial = serial; this.port = port; this.name = name; this.token = null; }
  adb(...a) { return execFileSync(ADB, ['-s', this.serial, ...a], { encoding: 'utf8', timeout: 60000 }); }
  sh(cmd) { return this.adb('shell', cmd); }
  async call(method, p, body) {
    const h = {};
    if (body) h['content-type'] = 'application/json';
    if (this.token) h.authorization = `Bearer ${this.token}`;
    const r = await fetch(`http://localhost:${this.port}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  ui() { return this.adb('exec-out', 'uiautomator', 'dump', '/dev/tty'); }
  key(k) { this.sh(`input keyevent KEYCODE_${k}`); }
  shot(name) { this.sh('screencap -p /sdcard/kw.png'); this.adb('pull', '/sdcard/kw.png', path.join(OUT, name + '.png')); return path.join(OUT, name + '.png'); }
  play(pkg, x = {}) {
    let c = `am start -n ${pkg}/dev.couchtv.fakeplayer.Player`;
    if (x.title) c += ` --es title ${q(x.title)}`;
    if (x.subtitle) c += ` --es subtitle ${q(x.subtitle)}`;
    if (x.queue) c += ` --es queue ${q(x.queue)}`;
    if (x.nometa) c += ' --ez nometa true';
    if (x.rotate) c += ` --es rotate ${q(x.rotate.join('|'))} --ei rotate_s ${x.every || 10}`;
    this.sh(c);
  }
  // the app's Watch Next row, as Netflix and Prime write it (usually when you leave the show)
  watchNext(pkg, title, ep, s, e) {
    let c = `am start -n ${pkg}/dev.couchtv.fakeplayer.Player --ez wn_only true --es wn ${q(title)}`;
    if (ep) c += ` --es wn_ep ${q(ep)}`;
    if (s) c += ` --ei wn_s ${s} --ei wn_e ${e}`;
    this.sh(c);
  }
  stop(pkg) { this.sh(`am force-stop ${pkg}`); this.sh('input keyevent KEYCODE_HOME'); }
  async who(p) { return (await this.call('POST', '/api/who', { who: p })).json; }
  async list(p) { return ((await this.call('GET', `/api/continue?who=${p}`)).json || {}).items || []; }

  async setup() {
    for (const apk of [path.join(ROOT, 'dist/couch-tv-ontv.apk'), path.join(ROOT, `tests/fake-player/build/fake-${NETFLIX}.apk`), path.join(ROOT, `tests/fake-player/build/fake-${PRIME}.apk`)])
      this.adb('install', '-r', apk);
    this.sh(`pm clear ${ONTV}`);
    // no Watch Next rows left from an earlier run
    for (const p of [NETFLIX, PRIME]) { this.sh(`am start -n ${p}/dev.couchtv.fakeplayer.Player --ez wn_clear true --ez wn_only true`); await sleep(1500); this.sh(`am force-stop ${p}`); }
    // ADB on port 5555, as a TV with network debugging has it (an emulator can start with it closed)
    if (!/5555/.test(this.sh('getprop service.adb.tcp.port'))) { this.adb('tcpip', '5555'); await sleep(4000); this.adb('wait-for-device'); }
    this.adb('forward', `tcp:${this.port}`, 'tcp:5400');
    this.sh(`setprop debug.couchtv.seen_after_s ${AFTER}`);
    this.sh('setprop debug.couchtv.clock_offset_s 0');
    this.sh(`am start -n ${ONTV}/.SetupActivity`);
    await sleep(4000);
    // pair like a phone: read the code off the TV screen
    await this.call('POST', '/api/pair/start'); await sleep(1500);
    const m = this.ui().match(/Phone code\s+(\d{3}) (\d{3})/);
    if (!m) throw new Error(`${this.name}: no pairing code on screen`);
    const r = await this.call('POST', '/api/pair', { pin: m[1] + m[2], name: 'keep-watching-sim' });
    this.token = r.json && r.json.token;
    if (!this.token) throw new Error(`${this.name}: pairing failed ${JSON.stringify(r.json)}`);
    // ADB over loopback, accepting "Allow debugging?" as a person with the remote would
    await this.call('POST', '/api/adb/connect', {});
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      if ((await this.call('GET', '/api/adb')).json?.connected) break;
      if (/Allow (USB |wireless )?debugging/i.test(this.ui())) {
        const focused = () => (((this.ui().match(/<node [^>]*focused="true"[^>]*>/) || [''])[0]).match(/text="([^"]*)"/) || [])[1];
        for (let n = 0; n < 4 && !/Always allow/.test(focused() || ''); n++) { this.key('DPAD_UP'); await sleep(400); }
        this.key('DPAD_CENTER'); await sleep(500); this.key('DPAD_DOWN'); await sleep(400);
        for (let n = 0; n < 3 && focused() !== 'Allow'; n++) { this.key('DPAD_LEFT'); await sleep(400); }
        this.key('DPAD_CENTER');
      }
    }
    const adbOk = (await this.call('GET', '/api/adb')).json?.connected;
    if (!adbOk) throw new Error(`${this.name}: ADB did not connect`);
    await sleep(3000);
    const perm = /READ_TV_LISTINGS: granted=true|READ_EPG_DATA: granted=true/.test(this.sh(`dumpsys package ${ONTV}`));
    record(`${this.name}: the app granted itself the Watch Next read over ADB`, perm);
    await this.call('POST', '/api/people', { people: [{ id: 'person1', name: 'Person 1' }, { id: 'person2', name: 'Person 2' }] });
    this.sh('input keyevent KEYCODE_HOME');
  }
}

async function watch(tv, pkg, x, secs) { tv.play(pkg, x); await sleep(secs * 1000); tv.stop(pkg); await sleep(3000); }

async function main() {
  const [a, b] = [new Emu(SERIALS[0], 15411, 'TV 1'), new Emu(SERIALS[1], 15412, 'TV 2')];
  console.log('setting up', SERIALS.join(' and '));
  await a.setup(); await b.setup();
  console.log('both TVs paired, ADB connected');
  const t0 = Date.now();
  if (process.env.QUICK) {   // QUICK=1: a short check of the recording only (five shows on TV 1)
    await a.who('person1');
    for (const title of ['Narcos', 'Squid Game', 'Money Heist', 'You', 'Ozark']) await watch(a, NETFLIX, { title, subtitle: 'Episode 1' }, PLAY);
    const got = (await a.list('person1')).map((c) => c.title);
    console.log('quick:', JSON.stringify(got));
    process.exit(got.length === 5 ? 0 : 1);
  }

  // ---------- TV 1, person 1 ----------
  await a.who('person1');
  await watch(a, NETFLIX, { title: 'Stranger Things', subtitle: 'Chapter One: The Vanishing of Will Byers' }, PLAY);
  await watch(a, NETFLIX, { title: 'Wednesday', subtitle: 'Official Trailer' }, AFTER - 8);          // a trailer, under the limit
  // ---------- TV 1, person 2: what Prime and Netflix did on a Sony (issue #23) ----------
  await a.who('person2');
  await watch(a, PRIME, { title: 'PrimeVideo' }, PLAY + 10);                                        // only the app's name
  await watch(a, PRIME, { title: 'PrimeVideo', queue: 'Man of Steel' }, PLAY);                     // the film is in the queue title
  await watch(a, PRIME, { rotate: ['Citadel: Diana', 'Reacher', 'The Boys'], every: 12 }, 3 * 12 * 2); // autoplay previews
  await watch(a, NETFLIX, { nometa: true }, PLAY + 10);                                             // no metadata, no Watch Next: nothing
  // issue #23 round 2: no metadata (Netflix on a Xiaomi box) or only "PrimeVideo", but the app keeps a
  // Watch Next row, written as you leave the show: named from that row, for the person picked
  a.play(NETFLIX, { nometa: true }); await sleep((PLAY + 10) * 1000);
  a.watchNext(NETFLIX, 'The Night Agent', 'Pilot', 1, 1); await sleep(2000); a.stop(NETFLIX); await sleep(40000);
  a.play(PRIME, { title: 'PrimeVideo' }); await sleep((PLAY + 10) * 1000);
  a.watchNext(PRIME, 'Fallout', 'The End', 1, 1); await sleep(2000); a.stop(PRIME); await sleep(40000);
  // ---------- both TVs at once, different people ----------
  await b.who('person1');
  a.play(NETFLIX, { title: 'The Crown', subtitle: 'Wolferton Splash' }); b.play(NETFLIX, { title: 'Ozark', subtitle: 'Sugarwood' });
  await sleep(PLAY * 1000); a.stop(NETFLIX); b.stop(NETFLIX); await sleep(3000);
  // ---------- TV 1, person 1: eleven more shows ----------
  await a.who('person1');
  const more = ['The Witcher', 'Bridgerton', 'Squid Game', 'Narcos', 'Money Heist', 'Black Mirror', 'You', 'Mindhunter', 'Dark', 'Lupin', 'Sex Education'];
  for (const title of more) await watch(a, NETFLIX, { title, subtitle: 'Episode 1' }, PLAY);
  console.log(`plays done in ${Math.round((Date.now() - t0) / 60000)} min`);

  // ---------- restart the on-TV app on TV 1 ----------
  a.sh(`am force-stop ${ONTV}`); a.sh(`am start -n ${ONTV}/.SetupActivity`); await sleep(6000); a.sh('input keyevent KEYCODE_HOME');
  record('TV 1 still knows who is on the couch after the app restarts', (await a.call('GET', '/api/who')).json?.who === 'person1', (await a.call('GET', '/api/who')).json);

  // ---------- the rows ----------
  const t = (l) => l.map((c) => c.title);
  const a1 = await a.list('person1'), a2 = await a.list('person2'), b1 = await b.list('person1'), b2 = await b.list('person2');
  writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify({ tv1_person1: a1, tv1_person2: a2, tv2_person1: b1, tv2_person2: b2 }, null, 1));
  record('TV 1, person 2: The Crown, then Fallout and The Night Agent from Watch Next, then Man of Steel', JSON.stringify(t(a2)) === JSON.stringify(['The Crown', 'Fallout', 'The Night Agent', 'Man of Steel']), t(a2));
  const fallout = a2.find((c) => c.title === 'Fallout') || {};
  record('a Watch Next card keeps its season and episode', String(fallout.season) === '1' && String(fallout.episode) === '1', fallout);
  record('TV 2, person 1: only Ozark', JSON.stringify(t(b1)) === JSON.stringify(['Ozark']), t(b1));
  record('TV 2, person 2: nothing', b2.length === 0, t(b2));
  record('TV 1, person 1: 10 cards, newest first', a1.length === 10 && a1[0].title === 'Sex Education', t(a1));
  record('TV 1, person 1: the oldest (Stranger Things) dropped off the 10', !t(a1).includes('Stranger Things'), t(a1));
  record('TV 1, person 1: one card per show', new Set(t(a1)).size === a1.length, t(a1));
  const all = [...t(a1), ...t(a2), ...t(b1), ...t(b2)];
  for (const bad of ['Wednesday', 'PrimeVideo', 'Prime Video', 'Citadel: Diana', 'Reacher', 'The Boys', 'Netflix'])
    record(`'${bad}' is in nobody's row`, !all.includes(bad));
  const crown = a2[0] || {};
  record('cards carry the app', a2.every((c) => c.app && c.app.package), a2.map((c) => c.app));
  writeFileSync(path.join(OUT, 'crown.json'), JSON.stringify(crown, null, 1));

  // ---------- the Night row on TV 1 (the home starts on person 1) ----------
  // the home is opened through its alias, which is off until "Use as home screen" on the setup screen
  // is pressed (as a person would), and off again afterwards
  const tapText = async (re) => {
    for (const m of a.ui().matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g))
      if (re.test(m[1])) { a.sh(`input tap ${(+m[2] + +m[4]) >> 1} ${(+m[3] + +m[5]) >> 1}`); await sleep(1500); return m[1]; }
    return null;
  };
  a.sh(`am start -n ${ONTV}/.SetupActivity`); await sleep(3000);
  const turnedOn = !!(await tapText(/^Use as home screen$/));
  if (!turnedOn && !/Stop being the home screen/.test(a.ui())) throw new Error('no home screen button on the setup screen');
  a.sh(`am start -n ${ONTV}/.HomeAlias`); await sleep(12000);
  a.key('DPAD_DOWN'); await sleep(800);   // from the top of the home, down is the Keep watching row
  const s0 = a.shot('night-row-start');
  for (let i = 0; i < 4; i++) { a.key('DPAD_RIGHT'); await sleep(600); }
  const s4 = a.shot('night-row-card5');
  for (let i = 0; i < 6; i++) { a.key('DPAD_RIGHT'); await sleep(600); }
  const s9 = a.shot('night-row-card10');
  record('Night row screenshots taken (look at them)', true, [s0, s4, s9].map((f) => path.basename(f)));
  a.sh(`am start -n ${ONTV}/.SetupActivity`); await sleep(3000);
  if (turnedOn) await tapText(/^Stop being the home screen$/);
  a.sh('input keyevent KEYCODE_HOME');

  // ---------- every card opens the title it shows ----------
  const pressed = [];
  for (const [tv, who, cards] of [[a, 'person1', a1], [a, 'person2', a2], [b, 'person1', b1]]) {
    for (const c of cards) {
      const r = await tv.call('POST', '/api/continue/open', { id: c.id, who });
      const got = r.status === 200 ? r.json.title : ((r.json && r.json.error) || '').split(' is not on')[0];
      pressed.push({ card: c.title, opened: got, status: r.status });
      tv.stop(NETFLIX); tv.stop(PRIME);
    }
  }
  writeFileSync(path.join(OUT, 'pressed.json'), JSON.stringify(pressed, null, 1));
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wrong = pressed.filter((p) => norm(p.card) !== norm(p.opened));
  record('every card opens the title it shows', pressed.length === 15 && wrong.length === 0, { pressed: pressed.length, wrong });

  // ---------- the clock moves on ----------
  a.sh(`setprop debug.couchtv.clock_offset_s ${29 * 86400}`); b.sh(`setprop debug.couchtv.clock_offset_s ${29 * 86400}`);
  record('29 days later: still there', (await a.list('person2')).length === 4 && (await b.list('person1')).length === 1);
  a.sh(`setprop debug.couchtv.clock_offset_s ${31 * 86400}`); b.sh(`setprop debug.couchtv.clock_offset_s ${31 * 86400}`);
  record('31 days later: dropped off', (await a.list('person2')).length === 0 && (await b.list('person1')).length === 0);
  a.sh('setprop debug.couchtv.clock_offset_s 0'); b.sh('setprop debug.couchtv.clock_offset_s 0');

  const fails = results.filter((r) => !r.pass).length;
  console.log(`${results.length - fails} passed, ${fails} failed, ${Math.round((Date.now() - t0) / 60000)} min. Output: ${OUT}`);
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error('stopped:', e.message); process.exit(1); });
