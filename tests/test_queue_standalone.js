// The standalone home's Up next (standalone/api/now.js ?queue=1): Spotify's queue made small, a
// cover only from Spotify's own picture host, and "not set up" said plainly. A pretend Spotify, no network.
// Run: node tests/test_queue_standalone.js
const assert = require("assert");
const path = require("path");
const sp = require(path.join(__dirname, "../standalone/api/_spotify.js"));

(async () => {
  const now = require(path.join(__dirname, "../standalone/api/now.js"));
  const q = now.queueItems({ queue: [
    { type: "track", name: "Low Tide", artists: [{ name: "Saltwater Radio" }], album: { images: [{ url: "https://i.scdn.co/image/a", width: 300 }] } },
    { type: "episode", name: "Episode 9", show: { name: "A Podcast", images: [{ url: "https://elsewhere.example/b.jpg", width: 300 }] } },
    {}
  ].concat(Array.from({ length: 12 }, (_, i) => ({ type: "track", name: "Song " + i, artists: [], album: {} }))) }, 10);
  assert.strictEqual(q.length, 10);
  assert.deepStrictEqual(q[0], { title: "Low Tide", artist: "Saltwater Radio", art: "https://i.scdn.co/image/a" });
  assert.deepStrictEqual(q[1], { title: "Episode 9", artist: "A Podcast", art: null });
  assert.deepStrictEqual(now.queueItems(null), []);

  // not set up: ?queue=1 says so with a null queue (the widget then shows its setup card)
  const res = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; }, set statusCode(v) { this._s = v; }, get statusCode() { return this._s; } });
  const keep = { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET, sk: process.env.COUCH_SITE_KEY };
  delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET; delete process.env.COUCH_SITE_KEY;
  if (!sp.configured()) {
    const r = res();
    process.env.COUCH_SITE_KEY = "k".repeat(24);
    await now({ url: "/api/now?queue=1&sk=" + "k".repeat(24), headers: {} }, r);
    delete process.env.COUCH_SITE_KEY;
    assert.deepStrictEqual(JSON.parse(r.body), { ok: true, configured: false, queue: null });
  }
  Object.assign(process.env, keep.id ? { SPOTIFY_CLIENT_ID: keep.id } : {}, keep.secret ? { SPOTIFY_CLIENT_SECRET: keep.secret } : {}, keep.sk ? { COUCH_SITE_KEY: keep.sk } : {});
  console.log("ok standalone Up next queue");
})().catch((e) => { console.error(e); process.exit(1); });
