// Reminders: said into the remote's mic (Android's own speech screen, MainActivity.listen) or typed
// in a preview on a computer, then checked on a small calendar: the date, the time (or all day).
// Kept on this TV only (app.js keep/kept). The next few show at the top right of the Night home, and
// one that is due pops up while the home is on screen, with Done and Snooze.
//
// app.js hands over the keys while zone is "remind" (open, paint, move, ok, back) and calls tick()
// with the clock. Everything here is English for now.
(function () {
  "use strict";
  var KEY = "tvhome.reminders", MAX = 60, SNOOZE_MIN = 10, ALL_DAY_H = 9;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON3 = MONTHS.map(function (m) { return m.slice(0, 3).toLowerCase(); });
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var ctx = null, list = [], st = null, msg = "";

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function day0(d) { var x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  // ---------------- what was said: the reminder, its day and its time ----------------
  var NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, fifty: 50, half: 0.5 };
  var WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
  function monthIndex(w) { return MON3.indexOf(w.slice(0, 3)); }
  function ordinal(n) { return parseInt(n, 10); }

  function parse(text, base) {
    base = base || new Date();
    var s = " " + String(text || "").toLowerCase().replace(/[,!?]/g, " ").replace(/(\d)\.(\d)/g, "$1:$2").replace(/\./g, " ").replace(/\s+/g, " ") + " ";
    var day = null, time = null, m;
    var cut = function (re) { s = s.replace(re, " "); };

    // "in 20 minutes", "in an hour", "in 3 days", "in half an hour"
    m = s.match(/ in (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|fifty|half) ?(?:an )?(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks) /);
    if (m) {
      var n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : NUM[m[1]];
      var u = m[2].charAt(0), at = new Date(base.getTime());
      if (u === "m") at = new Date(base.getTime() + n * 60000);
      else if (u === "h") at = new Date(base.getTime() + n * 3600000);
      else if (u === "d") at = addDays(base, n);
      else at = addDays(base, n * 7);
      day = day0(at);
      if (u === "m" || u === "h") time = { h: at.getHours(), m: at.getMinutes() };
      cut(m[0]);
    }
    // "the day after tomorrow", "tomorrow", "today", "tonight", "next week"
    if (!day && / day after tomorrow /.test(s)) { day = day0(addDays(base, 2)); cut(/ (the )?day after tomorrow /); }
    if (!day && / tomorrow /.test(s)) { day = day0(addDays(base, 1)); cut(/ tomorrow /); }
    if (!day && / today /.test(s)) { day = day0(base); cut(/ today /); }
    if (/ tonight /.test(s)) { if (!day) day = day0(base); if (!time) time = { h: 20, m: 0, soft: true }; cut(/ tonight /); }
    if (!day && / next week /.test(s)) { day = day0(addDays(base, 7)); cut(/ next week /); }
    // "on Friday", "next Friday", "this Friday"
    if (!day && (m = s.match(/ (?:on |next |this |coming )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday) /))) {
      var want = WD.indexOf(m[1]), ahead = (want - base.getDay() + 7) % 7 || 7;   // the next one, never today
      day = day0(addDays(base, ahead));
      cut(m[0]);
    }
    // "November 20", "Nov 20th", "20th of November", "20 November"
    if (!day && (m = s.match(new RegExp(" (?:on )?" + MONTH_RE + " (?:the )?(\\d{1,2})(?:st|nd|rd|th)? ")))) {
      day = monthDay(base, monthIndex(m[1]), ordinal(m[2]));
      cut(m[0]);
    } else if (!day && (m = s.match(new RegExp(" (?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?" + MONTH_RE + " ")))) {
      day = monthDay(base, monthIndex(m[2]), ordinal(m[1]));
      cut(m[0]);
    }
    // "on the 20th"
    if (!day && (m = s.match(/ (?:on )?the (\d{1,2})(?:st|nd|rd|th) /))) {
      var dn = ordinal(m[1]);
      if (dn >= 1 && dn <= 31) {
        var c = new Date(base.getFullYear(), base.getMonth(), dn);
        if (c.getDate() !== dn || day0(c) < day0(base)) c = new Date(base.getFullYear(), base.getMonth() + 1, dn);
        day = day0(c);
        cut(m[0]);
      }
    }
    // "11/20"
    if (!day && (m = s.match(/ (\d{1,2})\/(\d{1,2}) /))) { day = monthDay(base, parseInt(m[1], 10) - 1, parseInt(m[2], 10)); cut(m[0]); }

    // times: "at 6:30 pm", "6 p m", "at 18:30", "at 6", noon, midnight, parts of the day
    if (!time || time.soft) {
      if ((m = s.match(/ (?:at |by |around )?(\d{1,2})(?::(\d{2}))? ?(a ?m|p ?m|o'?clock) /))) {
        var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0, ap = m[3].replace(/ /g, "");
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
        if (/o'?clock/.test(ap) && h >= 1 && h <= 6) h += 12;
        if (h < 24 && mi < 60) { time = { h: h, m: mi }; cut(m[0]); }
      } else if ((m = s.match(/ (?:at |by |around )(\d{1,2})(?::(\d{2}))? /)) || (m = s.match(/ (\d{1,2}):(\d{2}) /))) {
        var h2 = parseInt(m[1], 10), m2 = m[2] ? parseInt(m[2], 10) : 0;
        if (h2 >= 1 && h2 <= 6) h2 += 12;   // "at 6" almost always means the evening
        if (h2 < 24 && m2 < 60) { time = { h: h2, m: m2, bare: h2 < 12 }; cut(m[0]); }
      } else if (/ (?:at )?noon /.test(s)) { time = { h: 12, m: 0 }; cut(/ (?:at )?noon /); }
      else if (/ (?:at )?midnight /.test(s)) { time = { h: 23, m: 59 }; cut(/ (?:at )?midnight /); }
    }
    var parts = [[/ (?:in the |this )?morning /, 9], [/ (?:in the |this )?afternoon /, 15], [/ (?:in the |this )?evening /, 18], [/ at night /, 21]];
    parts.forEach(function (p) {
      if (p[0].test(s)) {
        if (!time || time.soft) time = { h: p[1], m: 0 };
        else if (p[1] >= 15 && time.h < 12) time.h += 12;   // "at 7 in the evening"
        cut(p[0]);
      }
    });
    if (time) delete time.soft;
    // "at 7" said at 3 pm with no day: 7 tonight, not 7 tomorrow morning
    var nowMin = base.getHours() * 60 + base.getMinutes();
    if (time && time.bare && !day && time.h * 60 + time.m <= nowMin && (time.h + 12) * 60 + time.m > nowMin) time.h += 12;
    if (time) delete time.bare;

    if (!day) {
      day = day0(base);
      if (time && (time.h * 60 + time.m) <= base.getHours() * 60 + base.getMinutes()) day = addDays(day, 1);
    }
    var what = s.replace(/^ *(?:hey google |ok google )?(?:please )?(?:set |add |make |create )?(?:a |me a )?(?:reminder|remind me|remind us|reminders?)(?: for me| for us)?(?: to| that| about| for)? /, " ")
      .replace(/^ *(?:don'?t forget|remember)(?: to)? /, " ")
      .replace(/ (?:on|at|by|for|in|the)\s*$/g, " ")
      .replace(/\s+/g, " ").trim();
    // the words keep the capitals they were said with ("Mom", "Netflix"), matched back from the original
    var orig = {};
    String(text || "").replace(/[,!?.]/g, " ").split(/\s+/).forEach(function (w) { if (w && w !== w.toLowerCase()) orig[w.toLowerCase()] = w; });
    what = what.split(" ").map(function (w) { return orig[w] || w; }).join(" ");
    what = what ? what.charAt(0).toUpperCase() + what.slice(1) : "Reminder";
    return { text: what.slice(0, 80), day: day, time: time };
  }
  function monthDay(base, mo, dn) {
    if (mo < 0 || mo > 11 || !(dn >= 1 && dn <= 31)) return null;
    var c = new Date(base.getFullYear(), mo, dn);
    if (c.getMonth() !== mo) return null;
    if (day0(c) < day0(base)) c = new Date(base.getFullYear() + 1, mo, dn);
    return day0(c);
  }

  // ---------------- keeping them ----------------
  function valid(r) { return r && typeof r.text === "string" && typeof r.at === "number" && isFinite(r.at); }
  function load() { var v = ctx.kept(KEY); list = Array.isArray(v) ? v.filter(valid) : []; }
  function save() {
    // done ones go a day after they were done; at most MAX kept
    var cut = Date.now() - 86400000;
    list = list.filter(function (r) { return !r.done || (r.doneAt || 0) > cut; }).slice(-MAX);
    ctx.keep(KEY, list);
  }
  function upcoming() {
    return list.filter(function (r) { return !r.done; }).sort(function (a, b) { return a.at - b.at; });
  }
  function atOf(day, time) {
    var d = new Date(day.getTime());
    if (time) d.setHours(time.h, time.m, 0, 0); else d.setHours(ALL_DAY_H, 0, 0, 0);
    return d.getTime();
  }

  // ---------------- words for a time ----------------
  function clockText(d) {
    var h = d.getHours(), m = d.getMinutes(), mm = (m < 10 ? "0" : "") + m;
    if (ctx.clock24()) return (h < 10 ? "0" : "") + h + ":" + mm;
    return (h % 12 || 12) + ":" + mm + (h < 12 ? " AM" : " PM");
  }
  function whenText(r, short) {
    var d = new Date(r.at), today = day0(new Date()), dd = day0(d), label;
    if (sameDay(dd, today)) label = "Today";
    else if (sameDay(dd, addDays(today, 1))) label = "Tomorrow";
    else if (dd > today && dd < addDays(today, 7)) label = DAYS[d.getDay()];
    else label = (short ? DAYS[d.getDay()].slice(0, 3) + " " : DAYS[d.getDay()] + " ") + d.getDate() + " " + (short ? MONTHS[d.getMonth()].slice(0, 3) : MONTHS[d.getMonth()]);
    return r.allDay ? label : label + ", " + clockText(d);
  }

  // ---------------- the top right list on the home ----------------
  function renderChips() {
    var box = $("rem-chips");
    if (!box) return;
    var now = Date.now(), up = upcoming().slice(0, 3);
    box.innerHTML = up.map(function (r) {
      var due = r.at <= now;
      return '<div class="rem-chip' + (due ? " due" : "") + '"><span class="rem-dot"></span><span class="rem-t"><b>' + esc(r.text) +
        '</b><i>' + esc(whenText(r, true)) + (r.who ? " · " + esc(r.who) : "") + "</i></span></div>";
    }).join("");
    box.classList.toggle("on", up.length > 0);
  }

  // ---------------- the panel (zone "remind") ----------------
  // st.view: "list" (New reminder, then the ones kept), "edit" (the calendar card), "due" (one that is due)
  function panel() { return $("rem-panel"); }
  function open() {
    load();
    st = { view: "list", i: 0, act: -1, ai: 0 };
    msg = "";
    panel().classList.add("on");
    paint();
  }
  function close() {
    st = null;
    panel().classList.remove("on");
    renderChips();
    ctx.done();
  }

  function listen() {
    msg = "";
    var ok = false;
    if (ctx.canListen()) {
      st.listening = true;
      paint();
      ok = ctx.listen("Say your reminder, like “Call Mom tomorrow at 6 pm”");
    }
    if (!ok) {   // no speech screen (a preview on a computer): type it instead
      st.listening = false;
      var typed = null;
      try { typed = window.prompt("Reminder (for example: Call Mom tomorrow at 6 pm)"); } catch (e) {}
      heard(typed);
    }
  }
  function heard(text) {
    if (!st) return;
    st.listening = false;
    if (!text || !String(text).trim()) {
      msg = "Didn’t catch that. Press OK to try again.";
      if (st.view !== "edit") st.view = "list";
      paint();
      return;
    }
    var p = parse(text, new Date()), keepId = st.view === "edit" && st.edit ? st.edit.id : null;
    st.view = "edit";
    st.edit = { id: keepId, text: p.text, said: String(text), day: p.day, time: p.time || { h: 18, m: 0 }, allDay: !p.time };
    st.row = 4; st.btn = 0;   // straight to Save: most of the time it heard it right
    msg = "";
    paint();
  }

  function editFrom(r) {
    var d = new Date(r.at);
    st.view = "edit";
    st.edit = { id: r.id, text: r.text, said: r.said || r.text, day: day0(d), time: { h: d.getHours(), m: d.getMinutes() }, allDay: !!r.allDay };
    st.row = 2; st.btn = 0;
  }
  function saveEdit() {
    var e = st.edit, at = atOf(e.day, e.allDay ? null : e.time);
    var r = e.id ? list.filter(function (x) { return x.id === e.id; })[0] : null;
    if (!r) { r = { id: "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), who: ctx.who() }; list.push(r); }
    r.text = e.text; r.said = e.said; r.at = at; r.allDay = e.allDay; r.done = false; r.alerted = at <= Date.now() - 60000;
    save();
    ctx.toast("Reminder saved: " + e.text + ", " + whenText(r));
    st.view = "list"; st.i = 1 + upcoming().indexOf(r); st.act = -1;
    paint();
  }

  // rows of the calendar card: 0 what (OK: say it again), 1 month, 2 day, 3 time, 4 Save / Cancel
  function move(dx, dy) {
    if (!st) return;
    if (st.view === "list") {
      var n = 1 + upcoming().length;
      if (st.act >= 0) { if (dx) st.ai = Math.max(0, Math.min(2, st.ai + dx)); else if (dy) { st.act = -1; st.i = Math.max(0, Math.min(n - 1, st.i + dy)); } }
      else if (dy) st.i = Math.max(0, Math.min(n - 1, st.i + dy));
    } else if (st.view === "edit") {
      var e = st.edit;
      if (dy) st.row = Math.max(0, Math.min(4, st.row + dy));
      else if (dx) {
        if (st.row === 1) { var nd = new Date(e.day.getFullYear(), e.day.getMonth() + dx, 1), last = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate(); nd.setDate(Math.min(e.day.getDate(), last)); e.day = clampDay(nd); }
        else if (st.row === 2) e.day = clampDay(addDays(e.day, dx));
        else if (st.row === 3) {
          if (e.allDay) { e.allDay = false; }
          else { var t = e.time.h * 60 + e.time.m; t = Math.round(t / 15) * 15 + dx * 15; t = (t + 1440) % 1440; e.time = { h: Math.floor(t / 60), m: t % 60 }; }
        }
        else if (st.row === 4) st.btn = Math.max(0, Math.min(1, st.btn + dx));
      }
    } else if (st.view === "due") {
      if (dx) st.btn = Math.max(0, Math.min(1, st.btn + dx));
    }
    paint();
  }
  function clampDay(d) { var t = day0(new Date()); return d < t ? t : d; }

  function ok() {
    if (!st) return;
    if (st.view === "list") {
      if (st.i === 0) { listen(); return; }
      var r = upcoming()[st.i - 1];
      if (!r) return;
      if (st.act < 0) { st.act = st.i; st.ai = 0; paint(); return; }
      if (st.ai === 0) { r.done = true; r.doneAt = Date.now(); save(); ctx.toast("Done: " + r.text); }
      else if (st.ai === 1) { editFrom(r); paint(); return; }
      else { list = list.filter(function (x) { return x !== r; }); save(); ctx.toast("Deleted: " + r.text); }
      st.act = -1; st.i = Math.max(0, Math.min(upcoming().length, st.i));
      paint();
    } else if (st.view === "edit") {
      if (st.row === 0) listen();
      else if (st.row === 3) { st.edit.allDay = !st.edit.allDay; paint(); }
      else if (st.row === 4) { if (st.btn === 0) saveEdit(); else { st.view = "list"; st.act = -1; paint(); } }
      else { st.row = 4; st.btn = 0; paint(); }
    } else if (st.view === "due") {
      var d = list.filter(function (x) { return x.id === st.due; })[0];
      if (d) {
        if (st.btn === 0) { d.done = true; d.doneAt = Date.now(); }
        else { d.at = Date.now() + SNOOZE_MIN * 60000; d.alerted = false; ctx.toast("Snoozed for " + SNOOZE_MIN + " minutes"); }
        save();
      }
      close();
    }
  }
  function back() {
    if (!st) return;
    if (st.view === "list" && st.act >= 0) { st.act = -1; paint(); return; }
    if (st.view === "edit") { st.view = "list"; st.act = -1; msg = ""; paint(); return; }
    if (st.view === "due") { st.btn = 1; ok(); return; }   // Back on a due reminder snoozes it
    close();
  }

  function calendarHTML(e) {
    var first = new Date(e.day.getFullYear(), e.day.getMonth(), 1), today = day0(new Date());
    var lead = first.getDay(), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(), out = "";
    out += DAYS.map(function (d) { return '<span class="rem-dow">' + d.charAt(0) + "</span>"; }).join("");
    for (var k = 0; k < lead; k++) out += "<span></span>";
    for (var dn = 1; dn <= days; dn++) {
      var cd = new Date(first.getFullYear(), first.getMonth(), dn), cls = "rem-d";
      if (sameDay(cd, e.day)) cls += " sel";
      if (sameDay(cd, today)) cls += " today";
      if (cd < today) cls += " past";
      out += '<span class="' + cls + '">' + dn + "</span>";
    }
    return '<div class="rem-cal">' + out + "</div>";
  }

  function paint() {
    renderChips();
    var box = panel();
    if (!st || !box) return;
    var h = "";
    if (st.view === "list") {
      var up = upcoming();
      h += '<h2 class="rem-h">Reminders</h2>';
      h += '<div class="rem-row rem-new' + (st.i === 0 && st.act < 0 ? " focus" : "") + '"><span class="rem-mic">' + MIC + '</span><span><b>New reminder</b><i>' +
        (st.listening ? "Listening… speak into your remote" : "Press OK, then hold the mic button on your remote and speak") + "</i></span></div>";
      if (!up.length) h += '<p class="rem-empty">No reminders yet. Try “Pay the electricity bill on the 20th”.</p>';
      up.forEach(function (r, k) {
        var i = k + 1, due = r.at <= Date.now();
        h += '<div class="rem-row' + (st.i === i && st.act < 0 ? " focus" : "") + (due ? " due" : "") + '"><span class="rem-dot"></span><span><b>' + esc(r.text) + "</b><i>" +
          esc(whenText(r)) + (r.who ? " · added by " + esc(r.who) : "") + "</i></span></div>";
        if (st.act === i) {
          h += '<div class="rem-acts">' + ["Done", "Change date", "Delete"].map(function (a, j) {
            return '<span class="rem-btn' + (st.ai === j ? " focus" : "") + '">' + a + "</span>";
          }).join("") + "</div>";
        }
      });
    } else if (st.view === "edit") {
      var e = st.edit, mo = MONTHS[e.day.getMonth()] + " " + e.day.getFullYear();
      var tt = e.allDay ? "All day" : clockText(new Date(2000, 0, 1, e.time.h, e.time.m));
      var row = function (n, inner, extra) { return '<div class="rem-erow' + (st.row === n ? " focus" : "") + (extra || "") + '">' + inner + "</div>"; };
      h += '<h2 class="rem-h">Check your reminder</h2>';
      h += row(0, '<span class="rem-lbl">Reminder</span><span class="rem-val"><b>' + esc(e.text) + '</b><i>OK to say it again</i></span>');
      h += row(1, '<span class="rem-lbl">Month</span><span class="rem-val rem-arrows"><span class="rem-a">‹</span>' + esc(mo) + '<span class="rem-a">›</span></span>');
      h += row(2, '<span class="rem-lbl">Day</span><span class="rem-val">' + esc(DAYS[e.day.getDay()] + " " + e.day.getDate() + " " + MONTHS[e.day.getMonth()]) + "</span>" + calendarHTML(e), " rem-dayrow");
      h += row(3, '<span class="rem-lbl">Time</span><span class="rem-val rem-arrows"><span class="rem-a">‹</span>' + esc(tt) + '<span class="rem-a">›</span><i>OK: all day or a time</i></span>');
      h += '<div class="rem-acts rem-save">' + ["Save", "Cancel"].map(function (a, j) {
        return '<span class="rem-btn' + (st.row === 4 && st.btn === j ? " focus" : "") + (j === 0 ? " primary" : "") + '">' + a + "</span>";
      }).join("") + "</div>";
      if (e.said && e.said.toLowerCase() !== e.text.toLowerCase()) h += '<p class="rem-heard">Heard: “' + esc(e.said) + "”</p>";
    } else if (st.view === "due") {
      var d = list.filter(function (x) { return x.id === st.due; })[0];
      h += '<div class="rem-bell">' + BELL + '</div><h2 class="rem-h">' + esc(d ? d.text : "Reminder") + "</h2>";
      h += '<p class="rem-when">' + esc(d ? whenText(d) + (d.who ? " · from " + d.who : "") : "") + "</p>";
      h += '<div class="rem-acts rem-save">' + ["Done", "Snooze " + SNOOZE_MIN + " min"].map(function (a, j) {
        return '<span class="rem-btn' + (st.btn === j ? " focus" : "") + (j === 0 ? " primary" : "") + '">' + esc(a) + "</span>";
      }).join("") + "</div>";
    }
    if (msg) h += '<p class="rem-msg">' + esc(msg) + "</p>";
    h += '<p class="rem-hint">' + (st.view === "edit" ? "Up and down to move, left and right to change, Back to cancel" : st.view === "due" ? "Back snoozes it" : "OK on a reminder: done, change the date or delete. Back to close") + "</p>";
    box.className = "rem-panel on rem-" + st.view;
    box.innerHTML = h;
  }

  // ---------------- due ones ----------------
  // Called with the clock (every 15 s). A due reminder pops up only while the home is on screen and
  // nothing else is open; otherwise it waits, glowing in the list, until the home is back.
  function tick() {
    if (!ctx) return;
    load();
    renderChips();
    if (st || !ctx.canAlert()) return;
    var now = Date.now(), due = upcoming().filter(function (r) { return r.at <= now && !r.alerted; })[0];
    if (!due) return;
    due.alerted = true;
    save();
    st = { view: "due", due: due.id, btn: 0 };
    ctx.takeKeys();
    panel().classList.add("on");
    paint();
  }

  var MIC = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>';
  var BELL = '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';

  window.Reminders = {
    init: function (c) { ctx = c; load(); renderChips(); },
    open: open, close: close, paint: paint, move: move, ok: ok, back: back, tick: tick,
    heard: heard, isOpen: function () { return !!st; },
    parse: parse   // for tests
  };
})();
