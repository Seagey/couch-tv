const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running Headphones UI tests...');

// 1. Verify app.js
const appJsPath = path.join(__dirname, '../tv-home/web/app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

assert(appJsContent.includes('headphones'), 'app.js must include headphones keyword');
assert(appJsContent.includes('"headphones"'), 'app.js must include "headphones" in QUICK_ALL');
assert(appJsContent.includes('toggleHeadphones'), 'app.js must define toggleHeadphones');
assert(appJsContent.includes('/api/bluetooth-audio'), 'app.js must call /api/bluetooth-audio');

// Check that ICONS has headphones SVG
assert(appJsContent.includes('headphones: \'<svg'), 'ICONS must have headphones SVG');

// 2. Verify app.css
const appCssPath = path.join(__dirname, '../tv-home/web/app.css');
const appCssContent = fs.readFileSync(appCssPath, 'utf8');

assert(appCssContent.includes('#q-headphones'), 'app.css must have #q-headphones styles');
assert(appCssContent.includes('.busy'), 'app.css must have .busy style');

// 3. Verify i18n.js
const i18nPath = path.join(__dirname, '../tv-home/web/i18n.js');
const i18nContent = fs.readFileSync(i18nPath, 'utf8');

const requiredKeys = [
  'quick_headphones',
  'quick_bluetooth_audio',
  'headphones',
  'headphones_on',
  'headphones_off',
  'headphones_connecting',
  'headphones_not_found',
  'quick_needs_bluetooth_audio'
];

requiredKeys.forEach(key => {
  const count = (i18nContent.match(new RegExp('\\b' + key + ':', 'g')) || []).length;
  assert(count >= 5, `Key ${key} must exist across localized languages (found ${count})`);
});

// 4. Verify mock.js
const mockJsPath = path.join(__dirname, '../tv-home/web/mock.js');
const mockJsContent = fs.readFileSync(mockJsPath, 'utf8');
assert(mockJsContent.includes('/api/bluetooth-audio'), 'mock.js must support /api/bluetooth-audio');

console.log('All Headphones UI tests passed successfully!');
