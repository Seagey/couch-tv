// Getting a design by code (Home settings, Look, Get a design). The TV PULLS a design from couch-tv
// Studio's store: it asks one server, the one in config.json "design_store", and nothing ever
// connects to the TV. The store never learns anything about this home (no address it keeps, no
// Wi-Fi, no devices, no names): the request carries the code and, on the Android apps, a few facts
// about the TV and nothing else (no cookies, no referrer): tv { v: the Couch TV version x.y.z,
// mem: the total memory Android sees, in MB, and from 0.13.13 profile: the kind of TV, see tvProfile }. Couch TV Studio keeps them on the person's TV in My TVs
// so "Will it play on your TV?" can answer for the real TV (tvReport below). No serial, no ids, no address,
// no location. A store that does not know "tv" reads only "code" and ignores it.
//
// What comes back is untrusted. Only its "design" is kept; the only picture allowed is a JPEG
// inside it (the store re-draws every upload as a clean JPEG), checked by its first bytes; then
// design.js's own gate (CouchDesign.sanitize) rebuilds it from the allow list as for any design.
// A design got this way ALWAYS shows the "Use this design?" question first: arriving clears this
// TV's record of any design it said yes to, so nothing in the answer can skip the question.
// A send to the account's own TV may also carry "home" (Your home: people, the town, the guest Wi-Fi). It is read
// below (readHome) into a checked copy, never into the design, and app.js puts it in Home settings.
(function () {
  "use strict";
  var KEY = "couchtv.design.fetched", MAX = 4000000, TIMEOUT = 15000;
  var Q = location.search;
  var DESIGNER = /[?&]designer=1\b/.test(Q);
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  // https only; plain http only to this computer (development)
  function cleanBase(u) {
    if (typeof u !== "string" || u.length > 200) return "";
    var m = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?)\/?$/i.exec(u.trim());
    return m ? m[1].toLowerCase() : "";
  }
  function base() {
    var cfg = window.COUCH_CONFIG || {};
    var b = cleanBase(cfg.design_store);
    // a browser preview (mock.js) may point at a local store: ?designstore=http://127.0.0.1:5490
    if (!b && /[?&]mock\b/.test(Q)) { var m = /[?&]designstore=([^&]*)/.exec(Q); if (m) b = cleanBase(decodeURIComponent(m[1])); }
    // no design_store in config.json at all: Couch TV Studio's own store (designer-gate.js). It is asked
    // only when the person at the TV types a code or shares the home. "design_store": "" turns both
    // off; a browser preview (?mock) never reaches it.
    else if (!b && !/[?&]mock\b/.test(Q) && !Object.prototype.hasOwnProperty.call(cfg, "design_store") && window.CouchDesigner) b = window.CouchDesigner.DEFAULT_STORE;
    return b;
  }
  // a code as typed with the remote: a short one (ABCDE-FGHJK, any case, spaces and dashes ignored) or
  // the long one from the QR (CTV1-...). Anything else is not sent anywhere.
  var SHORT = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  function readCode(s) {
    s = String(s || "").trim();
    var long = s.replace(/^CTV1-/i, "");
    if (/^[A-Za-z0-9_-]{43}$/.test(long)) return "CTV1-" + long;
    var c = s.toUpperCase().replace(/[\s-]/g, "");
    if (c.length !== 10) return "";
    for (var i = 0; i < 10; i++) if (SHORT.indexOf(c.charAt(i)) < 0) return "";
    return c.slice(0, 5) + "-" + c.slice(5);
  }
  // What was typed, shown back big before it is sent (a TCL remote's keyboard dropped a letter from a
  // code typed fast, 19 Nov 2026). Case, spaces and dashes do not matter; the code is shown as
  // ABCDE-FGHJK however it was typed. Answers { ok, code, shown, count, msg }: ok with code when it
  // is a whole code, else msg says in plain words what is wrong (how many letters, or which letter is
  // never in a code: codes leave out 0, 1, I, L, O and U so they cannot be mixed up).
  function checkCode(s) {
    s = String(s || "");
    var full = readCode(s);
    if (full && full.indexOf("CTV1-") === 0) return { ok: true, code: full, shown: full, count: 10, msg: "" };
    var c = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    var shown = c.length > 5 ? c.slice(0, 5) + "-" + c.slice(5) : c;
    if (full) return { ok: true, code: full, shown: full, count: 10, msg: "" };
    var bad = [], valid = 0;
    for (var i = 0; i < c.length; i++) {
      if (SHORT.indexOf(c.charAt(i)) >= 0) valid++;
      else if (bad.indexOf(c.charAt(i)) < 0) bad.push(c.charAt(i));
    }
    // a mark that is not a letter, a space or the dash (a stray "_" or "." from the TV's keyboard): the
    // letters may all be there, so the count alone said "That is 10 letters. A code has 10."
    var marks = [];
    String(s).replace(/[^A-Za-z0-9\s-]/g, function (m) { if (marks.indexOf(m) < 0) marks.push(m); return m; });
    var msg;   // only letters a code can have are counted
    if (!c.length) msg = "Nothing was typed. A code looks like ABCDE-FGHJK.";
    else if (marks.length) msg = (marks.length === 1 ? "The " + marks[0] + " is" : "The " + marks.join(" and ") + " are") + " not part of a code. Type only the letters and numbers" + (valid === 10 && !bad.length ? ": all 10 are there." : ".");
    else if (bad.length) msg = (bad.length === 1 ? bad[0] + " is" : bad.join(" and ") + " are") + " never in a code. Check that letter on your phone and type it again.";
    else if (valid < 10) msg = "That is " + valid + " of the 10 letters. " + (10 - valid === 1 ? "One is" : (10 - valid) + " are") + " missing: the TV's keyboard can drop a letter typed fast. Type it again, slowly.";
    else msg = "That is " + valid + " letters. A code has 10. Type it again.";
    return { ok: false, code: "", shown: shown, count: valid, msg: msg };
  }
  function jpegOk(u) {
    var m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(u || "");
    if (!m) return false;
    try { var head = atob(m[1].slice(0, 8)); return head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff; } catch (e) { return false; }
  }
  // the cut out of a design's photo (background.depth_image): a PNG or a WebP, checked by its first
  // bytes (PNG 89 50 4E 47; WebP "RIFF" .... "WEBP"), since it needs see through parts
  function cutoutOk(u) {
    var m = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(u || "");
    if (!m) return false;
    try {
      var head = atob(m[2].slice(0, 16));
      if (m[1] === "png") return head.charCodeAt(0) === 0x89 && head.slice(1, 4) === "PNG";
      return head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP";
    } catch (e) { return false; }
  }
  // keep only what a design may be: an object, with at most a JPEG background from the store (and its
  // PNG or WebP cut out)
  // the answer as an object, or null; keys that reach an object's prototype are dropped as it is read
  function parse(text) {
    if (typeof text !== "string" || text.length > MAX) return null;
    var j;
    try { j = JSON.parse(text, function (k, v) { return k === "__proto__" || k === "constructor" || k === "prototype" ? undefined : v; }); } catch (e) { return null; }
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  }
  function accept(text) {
    var j = parse(text);
    if (!j) return null;
    var d = j.design;
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    d = JSON.parse(JSON.stringify(d));   // a plain copy: nothing of the answer but data
    if (d.background && typeof d.background === "object") {
      var img = d.background.image;
      if (img !== undefined && !(typeof img === "string" && (jpegOk(img) || /^backgrounds\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/.test(img)))) delete d.background.image;
      var cut = d.background.depth_image;
      if (cut !== undefined && (!d.background.image || !(typeof cut === "string" && (cutoutOk(cut) || /^backgrounds\/[A-Za-z0-9_-]+\.(png|webp)$/.test(cut))))) delete d.background.depth_image;
      // a video background: never inside the answer and never a link. Only a video this same store
      // keeps (store:<id>, fetched and checked by its bytes later, bg-video.js) or a built in loop,
      // and only with its still picture
      var vid = d.background.video;
      if (vid !== undefined && (!d.background.image || !(typeof vid === "string" && (/^store:[A-Za-z0-9_-]{16,64}$/.test(vid) || /^backgrounds\/[A-Za-z0-9_-]+\.(mp4|webm)$/.test(vid))))) delete d.background.video;
    }
    return d;
  }
  // ---- Your home: the household's own details from a Couch TV Studio account (HOME-DETAILS-PAYLOAD.md) ----
  // A send to one of the account's own TVs may carry "home" next to "design": people (names, order, the
  // kids flag, a colour, a small photo), the town and the guest Wi-Fi. It is untrusted like the rest of the answer: read
  // here into a plain, checked copy or dropped. It is never part of the design, so no export or share of
  // the design can carry it. The store hands it over once (the first fetch of the code), so the TV keeps
  // it: held here (HOME_KEY) until app.js applies it to Home settings, People and Location.
  var HOME_KEY = "couchtv.home.pack", PHOTO_MAX = 56000;   // 40 KB of JPEG as base64, plus a little
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) && v >= lo && v <= hi; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function cleanWords(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
    return v.length >= 1 && v.length <= max ? v : "";
  }
  function readHome(h) {
    if (!h || typeof h !== "object" || Array.isArray(h)) return null;
    if (!(typeof h.v === "number" && h.v % 1 === 0 && h.v >= 1) || !(typeof h.rev === "number" && h.rev % 1 === 0 && h.rev >= 0)) return null;
    var out = { v: h.v, rev: h.rev, at: typeof h.at === "string" ? h.at.slice(0, 40) : "" };
    // a newer pack format: only people and town, if they read; wipe is a v1 word
    if (h.v === 1 && h.wipe === true) { out.wipe = true; return out; }
    if (Array.isArray(h.people)) {
      var seen = {};
      out.people = [];
      h.people.slice(0, 8).forEach(function (p) {
        if (!p || typeof p !== "object") return;
        var id = typeof p.id === "string" && /^p_[a-z0-9]{6,12}$/.test(p.id) ? p.id : "", name = cleanWords(p.name, 24);
        if (!id || !name || seen[id]) return;
        seen[id] = true;
        out.people.push({ id: id, name: name, kids: p.kids === true,
          colour: typeof p.colour === "string" && /^#[0-9a-fA-F]{6}$/.test(p.colour) ? p.colour.toLowerCase() : null,
          photo: typeof p.photo === "string" && p.photo.length <= PHOTO_MAX && jpegOk(p.photo) ? p.photo : null });
      });
    }
    var t = h.town;
    if (t && typeof t === "object" && !Array.isArray(t) && cleanWords(t.name, 40) && num(t.lat, -90, 90) && num(t.lon, -180, 180))
      out.town = { name: cleanWords(t.name, 40), lat: round2(t.lat), lon: round2(t.lon) };
    // the guest Wi-Fi (v1): null when the account cleared it; a network name of 1 to 32 characters and
    // a password of 0 to 63 ("" for an open network), as the Guest Wi-Fi widget keeps them (athome.js)
    if (h.v === 1 && h.wifi === null) out.wifi = null;
    else if (h.v === 1 && h.wifi && typeof h.wifi === "object" && !Array.isArray(h.wifi)) {
      var ssid = typeof h.wifi.name === "string" ? h.wifi.name.replace(/[\u0000-\u001f\u007f]/g, "") : "", pw = h.wifi.password;
      if (ssid.trim() && ssid.length <= 32 && typeof pw === "string" && pw.length <= 63 && !/[\u0000-\u001f\u007f]/.test(pw)) out.wifi = { name: ssid, password: pw };
    }
    // the rest of the home's details, the keys this TV may use, the photo album links (Phase 2 shared base, server/lib/home-v2.mjs).
    // The pack stays v 1 with these as extra fields (a TV already released reads the v 1 parts and ignores them); found by being there.
    if (h.details !== undefined || h.keys !== undefined || h.photos !== undefined || Array.isArray(h.keysHeld)) readV2(h, out);
    return out;
  }
  // ---- pack v2 ----
  // details: note, lists, guide, guest, stay, cal, screen, commute, places (by widget id), bins, watch, rooms, smart, card. Each part
  // is checked here again (the answer is untrusted); anything wrong is left out. keys: only the kinds we know, each a flat object
  // of short words. photos: albums of https links to our store's signed photos, at most 50, with the day each was taken.
  var KEY_KINDS = ["ha", "ai", "hue", "airtouch", "pool"], PHOTOS_TV_MAX = 50;
  var V2 = { note: 280, from: 24, listName: 24, item: 60, gTitle: 30, gText: 240, guest: 38, url: 2000 };
  function oneLine(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : ""; }
  function manyLines(v, n) {
    if (typeof v !== "string") return "";
    var ls = v.replace(/\r\n?/g, "\n").split("\n").map(function (l) { return oneLine(l, n); });
    while (ls.length && !ls[ls.length - 1]) ls.pop();
    while (ls.length && !ls[0]) ls.shift();
    return ls.slice(0, 6).join("\n").slice(0, n);
  }
  function httpsUrl(u) {
    u = typeof u === "string" ? u.trim() : "";
    if (!u || u.length > V2.url || /\s/.test(u)) return "";
    var m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(u);
    return m && m[1].indexOf("@") < 0 && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(m[1]) ? u : "";
  }
  function plainObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function placeOk(t) {
    if (!plainObj(t)) return null;
    var name = cleanWords(t.name, 40);
    return name && num(t.lat, -90, 90) && num(t.lon, -180, 180) ? { name: name, lat: round2(t.lat), lon: round2(t.lon) } : null;
  }
  var WID = /^[A-Za-z0-9_-]{1,40}$/, ENT = /^[a-z_]+\.[a-z0-9_]+$/, DAYKEY = /^\d{4}-\d{2}-\d{2}$/;
  function readDetails(d) {
    var o = {};
    if (!plainObj(d)) return o;
    if (plainObj(d.note)) { var nt = manyLines(d.note.text, V2.note); if (nt) o.note = { text: nt, from: oneLine(d.note.from, V2.from), at: 0 }; }
    if (Array.isArray(d.lists)) {
      var ls = d.lists.slice(0, 3).map(function (l) {
        if (!plainObj(l)) return null;
        var name = oneLine(l.name, V2.listName);
        if (!name) return null;
        return { name: name, items: (Array.isArray(l.items) ? l.items : []).map(function (it) { var t = plainObj(it) ? oneLine(it.t, V2.item) : ""; return t ? { t: t, done: it.done === true } : null; }).filter(Boolean).slice(0, 40) };
      }).filter(Boolean);
      if (ls.length) o.lists = ls;
    }
    if (Array.isArray(d.guide)) {
      var gs = d.guide.slice(0, 8).map(function (g) { var t = plainObj(g) ? oneLine(g.title, V2.gTitle) : ""; return t ? { title: t, text: manyLines(g.text, V2.gText) } : null; }).filter(Boolean);
      if (gs.length) o.guide = gs;
    }
    if (plainObj(d.guest)) { var gn = oneLine(d.guest.name, V2.guest).replace(/[:/@]/g, " ").replace(/\s+/g, " ").trim(); if (gn) o.guest = { name: gn, at: 0 }; }
    var st = {};
    if (plainObj(d.stay)) {
      var su = httpsUrl(d.stay.url);
      if (su) st.url = su;
      if (typeof d.stay.checkin === "string" && /^1[2-8]:00$/.test(d.stay.checkin)) st.checkin = d.stay.checkin;
      if (typeof d.stay.checkout === "string" && /^(08|09|10|11|12):00$/.test(d.stay.checkout)) st.checkout = d.stay.checkout;
      if (plainObj(d.stay.names)) {
        var names = {}, any = false;
        Object.keys(d.stay.names).filter(function (k) { return DAYKEY.test(k); }).sort().slice(-40).forEach(function (k) { var n = oneLine(d.stay.names[k], 30).split(" ")[0]; if (n && n.length >= 2 && /^[^:/@]+$/.test(n)) { names[k] = n; any = true; } });
        if (any) st.names = names;
      }
    }
    if (Object.keys(st).length) o.stay = st;
    if (plainObj(d.cal)) { var cu = httpsUrl(d.cal.url); if (cu) o.cal = { url: cu }; }
    if (plainObj(d.screen) && [30, 60, 90, 120, 180, 240].indexOf(d.screen.goal) >= 0) o.screen = { goal: d.screen.goal };
    if (plainObj(d.commute)) { var c = {}, to = placeOk(d.commute.to), fr = placeOk(d.commute.from); if (to) c.to = to; if (fr) c.from = fr; if (to || fr) o.commute = c; }
    if (plainObj(d.places)) {
      var pl = {}, pn = 0;
      Object.keys(d.places).slice(0, 24).forEach(function (id) { var p = WID.test(id) ? placeOk(d.places[id]) : null; if (p) { pl[id] = p; pn++; } });
      if (pn) o.places = pl;
    }
    if (plainObj(d.bins)) {
      var b = {}, bn = 0;
      if (typeof d.bins.weekday === "string" && /^(none|[0-6])$/.test(d.bins.weekday)) { b.weekday = d.bins.weekday; bn++; }
      if (d.bins.alt === true) { b.alt = true; bn++; }
      if (d.bins.thisweek === "a" || d.bins.thisweek === "b") { b.thisweek = d.bins.thisweek; bn++; }
      ["bin_a", "bin_b"].forEach(function (k) { var n = oneLine(d.bins[k], 20); if (n) { b[k] = n; bn++; } });
      ["lid_a", "lid_b"].forEach(function (k) { if (typeof d.bins[k] === "string" && /^#[0-9a-f]{6}$/i.test(d.bins[k])) { b[k] = d.bins[k].toLowerCase(); bn++; } });
      if (bn) o.bins = b;
    }
    if (plainObj(d.watch) && plainObj(d.watch.whose)) {
      var w = {}, wn = 0;
      Object.keys(d.watch.whose).slice(0, 24).forEach(function (id) { var v = d.watch.whose[id]; if (WID.test(id) && (v === "all" || (typeof v === "string" && /^p_[a-z0-9]{6,12}$/.test(v)))) { w[id] = v; wn++; } });
      if (wn) o.watch = { whose: w };
    }
    if (plainObj(d.rooms)) {
      var rooms = {}, rn = 0;
      Object.keys(d.rooms).slice(0, 10).forEach(function (tv) {
        var r = d.rooms[tv];
        if (!plainObj(r) || !/^[0-9a-f-]{36}$/.test(tv)) return;
        var one = { label: oneLine(r.label, 30) };
        ["climate", "speakers", "zones", "lights"].forEach(function (k) {
          if (Array.isArray(r[k])) { var l = r[k].filter(function (e) { return typeof e === "string" && e.length <= 80 && (k === "zones" ? /^[A-Za-z0-9_.:-]{1,40}$/.test(e) : ENT.test(e) || (k === "speakers" && AIRPLAY_ID.test(e))); }).slice(0, 16); if (l.length) one[k] = l; }
        });
        rooms[tv] = one; rn++;
      });
      if (rn) o.rooms = rooms;
    }
    if (plainObj(d.smart) && plainObj(d.smart.picks)) {
      var pk = {}, kn = 0;
      Object.keys(d.smart.picks).slice(0, 24).forEach(function (id) {
        var l = Array.isArray(d.smart.picks[id]) ? d.smart.picks[id].filter(function (e) { return typeof e === "string" && e.length <= 80 && (ENT.test(e) || AIRPLAY_ID.test(e)); }).slice(0, 16) : [];
        if (WID.test(id) && l.length) { pk[id] = l; kn++; }
      });
      if (kn) o.smart = { picks: pk };
    }
    // which picked thing is which part of a pool widget (lane C): entity ids of the right kind only
    if (plainObj(d.smart) && plainObj(d.smart.roles)) {
      var RR = { water: /^sensor\.[a-z0-9_]{1,64}$/, chlor: /^sensor\.[a-z0-9_]{1,64}$/, pump: /^(switch|fan)\.[a-z0-9_]{1,64}$/, heater: /^(switch|climate|water_heater)\.[a-z0-9_]{1,64}$/, light: /^(light|switch)\.[a-z0-9_]{1,64}$/ };
      var ro = {}, rn2 = 0;
      Object.keys(d.smart.roles).slice(0, 24).forEach(function (id) {
        var r = d.smart.roles[id], one = {}, n1 = 0;
        if (!WID.test(id) || !plainObj(r)) return;
        Object.keys(RR).forEach(function (k) { if (typeof r[k] === "string" && RR[k].test(r[k])) { one[k] = r[k]; n1++; } });
        if (n1) { ro[id] = one; rn2++; }
      });
      if (rn2) { o.smart = o.smart || {}; o.smart.roles = ro; }
    }
    if (plainObj(d.card)) { var cd = typeof d.card.url === "string" && d.card.url.length <= V2.url && /^https?:\/\/[A-Za-z0-9.:-]+(\/[^\s]*)?$/.test(d.card.url.trim()) ? d.card.url.trim() : ""; if (cd) o.card = { url: cd }; }
    return o;
  }
  // an AirPlay 2 speaker by its own name (lane C; server/lib/home-v2.mjs AIRPLAY_ID)
  var AIRPLAY_ID = /^airplay:[A-Za-z0-9 ._'()&-]{1,60}$/;
  function readKeys(k) {
    var o = {};
    if (!plainObj(k)) return o;
    KEY_KINDS.forEach(function (kind) {
      var v = k[kind];
      if (!plainObj(v)) return;
      var rec = {}, secret = kind === "ha" ? "token" : "key", sv = typeof v[secret] === "string" ? v[secret] : "";
      if (sv.length < 8 || sv.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(sv)) return;
      rec[secret] = sv;
      ["url", "base"].forEach(function (f) { if (typeof v[f] === "string" && /^https?:\/\/[A-Za-z0-9.:-]+(\/[^\s?#]*)?$/.test(v[f]) && v[f].length <= V2.url) rec[f] = v[f]; });
      ["provider", "model", "brand"].forEach(function (f) { if (typeof v[f] === "string" && /^[A-Za-z0-9 ._:\/-]{1,120}$/.test(v[f])) rec[f] = v[f]; });
      o[kind] = rec;
    });
    return o;
  }
  // the photo links: only https, only our store's private photo path, flattened to one list in album order, at most 50
  // only the store's own file host: a Supabase project address, or the host of this TV's design store
  function photoHostOk(u) {
    var m = /^https:\/\/([a-z0-9.-]+)\//i.exec(u), h = m ? m[1].toLowerCase() : "", sb = "";
    try { sb = (/^https:\/\/([a-z0-9.-]+)/i.exec(base()) || [])[1] || ""; } catch (e) {}
    return !!h && (/^[a-z0-9-]+\.supabase\.co$/.test(h) || (!!sb && h === sb.toLowerCase()));
  }
  function readPhotos(p) {
    var out = [];
    if (!plainObj(p) || !Array.isArray(p.albums)) return out;
    p.albums.forEach(function (a) {
      if (!plainObj(a) || !Array.isArray(a.photos)) return;
      a.photos.forEach(function (ph) {
        if (out.length >= PHOTOS_TV_MAX || !plainObj(ph) || typeof ph.id !== "string" || !/^[0-9a-f]{24}$/.test(ph.id)) return;
        if (typeof ph.url !== "string" || ph.url.length > 1500 || !photoHostOk(ph.url) || !/^https:\/\/[a-z0-9.-]+\/storage\/v1\/object\/sign\/tvd-photos\/[0-9a-f-]{36}\/[0-9a-f]{24}\.jpg\?token=[A-Za-z0-9._-]+$/i.test(ph.url)) return;
        out.push({ id: ph.id, url: ph.url, taken: typeof ph.taken === "string" && DAYKEY.test(ph.taken) ? ph.taken : "", album: oneLine(a.name, 40) });
      });
    });
    return out;
  }
  function readV2(h, out) {
    if (plainObj(h.details)) out.details = readDetails(h.details);
    if (plainObj(h.keys)) out.keys = readKeys(h.keys);
    else if (Array.isArray(h.keysHeld)) out.keys = {};   // the pack had keys; they wait in the private store (takeHeldKeys)
    if (plainObj(h.photos)) out.photos = readPhotos(h.photos);
  }
  // sorted-key JSON, so two records compare by what they hold, not the order they were written in
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  // At home fields the details fill (athome.js keeps them): the account's value shows while the TV still holds exactly what the account
  // last put there (or nothing); something changed on the TV is the TV's own and an account change leaves it alone.
  var AH_FIELDS = ["note", "lists", "guide", "guest", "stay", "cal", "screen"];
  function ahWanted(d) {
    var w = {};
    AH_FIELDS.forEach(function (f) { if (d[f] !== undefined) w[f] = d[f]; });
    return w;
  }
  // Works out what a v2 pack changes on this TV, touching nothing:
  //   ah     { field: value | null } to put into At home (null takes the field out)
  //   keys   { kind: record | null } to hold (null: drop what the account gave)
  //   photos { add: [{ pid, url, taken }], update: [{ pid, id, url }], remove: [local ids] } for the photo list; the day each photo was taken
  //          (On this day) is kept in the account record's photoMap by photo id, never by link
  // now: { ah: the At home record, photos: the TV's photo list, account: what the last pack left }; pack: readHome's answer
  function planV2(now, pack, wipe) {
    var acc = now.account && typeof now.account === "object" ? now.account : {};
    var ahNow = plainObj(now.ah) ? now.ah : {}, applied = plainObj(acc.ahApplied) ? acc.ahApplied : {}, given = Array.isArray(acc.keysGiven) ? acc.keysGiven : [];
    var photosNow = Array.isArray(now.photos) ? now.photos : [];
    var plan = { ah: {}, keys: {}, photos: { add: [], update: [], remove: [] }, next: { details: wipe ? null : (pack.details || acc.details || null), ahApplied: {}, keysGiven: given.slice(), photoMap: {} } };
    var d = wipe ? {} : pack.details, want = d ? ahWanted(d) : null;
    if (want || wipe) {
      AH_FIELDS.forEach(function (f) {
        var w = want ? want[f] : undefined, cur = ahNow[f], prev = applied[f];
        var mine = cur === undefined || (prev !== undefined && stable(cur) === prev);
        if (mine) {
          if (w === undefined) { if (cur !== undefined) plan.ah[f] = null; }
          else { if (cur === undefined || stable(cur) !== stable(w)) plan.ah[f] = w; plan.next.ahApplied[f] = stable(w); }
        } else if (prev !== undefined) plan.next.ahApplied[f] = prev;
      });
    } else plan.next.ahApplied = applied;
    // keys: present in the pack = hold these, drop any kind given before and not given now; absent = leave as is
    if (wipe) { given.forEach(function (k) { plan.keys[k] = null; }); plan.next.keysGiven = []; }
    else if (pack.keys) {
      var now2 = Object.keys(pack.keys);
      now2.forEach(function (k) { plan.keys[k] = pack.keys[k]; });
      given.forEach(function (k) { if (!pack.keys[k]) plan.keys[k] = null; });
      plan.next.keysGiven = now2;
    }
    // photos. The account's photos are copied into this TV's own store on arrival (app.js fetchAccountPhoto), so they keep showing when
    // the link runs out. acc.photoMap says which local photo is which account photo: { photoId: { id: localId, day } }. A local photo
    // that is in that map is the account's; the rest are this TV's own and keep their slots.
    var map = plainObj(acc.photoMap) ? acc.photoMap : {}, byLocal = {}, accLocal = {};
    photosNow.forEach(function (p) { if (p && typeof p.id === "string") byLocal[p.id] = p; });
    Object.keys(map).forEach(function (pid) { if (map[pid] && typeof map[pid].id === "string") accLocal[map[pid].id] = pid; });
    var ownCount = photosNow.filter(function (p) { return p && !accLocal[p.id]; }).length, nextMap = {};
    if (wipe) Object.keys(accLocal).forEach(function (id) { if (byLocal[id]) plan.photos.remove.push(id); });
    else if (pack.photos) {
      var room = Math.max(0, PHOTOS_TV_MAX - ownCount), wantPid = {};
      pack.photos.forEach(function (ph) {
        var m = map[ph.id];
        wantPid[ph.id] = true;
        if (m && byLocal[m.id]) {
          nextMap[ph.id] = { id: m.id, day: ph.taken || m.day || "" };
          // an entry that is still a link (no file store on this TV) takes the fresh link
          if (!byLocal[m.id].file && byLocal[m.id].url !== ph.url) plan.photos.update.push({ pid: ph.id, id: m.id, url: ph.url });
        } else if (room > 0) { room--; plan.photos.add.push({ pid: ph.id, url: ph.url, taken: ph.taken }); }
      });
      Object.keys(map).forEach(function (pid) { if (!wantPid[pid] && map[pid] && byLocal[map[pid].id]) plan.photos.remove.push(map[pid].id); });
      plan.next.photoMap = nextMap;
    } else plan.next.photoMap = map;
    return plan;
  }
  // a widget's own place (Phase 2): the account's, by widget id, or null (the widget then uses the home's town)
  function placeOf(account, widgetId) {
    var d = account && account.details, p = d && d.places && typeof widgetId === "string" ? d.places[widgetId] : null;
    return p ? placeOk(p) : null;
  }
  // one of the account's detail parts, or null
  function detail(account, key) { var d = account && account.details; return d && d[key] !== undefined ? d[key] : null; }
  // held until app.js takes it (takeHome), as one record; a pack older than one already held is dropped
  function holdHome(h) {
    if (!h) return false;
    var old = takeHome(true);
    if (old && old.rev > h.rev) return false;
    // the keys never wait in page storage: they go straight to the launcher's private store (held with the pack there), or are dropped
    var keys = h.keys, held = h;
    if (keys !== undefined) { held = {}; Object.keys(h).forEach(function (k) { if (k !== "keys") held[k] = h[k]; }); held.keysHeld = Object.keys(keys); if (!holdKeys(keys)) held.keysHeld = []; }
    var rec = JSON.stringify(held);
    store(HOME_KEY, rec);
    return store(HOME_KEY) === rec;
  }
  var HELD_KEYS = "tvhome.home.keys.held";
  function holdKeys(keys) {
    var T = window.TVOS;
    if (!T || !T.keepPrivate) return Object.keys(keys).length === 0;   // no private store on this TV: no key is kept
    try { T.keepPrivate(HELD_KEYS, JSON.stringify(keys)); return true; } catch (e) { return false; }
  }
  // the keys a held pack came with, once (private store only)
  function takeHeldKeys() {
    var T = window.TVOS, v = null;
    try { if (T && T.keptPrivate) v = T.keptPrivate(HELD_KEYS); } catch (e) {}
    try { if (T && T.keepPrivate) T.keepPrivate(HELD_KEYS, ""); } catch (e) {}
    try { v = v ? JSON.parse(v) : null; } catch (e) { v = null; }
    return plainObj(v) ? readKeys(v) : {};
  }
  function takeHome(peek) {
    var raw = store(HOME_KEY), h = null;
    try { h = raw ? readHome(JSON.parse(raw)) : null; } catch (e) {}
    if (!peek || (raw && !h)) store(HOME_KEY, null);
    return h;
  }
  // An account person is marked src "account"; ids from an account start "p_" and a TV made id never
  // does (app.js newPersonId), so a person who lost the mark on the way through a bridge is still known.
  function fromAccount(p) { return !!p && (p.src === "account" || (typeof p.id === "string" && p.id.indexOf("p_") === 0)); }
  // What the TV keeps after a pack, worked out without touching anything (app.js stores the answer).
  // now: { people: the TV's list [{id, name, kid?, colour?, guest?, src?}], place: Home settings' Location
  // (or null), account: what the last pack left ({ rev, people: [{id, name, kids, colour, photo}], town })
  // or null }. Answers null when the pack is older than the one already applied, else { people, place,
  // account }: the account's people first, in its order, then the ones added on this TV; the account wins
  // on the same id even after a rename here, and an account person no longer in the account is gone.
  function mergeHome(now, pack) {
    now = now || {};
    var acc = now.account && typeof now.account === "object" ? now.account : null;
    if (!pack || (acc && typeof acc.rev === "number" && acc.rev > pack.rev)) return null;
    var people = Array.isArray(now.people) ? now.people.slice() : [], place = now.place || null;
    var next = { rev: pack.rev, at: pack.at || "", people: acc && Array.isArray(acc.people) ? acc.people : [], town: acc && acc.town ? acc.town : null,
      wifi: acc && acc.wifi ? acc.wifi : null };
    var placeFromAccount = !!(place && place.src === "account");
    // the guest Wi-Fi on this TV (athome.js keeps it, with no room for a mark) is the account's while it is
    // still exactly what the account sent; changed on the TV, it is the TV's own and a clear leaves it
    var w = now.wifi && typeof now.wifi === "object" ? now.wifi : null;
    var wifiFromAccount = !!(w && next.wifi && w.ssid === next.wifi.name && (w.pass || "") === next.wifi.password);
    if (pack.wipe) {
      people = people.filter(function (p) { return !fromAccount(p); });
      if (placeFromAccount) place = null;
      next.people = []; next.town = null; next.wifi = null;
      var out = { people: people, place: place, account: next };
      // what the account gave beyond people, town and Wi-Fi goes too: the details it put in At home, its keys, its photos
      var wp = planV2(now, {}, true);
      next.details = null; next.ahApplied = wp.next.ahApplied; next.keysGiven = []; next.photoMap = {};
      out.ah = wp.ah; out.keys = wp.keys; out.photos = wp.photos;
      if (wifiFromAccount) out.wifi = null;
      return out;
    }
    if (pack.people) {
      var names = {};
      pack.people.forEach(function (p) { names[p.name.toLowerCase()] = true; });
      // someone added on this TV under the same name as an account person is that person: one row, not two
      var mine = people.filter(function (p) { return p && !fromAccount(p) && !names[String(p.name || "").toLowerCase()]; });
      people = pack.people.map(function (p) {
        var o = { id: p.id, name: p.name, src: "account" };
        if (p.kids) o.kid = true;
        if (p.colour) o.colour = p.colour;
        return o;
      }).concat(mine).slice(0, 12);
      next.people = pack.people;
    }
    if (pack.town) {
      place = { name: pack.town.name, area: "", lat: pack.town.lat, lon: pack.town.lon, timezone: "auto", src: "account" };
      next.town = pack.town;
    }
    // pack v2: the details, keys and photo links (kept in the record; the plan says what to put where)
    var v2 = null;
    if (pack.details || pack.keys || pack.photos) {
      v2 = planV2(now, pack, false);
      next.details = v2.next.details; next.ahApplied = v2.next.ahApplied; next.keysGiven = v2.next.keysGiven; next.photoMap = v2.next.photoMap;
    } else if (acc) { if (acc.details) next.details = acc.details; if (acc.ahApplied) next.ahApplied = acc.ahApplied; if (acc.keysGiven) next.keysGiven = acc.keysGiven; if (acc.photoMap) next.photoMap = acc.photoMap; }
    var res = { people: people, place: place, account: next };
    if (v2) { res.ah = v2.ah; res.keys = v2.keys; res.photos = v2.photos; }
    // wifi in the answer only when it changes: an object to keep, null to take away
    if (pack.wifi === null) {
      if (wifiFromAccount) res.wifi = null;
      next.wifi = null;
    } else if (pack.wifi) {
      var same = w && w.ssid === pack.wifi.name;
      res.wifi = { ssid: pack.wifi.name, sec: pack.wifi.password ? (same && w.sec === "WEP" ? "WEP" : "WPA") : "nopass", pass: pack.wifi.password, hidden: !!(same && w.hidden) };
      next.wifi = pack.wifi;
    }
    return res;
  }
  // whether the guest Wi-Fi kept on this TV is still the one the account sent
  function wifiFromAccount(account, w) {
    var a = account && account.wifi;
    return !!(a && w && w.ssid === a.name && (w.pass || "") === a.password);
  }
  // the account's photo for a person, or "" (checked again: what is kept on the TV is read as untrusted)
  function photoOf(account, id) {
    var list = account && Array.isArray(account.people) ? account.people : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && p.id === id) return typeof p.photo === "string" && p.photo.length <= PHOTO_MAX && jpegOk(p.photo) ? p.photo : "";
    }
    return "";
  }

  var MSG = {
    nocode: "That is not a design code. It looks like ABCDE-FGHJK.",
    notfound: "That code did not work. A code works once, for 30 minutes. Make a new one in Couch TV Studio.",
    slow: "Too many tries. Wait a few minutes, then try again.",
    paused: "Short codes are paused for a few minutes. Try again soon.",
    offline: "Could not reach the design server. Check the TV is online.",
    bad: "That design could not be used.",
    full: "This TV has no room to keep that design."
  };
  function fail(k) { var e = new Error(MSG[k]); e.kind = k; return e; }

  // What the TV says about itself with a fetch (Try before you buy, 24 Nov 2026): only the Couch TV
  // version (its x.y.z part, so a beta "0.13.12-beta.1" says "0.13.12") and the total memory in whole MB
  // (64 to 65536, from the app's TVOS.memoryMb, ActivityManager.MemoryInfo.totalMem). Either may be
  // missing; null when there is neither (a browser preview, or an app too old to say). The store's
  // own check is the same (tvs.mjs tvReport).
  function tvReport() {
    var T = window.TVOS, out = {}, any = false;
    if (!T) return null;
    try {
      var m = /^(\d{1,3}\.\d{1,3}\.\d{1,4})(?:$|[^\d.])/.exec(String(T.version ? T.version() || "" : ""));
      if (m) { out.v = m[1]; any = true; }
    } catch (e) {}
    try {
      var mb = T.memoryMb ? Number(T.memoryMb()) : 0;
      if (mb % 1 === 0 && mb >= 64 && mb <= 65536) { out.mem = mb; any = true; }
    } catch (e) {}
    var p = tvProfile(T);
    if (p) { out.profile = p; any = true; }
    return any ? out : null;
  }

  // The kind of TV (from 0.13.13): TVOS.tvProfile() gives a JSON string with platform ("Google TV",
  // "Android TV", "Fire OS"), sdk (Android's API level), memMb, res ("1920x1080", the size Android draws
  // the home at) and model (Android's model name, such as "Smart TV Pro"). Those keys (the five, then apps: package names), each checked
  // the way Couch TV Studio checks them (HOME-DETAILS-PAYLOAD.md, "What the TV says about itself"); a key that
  // fails is left out, and no profile at all when none passes. Never a serial, an address or an id.
  function whole(n, lo, hi) { return typeof n === "number" && n % 1 === 0 && n >= lo && n <= hi; }
  function tvProfile(T) {
    var raw, p = {}, any = false;
    try { raw = T.tvProfile ? JSON.parse(String(T.tvProfile() || "")) : null; } catch (e) { return null; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (typeof raw.platform === "string" && /^[A-Za-z0-9 ._-]{1,24}$/.test(raw.platform) && raw.platform.trim()) {
      p.platform = raw.platform; any = true;
    }
    if (whole(raw.sdk, 1, 99)) { p.sdk = raw.sdk; any = true; }
    if (whole(raw.memMb, 64, 65536)) { p.memMb = raw.memMb; any = true; }
    var r = typeof raw.res === "string" ? /^([1-9]\d{2,4})x([1-9]\d{2,4})$/.exec(raw.res) : null;
    if (r && +r[1] <= 16384 && +r[2] <= 16384) { p.res = raw.res; any = true; }
    if (typeof raw.model === "string") {
      // eslint-disable-next-line no-control-regex
      var m = raw.model.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
      if (m && m.length <= 40) { p.model = m; any = true; }
    }
    if (Array.isArray(raw.apps)) {
      // Installed apps (TV-APPS.md): package names only, same pattern as Studio, at most 300.
      var apps = [];
      for (var i = 0; i < raw.apps.length && apps.length < 300; i++) {
        var a = raw.apps[i];
        if (typeof a === "string" && a.length <= 200 && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(a) && apps.indexOf(a) < 0) apps.push(a);
      }
      if (apps.length) { p.apps = apps; any = true; }
    }
    return any ? p : null;
  }
  function fetchBody(code) {
    var body = { code: code }, t = tvReport();
    if (t) body.tv = t;
    return JSON.stringify(body);
  }

  function get(typed) {
    var code = readCode(typed), b = base();
    if (!code) return Promise.reject(fail("nocode"));
    if (!b || typeof fetch !== "function") return Promise.reject(fail("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(b + "/v1/designs/fetch", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
      headers: { "content-type": "application/json" }, body: fetchBody(code), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 404) throw fail("notfound");
      if (r.status === 429) throw fail("slow");
      if (r.status === 503) throw fail("paused");
      if (!r.ok) throw fail("offline");
      var len = Number(r.headers.get("content-length"));
      if (len > MAX) throw fail("bad");
      return r.text();
    }, function () { clearTimeout(timer); throw fail("offline"); }).then(function (text) {
      var d = accept(text);
      if (!d) throw fail("bad");
      arrived(d);
      // Your home comes only with a design that was good and kept: a bad design leaves no half a home
      var j = parse(text);
      holdHome(j ? readHome(j.home) : null);
      return d;
    });
  }
  // ---- Couch TV Setup: the design code it brought (setup-app make_home, --es design_code) ----
  // The app holds it (AccountLink.kt) until the page has fetched it here, through get() like a typed code:
  // "Use this design?" first, the home pack with it. Only a whole CTV1 code is taken (no short code ever
  // comes this way). Done (the app forgets it) once it arrived, or when the store says it is used, gone
  // or not a design; kept for the next start when the TV was offline or the store was busy.
  var SETUP_CODE = /^CTV1-[A-Za-z0-9_-]{43}$/;
  function setupCode() {
    var T = window.TVOS, c = "";
    if (!T || typeof T.setupDesignCode !== "function") return "";
    try { c = String(T.setupDesignCode() || ""); } catch (e) { return ""; }
    return c.length === 48 && SETUP_CODE.test(c) ? c : "";
  }
  function setupDone() { var T = window.TVOS; try { if (T && T.setupDesignDone) T.setupDesignDone(); } catch (e) {} }
  var setupBusy = false;
  function fromSetup() {
    var code = setupCode();
    if (!code || setupBusy || DESIGNER) return Promise.resolve(null);
    setupBusy = true;
    return get(code).then(function (d) { setupBusy = false; setupDone(); return d; }, function (e) {
      setupBusy = false;
      if (!e || ["offline", "slow", "paused", "full"].indexOf(e.kind) < 0) setupDone();
      throw e;
    });
  }
  // whether this TV holds a link to a Couch TV Studio account (the link itself never reaches the page)
  function linked() { var T = window.TVOS; try { return !!(T && T.accountLinked && T.accountLinked()); } catch (e) { return false; } }
  function unlink() { var T = window.TVOS; try { return !!(T && T.unlinkAccount && T.unlinkAccount()); } catch (e) { return false; } }
  // ---- The account's TV inbox (DREAM-SETUP-BUILD.md, "TV inbox"): Send to Living room TV, no code ----
  // The app asks it (AccountLink.kt, the link stays in Kotlin) and hands the page only a state, one CTV1
  // code and its title. Read again here as untrusted. inboxDelay: seconds to the next look by itself (0: stop).
  // When the TV looks (owner, 24 Nov 2026): when it wakes or the home opens after 30 minutes or more away
  // (INBOX_AWAY), when the person presses Check for new designs now, and otherwise once a week (INBOX_WEEK).
  // Studio's "poll" is honoured only when it is longer than a week (at most 20 days, so a browser timer can
  // hold it); a 429's wait is honoured as a time before which the TV does not look at all.
  var INBOX_WEEK = 604800, INBOX_AWAY = 1800, INBOX_POLL_MAX = 1728000, INBOX_WAIT_MAX = 86400;
  function secsIn(v, lo, hi) { return typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0; }
  function readInboxAnswer(raw) {
    var j = typeof raw === "string" ? parse(raw) : raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!j) return { state: "error" };
    var poll = Math.max(INBOX_WEEK, secsIn(j.poll, 0, INBOX_POLL_MAX));
    if (j.state === "item" && typeof j.code === "string" && j.code.length === 48 && SETUP_CODE.test(j.code))
      return { state: "item", code: j.code, title: cleanWords(j.title, 60), poll: poll };
    if (j.state === "none") return { state: "none", poll: poll };
    if (j.state === "unlinked") return { state: "unlinked" };
    if (j.state === "wait") return { state: "wait", wait: secsIn(j.wait, 30, INBOX_WAIT_MAX) || 900 };
    return { state: "error" };
  }
  // the next look by itself: a week, or Studio's longer poll; after an error or a wait, a week too (waking
  // the TV or pressing Check looks sooner)
  function inboxDelay(a) {
    if (!a || a.state === "unlinked") return 0;
    if (a.state === "item" || a.state === "none") return Math.max(INBOX_WEEK, Math.min(INBOX_POLL_MAX, a.poll || 0));
    return INBOX_WEEK;
  }
  // Undo for a design that came from the account: what was there before (the design got by code, the
  // answer to "Use this design?", designs switched off, and the Designs choice app.js keeps), held a day.
  var UNDO_KEY = "couchtv.design.undo", UNDO_MS = 24 * 3600 * 1000;
  function snapshot(choice) {
    return { fetched: store(KEY), ok: store("couchtv.design.ok"), no: store("couchtv.design.no"), off: store("couchtv.design.off"), choice: choice === undefined ? null : choice };
  }
  function holdUndo(snap, title, now) {
    var rec = JSON.stringify({ at: typeof now === "number" ? now : Date.now(), title: cleanWords(title, 60), fresh: true, snap: snap });
    store(UNDO_KEY, rec);
    if (store(UNDO_KEY) === rec) return true;
    store(UNDO_KEY, null);   // no room for the copy: no Undo rather than half of one
    return false;
  }
  function undoHeld(now) {
    var raw = store(UNDO_KEY), u = raw ? parse(raw) : null, t = typeof now === "number" ? now : Date.now();
    if (!u || !u.snap || typeof u.at !== "number" || t - u.at > UNDO_MS || t < u.at) { if (raw) store(UNDO_KEY, null); return null; }
    return u;
  }
  // the notice after the home started again with the new design: once
  function undoFresh(now) {
    var u = undoHeld(now);
    if (!u || !u.fresh) return null;
    u.fresh = false;
    store(UNDO_KEY, JSON.stringify(u));
    return u;
  }
  // puts it all back; answers the Designs choice that was kept before (for app.js), or undefined
  function undoNew(now) {
    var u = undoHeld(now);
    if (!u) return undefined;
    var s = u.snap;
    ["fetched", "ok", "no", "off"].forEach(function (k) {
      var key = k === "fetched" ? KEY : "couchtv.design." + k, v = s[k];
      store(key, typeof v === "string" ? v : null);
    });
    store(UNDO_KEY, null);
    return s.choice;
  }
  function dropUndo() { store(UNDO_KEY, null); }
  // keep it, and forget any yes this TV gave before: the question always comes first
  function arrived(d) {
    var rec = JSON.stringify({ design: d, at: Date.now() });
    store(UNDO_KEY, null);   // a newer design: the Undo for an older one from the account goes
    store("couchtv.design.ok", null);
    store("couchtv.design.no", null);
    store("couchtv.design.off", null);   // asked for at the TV: designs on again (the question still guards it)
    store(KEY, rec);
    if (store(KEY) !== rec) throw fail("full");
  }
  function kept() {
    if (DESIGNER) return null;   // the designer's own preview never takes a fetched design
    var raw = store(KEY);
    if (!raw) return null;
    var d = accept(raw);
    if (!d) store(KEY, null);
    return d;
  }
  function forget() { store(KEY, null); store("couchtv.design.ok", null); store("couchtv.design.no", null); }

  // While a design got by code is on this TV (asked about or in use), pictures may load only from this
  // page, data: and blob: pictures, the launcher's own tvos.invalid host, the design store, and the
  // hosts this TV's own settings already use (Keep watching posters, now playing art, photos the
  // person added by link). A second Content Security Policy narrows the page's own (index.html); two
  // policies both apply, so this can only take away. Photos added by link while it is on load after the
  // next restart, which Home settings does anyway.
  // Videos the same way: this page, blob: (a design's video is played from memory once checked) and
  // the design store; plus the host of the video link this TV's own Home settings use, if any.
  function hostOf(u) { var m = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?)\//i.exec(String(u || "")); return m ? m[1].toLowerCase() : ""; }
  function lockImages(ownLinks, ownVideo) {
    if (!kept() || !document.head) return false;
    var src = ["'self'", "data:", "blob:", "http://tvos.invalid", "https://images.justwatch.com", "https://i.scdn.co"];
    var b = base(); if (b) src.push(b);
    (ownLinks || []).forEach(function (u) { var h = hostOf(u); if (h && src.indexOf(h) < 0) src.push(h); });
    var media = mediaSources(ownVideo);
    var meta = document.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", "img-src " + src.join(" ") + "; media-src " + media.join(" "));
    document.head.appendChild(meta);
    return true;
  }
  function mediaSources(ownVideo) {
    var media = ["'self'", "blob:"], b = base(), h = hostOf(ownVideo);
    if (b) media.push(b);
    if (h && media.indexOf(h) < 0) media.push(h);
    return media;
  }

  // ---- Get a design from your phone: the design inbox (Couch TV Studio's /api/inbox) ----
  // The TV asks the same store for an inbox (a random id the store makes), shows a QR of
  // <store>/design/#inbox=<id>, and then, only while that screen is open, asks every few seconds
  // whether a code is in it. The phone puts a design code in it from Couch TV Studio. Only a code
  // ever comes back, and it goes through get() like a typed one: "Use this design?" first, always.
  // The TV pulls; nothing connects to it. Text/plain, so old TV browsers send it without a preflight.
  var INBOX_MSG = {
    gone: "That code ran out. Press OK for a new one.",
    offline: "Could not reach Couch TV Studio. Check the TV is online, or type the code instead.",
    busy: "Couch TV Studio is busy. Type the code instead, or try again in a few minutes.",
    none: "This design store has no phone inbox. Type the code instead."
  };
  function inboxFail(k) { var e = new Error(INBOX_MSG[k]); e.kind = k; return e; }
  function inboxCall(body) {
    var b = base();
    if (!b || typeof fetch !== "function") return Promise.reject(inboxFail("offline"));
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT);
    return fetch(b + "/api/inbox", {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
      headers: { "content-type": "text/plain" }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 404) throw inboxFail("gone");
      if (r.status === 503 || r.status === 429) throw inboxFail("busy");
      if (!r.ok) throw inboxFail("offline");
      return r.text();
    }, function () { clearTimeout(timer); throw inboxFail("offline"); }).then(function (t) {
      var j = null;
      try { j = JSON.parse(t); } catch (e) {}
      if (!j || typeof j !== "object") throw inboxFail("offline");
      return j;
    });
  }
  // { id, link, expires, every }: link is what the QR holds
  function openInbox() {
    // a store with no inbox (an older Couch TV Studio, or one's own store) answers 404: not "ran out"
    return inboxCall({ op: "open" }).catch(function (e) { throw e && e.kind === "gone" ? inboxFail("none") : e; }).then(function (j) {
      if (typeof j.id !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(j.id)) throw inboxFail("offline");
      var secs = Math.max(60, Math.min(1800, +j.expires_in || 600)), every = Math.max(3, Math.min(30, +j.poll_every || 4));
      return { id: j.id, link: base() + "/design/#inbox=" + j.id, expires: Date.now() + secs * 1000, every: every * 1000 };
    });
  }
  // "" while nothing is in it yet, else the design code (checked as a typed one is)
  function takeInbox(id) {
    return inboxCall({ op: "take", id: String(id || "") }).then(function (j) {
      if (j.state !== "ok") return "";
      var c = readCode(j.code);
      if (!c) throw inboxFail("gone");
      return c;
    });
  }

  window.CouchDesignCode = { base: base, readCode: readCode, checkCode: checkCode, get: get, kept: kept, forget: forget, accept: accept, lockImages: lockImages, mediaSources: mediaSources,
    openInbox: openInbox, takeInbox: takeInbox, tvReport: tvReport, fromSetup: fromSetup, linked: linked, unlink: unlink,
    readInboxAnswer: readInboxAnswer, inboxDelay: inboxDelay, INBOX_WEEK: INBOX_WEEK, INBOX_AWAY: INBOX_AWAY, snapshot: snapshot, holdUndo: holdUndo, undoHeld: undoHeld, undoFresh: undoFresh, undoNew: undoNew, dropUndo: dropUndo,
    readHome: readHome, holdHome: holdHome, takeHome: takeHome, takeHeldKeys: takeHeldKeys, readInboxDrop: function (j) { return !!j && typeof j === "object" && j.drop_keys === true; }, mergeHome: mergeHome, planV2: planV2, placeOf: placeOf, detail: detail, fromAccount: fromAccount, photoOf: photoOf, wifiFromAccount: wifiFromAccount };
})();
