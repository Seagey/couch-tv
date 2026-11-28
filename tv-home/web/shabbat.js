// Shabbat times (Home settings, Weather, Shabbat times): this week's candle lighting, havdalah and parsha
// for the home's own town, as one card at the start of the Keep watching row. Off unless switched on.
// The times come from Hebcal's free Shabbat API (https://www.hebcal.com/shabbat,
// CC BY 4.0), asked with the same latitude, longitude and time zone the weather already uses, so there is
// nothing new to set up and no computer is needed: the TV reads it itself (Hebcal allows any origin).
// On Shabbat itself (candle lighting to havdalah) the home can also take on a Shabbat look: candlelight
// colours over the scene, two candles and "Shabbat Shalom" under the date (Home settings, Weather,
// Shabbat look, on with the times). app.js asks span() and during(); app.css draws html.shabbat-mode.
// Display only, like custom cards (cards.js): the answer is turned into plain strings and app.js draws them
// with textContent. Nothing in it is run, parsed as HTML or followed as a link.
(function (root) {
  var EVERY_MIN = 60;                 // the times change once a week; an hour keeps a moved town fresh
  var TZ_RE = /^([A-Z][A-Za-z_]{1,30}(\/[A-Z][A-Za-z_-]{1,30}){1,2}|Etc\/GMT[+-]\d{1,2}|UTC|GMT)$/;

  // the weather's place ({lat, lon, timezone}) -> Hebcal's Shabbat link, or "" when there is no usable place
  function url(place, opts) {
    if (!place || !isFinite(place.lat) || !isFinite(place.lon)) return "";
    var lat = Math.round(Number(place.lat) * 10000) / 10000, lon = Math.round(Number(place.lon) * 10000) / 10000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return "";
    var q = "cfg=json&latitude=" + lat + "&longitude=" + lon + "&M=on";
    if (typeof place.timezone === "string" && TZ_RE.test(place.timezone)) q += "&tzid=" + encodeURIComponent(place.timezone);
    var b = opts && isFinite(opts.candleMinutes) ? Math.round(opts.candleMinutes) : 18;
    if (b >= 0 && b <= 90) q += "&b=" + b;
    if (opts && opts.israel) q += "&i=on";
    return "https://www.hebcal.com/shabbat?" + q;
  }

  // Hebcal's local time ("2026-11-27T16:13:00-05:00") -> "4:13 pm" or "16:13", read straight from the
  // string so it stays the town's own time whatever zone the TV is set to
  function clockOf(iso, h24) {
    var m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(typeof iso === "string" ? iso : "");
    if (!m) return "";
    var h = +m[1], mm = m[2];
    if (h24) return (h < 10 ? "0" : "") + h + ":" + mm;
    return (h % 12 || 12) + ":" + mm + (h < 12 ? " am" : " pm");
  }
  function dayOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof iso === "string" ? iso : "");
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  }
  // Hebcal's ISO time with its offset -> ms since 1970, or NaN
  function msOf(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(iso)) return NaN;
    var t = Date.parse(iso);
    return isFinite(t) ? t : NaN;
  }
  function text(v, most) {
    if (typeof v !== "string") return "";
    return v.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, most).trim();
  }

  // Hebcal's answer -> {candles, havdalah, parsha, holiday} (strings, "" when missing), or null when it is
  // not Hebcal's shape. The first candle lighting and the first havdalah after it are this week's.
  function read(data, h24) {
    if (!data || typeof data !== "object" || !Array.isArray(data.items)) return null;
    var out = { candles: "", candlesDay: NaN, havdalah: "", parsha: "", holiday: "", from: NaN, to: NaN };
    for (var i = 0; i < data.items.length && i < 60; i++) {
      var it = data.items[i];
      if (!it || typeof it !== "object") continue;
      if (it.category === "candles" && !out.candles) {
        out.candles = clockOf(it.date, h24);
        out.candlesDay = dayOf(it.date);
        out.from = msOf(it.date);
      } else if (it.category === "havdalah" && out.candles && !out.havdalah) {
        out.havdalah = clockOf(it.date, h24);
        out.to = msOf(it.date);
      } else if (it.category === "parashat" && !out.parsha) {
        out.parsha = text(it.title, 40);
      } else if (it.category === "holiday" && it.subcat === "major" && !out.holiday) {
        out.holiday = text(it.title, 40);
      }
    }
    return out.candles || out.havdalah || out.parsha ? out : null;
  }

  // -> the card for the Keep watching row ({title, value, subtitle}, the custom card shape), or null:
  //   value "4:13 pm" (the big line), title "Candle lighting", subtitle "Havdalah 5:16 pm · Parashat Vayishlach".
  // words, already in the home's language: {candles: "Candle lighting", havdalah: "Havdalah {time}"}.
  function card(data, h24, words) {
    var r = read(data, h24);
    if (!r || !r.candles) return null;
    words = words || {};
    var sub = [];
    if (r.havdalah) sub.push(String(words.havdalah || "Havdalah {time}").replace("{time}", r.havdalah));
    if (r.parsha) sub.push(r.parsha);
    else if (r.holiday) sub.push(r.holiday);
    return {
      title: text(String(words.candles || "Candle lighting"), 40),
      value: text(r.candles, 24),
      subtitle: text(sub.join(" · "), 60),
      kind: "shabbat"
    };
  }

  // -> {from, to, havdalah} (ms, ms, "5:16 pm"): candle lighting to havdalah, or null when Hebcal gave
  // no such pair (it covers no more than about a day and a half, or a three day Yom Tov)
  function span(data, h24) {
    var r = read(data, h24);
    if (!r || !isFinite(r.from) || !isFinite(r.to) || r.to <= r.from || r.to - r.from > 4 * 86400000) return null;
    return { from: r.from, to: r.to, havdalah: r.havdalah };
  }
  // is it Shabbat (or Yom Tov) now, by that span
  function during(sp, now) {
    return !!sp && isFinite(now) && now >= sp.from && now < sp.to;
  }

  // a JSON string -> the card, or null (the caller keeps the last good one)
  function parse(s, h24, words) {
    if (typeof s !== "string" || s.length > 262144) return null;
    try { return card(JSON.parse(s), h24, words); } catch (e) { return null; }
  }

  root.Shabbat = { url: url, read: read, card: card, parse: parse, span: span, during: during, clockOf: clockOf, EVERY_MIN: EVERY_MIN };
})(typeof window !== "undefined" ? window : this);
