// Each widget's own settings (docs/WIDGET-SETTINGS-CONTRACT.md, WIDGET-SETTINGS-SPEC.md section 5): every
// `settings` list in tv-home/web/widget-caps.js is well formed (keys, types, defaults, options, beginner
// words), every widget with a before launch setting in the spec has one, and a design kept key is one the
// TV's design sanitiser keeps (design.js WOPT).
// Run: node tests/test_ws_schema.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const web = path.join(__dirname, "../tv-home/web");
const CAPS = require(path.join(web, "widget-caps.js"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const isArr = Array.isArray;

console.log("Running widget settings schema tests...");

// the contract's types, plus the two the spec needs (tvlist: something kept on this TV; image: a photo
// put in the widget in Couch TV Studio)
const TYPES = ["place", "choice", "toggle", "text", "number", "app", "apps", "team", "device", "calendar", "tvlist", "image", "zone"];
const HA_DOMAINS = ["climate", "camera", "sensor", "light", "switch", "fan", "cover", "media_player", "scene", "script", "event", "binary_sensor"];
const TVLISTS = ["lists", "photos", "people", "calendars", "guide", "cards"];
const BANNED = /\b(beta|experimental|coming soon|adb|token|entity|entities|url|package|api)\b/i;
const DASH = /[–—]| - /;

// design.js WOPT: the keys a design may carry for each kind (anything else is dropped on the TV)
const DJ = fs.readFileSync(path.join(web, "design.js"), "utf8");
const WOPT = {};
const block = DJ.match(/var WOPT = \{([\s\S]*?)\n  \};/);
ok(!!block, "design.js has WOPT");
block[1].replace(/(\w+): "([^"]*)"/g, (m, k, v) => { WOPT[k] = v.split(/\s+/).filter(Boolean); });
DJ.replace(/WOPT\.(\w+) = "([^"]*)"/g, (m, k, v) => { WOPT[k] = v.split(/\s+/).filter(Boolean); });
// design keys this branch adds before design.js learns them (asked of the design.js owner)
const PENDING_WOPT = ["countdown.year", "timer.minutes", "hourly.hours", "news.count", "sports.games", "stocks.price"];

// the renderers (widgets.js R.<kind>)
const WJ = fs.readFileSync(path.join(web, "widgets.js"), "utf8");
const drawn = (k) => new RegExp("R\\." + k + " = |R\\[\"" + k + "\"\\] = ").test(WJ);

function wordsOk(s, where) {
  ok(typeof s === "string", where + " is words");
  ok(!DASH.test(s), where + " has no dash: " + s);
  ok(!BANNED.test(s), where + " has no jargon: " + s);
  ok(!/couch-tv (says|keeps|shows|looks)/.test(s), where + " names Couch TV as Couch TV: " + s);
}
const valOf = (o) => o[0];
const sameVal = (a, b) => a === b;

