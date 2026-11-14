// Custom cards (home.custom_cards, cards.js): parsing and caps on the TV home, and that app.js only
// ever draws them as text. Run: node tests/test_custom_cards.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(web, "cards.js"), "utf8"), sandbox);
const CC = sandbox.window.CustomCards;
const plain = (v) => JSON.parse(JSON.stringify(v));

console.log("Running custom cards tests...");

// a full card, and a bare list
assert.deepStrictEqual(plain(CC.clean({ cards: [{ title: "Solar today", subtitle: "Roof panels", value: "18.4 kWh",
  image: "https://example.com/sun.png", app: "com.example.solar" }] })),
  [{ title: "Solar today", subtitle: "Roof panels", value: "18.4 kWh", image: "https://example.com/sun.png", app: "com.example.solar" }]);
assert.deepStrictEqual(plain(CC.clean([{ title: "Bins" }])), [{ title: "Bins" }]);

// bad JSON: null, so the home keeps the last good cards
assert.strictEqual(CC.parse("{not json"), null);
assert.strictEqual(CC.parse("<html>"), null);
assert.strictEqual(CC.parse(" ".repeat(70000)), null);
assert.deepStrictEqual(plain(CC.parse('{"cards": [{"title": "A"}]}')), [{ title: "A" }]);

// rubbish gives nothing
[null, "x", 3, { cards: "x" }, { cards: { title: "a" } }, [null, 1, "a", [], { value: "no title" }, { title: true }]].forEach((d) => {
  assert.deepStrictEqual(plain(CC.clean(d)), [], JSON.stringify(d));
});

// too many cards: eight
const many = CC.clean(Array.from({ length: 30 }, (_, i) => ({ title: "Card " + i })));
assert.strictEqual(many.length, 8);
assert.strictEqual(many[7].title, "Card 7");

// long text is cut
const long = CC.clean([{ title: "T".repeat(500), subtitle: "S".repeat(500), value: "V".repeat(500) }])[0];
assert.strictEqual(long.title.length, 40);
assert.strictEqual(long.subtitle.length, 60);
assert.strictEqual(long.value.length, 24);
assert.deepStrictEqual(plain(CC.clean([{ title: "a\nb\u0000c", value: 21.5 }])[0]), { title: "a b c", value: "21.5" });

// javascript: and every other non http(s) link refused, for the link and the picture
["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
  "intent://x#Intent;end", "https://a.b/x'; reboot'", "https://a.b/$(reboot)", "https://a.b/`id`",
  "https://a.b/x y", "https://a.b/\"><script>", "//a.b/x", "https://" + "a".repeat(2000)].forEach((u) => {
  const c = CC.clean([{ title: "t", url: u, image: u }])[0];
  assert(!("url" in c) && !("image" in c), "refused: " + u);
});
const good = CC.clean([{ title: "t", url: "https://example.com/a?b=1", image: "http://raspberrypi:8080/a.png" }])[0];
assert.strictEqual(good.url, "https://example.com/a?b=1");
assert.strictEqual(good.image, "http://raspberrypi:8080/a.png");

// an app must be a package name, and wins over a link
["com.x; reboot", "x", "com.x'", "1com.x", "com..x", 5].forEach((app) => {
  assert(!("app" in CC.clean([{ title: "t", app: app }])[0]), "refused app: " + app);
});
const both = CC.clean([{ title: "t", app: "com.netflix.ninja", url: "https://x.y" }])[0];
assert.strictEqual(both.app, "com.netflix.ninja");
assert(!("url" in both));

// HTML stays as typed (app.js sets it with textContent)
assert.strictEqual(CC.clean([{ title: "<img src=x onerror=alert(1)>" }])[0].title, "<img src=x onerror=alert(1)>");

// app.js draws the cards with textContent only: no innerHTML, eval or new Function in addCards
const appJs = fs.readFileSync(path.join(web, "app.js"), "utf8");
const start = appJs.indexOf("function addCards(");
const body = appJs.slice(start, appJs.indexOf("function openCard(", start));
assert(start > 0 && body.length > 100, "addCards found");
assert(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|Function\(|setAttribute\("on/.test(body), "addCards never parses HTML or code");
assert(/textContent = text/.test(body), "card text goes in with textContent");
// off by default: nothing is fetched unless home.custom_cards is set
assert(/if \(HOME\.custom_cards && window\.CustomCards\) \{/.test(appJs), "no fetching unless set");
// cards.js loads before app.js
const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
assert(html.indexOf('src="cards.js"') > 0 && html.indexOf('src="cards.js"') < html.indexOf('src="app.js"'), "cards.js before app.js");
// the heading for a row of only custom cards is in English (other languages fall back to it)
assert(/S\.en = \{[\s\S]*?custom_cards: "Your cards"/.test(fs.readFileSync(path.join(web, "i18n.js"), "utf8")), "S.en.custom_cards");

console.log("Custom cards tests passed.");
