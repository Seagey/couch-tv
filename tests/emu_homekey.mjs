// homekey emulator check, EMULATOR ONLY (Google TV API 34, couchtv_gtv34, read-only AVD).
//   node tests/emu_homekey.mjs <serial emulator-NNNN> <apk dir with plain21.apk, plain22.apk, watch22.apk> <out dir>
// A: plain build (versionCode 21, my code) + GitHub's real v0.13.8 couch-tv-ontv-watch.apk: the one press
//    downloads, checks, installs over it; the watch ends up in Android's list after another service, and bound.
// B: watch build (22, my code), watch off: the one press switches it on, the app checks it connected (its own
//    continuation), Home then lands on Couch TV.
// C: plain build 22 against GitHub's older 0.13.8: refused as not_newer, nothing installed.
// D: plain build 21, the copy to the TV made to fail after every check passed (a folder where the APK goes):
//    an error, and Use as home screen off again (this try switched it on just before the copy).
// S: plain build 22 with no link yet: the steps line (and its QR code) shows instead of the button.
// S, A, C and D also check the words under the button end above the bottom of the 1080 high screen.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [SERIAL, APKS, OUT] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(SERIAL || "")) { console.error("emulator only"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
// every picture and result in the folder is from this run
for (const f of fs.readdirSync(OUT)) if (/\.(png|json)$/.test(f)) fs.unlinkSync(path.join(OUT, f));
const ADB = process.env.HOME + "/Library/Android/sdk/platform-tools/adb";
const PKG = "dev.couchtv.ontv", ME = PKG + "/" + PKG + ".WatchService", OTHER = "com.example.other/com.example.other.Svc";
const PORT = 15491;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync(ADB, ["-s", SERIAL, ...a], { encoding: "utf8", timeout: 120000 });
const sh = (c) => adb("shell", c).trim();
const results = [];
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? "PASS " : "FAIL ") + name + (detail ? "  " + String(detail).slice(0, 300) : "")); };
let TOKEN = "";
async function call(method, p, body) {
  const h = {}; if (body) h["content-type"] = "application/json"; if (TOKEN) h.authorization = "Bearer " + TOKEN;
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, json: null, err: String(e.message || e) }; }
}
const ui = () => { try { return adb("exec-out", "uiautomator", "dump", "/dev/tty"); } catch (e) { return ""; } };
function tap(re) {
  for (const m of ui().matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    if (re.test(m[1])) { adb("shell", "input", "tap", String((+m[2] + +m[4]) >> 1), String((+m[3] + +m[5]) >> 1)); return m[1]; }
  }
  return null;
}
// the bottom edge of the first node on screen whose text starts with the prefix (-1: not on screen)
function bottomOf(prefix) {
  for (const m of ui().matchAll(/<node [^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    if (m[1].startsWith(prefix)) return +m[5];
  }
  return -1;
}
const homeListed = () => /dev\.couchtv\.ontv/.test(sh("cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME"));
// a picture that cannot be taken is a failed check, never a silent gap (or an old picture left in its place)
const shot = (name) => {
  let png = null, good = false;
  // up to five tries: a screencap right after the Home key can fail once while the screen changes
  for (let i = 0; i < 5 && !good; i++) {
    if (i) execFileSync("sleep", ["2"]);
    try { png = execFileSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 }); } catch (e) { png = null; }
    good = !!png && png.length > 1000 && png.subarray(1, 4).toString() === "PNG";
  }
  if (good) fs.writeFileSync(path.join(OUT, name + ".png"), png);
  else rec("picture " + name + " taken", false, png ? png.length + " bytes" : "screencap failed");
};
const front = () => (sh("dumpsys activity activities | grep -m1 topResumedActivity").match(/u0 ([^\s}]+)/) || [])[1] || "";
const bound = () => /dev\.couchtv\.ontv\/\.?(dev\.couchtv\.ontv\.)?WatchService/.test(sh("dumpsys accessibility | grep -i -A3 'Bound services'"));

