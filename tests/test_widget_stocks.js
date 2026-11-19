// The Markets widget (tv-home/web/widget-web.js reads Yahoo Finance's chart data through couch-tv's own
// relay, widgets.js draws it): a saved answer for the ASX 200, BHP, the Australian dollar and Bitcoin
// read into prices and today's move; one request for the whole watchlist every 10 minutes; every size
// draws real prices or an honest state; a design keeps only symbols, never a link. No live calls.
// Run: node tests/test_widget_stocks.js
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("Markets");
const NOW = Date.UTC(2026, 10, 18, 9, 0);
const T = K.home(NOW);
const WW = T.WW;

console.log("Running Markets tests...");

// ---------------- 1. reading the answer ----------------
const v = WW.parseSpark(K.fixture("yahoo-spark.json"));
const Q = v.quotes;
ok(Object.keys(Q).sort().join() === "AUDUSD=X,BHP.AX,BTC-AUD,^AXJO", "all four symbols read");
ok(Q["^AXJO"].name === "ASX 200" && Q["AUDUSD=X"].name === "AUD/USD" && Q["BTC-AUD"].name === "Bitcoin" && Q["BHP.AX"].name === "BHP", "plain names (BHP, not BHP GROUP FPO)");
ok(Q["^AXJO"].kind === "index" && Q["AUDUSD=X"].kind === "fx" && Q["BTC-AUD"].kind === "crypto" && Q["BHP.AX"].kind === "share", "what each one is");
ok(Object.keys(Q).every((s) => typeof Q[s].price === "number" && typeof Q[s].change === "number" && Q[s].points.length > 10), "a price, today's move and today's line for each");
ok(WW.price(Q["^AXJO"]) === "8,822" && WW.price(Q["AUDUSD=X"]) === "0.6726" && WW.price(Q["BHP.AX"]) === "$54.34" && WW.price(Q["BTC-AUD"]) === "$96,121", "prices the way people say them");
ok(WW.change(Q["BHP.AX"]) === "-0.07%" && WW.change({ change: 1.5 }) === "+1.50%" && WW.change({ change: 0 }) === "0.00%" && WW.change({ change: null }) === "", "the move with its sign");
ok(Math.abs(Q["BHP.AX"].change - (54.34 - 54.38) / 54.38 * 100) < 0.01, "the move is from yesterday's close");
ok(Object.keys(WW.parseSpark("not json").quotes).length === 0 && Object.keys(WW.parseSpark({ spark: { result: [{ symbol: "<b>", response: [{ meta: { regularMarketPrice: 1 } }] }, { symbol: "X.AX", response: [{ meta: {} }] }] } }).quotes).length === 0, "nothing from rubbish, a bad symbol or no price");
ok(WW.tickersOf(["bhp.ax", "BHP.AX", "https://x", "^axjo", "a b", "CBA.AX", "WES.AX", "CSL.AX", "NAB.AX", "ANZ.AX"]).join() === "BHP.AX,^AXJO,CBA.AX,WES.AX,CSL.AX,NAB.AX", "symbols made upper case, once each, links dropped, six at most");
ok(WW.tickersOf(undefined).join() === "^AXJO,AUDUSD=X,BTC-AUD" && WW.tickersOf(["http://x"]).join() === "^AXJO,AUDUSD=X,BTC-AUD", "no symbols: the ASX 200, the dollar and Bitcoin");

