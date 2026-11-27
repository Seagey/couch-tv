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
    return out;
  }
  // held until app.js takes it (takeHome), as one record; a pack older than one already held is dropped
  function holdHome(h) {
    if (!h) return false;
    var old = takeHome(true);
    if (old && old.rev > h.rev) return false;
    var rec = JSON.stringify(h);
    store(HOME_KEY, rec);
    return store(HOME_KEY) === rec;
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
    var res = { people: people, place: place, account: next };
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
    readHome: readHome, takeHome: takeHome, mergeHome: mergeHome, fromAccount: fromAccount, photoOf: photoOf, wifiFromAccount: wifiFromAccount };
})();
