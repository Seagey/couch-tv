// The Headlines widget (tv-home/web/widget-web.js reads the feed, widgets.js draws it): saved sample
// feeds from ABC, The Guardian, BBC and SBS read into plain headlines; the loader asks the relay once
// per refresh, keeps the last answer, and says plainly when there is no relay or the feed failed; the
// widget draws real headlines at every size and an honest state otherwise; a design keeps only a feed
// from the list. No live calls.
// Run: node tests/test_widget_news.js
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("Headlines");
const T = K.home(Date.UTC(2026, 10, 18, 9, 0));
const WW = T.WW;

console.log("Running Headlines tests...");

// ---------------- 1. reading feeds ----------------
const feeds = { "rss-abc-top.xml": "ABC", "rss-guardian.xml": "Guardian", "rss-bbc.xml": "BBC", "rss-sbs.xml": "SBS" };
Object.keys(feeds).forEach((f) => {
  const items = WW.parseRss(K.fixture(f), 12);
  ok(items.length >= 5, feeds[f] + ": read " + items.length + " headlines");
  ok(items.every((x) => typeof x.title === "string" && x.title.length > 5 && !/[<>]|CDATA|&amp;|&#/.test(x.title)), feeds[f] + ": plain words, no markup or entities");
  ok(items.every((x) => x.at > Date.UTC(2026, 0, 1)), feeds[f] + ": every headline has its time");
});
ok(WW.parseRss(K.fixture("rss-bbc.xml"), 2).length === 2, "at most the number asked for");
ok(WW.parseRss("", 5).length === 0 && WW.parseRss("not a feed", 5).length === 0 && WW.parseRss(null, 5).length === 0, "nothing from nothing");
// Atom, entities, a dash, and markup that must stay words
const atom = '<feed><entry><title type="html">Rates &amp; prices &#8212; what&#x2019;s next</title><updated>2026-11-18T08:00:00Z</updated></entry>' +
  '<entry><title><![CDATA[<b>Bold</b> <script>alert(1)</script> claim]]></title></entry><entry><title>Rates &amp; prices &#8212; what&#x2019;s next</title></entry></feed>';
const a = WW.parseRss(atom, 5);
ok(a.length === 2 && a[0].title === "Rates & prices - what’s next" && a[0].at === Date.UTC(2026, 10, 18, 8), "Atom entries, entities decoded, an em dash made plain, the same headline once");
ok(a[1].title === "Bold alert(1) claim" && a[1].at === 0, "markup in a headline is dropped, the words kept, an unknown time is 0");
ok(WW.parseRss("<rss><item><title>" + "word ".repeat(60) + "</title></item></rss>")[0].title.length <= 160, "a very long headline is cut short");
ok(WW.ago(Date.UTC(2026, 10, 18, 8, 48), Date.UTC(2026, 10, 18, 9)) === "12 min ago" && WW.ago(Date.UTC(2026, 10, 18, 6), Date.UTC(2026, 10, 18, 9)) === "3 h ago" && WW.ago(0) === "", "how long ago, plain");
ok(WW.feedOf("bbc") === "bbc" && WW.feedOf("http://evil.example/rss") === "abc" && WW.feedOf(undefined) === "abc", "an unknown feed is ABC News");
ok(Object.keys(WW.FEEDS).every((k) => /^https:\/\/[a-z0-9.-]+\//.test(WW.FEEDS[k].url)), "every feed is https");

// ---------------- 2. the loader ----------------
(async () => {
  const answer = (src, id) => K.fixture(id === "bbc" ? "rss-bbc.xml" : "rss-abc-top.xml");
  let t = K.fakeTv(WW, { answer, widgets: [{ kind: "news", opts: { feed: "bbc" } }, { kind: "news", opts: { feed: "bbc" } }, { kind: "news", opts: {} }, { kind: "clock" }] });
  await t.L.tick();
  ok(t.asked.join() === "news:bbc,news:abc", "two news widgets on one feed ask once; ABC for the one with no feed; a clock asks nothing (" + t.asked.join() + ")");
  const bbc = t.L.data().news.bbc;
  ok(bbc.ok && bbc.v.length >= 5 && bbc.at === t.now, "the answer is kept with its time");
  ok(t.store && t.store.news && t.store.news.bbc.ok, "and saved on the TV for a reload");
  await t.L.tick();
  ok(t.asked.length === 2, "within 15 minutes nothing is asked again");
  t.now += 16 * 60000; t.fail = true;
  await t.L.tick();
  ok(t.asked.length === 4 && t.L.data().news.bbc.ok && t.L.data().news.bbc.stale, "after 15 minutes it asks again; a failure keeps the last headlines, marked stale");
  t.now += 60000; await t.L.tick();
  ok(t.asked.length === 4, "after a failure it waits a few minutes before asking again");
  t.now += 3 * 60000; t.fail = false; await t.L.tick();
  ok(t.asked.length === 6 && !t.L.data().news.bbc.stale, "then asks again, and a good answer is fresh");
  // a reload: the saved answer is used, nothing is asked while it is fresh
  const t2 = K.fakeTv(WW, { answer, store: t.store, widgets: [{ kind: "news", opts: { feed: "bbc" } }] });
  t2.now = t.now + 60000;
  await t2.L.tick();
  ok(t2.asked.length === 0 && t2.L.data().news.bbc.ok, "after a reload the saved headlines show and nothing is asked");
  // no relay on this TV (the website home with no computer): says so, never asks
  const t3 = K.fakeTv(WW, { answer, relay: false, widgets: [{ kind: "news", opts: {} }] });
  await t3.L.tick();
  ok(t3.asked.length === 0 && t3.L.data().news.abc.err === "relay", "no relay: nothing asked, and the widget is told why");
  // a feed that answers with nothing readable, and one that fails with nothing kept
  const t4 = K.fakeTv(WW, { answer: () => "<html>moved</html>", widgets: [{ kind: "news", opts: { feed: "sbs" } }] });
  await t4.L.tick();
  ok(t4.L.data().news.sbs.err === "empty", "a feed with no headlines: empty");
  const t5 = K.fakeTv(WW, { answer, widgets: [{ kind: "news", opts: {} }] }); t5.fail = true;
  await t5.L.tick();
  ok(t5.L.data().news.abc.err === "failed", "a feed that fails first time: failed");
  // no news widget on the home: nothing is asked at all
  const t6 = K.fakeTv(WW, { answer, widgets: [{ kind: "weather" }] });
  await t6.L.tick();
  ok(t6.asked.length === 0, "no news widget: no request");

  // ---------------- 3. the widget at every size ----------------
  const items = WW.parseRss(K.fixture("rss-abc-top.xml"), 12);
  const env = (rec) => ({ data: { web: rec === undefined ? {} : { news: { abc: rec } } } });
  const good = { ok: true, at: T.D.now(), v: items };
  K.sizes(T.C, "news").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "news", w, h }, env(good));
    ok(!el.getAttribute("data-empty") && (h < 200 ? items.slice(0, 5).some((x) => el.textContent.indexOf(x.title) >= 0) : el.textContent.indexOf(items[0].title) >= 0), "news " + id + ": shows the newest real headline (a wide tile: the newest of five that fits whole)");
    ok(/ABC News/.test(el.textContent), "news " + id + ": names the outlet");
    const d = T.W.render({ kind: "news", w, h }, { demo: true, designer: true });
    ok(/Coastal highway/.test(d.textContent), "news " + id + ": the designer shows demo headlines");
  });
  const tall = T.W.render({ kind: "news", w: 360, h: 560 }, env(good)), small = T.W.render({ kind: "news", w: 360, h: 360 }, env(good));
  const count = (el) => items.filter((x) => el.textContent.indexOf(x.title) >= 0).length;
  ok(count(tall) > count(small) && count(small) >= 2, "a tall box shows more headlines than a small one (" + count(tall) + " and " + count(small) + ")");
  const named = T.W.render({ kind: "news", w: 760, h: 360, opts: { feed: "bbc", label: "World" } }, { data: { web: { news: { bbc: good } } } });
  ok(/World/.test(named.textContent) && !/ABC/.test(named.textContent), "the design's own label names it");
  // a wide tile has room for two or three words only: its own short line
  const states = [[undefined, "Getting the headlines", "Getting news"], [{ ok: false, err: "failed", at: 1 }, "could not be read", "News failed"], [{ ok: false, err: "empty", at: 1 }, "No headlines", "No news"], [{ ok: false, err: "relay", at: 1 }, "need a home computer", "Needs set up"]];
  states.forEach(([rec, long, short]) => K.sizes(T.C, "news").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "news", w, h }, env(rec)), says = w < 300 || h < 200 ? short : long;
    ok(el.getAttribute("data-empty") === "1" && el.textContent.indexOf(says) >= 0 && el.textContent.indexOf(items[0].title) < 0, "news " + id + ": " + says + ", in its own box, nothing made up");
  }));
  ok(T.W.render({ kind: "news", w: 360, h: 360 }, env({ ok: false, err: "relay", at: 1 })).getAttribute("data-setup") === "news", "no relay: OK opens the setup steps");
  const stale = T.W.render({ kind: "news", w: 760, h: 360 }, env(Object.assign({}, good, { stale: true })));
  ok(/Not updated lately/.test(stale.textContent) && stale.textContent.indexOf(items[0].title) >= 0, "a stale answer still shows, and says it is not fresh");

  // ---------------- 4. the design and the setup record ----------------
  const CD = K.design();
  ok(K.kept(CD, "news", { feed: "guardian", label: "News" }).feed === "guardian", "a design keeps a feed from the list");
  const bad = K.kept(CD, "news", { feed: "https://evil.example/rss", url: "https://evil.example/rss", label: "x" });
  ok(bad.feed === undefined && bad.url === undefined, "a link as a feed, or any other option, is dropped");
  const c = T.C.get("news");
  ok(c.status === "works" && c.build === "", "widget-caps: Headlines works");
  ok(["android", "web", "vidaa"].every((g) => T.C.steps("news", g).length >= 3), "widget-caps: numbered steps for each kind of TV");
  ok(T.C.need("news", "Google TV") === "works" && T.C.need("news", "Tizen") === "computer" && T.C.need("news", "VIDAA") === "computer" && T.C.need("news", "Roku OS") === "no", "widget-caps: honest platforms");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
