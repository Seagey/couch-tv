// homekey emulator check, EMULATOR ONLY (Google TV API 34, couchtv_gtv34, read-only AVD).
//   node tests/emu_homekey.mjs <serial emulator-NNNN> <apk dir with plain21.apk, plain22.apk, watch22.apk> <out dir>
// A: plain build (versionCode 21, my code) + GitHub's real v0.13.8 couch-tv-ontv-watch.apk: the one press
//    downloads, checks, installs over it; the watch ends up in Android's list after another service, and bound.
// B: watch build (22, my code), watch off: the one press switches it on, the app checks it connected (its own
//    continuation), Home then lands on Couch TV.
// C: plain build 22 against GitHub's older 0.13.8: refused as not_newer, nothing installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [SERIAL, APKS, OUT] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(SERIAL || "")) { console.error("emulator only"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
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
const shot = (name) => { try { fs.writeFileSync(path.join(OUT, name + ".png"), execFileSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { timeout: 30000 })); } catch (e) {} };
const front = () => (sh("dumpsys activity activities | grep -m1 topResumedActivity").match(/u0 ([^\s}]+)/) || [])[1] || "";
const bound = () => /dev\.couchtv\.ontv\/\.?(dev\.couchtv\.ontv\.)?WatchService/.test(sh("dumpsys accessibility | grep -i -A3 'Bound services'"));

async function fresh(apk) {
  try { adb("uninstall", PKG); } catch (e) {}
  adb("install", "-r", path.join(APKS, apk));
  sh("settings put secure enabled_accessibility_services " + OTHER);
  sh("settings put secure accessibility_enabled 0");
  adb("forward", "tcp:" + PORT, "tcp:5400");
  sh("am start -n " + PKG + "/.SetupActivity");
  await sleep(3500);
  // pair: the code is on the setup screen
  TOKEN = "";
  await call("POST", "/api/pair/start");
  await sleep(1500);
  const pin = (ui().match(/Phone code\s+(\d{3}) (\d{3})/) || []).slice(1).join("");
  const r = await call("POST", "/api/pair", { pin, name: "hk-test" });
  TOKEN = (r.json && r.json.token) || "";
  rec(apk + ": paired with the code on screen", !!TOKEN, pin);
  // the app's own ADB link: Allow debugging? on the TV, Always allow
  await call("POST", "/api/adb/connect", {});
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    if (tap(/Always allow/i)) { await sleep(400); tap(/^(Allow|OK)$/i); }
    const a = await call("GET", "/api/adb");
    if (a.json && a.json.connected) break;
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
    await sleep(1000);
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
}

try { adb("uninstall", PKG); } catch (e) {}
sh("settings delete secure enabled_accessibility_services");
const pass = results.filter((r) => r.pass).length;
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log("homekey emulator check: " + pass + " of " + results.length + " passed");
process.exit(pass === results.length ? 0 : 1);
