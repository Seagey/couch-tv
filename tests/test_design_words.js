// Words a design must never put on a TV: phone numbers and web addresses, however they are written
// (tv-home/web/design.js, scam and flags). Every trick from review round 5 of couch-tv Studio, five
// more, and ordinary words that must still show. Run: node tests/test_design_words.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const noop = () => {};
const sandbox = {
  location: { search: "", origin: "http://tv" },
  document: { documentElement: { classList: { add: noop, remove: noop, toggle: noop, contains: () => false } }, addEventListener: noop },
  innerWidth: 1920, innerHeight: 1080
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../tv-home/web/design.js"), "utf8"), sandbox);
const C = sandbox.window.CouchDesign.check;
const T = (id, text, x = 200, y = 300) => ({ id, type: "text", text, x, y, size: 60 });
const shown = (d) => { const c = C(d).clean; return JSON.stringify([c.objects || [], c.texts || []]); };

console.log("Running design words tests...");
const tricks = {
  plain: [T("a", "TV LOCKED. Call 1900 123 456 to unlock")],
  fullwidth: [T("a", "TV LOCKED. Call １９００ １２３ ４５６ to unlock")],
  slash: [T("a", "Call 1900/123/456 to unlock")],
  words: [T("a", "TV LOCKED. Call one nine hundred, 123, 456")],
  split: [T("a", "TV LOCKED. Call 1900", 200, 300), T("b", "123 456 to unlock", 1010, 300)],
  dotWord: [T("a", "Visit fixmytv dot com to unlock")],
  fullDot: [T("a", "Visit fixmytv．com to unlock")],
  tld: [T("a", "Visit fixmy.tv-support.help or tvfix.ai")],
  zones: [{ id: "z", type: "smart", kind: "aircon", style: "card", x: 300, y: 300, name: "TV LOCKED", zones: ["Call 1900", "123 456"], status: "Ring 0500 12 34 56" }],
  name: [{ id: "n", type: "smart", kind: "light", style: "tile", x: 300, y: 300, name: "Call 1900123456" }],
  // five more
  cyrillic: [T("a", "Visit fixmytv.cоm to unlock")],
  zeroWidth: [T("a", "Call 1900​123​456")],
  keycaps: [T("a", "Call 1️⃣9️⃣0️⃣0️⃣ 1️⃣2️⃣3️⃣ 4️⃣5️⃣6️⃣")],
  spaced: [T("a", "Go to f i x m y t v . c o m now")],
  letters: [T("a", "Call 19OO l23 456")],
  bracketDot: [T("a", "fixmytv [dot] com"), T("b", "or fixmytv(.)net")],
  threeCards: [T("a", "Call 0400", 100, 200), T("b", "123", 600, 200), T("c", "456 now", 900, 200)],
  // review round 6
  arabicDigits: [T("a", "TV LOCKED. Call ١٩٠٠ ١٢٣ ٤٥٦ to unlock")],
  devanagari: [T("a", "TV LOCKED. Call १९०० १२३ ४५६")],
  letterDigits: [T("a", "TV LOCKED. Call l9OO lZ3 4S6 to unlock")],
  smallCaps: [T("a", "Visit fixmytv.ᴄᴏᴍ to unlock")],
  armenian: [T("a", "Visit fixmytv.cօm to unlock")],
  spacedDot: [T("a", "Visit fixmytv d o t c o m to unlock")],
  columns: [T("a", "1\\n9\\n0\\n0", 200, 200), T("b", "1\\n2\\n3", 260, 200), T("c", "4\\n5\\n6", 320, 200)],
  short13: [T("a", "TV LOCKED. Call 13 14 50 to unlock")],
  handle: [T("a", "TV LOCKED. Message @fixmytv on Instagram")],
  keycapBox: [T("a", "Call 1⃞9⃞0⃞0⃞ 1⃞2⃞3⃞")],
  wordJoiner: [T("a", "Call 1900⁡123⁡456")],
  spanish: [T("a", "Llama uno nueve cero cero, uno dos tres, cuatro cinco seis")],
  superscript: [T("a", "Call ¹⁹⁰⁰ ¹²³ ⁴⁵⁶")]
};
// v8: what can still be drawn has no digit, no @, and nothing the gate's own reader sees as a number or an address
const drawn = (d) => { const c = C(d).clean; return (c.objects || []).map((o) => [o.text, o.name, (o.zones || []).join(" "), (o.items || []).join(" ")].filter(Boolean).join(" ")).concat((c.texts || []).map((t) => t.text)).join(" | "); };
for (const [name, objects] of Object.entries(tricks)) {
  const w = drawn({ v: 1, objects });
  assert.ok(!/[0-9@٠-٩०-९¹²³⁰-⁹⃞⃣]/.test(w), name + " left a digit or @: " + w);
  assert.ok(!/fixmy|tvfix|\.c[oօ]?m|\.ai|\.help/i.test(w), name + " left an address: " + w);
  assert.strictEqual(sandbox.window.CouchDesign.flags(C({ v: 1, objects }).clean).length, 0, name + " still reads as a number or address: " + w);
}
// ordinary words still show, exactly as typed
const plainWords = ["Welcome. Make yourself at home.", "Pick an app below.", "Bins out Tuesday", "Wi-Fi: salt-and-sun", "Pizza from Luigi's, enjoy!", "Café crème (on the bench)", "Living room"];
const kept = C({ v: 1, objects: plainWords.map((t, i) => T("p" + i, t, 200, 100 + i * 80)) });
assert.deepStrictEqual(kept.clean.objects.map((o) => o.text), plainWords.slice(), "plain words are kept exactly");
assert.strictEqual(kept.flags.length, 0, "and not flagged: " + JSON.stringify(kept.flags));
// v9: a line with any number or blocked character is dropped whole, never shown with holes in it
const mixed = C({ v: 1, objects: [T("a", "Movie night\nStarts 8 pm\nBring snacks"), T("b", "Happy 40th birthday Sam!"), T("c", "Back by 10.30")] }).clean.objects || [];
assert.deepStrictEqual(mixed.map((o) => o.text), ["Movie night\nBring snacks"], "the lines with numbers go whole, the rest stay: " + JSON.stringify(mixed.map((o) => o.text)));
const lines = sandbox.window.CouchDesign.lines("Movie night\nStarts 8 pm\nCall @fixit");
assert.strictEqual(JSON.stringify(lines.map((l) => [l.ok, l.why || ""])), JSON.stringify([[true, ""], [false, "a number"], [false, "an @"]]), "the designer is told which line and why");
console.log("design words tests passed");
