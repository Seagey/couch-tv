"""Show finder: where a title streams in your country ("country" in config.json), from JustWatch's public GraphQL (no key).

JustWatch also gives Android TV deep links (intent:// URIs) per offer and per episode, which is
what the bridge opens on the TV.
"""
import html
import json
import re

import aiohttp

import apps
import config

URL = "https://apis.justwatch.com/graphql"
COUNTRY, LANGUAGE = config.COUNTRY, "en"   # "country" in config.json
POSTER = "https://images.justwatch.com{path}"

KIND = {"FREE": "free", "ADS": "free", "FAST": "free", "FLATRATE": "subscription",
        "RENT": "rent", "BUY": "buy"}
KIND_ORDER = {"free": 0, "subscription": 1, "rent": 2, "buy": 3}

_OFFER = ("monetizationType deeplinkURL(platform: ANDROID_TV) standardWebURL "
          "package { clearName technicalName }")

# Samsung TVs take a title as {"id": <Tizen app id>, "action_data": <what that app expects>}, the
# form Samsung's own Universal Guide uses (Prime: a gti, Stan: a guid, Binge: an EventId, ...).
_TIZEN_OFFER = "monetizationType deeplinkURL(platform: TIZENOS) package { technicalName }"

SEARCH = """
query($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges { node { id objectType
      content(country: $country, language: $language) {
        title originalReleaseYear posterUrl shortDescription runtime backdrops { backdropUrl } }
      offers(country: $country, platform: ANDROID_TV) { %s }
      tizen: offers(country: $country, platform: TIZENOS) { %s } } } } }
""" % (_OFFER, _TIZEN_OFFER)

EPISODES = """
query($country: Country!, $language: Language!, $id: ID!) {
  node(id: $id) { ... on Show { seasons {
    content(country: $country, language: $language) { seasonNumber }
    episodes { content(country: $country, language: $language) { episodeNumber title runtime }
      offers(country: $country, platform: ANDROID_TV) { %s } } } } } }
""" % _OFFER

_session = None


async def _post(query, variables):
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    variables = {"country": COUNTRY, "language": LANGUAGE, **variables}
    async with _session.post(URL, json={"query": query, "variables": variables},
                             headers={"user-agent": "couch-tv-bridge/1"}) as r:
        data = await r.json(content_type=None)
    if data.get("errors"):
        raise RuntimeError(data["errors"][0].get("message", "JustWatch error"))
    return data["data"]


def poster_url(path, size="s592"):
    if not path:
        return None
    return POSTER.format(path=path.replace("{profile}", size).replace("{format}", "jpg"))


def backdrop_url(content):
    b = (content.get("backdrops") or [None])[0]
    return POSTER.format(path=b["backdropUrl"].replace("{profile}", "s1440").replace("{format}", "jpg")) if b else None


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _tizen_links(offers):
    out = {}
    for o in offers or []:
        try:
            d = json.loads(o.get("deeplinkURL") or "")
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("id"):
            out.setdefault(o["package"]["technicalName"], {"id": d["id"], "action_data": d.get("action_data") or ""})
    return out


def _providers(offers, tizen_offers=None):
    """One entry per app, cheapest way to watch first. Unknown services are kept, unplayable."""
    tizen = _tizen_links(tizen_offers)
    best = {}
    for o in offers or []:
        tech = o["package"]["technicalName"]
        app = apps.BY_JW.get(tech)
        key = app["id"] if app else tech
        kind = KIND.get(o["monetizationType"], "other")
        cur = best.get(key)
        if cur and KIND_ORDER.get(cur["kind"], 9) <= KIND_ORDER.get(kind, 9):
            continue
        best[key] = {
            "service": key,
            "name": app["name"] if app else o["package"]["clearName"],
            "kind": kind,
            "playable": bool(app and app["deeplink"] != "none"),
            "deeplink": o.get("deeplinkURL"),
            "tizen": tizen.get(tech),
            "web": html.unescape(o.get("standardWebURL") or "") or None,
        }
    return sorted(best.values(), key=lambda p: (not p["playable"], KIND_ORDER.get(p["kind"], 9)))


