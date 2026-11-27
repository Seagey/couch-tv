#!/usr/bin/env node
// Run one line of JavaScript in Couch TV's home page on an emulator (a debug build only: the release app's
// WebView is not inspectable). For coord/SPEED-HOME-MEASURE.md item 23b: the Settings screen with its glass
// swapped for solid panels, so both looks are measured on the same build.
//   node emu-cdp.mjs <adb> <serial> "<expression>"
import { execFileSync } from "node:child_process";

const [adb, serial, expr] = process.argv.slice(2);
if (!adb || !serial || !expr) { console.error('usage: emu-cdp.mjs <adb> <serial> "<expression>"'); process.exit(2); }
const unix = execFileSync(adb, ["-s", serial, "shell", "cat /proc/net/unix"], { encoding: "utf8" });
const sock = (unix.match(/@(webview_devtools_remote_\d+)/) || [])[1];
if (!sock) { console.error("no inspectable WebView (is this a debug build, and is the home open?)"); process.exit(1); }
const PORT = 9333;
execFileSync(adb, ["-s", serial, "forward", "tcp:" + PORT, "localabstract:" + sock]);
try {
  const pages = await (await fetch("http://127.0.0.1:" + PORT + "/json")).json();
  const page = pages.find((p) => p.type === "page" && /\/tv\//.test(p.url)) || pages.find((p) => p.type === "page");
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  const answer = await new Promise((ok) => {
    ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id === 1) ok(j); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  console.log(JSON.stringify(answer.result && answer.result.result ? answer.result.result.value : answer));
} finally {
  execFileSync(adb, ["-s", serial, "forward", "--remove", "tcp:" + PORT]);
}
