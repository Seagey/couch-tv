const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Keep watching follows the app tests...');
const web = path.join(__dirname, '../tv-home/web');
const appJs = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8');
const mock = fs.readFileSync(path.join(web, 'mock.js'), 'utf8');

// Home settings win over home.shelf_follows_app, and the default is off: nobody's home changes without asking
assert(/SHELF_FOLLOW = typeof ST\.shelf_follows_app === "boolean" \? ST\.shelf_follows_app : HOME\.shelf_follows_app === true/.test(appJs), 'setting wins over config, default off');
// a toggle row in Home settings, Look, next to Show Keep watching
assert(appJs.includes('key: "shelf-follows-app"'), 'Home settings has the Keep watching follows the app row');
assert(/key: "keep-watching"[\s\S]{0,900}key: "shelf-follows-app"/.test(appJs), 'the row sits next to Show Keep watching');
assert(/key: "shelf-follows-app", label: t\("shelf_follow"\), sub: t\("shelf_follow_sub"\)/.test(appJs), 'the row uses the shelf_follow strings');

// the full lists stay in showsBy and videosBy; shows is what is on screen
assert(/var data = \{ shows: \[\], showsBy: \{\}, videosBy: \{\}/.test(appJs), 'videos are kept per person next to the shows');
assert(/data\.shows = KW_ON \? visibleShows\(\) : \[\];/.test(appJs), 'the row on screen is the visible list');
// the filter: that tile's package, from the card's app.package (works with Android's Watch Next list too)
assert(/function pkgOf\(it\) \{ return \(it\.app && it\.app\.package\) \|\| it\.package \|\| ""; \}/.test(appJs), 'a card is matched by its app.package');
assert(/fullShows\(\)\.filter\(function \(it\) \{ return pkgOf\(it\) === pkg; \}\)/.test(appJs), 'the row is filtered by package');
// the YouTube tile joins that person's videos from the bridge
assert(/\.concat\(\(data\.videosBy\[who\] \|\| \[\]\)\.filter\(function \(it\) \{ return pkgOf\(it\) === pkg; \}\)\)/.test(appJs), 'videos join the filtered cards by package');
assert(/data\.videosBy\[p\.id\] = \(j\.videos \|\| \[\]\)/.test(appJs), '/api/continue videos are stored per person');
// an app with no cards leaves the whole row as it is
assert(/var mine = showsFor\(followPkg\);\n\s*return mine\.length \? mine : fullShows\(\);/.test(appJs), 'an app with nothing on the go shows the whole row');
// the filter applies on an app tile in the grid, stays in the row, and clears on a non app tile or any other zone
assert(/if \(zone === "grid"\) \{ var a = gridItems\[g\]; want = a && \(a\.kind === "app" \|\| !a\.kind\) && a\.package \? a\.package : null; \}/.test(appJs), 'only an app tile sets the filter');
assert(/else if \(zone === "shelf" \|\| zone === "shelfmenu"\) want = followPkg;/.test(appJs), 'the filter stays while the remote is in the row');
assert(/var want = null;\n\s*if \(SHELF_FOLLOW && KW_ON && !kidsOn\(\) && !lift\)/.test(appJs), 'off, Keep watching off, kids mode or a lifted app: the whole row');
// paintFocus runs it on every press, but the row is drawn again only when its cards or heading change
assert(/saveFocusSoon\(\);\n\s*followSync\(\);/.test(appJs), 'paintFocus syncs the row with the tile');
assert(/if \(shelfKey\(\) === shelfShown\) return false;/.test(appJs), 'the same cards under the same heading are not redrawn');
assert(/s = Math\.max\(0, Math\.min\(s, shelfEls\.length - 1\)\);   \/\/ the row may have fewer cards now/.test(appJs), 's is clamped when the list shrinks');
// the heading
assert(/\$\("shelf-title"\)\.textContent = following \? t\("recently_on", \{ app: following \}\)/.test(appJs), 'the heading becomes Recently on <app>');
// a video card: no picture, so the title text shows, with "Video" as its line, in both looks
assert(/if \(it\.kind === "video"\) parts\.push\(t\("video_card"\)\);/.test(appJs), 'Classic subtitle says Video');
assert(/var ep = it\.kind === "video" \? t\("video_card"\)/.test(appJs), 'Night card says Video');
// removing a card by hand takes it out of the videos too
assert(/if \(data\.videosBy\[p\.id\]\) data\.videosBy\[p\.id\] = data\.videosBy\[p\.id\]\.filter\(keepIt\);/.test(appJs), 'hide removes a video too');
// the saved copy carries the videos, so the filter works offline on what the page has
assert(/JSON\.stringify\(\{ showsBy: data\.showsBy, videosBy: data\.videosBy,/.test(appJs), 'the saved copy keeps the videos');

// the preview can show it
assert(/if \(arg\("follow"\)\) cfg\.home\.shelf_follows_app/.test(mock), 'mock.js has the follow preset');
assert(/videos: videos/.test(mock), 'mock.js sends videos with /api/continue');

// all 16 languages have the strings
['shelf_follow', 'shelf_follow_sub', 'recently_on', 'video_card'].forEach(function (k) {
  const count = (i18n.match(new RegExp('\\b' + k + ':', 'g')) || []).length;
  assert.strictEqual(count, 16, `${k} must exist in all 16 languages (found ${count})`);
});
// every recently_on keeps the {app} placeholder
const ro = i18n.match(/recently_on: "[^"]*"/g) || [];
assert.strictEqual(ro.length, 16, 'recently_on in 16 languages');
ro.forEach(function (l) { assert(l.includes('{app}'), 'recently_on keeps {app}: ' + l); });
console.log('Keep watching follows the app tests passed.');