// The setup screen after a fresh install. On the emulator, Android's removal of the old copy's task can kill the new
// process as it starts ("Destroy timeout of remove-task", then a black screen): start it again until it is up and drawn.
async function startSetup() {
  for (let i = 0; i < 4; i++) {
    if (i) { sh("am force-stop " + PKG); await sleep(1500); }
    sh("am start -n " + PKG + "/.SetupActivity");
    await sleep(3500);
    const pid = (() => { try { return sh("pidof " + PKG); } catch (e) { return ""; } })();
    if (pid && /Couch TV/.test(ui())) return true;
  }
  rec("the setup screen came up after the install", false);
  return false;
}
async function fresh(apk) {
  try { adb("uninstall", PKG); } catch (e) {}
  adb("install", "-r", path.join(APKS, apk));
  sh("settings put secure enabled_accessibility_services " + OTHER);
  sh("settings put secure accessibility_enabled 0");
  adb("forward", "tcp:" + PORT, "tcp:5400");
  await sleep(2000);
  await startSetup();
  // pair: the code is on the setup screen
  TOKEN = "";
  await call("POST", "/api/pair/start");
  await sleep(1500);
  // the screen dump can come back empty right after an install: read the code again a few times
  let pin = "";
  for (let i = 0; i < 6 && !pin; i++) { if (i) await sleep(1500); pin = (ui().match(/Phone code\s+(\d{3}) (\d{3})/) || []).slice(1).join(""); }
  const r = await call("POST", "/api/pair", { pin, name: "hk-test" });
  TOKEN = (r.json && r.json.token) || "";
  rec(apk + ": paired with the code on screen", !!TOKEN, pin);
  // the app's own ADB link: Allow debugging? on the TV, Always allow
  await call("POST", "/api/adb/connect", {});
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    // Google TV's "Set up Device Lock" prompt, or an earlier "Allow USB debugging?" left behind it, can hide the
    // dialog: answer Not now, and bring the dialog's task to the front (emulator only; a person sees it on the TV)
    tap(/^Not now$/i);
    const dlg = (sh("am stack list").match(/taskId=(\d+): com\.android\.systemui\/com\.android\.systemui\.usb\.UsbDebuggingActivity[^\n]*visible=false/) || [])[1];
    if (dlg) { sh("am task lock " + dlg); sh("am task lock stop"); await sleep(800); }
    if (tap(/Always allow/i)) { await sleep(400); tap(/^(Allow|OK)$/i); }
    const a = await call("GET", "/api/adb");
    if (a.json && a.json.connected) break;
    // right after a cold boot the first ask can go unanswered (the dialog came up under Google TV's own prompts): ask again
    if (a.json && a.json.state === "failed") await call("POST", "/api/adb/connect", {});
  }
  const a = await call("GET", "/api/adb");
  rec(apk + ": the app's own ADB link is connected", !!(a.json && a.json.connected), JSON.stringify(a.json && { state: a.json.state, error: a.json.error }));
}
async function waitHk(pred, ms, log) {
  const until = Date.now() + ms; let last = null, seen = new Set();
  while (Date.now() < until) {
    const r = await call("GET", "/api/homekey");
    if (r.json) { last = r.json; seen.add(last.view + ":" + last.phase); if (pred(last)) return { last, seen }; }
    else seen.add("down");
    await sleep(1000);
  }
  return { last, seen, timeout: true };
}

console.log("homekey emulator check on " + SERIAL + ", Android " + sh("getprop ro.build.version.release") + ", " + sh("getprop ro.product.model"));
const gtv = sh("pm list packages com.google.android.apps.tv.launcherx");
rec("the emulator is a Google TV (launcherx installed)", /launcherx/.test(gtv), gtv);

// ---------- S: plain build 22 with no link yet: the steps line and its QR code ----------
{
  try { adb("uninstall", PKG); } catch (e) {}
  adb("install", "-r", path.join(APKS, "plain22.apk"));
  await sleep(2000);
  await startSetup();
  tap(/^Not now$/i);
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500);
  const dump = ui();
  rec("S: no link yet: the setup screen shows the steps line, not the button", /This needs Couch TV to press keys/.test(dump) && !/text="Make Home open Couch TV"/.test(dump));
  shot("S-setup-steps");
  const bS = bottomOf("This needs");
  rec("S: the steps words are all on screen (bottom at most 1053)", bS > 0 && bS <= 1053, bS);
  // "the code on the right": an image at the right of the top block, square, all on screen
  const qrs = [...dump.matchAll(/class="android\.widget\.ImageView"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)].map((m) => m.slice(1).map(Number));
  const right = qrs.find(([x1, y1, x2, y2]) => x1 > 1200 && y2 <= 1053 && x2 - x1 > 100 && Math.abs((x2 - x1) - (y2 - y1)) < 4);
  rec("S: the help page code is on screen at the right, as the words say", !!right, JSON.stringify(qrs));
}

