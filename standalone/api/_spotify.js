// Shared bits for the standalone home's Spotify functions (files starting with _ are not routes on
// Vercel). The Spotify login lives here, on the website, not on the TV: a TV remote can't type a
// password, so the owner signs in once from a phone or computer at /api/login. Everything secret is
// in the site's environment variables (Vercel: Project, Settings, Environment Variables):
//   SPOTIFY_CLIENT_ID       the Spotify app's Client ID
//   SPOTIFY_CLIENT_SECRET   its Client secret
//   SPOTIFY_REFRESH_TOKEN   shown once by /api/callback after signing in
//   COUCH_SITE_KEY          required: a random string of 16 to 128 letters, digits, - or _ (for example
//                           openssl rand -hex 24). What's playing, the player token and moving playback
//                           answer only a page opened with ?sk=<the key> (the Couch TV tile's address
//                           carries it), never anyone who learns the site's address. Without it they
//                           answer nobody.
// The Spotify app needs https://<this site>/api/callback as a Redirect URI.
const API = "https://api.spotify.com/v1";
// read what's playing, move playback, and let the TV page be a player (the Web Playback SDK needs
// streaming, user-read-email and user-read-private)
const SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private";

const clientId = () => (process.env.SPOTIFY_CLIENT_ID || "").trim();
const configured = () => !!(clientId() && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_REFRESH_TOKEN);

// this site's own address, from the request (so the same files work on any deployment)
function site(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return "https://" + String(host).split(",")[0].trim();
}

function basic() {
  return "Basic " + Buffer.from(clientId() + ":" + (process.env.SPOTIFY_CLIENT_SECRET || "")).toString("base64");
}

async function tokenCall(params) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
    body: new URLSearchParams(params).toString(),
  });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j };
}

let access = { token: null, exp: 0, scope: "" };   // reused while this function instance stays warm

async function accessToken(force) {
  if (!force && access.token && Date.now() < access.exp) return access;
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: process.env.SPOTIFY_REFRESH_TOKEN });
  if (!r.ok || !r.j.access_token) throw new Error("renewing the Spotify login failed: " + (r.j.error_description || r.j.error || r.status));
  access = { token: r.j.access_token, exp: Date.now() + ((r.j.expires_in || 3600) - 60) * 1000, scope: r.j.scope || "" };
  return access;
}

// a Web API call with the account's token, renewed once if Spotify says it expired
async function spotify(path, opts) {
  let a = await accessToken();
  const go = (tk) => fetch(API + path, Object.assign({}, opts, { headers: Object.assign({ Authorization: "Bearer " + tk }, (opts || {}).headers) }));
  let r = await go(a.token);
  if (r.status === 401) { a = await accessToken(true); r = await go(a.token); }
  return r;
}

// COUCH_SITE_KEY: the request must carry it as ?sk= (compared in constant time). Without a site key
// (or with one the tile's address can't carry: 16 to 128 letters, digits, - or _) every Spotify call is
// refused, so a site set up without one never hands a stranger a token or the account's song.
function siteKey() {
  const k = (process.env.COUCH_SITE_KEY || "").trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(k) ? k : "";
}

function keyOk(req) {
  const want = siteKey();
  if (!want) return false;
  const got = new URL(req.url, "http://x").searchParams.get("sk") || "";
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && require("crypto").timingSafeEqual(a, b);
}

// only this site's own page may ask for a token or move playback (a browser says where a call came
// from; this keeps other websites out, not a script: COUCH_SITE_KEY is what keeps strangers out)
function sameSite(req) {
  const from = req.headers["sec-fetch-site"];
  return !from || from === "same-origin";
}

function noIndex(res) { res.setHeader("X-Robots-Tag", "noindex, nofollow"); }

function json(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cache || "no-store");
  res.end(JSON.stringify(body));
}

module.exports = { SCOPES, clientId, configured, site, tokenCall, accessToken, spotify, keyOk, sameSite, noIndex, json };
