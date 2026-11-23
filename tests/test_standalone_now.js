// The standalone home's Spotify functions (standalone/api): now.js shapes Spotify's player state into
// the Now playing card item the page draws, and every function stays quiet until the site is set up.
// Run: node tests/test_standalone_now.js
const assert = require("assert");
const path = require("path");

const api = path.join(__dirname, "..", "standalone", "api");
for (const k of ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]) delete process.env[k];
const now = require(path.join(api, "now.js"));
const login = require(path.join(api, "login.js"));
const token = require(path.join(api, "player-token.js"));

function res() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
}

// the card item
const item = now.card({
  is_playing: true, currently_playing_type: "track", progress_ms: 61500, device: { name: "Phone" },
  item: { name: "Song", duration_ms: 200000, artists: [{ name: "A" }, { name: "B" }],
    album: { name: "Album", images: [{ url: "big", width: 640 }, { url: "mid", width: 300 }] } },
});
assert.deepStrictEqual(item, { title: "Song", artist: "A, B", album: "Album", state: "playing",
  app: { id: "spotify", name: "Spotify", package: "com.spotify.tv.android" }, art: "mid", source: "spotify",
  device: "Phone", position: 61, duration: 200 });
assert.strictEqual(now.card({ is_playing: false, item: { name: "x" } }), null);
assert.strictEqual(now.card(null), null);

(async () => {
  // no site key on the host: every Spotify function refuses, even a same-site page (fail closed)
  delete process.env.COUCH_SITE_KEY;
  let r = res();
  await now({ url: "/api/now", headers: {} }, r);
  assert.strictEqual(r.statusCode, 403);
  r = res();
  await token({ url: "/api/player-token", headers: { "sec-fetch-site": "same-origin" } }, r);
  assert.strictEqual(r.statusCode, 403);
  process.env.COUCH_SITE_KEY = "short";   // too short to count as a key: still refused
  r = res();
  await now({ url: "/api/now?sk=short", headers: {} }, r);
  assert.strictEqual(r.statusCode, 403);

  // not set up: now says so (cached briefly), login explains what's missing, token refuses
  process.env.COUCH_SITE_KEY = "k".repeat(24);
  r = res();
  await now({ url: "/api/now?sk=" + "k".repeat(24), headers: {} }, r);
  assert.deepStrictEqual(JSON.parse(r.body), { ok: true, configured: false, music: null });
  assert.strictEqual(r.headers["X-Robots-Tag"], "noindex, nofollow");
  delete process.env.COUCH_SITE_KEY;

  r = res();
  login({ url: "/api/login", headers: { host: "home.example" } }, r);
  assert.strictEqual(r.statusCode, 500);
  assert.match(r.body, /SPOTIFY_CLIENT_ID/);

  r = res();
  await token({ url: "/api/player-token", headers: { "sec-fetch-site": "cross-site" } }, r);
  assert.strictEqual(r.statusCode, 403);   // only the site's own page

  // set up: login sends the browser to Spotify with this site's own callback
  process.env.SPOTIFY_CLIENT_ID = "abc123";
  process.env.SPOTIFY_CLIENT_SECRET = "s";
  r = res();
  login({ url: "/api/login", headers: { host: "home.example" } }, r);
  assert.strictEqual(r.statusCode, 302);
  assert.match(r.headers.Location, /^https:\/\/accounts\.spotify\.com\/authorize\?/);
  assert.match(r.headers.Location, /redirect_uri=https%3A%2F%2Fhome\.example%2Fapi%2Fcallback/);
  assert.match(r.headers["Set-Cookie"], /^sp_state=[0-9a-f]{32}; .*HttpOnly; Secure/);
  // COUCH_SITE_KEY: without ?sk= the song and the player token are refused, with it they answer
  process.env.COUCH_SITE_KEY = "k".repeat(24);
  r = res();
  await now({ url: "/api/now", headers: {} }, r);
  assert.strictEqual(r.statusCode, 403);
  r = res();
  await now({ url: "/api/now?sk=" + "k".repeat(24), headers: {} }, r);
  assert.strictEqual(r.statusCode, 200);
  r = res();
  await token({ url: "/api/player-token?sk=wrong", headers: { "sec-fetch-site": "same-origin" } }, r);
  assert.strictEqual(r.statusCode, 403);
  delete process.env.COUCH_SITE_KEY;
  console.log("ok standalone now/login/token/site key");
})().catch((e) => { console.error(e); process.exit(1); });