(async () => {
  // ---------------- 2. the loader: one request for the watchlist, through the relay ----------------
  const answer = () => K.fixture("yahoo-spark.json");
  const t = K.fakeTv(WW, { answer, now: NOW, widgets: [{ kind: "stocks", opts: { tickers: ["^AXJO", "BHP.AX"] } }, { kind: "stocks", opts: { tickers: ["^AXJO", "BHP.AX"] } }, { kind: "stocks", opts: {} }] });
  await t.L.tick();
  ok(t.asked.join() === "stocks:^AXJO,BHP.AX,stocks:^AXJO,AUDUSD=X,BTC-AUD", "one request per watchlist, the same list once (" + t.asked.join() + ")");
  t.now += 9 * 60000; await t.L.tick();
  ok(t.asked.length === 2, "not asked again within 10 minutes");
  t.now += 2 * 60000; await t.L.tick();
  ok(t.asked.length === 4, "asked again after 10 minutes");
  const nr = K.fakeTv(WW, { answer, relay: false, widgets: [{ kind: "stocks" }] });
  await nr.L.tick();
  ok(nr.asked.length === 0 && nr.L.data().stocks["^AXJO,AUDUSD=X,BTC-AUD"].err === "relay", "no relay: nothing asked, the widget is told why");
  const em = K.fakeTv(WW, { answer: () => "{\"spark\":{\"result\":[]}}", widgets: [{ kind: "stocks" }] });
  await em.L.tick();
  ok(em.L.data().stocks["^AXJO,AUDUSD=X,BTC-AUD"].err === "empty", "an answer with no prices: empty");

  // ---------------- 3. the widget at every size ----------------
  const key = "^AXJO,AUDUSD=X,BTC-AUD";
  const env = (r) => ({ data: { web: r === undefined ? {} : { stocks: { [key]: r } } } });
  const good = { ok: true, at: NOW, v };
  K.sizes(T.C, "stocks").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "stocks", w, h }, env(good));
    ok(!el.getAttribute("data-empty") && /ASX 200/.test(el.textContent) && /-2\.46%/.test(el.textContent), "stocks " + id + ": the real ASX 200 and its move");
    ok(!/8,412|142,310/.test(el.textContent), "stocks " + id + ": never the designer's demo prices on a TV");
    ok(/ASX 200/.test(T.W.render({ kind: "stocks", w, h }, { demo: true, designer: true }).textContent), "stocks " + id + ": the designer shows a demo watchlist");
  });
  const small = T.W.render({ kind: "stocks", w: 360, h: 360 }, env(good));
  ok(/8,822/.test(small.textContent) && /0\.6726/.test(small.textContent) && /\$96,121/.test(small.textContent), "small: all three, each with its price");
  const mine = T.W.render({ kind: "stocks", w: 360, h: 560, opts: { tickers: ["BHP.AX", "^AXJO"], label: "My shares" } }, { data: { web: { stocks: { "BHP.AX,^AXJO": good } } } });
  ok(/My shares/.test(mine.textContent) && mine.textContent.indexOf("BHP") < mine.textContent.indexOf("ASX 200"), "the design's own watchlist, in its order, and its label");
  const gone = T.W.render({ kind: "stocks", w: 360, h: 360, opts: { tickers: ["ZZZ.AX"] } }, { data: { web: { stocks: { "ZZZ.AX": good } } } });
  ok(gone.getAttribute("data-empty") === "1" && /None of these has a price/.test(gone.textContent), "symbols with no price: says so");
  // a tile has room for two or three words only: its own short line
  [[undefined, "Getting the prices", "Getting prices"], [{ ok: false, err: "failed", at: 1 }, "could not be read", "Prices failed"], [{ ok: false, err: "relay", at: 1 }, "need a home computer", "Needs set up"]].forEach(([r, says, short]) => K.sizes(T.C, "stocks").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "stocks", w, h }, env(r)), want = w < 300 || h < 200 ? short : says;
    ok(el.getAttribute("data-empty") === "1" && el.textContent.indexOf(want) >= 0, "stocks " + id + ": " + want);
  }));

  // ---------------- 4. the design and the setup record ----------------
  const CD = K.design();
  ok(JSON.stringify(K.kept(CD, "stocks", { tickers: ["bhp.ax", "^AXJO", "https://evil.example", "<b>", "AUDUSD=X"], label: "Shares" }).tickers) === '["BHP.AX","^AXJO","AUDUSD=X"]', "a design keeps symbols only, upper case");
  ok(K.kept(CD, "stocks", { tickers: "BHP.AX", url: "x" }).tickers === undefined, "a symbol list must be a list; other options are dropped");
  ok(T.C.get("stocks").status === "works" && T.C.need("stocks", "Google TV") === "works" && T.C.need("stocks", "Tizen") === "computer" && T.C.need("stocks", "VIDAA") === "computer" && T.C.need("stocks", "Roku OS") === "no", "widget-caps: works, honest platforms");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
