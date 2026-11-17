// Back on the home after an app: the page used to refresh twice and wait, on its own thread, for the
// launcher to rescan every installed app and read Watch Next (a Chromium trace on a Fire TV Cube showed a
// D-pad press waiting 6 s for its frame right after every return). The launcher keeps both ready in the
// background and swaps them in one step; the page runs one refresh for the two asks.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running home return tests...');
const app = fs.readFileSync(path.join(__dirname, '../tv-home/web/app.js'), 'utf8').replace(/\r\n/g, '\n');
const kt = fs.readFileSync(path.join(__dirname, '../tv-home/android/app/src/main/java/app/couchtv/launcher/MainActivity.kt'), 'utf8');

const warm = kt.slice(kt.indexOf('private fun warmApps()'), kt.indexOf('private fun bannerImage'));
assert(!/appCache = null/.test(warm), 'the app list is never emptied before a rescan');
assert(/val fresh = buildAppList\(\)\n\s+appCache = fresh/.test(warm), 'the fresh list replaces the old one in one step');
const resume = kt.slice(kt.indexOf('override fun onResume()'), kt.indexOf('override fun onDestroy()'));
assert(/if \(appCache == null\) io\.execute \{ warmApps\(\) \}/.test(resume), 'a return to the home does not rescan the apps');
assert(/io\.execute \{ watchNextCache = readWatchNext\(\)\.toString\(\) \}/.test(resume), 'Watch Next is read off the page\'s thread on return');
assert(/addAction\(Intent\.ACTION_PACKAGE_ADDED\)/.test(kt) && /addDataScheme\("package"\)/.test(kt), 'package changes drive the rescan');
assert(/fun watchNext\(\): String = watchNextCache \?: readWatchNext\(\)\.toString\(\)\.also \{ watchNextCache = it \}/.test(kt), 'TV.watchNext answers from the cache');
assert(/registerContentObserver\(WATCH_NEXT, true, watchNextChanged\)/.test(kt), 'Watch Next changes refresh the cache');
assert(/unregisterReceiver\(packageChanged\)/.test(kt), 'the receiver goes with the activity');

assert(/if \(refreshing && Date\.now\(\) - refreshAt < 1500\) return refreshing;/.test(app), 'a second refresh within a moment shares the first');
assert(/^  function refreshNow\(\) \{/m.test(app), 'the real refresh is refreshNow');
console.log('Home return tests passed.');
