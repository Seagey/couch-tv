// What's playing on the Spotify account (phone, TV, anything), as couch-tv's Now playing card item
// (the same shape the bridge's /api/music returns). Cached a second at the edge, so a TV polling every
// few seconds stays cheap and a new song still shows quickly.
const { spotify, configured, keyOk, noIndex, json } = require("./_spotify");

function card(j) {
  const it = (j && j.item) || {};
  if (!j || !j.is_playing || !it.name) return null;
  const ep = j.currently_playing_type === "episode";
  const artist = ep ? ((it.show || {}).name || "") : (it.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const images = ep ? (it.images || (it.show || {}).images || []) : ((it.album || {}).images || []);
  const art = images.length ? images.reduce((a, b) => (Math.abs((b.width || 300) - 300) < Math.abs((a.width || 300) - 300) ? b : a)).url : null;
  const item = { title: it.name, artist, album: ep ? "" : ((it.album || {}).name || ""), state: "playing",
    app: { id: "spotify", name: "Spotify", package: "com.spotify.tv.android" }, art, source: "spotify",
    device: (j.device || {}).name || null };
  if (j.progress_ms != null) item.position = Math.floor(j.progress_ms / 1000);
  if (it.duration_ms) item.duration = Math.floor(it.duration_ms / 1000);
  return item;
}

module.exports = async (req, res) => {
  noIndex(res);
  if (!keyOk(req)) return json(res, 403, { ok: false, error: "site key needed (COUCH_SITE_KEY on the host, ?sk= in the address)" });
  if (!configured()) return json(res, 200, { ok: true, configured: false, music: null }, "public, s-maxage=30");
  try {
    const r = await spotify("/me/player?additional_types=track,episode");
    if (r.status === 204) return json(res, 200, { ok: true, configured: true, music: null }, "public, s-maxage=2");
    if (r.status === 429) return json(res, 200, { ok: false, configured: true, music: null, error: "Spotify asked to slow down" }, "public, s-maxage=30");
    if (!r.ok) return json(res, 200, { ok: false, configured: true, music: null, error: "Spotify said HTTP " + r.status }, "public, s-maxage=8");
    return json(res, 200, { ok: true, configured: true, music: card(await r.json()) }, "public, s-maxage=1");
  } catch (e) {
    return json(res, 200, { ok: false, configured: true, music: null, error: String(e.message || e) }, "public, s-maxage=15");
  }
};
module.exports.card = card;
