// Nothing that opens the house (owner's rule): every copy of the house test answers the same for every
// id in tests/fixtures/opens_house_ids.json. Here the two page copies (smarthome.js and widgets.js, which
// have no lookbehind for older TV browsers) and the bridge's and home-config.py's (run through python3).
// The Android copy has the same table in HomeAssistantTest.
//   node tests/test_opens_house.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const T = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/opens_house_ids.json"), "utf8"));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
console.log("Running the house test on every copy (" + T.refuse.length + " refused, " + T.pass.length + " let through)...");

// the function as written in each page file, run on its own
function pageCopy(file) {
  const src = fs.readFileSync(path.join(ROOT, "tv-home/web", file), "utf8");
  const m = src.match(/function opensHouse\(e\) \{[\s\S]*?\n  \}/);
  assert.ok(m, file + " has opensHouse");
  return vm.runInNewContext("(" + m[0] + ")");
}
for (const file of ["smarthome.js", "widgets.js"]) {
  const f = pageCopy(file);
  T.refuse.forEach((e) => ok(f(e) === true, file + " refuses " + e));
  T.pass.forEach((e) => ok(f(e) === false, file + " lets " + e + " through"));
  ["lock.front", "alarm_control_panel.home"].forEach((e) => ok(f(e) === true, file + " refuses " + e));
  ok(f("switch." + "outdoor_".repeat(40)) === false, file + ": a long id is answered");
}
// the two page copies are the same text
ok(pageCopy("smarthome.js").toString() === pageCopy("widgets.js").toString(), "smarthome.js and widgets.js have the same house test");

// the bridge (bridge/smarthome.py) and home-config.py, through python3
const py = `
import ast, json, re, sys
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "bridge"))})
import smarthome
# home-config.py runs when imported: its OPENS_THE_HOUSE line, read as written
src = open(${JSON.stringify(path.join(ROOT, "tv-home/tools/home-config.py"))}).read()
head = "OPENS_THE_HOUSE = re.compile("
line = [x for x in src.splitlines() if x.startswith(head)][0]
HC = re.compile(ast.literal_eval(line[len(head):-1]))
t = json.load(open(${JSON.stringify(path.join(__dirname, "fixtures/opens_house_ids.json"))}))
out = {}
for e in t["refuse"] + t["pass"]:
    out[e] = [bool(smarthome.OPENS_HOUSE.fullmatch(e)), bool(HC.search(e))]
print(json.dumps(out))`;
const res = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
T.refuse.forEach((e) => { ok(res[e][0], "bridge refuses " + e); ok(res[e][1], "home-config.py refuses " + e); });
T.pass.forEach((e) => { ok(!res[e][0], "bridge lets " + e + " through"); ok(!res[e][1], "home-config.py lets " + e + " through"); });
console.log("All " + n + " house test checks passed.");
