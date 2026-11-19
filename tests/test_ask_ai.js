// Ask AI and From your AI (tv-home/web/ask.js): who answers, where the key may go, what is sent, what
// is shown, and what an agent can make the TV do. No network: every request is answered here.
// Run: node tests/test_ask_ai.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "../tv-home/web");
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// a TV page: localStorage, the launcher's private store (or none), and an XMLHttpRequest that answers
// from `routes` and records what was sent
function page(search, opts) {
  opts = opts || {};
  const store = {}, priv = {}, sent = [];
  const routes = opts.routes || {};
  function XHR() { this.headers = {}; }
  XHR.prototype.open = function (m, u) { this.method = m; this.url = u; };
  XHR.prototype.setRequestHeader = function (k, v) { this.headers[k.toLowerCase()] = v; };
  XHR.prototype.send = function (body) {
    const me = this;
    sent.push({ method: me.method, url: me.url, headers: me.headers, body: body ? JSON.parse(body) : null });
    const key = Object.keys(routes).find((k) => me.url.indexOf(k) >= 0);
    setTimeout(() => {
      if (!key) { me.onerror && me.onerror(); return; }
      const r = typeof routes[key] === "function" ? routes[key](me, body ? JSON.parse(body) : null) : routes[key];
      me.status = r[0]; me.responseText = typeof r[1] === "string" ? r[1] : JSON.stringify(r[1]); me.onload();
    }, 0);
  };
  const sb = {
    location: { search: search || "", origin: "http://tv", reload() { sb.reloaded = (sb.reloaded || 0) + 1; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    XMLHttpRequest: XHR, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, Promise, JSON,
    addEventListener() {}
  };
  if (opts.tvos) sb.TVOS = { keepPrivate: (k, v) => { if (v === "") delete priv[k]; else priv[k] = v; }, keptPrivate: (k) => (k in priv ? priv[k] : null), keep() {} };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(web, "ask.js"), "utf8"), sb);
  return { A: sb.CouchAsk, sb, store, priv, sent };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  console.log("Running Ask AI tests...");

  // 1. addresses: https, or plain http only on the home network, never the TV itself
  {
    const { A } = page("?offline=1");
    const bp = A._test.baseProblem;
    ok(bp("https://api.anthropic.com") === "", "https is fine");
    ok(bp("http://my-computer.local:11434/v1") === "", "a computer at home over http is fine");
    ok(A._test.isLocalHost("my-computer.local") && !A._test.isLocalHost("198.51.100.7") && /https/.test(bp("http://198.51.100.7/v1")), "a .local name is home, a public number is not");
    ok(/https/.test(bp("http://api.openai.com/v1")), "plain http to the internet is refused");
    ok(/this TV/.test(bp("http://localhost:11434/v1")) && /this TV/.test(bp("http://127.0.0.1:5400")), "the TV itself is refused");
    ok(/name or password/.test(bp("https://me:pw@example.com/v1")), "no name or password in the address");
    ok(bp("https://x.example/v1?key=1") !== "" && bp("https://x.example/#a") !== "", "no ? or #");
  }

  // 2. the key is kept with its address, privately on an Android TV, and dropped when the address changes
  {
    const { A, store, priv } = page("?offline=1", { tvos: true });
    A.save({ provider: "openai" });
    A.save({ model: "gpt-test", key: "sk-test-EXAMPLE" });
    let s = A.status();
    ok(s.ready && s.route === "own" && s.hasKey, "OpenAI with a model and a key is ready");
    ok(priv["couchtv.ask.key"] === "sk-test-EXAMPLE", "the key is in the launcher's private store");
    ok(!JSON.stringify(store).includes("sk-test-EXAMPLE"), "never in the page's own storage");
    ok(!JSON.stringify(s).includes("sk-test"), "status never says the key");
    A.save({ base: "https://other.example/v1" });
    s = A.status();
    ok(!s.hasKey && !s.ready, "a new address without a new key: the old key is gone");
    ok(!("couchtv.ask.key" in priv), "and deleted");
    A.forget();
    ok(!A.status().provider, "Remove forgets everything");
  }

  // 3. what is sent: only to the saved service, with the right shape for each wire
  {
    const { A } = page("?offline=1");
    const c = { provider: "anthropic", base: "https://api.anthropic.com", model: "claude-haiku-5-5" };
    const r = A._test.request(c, "k1", "Is it going to rain?");
    ok(r.url === "https://api.anthropic.com/v1/messages", "Claude: the Messages API");
    ok(r.headers["x-api-key"] === "k1" && r.headers["anthropic-version"] && r.headers["anthropic-dangerous-direct-browser-access"] === "true", "Claude: its own key header, from a page");
    ok(r.body.model === "claude-haiku-5-5" && r.body.messages[0].content === "Is it going to rain?" && r.body.system === A._test.SYSTEM, "Claude: the question and the plain answer rules");
    const o = A._test.request({ provider: "local", base: "http://my-computer.local:11434/v1", model: "llama3.2" }, "", "Hi");
    ok(o.url === "http://my-computer.local:11434/v1/chat/completions" && !o.headers.authorization, "a model at home: chat completions, no key");
    const g = A._test.request({ provider: "gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-x" }, "gk", "Hi");
    ok(g.headers.authorization === "Bearer gk" && g.body.messages[0].role === "system", "Gemini: OpenAI compatible, bearer key");
  }

  // 4. asking your own service: the answer, in plain words, and the service's own error only
  {
    const routes = { "api.anthropic.com/v1/messages": [200, { content: [{ type: "text", text: "**About 384,000 km** — see https://nasa.gov" }] }] };
    const { A, sent } = page("?offline=1", { routes });
    A.save({ provider: "anthropic", key: "sk-ant-x" });
    const r = await A.ask("How far is the moon?");
    ok(r.a === "About 384,000 km ,  see" || /^About 384,000 km/.test(r.a), "the answer arrives");
    ok(!/\*|https?:|—/.test(r.a), "no markdown, no links, no long dashes on the TV");
    ok(sent.length === 1 && sent[0].url.indexOf("https://api.anthropic.com/") === 0, "asked only the saved service");
    ok(A.last().q === "How far is the moon?" && !A.last().pending, "the widget has the question and the answer");
    const bad = page("?offline=1", { routes: { "api.openai.com": [401, { error: { message: "Incorrect API key provided: sk-...abcd" } }] } });
    bad.A.save({ provider: "openai" }); bad.A.save({ model: "m", key: "sk-bad" });
    let msg = "";
    await bad.A.ask("hi").catch((e) => { msg = e.message; });
    ok(/refused the key/.test(msg) && msg.length < 260, "a refused key says so, with the service's own sentence");
    const odd = page("?offline=1", { routes: { "api.openai.com": [200, "<html>gateway</html>"] } });
    odd.A.save({ provider: "openai" }); odd.A.save({ model: "m", key: "k" });
    msg = ""; await odd.A.ask("hi").catch((e) => { msg = e.message; });
    ok(/does not understand/.test(msg) && !/gateway/.test(msg), "an answer in another shape quotes nothing from it");
  }

  // 5. couch-tv at home: the home computer's or the TV app's /api/ask, with the pairing key
  {
    const routes = { "/api/ask": (x, b) => [200, { ok: true, reply: "Bluey is on ABC iview.", say: "Bluey is on ABC iview." }] };
    const { A, sent } = page("?api=http%3A%2F%2Fbridge%3A5400&key=PAIRING-KEY-EXAMPLE", { routes });
    ok(A.status().ready && A.status().route === "home", "with a home computer and nothing else set up, it answers");
    const r = await A.ask("Where is Bluey?");
    ok(r.a === "Bluey is on ABC iview.", "the home's answer shows");
    ok(sent[0].url === "http://bridge:5400/api/ask" && sent[0].headers.authorization === "Bearer PAIRING-KEY-EXAMPLE", "asked the home with its pairing key");
    const off = page("?api=http%3A%2F%2Fbridge%3A5400", { routes: { "/api/ask": [409, { ok: false, error: "off" }] } });
    let msg = ""; await off.A.ask("hi").catch((e) => { msg = e.message; });
    ok(/switched off/.test(msg) && /own AI service/.test(msg), "the home's Claude switched off says what to do");
  }

  // 6. what the TV hears from the home (GET /api/say): an answer from the phone, a message, a design
  {
    const got = [];
    const { A, sb, store } = page("?api=http%3A%2F%2Fbridge%3A5400", {});
    sb.CouchDesignCode = { readCode: (c) => (/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c) ? c : ""), get: (c) => { got.push(c); return Promise.resolve(); } };
    const now = 1800000000000;
    // couch-tv Studio is opt in: never chosen, or switched off, an agent's design is not used, and the
    // choice is left exactly as it was
    A._test.took({ design: { code: "ABCDE-FGHJK", at: now - 450 } }, now);
    ok(got.length === 0 && !("tvhome.designer" in store), "Studio never turned on: the design is not fetched and Studio stays as it was");
    A._test.reset();
    store["tvhome.designer"] = JSON.stringify("on"); store["couchtv.design.off"] = "1";
    A._test.took({ design: { code: "ABCDE-FGHJK", at: now - 450 } }, now);
    ok(got.length === 0 && store["couchtv.design.off"] === "1", "designs switched off: not fetched, and the off is not cleared");
    delete store["couchtv.design.off"];
    A._test.reset();
    A._test.took({ ask: { q: "what's on", a: "Bluey", at: now - 1000, by: "Claude on the home computer" }, message: { text: "Dinner is ready", from: "Claude", at: now - 500, seconds: 20 }, design: { code: "ABCDE-FGHJK", at: now - 400 } }, now);
    ok(A.last().a === "Bluey" && A.last().by === "Claude on the home computer", "an answer asked from the phone shows on the TV");
    ok(A.message().text === "Dinner is ready" && A.message().from === "Claude", "the agent's message is kept for the widget");
    ok(got[0] === "ABCDE-FGHJK", "a design code is fetched the way a typed one is");
    await tick(); await new Promise((r) => setTimeout(r, 900));
    ok(store["tvhome.designer"] === JSON.stringify("on") && sb.reloaded === 1, "Studio on at this TV: the page starts again and asks Use this design? first");
    A._test.took({ design: { code: "ABCDE-FGHJK", at: now - 400 } }, now + 6000);
    ok(got.length === 1, "the same design is not fetched twice");
    A._test.took({ design: { code: "ABCDE-FGHJK", at: now - 3600000 } }, now);
    ok(got.length === 1, "an old one is not fetched");
  }

  // 6b. opt in: the home computer is asked for messages only once Ask AI is set up on this TV (or its
  // sheet is open, or an Ask AI or From your AI widget is on the home)
  {
    const { A } = page("?api=http%3A%2F%2Fbridge%3A5400", {});
    ok(A._test.wanted() === false, "a bridge home with nothing set up never asks GET /api/say");
    A.save({ provider: "local", base: "http://my-computer.local:11434/v1", model: "llama3.2" });
    ok(A._test.wanted() === true, "Ask AI set up on this TV: it asks");
  }

  // 7. a model at home is the only plain http address the design page lets the TV ask
  {
    const { A, sb } = page("?offline=1");
    A.save({ provider: "local", base: "http://my-computer.local:11434/v1", model: "llama3.2" });
    ok(A.connectOrigin() === "http://my-computer.local:11434", "a model at home's address");
    ok(A.status().ready && !A.status().needsKey, "needs no key");
    const dg = { location: { search: "" }, document: null, CouchAsk: A };
    dg.window = dg; vm.createContext(dg);
    vm.runInContext(fs.readFileSync(path.join(web, "designer-gate.js"), "utf8"), dg);
    ok(dg.CouchDesigner.policy("").includes("connect-src 'self' https: http://my-computer.local:11434"), "the design page policy allows that one address");
    A.save({ provider: "openai" });
    ok(A.connectOrigin() === "" && !dg.CouchDesigner.policy("").includes("my-computer.local"), "and only while it is the one in use");
    void sb;
  }

  // 8. the services offered, and words with no dashes or coming soon talk
  {
    const { A } = page("?offline=1");
    const ids = A.providers().map((p) => p.id);
    ["anthropic", "openai", "gemini", "openrouter", "groq", "mistral", "local", "other"].forEach((id) => ok(ids.indexOf(id) >= 0, id + " is offered"));
    const src = fs.readFileSync(path.join(web, "ask.js"), "utf8") + fs.readFileSync(path.join(web, "ask.css"), "utf8");
    ok(!/[–—]/.test(src.replace(/\\u201[34]/g, "")), "no long dashes");
    ok(!/coming soon|\bbeta\b|not yet|experimental/i.test(src), "no coming soon words");
  }

  // 9. widget-caps.js: both widgets are real, with steps on every TV that draws designs
  {
    const C = require(path.join(web, "widget-caps.js"));
    ["ask", "agent", "battery"].forEach((k) => {
      const c = C.get(k);
      ok(c && c.status !== "not-built", k + " is built");
      ["android", "web", "vidaa"].forEach((g) => ok(C.steps(k, g).length > 0, k + " has steps on " + g));
    });
    ok(C.kinds().every((k) => C.get(k).status !== "not-built"), "no widget is left unbuilt");
    ok(C.get("card").status === "works" && C.get("card").platforms["Tizen"].need !== "no", "a typed custom card works on every TV that draws designs");
  }

  console.log("Ask AI tests passed: " + n);
})().catch((e) => { console.error(e); process.exit(1); });
