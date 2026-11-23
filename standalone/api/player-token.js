// A short-lived (1 hour) Spotify access token for the TV page's own player (the Web Playback SDK
// needs one in the browser to become the "Couch TV" speaker). Only for this site's own page, never
// cached. The refresh token and client secret never leave the server. Needs COUCH_SITE_KEY (see
// _spotify.js): without it nobody gets one.
const { accessToken, configured, keyOk, sameSite, noIndex, json } = require("./_spotify");

module.exports = async (req, res) => {
  noIndex(res);
  if (!sameSite(req) || !keyOk(req)) return json(res, 403, { ok: false, error: "this site's page only" });
  if (!configured()) return json(res, 200, { ok: false, error: "not set up" });
  try {
    const a = await accessToken();
    if (!/\bstreaming\b/.test(a.scope || "")) return json(res, 200, { ok: false, error: "sign in again at /api/login (the player permission is missing)" });
    return json(res, 200, { ok: true, token: a.token, expires_in: Math.floor((a.exp - Date.now()) / 1000) });
  } catch (e) {
    return json(res, 200, { ok: false, error: String(e.message || e) });
  }
};
