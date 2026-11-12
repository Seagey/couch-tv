#!/bin/bash
# Builds the standalone home: couch-tv's TV page as a plain website, for a TV that has no computer at
# home to run the bridge (docs/VIDAA.md, "No computer: a standalone home"). The page runs as the
# no-computer copy (clock, scenes or your photos, weather, Home settings; no bridge), and on Vercel
# the Spotify functions in standalone/api add the Now playing card and Play on TV.
#
#   scripts/build-standalone.sh [out-dir]      (default build/standalone, which git ignores)
#
# Then deploy the folder to a static host, for example: cd build/standalone && npx vercel deploy --prod
# The site is public to anyone who has its address (it sends noindex, so search engines skip it), and
# it carries everything in tv-home/web, including your own photos in backgrounds/mine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/build/standalone}"
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3

# rsync --delete empties the folder first: only ever into a new or empty folder, or an earlier build
# (it carries the .couch-standalone marker), never a folder of other things given by mistake
if [ -d "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ] && [ ! -f "$OUT/.couch-standalone" ]; then
  echo "$OUT is not empty and is not an earlier standalone build: pick a new or empty folder" 1>&2
  exit 1
fi
mkdir -p "$OUT"
rsync -a --delete --exclude '.couch-standalone' --exclude '.vercel/' --exclude 'config.js' --exclude '.DS_Store' "$ROOT/tv-home/web/" "$OUT/"

# config.js: the settings the bridge would hand the page, less what only the bridge uses, plus the
# standalone switch app.js reads. No keys and no TV addresses go in, and the weather's place is rounded
# to about a kilometre. It does carry the people's names and, for a kids profile, the kids PIN's hash
# (the page checks the PIN itself), so a public site shows those to anyone with its address.
(cd "$ROOT" && "$PY" - "$OUT/config.js" <<'EOF'
import json, sys
sys.path.insert(0, "bridge")
import config
c = config.public()
for k in ("tvs", "default_tv", "phone_remote", "ask"):
    c.pop(k, None)
w = dict(c.get("weather") or {})
for k in ("lat", "lon"):
    if isinstance(w.get(k), (int, float)):
        w[k] = round(w[k], 2)
c["weather"] = w
with open(sys.argv[1], "w") as f:
    f.write("window.COUCH_CONFIG = " + json.dumps(c) + ";\nwindow.COUCH_STANDALONE = true;\n")
EOF
)

# the Spotify functions (Vercel runs api/*.js as functions; other hosts serve the page without them)
rm -rf "$OUT/api" && cp -R "$ROOT/standalone/api" "$OUT/api"
cp "$ROOT/lg/app/largeIcon.png" "$OUT/icon.png"   # the VIDAA tile's picture (bridge/vidaa.py, install_tile)
printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
cat > "$OUT/vercel.json" <<'EOF'
{
  "functions": { "api/transfer.js": { "maxDuration": 40 } },
  "headers": [
    { "source": "/(.*)", "headers": [ { "key": "X-Robots-Tag", "value": "noindex, nofollow" } ] },
    { "source": "/(.*)\\.(js|css|html|json)", "headers": [ { "key": "Cache-Control", "value": "no-cache" } ] },
    { "source": "/fonts/(.*)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" } ] }
  ]
}
EOF
: > "$OUT/.couch-standalone"
echo "built the standalone home in $OUT ($(du -sh "$OUT" | cut -f1))"
echo "anyone with the site's address sees what is in it: your people's names, any kids PIN's hash (use a PIN you use nowhere else) and backgrounds/mine"
