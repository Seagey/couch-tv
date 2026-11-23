// No ring round the whole screen (the TCL test of 0.13.10, 23 Nov 2026: a thin orange line ran round the edge
// of the screen on the first-run welcome). The home's WebView, in both apps, turns off Android's own focus
// highlight (Android 8 and newer draw it round a focused view, here the whole screen); the page draws its own
// focus, and no page element the size of the screen draws a focus outline.
// Run: node tests/test_home_focus_ring.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const R = path.join(__dirname, "..");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running home focus ring tests...");

for (const [f, fn] of [["on-tv/android/app/src/main/java/dev/couchtv/ontv/HomeActivity.kt", "makeWeb"],
                       ["tv-home/android/app/src/main/java/app/couchtv/launcher/MainActivity.kt", "makeWebView"]]) {
  const src = fs.readFileSync(path.join(R, f), "utf8");
  const at = src.indexOf("private fun " + fn + "(): WebView");
  ok(at >= 0, f + ": " + fn + " is there");
  const body = src.slice(at, at + 1500);
  ok(/if \((android\.os\.)?Build\.VERSION\.SDK_INT >= 26\) defaultFocusHighlightEnabled = false/.test(body),
    f + ": the home WebView draws no focus highlight of its own (Android 8 and newer)");
}
// the welcome, the page and its body never get an outline of their own
const css = fs.readFileSync(path.join(R, "tv-home/web/app.css"), "utf8");
ok(!/(^|[\s,}])(html|body|\.welcome)(:focus[-a-z]*)?\s*\{[^}]*outline:\s*(?!none|0)/m.test(css), "app.css puts no outline on html, body or the welcome");

console.log("All " + n + " home focus ring tests passed.");
