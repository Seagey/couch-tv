/* couch-tv Studio icon sets.
 *
 * One drawing per concept on a 24 unit grid, rendered in six styles. Everything
 * here is plain data plus string building: no fetch, no DOM, no eval, no event
 * handlers, no <script> or <style> inside any SVG. Safe under a strict CSP.
 *
 *   TVIcons.styles            [{ id, name, note }]
 *   TVIcons.concepts          [{ id, label, group, tint }]
 *   TVIcons.avatars           [{ id, label, family }]
 *   TVIcons.svg(style, name, size, colour)   -> "<svg ...>...</svg>"
 *   TVIcons.avatar(name, size, opts)         -> "<svg ...>...</svg>"  (opts.letter for monograms)
 *
 * Grid and stroke rules: README.md in this folder.
 * Written in ES5 on purpose: the couch-tv home runs in old Android TV WebViews.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ geometry helpers
  function f(n) { return String(Math.round(n * 100) / 100); }
  function polar(cx, cy, r, deg) { var a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function line(a, b) { return "M" + f(a[0]) + " " + f(a[1]) + "L" + f(b[0]) + " " + f(b[1]); }

  // Element constructors. Roles:
  //  b body   closed shape. line: outline; duotone: tinted fill + outline; solid: filled
  //  s stroke always a stroke (rays, arcs, handles)
  //  d detail a stroke drawn inside a body. solid: cut out of the body
  //  f fill   always filled (dots, small marks)
  //  k knock  a filled mark inside a body. line: filled; solid: cut out of the body
  function P(role, d, x) { return { r: role, t: "path", a: { d: d }, x: x }; }
  function C(role, cx, cy, r, x) { return { r: role, t: "circle", a: { cx: cx, cy: cy, r: r }, x: x }; }
  function R(role, x0, y0, w, h, rx, x) { return { r: role, t: "rect", a: { x: x0, y: y0, width: w, height: h, rx: rx }, x: x }; }

  function rays(cx, cy, r1, r2, n, start) {
    var d = "";
    for (var i = 0; i < n; i++) { var a = (start || 0) + i * 360 / n; d += line(polar(cx, cy, r1, a), polar(cx, cy, r2, a)); }
    return d;
  }
  // crescent: circle (cx,cy,R) minus circle offset by (ox,oy) with radius r
  function crescent(cx, cy, Rr, ox, oy, r) {
    var d = Math.sqrt(ox * ox + oy * oy), ux = ox / d, uy = oy / d;
    var a = (Rr * Rr - r * r + d * d) / (2 * d), h = Math.sqrt(Rr * Rr - a * a);
    var bx = cx + a * ux, by = cy + a * uy;
    var p1 = [bx - h * uy, by + h * ux], p2 = [bx + h * uy, by - h * ux];
    // outer arc goes the long way round, away from the cutting circle; inner arc bulges into the moon
    var c1 = cross(p1, p2, [cx, cy]);
    return "M" + f(p1[0]) + " " + f(p1[1]) +
      "A" + f(Rr) + " " + f(Rr) + " 0 1 " + (c1 > 0 ? 0 : 1) + " " + f(p2[0]) + " " + f(p2[1]) +
      "A" + f(r) + " " + f(r) + " 0 0 " + (c1 > 0 ? 1 : 0) + " " + f(p1[0]) + " " + f(p1[1]) + "Z";
  }
  function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  // gear with n rounded teeth
  function gear(cx, cy, rOut, rIn, n) {
    var d = "", step = 360 / n, tw = step * 0.15, bw = step * 0.27;
    for (var i = 0; i < n; i++) {
      var a = i * step;
      var pts = [polar(cx, cy, rIn, a - bw), polar(cx, cy, rOut, a - tw), polar(cx, cy, rOut, a + tw), polar(cx, cy, rIn, a + bw)];
      d += (i === 0 ? "M" : "L") + f(pts[0][0]) + " " + f(pts[0][1]);
      d += "L" + f(pts[1][0]) + " " + f(pts[1][1]);
      d += "A" + f(rOut) + " " + f(rOut) + " 0 0 1 " + f(pts[2][0]) + " " + f(pts[2][1]);
      d += "L" + f(pts[3][0]) + " " + f(pts[3][1]);
      var nx = polar(cx, cy, rIn, a + step - bw);
      d += "A" + f(rIn) + " " + f(rIn) + " 0 0 1 " + f(nx[0]) + " " + f(nx[1]);
    }
    return d + "Z";
  }
  // five point star with softened tips (round joins do the softening)
  function star(cx, cy, ro, ri) {
    var d = "";
    for (var i = 0; i < 10; i++) { var p = polar(cx, cy, i % 2 ? ri : ro, i * 36); d += (i ? "L" : "M") + f(p[0]) + " " + f(p[1]); }
    return d + "Z";
  }
  // a cloud that sits on baseline y with its left at x, w wide (h follows)
  function cloud(x, y, w) {
    var s = w / 17;
    function p(px, py) { return f(x + px * s) + " " + f(y + py * s); }
    return "M" + p(4.25, 0) + "A" + f(4.25 * s) + " " + f(4.25 * s) + " 0 0 1 " + p(3.6, -8.45) +
      "A" + f(5.6 * s) + " " + f(5.6 * s) + " 0 0 1 " + p(14.1, -6.9) +
      "A" + f(3.6 * s) + " " + f(3.6 * s) + " 0 0 1 " + p(13.4, 0) + "Z";
  }
  function drop(cx, cy, r) {
    var tip = cy - 1.85 * r;
    return "M" + f(cx) + " " + f(tip) +
      "C" + f(cx + 0.3 * r) + " " + f(tip + 0.55 * r) + " " + f(cx + r) + " " + f(cy - 0.6 * r) + " " + f(cx + r) + " " + f(cy) +
      "A" + f(r) + " " + f(r) + " 0 0 1 " + f(cx - r) + " " + f(cy) +
      "C" + f(cx - r) + " " + f(cy - 0.6 * r) + " " + f(cx - 0.3 * r) + " " + f(tip + 0.55 * r) + " " + f(cx) + " " + f(tip) + "Z";
  }
  function snowflake(cx, cy, r, chev) {
    var d = "";
    for (var i = 0; i < 6; i++) {
      var a = i * 60;
      if (i < 3) d += line(polar(cx, cy, r, a), polar(cx, cy, r, a + 180));
      if (chev) {
        var tip = polar(cx, cy, r * 0.62, a);
        var w1 = polar(cx, cy, r * 0.93, a - 15), w2 = polar(cx, cy, r * 0.93, a + 15);
        d += "M" + f(w1[0]) + " " + f(w1[1]) + "L" + f(tip[0]) + " " + f(tip[1]) + "L" + f(w2[0]) + " " + f(w2[1]);
      }
    }
    return d;
  }
  // fan speed: a smaller fan with one to three airflow arcs (no dimmed parts, so the count reads on a tile)
  var NUMERAL = {
    1: "M17.75 8.75 20 7v10",
    2: "M17.1 9.4a2.45 2.45 0 1 1 4.25 1.65L17.25 16.75h4.5",
    3: "M17.3 7.25h4.05l-2.4 3.2a2.9 2.9 0 1 1-2.05 5"
  };
  function fanSpeed(n) {
    var cx = 8.25, cy = 12, k = .8, out = [P("b", fanBlade(0, cx, cy, k)), P("b", fanBlade(120, cx, cy, k)), P("b", fanBlade(240, cx, cy, k)), C("d", cx, cy, 2.1), C("f", cx, cy, 1)];
    out.push(P("s", NUMERAL[n], { transform: "translate(" + (n === 1 ? -.75 : -.5) + " 0)" }));
    return out;
  }
  //  x occluder: invisible; clears a 1.4 unit gap around itself in every element marked BACK
  var BACK = { back: 1 };
  var MIRROR = { transform: "matrix(-1 0 0 1 24 0)" };
  function mirror(els) { return els.map(function (e) { return { r: e.r, t: e.t, a: e.a, x: MIRROR }; }); }
  function shift(els, dx, dy) { return els.map(function (e) { return { r: e.r, t: e.t, a: e.a, x: { transform: "translate(" + dx + " " + dy + ")" } }; }); }

  // one swept fan blade: a straight leading edge out to a round tip, a curved trailing edge back to the hub
  function fanBlade(rot, cx, cy, k) {
    cx = cx || 12; cy = cy || 12; k = k || 1;
    function q(r, a) { var p = polar(cx, cy, r * k, rot + a); return f(p[0]) + " " + f(p[1]); }
    return "M" + q(2.6, -18) + "C" + q(5.5, -18) + " " + q(8.4, -22) + " " + q(9.1, -6) +
      "C" + q(9.6, 8) + " " + q(9, 30) + " " + q(7.2, 44) +
      "C" + q(5.2, 54) + " " + q(3.6, 56) + " " + q(2.6, 62) + "A" + f(2.6 * k) + " " + f(2.6 * k) + " 0 0 0 " + q(2.6, -18) + "Z";
  }

  // ------------------------------------------------------------------ the drawings
  var PERSON_BODY = "M5 20.25a7 7 0 0 1 14 0 .75.75 0 0 1-.75.75H5.75a.75.75 0 0 1-.75-.75z";
  var CLOUD_MID = cloud(3.5, 19, 17);
  var CLOUD_HIGH = cloud(3.5, 15.75, 17);
  var THERMO = "M9.5 13.4V5.25a2.5 2.5 0 0 1 5 0v8.15a4.5 4.5 0 1 1-5 0z";
  var CONE = "M3.5 9.25A1.25 1.25 0 0 1 4.75 8H7.5l4.35-3.55a.75.75 0 0 1 1.15.6v13.9a.75.75 0 0 1-1.15.6L7.5 16H4.75A1.25 1.25 0 0 1 3.5 14.75z";
  var BULB = "M12 2.75a6.75 6.75 0 0 0-4 12.2c.8.6 1.25 1.4 1.25 2.3v.5h5.5v-.5c0-.9.45-1.7 1.25-2.3a6.75 6.75 0 0 0-4-12.2z";
  var NEXT = [P("b", "M4.5 6.35v11.3a1 1 0 0 0 1.55.83l8.45-5.65a1 1 0 0 0 0-1.66L6.05 5.52a1 1 0 0 0-1.55.83z"), R("b", 16.75, 5.5, 2.75, 13, 1.375)];
  var CONCEPTS = [
    // ---------------------------------------------------------------- people
    ["person", "Person", "people", "indigo", [C("b", 12, 7.5, 3.75), P("b", PERSON_BODY)]],
    ["people", "Everyone", "people", "indigo", [
      C("b", 5.75, 8.25, 2.35, BACK), P("b", "M1.75 18.75a4 4 0 0 1 8 0 .6.6 0 0 1-.6.6H2.35a.6.6 0 0 1-.6-.6z", BACK),
      C("b", 18.25, 8.25, 2.35, BACK), P("b", "M14.25 18.75a4 4 0 0 1 8 0 .6.6 0 0 1-.6.6h-6.8a.6.6 0 0 1-.6-.6z", BACK),
      C("b", 12, 9, 3), P("b", "M6.75 20.25a5.25 5.25 0 0 1 10.5 0 .75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75z"),
      C("x", 12, 9, 3), P("x", "M6.75 20.25a5.25 5.25 0 0 1 10.5 0 .75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75z")]],
    ["person-add", "Add person", "people", "indigo", [
      C("b", 9.5, 7.75, 3.5), P("b", "M3 20.25a6.5 6.5 0 0 1 13 0 .75.75 0 0 1-.75.75H3.75A.75.75 0 0 1 3 20.25z"),
      P("s", "M19 8.25v6M16 11.25h6")]],
    ["kid", "Kid", "people", "indigo", [
      C("b", 8.5, 6.75, 3.25, BACK), P("b", "M2.5 20.25a6 6 0 0 1 12 0 .75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75z", BACK),
      C("b", 16.25, 11.25, 2.5), P("b", "M12.25 20.4a4 4 0 0 1 8 0 .6.6 0 0 1-.6.6h-6.8a.6.6 0 0 1-.6-.6z"),
      C("x", 16.25, 11.25, 2.5), P("x", "M12.25 20.4a4 4 0 0 1 8 0 .6.6 0 0 1-.6.6h-6.8a.6.6 0 0 1-.6-.6z")]],
    ["guest", "Guest", "people", "brown", [
      R("b", 6, 7.75, 12, 11.5, 2.75), P("s", "M10 7.75V4.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v3.25"),
      P("d", "M9.75 10.75v5.5M14.25 10.75v5.5"), C("f", 8.9, 21, 1.2), C("f", 15.1, 21, 1.2)]],
    ["profile", "Profile", "people", "indigo", [
      C("b", 12, 12, 9), C("d", 12, 9.75, 3), P("d", "M6.6 18.15c1.3-2.15 3.2-3.25 5.4-3.25s4.1 1.1 5.4 3.25")]],

    // ---------------------------------------------------------------- climate
    ["aircon", "Aircon", "climate", "teal", [
      R("b", 2.5, 4.5, 19, 9.5, 2.5), P("d", "M6.5 10.5h11"),
      P("s", "M7.25 17.25l-.75 3M12 17.25v3.5M16.75 17.25l.75 3")], { k: .92, dy: .25 }],
    ["cool", "Cool", "climate", "blue", [P("s", snowflake(12, 12, 9.25, true))]],
    ["heat", "Heat", "climate", "orange", [
      P("b", "M12 2.75c.45 3 2.15 4.55 3.85 6.3 1.55 1.6 2.65 3.4 2.65 5.95A6.5 6.5 0 0 1 12 21.5 6.5 6.5 0 0 1 5.5 15c0-2.3 1-4.15 2.6-5.6.2 1.6.9 2.75 2 3.4-.3-3.95.6-7.45 1.9-10.05z"),
      P("d", "M9.25 18.4c0-1.6 1.05-2.65 2.75-4 1.7 1.35 2.75 2.4 2.75 4")]],
    ["dry", "Dry", "climate", "teal", [P("b", drop(12, 14.75, 6.25)), P("d", "M9.1 15.1a3 3 0 0 0 2.4 2.85")]],
    ["fan", "Fan", "climate", "mint", [P("b", fanBlade(0)), P("b", fanBlade(120)), P("b", fanBlade(240)), C("d", 12, 12, 2.6), C("f", 12, 12, 1.3)]],
    ["auto", "Auto", "climate", "purple", [C("b", 12, 12, 9), P("d", "M8.75 16.25 12 7.75l3.25 8.5M9.9 13.4h4.2")]],
    ["fan-low", "Fan low", "climate", "mint", fanSpeed(1)],
    ["fan-medium", "Fan medium", "climate", "mint", fanSpeed(2)],
    ["fan-high", "Fan high", "climate", "mint", fanSpeed(3)],
    ["temperature", "Temperature", "climate", "orange", [P("b", THERMO), P("d", "M12 9.25v8"), K(12, 17.15, 1.6)], { k: 1.1, dy: -.25 }],
    ["temp-up", "Warmer", "climate", "red", shift([P("b", THERMO), P("d", "M12 11v6.15")], -3, 0).concat([P("s", "M18.25 10.5V3.5M15.75 6l2.5-2.5 2.5 2.5")])],
    ["temp-down", "Cooler", "climate", "blue", shift([P("b", THERMO), P("d", "M12 14.5v2.65")], -3, 0).concat([P("s", "M18.25 3.5v7M15.75 8l2.5 2.5 2.5-2.5")])],
    ["humidity", "Humidity", "climate", "teal", [P("b", drop(10, 15.25, 5.75)), P("s", drop(18, 8.5, 2.6))]],
    ["eco", "Eco", "climate", "green", [
      P("b", "M19.75 4.25c-8.75 0-14.25 3.9-14.25 10.3 0 1.65.45 3 1.25 4.2 1.2.8 2.6 1.2 4.25 1.2 6.4 0 8.75-6.6 8.75-15.7z"),
      P("d", "M4.25 20.5c2.6-4.55 6.15-8 10.25-10.5")]],
    ["timer", "Timer", "climate", "orange", [C("b", 12, 13.5, 7.75), P("s", "M9.75 2.75h4.5M18.25 6.9l1.35-1.35"), P("d", "M12 13.5V9")]],
    ["sleep-timer", "Sleep timer", "climate", "indigo", [P("b", crescent(10.5, 13.25, 7.75, 4.6, -4.6, 6.6)), P("s", "M15.5 3.25h4l-4 5h4")]],

    // ---------------------------------------------------------------- rooms
    ["home", "Home", "rooms", "orange", [
      P("b", "M4 10.4 12 3.75l8 6.65V19a1.75 1.75 0 0 1-1.75 1.75H5.75A1.75 1.75 0 0 1 4 19z"),
      P("d", "M9.75 20.75V15.5a2.25 2.25 0 0 1 4.5 0v5.25")]],
    ["living-room", "Living room", "rooms", "orange", [
      P("s", "M5.5 10.25V8a2.5 2.5 0 0 1 2.5-2.5h8a2.5 2.5 0 0 1 2.5 2.5v2.25"),
      P("b", "M3 12.5a2 2 0 0 1 4 0v1.75h10V12.5a2 2 0 0 1 4 0v5.25a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 17.75z"),
      P("s", "M6 19.5v1.5M18 19.5v1.5")]],
    ["bedroom", "Bedroom", "rooms", "indigo", [
      P("s", "M2.75 5.5v15M21.25 14v6.5M2.75 17.75h18.5"),
      R("b", 2.75, 13.75, 18.5, 4, 0),
      P("d", "M3.5 13.75h17"), R("b", 5, 9.75, 5.25, 4, 1.5), P("b", "M12 13.75V11.5a1.75 1.75 0 0 1 1.75-1.75h5.75a1.75 1.75 0 0 1 1.75 1.75v2.25z")]],
    ["kitchen", "Kitchen", "rooms", "orange", [
      P("b", "M4.5 10.5h15v5.5a4.5 4.5 0 0 1-4.5 4.5H9A4.5 4.5 0 0 1 4.5 16z"),
      P("s", "M2.5 12h2M19.5 12h2M3.5 10.5h17"), P("s", "M9.5 3.25c-.85.95-.85 2.2 0 3.25M14.5 3.25c-.85.95-.85 2.2 0 3.25")]],
    ["bathroom", "Bathroom", "rooms", "teal", [
      P("b", "M3 12h18v2.25a5.5 5.5 0 0 1-5.5 5.5h-7A5.5 5.5 0 0 1 3 14.25z"),
      P("s", "M6 12V5.75a2.25 2.25 0 0 1 4.3-.9M9 7.25h3M6.75 19.5 6 21M17.25 19.5 18 21")]],
    ["office", "Office", "rooms", "blue", [R("b", 4.25, 4.25, 15.5, 11, 2), P("d", "M10.5 12.25h3"), P("s", "M2.5 19h19")], { k: 1.06, dy: .25 }],
    ["garden", "Outdoor", "rooms", "green", [
      P("b", "M8.25 3.25 3.9 10.25h2.6L3.4 15.5h9.7l-3.1-5.25h2.6z"), C("b", 16.75, 10.5, 3.75),
      P("s", "M8.25 15.5v5.25M16.75 14.25v6.5M2.75 20.75h18.5")]],
    ["garage", "Garage", "rooms", "grey", [
      P("b", "M3.75 11.75l1.7-4.6A2.25 2.25 0 0 1 7.55 5.6h8.9a2.25 2.25 0 0 1 2.1 1.55l1.7 4.6V17a1.25 1.25 0 0 1-1.25 1.25H5A1.25 1.25 0 0 1 3.75 17z"),
      P("d", "M4 11.75h16"), K(7.5, 15, 1.25), K(16.5, 15, 1.25), P("s", "M6.25 18.25v2.25M17.75 18.25v2.25")]],
    ["games", "Games", "rooms", "purple", [
      P("b", "M7.6 6.75h8.8a4.9 4.9 0 0 1 4.8 3.95l.95 4.85a2.6 2.6 0 0 1-4.45 2.25L15.6 15.5H8.4l-2.1 2.3a2.6 2.6 0 0 1-4.45-2.25l.95-4.85a4.9 4.9 0 0 1 4.8-3.95z"),
      P("d", "M7.75 9.75v3.5M6 11.5h3.5"), K(15.25, 10.4, 1.1), K(17.5, 12.6, 1.1)]],

    // ---------------------------------------------------------------- speakers and music
    ["speaker", "Speaker", "audio", "purple", [R("b", 6, 2.75, 12, 18.5, 3.25), C("d", 12, 14.5, 3.25), C("d", 12, 7.4, 1.4)], { k: 1.04 }],
    ["speakers", "Speaker group", "audio", "purple", [
      P("s", "M6 18H5.75a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2v.25"),
      R("b", 9.25, 5.75, 11, 15.5, 3), C("d", 14.75, 15.75, 2.75), K(14.75, 9.75, 1.1)]],
    ["play", "Play", "audio", "pink", [P("b", "M7.5 5.07v13.86a1.1 1.1 0 0 0 1.68.94l11.1-6.93a1.1 1.1 0 0 0 0-1.88L9.18 4.13a1.1 1.1 0 0 0-1.68.94z", { transform: "translate(-1.25 0)" })]],
    ["pause", "Pause", "audio", "pink", [R("b", 6, 4.5, 4.25, 15, 1.5), R("b", 13.75, 4.5, 4.25, 15, 1.5)]],
    ["next", "Next", "audio", "pink", NEXT],
    ["previous", "Previous", "audio", "pink", mirror(NEXT)],
    ["volume-up", "Volume up", "audio", "pink", [P("b", CONE), P("s", "M16 9a4.25 4.25 0 0 1 0 6M18.75 6.25a8.25 8.25 0 0 1 0 11.5")], { k: .94, dx: .25 }],
    ["volume-down", "Volume down", "audio", "pink", shift([P("b", CONE)], 1.5, 0).concat([P("s", "M17.5 9a4.25 4.25 0 0 1 0 6")])],
    ["mute", "Mute", "audio", "grey", [P("b", CONE), P("s", "M16.5 9.5l5 5M21.5 9.5l-5 5")]],
    ["music", "Music", "audio", "pink", [P("s", "M9.25 17.5V5.6l10-2.1v11.75"), C("b", 6.5, 17.75, 2.75), C("b", 16.5, 15.5, 2.75)]],
    ["shuffle", "Shuffle", "audio", "pink", [P("s", "M3 7h2.9c1.7 0 3 .8 3.9 2.2l4.4 5.6c.9 1.4 2.2 2.2 3.9 2.2H21M3 17h2.9c1.7 0 3-.8 3.9-2.2M14.2 9.2C15.1 7.8 16.4 7 18.1 7H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5")]],
    ["repeat", "Repeat", "audio", "pink", [P("s", "M4 11.5v-1.75A3.75 3.75 0 0 1 7.75 6H20M17.25 3.25 20 6l-2.75 2.75M20 12.5v1.75A3.75 3.75 0 0 1 16.25 18H4M6.75 20.75 4 18l2.75-2.75")]],
    ["airplay", "AirPlay", "audio", "blue", [P("s", "M7 17H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H17"), P("b", "M12 14.5l4.25 5.75h-8.5z")]],
    ["cast", "Cast", "audio", "blue", [P("s", "M3 8.5V6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-5.5M3 12.5a7 7 0 0 1 7 7M3 16a3.5 3.5 0 0 1 3.5 3.5"), C("f", 3.6, 19, 1.15)]],
    ["headphones", "Headphones", "audio", "purple", [P("s", "M3.75 15v-2.75a8.25 8.25 0 0 1 16.5 0V15"), R("b", 3.5, 13.5, 4.25, 7.25, 1.75), R("b", 16.25, 13.5, 4.25, 7.25, 1.75)]],
    ["mic", "Microphone", "audio", "orange", [R("b", 9, 2.75, 6, 11.5, 3), P("s", "M5.75 11.25a6.25 6.25 0 0 0 12.5 0M12 17.5v3.75M9 21.25h6")]],

    // ---------------------------------------------------------------- lights
    ["light", "Light", "lights", "yellow", [P("b", BULB), P("s", "M9.5 20.75h5"), P("d", "M8.9 9.6a3.4 3.4 0 0 1 2.6-3.1")]],
    ["light-off", "Light off", "lights", "grey", [P("b", BULB, BACK), P("s", "M9.5 20.75h5", BACK), P("s", "M3.5 3.5l17 17"), P("x", "M3.5 3.5l17 17")]],
    ["lamp", "Lamp", "lights", "yellow", [P("b", "M8.25 3.5h7.5l3.25 8H5z"), P("s", "M12 11.5v9M8.5 20.5h7")]],
    ["pendant", "Pendant", "lights", "yellow", [P("s", "M12 2.5v4.5"), P("b", "M4 15a8 8 0 0 1 16 0z"), P("s", "M9.75 18.75a2.25 2.25 0 0 0 4.5 0")]],
    ["brightness", "Brightness", "lights", "yellow", [C("b", 12, 12, 4.5), P("k", "M12 7.5a4.5 4.5 0 0 1 0 9z"), P("s", rays(12, 12, 7.25, 9, 8, 0))]],
    ["colour", "Colour", "lights", "pink", [
      P("b", "M12 3a9 9 0 0 0 0 18c1.2 0 1.95-.9 1.95-1.95 0-.5-.2-.9-.5-1.25-.3-.35-.5-.8-.5-1.3 0-1.05.85-1.85 1.9-1.85h2.15A5 5 0 0 0 21 9.75C21 6 17 3 12 3z"),
      K(7.5, 12, 1.35), K(9.5, 7.6, 1.35), K(14.25, 7.1, 1.35), K(17.1, 10.6, 1.35)]],
    ["blinds", "Blinds", "lights", "brown", [P("s", "M3 3.75h18"), R("b", 4.5, 3.75, 15, 12.25, 1), P("d", "M4.5 7.75h15M4.5 11.75h15"), P("s", "M12 16v2.75"), C("f", 12, 19.9, 1.25)]],
    ["outlet", "Power point", "lights", "yellow", [R("b", 2.5, 5, 19, 14, 3.5), P("d", "M7.9 8.75 6.6 11.4M10.1 8.75l1.3 2.65M9 13.75v2.5"), R("k", 15, 9, 3, 6, 1)]],
    // ---------------------------------------------------------------- security
    ["camera", "Camera", "security", "green", [
      P("s", "M3 4.75h18"), P("b", "M5 7.5h14v3.25a7 7 0 0 1-14 0z"), P("d", "M5.25 10.25h13.5"),
      C("d", 12, 13, 2.6), K(12, 13, 1)], { k: 1.12, dy: .75 }],
    ["video", "Video", "security", "green", [R("b", 2.5, 6.25, 13, 11.5, 2.75), P("b", "M15.5 10.25l4.85-2.95a.75.75 0 0 1 1.15.65v8.1a.75.75 0 0 1-1.15.65l-4.85-2.95z")]],
    ["doorbell", "Doorbell", "security", "green", [
      R("b", 4, 3, 16, 18, 4.5),
      P("d", "M12 6.75a3.4 3.4 0 0 0-3.4 3.4v2.35L7.4 14.6h9.2l-1.2-2.1v-2.35A3.4 3.4 0 0 0 12 6.75zM10.6 17.1a1.4 1.4 0 0 0 2.8 0")]],
    ["lock", "Lock", "security", "green", [R("b", 5, 10.25, 14, 10.75, 2.75), P("s", "M8 10.25V7.5a4 4 0 0 1 8 0v2.75"), P("d", "M12 14.25v2.75")]],
    ["unlock", "Unlocked", "security", "orange", [R("b", 5, 10.25, 14, 10.75, 2.75), P("s", "M8 10.25V7.5a4 4 0 0 1 7.75-1.4"), P("d", "M12 14.25v2.75")]],
    ["motion", "Motion", "security", "green", [C("f", 14.75, 4.25, 2),
      P("s", "M14 8.25 12 14M12 14l-2.6 3.6-2.9.9M12 14l2.75 2.6.75 4.65M13.75 8.75 10.5 10.25 9.25 13M13.75 8.75l2 2.75 2.75.9M2.75 9.25h3.5M2.25 13h3.25M3.25 16.75h2.5")]],
    ["shield", "Security", "security", "green", [P("b", "M12 2.75 4.5 5.6v5.65c0 4.75 3.15 8.4 7.5 10 4.35-1.6 7.5-5.25 7.5-10V5.6z"), P("d", "M8.75 12.25 11 14.5l4.25-4.5")]],
    ["bell", "Alerts", "security", "red", [
      P("b", "M12 3a5.75 5.75 0 0 0-5.75 5.75v3.6L4.6 15.2a.9.9 0 0 0 .8 1.35h13.2a.9.9 0 0 0 .8-1.35l-1.65-2.85v-3.6A5.75 5.75 0 0 0 12 3z"),
      P("s", "M9.75 19.5a2.25 2.25 0 0 0 4.5 0")]],

    // ---------------------------------------------------------------- scenes
    ["movie", "Movie night", "scenes", "pink", [
      P("b", "M6 11.75h12l-1.5 8.55a1.5 1.5 0 0 1-1.48 1.2H8.98a1.5 1.5 0 0 1-1.48-1.2z"),
      P("d", "M10.25 12l.35 9.25M13.75 12l-.35 9.25M4.5 11.75h15"),
      P("b", "M5.1 11.75a2.75 2.75 0 0 1 .95-4.85 3.1 3.1 0 0 1 3.7-3.55 3 3 0 0 1 4.5 0 3.1 3.1 0 0 1 3.7 3.55 2.75 2.75 0 0 1 .95 4.85z")]],
    ["film", "Film", "scenes", "pink", [
      R("b", 3, 10, 18, 10.5, 2), P("b", "M3.5 9.75 3 7.2a1.5 1.5 0 0 1 1.2-1.75l13.4-2.5a1.5 1.5 0 0 1 1.75 1.2l.5 2.6z"),
      P("d", "M8.25 5.1l2 3.5M13.25 4.15l2 3.55")]],
    ["bedtime", "Bedtime", "scenes", "indigo", [P("b", crescent(11.5, 8.75, 5.75, 3.6, -3.6, 4.9)), R("b", 3, 15.75, 18, 5.25, 2.6), P("f", "M18.5 2.65l0.63 1.47 1.47 0.63-1.47 0.63-0.63 1.47-0.63-1.47-1.47-0.63 1.47-0.63z")]],
    ["morning", "Morning", "scenes", "orange", [P("s", "M2.75 18.75h18.5M7 21.5h10"), P("b", "M6.75 18.75a5.25 5.25 0 0 1 10.5 0z"), P("s", "M12 4.75V7.5M4.95 9.95l1.75 1.75M19.05 9.95l-1.75 1.75")]],
    ["away", "Away", "scenes", "blue", [
      P("b", "M2.75 10.75 9.25 5.25l6.5 5.5v8.5A1.25 1.25 0 0 1 14.5 20.5H4a1.25 1.25 0 0 1-1.25-1.25z", BACK),
      P("s", "M9.75 15.25h11.5M18 12l3.25 3.25L18 18.5"), P("x", "M9.75 15.25h11.5M18 12l3.25 3.25L18 18.5")]],
    ["party", "Party", "scenes", "pink", [P("b", "M3.6 20.4l4.3-10.85a.8.8 0 0 1 1.3-.27l5.52 5.52a.8.8 0 0 1-.27 1.3z"), P("d", "M5.9 14.6l3.5 3.5"),
      P("s", "M12.25 3c.8 1.55.45 3-.75 4.05M16.75 7.25l1.85-1.85M21 11.75c-1.55-.8-3-.45-4.05.75"), C("f", 16.6, 2.9, 1.15), C("f", 21.1, 7.4, 1.15)]],
    ["dinner", "Dinner", "scenes", "orange", [P("s", "M5.5 3v5a2.75 2.75 0 0 0 5.5 0V3M8.25 3v18M17.5 21V3c1.9 1.25 3 3.6 3 6.75v4.25h-3")]],
    ["reading", "Reading", "scenes", "brown", [P("b", "M12 6.6C10.2 5.1 7.8 4.35 3.25 4.6v14c4.55-.25 6.95.5 8.75 2z"), P("b", "M12 6.6c1.8-1.5 4.2-2.25 8.75-2v14c-4.55-.25-6.95.5-8.75 2z"), P("d", "M12 7v13.4")]],
    ["relax", "Relax", "scenes", "brown", [P("b", "M4 9.5h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"), P("s", "M16 11h1.25a2.75 2.75 0 0 1 0 5.5H16M3 21.25h14M8 3.25c-.75.85-.75 1.9 0 2.85M12 3.25c-.75.85-.75 1.9 0 2.85")]],
    ["favourite", "Favourite", "scenes", "yellow", [P("b", star(12, 12.6, 9.5, 4.1))]],
    ["heart", "Love", "scenes", "pink", [P("b", "M12 20.25C6.5 16.6 3 13.4 3 9.25A4.75 4.75 0 0 1 7.75 4.5c1.8 0 3.25.95 4.25 2.4 1-1.45 2.45-2.4 4.25-2.4A4.75 4.75 0 0 1 21 9.25c0 4.15-3.5 7.35-9 11z")]],

    // ---------------------------------------------------------------- weather
    ["sun", "Sunny", "weather", "yellow", [C("b", 12, 12, 4.25), P("s", rays(12, 12, 6.9, 9.4, 8, 0))]],
    ["clear-night", "Clear night", "weather", "indigo", [P("b", crescent(11, 13, 8.25, 5, -5, 7.25)), P("f", "M18.75 1.5l0.60 1.40 1.40 0.60-1.40 0.60-0.60 1.40-0.60-1.40-1.40-0.60 1.40-0.60z"), P("f", "M20.25 8.5l0.45 1.05 1.05 0.45-1.05 0.45-0.45 1.05-0.45-1.05-1.05-0.45 1.05-0.45z")]],
    ["partly-cloudy", "Partly cloudy", "weather", "blue", [
      C("b", 9, 9, 3.6, BACK), P("s", rays(9, 9, 6, 7.9, 8, 0), BACK),
      P("b", cloud(6.25, 20.5, 15.5)), P("x", cloud(6.25, 20.5, 15.5))], { k: .9, dx: -.5 }],
    // partly cloudy at night: the clear night moon (cut the same way) where the sun was, behind the same cloud
    ["partly-cloudy-night", "Partly cloudy night", "weather", "indigo", [
      P("b", crescent(9, 9.25, 5.6, 3.4, -3.4, 4.9), BACK), P("f", "M18.25 2.25l0.50 1.15 1.15 0.50-1.15 0.50-0.50 1.15-0.50-1.15-1.15-0.50 1.15-0.50z", BACK),
      P("b", cloud(6.25, 20.5, 15.5)), P("x", cloud(6.25, 20.5, 15.5))], { k: .9, dx: -.5 }],
    ["cloud", "Cloudy", "weather", "cyan", [P("b", CLOUD_MID)], { k: 1.08, dy: -1 }],
    ["rain", "Rain", "weather", "blue", [P("b", CLOUD_HIGH), P("s", "M8.5 18.25l-1 2.5M12.5 18.25l-1 2.5M16.5 18.25l-1 2.5")]],
    ["storm", "Storm", "weather", "purple", [P("b", CLOUD_HIGH), P("s", "M12.75 15.75 10.5 19.25h3.25l-2 3")]],
    ["snow", "Snow", "weather", "cyan", [P("b", CLOUD_HIGH), P("s", snowflake(8.25, 19.6, 1.9) + snowflake(15.75, 19.6, 1.9))]],
    ["fog", "Fog", "weather", "grey", [P("b", cloud(3.5, 14.5, 17)), P("s", "M4.5 18h15M7 21h10")], { k: 1.06, dy: -.25 }],
    ["wind", "Wind", "weather", "cyan", [P("s", "M3 8.75h10.5a2.75 2.75 0 1 0-2.75-2.75M3 12.25h15a2.75 2.75 0 1 1-2.75 2.75M3 15.75h6.5")]],
    ["location", "Location", "weather", "red", [P("b", "M12 21.25s-6.75-6.15-6.75-11.4a6.75 6.75 0 0 1 13.5 0c0 5.25-6.75 11.4-6.75 11.4z"), C("d", 12, 9.85, 2.4)]],

    // ---------------------------------------------------------------- system and TV
    ["settings", "Settings", "system", "grey", [P("b", gear(12, 12, 9.25, 7.1, 8)), C("d", 12, 12, 3)], { k: .93 }],
    ["search", "Search", "system", "grey", [C("b", 10.5, 10.5, 6.75), P("s", "M15.5 15.5l5 5")]],
    ["input", "Input", "system", "grey", [R("b", 8.5, 4, 12.75, 16, 2.75, BACK), P("s", "M2.75 12h10.5M10 8.75 13.25 12 10 15.25"), P("x", "M2.75 12h10.5M10 8.75 13.25 12 10 15.25")]],
    ["power", "Power", "system", "red", [P("s", "M12 2.75v8.5M6.85 5.6a8 8 0 1 0 10.3 0")]],
    ["wifi", "Wi-Fi", "system", "blue", [P("s", "M2.6 9.7a13.5 13.5 0 0 1 18.8 0M5.6 12.85a9.25 9.25 0 0 1 12.8 0M8.6 16a5 5 0 0 1 6.8 0"), C("f", 12, 19.25, 1.45)], { k: .94, dy: -.5 }],
    ["bluetooth", "Bluetooth", "system", "blue", [P("s", "M6.75 7.25l10.5 9.25L12 21V3l5.25 4.5-10.5 9.25")]],
    ["tv", "TV", "system", "grey", [R("b", 2.5, 4, 19, 13, 2.25), P("s", "M8 20.5h8M12 17v3.5")]],
    ["remote", "Remote", "system", "grey", [R("b", 8, 2, 8, 20, 4), C("d", 12, 7.5, 2.4), K(12, 7.5, .85), K(12, 13.25, 1), K(12, 16.5, 1)]],
    ["picture", "Picture", "system", "teal", [R("b", 3, 4.5, 18, 15, 2.75), P("d", "M3.25 16.25l4.6-4.6a1.2 1.2 0 0 1 1.7 0l3.2 3.2 2.1-2.1a1.2 1.2 0 0 1 1.7 0l4.2 4.2"), K(15.75, 9, 1.6)]],
    ["apps", "Apps", "system", "grey", [R("b", 3.5, 3.5, 7, 7, 2.25), R("b", 13.5, 3.5, 7, 7, 2.25), R("b", 3.5, 13.5, 7, 7, 2.25), R("b", 13.5, 13.5, 7, 7, 2.25)]],
    ["back", "Back", "system", "grey", [P("s", "M20 12H4.5M10.5 5.5 4 12l6.5 6.5")]],
    ["chevron", "Chevron", "system", "grey", [P("s", "M9 4.75 16.25 12 9 19.25")]],
    ["plus", "Add", "system", "grey", [P("s", "M12 4v16M4 12h16")]],
    ["minus", "Less", "system", "grey", [P("s", "M4 12h16")]],
    ["check", "Done", "system", "green", [P("s", "M4.25 12.75 9.5 18 19.75 6")]],
    ["close", "Close", "system", "grey", [P("s", "M5.5 5.5l13 13M18.5 5.5l-13 13")]],
    ["more", "More", "system", "grey", [C("f", 5, 12, 1.85), C("f", 12, 12, 1.85), C("f", 19, 12, 1.85)]],
    ["info", "Info", "system", "blue", [C("b", 12, 12, 9), P("d", "M12 10.75v6"), K(12, 7.6, 1.25)]],
    ["calendar", "Calendar", "system", "red", [R("b", 3.5, 4.75, 17, 16, 2.75), P("s", "M8 2.75v3.75M16 2.75v3.75"), P("d", "M3.75 9.75h16.5"), K(8, 13.5, 1.1), K(12, 13.5, 1.1), K(16, 13.5, 1.1), K(8, 17, 1.1), K(12, 17, 1.1)]],
    ["clock", "Clock", "system", "grey", [C("b", 12, 12, 9), P("d", "M12 6.75V12l3.5 2.25")]],
    ["sliders", "Adjust", "system", "grey", [P("s", "M3.5 7h9M18.5 7h2M3.5 17h2M11.5 17h9"), C("b", 15.5, 7, 2.75), C("b", 8.5, 17, 2.75)]],
    ["edit", "Edit", "system", "grey", [P("b", "M15.65 4.35a2.1 2.1 0 0 1 2.95 0l1.05 1.05a2.1 2.1 0 0 1 0 2.95L8.75 19.25 4 20.5l1.25-4.75z"), P("d", "M13.75 6.25l4 4")]],
    ["phone", "Phone", "system", "grey", [R("b", 6.25, 2.5, 11.5, 19, 3), P("d", "M10.5 5.6h3M10.25 18.4h3.5")]],
    ["bolt", "Energy", "system", "yellow", [P("b", "M13.25 2.75 4.75 13.5h6.5l-1 7.75 8.5-10.75h-6.5z")]],
    ["download", "Download", "system", "blue", [P("s", "M12 3.25v11.5M7.5 10.25 12 14.75l4.5-4.5M4 16.5v2a2.5 2.5 0 0 0 2.5 2.5h11a2.5 2.5 0 0 0 2.5-2.5v-2")]]
  ];
  function K(cx, cy, r) { return C("k", cx, cy, r); }

  // ------------------------------------------------------------------ colour
  var HUES = {
    red: ["#FF453A", "#FF7A6E", "#E0263A"], orange: ["#FF9F0A", "#FFB547", "#F07800"],
    yellow: ["#FFC80A", "#FFD34D", "#EE9A00"], green: ["#30D158", "#5BE07D", "#16A345"],
    mint: ["#33D6B5", "#66E3C9", "#0FA486"], teal: ["#32C2E0", "#6AD7EE", "#0A8FB5"],
    cyan: ["#5AC8FA", "#86D9FF", "#1B95DE"], blue: ["#0A84FF", "#4FA6FF", "#005FD9"],
    indigo: ["#5E5CE6", "#8785FF", "#4036CC"], purple: ["#BF5AF2", "#D48BFF", "#9634D6"],
    pink: ["#FF375F", "#FF6F8E", "#DD1A4D"], brown: ["#B08A5E", "#CDA87C", "#8A6640"],
    grey: ["#8E8E93", "#A9A9AE", "#5E5E64"],
    clay: ["#D2694A", "#E8906F", "#AE4B2E"], plum: ["#A05195", "#C47AB8", "#7C3573"],
    sage: ["#5FA083", "#86BEA3", "#3F7F62"], slate: ["#5B7290", "#8199B6", "#405571"],
    steel: ["#7A8899", "#9DAABA", "#5A6878"], graphite: ["#5A5A62", "#7E7E87", "#3B3B42"]
  };
  var INK = "#1C1C1E";

  // ------------------------------------------------------------------ rendering
  var SW = 1.75;                 // the one stroke width, in grid units
  var SQUIRCLE = "M12 0c7.6 0 9.5 0 10.8 1.2C24 2.5 24 4.4 24 12s0 9.5-1.2 10.8C21.5 24 19.6 24 12 24s-9.5 0-10.8-1.2C0 21.5 0 19.6 0 12s0-9.5 1.2-10.8C2.5 0 4.4 0 12 0z";
  var uid = 0;

  function esc(v) { return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function el(e, attrs) {
    var s = "<" + e.t, k;
    for (k in e.a) s += " " + k + '="' + esc(typeof e.a[k] === "number" ? f(e.a[k]) : e.a[k]) + '"';
    if (e.x) for (k in e.x) if (k !== "back") s += " " + k + '="' + esc(e.x[k]) + '"';
    for (k in attrs) s += " " + k + '="' + esc(attrs[k]) + '"';
    return s + "/>";
  }
  function pick(g, roles) { return g.filter(function (e) { return roles.indexOf(e.r) >= 0; }); }
  function join(list, attrs) { return list.map(function (e) { return el(e, attrs || {}); }).join(""); }

  // the glyph layers, in grid units, no outer <svg>
  function layerLine(g, col, sw) {
    var st = { fill: "none", stroke: col, "stroke-width": f(sw) };
    return join(pick(g, ["b", "s", "d"]), st) + join(pick(g, ["f", "k"]), { fill: col });
  }
  function layerDuotone(g, col, sw, accent) {
    if (!pick(g, ["b"]).length) return '<circle cx="12" cy="12" r="10.5" fill="' + accent + '" fill-opacity=".42"/>' + layerLine(g, col, sw);
    return join(pick(g, ["b"]), { fill: accent, "fill-opacity": ".72", stroke: "none" }) +
      join(pick(g, ["f"]).filter(function (e) { return e.t === "rect"; }), { fill: accent, "fill-opacity": ".72" }) + layerLine(g, col, sw);
  }
  function layerSolid(g, col, sw, id) {
    var cuts = pick(g, ["d", "k"]), bodies = pick(g, ["b"]), out = "";
    var body = join(bodies, { fill: col, stroke: col, "stroke-width": f(sw) });
    if (cuts.length && bodies.length) {
      out += '<mask id="' + id + '" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">' +
        '<rect x="-2" y="-2" width="28" height="28" fill="#fff"/>' +
        join(pick(g, ["d"]), { fill: "none", stroke: "#000", "stroke-width": f(sw) }) +
        join(pick(g, ["k"]), { fill: "#000" }) + "</mask>";
      out += '<g mask="url(#' + id + ')">' + body + "</g>";
    } else out += body;
    out += join(pick(g, ["s"]), { fill: "none", stroke: col, "stroke-width": f(sw) });
    out += join(pick(g, ["f"]), { fill: col });
    return out;
  }
  // a two colour print slightly out of register: the colour pass sits 1.5 units down and right
  function layerPlayful(g, ink, hue, sw, id) {
    var bodies = pick(g, ["b"]), lines = pick(g, ["s", "d"]), dots = pick(g, ["f", "k"]);
    var back = join(bodies, { fill: "#fff", stroke: "#fff", "stroke-width": f(sw + 2.4) }) +
      join(lines, { fill: "none", stroke: "#fff", "stroke-width": f(sw + 2.4) }) +
      join(dots, { fill: "#fff", stroke: "#fff", "stroke-width": "2.4" });
    if (!bodies.length) return back + layerLine(g, hue[2], sw);
    var print = '<clipPath id="' + id + '">' + join(bodies, {}) + "</clipPath>" +
      '<g clip-path="url(#' + id + ')"><g transform="translate(1.5 1.5)">' + join(bodies, { fill: hue[0] }) + "</g></g>";
    return back + print + layerLine(g, ink, sw);
  }
  // draws g with its BACK elements cut away around the occluders (role x)
  function occl(g, id, draw) {
    var xs = pick(g, ["x"]);
    var rest = g.filter(function (e) { return e.r !== "x"; });
    if (!xs.length) return draw(rest, id);
    var back = rest.filter(function (e) { return e.x && e.x.back; });
    var front = rest.filter(function (e) { return !(e.x && e.x.back); });
    return '<mask id="' + id + 'o" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="#fff"/>' +
      join(xs, { fill: "#000", stroke: "#000", "stroke-width": f(SW * 2.6) }) + "</mask>" +
      '<g mask="url(#' + id + 'o)">' + draw(back, id + "k") + "</g>" + draw(front, id + "f");
  }
  var PLAYFUL_FOR_GREY = ["blue", "orange", "green", "purple", "pink", "teal"];
  function frame(inner, size, extra) {
    var s = size ? ' width="' + size + '" height="' + size + '"' : "";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"' + s +
      ' stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + ' aria-hidden="true" focusable="false">' + inner + "</svg>";
  }
  function scaled(inner, k) { return '<g transform="translate(12 12) scale(' + k + ') translate(-12 -12)">' + inner + "</g>"; }

  // colour logic: one hue per category, exceptions only where the meaning asks for it.
  // people indigo; climate by mode (cool blue, heat orange, dry teal, fan mint); rooms brown (home
  // orange, outdoor green); media purple (cast blue, mute grey); lights yellow; security green
  // (unlocked amber, alerts red); weather by sky; system grey (power red, connectivity blue).
  var HUE_FIX = {
    guest: "indigo", timer: "cyan", "temp-up": "orange",
    "living-room": "clay", kitchen: "yellow", bathroom: "sage", office: "brown", bedroom: "plum", garage: "mint", games: "purple",
    settings: "grey", search: "slate", input: "steel", tv: "graphite", remote: "steel", picture: "sage", apps: "slate",
    info: "blue", calendar: "clay", clock: "graphite", sliders: "slate", edit: "steel", phone: "graphite", download: "blue",
    play: "purple", pause: "purple", next: "purple", previous: "purple", "volume-up": "purple", "volume-down": "purple",
    music: "purple", shuffle: "purple", repeat: "purple", mic: "purple",
    colour: "yellow", outlet: "yellow", blinds: "yellow",
    unlock: "yellow", motion: "green",
    movie: "purple", film: "purple", party: "purple", dinner: "purple", reading: "purple", relax: "purple", favourite: "purple", heart: "purple",
    check: "green"
  };
  var BYID = {};
  CONCEPTS.forEach(function (c) { if (HUE_FIX[c[0]]) c[3] = HUE_FIX[c[0]]; BYID[c[0]] = c; });

  var STYLES = [
    { id: "line", name: "Line", note: "Outline at one stroke, the default for chrome and labels" },
    { id: "solid", name: "Solid", note: "Filled shapes with cut out details, best read from the couch" },
    { id: "duotone", name: "Duotone", note: "Ink outline over a second tone of the concept colour" },
    { id: "tile", name: "Colour tile", note: "White solid glyph on a gradient squircle, like an iOS app icon" },
    { id: "glass", name: "Glass", note: "White solid glyph on a smoke and frost squircle, best on photos and dark" },
    { id: "playful", name: "Playful", note: "Die cut sticker with an ink outline, for kids and family looks" }
  ];

  function svg(style, name, size, colour) {
    var c = BYID[name];
    if (!c) return "";
    var g = c[4], hue = HUES[c[3]] || HUES.grey, id = "tvi" + (++uid);
    var o = c[5] || {}, ok = o.k || 1, small = size && size < 48, OS = (small ? 2.1 : SW) / ok;
    function fit(inner) {
      if (ok === 1 && !o.dx && !o.dy) return inner;
      return '<g transform="translate(' + f(12 + (o.dx || 0)) + " " + f(12 + (o.dy || 0)) + ") scale(" + ok + ') translate(-12 -12)">' + inner + "</g>";
    }
    // Duotone and Playful need a colour second tone; neutral system icons with a body borrow a cool hue
    var NEUTRAL = { grey: 1, slate: 1, steel: 1, graphite: 1 }, COOL = ["blue", "teal", "indigo", "cyan"];
    var tone = NEUTRAL[c[3]] && pick(g, ["b"]).length ? HUES[COOL[CONCEPTS.indexOf(c) % COOL.length]] : hue;
    switch (style) {
      case "solid": return frame(fit(occl(g, id, function (x, i) { return layerSolid(x, colour || "currentColor", OS, i + "m"); })), size);
      case "duotone": return frame(fit(occl(g, id, function (x) { return layerDuotone(x, colour || "currentColor", OS, tone[0]); })), size);
      case "playful": {
        var ph = tone;
        return frame(fit(occl(g, id, function (x) { return layerPlayful(x, colour || INK, ph, 2.25 / ok, id + "p"); })), size);
      }
      case "tile": {
        var top = colour ? colour : hue[1], bot = colour ? colour : hue[2];
        var defs = '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bot + '"/></linearGradient>' +
          '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>';
        return frame(defs + '<path d="' + SQUIRCLE + '" fill="url(#' + id + 'g)"/><path d="' + SQUIRCLE + '" fill="url(#' + id + 'h)"/>' +
          scaled(fit(occl(g, id, function (x, i) { return layerSolid(x, "#fff", (small ? 2.4 : SW) / ok, i + "m"); })), 0.68), size);
      }
      case "glass": {
        var gk = 0.66;
        var gc = colour || "#fff";
        var gdefs = '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>' +
          '<radialGradient id="' + id + 's" cx=".28" cy=".08" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
          '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".35" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".14"/></linearGradient>' +
          '<linearGradient id="' + id + 'd" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>';
        return frame(gdefs + '<path d="' + SQUIRCLE + '" fill="#1C1C1E" fill-opacity=".62"/><path d="' + SQUIRCLE + '" fill="url(#' + id + 'g)"/><path d="' + SQUIRCLE + '" fill="url(#' + id + 's)"/>' +
          '<path d="' + SQUIRCLE + '" fill="none" stroke="url(#' + id + 'r)" stroke-width=".35" transform="translate(.175 .175) scale(.9854)"/>' +
          scaled(fit(occl(g, id, function (x, i) { return layerSolid(x, gc, (small ? 2.4 : SW) / ok, i + "m"); })), gk), size);
      }
      default: return frame(fit(occl(g, id, function (x) { return layerLine(x, colour || "currentColor", OS); })), size);
    }
  }

  // ------------------------------------------------------------------ avatars
  var AV_HUES = ["indigo", "pink", "orange", "teal", "green", "purple", "blue", "red"];
  var SKIN = ["#F6D2B4", "#E8B48F", "#C98E64", "#9C6644", "#6E4630"];
  var HAIR = { black: "#2B2121", brown: "#6B4226", blonde: "#E3B25B", red: "#C4562B", grey: "#C9C6C1" };
  function grad(id, a, b) { return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>'; }
  function disc(id, hueName) { var h = HUES[hueName]; return "<defs>" + grad(id, h[1], h[2]) + '</defs><circle cx="12" cy="12" r="12" fill="url(#' + id + ')"/>'; }
  function clip(id) { return '<clipPath id="' + id + 'c"><circle cx="12" cy="12" r="12"/></clipPath>'; }

  // emoji style faces: a warm face on a coloured disc
  var FACE_INK = "#3A2A1E";
  var FACES = {
    smile: [K2(9.1, 10.4, .95, 1.3), K2(14.9, 10.4, .95, 1.3), S2("M8.9 14.1c1.7 2 4.5 2 6.2 0")],
    grin: [K2(9.1, 10.2, .95, 1.3), K2(14.9, 10.2, .95, 1.3), F2("M7.9 13.3h8.2a.4.4 0 0 1 .4.5 4.6 4.6 0 0 1-9 0 .4.4 0 0 1 .4-.5z"), F2("M9.3 16.3a4.6 4.6 0 0 0 5.4 0c-.8-.7-1.7-1-2.7-1s-1.9.3-2.7 1z", "#F2706B")],
    wink: [S2("M8 10.6c.7-.8 1.7-.8 2.4 0"), K2(14.9, 10.3, .95, 1.3), S2("M8.9 14c1.7 2 4.5 2 6.2 0"), F2("M13 15.6c.4.9 1.1 1.4 1.8 1.4.6 0 1-.6.8-1.3z", "#F2706B")],
    cool: [F2("M5.6 9.1h12.8v.9l-.6.3-.4 1.9a1.6 1.6 0 0 1-1.6 1.3h-1.4a1.6 1.6 0 0 1-1.6-1.4l-.2-1h-1.2l-.2 1a1.6 1.6 0 0 1-1.6 1.4H8.4a1.6 1.6 0 0 1-1.6-1.3l-.4-1.9-.8-.3z"), S2("M9.4 15.3c1.5 1 3.7 1 5.2-.2")],
    sleepy: [S2("M7.9 10.9c.7.6 1.7.6 2.4 0M13.7 10.9c.7.6 1.7.6 2.4 0"), C3(12, 15.4, 1.1), S2("M17 4.2h2.2l-2.2 2.6h2.2", 1)],
    surprised: [K2(9.1, 10.1, 1.05, 1.45), K2(14.9, 10.1, 1.05, 1.45), S2("M7.9 7.3c.6-.5 1.4-.6 2.1-.4M16.1 7.3c-.6-.5-1.4-.6-2.1-.4"), C3(12, 15.3, 1.6)],
    love: [F2(heartAt(9.1, 10.3, .95), "#F0425B"), F2(heartAt(14.9, 10.3, .95), "#F0425B"), S2("M8.9 14.1c1.7 2 4.5 2 6.2 0")],
    cheeky: [K2(9.1, 10.2, .95, 1.3), S2("M13.7 10.5c.7-.7 1.7-.7 2.4 0"), S2("M8.9 13.7c1.7 1.6 4.5 1.6 6.2 0"), F2("M11.1 14.7h2.8v1.4a1.4 1.4 0 0 1-2.8 0z", "#F2706B")]
  };
  function K2(cx, cy, rx, ry) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="' + FACE_INK + '"/>'; }
  function C3(cx, cy, r) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + r + '" ry="' + (r * 1.15) + '" fill="' + FACE_INK + '"/>'; }
  function S2(d, thin) { return '<path d="' + d + '" fill="none" stroke="' + FACE_INK + '" stroke-width="' + (thin ? 1 : 1.25) + '" stroke-linecap="round" stroke-linejoin="round"/>'; }
  function F2(d, col) { return '<path d="' + d + '" fill="' + (col || FACE_INK) + '"/>'; }
  function heartAt(cx, cy, s) {
    function p(x, y) { return f(cx + x * s) + " " + f(cy + y * s); }
    return "M" + p(0, 1.6) + "C" + p(-2.4, 0) + " " + p(-1.6, -2.3) + " " + p(0, -1) + "C" + p(1.6, -2.3) + " " + p(2.4, 0) + " " + p(0, 1.6) + "Z";
  }
  var FACE_ORDER = ["smile", "grin", "wink", "cool", "sleepy", "surprised", "love", "cheeky"];
  var FACE_BG = ["indigo", "teal", "pink", "blue", "purple", "green", "cyan", "mint"];
  function face(kind, i, id) {
    var bg = FACE_BG[i % FACE_BG.length];
    return disc(id + "b", bg) +
      '<circle cx="12.9" cy="12.9" r="8.4" fill="' + HUES[bg][2] + '"/>' +
      '<circle cx="12" cy="12" r="8.4" fill="#FFF3E0"/>' +
      '<ellipse cx="7.4" cy="13.6" rx="1.4" ry=".9" fill="#FF7A59" fill-opacity=".35"/><ellipse cx="16.6" cy="13.6" rx="1.4" ry=".9" fill="#FF7A59" fill-opacity=".35"/>' +
      FACES[kind].join("");
  }

  // pattern avatars: flat geometric discs, each a different picture so people can tell them apart
  var CREAM = "#FFF3E0";
  var PATTERNS = {
    sunset: ["orange", function (A) { return '<circle cx="12" cy="13" r="5.5" fill="' + CREAM + '"/><path d="M0 13h24v11H0z" fill="' + HUES.red[0] + '"/><path d="M0 17h24v7H0z" fill="' + HUES.pink[2] + '"/>'; }],
    waves: ["blue", function (A) { var w = "c2.5-1.8 5.5-1.8 8 0s5.5 1.8 8 0 5.5-1.8 8 0"; return '<path d="M-4 11' + w + 'V25H-4z" fill="' + HUES.teal[0] + '"/><path d="M-4 16' + w + 'V25H-4z" fill="' + CREAM + '"/>'; }],
    bauhaus: ["green", function (A) { return '<path d="M0 0h12A12 12 0 0 1 0 12z" fill="' + CREAM + '"/><path d="M24 24H12a12 12 0 0 1 12-12z" fill="' + HUES.yellow[0] + '"/><circle cx="17" cy="7" r="2.6" fill="' + A[2] + '"/>'; }],
    stripes: ["purple", function (A) { var r = ""; for (var i = -3; i < 4; i += 2) r += '<rect x="' + (i * 4.5 + 10) + '" y="-6" width="3.2" height="36" fill="' + HUES.pink[1] + '"/>'; return '<g transform="rotate(35 12 12)">' + r + "</g>"; }],
    peak: ["indigo", function (A) { return '<circle cx="16.5" cy="7.5" r="2.8" fill="' + HUES.yellow[0] + '"/><path d="M-1 24 9 9.5l5.5 8 3-3.5L25 24z" fill="' + CREAM + '"/><path d="M9 9.5l2.6 3.8-2.6 1.2-2.4-1.3z" fill="' + A[1] + '"/>'; }],
    rings: ["teal", function (A) { return '<g fill="none" stroke="' + CREAM + '" stroke-width="2"><circle cx="7" cy="17" r="3.5"/><circle cx="7" cy="17" r="8"/><circle cx="7" cy="17" r="12.5"/></g>'; }],
    split: ["pink", function (A) { return '<path d="M12 0h12v24H12z" fill="' + HUES.orange[0] + '"/><path d="M12 6.5a5.5 5.5 0 0 0 0 11z" fill="' + CREAM + '"/><path d="M12 6.5a5.5 5.5 0 0 1 0 11z" fill="' + HUES.purple[2] + '"/>'; }],
    petals: ["mint", function (A) { var p = ""; for (var i = 0; i < 4; i++) p += '<ellipse cx="12" cy="7.3" rx="3" ry="4.7" fill="' + CREAM + '" transform="rotate(' + (i * 90 + 45) + ' 12 12)"/>'; return p + '<circle cx="12" cy="12" r="2.4" fill="' + HUES.orange[0] + '"/>'; }]
  };
  var PATTERN_ORDER = ["sunset", "waves", "bauhaus", "stripes", "peak", "rings", "split", "petals"];
  function pattern(k, id) {
    var p = PATTERNS[k], A = HUES[p[0]];
    return "<defs>" + clip(id) + '</defs><g clip-path="url(#' + id + 'c)"><circle cx="12" cy="12" r="12" fill="' + A[0] + '"/>' + p[1](A) + "</g>";
  }

  // illustrated characters: flat, head and shoulders, clipped to the disc
  function person(id, bgHue, skin, shirt, hairBack, hairFront, extra) {
    return disc(id + "b", bgHue) + "<defs>" + clip(id) + '</defs><g clip-path="url(#' + id + 'c)"><g transform="translate(12 13.6) scale(1.32) translate(-12 -11.6)">' +
      (hairBack || "") +
      '<path d="M3.5 24.4c0-4.9 3.8-8.1 8.5-8.1s8.5 3.2 8.5 8.1z" fill="' + shirt + '"/>' +
      '<path d="M10.3 14.6h3.4v1.8a1.7 1.7 0 0 1-3.4 0z" fill="' + skin + '"/><path d="M10.3 15.3c1 .6 2.4.6 3.4 0v-.7h-3.4z" fill="#000" fill-opacity=".12"/>' +
      '<ellipse cx="12" cy="10.6" rx="4.5" ry="5" fill="' + skin + '"/>' +
      '<ellipse cx="7.6" cy="11" rx=".8" ry="1.1" fill="' + skin + '"/><ellipse cx="16.4" cy="11" rx=".8" ry="1.1" fill="' + skin + '"/>' +
      '<circle cx="10.3" cy="10.9" r=".55" fill="' + FACE_INK + '"/><circle cx="13.7" cy="10.9" r=".55" fill="' + FACE_INK + '"/>' +
      '<path d="M10.7 13.3c.8.6 1.8.6 2.6 0" fill="none" stroke="' + FACE_INK + '" stroke-width=".7" stroke-linecap="round"/>' +
      (hairFront || "") + (extra || "") + "</g></g>";
  }
  var CHARACTERS = {
    "short-hair": function (id) { return person(id, "blue", SKIN[1], "#FFD60A", "", '<path d="M7.4 10.2c-.3-3.6 1.8-5.9 4.8-5.9 2.9 0 4.8 1.9 4.6 5.4-.9-1.4-2.4-2.4-4.2-2.6-1.4.9-3.4 1.6-5.2 3.1z" fill="' + HAIR.brown + '"/>'); },
    "bun": function (id) { return person(id, "pink", SKIN[0], "#2C2C34", '<circle cx="12" cy="4.4" r="2.5" fill="' + HAIR.red + '"/>', '<path d="M7.3 10.6C7 7 9 4.9 12 4.9s5 2.1 4.7 5.7c-1.1-2.1-2.6-3-4.7-3.1-2.1.1-3.6 1-4.7 3.1z" fill="' + HAIR.red + '"/>'); },
    "curly": function (id) { return person(id, "orange", SKIN[3], "#FFD60A", '<path d="M5.8 11.6c-1.3-1.2-1-3.3.4-4.1-.3-1.8 1.1-3.3 2.8-3.1.9-1.5 3-1.9 4.4-.8 1.6-.6 3.3.4 3.6 2 1.6.6 2.2 2.6 1.2 3.9.9 1.2.5 2.9-.7 3.4l-.6-3.4c-1.4-.4-2.5-1.3-3.2-2.6-1.1 1.2-3 1.8-4.6 1.6l-.4 3.4c-.9.4-2.1.2-2.9-.3z" fill="' + HAIR.black + '"/>', ""); },
    "long-hair": function (id) { return person(id, "indigo", SKIN[2], "#FF9F0A", '<path d="M6.7 11c0-4.2 2.2-6.7 5.3-6.7s5.3 2.5 5.3 6.7v7.4H6.7z" fill="' + HAIR.blonde + '"/>', '<path d="M7.4 10.3c.7-2.9 2.6-4.6 5.4-4.6 1.8 0 3.3.9 4 2.4-1.9.2-4.8-.2-6.6-1.4-.6 1.6-1.6 2.9-2.8 3.6z" fill="' + HAIR.blonde + '"/>'); },
    "cap": function (id) { return person(id, "cyan", SKIN[4], "#FF453A", "", '<path d="M7.2 8.7c0-3.1 2.1-5 4.8-5s4.8 1.9 4.8 5z" fill="#FFD60A"/><path d="M11.5 8.7h6.4a.7.7 0 0 1 0 1.4h-6.4z" fill="#F29900"/>'); },
    "beard": function (id) { return person(id, "purple", SKIN[1], "#30D158", "", '<path d="M7.6 9.6c-.2-3.3 1.8-5.2 4.4-5.2s4.6 1.9 4.4 5.2c-.8-1.3-2.3-2-4.4-2s-3.6.7-4.4 2z" fill="' + HAIR.black + '"/><path d="M7.7 12c.4 2.8 2.1 4.2 4.3 4.2s3.9-1.4 4.3-4.2c-.5.6-1.1.9-1.8.9-.6-.5-1.5-.7-2.5-.7s-1.9.2-2.5.7c-.7 0-1.3-.3-1.8-.9z" fill="' + HAIR.brown + '"/>', '<circle cx="10.3" cy="10.9" r="1.3" fill="none" stroke="' + INK + '" stroke-width=".4"/><circle cx="13.7" cy="10.9" r="1.3" fill="none" stroke="' + INK + '" stroke-width=".4"/><path d="M11.6 10.8h.8" stroke="' + INK + '" stroke-width=".4"/>'); },
    "pigtails": function (id) { return person(id, "yellow", SKIN[0], "#FF375F", '<circle cx="5.9" cy="9.6" r="2.1" fill="' + HAIR.brown + '"/><circle cx="18.1" cy="9.6" r="2.1" fill="' + HAIR.brown + '"/>', '<path d="M7.4 10.1C7.3 6.8 9.3 5 12 5s4.7 1.8 4.6 5.1c-1.4-1.2-3-1.9-4.6-1.9s-3.2.7-4.6 1.9z" fill="' + HAIR.brown + '"/><path d="M12 5v3.2" stroke="' + SKIN[0] + '" stroke-width=".5" stroke-opacity=".6"/>'); },
    "grandparent": function (id) { return person(id, "indigo", SKIN[0], "#AC8E68", "", '<path d="M7.3 10.6c-.6-1.5-.4-3.2.6-4.2 1-1.1 2.5-1.5 4.1-1.5s3.1.4 4.1 1.5c1 1 1.2 2.7.6 4.2-.3-1.1-.9-1.7-1.5-2 0 0-1-.3-3.2-.3s-3.2.3-3.2.3c-.6.3-1.2.9-1.5 2z" fill="' + HAIR.grey + '"/>', '<circle cx="10.3" cy="10.9" r="1.5" fill="none" stroke="' + INK + '" stroke-width=".5"/><circle cx="13.7" cy="10.9" r="1.5" fill="none" stroke="' + INK + '" stroke-width=".5"/><path d="M11.8 10.8h.4" stroke="' + INK + '" stroke-width=".5"/>'); },
    "cat": function (id) {
      return disc(id + "b", "teal") + '<path d="M6.3 8.6 6.8 3.9l3.6 2.6M17.7 8.6l-.5-4.7-3.6 2.6" fill="#FF9F0A"/>' +
        '<ellipse cx="12" cy="12.6" rx="6.6" ry="6" fill="#FF9F0A"/><path d="M6.8 4.6l2.4 1.9-1.6 1.4zM17.2 4.6l-2.4 1.9 1.6 1.4z" fill="#FFC27A"/>' +
        '<ellipse cx="12" cy="15.2" rx="3.2" ry="2.4" fill="#FFF4E3"/>' +
        '<ellipse cx="9.4" cy="11.6" rx=".75" ry="1.05" fill="' + FACE_INK + '"/><ellipse cx="14.6" cy="11.6" rx=".75" ry="1.05" fill="' + FACE_INK + '"/>' +
        '<path d="M11.2 13.9h1.6l-.8.9z" fill="#F2706B"/><path d="M12 14.8c-.3.7-1 .9-1.5.5M12 14.8c.3.7 1 .9 1.5.5M4.6 13.2l3 .3M4.8 15.3l2.9-.7M19.4 13.2l-3 .3M19.2 15.3l-2.9-.7" fill="none" stroke="' + FACE_INK + '" stroke-width=".55" stroke-linecap="round"/>';
    },
    "dog": function (id) {
      return disc(id + "b", "orange") + '<ellipse cx="12" cy="12.4" rx="6.3" ry="6.4" fill="#F5E6D3"/>' +
        '<path d="M5.4 6.6c1.5-1.4 3.6-1 4.3.6L8 13.6c-1.6.6-3.6-.4-3.8-2.5-.2-1.7.1-3.4 1.2-4.5zM18.6 6.6c-1.5-1.4-3.6-1-4.3.6l1.7 6.4c1.6.6 3.6-.4 3.8-2.5.2-1.7-.1-3.4-1.2-4.5z" fill="#8A6640"/>' +
        '<ellipse cx="14.2" cy="9.6" rx="1.9" ry="1.6" fill="#C9A47A"/>' +
        '<ellipse cx="9.6" cy="11.3" rx=".75" ry="1" fill="' + FACE_INK + '"/><ellipse cx="14.4" cy="11.3" rx=".75" ry="1" fill="' + FACE_INK + '"/>' +
        '<ellipse cx="12" cy="14.3" rx="1.5" ry="1.05" fill="' + FACE_INK + '"/><path d="M12 15.3v1.1M10.4 16.6c.9.7 2.3.7 3.2 0" fill="none" stroke="' + FACE_INK + '" stroke-width=".55" stroke-linecap="round"/>' +
        '<path d="M11.3 16.9h1.4v1a.7.7 0 0 1-1.4 0z" fill="#F2706B"/>';
    },
    "koala": function (id) {
      return disc(id + "b", "green") + '<circle cx="6.3" cy="8.4" r="3.4" fill="#A9A9AE"/><circle cx="17.7" cy="8.4" r="3.4" fill="#A9A9AE"/>' +
        '<circle cx="6.3" cy="8.4" r="2" fill="#F2E9EC"/><circle cx="17.7" cy="8.4" r="2" fill="#F2E9EC"/>' +
        '<ellipse cx="12" cy="12.8" rx="6" ry="5.8" fill="#A9A9AE"/>' +
        '<ellipse cx="9.5" cy="11.6" rx=".7" ry=".95" fill="' + FACE_INK + '"/><ellipse cx="14.5" cy="11.6" rx=".7" ry=".95" fill="' + FACE_INK + '"/>' +
        '<path d="M10.5 12.6c0-1 .6-1.6 1.5-1.6s1.5.6 1.5 1.6v1.7a1.5 1.5 0 0 1-3 0z" fill="#3A3A40"/>' +
        '<path d="M10.7 16.6c.8.5 1.8.5 2.6 0" fill="none" stroke="' + FACE_INK + '" stroke-width=".55" stroke-linecap="round"/>';
    },
    "fox": function (id) {
      return disc(id + "b", "indigo") + "<defs>" + clip(id) + '</defs><g clip-path="url(#' + id + 'c)"><g transform="translate(12 13) scale(1.25) translate(-12 -12)">' + '<path d="M5.5 4.4l4.2 3.4-3.1 2.3zM18.5 4.4l-4.2 3.4 3.1 2.3z" fill="#FF7A1A"/>' +
        '<path d="M12 19.2 5.2 12c-.6-2.9 1.6-5.4 4-5.4h5.6c2.4 0 4.6 2.5 4 5.4z" fill="#FF7A1A"/>' +
        '<path d="M12 19.2l-4.9-5.6c1.6-.4 3.4.1 4.9 1.5 1.5-1.4 3.3-1.9 4.9-1.5z" fill="#FFF4E3"/>' +
        '<ellipse cx="9.5" cy="11.4" rx=".7" ry=".95" fill="' + FACE_INK + '"/><ellipse cx="14.5" cy="11.4" rx=".7" ry=".95" fill="' + FACE_INK + '"/>' +
        '<ellipse cx="12" cy="17.9" rx="1" ry=".75" fill="' + FACE_INK + '"/></g></g>';
    }
  };
  var CHAR_ORDER = ["short-hair", "bun", "curly", "long-hair", "cap", "beard", "pigtails", "grandparent", "cat", "dog", "koala", "fox"];

  var AVATARS = [];
  AV_HUES.forEach(function (h, i) { AVATARS.push({ id: "monogram-" + h, label: "Monogram " + h, family: "monogram" }); });
  FACE_ORDER.forEach(function (k) { AVATARS.push({ id: "face-" + k, label: "Face " + k, family: "face" }); });
  PATTERN_ORDER.forEach(function (k) { AVATARS.push({ id: "pattern-" + k, label: "Pattern " + k, family: "pattern" }); });
  CHAR_ORDER.forEach(function (k) { AVATARS.push({ id: "character-" + k, label: k.replace("-", " "), family: "character" }); });

  function avatar(name, size, opts) {
    opts = opts || {};
    var id = "tva" + (++uid), inner = "";
    var m = /^(monogram|face|pattern|character)-(.+)$/.exec(name || "");
    if (!m) return "";
    if (m[1] === "monogram") {
      var letter = String(opts.letter || "A").charAt(0).toUpperCase().replace(/[<>&"]/g, "");
      inner = disc(id, HUES[m[2]] ? m[2] : "indigo") +
        '<text x="12" y="12" dy=".355em" text-anchor="middle" font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="650" font-size="11.5" letter-spacing="-.2" fill="#fff">' + letter + "</text>";
    } else if (m[1] === "face") {
      var fi = FACE_ORDER.indexOf(m[2]); if (fi < 0) return "";
      inner = face(m[2], fi, id);
    } else if (m[1] === "pattern") {
      if (!PATTERNS[m[2]]) return "";
      inner = pattern(m[2], id);
    } else {
      if (!CHARACTERS[m[2]]) return "";
      inner = CHARACTERS[m[2]](id);
    }
    var s = size ? ' width="' + size + '" height="' + size + '"' : "";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"' + s + ' aria-hidden="true" focusable="false">' + inner + "</svg>";
  }

  var api = {
    version: 1,
    grid: 24,
    stroke: SW,
    styles: STYLES,
    hues: HUES,
    concepts: CONCEPTS.map(function (c) { return { id: c[0], label: c[1], group: c[2], tint: HUES[c[3]][0], hue: c[3] }; }),
    avatars: AVATARS,
    svg: function (style, name, size, colour) {
      if (style === "avatar") return avatar(name, size, typeof colour === "object" ? colour : {});
      return svg(style, name, size, colour);
    },
    avatar: avatar
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TVIcons = api;
})(typeof self !== "undefined" ? self : this);
