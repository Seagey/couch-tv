// Screensaver quick button (#146, thanks digitaldarkmatterltd). On a Philips 43PUS8546/12 the launcher came
// back to the front half a second after the screen timeout was cut to five seconds, and put the timeout
// straight back, so the TV never napped and the button said "The TV did not start the photos".
// The logic lives in Kotlin, so this reads the source: the early resume must be ignored, the screensaver
// ending (onPause), the deadline and a restart must still restore it, and the button must say what it is.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..', 'tv-home');
const kt = fs.readFileSync(path.join(root, 'android/app/src/main/java/app/couchtv/launcher/MainActivity.kt'), 'utf8');
const js = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web/app.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'web/i18n.js'), 'utf8');

// onResume is the only caller that passes resume = true, and onPause still restores for the dream.
assert(/restoreTimeout\(resume = true\)/.test(kt), 'onResume asks for the resume guard');
assert.strictEqual((kt.match(/resume = true/g) || []).length, 1, 'only onResume uses the guard');
assert(/restoreTimeout\(dream = true\)/.test(kt), 'the screensaver covering the home still puts the timeout back');
assert(/if \(resume && ambientAt > 0 && android\.os\.SystemClock\.elapsedRealtime\(\) - ambientAt < AMBIENT_EARLY_MS\)/.test(kt),
  'an early resume is left alone');

// the deadline safety stays: a named deadline, one at a time, still restores without the guard.
assert(/private val ambientDeadline = Runnable \{ restoreTimeout\(\) \}/.test(kt), 'the deadline restores with no guard');
assert(/main\.removeCallbacks\(ambientDeadline\)\s*\/\/[^\n]*\n\s*main\.postDelayed\(ambientDeadline, AMBIENT_WINDOW_MS\)/.test(kt),
  'a new press replaces the old deadline');
// a restart (onCreate) is a new process: ambientAt is 0 there, so it restores at once.
assert(/override fun onCreate[\s\S]{0,300}restoreTimeout\(\)/.test(kt), 'a restart puts the timeout back');
const early = Number((kt.match(/AMBIENT_EARLY_MS = ([\d_]+)L/) || [])[1].replace(/_/g, ''));
const window_ = Number((kt.match(/AMBIENT_WINDOW_MS = ([\d_]+)L/) || [])[1].replace(/_/g, ''));
assert(early >= 2000 && early < window_, 'the guard is longer than the 0.5 s seen and well inside the window');

// the button says what it is: a name under the Night look, an accessible name, and a line in Home settings.
assert(/#q-screensaver span \{ display: inline; \}/.test(css), 'Night look still shows the Screensaver name');
assert(/getElementById|\$\("q-screensaver"\)/.test(js) && /setAttribute\("aria-label", t\("quick_screensaver"\)\)/.test(js), 'aria-label');
assert(/q === "screensaver"\) return nativeScreensaver\(\) \? t\("quick_screensaver_sub"\)/.test(js), 'sub label in quick button help');
assert(/quick_screensaver_sub:/.test(i18n), 'the sub label has words');
console.log('Screensaver early resume tests passed.');