let total = 0;
CAPS.kinds().forEach((kind) => {
  const list = CAPS.settings(kind);
  ok(isArr(list), kind + ": settings is a list");
  const keys = {};
  list.forEach((s) => {
    total++;
    const at = kind + "." + s.key;
    ok(typeof s.key === "string" && /^[a-z][a-z0-9_]{0,23}$/.test(s.key), at + ": key is short letters and digits");
    ok(!keys[s.key], at + ": key used once");
    keys[s.key] = s;
    ok(TYPES.indexOf(s.type) >= 0, at + ": type " + s.type);
    ok(typeof s.label === "string" && s.label.trim().length > 0 && s.label.length <= 40, at + ": label");
    ok(/^[A-Z0-9]/.test(s.label), at + ": label starts with a capital");
    ok(s.label.split(" ").slice(1).every((w) => !/^[A-Z]/.test(w) || ["TV", "Couch", "Studio", "Home", "Assistant"].indexOf(w) >= 0), at + ": label in sentence case");
    wordsOk(s.label, at + " label");
    ok(typeof s.help === "string" && s.help.length <= 200, at + ": help is one line");
    if (s.help) { wordsOk(s.help, at + " help"); ok(/[.?]$/.test(s.help), at + ": help ends with a full stop"); }
    ok("default" in s, at + ": has a default");
    ok(s.store === "design" || s.store === "tv", at + ": store");
    ok(isArr(s.where) && s.where.length > 0 && s.where.every((w) => ["studio", "tv", "phone"].indexOf(w) >= 0), at + ": where");
    ok(typeof s.pre === "boolean", at + ": pre");
    // kept on the TV: never offered in Studio, never in a design
    if (s.store === "tv") ok(s.where.indexOf("studio") < 0, at + ": a TV setting is not offered in Studio");
    if (s.private) ok(s.store === "tv", at + ": a private setting stays on the TV");
    // a design key is one the TV keeps
    if (s.store === "design") {
      const dk = s.sets || s.key;
      ok((WOPT[kind] || []).indexOf(dk) >= 0 || PENDING_WOPT.indexOf(kind + "." + dk) >= 0, at + ": " + dk + " is a design key the TV keeps (design.js WOPT " + kind + ")");
    }
    const d = s["default"];
    switch (s.type) {
      case "choice":
        ok(isArr(s.options) && s.options.length >= 2, at + ": options");
        s.options.forEach((o) => {
          ok(isArr(o) && o.length === 2 && ["string", "number", "boolean"].indexOf(typeof o[0]) >= 0, at + ": option is [value, label]");
          ok(typeof o[1] === "string" && o[1].length > 0, at + ": option label");
          wordsOk(o[1], at + " option");
        });
        ok(new Set(s.options.map(valOf)).size === s.options.length, at + ": option values differ");
        if (s.many) ok(isArr(d) && typeof s.max === "number" && d.length <= s.max && d.every((v) => s.options.some((o) => sameVal(o[0], v))), at + ": several picked, from the options, up to max");
        else ok(s.options.some((o) => sameVal(o[0], d)), at + ": default is one of the options");
        break;
      case "toggle": ok(typeof d === "boolean", at + ": toggle default is on or off"); break;
      case "number":
        ok(typeof s.min === "number" && typeof s.max === "number" && typeof s.step === "number" && s.min < s.max && s.step > 0, at + ": min max step");
        ok(typeof d === "number" && d >= s.min && d <= s.max, at + ": default in range");
        break;
      case "text":
        if (s.many) {
          ok(isArr(d) && typeof s.max === "number" && d.length <= s.max, at + ": a list of words, up to max");
          if (s.suggest) s.suggest.forEach((o) => { ok(isArr(o) && typeof o[0] === "string" && typeof o[1] === "string", at + ": suggestion"); wordsOk(o[1], at + " suggestion"); });
        } else ok(typeof d === "string" && (!s.max || d.length <= s.max), at + ": text default");
        break;
      case "place": ok(d === "" || (d && typeof d.name === "string"), at + ": place default empty (this home's town or none)"); break;
      case "device":
        [].concat(s.domain).forEach((dm) => ok(HA_DOMAINS.indexOf(dm) >= 0, at + ": domain " + dm));
        ok(s.needs && s.needs.ha === true, at + ": needs Home Assistant");
        if (s.many) ok(isArr(d) && typeof s.max === "number", at + ": many devices");
        else ok(d === "", at + ": one device, empty is the first");
        break;
      case "tvlist": ok(TVLISTS.indexOf(s.from) >= 0 && (s.many ? isArr(d) && typeof s.max === "number" : typeof d === "string"), at + ": tvlist from " + s.from + (s.many ? ", several picked: a list" : "")); break;
      case "image": ok(d === "" && s.store === "design", at + ": a photo in the widget lives in the design"); break;
      case "zone": ok(d === "" && s.store === "design" && s.where.indexOf("tv") < 0, at + ": a time zone, empty is the TV's own, kept in the design, never picked with the remote"); break;
      case "team":
        ok(typeof d === "string", at + ": team default");
        ok(keys[s.league] && keys[s.league].type === "choice", at + ": team names its competition setting");
        break;
      case "apps": ok(isArr(d), at + ": apps default is a list"); break;
      case "app": case "calendar": ok(typeof d === "string", at + ": default"); break;
    }
    if (s.needs) {
      ok(typeof s.needs === "object", at + ": needs");
      if (s.needs.apps) ok(isArr(s.needs.apps) && s.needs.apps.length > 0, at + ": needs apps");
    }
  });
  // `when` names a sibling setting
  list.forEach((s) => { if (s.when) Object.keys(s.when).forEach((k) => ok(!!keys[k], kind + "." + s.key + ": when names " + k)); });
});

