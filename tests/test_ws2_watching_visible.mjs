// Widget swarm round 2, the watching, apps and music group, by what a person can SEE (from the 21 Nov gate
// probe): the 14 kinds, every size each lists, every setting value against the default (or the case named),
// at 10:00 and at 19:30. What shows is the visible characters of each text leaf (measured character by
// character, inside its own box and the widget's, before any "…"), the icons, pictures and app tiles. Checks:
//  - no words cut anywhere (a show's title, a song, an app's name, the volume);
//  - every setting changes what shows, except the cases in SAME, each with its reason;
//  - a value that is the default here draws the same;
//  - every size each kind lists is drawn; no page error.
// Needs Playwright (Chromium). Without it the test says so and passes:
//   COUCHTV_PLAYWRIGHT=<a folder whose node_modules has playwright> node tests/test_ws2_watching_visible.mjs
// WS2_SOFT=1 lists every failure at the end; WS2_VISIBLE_LOG=<file> writes every case drawn.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { chromium = createRequire(path.join(process.env.COUCHTV_PLAYWRIGHT || process.cwd(), "package.json"))("playwright").chromium; }
catch (e) { console.log("SKIP: Playwright is not installed (set COUCHTV_PLAYWRIGHT to a folder that has it)"); process.exit(0); }
let n = 0;
const soft = [];
const ok = (c, m) => { if (process.env.WS2_SOFT && !c) { soft.push(m); return; } assert.ok(c, m); n++; };
// the cases where a setting draws the same at a size, and why ("kind size label")
const SAME = {
  // Keep watching row: As many as fit is 2 on a medium row, 3 on a wide one and 4 on a hero; at most
  // what fits (a show needs 260 px) is 3, 4 and 6
  "keeprow medium shows 2": "As many as fit is 2 on a medium row, which is what it shows already",
  "keeprow medium shows 4 vs 3": "a medium row fits 3 shows at most",
  "keeprow medium shows 5 vs 4": "a medium row fits 3 shows at most",
  "keeprow wide shows 3": "As many as fit is 3 on a wide row, which is what it shows already",
  "keeprow wide shows 5 vs 4": "a wide row fits 4 shows at most",
  "keeprow hero shows 4": "As many as fit is 4 on a hero row, which is what it shows already",
  // Picks for you: a small widget shows one pick
  "picks small mix others": "a small widget shows one pick, and the first pick is what others are watching either way",
  // Now playing: the buttons need a wide widget 300 px high or a tall one 560 px high (the help says so)
  "nowplaying tile buttons off": "a tile has no room for the buttons (the help says so)",
  "nowplaying wtile buttons off": "a wide tile has no room for the buttons (the help says so)",
  "nowplaying small buttons off": "a small widget has no room for the buttons (the help says so)",
  // Up next queue: At most this many; As many as fit is 3 on a small widget, 5 on a tall or large one
  "queue small count 3": "a small widget fits 3 songs, which is what it shows already",
  "queue small count 5": "a small widget fits 3 songs",
  "queue small count 8": "a small widget fits 3 songs",
  "queue small count 5 vs 3": "a small widget fits 3 songs",
  "queue small count 8 vs 5": "a small widget fits 3 songs",
  "queue tall count 5": "a tall widget fits 5 songs, which is what it shows already",
  "queue tall count 8": "a tall widget fits 5 songs",
  "queue tall count 8 vs 5": "a tall widget fits 5 songs",
  "queue large count 5": "a large widget fits 5 songs at their big size, which is what it shows already",
  "queue large count 8": "a large widget fits 5 songs at their big size",
  "queue large count 8 vs 5": "a large widget fits 5 songs at their big size",
  // Soundscape: a tile shows the sound only; the volume is how loud OK plays it (checked in test_ws2_watching)
  "soundscape tile volume 10": "a tile shows the sound only; the volume sets how loud OK plays it",
  "soundscape tile volume 80": "a tile shows the sound only; the volume sets how loud OK plays it",
  "soundscape tile volume 100": "a tile shows the sound only; the volume sets how loud OK plays it",
  // App folder: a tile is four small apps (the help says so); As many as fit is already the number picked
  "folder tile label Shows": "a folder tile shows four small apps; its name shows when it is opened",
  "folder tile cols 1": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 2": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 3": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 4": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 2 vs 1": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 3 vs 2": "a folder tile always shows four small apps (the help says so)",
  "folder tile cols 4 vs 3": "a folder tile always shows four small apps (the help says so)",
  "folder small cols 2": "As many as fit is 2 across here, which is what it shows already",
  "folder tall cols 2": "As many as fit is 2 across here, which is what it shows already",
  "folder medium cols 4": "As many as fit is 4 across here (the size that makes the apps biggest), which is what it shows already",
  "folder large cols 2": "As many as fit is 2 across here, which is what it shows already",
  // App grid: rows only where an app keeps 72 px and its name; a small grid has no names (the help says so)
  "appgrid small cols 1": "a small grid fits 2 rows, so its 4 apps go 2 across",
  "appgrid small cols 2": "a small grid fits 2 rows, so its 4 apps go 2 across, which is what it shows already",
  "appgrid small cols 2 vs 1": "a small grid fits 2 rows, so its 4 apps go 2 across",
  "appgrid small names off": "a small grid shows no names (the help says so)",
  "appgrid medium cols 4": "As many as fit is 4 across on a medium grid (the size that makes the apps biggest), which is what it shows already",
  "appgrid medium cols 2 vs 1": "a medium grid fits 2 rows with names, so its 4 apps go at least 2 across",
  "appgrid large cols 2": "As many as fit is 2 across here, which is what it shows already",
  "appgrid xl cols 3": "As many as fit is 3 across here (the size that makes the apps biggest), which is what it shows already",
  // Quick buttons: a tile holds one button
  "quick tile quick six": "a tile holds one button, and the first is the sleep timer either way"
};
const NSAME = 45;   // how many cases SAME names (pinned, so a new one is a decision)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="widgets.css"></head><body style="margin:0;width:1920px;height:1080px;background:#26303f">' +
  ["icon-sets.js", "design-icons.js", "app-catalogue.js", "widgets.js", "widget-caps.js", "widget-web.js", "widget-detail.js"].map((s) => '<script src="' + s + '"></script>').join("") + "</body></html>";
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/tv-home/web/probe.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); return; }
  const p = path.normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, "");
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch();
const lines = [];
const cases = { all: 0, same: 0 }, usedSame = {};
try {
  for (const [hh, mm] of [[10, 0], [19, 30]]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    const at = new Date(); at.setHours(hh, mm, 0, 0);
    await page.clock.setFixedTime(at);
    await page.goto(ORIGIN + "/tv-home/web/probe.html");
    await page.waitForFunction(() => window.CouchWidgets && window.CouchWidgetCaps && window.CouchWidgetWeb);
    const out = await page.evaluate(async () => {
      const show = (title, pkg, extra) => Object.assign({ title, season: 1, episode: 2, app: { package: pkg, name: pkg }, backdrop: "backgrounds/scene-night.jpg", progress: 0.4 }, extra || {});
      const INSTALLED = [["com.netflix.ninja", "Netflix"], ["au.com.stan.and", "Stan"], ["au.com.kayosports.tv", "Kayo"], ["com.google.android.youtube.tv", "YouTube"], ["au.net.abc.iview", "ABC iview"],
        ["com.disney.disneyplus", "Disney+"], ["com.spotify.tv.android", "Spotify"], ["com.amazon.amazonvideo.livingroom", "Prime Video"]].map((p) => ({ package: p[0], name: p[1] }));
      const MINE = [show("Ozark", "com.netflix.ninja"), show("Bluey", "au.net.abc.iview"), show("Titans v Broncos", "au.com.kayosports.tv"), show("Rake", "au.com.stan.and"), show("Wakefield", "au.com.stan.and", { progress: 0.3 }), show("Fisk", "au.net.abc.iview")];
      const BENS = [show("The Bear", "com.disney.disneyplus"), show("Utopia", "au.com.stan.and")];
      const base = { who: "sam", shows: MINE, apps: INSTALLED, bridge: true, people: [{ id: "sam", name: "Sam" }, { id: "ben", name: "Ben" }],
        household: [{ id: "sam", name: "Sam", shows: MINE }, { id: "ben", name: "Ben", shows: BENS }],
        music: { title: "Riptide", artist: "Vance Joy", art: "backgrounds/scene-golden.jpg", state: "playing", package: "com.spotify.tv.android", source: "Spotify", position: 30, duration: 200 },
        queue: { ok: true, items: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"].map((t) => ({ title: t + " song", artist: "Band" })) },
        quick: ["sleep", "picture", "input"], quickCan: ["sleep", "picture", "input", "look", "soundscape", "screen_off", "headphones", "tvsettings"] };
      const PX = { tile: [160, 160], wtile: [360, 160], small: [360, 360], tall: [360, 560], medium: [760, 360], wide: [1160, 360], large: [760, 760], xl: [1160, 760], line: [360, 60], wline: [760, 60], hero: [1760, 660], full: [1760, 960], row8: [760, 160], row12: [1160, 160], row18: [1760, 160] };
      const C = window.CouchWidgetCaps;
      async function draw(o, w, h, v) {
        document.querySelectorAll(".ws-host").forEach((x) => x.remove());
        const host = document.createElement("div");
        host.className = "ws-host cw-o"; host.style.cssText = "position:absolute;left:80px;top:60px";
        document.body.appendChild(host);
        const env = { data: Object.assign({}, base, v.data || {}, { wset: { x: v.set || {} } }) };
        if (v.edits) env.edits = (id, kind) => v.edits[id + "|" + kind] || null;
        const root = window.CouchWidgets.render(Object.assign({ id: "x", w, h }, o, v.opts ? { opts: Object.assign({}, o.opts || {}, v.opts) } : {}), env);
        host.appendChild(root);
        // the words are fitted once the widget is on screen (widgets.js fitLater): measure after that
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, root.hasAttribute("data-fits") ? 40 : 0)));
        const R = root.getBoundingClientRect(), leaves = [];
        [root].concat([...root.querySelectorAll("*")]).forEach((el) => {
          if (el.closest("svg")) return;
          if (el.closest(".cw-slot") && getComputedStyle(el.closest(".cw-slot")).opacity === "0") return;
          const nodes = [...el.childNodes].filter((nd) => nd.nodeType === 3 && nd.textContent.trim());
          if (!nodes.length) return;
          const E = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || E.width === 0) return;
          const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
          const ell = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
          const cut = ell ? 18 : 0;
          let t = "", vis = 0, gone = false;
          for (const nd of nodes) for (let i = 0; i < nd.textContent.length; i++) {
            const ch = nd.textContent[i]; t += ch;
            const rg = document.createRange(); rg.setStart(nd, i); rg.setEnd(nd, i + 1);
            const r = rg.getBoundingClientRect();
            const inside = r.width === 0 || (r.left >= Math.max(E.left, R.left) - 1 && r.right <= Math.min(E.right - cut, R.right) + 1 && r.top >= R.top - 1 && r.bottom <= (clamp ? Math.min(E.bottom, R.bottom) : R.bottom) + 1);
            if (!inside) gone = true;
            if (!gone) vis++;
          }
          const tt = t.replace(/\s+/g, " ").trim();
          leaves.push({ t: tt, seen: t.slice(0, vis).replace(/\s+/g, " ").trim(), fit: !gone && !ell && !(clamp && el.scrollHeight > el.clientHeight + 1) });
        });
        const inBox = (el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).visibility !== "hidden" && r.width > 0 && r.height > 0 && r.right > R.left && r.left < R.right && r.bottom > R.top && r.top < R.bottom; };
        const svgs = [...root.querySelectorAll("svg")].filter(inBox).map((s) => (s.getAttribute("style") || "") + s.innerHTML.length);
        const bgs = [...root.querySelectorAll("*")].filter((e) => e.style && /url\(/.test(e.style.backgroundImage || "") && inBox(e)).map((e) => (e.style.backgroundImage.match(/[^/"]+\.(jpg|png|webp|svg)/) || [""])[0]);
        const tiles = [...root.querySelectorAll("[data-act]")].filter(inBox).map((e) => e.getAttribute("data-act") + ":" + (e.getAttribute("data-arg") || "") + "@" + Math.round(e.getBoundingClientRect().left - R.left) + "," + Math.round(e.getBoundingClientRect().top - R.top));
        return { empty: root.getAttribute("data-empty") === "1", turn: root.getAttribute("data-turn") || "",
          seen: leaves.map((l) => l.seen).join(" | "), cut: leaves.filter((l) => !l.fit).map((l) => '"' + l.t + '" shows "' + l.seen + '"'),
          sig: leaves.map((l) => l.seen).join(" | ") + " || " + svgs.join(";") + " || " + bgs.join(";") + " || " + tiles.join(";") };
      }
      const APPS4 = { apps: ["netflix", "stan", "youtube", "iview"] };
      // kind: [object, variants]; variant: [label, { set, opts, edits, data }, expectSame (the value is the default here), vs]
      const V = {
        keep: [{ kind: "keep" }, [["default", {}], ["person ben", { set: { person: "ben" } }], ["person auto (same)", { set: { person: "auto" } }, true], ["person sam = watcher (same)", { set: { person: "sam" } }, true]]],
        keeprow: [{ kind: "keeprow" }, [["default", {}], ["label Our shows", { set: { label: "Our shows" } }], ["shows 1", { set: { shows: 1 } }], ["shows 2", { set: { shows: 2 } }], ["shows 3", { set: { shows: 3 } }], ["shows 4", { set: { shows: 4 } }], ["shows 5", { set: { shows: 5 } }],
          ["shows 2 vs 1", { set: { shows: 2 } }, false, "shows 1"], ["shows 3 vs 2", { set: { shows: 3 } }, false, "shows 2"], ["shows 4 vs 3", { set: { shows: 4 } }, false, "shows 3"], ["shows 5 vs 4", { set: { shows: 5 } }, false, "shows 4"], ["person ben", { set: { person: "ben" } }]]],
        upnext: [{ kind: "upnext" }, [["default", {}], ["sport on", { set: { sport: true } }], ["sport off (same: no scores)", { set: { sport: false } }, true], ["apps stan", { set: { apps: ["stan"] } }], ["apps prime (none on the go)", { set: { apps: ["prime"] } }],
          ["apps iview", { set: { apps: ["iview"] } }], ["apps netflix (same: first show is Netflix)", { set: { apps: ["netflix"] } }, true]]],
        picks: [{ kind: "picks" }, [["default", {}], ["label For Sam", { set: { label: "For Sam" } }], ["mix others", { set: { mix: "others" } }], ["mix mine", { set: { mix: "mine" } }], ["mix all (same)", { set: { mix: "all" } }, true]]],
        nowplaying: [{ kind: "nowplaying" }, [["default", {}], ["buttons off", { set: { buttons: false } }], ["cover off", { set: { cover: false } }], ["both off", { set: { buttons: false, cover: false } }]]],
        queue: [{ kind: "queue" }, [["default", {}], ["label Next songs", { set: { label: "Next songs" } }], ["count 3", { set: { count: 3 } }], ["count 5", { set: { count: 5 } }], ["count 8", { set: { count: 8 } }],
          ["count 5 vs 3", { set: { count: 5 } }, false, "count 3"], ["count 8 vs 5", { set: { count: 8 } }, false, "count 5"]]],
        soundscape: [{ kind: "soundscape" }, [["default", {}], ["sound fire", { set: { sound: "fire" } }], ["sound waves", { set: { sound: "waves" } }], ["sound brown", { set: { sound: "brown" } }], ["sound rain (same)", { set: { sound: "rain" } }, true],
          ["volume 10", { set: { volume: 10 } }], ["volume 80", { set: { volume: 80 } }], ["volume 100", { set: { volume: 100 } }]]],
        games: [{ kind: "games", opts: { apps: ["netflix", "stan"] } }, [["default", {}], ["label Arcade", { set: { label: "Arcade" } }], ["apps (Hold OK) youtube, iview", { edits: { "x|games": ["youtube", "iview"] } }], ["apps (design) youtube", { opts: { apps: ["youtube"] } }]]],
        app: [{ kind: "app", opts: { apps: ["netflix"] } }, [["default", {}], ["apps (Hold OK) stan", { edits: { "x|app": ["stan"] } }], ["apps (design) iview", { opts: { apps: ["iview"] } }]]],
        folder: [{ kind: "folder", opts: Object.assign({ label: "Kids" }, APPS4) }, [["default", {}], ["label Shows", { set: { label: "Shows" } }], ["cols 1", { set: { cols: 1 } }], ["cols 2", { set: { cols: 2 } }], ["cols 3", { set: { cols: 3 } }],
          ["cols 4", { set: { cols: 4 } }], ["cols 2 vs 1", { set: { cols: 2 } }, false, "cols 1"], ["cols 3 vs 2", { set: { cols: 3 } }, false, "cols 2"], ["cols 4 vs 3", { set: { cols: 4 } }, false, "cols 3"],
          ["apps (Hold OK) iview", { edits: { "x|folder": ["iview"] } }]]],
        dock: [{ kind: "dock", opts: APPS4 }, [["default", {}], ["more off", { set: { more: false } }], ["apps (Hold OK) youtube", { edits: { "x|dock": ["youtube"] } }]]],
        appgrid: [{ kind: "appgrid", opts: APPS4 }, [["default", {}], ["cols 1", { set: { cols: 1 } }], ["cols 2", { set: { cols: 2 } }], ["cols 3", { set: { cols: 3 } }], ["cols 4", { set: { cols: 4 } }],
          ["cols 2 vs 1", { set: { cols: 2 } }, false, "cols 1"], ["cols 3 vs 2", { set: { cols: 3 } }, false, "cols 2"], ["cols 4 vs 3", { set: { cols: 4 } }, false, "cols 3"], ["names off", { set: { names: false } }], ["apps (Hold OK) stan", { edits: { "x|appgrid": ["stan"] } }]]],
        quick: [{ kind: "quick" }, [["default", {}], ["quick soundscape, screen_off", { set: { quick: ["soundscape", "screen_off"] } }], ["quick look", { set: { quick: ["look"] } }], ["quick six", { set: { quick: ["sleep", "picture", "look", "soundscape", "screen_off", "headphones"] } }],
          ["quick sleep, picture, input (same as home)", { set: { quick: ["sleep", "picture", "input"] } }, true]]],
        stack: [{ kind: "stack", items: [{ kind: "weather" }, { kind: "keep" }, { kind: "clock" }] }, [["default", {}], ["turn 0 (by time of day)", { set: { turn: 0 } }], ["turn 10", { set: { turn: 10 } }], ["turn 30", { set: { turn: 30 } }], ["turn 60", { set: { turn: 60 } }]]]
      };
      const res = [];
      for (const kind of Object.keys(V)) {
        const cap = C.get(kind).sizes, listed = (cap.s || []).concat((cap.x || []).map((x) => x[0]));
        const missing = listed.filter((s) => !PX[s]);
        if (missing.length) res.push({ kind, s: "?", label: "sizes not drawn: " + missing.join(","), w: 0, h: 0, same: false, expSame: false, cut: [], seen: "", missing: true });
        const [o, vars] = V[kind];
        for (const s of listed.filter((x) => PX[x])) {
          const [w, h] = PX[s], got = {};
          for (const [label, v, expSame, vs] of vars) {
            const d = await draw(o, w, h, v);
            got[label] = d;
            const ref = got[vs || "default"];
            const same = label !== "default" && d.sig === ref.sig;
            res.push({ kind, s, w, h, label, vs: vs || "default", same, expSame: !!expSame, empty: d.empty, cut: d.cut, seen: d.seen, turn: d.turn });
          }
        }
      }
      return res;
    });
    lines.push("==== clock " + hh + ":" + pad(mm) + (errs.length ? " PAGEERRORS " + errs.join(" / ") : ""));
    ok(!errs.length, "no page errors at " + hh + ":" + pad(mm) + ": " + errs.join(" / "));
    for (const r of out) {
      if (r.missing) { ok(false, r.kind + ": " + r.label); continue; }
      const at = r.kind + " " + r.s + " (" + r.w + " x " + r.h + ") " + r.label + " at " + hh + ":" + pad(mm);
      cases.all++;
      // an app filter with nothing of its own on the go says so plainly: the one empty card meant
      if (!/none on the go/.test(r.label)) ok(!r.empty, at + ": draws, not an empty card");
      ok(!r.cut.length, at + ": no words cut: " + r.cut.join("; "));
      const flag = r.label === "default" ? "" : r.same && !r.expSame ? "SAME(vs " + r.vs + ")" : !r.same && r.expSame ? "CHANGED(expected same)" : "";
      lines.push([r.kind, r.s + " " + r.w + "x" + r.h, r.label, flag, r.empty ? "EMPTY" : "", r.turn ? "turn=" + r.turn : "", r.cut.length ? "CUT[" + r.cut.join("; ") + "]" : "", "=> " + r.seen.slice(0, 200)].filter(Boolean).join(" ; "));
      if (r.label === "default") continue;
      const key = r.kind + " " + r.s + " " + r.label, why = SAME[key];
      if (r.expSame || why) { ok(r.same, at + ": draws the same as " + r.vs + (why ? " (" + why + ")" : " (that value is the default here)") + ": " + r.seen); cases.same++; if (why) usedSame[key] = 1; }
      else ok(!r.same, at + ": changes what shows against " + r.vs + ": " + r.seen);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  if (process.env.WS2_VISIBLE_LOG) fs.writeFileSync(process.env.WS2_VISIBLE_LOG, lines.join("\n"));
}
// every reason in SAME is a real case (none left over from an older layout)
Object.keys(SAME).forEach((k) => ok(usedSame[k], "SAME names a real case: " + k));
ok(Object.keys(SAME).length === NSAME, NSAME + " setting x size cases draw the same, each with its reason");
console.log("  " + cases.all + " kind x size x setting x time cases, " + cases.same + " of them the same by design (" + Object.keys(SAME).length + " named in SAME)");
if (soft.length) { console.log(soft.length + " FAILED:\n" + soft.join("\n")); process.exit(1); }
console.log("All " + n + " checks passed.");
function pad(v) { return String(v).padStart(2, "0"); }
