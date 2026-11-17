// Sections in a design (tv-home/web/design.js): a "group" object holds controls on its own grid, like
// iPhone Control Centre. The gate keeps only known controls and set sizes, the TV packs them itself so a
// section always stays even, names go through the same word checks as everything else, and an icon
// style is only ever a name (a set of icons is code shipped with the home, never markup in a design).
// Run: node tests/test_design_sections.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const noop = () => {};
const sandbox = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design.js"), "utf8"), sandbox);
const CD = sandbox.window.CouchDesign;
const plain = (v) => JSON.parse(JSON.stringify(v));

console.log("Running design section tests...");

// 1. the gate: known controls, set sizes, a section always behind the home
const clean = plain(CD.sanitize({
  objects: [{
    id: "sec1", type: "group", x: 80, y: 60, w: 830, h: 210, cols: 4, rows: 1, panel: "glass", layer: "front", icon_style: "duotone",
    controls: [
      { kind: "light", name: "Lounge", size: "w", on: false, onclick: "alert(1)" },
      { kind: "garage_door", name: "Garage" },                     // unknown kind: a light, never a garage
      { app: "com.netflix.ninja", size: "b", name: "ignored for apps" },
      { app: "gear" },                                             // Settings stays in the dock
      { app: "__proto__" },                                        // never a package name
      { kind: "scene", name: "Call 0512 345 678" },                // a phone number: the control is dropped
      { kind: "speaker", size: "huge" },                           // not a set size: Small
      "a string", null
    ]
  }]
}));
const g = clean.objects[0];
assert.strictEqual(g.type, "group");
assert.strictEqual(g.layer, "back", "a section always sits behind the home, so its apps (drawn by the dock) stay on top");
assert.strictEqual(g.cols, 4); assert.strictEqual(g.rows, 1);
assert.strictEqual(g.icon_style, "duotone", "an icon style is kept as a name");
assert.deepStrictEqual(g.controls[0], { kind: "light", size: "w", name: "Lounge", on: false });
assert.strictEqual(g.controls[1].kind, "light", "an unknown kind becomes a light");
assert.deepStrictEqual(g.controls[2], { app: "com.netflix.ninja", size: "b" }, "an app control has no name of its own");
assert.ok(!g.controls.some((c) => c.app === "gear" || c.app === "__proto__"), "no Settings tile and no poisoned package");
assert.ok(!JSON.stringify(g).includes("0412"), "a name with a number in it is not kept (the control stays, with its plain name)");
assert.ok(g.controls.some((c) => c.kind === "scene" && !c.name));
assert.ok(!g.controls[g.controls.length - 1].size, "an unknown size is dropped (Small)");
assert.strictEqual(g.controls.length, 5);
console.log("  ok gate");

// bad icon style names never pass
["<svg onload=alert(1)>", "../x", "A B", "x".repeat(40), 5].forEach((v) => {
  const c = plain(CD.sanitize({ objects: [{ id: "s", type: "group", icon_style: v, controls: [] }, { id: "t", type: "smart", kind: "light", icon_style: v }] }));
  assert.ok(!c.objects[0].icon_style && !c.objects[1].icon_style, "icon style " + v + " refused");
});
// numbers are clamped
const big = plain(CD.sanitize({ objects: [{ id: "s", type: "group", w: 830, h: 210, cols: 99, rows: -3, controls: new Array(80).fill({ kind: "light" }) }] })).objects[0];
assert.strictEqual(big.cols, 8); assert.strictEqual(big.rows, 1);
assert.ok(big.controls.length <= 32, "at most 32 controls");
console.log("  ok limits");

// 2. packing: in order, left to right, top to bottom, each at the first free place; what does not fit is left out
const pk = CD.packGroup([{ size: "w" }, { size: "s" }, { size: "t" }, { size: "s" }, { size: "b" }], 4, 2);
assert.deepStrictEqual(plain(pk).map((p) => p.fits ? [p.c, p.r, p.w, p.h] : null), [[0, 0, 2, 1], [2, 0, 1, 1], [3, 0, 1, 2], [0, 1, 1, 1], null]);
const pk2 = CD.packGroup([{ size: "b" }, { size: "s" }, { size: "s" }, { size: "s" }, { size: "s" }], 4, 2);
assert.ok(pk2.every((p) => p.fits), "a big control and four small ones fill a 4 by 2 section");
// never two in one module
const used = {};
pk2.forEach((p) => { for (let y = p.r; y < p.r + p.h; y++) for (let x = p.c; x < p.c + p.w; x++) { assert.ok(!used[x + "," + y], "no overlap"); used[x + "," + y] = 1; } });
console.log("  ok packing");

