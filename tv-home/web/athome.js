// Things typed at home, for couch-tv Studio's widgets: the family note, lists, the guest Wi-Fi, the
// house guide, a calendar link and a screen time goal. Typed in Home settings (couch-tv Studio, At
// home) with the remote or the phone remote's Type on the TV, and kept on this TV only:
//   - on the Android home in the launcher's own private store (TVOS.keepPrivate, left out of Android's
//     backups), never in the page's storage;
//   - on a TV that runs the home as a web page (Samsung, LG, Hisense...), in that page's own storage.
// Never in a design (design.js drops every option these widgets could carry), never in Share this
// home, never sent to couch-tv Studio or any server of ours. The calendar link is treated as a
// password: it is only ever used to read the calendar, and Home settings shows its host, never the
// whole link.
//
// Also here, as plain functions the tests can call: the Wi-Fi join code's words (the WIFI: format phone
// cameras read), a calendar (.ics) reader with repeats, the date a photo was taken (from the photo's
// own EXIF block or a date in its file name), On this day, and the words for screen time.
//
// ES5 on purpose: old Android TV WebViews. Also a CommonJS module for the tests.
(function (root) {
  "use strict";

  var KEY = "tvhome.athome";
  var LIM = { note: 280, from: 24, lists: 3, listName: 24, items: 40, item: 60, ssid: 32, pass: 63, guide: 8, gTitle: 30, gText: 240, url: 2000 };
  var SEC = ["WPA", "WEP", "nopass"];
  var GOALS = [0, 30, 60, 90, 120, 180, 240];

  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  // one line of words: no control characters, single spaces, at most n characters
  function line(v, n) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : ""; }
  // words that may keep their line breaks (a note, a guide entry): at most 6 lines
  function words(v, n) {
    if (typeof v !== "string") return "";
    var lines = v.replace(/\r\n?/g, "\n").split("\n").map(function (l) { return line(l, n); });
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    return lines.slice(0, 6).join("\n").slice(0, n);
  }

  // a calendar link: https (a calendar app's own link, the same address with a scheme ending in "cal",
  // is read over https), no name or password inside it, no spaces. Anything else is refused.
  function calUrl(u) {
    u = typeof u === "string" ? u.trim() : "";
    if (/^[a-z]+cals?:\/\//i.test(u)) u = "https://" + u.replace(/^[a-z]+cals?:\/\//i, "");
    if (u.length > LIM.url || /\s/.test(u)) return "";
    var m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(u);
    if (!m || m[1].indexOf("@") >= 0 || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(m[1])) return "";
    return u;
  }
  // what Home settings shows for a calendar link: its host only (the rest of it is the password)
  function calHost(u) { var m = /^https:\/\/([^/?#:]+)/i.exec(u || ""); return m ? m[1].toLowerCase() : ""; }

  // the whole record, checked: anything wrong is dropped, never guessed
  function clean(r) {
    r = obj(r);
    var out = { v: 1 };
    var n = obj(r.note), nt = words(n.text, LIM.note);
    if (nt) out.note = { text: nt, from: line(n.from, LIM.from), at: isFinite(n.at) ? +n.at : 0 };
    var lists = arr(r.lists).slice(0, 20).map(function (l) {
      l = obj(l);
      var name = line(l.name, LIM.listName);
      if (!name) return null;
      return { name: name, items: arr(l.items).map(function (it) { it = obj(it); var t = line(it.t, LIM.item); return t ? { t: t, done: it.done === true } : null; }).filter(Boolean).slice(0, LIM.items) };
    }).filter(Boolean).slice(0, LIM.lists);
    if (lists.length) out.lists = lists;
    var w = obj(r.wifi), ssid = typeof w.ssid === "string" ? w.ssid.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIM.ssid) : "";
    if (ssid.trim()) {
      var sec = SEC.indexOf(w.sec) >= 0 ? w.sec : "WPA", pass = typeof w.pass === "string" ? w.pass.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LIM.pass) : "";
      out.wifi = { ssid: ssid, sec: sec, pass: sec === "nopass" ? "" : pass, hidden: w.hidden === true };
    }
    var guide = arr(r.guide).slice(0, 40).map(function (g) {
      g = obj(g);
      var title = line(g.title, LIM.gTitle);
      return title ? { title: title, text: words(g.text, LIM.gText) } : null;
    }).filter(Boolean).slice(0, LIM.guide);
    if (guide.length) out.guide = guide;
    var url = calUrl(obj(r.cal).url);
    if (url) out.cal = { url: url };
    var st = cleanStay(r.stay);
    if (st) out.stay = st;
    // the guest's name now, for the Welcome widget (typed on the TV or the phone remote)
    var gn = guestFull(obj(r.guest).name);
    if (gn) out.guest = { name: gn, at: isFinite(obj(r.guest).at) ? +obj(r.guest).at : 0 };
    var goal = +obj(r.screen).goal;
    if (GOALS.indexOf(goal) > 0) out.screen = { goal: goal };
    return out;
  }

  // ---------------- guests from a bookings calendar ----------------
  // The way guest-tv, our sibling project for guest TVs, does it: the private calendar
  // link Airbnb, Booking.com or VRBO gives a host (or any Google, Apple or Outlook calendar), one event
  // per stay, read every 15 minutes. Kept on this TV with the rest of At home:
  //   url       the bookings link; left out, the Agenda's calendar link is read instead
  //   checkin   "15:00", checkout "10:00": the house's times (calendars hold days, not times)
  //   names     { "2026-11-21": "Sarah" }: a name typed on the TV for the stay starting that day.
  //             Airbnb's link says only "Reserved" (no names since 2019), so a typed name wins.
  var TIMES_IN = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  var TIMES_OUT = ["08:00", "09:00", "10:00", "11:00", "12:00"];
  function hhmmOk(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }
  function cleanStay(s) {
    s = obj(s);
    var out = {}, any = false, url = calUrl(s.url);
    if (url) { out.url = url; any = true; }
    if (typeof s.checkin === "string" && TIMES_IN.indexOf(s.checkin) >= 0) { out.checkin = s.checkin; any = true; }
    if (typeof s.checkout === "string" && TIMES_OUT.indexOf(s.checkout) >= 0) { out.checkout = s.checkout; any = true; }
    var names = {}, keys = Object.keys(obj(s.names)).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort().slice(-40);
    keys.forEach(function (k) { var n = guestWord(s.names[k]); if (n) names[k] = n; });
    if (Object.keys(names).length) { out.names = names; any = true; }
    return any ? out : null;
  }
  // one person's name as the TV shows it: a first name, letters only, never a booking code or a number
  var NOT_NAMES = /^(reserved|reservation|booked|booking|bookings|closed|blocked|block|not|available|unavailable|airbnb|vrbo|homeaway|stayz|guest|guests|stay|busy|hold|owner|occupied|private|event|new|confirmed|tentative|check|in|out)$/i;
  function guestWord(v) {
    if (typeof v === "string" && /[:/@]|www\./i.test(v)) return "";   // never a link or an address
    var w = line(v, 30).replace(/[^A-Za-zÀ-ɏͰ-ϿЀ-ӿ' -]/g, " ").replace(/\s+/g, " ").trim();
    w = w.split(" ")[0] || "";
    w = w.replace(/^['-]+|['-]+$/g, "");
    if (w.length < 2 || NOT_NAMES.test(w)) return "";
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  // the name of the guest staying now, as the Welcome widget shows it after the greeting ("Sarah",
  // "the Nguyen family"): one line of up to 38 characters, letters, digits, spaces and ' & , . ! -.
  // Never a link or an address. The same rule as Store.guestName in the on-TV app and bridge/guest.py.
  function guestFull(v) {
    if (typeof v !== "string" || /[:/@]|www\./i.test(v)) return "";
    return line(v, 200).replace(/[^A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF '&,.!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 38).trim();
  }
  // the guest's first name from a calendar event's title, or "" when the title only says it is booked:
  // "Reserved - Sarah Smith" (VRBO and many channel managers), "Sarah Smith (HM2AB3CD4E)", "Stay: Sarah",
  // "Sarah" (a calendar the host keeps). "Reserved", "Airbnb (Not available)", "CLOSED - Not available" give "".
  function guestName(title) {
    var t = line(title, 120).replace(/\([^)]*\)/g, " ").replace(/\b[A-Z]{2}[A-Z0-9]{6,12}\b/g, " ").trim();
    if (!t) return "";
    var parts = t.split(/\s+[-\u2013\u2014|:]\s+|:\s+/);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i].trim();
      if (!p || /not available|blocked|closed|unavailable/i.test(p)) continue;
      p = p.replace(/^(reserved|booked|booking|stay|guest|guests|check in|arriving)\s+(for\s+|by\s+)?/i, "").replace(/^the\s+/i, "");
      var w = guestWord(p);
      if (w) return w;
    }
    return "";
  }
  // a bookings calendar's own word for the host's blocked days. Booking.com writes every booking as
  // "CLOSED - Not available", so from a Booking.com link those are stays; from Airbnb and others a
  // "Not available" or "Blocked" event is the host's own days off, not a guest.
  function isBlock(title, host) {
    if (/(^|\.)booking\.com$/i.test(host || "")) return false;
    return /not available|blocked|unavailable|owner block/i.test(title || "");
  }
  function dayKey(ms) { var d = new Date(ms); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function atTime(dayMs, hhmm) { var d = new Date(dayMs), p = String(hhmm).split(":"); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +p[0], +p[1] || 0).getTime(); }
  // the stays in a calendar's events (parseIcs): an all day event of a night or more, or a timed one of
  // 12 hours or more. [{ from, to (the first and last day, midnight), guest, key }], soonest first.
  // opts.family: the family's own calendar (the Agenda's link, no bookings link), where a birthday is
  // an all day event too, so only an event whose title says it is a stay counts ("Stay: Sarah",
  // "Guests: the Smiths", "Reserved", "Booked").
  var STAY_WORD = /^\s*(stay|staying|guest|guests|reserved|booked|booking|airbnb|visit|visiting)\b/i;
  function staysOf(events, opts) {
    opts = obj(opts);
    var names = obj(opts.names), out = [];
    arr(events).forEach(function (e) {
      if (!e || !isFinite(e.start) || !isFinite(e.end)) return;
      if (opts.family && !STAY_WORD.test(e.title || "")) return;
      var nights = Math.round((new Date(e.end).setHours(0, 0, 0, 0) - new Date(e.start).setHours(0, 0, 0, 0)) / 86400000);
      if (nights < 1 || (!e.allDay && e.end - e.start < 12 * 3600000)) return;
      if (isBlock(e.title, opts.host)) return;
      var from = new Date(e.start).setHours(0, 0, 0, 0), to = new Date(e.end).setHours(0, 0, 0, 0), key = dayKey(from);
      // a name from the booking emails the home computer reads (bridge/bookings.py, as guest-tv does),
      // matched by the arrival day ("11-21")
      var mail = arr(opts.mail).filter(function (m) { return m && m.arrives === key.slice(5); })[0];
      out.push({ from: from, to: to, key: key, nights: nights, guest: names[key] || (mail && guestWord(mail.guest)) || guestName(e.title), typed: !!names[key], guests: mail && +mail.guests > 0 ? +mail.guests : 0 });
    });
    out.sort(function (a, b) { return a.from - b.from; });
    return out;
  }
  // where the house is in a stay at `now` (guest-tv's stay_of): "arrival" (today, before check in),
  // "before" (tomorrow), "during", "lastday" (today is check out day), or "between" with the next stay.
  // { phase, guest, from, to, checkin, checkout (ms), nights, night, next }
  function stayNow(events, now, opts) {
    opts = obj(opts);
    var t = isFinite(now) ? +now : Date.now(), today = new Date(t).setHours(0, 0, 0, 0);
    var cin = hhmmOk(opts.checkin, TIMES_IN, "15:00"), cout = hhmmOk(opts.checkout, TIMES_OUT, "10:00");
    var stays = staysOf(events, opts), next = null;
    for (var i = 0; i < stays.length; i++) {
      var s = stays[i], ci = atTime(s.from, cin), co = atTime(s.to, cout);
      if (t >= co) continue;
      var view = { guest: s.guest, guests: s.guests, typed: s.typed, key: s.key, from: s.from, to: s.to, checkin: ci, checkout: co, nights: s.nights };
      if (s.from - 86400000 <= today) {
        view.phase = t < ci ? (today === s.from ? "arrival" : "before") : today === s.to ? "lastday" : "during";
        view.night = Math.min(s.nights, Math.max(1, Math.round((today - s.from) / 86400000) + 1));
        view.next = stays[i + 1] ? { guest: stays[i + 1].guest, key: stays[i + 1].key, from: stays[i + 1].from } : null;
        return view;
      }
      next = view;
      break;
    }
    return { phase: "between", guest: "", next: next };
  }

  // ---------------- the guest Wi-Fi join code ----------------
  // The words phone cameras read (iOS 11 and Android 10 on): WIFI:T:WPA;S:<name>;P:<password>;;
  // with \ ; , : and " escaped by a backslash. T:WPA also covers WPA2 and WPA3; no password is
  // T:nopass with no P field.
  function wifiEsc(s) { return String(s).replace(/([\\;,:"])/g, "\\$1"); }
  function wifiQr(w) {
    w = obj(w);
    if (!w.ssid) return "";
    var sec = SEC.indexOf(w.sec) >= 0 ? w.sec : "WPA";
    return "WIFI:T:" + sec + ";S:" + wifiEsc(w.ssid) + ";" + (sec !== "nopass" && w.pass ? "P:" + wifiEsc(w.pass) + ";" : "") + (w.hidden ? "H:true;" : "") + ";";
  }

  // ---------------- a calendar (.ics) ----------------
  // RFC 5545, the parts calendars at home use: events, all day or timed, in UTC, the TV's own time or
  // a named time zone; repeats daily, weekly, monthly or yearly with an interval, a count or an end,
  // on given weekdays or month days; dates left out of a repeat; one changed date of a repeat; and
  // cancelled events. Only the title and the times are kept.
  function unfold(text) { return String(text || "").replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, ""); }
  function unesc(v) { return String(v).replace(/\\[nN]/g, " ").replace(/\\([,;\\:])/g, "$1"); }
  // NAME;P=V;P2="V":VALUE, with a colon inside quotes kept in the parameter
  function prop(l) {
    var q = false, i;
    for (i = 0; i < l.length; i++) { var c = l.charAt(i); if (c === '"') q = !q; else if (c === ":" && !q) break; }
    if (i >= l.length) return null;
    var head = l.slice(0, i).split(";"), params = {};
    head.slice(1).forEach(function (p) { var k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ""); });
    return { name: head[0].toUpperCase(), params: params, value: l.slice(i + 1) };
  }
  // the time-zone offset (minutes ahead of UTC) of a named zone at a moment, where the TV knows the zone
  function zoneOffset(ms, tz) {
    try {
      var f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      var p = {}; f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
      var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return isFinite(asUtc) ? Math.round((asUtc - ms) / 60000) : null;
    } catch (e) { return null; }
  }
  // a DTSTART, DTEND or EXDATE value: { ms, allDay } or null
  function when(v, params) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(v || "").trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    if (!m[4] || (params && params.VALUE === "DATE")) return { ms: new Date(y, mo, d).getTime(), allDay: true };
    var h = +m[4], mi = +m[5], s = +(m[6] || 0);
    if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
    var tz = params && params.TZID;
    if (tz) {
      // a named zone the TV knows (Australia/Sydney): converted; a name it does not (Outlook's "AUS
      // Eastern Standard Time") is read as the TV's own time, which is right for a calendar at home
      var guess = Date.UTC(y, mo, d, h, mi, s), off = zoneOffset(guess, tz);
      if (off !== null) { var ms = guess - off * 60000, off2 = zoneOffset(ms, tz); if (off2 !== null && off2 !== off) ms = guess - off2 * 60000; return { ms: ms, allDay: false }; }
    }
    return { ms: new Date(y, mo, d, h, mi, s).getTime(), allDay: false };
  }
  function duration(v) {
    var m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || "").trim());
    if (!m) return null;
    var ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * 86400 + +(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000;
    return m[1] === "-" ? -ms : ms;
  }
  function rrule(v) {
    var r = {};
    String(v || "").split(";").forEach(function (p) { var k = p.indexOf("="); if (k > 0) r[p.slice(0, k).toUpperCase()] = p.slice(k + 1).toUpperCase(); });
    return r.FREQ ? r : null;
  }
  var WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  // every start of a repeating event from its first one, up to `to` (wall clock steps, the TV's time).
  // A COUNT counts from the first one; only starts from `from` on (less a month, for long events) are kept.
  function repeats(start, rule, from, to, max) {
    var out = [], freq = rule.FREQ, iv = Math.max(1, parseInt(rule.INTERVAL, 10) || 1), count = parseInt(rule.COUNT, 10) || 0;
    var until = rule.UNTIL ? when(rule.UNTIL, rule.UNTIL.length === 8 ? { VALUE: "DATE" } : null) : null, untilMs = until ? (until.allDay ? until.ms + 86399999 : until.ms) : Infinity;
    var byday = (rule.BYDAY || "").split(",").filter(Boolean), bymd = (rule.BYMONTHDAY || "").split(",").filter(Boolean).map(function (x) { return parseInt(x, 10); });
    var keepFrom = from - 31 * 86400000;
    var d0 = new Date(start), n = 0, guard = 0, emit = function (d) {
      var t = d.getTime();
      if (t < start) return true;
      if (t > untilMs || t >= to) return false;
      n++;
      if (t >= keepFrom) out.push(t);
      return !(count && n >= count) && out.length < max;
    };
    var hms = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d0.getHours(), d0.getMinutes(), d0.getSeconds()); };
    if (freq === "DAILY") {
      for (var dd = d0; guard++ < 40000; dd = hms(addDays(dd, iv))) { if (byday.length && byday.indexOf(WD[dd.getDay()]) < 0) continue; if (!emit(dd)) break; }
    } else if (freq === "WEEKLY") {
      var days = byday.length ? byday.map(function (x) { return WD.indexOf(x.slice(-2)); }).filter(function (x) { return x >= 0; }).sort() : [d0.getDay()];
      var wk = addDays(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()), -d0.getDay());
      outer: for (; guard++ < 6000; wk = addDays(wk, 7 * iv)) {
        for (var i = 0; i < days.length; i++) { if (!emit(hms(addDays(wk, days[i])))) break outer; }
      }
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      var step = freq === "MONTHLY" ? iv : 12 * iv, months = rule.BYMONTH ? rule.BYMONTH.split(",").map(function (x) { return parseInt(x, 10) - 1; }) : null;
      outer2: for (var k = 0; guard++ < 3000; k += freq === "YEARLY" && months ? 1 : step) {
        var base = new Date(d0.getFullYear(), d0.getMonth() + k, 1);
        if (freq === "YEARLY" && months && (months.indexOf(base.getMonth()) < 0 || (k / 12 | 0) % iv)) continue;
        var last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate(), hits = [];
        if (bymd.length) bymd.forEach(function (x) { var dm = x < 0 ? last + 1 + x : x; if (dm >= 1 && dm <= last) hits.push(dm); });
        else if (byday.length) byday.forEach(function (x) {
          var mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); if (!mm) return;
          var wd = WD.indexOf(mm[2]), all = [];
          for (var dm = 1; dm <= last; dm++) if (new Date(base.getFullYear(), base.getMonth(), dm).getDay() === wd) all.push(dm);
          if (!mm[1]) hits = hits.concat(all); else { var nth = parseInt(mm[1], 10), pick = nth > 0 ? all[nth - 1] : all[all.length + nth]; if (pick) hits.push(pick); }
        });
        else if (d0.getDate() <= last) hits.push(d0.getDate());
        hits.sort(function (a, b) { return a - b; });
        for (var h = 0; h < hits.length; h++) { if (!emit(hms(new Date(base.getFullYear(), base.getMonth(), hits[h])))) break outer2; }
      }
    } else out.push(start);
    return out;
  }
  // the events between from and to (ms), soonest first: [{ title, start, end, allDay }]
  function parseIcs(text, from, to, max) {
    max = max || 60;
    var lines = unfold(text).split("\n"), evs = [], cur = null, depth = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^BEGIN:VEVENT$/i.test(l)) { cur = { ex: [] }; depth = 0; continue; }
      if (!cur) continue;
      if (/^BEGIN:/i.test(l)) { depth++; continue; }   // an alarm inside the event
      if (/^END:VEVENT$/i.test(l)) { evs.push(cur); cur = null; continue; }
      if (/^END:/i.test(l)) { depth--; continue; }
      if (depth > 0) continue;
      var p = prop(l);
      if (!p) continue;
      if (p.name === "SUMMARY") cur.title = line(unesc(p.value), 120);
      else if (p.name === "DTSTART") cur.start = when(p.value, p.params);
      else if (p.name === "DTEND") cur.end = when(p.value, p.params);
      else if (p.name === "DURATION") cur.dur = duration(p.value);
      else if (p.name === "RRULE") cur.rule = rrule(p.value);
      else if (p.name === "EXDATE") p.value.split(",").forEach(function (x) { var w = when(x, p.params); if (w) cur.ex.push(w.ms); });
      else if (p.name === "RECURRENCE-ID") cur.rid = when(p.value, p.params);
      else if (p.name === "UID") cur.uid = p.value;
      else if (p.name === "STATUS") cur.status = p.value.toUpperCase();
    }
    // a changed date of a repeat replaces that date (and a cancelled one removes it)
    var moved = {};
    evs.forEach(function (e) { if (e.rid && e.uid) moved[e.uid + "@" + e.rid.ms] = true; });
    var out = [];
    evs.forEach(function (e) {
      if (!e.start || isNaN(e.start.ms)) return;
      var len = e.end && !isNaN(e.end.ms) ? Math.max(0, e.end.ms - e.start.ms) : e.dur != null ? Math.max(0, e.dur) : e.start.allDay ? 86400000 : 0;
      var starts = e.rule && !e.rid ? repeats(e.start.ms, e.rule, from, to, 500) : [e.start.ms];
      starts.forEach(function (s) {
        if (e.status === "CANCELLED") return;
        if (e.ex.indexOf(s) >= 0 || (!e.rid && e.uid && moved[e.uid + "@" + s])) return;
        var end = s + len;
        if (e.start.allDay) { var sd = new Date(s), ed = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() + Math.max(1, Math.round(len / 86400000))); end = ed.getTime(); }
        if (end > from && s < to) out.push({ title: e.title || "Busy", start: s, end: end, allDay: !!e.start.allDay });
      });
    });
    out.sort(function (a, b) { return a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0); });
    return out.slice(0, max);
  }
  // the calendar answer is a calendar at all (not a sign in page)
  function isIcs(text) { return /BEGIN:VCALENDAR/i.test(String(text || "").slice(0, 2000)); }

  // ---------------- when a photo was taken ----------------
  function ymd(y, m, d) {
    y = +y; m = +m; d = +d;
    var now = new Date();
    if (!(y >= 1900 && y <= now.getFullYear() + 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    var t = new Date(y, m - 1, d);
    return t.getMonth() === m - 1 ? { y: y, m: m, d: d } : null;
  }
  // the date inside a JPEG's EXIF block (DateTimeOriginal, else the camera's DateTime): {y, m, d} or null
  function exifDate(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    var at = 2;
    while (at + 4 < b.length) {
      if (b[at] !== 0xff) return null;
      var mk = b[at + 1], len = (b[at + 2] << 8) | b[at + 3];
      if (mk === 0xda || mk === 0xd9) return null;   // the picture itself: no EXIF before it
      if (mk === 0xe1 && b[at + 4] === 0x45 && b[at + 5] === 0x78 && b[at + 6] === 0x69 && b[at + 7] === 0x66) return tiffDate(b, at + 10, Math.min(b.length, at + 2 + len));
      at += 2 + len;
    }
    return null;
  }
  function tiffDate(b, t, end) {
    if (t + 8 > end) return null;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
    var u16 = function (o) { return o + 2 > end ? -1 : le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; };
    var u32 = function (o) { return o + 4 > end ? -1 : le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216 : (b[o] * 16777216) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); };
    var ascii = function (off, n) { var s = ""; for (var i = 0; i < n && t + off + i < end; i++) { var c = b[t + off + i]; if (!c) break; s += String.fromCharCode(c); } return s; };
    var read = function (ifd, want) {
      var o = t + ifd, n = u16(o), found = {};
      if (n < 0 || n > 500) return found;
      for (var i = 0; i < n; i++) {
        var e = o + 2 + i * 12, tag = u16(e);
        if (want.indexOf(tag) >= 0) found[tag] = tag === 0x8769 ? u32(e + 8) : ascii(u32(e + 8), 19);
      }
      return found;
    };
    var ifd0 = u32(t + 4), top = read(ifd0, [0x8769, 0x0132]), sub = top[0x8769] > 0 ? read(top[0x8769], [0x9003, 0x9004]) : {};
    var tries = [sub[0x9003], sub[0x9004], top[0x0132]];
    for (var i = 0; i < tries.length; i++) {
      var m = /^(\d{4}):(\d{2}):(\d{2})/.exec(tries[i] || ""), d = m ? ymd(m[1], m[2], m[3]) : null;
      if (d) return d;
    }
    return null;
  }
  // a date in a file name: the launcher's own "-t20231118" note, a phone's IMG_20231118_..., PXL_20231118,
  // 2023-11-18 or 2023_11_18. Never a run of digits inside a longer number.
  function nameDate(name) {
    var s = String(name || "").split(/[?#]/)[0].split("/").pop();
    var m = /-t(\d{4})(\d{2})(\d{2})\.jpg$/i.exec(s) || /(?:^|[^0-9])((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?![0-9])/.exec(s);
    return m ? ymd(m[1], m[2], m[3]) : null;
  }
  // the photos taken on this day in other years, the most years ago first: [{ src, years }]
  function onThisDay(photos, today) {
    today = today || new Date();
    var m = today.getMonth() + 1, d = today.getDate(), y = today.getFullYear();
    return arr(photos).filter(function (p) { return p && p.date && p.date.m === m && p.date.d === d && p.date.y < y; })
      .map(function (p) { return { src: p.src, years: y - p.date.y }; })
      .sort(function (a, b) { return b.years - a.years; });
  }

  // ---------------- screen time ----------------
  function hm(min) {
    min = Math.max(0, Math.round(min || 0));
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
  }
  // the line under today's total: what is left of the goal, or how far over it
  function goalLine(min, goal) {
    if (!goal) return "";
    var left = goal - Math.round(min || 0);
    return left > 0 ? hm(left) + " left of " + hm(goal) : left === 0 ? "Right on today's " + hm(goal) : hm(-left) + " over today's " + hm(goal);
  }

  // ---------------- the store ----------------
  // io: { get(key) -> string or null, set(key, string) }: the launcher's private store or the page's
  function store(io) {
    var rec = null;
    var read = function () {
      if (rec) return rec;
      var raw = null;
      try { raw = io.get(KEY); } catch (e) { raw = null; }
      try { rec = clean(raw ? JSON.parse(raw) : {}); } catch (e) { rec = clean({}); }
      return rec;
    };
    var write = function (r) { rec = clean(r); try { io.set(KEY, JSON.stringify(rec)); } catch (e) {} return rec; };
    var copy = function () { return JSON.parse(JSON.stringify(read())); };
    return {
      get: copy,
      put: write,
      // one change: fn gets a copy to change, the result is checked and kept
      edit: function (fn) { var r = copy(); fn(r); return write(r); },
      // tick or untick one item of one list
      tick: function (li, ii) {
        var r = copy(), l = r.lists && r.lists[li], it = l && l.items[ii];
        if (!it) return false;
        it.done = !it.done;
        write(r);
        return true;
      }
    };
  }

  var API = { KEY: KEY, LIM: LIM, SEC: SEC, GOALS: GOALS, clean: clean, calUrl: calUrl, calHost: calHost, wifiQr: wifiQr, parseIcs: parseIcs, isIcs: isIcs,
    TIMES_IN: TIMES_IN, TIMES_OUT: TIMES_OUT, guestName: guestName, guestWord: guestWord, guestFull: guestFull, staysOf: staysOf, stayNow: stayNow, dayKey: dayKey,
    exifDate: exifDate, nameDate: nameDate, onThisDay: onThisDay, hm: hm, goalLine: goalLine, store: store };
  root.CouchAtHome = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