// ---------- B: watch build, the watch off ----------
await fresh("watch22.apk");
{
  const s = await call("GET", "/api/homekey");
  rec("B: the watch version, watch off: view ready, watch_apk true", s.json && s.json.view === "ready" && s.json.watch_apk === true, JSON.stringify(s.json && { view: s.json.view, words: s.json.words }));
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500); shot("B-setup-before");
  rec("B: the setup screen shows the button", /Make Home open Couch TV/.test(ui()));
  const st = await call("POST", "/api/homekey/start", {});
  rec("B: start answers busy", st.json && st.json.view === "busy", JSON.stringify(st.json && { view: st.json.view, phase: st.json.phase }));
  const w = await waitHk((h) => h.view !== "busy", 60000);
  rec("B: then done", w.last && w.last.view === "done", JSON.stringify(w.last && { view: w.last.view, error: w.last.error }) + " seen " + [...w.seen].join(","));
  const list = sh("settings get secure enabled_accessibility_services");
  rec("B: the other service stays and the watch is added after it", list === OTHER + ":" + ME, list);
  rec("B: accessibility_enabled is 1", sh("settings get secure accessibility_enabled") === "1");
  rec("B: Android has the watch bound", bound());
  rec("B: Use as home screen is on (Android lists Couch TV as a home)", /dev\.couchtv\.ontv/.test(sh("cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME")));
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500); shot("B-setup-done");
  rec("B: the setup screen says Home should bring Couch TV back", /Home should bring Couch TV back/.test(ui()));
  adb("shell", "input", "keyevent", "KEYCODE_HOME"); await sleep(4000);
  const f = front(); shot("B-after-home");
  rec("B: Home lands on Couch TV's home", f.startsWith(PKG + "/"), f);
}

// ---------- A: plain build 21, GitHub's real 0.13.8 watch APK ----------
await fresh("plain21.apk");
{
  const s = await call("GET", "/api/homekey");
  // start from Google TV's own launcher holding the HOME role, so the check after the install proves a change
  sh("cmd package set-home-activity com.google.android.apps.tv.launcherx/.home.HomeActivity");
  const role0 = sh("cmd role get-role-holders android.app.role.HOME");
  rec("A: before the press Google TV holds the HOME role", !role0.includes(PKG), role0);
  rec("A: the phone version on Google TV with the link: view ready", s.json && s.json.view === "ready" && s.json.watch_apk === false, JSON.stringify(s.json && { view: s.json.view }));
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500); shot("A-setup-before");
  const bA = bottomOf("One press");
  rec("A: the words under the button are all on screen (bottom at most 1053)", bA > 0 && bA <= 1053, bA);
  const st = await call("POST", "/api/homekey/start", {});
  rec("A: start answers busy", st.json && st.json.view === "busy", JSON.stringify(st.json && { view: st.json.view, phase: st.json.phase }));
  const seen = new Set(); let lastJson = null; const until = Date.now() + 240000; let down = 0;
  while (Date.now() < until) {
    const r = await call("GET", "/api/homekey");
    // GitHub's 0.13.8 (what gets installed) has no /api/homekey: any answer without a view is the new version
    if (r.json && r.json.view === undefined) { seen.add("new version answers (" + r.status + ")"); break; }
    if (r.json) { lastJson = r.json; seen.add(r.json.phase || r.json.view); if (r.json.error) break; }
    else { seen.add("down(" + r.status + ")"); down++; }
    if (down > 0 && r.json) break;   // the new version answers again
    await sleep(250);   // often: the installing phase can last under a second
  }
  rec("A: it went through checking, downloading and installing", seen.has("downloading") && seen.has("installing"), [...seen].join(","));
  rec("A: no error", !(lastJson && lastJson.error), lastJson && lastJson.error);
  await sleep(6000);
  const apkPath = sh("pm path " + PKG).replace("package:", "");
  const sum = sh("sha256sum " + apkPath).split(/\s+/)[0];
  rec("A: the installed APK is GitHub's own couch-tv-ontv-watch.apk (SHA-256)", sum === "6db5c0ca5860d773fba39ec9868d2d582c47eaf2f968d551238035cc1d812bb3", sum);
  rec("A: the service is now declared (watch build)", /WatchService/.test(sh("dumpsys package " + PKG + " | grep -i WatchService | head -2")));
  const list = sh("settings get secure enabled_accessibility_services");
  rec("A: the shell line kept the other service and added the watch after it", list === OTHER + ":" + ME, list);
  rec("A: accessibility_enabled is 1", sh("settings get secure accessibility_enabled") === "1");
  let b = false; for (let i = 0; i < 20 && !(b = bound()); i++) await sleep(1000);
  rec("A: Android has the watch bound", b);
  // Google TV ranks its own launcher first in resolve-activity whatever the default is (that is why the watch exists);
  // set-home-activity makes Couch TV the holder of Android's HOME role, which is what the shell line can change
  const role = sh("cmd role get-role-holders android.app.role.HOME");
  rec("A: the home was set again (Couch TV holds the HOME role)", role.split(/\s*;\s*|\s+/).includes(PKG), role);
  rec("A: the copy on the TV was removed", !/couch-tv-homekey\.apk/.test(sh("ls /data/local/tmp")), sh("ls /data/local/tmp"));
  const tokenStill = await call("GET", "/api/settings");
  rec("A: settings stayed: the phone is still paired after the install", tokenStill.status === 200, tokenStill.status);
  adb("shell", "input", "keyevent", "KEYCODE_HOME"); await sleep(4000);
  const f = front(); shot("A-after-home");
  rec("A: Home lands on Couch TV's home", f.startsWith(PKG + "/"), f);
}