// 3. module geometry: even, inside the section, the same numbers the designer uses
const cells = CD.groupCells({ w: 830, h: 210, cols: 4, rows: 1, controls: [{ size: "w" }, { size: "s" }, { size: "s" }] });
assert.strictEqual(cells.cells.length, 3);
cells.cells.forEach((c) => { assert.ok(c.x >= 16 && c.y >= 16 && c.x + c.w <= 830 - 16 + 0.01 && c.y + c.h <= 210 - 16 + 0.01, "inside the padding"); });
assert.ok(Math.abs(cells.cells[1].x - (cells.cells[0].x + cells.cells[0].w + 16)) < 0.01, "a 16 px gap between controls");
assert.ok(Math.abs(cells.cells[0].w - (2 * cells.mw + 16)) < 0.01, "a wide control is two modules and the gap");
console.log("  ok geometry");

// 4. the speed list counts a section: one frosted panel, and its controls
const cost = CD.cost({ objects: [{ id: "s", type: "group", w: 830, h: 210, cols: 4, rows: 1, controls: [{ kind: "light" }, { kind: "aircon" }, { app: "com.netflix.ninja" }] }] }, true);
assert.ok(cost.some((c) => /Frosted cards \(1\)/.test(c[0])), "one frosted panel for the whole section");
assert.ok(cost.some((c) => /Controls in sections \(2\)/.test(c[0])), "two controls (the app is the dock's own tile)");
console.log("  ok cost");

// 5. icon sets: only registered by code, only known icon names, only svg markup; the default stays
assert.deepStrictEqual(plain(CD.iconSets()), [{ id: "line", label: "Classic", full: false }]);
assert.strictEqual(CD.registerIcons("line", "Mine", { light: "<svg></svg>" }), false, "the built in set cannot be replaced");
assert.strictEqual(CD.registerIcons("bad name", "x", {}), false);
assert.strictEqual(CD.registerIcons("duotone", "Duotone", { light: "<svg viewBox=\"0 0 24 24\"></svg>", nonsense: "<svg></svg>", aircon: "<img src=x>" }), true);
assert.deepStrictEqual(plain(CD.iconSets()).map((s) => s.id), ["line", "duotone"]);
console.log("  ok icon sets");

// 6. the shipped icon sets (icon-sets.js, registered by design-icons.js): six styles, plain svg only
vm.runInContext(fs.readFileSync(path.join(web, "icon-sets.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "design-icons.js"), "utf8"), sandbox);
const sets = plain(CD.iconSets()).map((s) => s.id);
["set-line", "set-solid", "set-duotone", "set-tile", "set-glass", "set-playful"].forEach((id) => assert.ok(sets.includes(id), id + " registered"));
assert.ok(plain(CD.iconSets()).find((s) => s.id === "set-tile").full && !plain(CD.iconSets()).find((s) => s.id === "set-solid").full);
["solid", "tile", "glass", "playful", "duotone", "line"].forEach((st) => ["aircon", "light", "wifi", "favourite", "outlet", "tv", "home"].forEach((n) => {
  const s = sandbox.window.TVIcons.svg(st, n, 0);
  assert.ok(/^<svg[\s>]/.test(s) && !/<script|\son[a-z]+\s*=|javascript:|<style|href\s*=\s*["']?https?:/i.test(s), st + "/" + n + " is plain svg");
}));
console.log("  ok shipped icon sets");

// 7. small home parts (seagey, 18 Nov): a Keep watching that shows one show at a time, a dock that
// holds its first few apps (the rest wait in More apps)
const small = plain(CD.sanitize({ elements: { keep_watching: { compact: "square" }, dock: { max_apps: 3, layout: "grid", columns: 2 } } }));
assert.strictEqual(small.elements.keep_watching.compact, "square");
assert.strictEqual(small.elements.dock.max_apps, 3);
const bad = plain(CD.sanitize({ elements: { keep_watching: { compact: "carousel<script>" }, dock: { max_apps: 99 } } }));
assert.ok(!bad.elements || !bad.elements.keep_watching || !bad.elements.keep_watching.compact, "an unknown compact mode is dropped");
assert.strictEqual(bad.elements.dock.max_apps, 10, "max apps is clamped to ten");
assert.strictEqual(plain(CD.sanitize({ elements: { dock: { max_apps: 0 } } })).elements.dock.max_apps, 1, "a dock always holds at least one app");
// (which apps a small or hidden dock shows is CouchDesign.dock on a running home: checked in the
// browser by tools/tv-designer/scripts/small-checks.mjs)
console.log("  ok small parts");

// (a hidden dock keeping a section's apps is checked in the browser: tools/tv-designer/scripts/sections-checks.mjs, check 5)
console.log("All design section tests passed.");
