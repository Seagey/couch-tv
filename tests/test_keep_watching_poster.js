// #192: home.keep_watching_style "poster" shows the Night look's Keep watching row as the Classic
// poster tiles. The layout and the remote are checked in a browser by test_keep_watching_poster_browser.mjs.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Keep watching poster style tests...');
const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');

// Home settings win over home.keep_watching_style, and the wide cards stay the default
assert(appJs.includes('KW_POSTER = (ST.keep_watching_style || HOME.keep_watching_style) === "poster";'), 'setting wins over config, cards by default');
assert(appJs.includes('key: "kw-posters"'), 'Home settings has the Keep watching as posters row');
assert(appJs.includes('ST.keep_watching_style = KW_POSTER ? "poster" : "card"'), 'the switch saves the style');
// the wide cards are drawn only when the poster style is off; custom cards follow the same shape
assert(appJs.includes('if (NIGHT && !nightPosters()) {\n      // lock screen notifications'), 'shows: cards unless posters');
assert(appJs.includes('if (NIGHT && !nightPosters()) {\n        el.className = "tile ncard ccard";'), 'custom cards: cards unless posters');
// the Loop look, the TV's own Spotify row and a Studio design keep their own shapes
assert(appJs.includes('function postersFit() { return NIGHT && !LOOP && !LOCAL_SPOTIFY && !(typeof CouchDesign !== "undefined" && CouchDesign.on()); }'), 'not in Loop, the Spotify row or a design');
assert(appJs.includes('function nightPosters() { return postersFit() && KW_POSTER; }'), 'posters only where they fit');
assert(appJs.includes('if (KW_ON && postersFit()) rows.push({ kind: "toggle", key: "kw-posters"'), 'the switch shows only where posters apply');
assert(css.includes('html.kw-poster.theme-night .shelf .show { width: 15.625rem; height: 8.789rem; }'), 'two dock columns wide, 16:9');
assert(css.includes('.no-flex-gap.kw-poster.theme-night .shelf-track > * + * { margin-left: 1.625rem; }'), 'older WebViews keep the gap');

// all 16 languages have the string
const count = (i18n.match(/\bkw_posters:/g) || []).length;
assert.strictEqual(count, 16, `kw_posters must exist in all 16 languages (found ${count})`);
console.log('Keep watching poster style tests passed.');