// every kind with a before launch setting in WIDGET-SETTINGS-SPEC.md section 2 (the P items) has it,
// marked pre, and is a kind the TV draws
const PRE = {
  clock: ["format"], tallclock: ["format"], glassclock: ["format"], flipclock: ["format"],
  countdown: ["label", "day", "month", "year"], weather: ["place", "hilo", "town", "degrees"], bigtemp: ["place", "town", "degrees"],
  hourly: ["town", "hours", "degrees"], rain: ["town"], uv: ["town"], sun: ["town"], moon: ["hemi"], air: ["town", "scale"],
  surf: ["place", "units", "wind"], photo: ["photo", "image"], artframe: ["photo", "image"], upnext: ["sport"],
  aircon: ["entity", "others"], controls: ["switches"], camera: ["cam", "label"], sensor: ["reading", "label"],
  doorbell: ["label", "picture"], energy: ["label", "now"], list: ["list"], news: ["feed"], sports: ["league", "team"],
  stocks: ["tickers"], commute: ["to", "arrive_h"], bins: ["weekday", "alt", "thisweek", "bin_a", "bin_b", "lid_a", "lid_b"],
  // the smart home group (ws2): every setting wired and before launch
  speakers: ["players"], scenes: ["scenes"], battery: ["low"], solar: ["town"]
};
Object.keys(PRE).forEach((kind) => {
  ok(!!CAPS.get(kind), kind + " has a caps record");
  ok(drawn(kind), kind + " is drawn by widgets.js");
  PRE[kind].forEach((key) => {
    const s = CAPS.settings(kind).find((x) => x.key === key);
    ok(!!s, kind + " has the setting " + key);
    ok(s.pre === true, kind + "." + key + " is marked before launch");
  });
});
// the spec's own example: the surf beach is a coast place kept on the TV
const beach = CAPS.settings("surf")[0];
ok(beach.key === "place" && beach.type === "place" && beach.coast === true && beach.store === "tv", "surf: the beach is picked on the TV");
// the TV and the design agree on the web widgets' fixed lists (widget-web.js)
const WW = fs.readFileSync(path.join(web, "widget-web.js"), "utf8");
CAPS.settings("news")[0].options.forEach((o) => { if (o[0] !== "auto") ok(WW.indexOf("\"" + o[0] + "\": {") >= 0 || WW.indexOf(" " + o[0] + ": {") >= 0, "news source " + o[0] + " is a feed the TV reads"); });
CAPS.settings("sports")[0].options.forEach((o) => ok(new RegExp("\\b" + o[0] + ": \\{ name: \"" + o[1] + "\"").test(WW), "competition " + o[0] + " is " + o[1] + " on the TV"));
// the family, guest and photo widgets (ws2 home): every setting wired, so every one before launch, none
// left for later (agenda's calendars and days included), each a design key design.js keeps or a TV one
const HOME = {
  agenda: ["calendars", "days"], people: ["who", "names"], note: ["byline"], list: ["list", "done"], guide: ["sections"],
  welcome: ["text", "sub", "source", "times"], memory: ["range", "ago"], screentime: ["appcount"], wifi: ["hidepass"],
  card: ["label", "text", "live"], photo: ["photo", "image", "fit"], slideshow: ["seconds_each", "shuffle"], mosaic: ["count"], artframe: ["photo", "image", "mat"]
};
Object.keys(HOME).forEach((kind) => {
  const list = CAPS.settings(kind);
  ok(drawn(kind), kind + " is drawn by widgets.js");
  ok(JSON.stringify(list.map((s) => s.key)) === JSON.stringify(HOME[kind]), kind + ": settings are " + HOME[kind].join(", ") + " (" + list.map((s) => s.key).join(", ") + ")");
  list.forEach((s) => {
    ok(s.pre === true, kind + "." + s.key + " is on before launch (no later)");
    if (s.store === "design") ok((WOPT[kind] || []).indexOf(s.sets || s.key) >= 0, kind + "." + s.key + " is in design.js WOPT itself, not pending");
  });
});
ok(!Object.keys(HOME).some((k) => ["surf", "commute", "weather", "speakers", "sports"].indexOf(k) >= 0), "no home kind in the later list");
// the later settings (L items) are there too, after the before launch ones
const LATER = {};
// the smart home group: nothing left for later (the owner, 20 Nov 2026: there is no "later")
["aircon", "controls", "camera", "doorbell", "sensor", "energy", "solar", "battery", "speakers", "scenes", "bins"].forEach((kind) => {
  ok(CAPS.settings(kind).length > 0, kind + " has something to set");
  CAPS.settings(kind).forEach((s) => ok(s.pre === true, kind + "." + s.key + " is wired and before launch"));
});
Object.keys(LATER).forEach((kind) => {
  const list = CAPS.settings(kind), firstLater = list.findIndex((s) => !s.pre);
  ok(list.slice(firstLater).every((s) => !s.pre), kind + ": before launch settings come first");
  LATER[kind].forEach((key) => ok(list.some((s) => s.key === key && s.pre === false), kind + " has the later setting " + key));
});
// Roku and Apple TV draw some kinds themselves: those work there, every other kind is not on that TV
["Roku OS", "tvOS"].forEach((p) => {
  const drawnThere = CAPS.native(p);
  ok(drawnThere.length >= 20 && CAPS.groupOf(p) === "native", p + " is a native group");
  CAPS.kinds().forEach((k) => {
    const need = CAPS.need(k, p), steps = CAPS.steps(k, p);
    if (drawnThere.indexOf(k) < 0) ok(need === "no" && steps.length === 1, k + " is not on " + p);
    else ok(need !== "no" && steps.length >= 1 && !/^Shows on Google TV/.test(steps[0]), k + " shows on " + p);
  });
});
// no Home settings and no Hold OK menu there: no step sends the person to them
["Roku OS", "tvOS"].forEach((p) => CAPS.kinds().forEach((k) => CAPS.steps(k, p).forEach((s) => {
  ok(!/hold OK/i.test(s) && s.indexOf("Home settings, Couch TV Studio") < 0 && s.indexOf("Home settings") < 0, k + " on " + p + ": no TV menu it lacks: " + s);
})));
ok(/star button/.test(CAPS.steps("countdown", "Roku OS").join(" ")) && /Settings, Home design/.test(CAPS.steps("countdown", "tvOS").join(" ")), "a design reaches a Roku and an Apple TV by their own code screens");
["photo", "artframe"].forEach((k) => ["Roku OS", "tvOS"].forEach((p) => {
  ok(CAPS.need(k, p) === "setup" && /photo put in the widget/.test(CAPS.get(k).platforms[p].note), k + " on " + p + ": only the photo put in the widget");
  ok(/put one photo in it/.test(CAPS.steps(k, p).join(" ")), k + " on " + p + ": the steps put a photo in the widget");
}));
// `when: { key: "set" }` means while that setting differs from its own default
CAPS.kinds().forEach((k) => CAPS.settings(k).forEach((s) => {
  if (!s.when) return;
  Object.keys(s.when).forEach((wk) => {
    const other = CAPS.settings(k).find((x) => x.key === wk);
    if (s.when[wk] === "set") ok(other && other["default"] !== undefined && other["default"] !== "set", k + "." + s.key + ": shown once " + wk + " is changed from its default");
    else ok(other && (other.type !== "choice" || other.options.some((o) => o[0] === s.when[wk])) && (other.type !== "toggle" || typeof s.when[wk] === "boolean"), k + "." + s.key + ": when value is one " + wk + " can have");
  });
}));
// anything about this house is private: the devices, lists, photos, people, calendars and places
CAPS.kinds().forEach((k) => CAPS.settings(k).forEach((s) => {
  if (["device", "tvlist", "place", "calendar"].indexOf(s.type) >= 0) ok(s.private === true, k + "." + s.key + " is private");
}));
ok(CAPS.settings("bins").find((s) => s.key === "weekday")["default"] === "none", "bins: no bin night until one is picked");
ok(CAPS.settings("countdown").find((s) => s.key === "year").options.slice(1).every((o) => typeof o[0] === "number"), "countdown: years are numbers");
ok(!CAPS.settings("list").some((s) => s.key === "label"), "list: draws its own name, no heading");
// the kinds each native TV draws (DesignLib.brs dlWNative, DesignModel.swift DesignWidgets.native)
const ROOT = path.join(__dirname, "..");
const brs = fs.readFileSync(path.join(ROOT, "roku/channel/components/DesignLib.brs"), "utf8").match(/function dlWNative[\s\S]*?\[([^\]]*)\]/)[1];
// plus the smart stack, which Roku draws one widget at a time, the next each minute (the top of dlWidget)
ok(/if kind = "stack"[\s\S]{0,400}?at = \(nw\.h \* 60 \+ nw\.mi\) mod n\s+first = \{\}\s+first\.append\(o\.items\[at\]\)/.test(fs.readFileSync(path.join(ROOT, "roku/channel/components/DesignLib.brs"), "utf8")), "Roku's dlWidget handles a smart stack");
ok(JSON.stringify(JSON.parse("[" + brs + "]").concat(["stack"]).sort()) === JSON.stringify(CAPS.native("Roku OS").sort()), "the Roku list matches DesignLib.brs, plus the stack");
const swift = fs.readFileSync(path.join(ROOT, "tvos/CouchTV/DesignModel.swift"), "utf8").match(/static let native: Set<String> = \[([^\]]*)\]/)[1];
ok(JSON.stringify(JSON.parse("[" + swift + "]").sort()) === JSON.stringify(CAPS.native("tvOS").sort()), "the Apple TV list matches DesignModel.swift");
// a kind with no settings says so with an empty list
ok(isArr(CAPS.settings("stack")) && CAPS.settings("nope").length === 0, "no settings is an empty list");

console.log("  " + total + " settings on " + CAPS.kinds().filter((k) => CAPS.settings(k).length).length + " kinds");
console.log("All " + n + " checks passed.");
