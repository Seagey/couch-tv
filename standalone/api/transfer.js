// Move what's playing (from a phone, say) to the TV and keep it playing. Spotify only lets Premium
// accounts do this.
//   POST {"device_id": "..."}  the TV page's own player (Web Playback SDK, the "Couch TV" speaker)
//   POST {"mode": "tvapp"}     the TV's Spotify app, which the page is opening at the same moment:
//                              wait for it to show up as a device (up to ~25 s), then move it there
// The wait needs a function time limit over 25 s (vercel.json asks for 40; Vercel's fluid compute,
// on by default for new projects, allows it on the free plan).
const { spotify, configured, keyOk, sameSite, noIndex, json } = require("./_spotify");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const c of req) raw += c;
  try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
}

async function move(id) {
  const r = await spotify("/me/player", { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_ids: [id], play: true }) });
  return r.status === 204 || r.status === 202 || r.ok;
}

module.exports = async (req, res) => {
  noIndex(res);
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  if (!sameSite(req) || !keyOk(req)) return json(res, 403, { ok: false, error: "this site's page only" });
  if (!configured()) return json(res, 200, { ok: false, error: "not set up" });
  const body = await readBody(req);
  try {
    if (typeof body.device_id === "string" && /^[A-Za-z0-9]{8,80}$/.test(body.device_id))
      return json(res, 200, { ok: await move(body.device_id), to: "Couch TV" });
    if (body.mode === "tvapp") {
      for (let i = 0; i < 17; i++) {
        const r = await spotify("/me/player/devices");
        if (r.ok) {
          const tv = ((await r.json()).devices || []).find((d) => d.type === "TV" && d.name !== "Couch TV" && !d.is_restricted);
          if (tv) return json(res, 200, { ok: await move(tv.id), to: tv.name });
        }
        await sleep(1500);
      }
      return json(res, 200, { ok: false, error: "the TV's Spotify app didn't show up as a device" });
    }
    return json(res, 400, { ok: false, error: "device_id or mode needed" });
  } catch (e) {
    return json(res, 200, { ok: false, error: String(e.message || e) });
  }
};
