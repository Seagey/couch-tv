// Open this on a phone or computer (a TV remote can't type a password): it goes to Spotify's sign-in,
// which comes back to /api/callback. The state value in a short-lived cookie stops a forged callback.
const crypto = require("crypto");
const { SCOPES, clientId, site, noIndex } = require("./_spotify");

module.exports = (req, res) => {
  noIndex(res);
  if (!clientId() || !process.env.SPOTIFY_CLIENT_SECRET) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Not set up yet: add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to this site's environment variables, then redeploy.");
  }
  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", `sp_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const q = new URLSearchParams({ client_id: clientId(), response_type: "code", redirect_uri: site(req) + "/api/callback",
    scope: SCOPES, state, show_dialog: "true" });
  res.statusCode = 302;
  res.setHeader("Location", "https://accounts.spotify.com/authorize?" + q.toString());
  res.setHeader("Cache-Control", "no-store");
  res.end();
};
