// The loading screen: the time in the Night clock's font, with a light sweep and a shimmer line.
// boot.html and index.html both load this first thing in <body>, so it stays put across the hand
// over between them. On index.html it fades out once the page has loaded.
(function () {
  "use strict";
  var css =
    '@font-face{font-family:"Antonio";font-weight:300;font-display:block;src:url(fonts/antonio-latin-300.woff2) format("woff2")}' +
    "#couch-load{position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;background:#0b0d12;" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity .45s ease}" +
    '#couch-load b{font:300 240px/0.9 "Antonio","Arial Narrow",sans-serif;letter-spacing:-0.02em;color:transparent;' +
    "background:linear-gradient(100deg,rgba(255,255,255,.28) 40%,rgba(255,255,255,.95) 50%,rgba(255,255,255,.28) 60%) 0 0/300% 100%;" +
    "-webkit-background-clip:text;background-clip:text;animation:couch-sweep 2.4s ease-in-out infinite}" +
    "#couch-load i{display:block;margin-top:48px;width:360px;height:2px;border-radius:1px;" +
    "background:linear-gradient(90deg,rgba(255,255,255,.06) 30%,rgba(255,255,255,.6) 50%,rgba(255,255,255,.06) 70%) 0 0/300% 100%;" +
    "animation:couch-sweep 1.6s linear infinite}" +
    "@keyframes couch-sweep{from{background-position:100% 0}to{background-position:0 0}}" +
    "@media (prefers-reduced-motion:reduce){#couch-load b,#couch-load i{animation:none}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var cfg = "";
  try { cfg = localStorage.getItem("couch.configjs") || ""; } catch (e) {}
  var d = new Date(), h = d.getHours();
  if (!/"clock": ?"24h"/.test(cfg)) h = h % 12 || 12;
  var box = document.createElement("div");
  box.id = "couch-load";
  box.innerHTML = "<b>" + h + ":" + ("0" + d.getMinutes()).slice(-2) + "</b><i></i>";
  document.body.appendChild(box);

  if (/boot\.html$/.test(location.pathname)) return;   // boot.html hands over to index.html
  var gone = false;
  function hide() {
    if (gone) return;
    gone = true;
    box.style.opacity = "0";
    setTimeout(function () { box.parentNode && box.parentNode.removeChild(box); }, 500);
  }
  window.addEventListener("load", function () {
    // two frames: let the home draw under the loader before it fades
    requestAnimationFrame(function () { requestAnimationFrame(hide); });
  });
  // "load" waits for every image, and an icon from a bridge that is off can hang: never cover a working home
  setTimeout(hide, 8000);
})();