def _shape(node):
    c = node["content"]
    return {
        "jw_id": node["id"],
        "title": c["title"],
        "year": c.get("originalReleaseYear"),
        "type": "tv" if node["objectType"] == "SHOW" else "movie",
        "poster": poster_url(c.get("posterUrl")),
        "backdrop": backdrop_url(c),
        "overview": c.get("shortDescription"),
        "runtime_min": c.get("runtime"),
        "providers": _providers(node.get("offers"), node.get("tizen")),
    }


async def search(title, type_=None, first=8):
    flt = {"searchQuery": title}
    if type_ in ("tv", "movie"):
        flt["objectTypes"] = ["SHOW" if type_ == "tv" else "MOVIE"]
    data = await _post(SEARCH, {"first": first, "filter": flt})
    return [_shape(e["node"]) for e in data["popularTitles"]["edges"]]


async def find(title, type_=None):
    """Best match for a title plus the other candidates. None when nothing matches."""
    results = await search(title, type_)
    if not results:
        return None, []
    want = _norm(title)
    # Exact title with somewhere to watch it, then exact title, then the most popular result.
    ranked = sorted(range(len(results)), key=lambda i: (
        _norm(results[i]["title"]) != want,
        not results[i]["providers"],
        i,
    ))
    best = results[ranked[0]]
    others = [{"title": r["title"], "year": r["year"], "type": r["type"]}
              for i, r in enumerate(results) if i != ranked[0]]
    return best, others


_episodes_cache = {}  # jw_id -> (fetched_at, seasons)


async def _seasons(jw_id):
    import time
    hit = _episodes_cache.get(jw_id)
    if hit and time.time() - hit[0] < 12 * 3600:
        return hit[1]
    data = await _post(EPISODES, {"id": jw_id})
    seasons = (data.get("node") or {}).get("seasons") or []
    _episodes_cache[jw_id] = (time.time(), seasons)
    return seasons


def _ep(s, e):
    c = e["content"]
    return {"season": s["content"]["seasonNumber"], "episode": c["episodeNumber"],
            "name": c.get("title"), "runtime_min": c.get("runtime"),
            "providers": _providers(e.get("offers"))}


async def episode_providers(jw_id, season, episode=None):
    """One episode (or the first episode of a season): providers, name and runtime."""
    for s in await _seasons(jw_id):
        if s["content"]["seasonNumber"] != season:
            continue
        for e in s["episodes"]:
            if episode is None or e["content"]["episodeNumber"] == episode:
                return _ep(s, e)
    return None


async def episode_by_name(jw_id, name):
    """The episode whose title matches exactly (ignoring case and punctuation), only if exactly
    one episode of the show has that title. None otherwise: never a guess."""
    want = _norm(name)
    if not want:
        return None
    hits = [(s, e) for s in await _seasons(jw_id) for e in s["episodes"]
            if _norm(e["content"].get("title")) == want]
    return _ep(*hits[0]) if len(hits) == 1 else None


async def popular(services, first=20):
    """Popular titles in the home's country on the given JustWatch services (for day one picks)."""
    flt = {"packages": services} if services else {}
    data = await _post(SEARCH, {"first": first, "filter": flt})
    return [_shape(e["node"]) for e in data["popularTitles"]["edges"]]


DETAILS = """
query($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges { node { id objectType
      content(country: $country, language: $language) {
        title originalReleaseYear runtime genres { shortName translation(language: $language) } }
      ... on Show { seasons { totalEpisodeCount
        content(country: $country, language: $language) { seasonNumber } } } } } } }
"""


async def details(title, type_=None):
    """Genres, runtime and episodes per season for the title that matches exactly, else None."""
    flt = {"searchQuery": title}
    if type_ in ("tv", "movie"):
        flt["objectTypes"] = ["SHOW" if type_ == "tv" else "MOVIE"]
    data = await _post(DETAILS, {"first": 5, "filter": flt})
    for e in data["popularTitles"]["edges"]:
        n = e["node"]
        c = n["content"]
        if _norm(c["title"]) != _norm(title):
            continue
        return {"jw_id": n["id"], "title": c["title"], "year": c.get("originalReleaseYear"),
                "type": "tv" if n["objectType"] == "SHOW" else "movie",
                "runtime_min": c.get("runtime"),
                "genres": [g["translation"] for g in c.get("genres") or []],
                "seasons": {str(s["content"]["seasonNumber"]): s.get("totalEpisodeCount")
                            for s in n.get("seasons") or []}}
    return None
