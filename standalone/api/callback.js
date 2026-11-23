// Spotify's sign-in comes back here. The code is swapped for a refresh token, which is shown once so
// the owner can paste it into the site's environment variables as SPOTIFY_REFRESH_TOKEN (a static
// site has no database to keep it in). It is never stored or logged here.
const { site, tokenCall, noIndex } = require("./_spotify");

const clean = (v) => String(v).replace(/[<>&"]/g, "");

function page(res, status, title, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#111}
textarea{width:100%;height:120px;font:13px ui-monospace,monospace;padding:8px;box-sizing:border-box}button{font-size:16px;padding:10px 16px;margin-top:8px}
ol li{margin:6px 0}code{background:#f2f2f2;padding:1px 4px;border-radius:4px}</style><h1>${title}</h1>${body}`);
}

function cookie(req, name) {
  const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]+)").exec(req.headers.cookie || "");
  return m ? m[1] : "";
}

module.exports = async (req, res) => {
  noIndex(res);
  const url = new URL(req.url, site(req));
  const code = url.searchParams.get("code"), state = url.searchParams.get("state"), err = url.searchParams.get("error");
  res.setHeader("Set-Cookie", "sp_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  if (err) return page(res, 400, "Spotify said no", `<p>${clean(err)}</p><p><a href="/api/login">Try again</a></p>`);
  if (!code || !state || state !== cookie(req, "sp_state"))
    return page(res, 400, "That sign-in link is stale", `<p>Open <a href="/api/login">/api/login</a> again and sign in from the start.</p>`);
  const r = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: site(req) + "/api/callback" });
  if (!r.ok || !r.j.refresh_token)
    return page(res, 502, "Spotify didn't hand over a login", `<p>${clean(r.j.error_description || r.j.error || r.status)}</p><p><a href="/api/login">Try again</a></p>`);
  return page(res, 200, "Signed in to Spotify", `
<p>Last step:</p>
<ol>
<li>Copy the text in the box.</li>
<li>Add it to this site's environment variables as <code>SPOTIFY_REFRESH_TOKEN</code> (on Vercel: Project, Settings, Environment Variables, Production).</li>
<li>Redeploy the site. The song then shows on the TV.</li>
</ol>
<textarea id="t" readonly>${clean(r.j.refresh_token)}</textarea>
<button onclick="var t=document.getElementById('t');t.select();navigator.clipboard&&navigator.clipboard.writeText(t.value);this.textContent='Copied'">Copy</button>
<p style="color:#666">Keep it private: it lets this site read and move what you play. Cut it off any time in your Spotify account (Manage apps, Remove access).</p>`);
};
