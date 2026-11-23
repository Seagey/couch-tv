// The Scores widget (tv-home/web/widget-web.js reads ESPN's public scoreboards, widgets.js draws them):
// saved AFL, NRL, A-League, Premier League, NBA and cricket answers read into games; live games first,
// then the household's team; the loader asks every 2 minutes while a game is on and every 15
// otherwise; every size draws real games or an honest state; a design keeps only a league from the
// list. No live calls.
// Run: node tests/test_widget_sports.js
const K = require("./web-widgets-kit");
const { ok, done } = K.counter("Scores");
const NOW = Date.UTC(2026, 10, 18, 9, 0);
const T = K.home(NOW);
const WW = T.WW;

console.log("Running Scores tests...");

// ---------------- 1. reading the scoreboards ----------------
const read = (l) => WW.parseScores(K.json("espn-" + l + ".json"), l);
["afl", "nrl", "aleague", "epl", "nba"].forEach((l) => {
  const r = read(l);
  ok(r.games.length >= 1 && r.league === WW.LEAGUES[l].name, l + ": read " + r.games.length + " games");
  ok(r.games.every((g) => g.teams.length === 2 && g.teams.every((t) => t.name && t.abbr && /^(#[0-9a-f]{6})?$/.test(t.colour)) && ["pre", "in", "post"].indexOf(g.state) >= 0 && g.at > 0), l + ": every game has two named teams, a state and a time");
  ok(r.games.every((g) => g.teams[0].home), l + ": the home team first");
  ok(r.games.every((g) => g.state !== "pre" || g.teams.every((t) => t.score === "")), l + ": a game not started has no score");
});
ok(read("afl").round === "Round 1" && read("nrl").round === "Round 4" && read("epl").round === "", "AFL and NRL say the round; the rest do not");
const nrl = read("nrl").games[0];
ok(nrl.state === "post" && nrl.teams[0].name === "Roosters" && nrl.teams[0].score === "19" && nrl.teams[0].win && !nrl.teams[1].win, "NRL: the result and the winner");
const nba = read("nba").games;
ok(nba.some((g) => g.state === "post" && g.teams.some((t) => t.win)), "NBA: finished games with a winner");
// cricket: internationals and Australian competitions only, Australia first
const cr = K.json("espn-cricket.json");
const aus = JSON.parse(JSON.stringify(cr.sports[0].leagues.filter((l) => l.events[0].class.internationalClassId !== "0")[0])); aus.name = "England tour of Australia"; aus.events = [JSON.parse(JSON.stringify(aus.events[0]))];
aus.events[0].id = "x1"; aus.events[0].competitors[0].displayName = "Australia"; aus.events[0].competitors[0].abbreviation = "AUS"; aus.events[0].competitors[1].displayName = "England"; aus.events[0].date = "2026-11-10T00:00:00Z";
cr.sports[0].leagues.push(aus);
const c = WW.parseScores(cr, "cricket");
ok(c.games.length >= 2 && c.games[0].teams[0].name === "Australia", "cricket: Australia's match comes first, even when older");
ok(c.games.every((g) => !/Region|Islamabad|FATA/.test(g.teams[0].name + g.teams[1].name)), "cricket: other countries' domestic matches are left out");
ok(c.games.some((g) => /\//.test(g.teams[0].score + g.teams[1].score) && g.detail), "cricket: runs and wickets, and the match's own line");
ok(WW.parseScores(null, "afl").games.length === 0 && WW.parseScores({ events: [{}] }, "nrl").games.length === 0 && WW.parseScores("x", "zz").league === "NRL", "nothing from nothing; an unknown league is the NRL");
const hostile = WW.parseScores({ events: [{ id: 1, date: "2026-11-18T08:00Z", status: { type: { state: "in", shortDetail: "<b>Q2</b>" } }, competitions: [{ competitors: [
  { homeAway: "home", score: "<img src=x>", team: { shortDisplayName: "<script>x</script>Team", abbreviation: "A", color: "red;background:url(x)" } }, { homeAway: "away", score: "3", team: { shortDisplayName: "B", abbreviation: "B", color: "00ff00" } }] }] }] }, "afl").games[0];
ok(hostile.teams[0].colour === "" && hostile.teams[1].colour === "#00ff00" && !/[<>]/.test(hostile.teams[0].name + hostile.teams[0].score + hostile.detail), "markup and odd colours from the source are dropped");
// the order on a widget
const order = WW.scoreOrder(read("nba").games, "knicks", NOW);
ok(order[0].mine && /Knicks/.test(order[0].teams.map((t) => t.name).join()), "the household's team comes first when nothing is live");
const live = JSON.parse(JSON.stringify(read("aleague").games)); live[1].state = "in";
ok(WW.scoreOrder(live, "", NOW)[0].id === live[1].id, "a live game comes first");
ok(WW.kickoff(Date.UTC(2026, 10, 18, 9, 40), NOW, false).length > 0 && /^Tomorrow /.test(WW.kickoff(NOW + 86400000, NOW)) && /^\d+ [A-Z][a-z]{2}$/.test(WW.kickoff(NOW + 30 * 86400000, NOW)), "start times in the TV's own time");

// the requests for scores (each competition's team list is asked once besides, for the Your team picker)
const sb = (t) => t.asked.filter((u) => !/\/standings$/.test(u));
(async () => {
  // ---------------- 2. the loader: straight from the TV, no relay needed ----------------
  const answer = (src, url) => K.json(url.indexOf("rugby-league") >= 0 ? "espn-nrl.json" : url.indexOf("basketball") >= 0 ? "espn-nba.json" : "espn-afl.json");
  const t = K.fakeTv(WW, { answer, relay: false, now: NOW, widgets: [{ kind: "sports", opts: {} }, { kind: "sports", opts: { league: "nba", team: "Knicks" } }, { kind: "sports", opts: { league: "nrl" } }] });
  await t.L.tick();
  const boards = t.asked.filter((u) => /scoreboard/.test(u)), lists = t.asked.filter((u) => /\/standings$/.test(u));
  ok(boards.length === 2 && t.asked.every((u) => /^https:\/\/site\.api\.espn\.com\//.test(u)), "one scoreboard request per league, straight to ESPN, even with no relay (" + sb(t).length + ")");
  ok(lists.length === 2 && boards.length + lists.length === t.asked.length, "and each competition's team list once, from its ladder, for the Your team picker (" + lists.join(", ") + ")");
  ok(t.L.data().sports.nrl.ok && t.L.data().sports.nba.v.games.length === 5, "the games are kept");
  t.now += 10 * 60000; await t.L.tick();
  ok(sb(t).length === 2, "nothing live: not asked again within 15 minutes");
  // a game on now: every 2 minutes
  const rec = t.L.data().sports.nba; rec.v.games[0].state = "in";
  t.now += 3 * 60000; await t.L.tick();
  ok(sb(t).filter((u) => /nba/.test(u)).length === 2 && sb(t).filter((u) => /rugby/.test(u)).length === 1, "a live game: that league is asked again after 2 minutes, the other is not");

  // ---------------- 3. the widget at every size ----------------
  const games = read("nba");
  const env = (r) => ({ data: { web: r === undefined ? {} : { sports: { nrl: r, nba: r } } } });
  const good = { ok: true, at: NOW, v: games };
  K.sizes(T.C, "sports").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "sports", w, h, opts: { league: "nba" } }, env(good));
    const txt = el.textContent;
    ok(!el.getAttribute("data-empty") && games.games.some((g) => txt.indexOf(g.teams[0].name) >= 0 && txt.indexOf(g.teams[0].score) >= 0), "sports " + id + ": real teams and scores");
    ok(!/Titans|Broncos|Rabbitohs/.test(txt), "sports " + id + ": never the designer's demo on a TV");
    ok(/Titans|Rabbitohs/.test(T.W.render({ kind: "sports", w, h }, { demo: true, designer: true }).textContent), "sports " + id + ": the designer shows a demo round");
  });
  const count = (el) => games.games.filter((g) => el.textContent.indexOf(g.teams[0].name) >= 0).length;
  const sm = T.W.render({ kind: "sports", w: 360, h: 360, opts: { league: "nba" } }, env(good)), tl = T.W.render({ kind: "sports", w: 360, h: 560, opts: { league: "nba" } }, env(good)), md = T.W.render({ kind: "sports", w: 760, h: 360, opts: { league: "nba" } }, env(good));
  ok(count(sm) === 2 && count(tl) === 3 && count(md) === 4, "small 2 games, tall 3, medium 4 (" + [count(sm), count(tl), count(md)] + ")");
  ok(/Full time/.test(sm.textContent) && /NBA/.test(sm.textContent), "results say Full time; the league names the widget");
  const gs = T.W.webKit.gameStatus;
  ok(gs({ state: "post", detail: "Final/OT" }).text === "Full time, extra time" && gs({ state: "post", detail: "FT/Pens" }).text === "Full time, penalties" && gs({ state: "post", detail: "Final" }).text === "Full time" && gs({ state: "post", detail: "Australia won by 4 wickets" }).text === "Australia won by 4 wickets", "results in plain words, never Final/OT");
  const lv = JSON.parse(JSON.stringify(good)); lv.v.games[2].state = "in"; lv.v.games[2].detail = "Q3 4:12";
  const le = T.W.render({ kind: "sports", w: 360, h: 360, opts: { league: "nba" } }, env(lv));
  ok(/Live, Q3 4:12/.test(le.textContent) && /Live now/.test(le.textContent), "a live game shows first and says Live");
  const wt = T.W.render({ kind: "sports", w: 360, h: 160, opts: { league: "nba", team: "Knicks" } }, env(good));
  ok(/Knicks/.test(wt.textContent) && /111/.test(wt.textContent), "a wide tile shows the household's team's game");
  const pre = { ok: true, at: NOW, v: read("afl") };
  ok(!/AM EDT/.test(T.W.render({ kind: "sports", w: 360, h: 360, opts: { league: "afl" } }, { data: { web: { sports: { afl: pre } } } }).textContent), "a game not started says when in the TV's own time, not ESPN's");
  const none = T.W.render({ kind: "sports", w: 360, h: 360, opts: { league: "nba" } }, env({ ok: true, at: NOW, v: { league: "NBA", round: "", games: [] } }));
  ok(none.getAttribute("data-empty") === "1" && /No NBA games right now/.test(none.textContent), "between seasons: says there are no games");
  [[undefined, "Getting the scores", "Getting scores"], [{ ok: false, err: "failed", at: 1 }, "could not be read", "Scores failed"]].forEach(([r, long, short]) => K.sizes(T.C, "sports").forEach(([id, w, h]) => {
    const el = T.W.render({ kind: "sports", w, h }, env(r)), says = w < 300 || h < 200 ? short : long;
    ok(el.getAttribute("data-empty") === "1" && el.textContent.indexOf(says) >= 0, "sports " + id + ": " + says);
  }));

  // ---------------- 4. the design and the setup record ----------------
  const CD = K.design();
  const k = K.kept(CD, "sports", { league: "afl", team: "Lions", label: "Footy" });
  ok(k.league === "afl" && k.team === "Lions" && k.label === "Footy", "a design keeps a league from the list, a team and a label");
  const b = K.kept(CD, "sports", { league: "https://x.example", team: "<b>x</b> https://x.example", url: "x" });
  ok(b.league === undefined && b.url === undefined && !/https?:|</.test(b.team || ""), "a link as a league, markup or a link as a team, and other options are dropped");
  const cap = T.C.get("sports");
  ok(cap.status === "works" && T.C.need("sports", "Google TV") === "works" && T.C.need("sports", "VIDAA") === "works" && T.C.need("sports", "webOS") === "works" && T.C.need("sports", "Saphi") === "computer" && T.C.need("sports", "tvOS") === "no", "widget-caps: works, honest platforms");
  ok(["android", "web", "vidaa"].every((g) => T.C.steps("sports", g).length >= 3), "widget-caps: steps for each kind of TV");
  done();
})().catch((e) => { console.error(e); process.exit(1); });