// ---------- C: plain build 22 (newer than GitHub's 0.13.8) ----------
await fresh("plain22.apk");
{
  await call("POST", "/api/homekey/start", {});
  const w = await waitHk((h) => h.view !== "busy", 180000);
  rec("C: GitHub's older version is refused (not_newer), with plain words", w.last && w.last.error === "not_newer" && /newer Couch TV than the one on GitHub/.test(w.last.error_words), JSON.stringify(w.last && { view: w.last.view, error: w.last.error }));
  rec("C: nothing was installed (still the phone version, 22)", /versionCode=22/.test(sh("dumpsys package " + PKG + " | grep versionCode")) && !/WatchService/.test(sh("dumpsys package " + PKG + " | grep -i WatchService | head -1")));
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500); shot("C-setup-refused");
  const bC = bottomOf("This TV has a newer");
  rec("C: the refusal words are all on screen (bottom at most 1053)", bC > 0 && bC <= 1053, bC);
}

// ---------- D: plain build 21, the copy to the TV fails after every check passed ----------
await fresh("plain21.apk");
{
  const s0 = await call("GET", "/api/homekey");
  rec("D: before the press Use as home screen is off", s0.json && s0.json.home_on === false && !homeListed(), JSON.stringify(s0.json && { view: s0.json.view, home_on: s0.json.home_on }));
  // a folder where the APK copy goes: rm -f cannot take it away, so the copy fails
  sh("mkdir /data/local/tmp/couch-tv-homekey.apk");
  adb("logcat", "-c");
  const st = await call("POST", "/api/homekey/start", {});
  rec("D: start answers busy", st.json && st.json.view === "busy", JSON.stringify(st.json && { view: st.json.view, phase: st.json.phase }));
  const w = await waitHk((h) => h.view !== "busy", 240000);
  rec("D: it stopped with an error", w.last && !!w.last.error, JSON.stringify(w.last && { view: w.last.view, error: w.last.error }) + " seen " + [...w.seen].join(","));
  // the app's own log, in order: Home on once every check passed, the copy failed, Home off again
  const log = adb("logcat", "-d", "-s", "couchtv.homekey").split("\n")
    .filter((l) => /home on for the install|install: |stopped:|home off again/.test(l))
    .map((l) => l.replace(/^.*couchtv\.homekey: /, "").trim());
  const iOn = log.findIndex((l) => l === "home on for the install");
  // the copy step fails either way, run to run: the push is refused (a folder there) or the rm -f before it times out
  const iPush = log.findIndex((l) => l.startsWith("install: "));
  const iOff = log.findIndex((l) => l === "home off again");
  rec("D: Home went on after every check passed, the copy failed, then Home went off again (the app's log, in that order)", iOn >= 0 && iPush > iOn && iOff > iPush, log.join(" | "));
  rec("D: Use as home screen is off again (home_on false)", w.last && w.last.home_on === false, w.last && w.last.home_on);
  rec("D: Android does not list Couch TV as a home", !homeListed(), sh("cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME"));
  rec("D: nothing was installed (still the phone version, 21)", /versionCode=21/.test(sh("dumpsys package " + PKG + " | grep versionCode")));
  sh("am start -n " + PKG + "/.SetupActivity"); await sleep(1500); shot("D-setup-failed");
  const ew = (w.last && w.last.error_words) || "";
  const bD = ew ? bottomOf(ew.slice(0, 20)) : -1;
  rec("D: the error words are all on screen (bottom at most 1053)", bD > 0 && bD <= 1053, bD + " " + ew);
  sh("rmdir /data/local/tmp/couch-tv-homekey.apk");
}

try { adb("uninstall", PKG); } catch (e) {}
sh("settings delete secure enabled_accessibility_services");
const pass = results.filter((r) => r.pass).length;
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log("homekey emulator check: " + pass + " of " + results.length + " passed");
process.exit(pass === results.length ? 0 : 1);
