const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('Running weather header tests...');

const web = path.join(__dirname, '../tv-home/web');
const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const i18nSource = fs.readFileSync(path.join(web, 'i18n.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const match = app.match(new RegExp(`^  function ${name}\\(\\) \\{[\\s\\S]*?^  \\}`, 'm'));
  assert(match, `app.js defines ${name}()`);
  return match[0];
}

function loadI18n() {
  const sandbox = { window: {}, navigator: { language: 'ro-RO' }, document: { documentElement: {} } };
  vm.runInNewContext(i18nSource, sandbox);
  sandbox.window.I18N.set('ro');
  return sandbox.window.I18N;
}

function render(language, place) {
  const I18N = loadI18n();
  I18N.set(language);
  const classes = new Set();
  const date = {
    innerHTML: '',
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
    },
  };
  const time = { innerHTML: '' };
  const idleWx = { textContent: '' };
  const elements = { date, time, 'idle-wx': idleWx };
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [NativeDate.UTC(2026, 10, 15, 12)]));
    }
  }
  const sandbox = {
    window: { I18N },
    document: { body: { classList: { toggle() {} } } },
    Intl,
    Date: FixedDate,
    WXCFG: { place: place || 'Sâmburești, Olt, Romania' },
    WX_SHOW: true,
    WX_F: false,
    CLOCK24: true,
    DATE_BARS: false,
    NIGHT: true,
    SUN_SYNC: false,
    SMART_IDLE: { quiet_hours: {} },
    quickReady: false,
    data: { weather: { temp: 5, code: 3 } },
    t: I18N.t,
    esc: (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    tempText: (value) => `${value}°`,
    wxText: () => I18N.t('wx_cloudy'),
    wxIcon: () => '<svg class="icon"></svg>',
    $: (id) => elements[id] || null,
    fitDate() {},
    glassClock() {},
    mood() {},
    secondsMarkup() { return ''; },
    updateAmbientWeather() {},
    renderQuick() {},
  };
  vm.runInNewContext(`${extractFunction('weatherPlace')}\n${extractFunction('clock')}\nthis.drawClock = clock;`, sandbox);
  sandbox.drawClock();
  return { date, time, idleWx, classes };
}

const romanian = render('ro');
assert(romanian.date.innerHTML.includes('Duminică, 15 noiembrie'), 'Romanian date keeps its localized comma');
assert(
  romanian.date.innerHTML.includes('Sâmburești\u00a0· 5°\u00a0· Înnorat') && !/Olt|Romania/.test(romanian.date.innerHTML),
  'Romanian weather line shows the town only, live temperature, and localized condition'
);
assert(romanian.classes.has('weather-lines'), 'Romanian date and weather render on separate lines');
assert.strictEqual(romanian.idleWx.textContent, 'Sâmburești\u00a0· 5°\u00a0· Înnorat');
assert(/^\d{2}:\d{2}$/.test(romanian.time.innerHTML), 'the time remains a separate live clock');

const english = render('en');
assert(english.date.innerHTML.includes('Sunday 15 November'), 'other locales keep their existing date punctuation');
assert(english.date.innerHTML.includes('Sâmburești') && !/Olt|Romania/.test(english.date.innerHTML), 'the date line names the town only, never its region or country');
assert(english.date.innerHTML.includes('Sunday 15 November<span class="wx"><span class="wx-place">\u00a0· <span class="wx-town">Sâmburești</span>\u00a0· </span>'),
  'the one-line header puts the same middle dot between the date and the place as between the other parts');
// launch audit 0.13.9 (Couch Night): a line that wraps never starts with the dot. Every dot has a no-break
// space before it (it stays with the word before) and a plain space after (the line may break there)
assert(!/ ·/.test(english.date.innerHTML) && !/ ·/.test(romanian.date.innerHTML), 'no dot that a wrapped line could start with');
assert((english.date.innerHTML.match(/\u00a0· /g) || []).length >= 3, 'each dot is kept with the word before it');
assert(english.date.innerHTML.includes('<svg class="icon"></svg>'), 'other locales retain the existing weather icon');
assert(!english.classes.has('weather-lines'), 'the Romanian stacked layout is not applied to other locales');

// a TCL, 23 Nov 2026: a town picked by search (Home settings, Location) is kept as name and area joined,
// "Ballarat, City of Ballarat, Victoria, Australia", and ran to the right edge. The line names the town alone,
// in a .wx-town span that ends in "..." when even that is too long (app.css)
const ball = render('en', 'Ballarat, City of Ballarat, Victoria, Australia');
assert(ball.date.innerHTML.includes('<span class="wx-town">Ballarat</span>') && !/City of|Victoria|Australia/.test(ball.date.innerHTML), 'a searched town: Ballarat only: ' + ball.date.innerHTML);
assert(ball.idleWx.textContent.indexOf('Ballarat\u00a0· 5°') === 0 && !/City of/.test(ball.idleWx.textContent), 'the idle line too: ' + ball.idleWx.textContent);
const one = render('en', 'Riverside');
assert(one.date.innerHTML.includes('<span class="wx-town">Riverside</span>'), 'a one part name stays as it is');
const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');
assert(/\.wx-town \{[^}]*max-width:[^}]*text-overflow: ellipsis[^}]*white-space: nowrap/.test(css), 'a long town name ends in an ellipsis (app.css .wx-town)');
// widgets.js and design.js draw the town alone too; Home settings, Location keeps the full name
const widgets = fs.readFileSync(path.join(web, 'widgets.js'), 'utf8'), design = fs.readFileSync(path.join(web, 'design.js'), 'utf8');
assert(/place: townOnly\(src\.place && src\.place\.name\)/.test(widgets) && /townOnly\(p\.name\)/.test(widgets), 'widgets.js: the weather and a picked town are drawn as the town alone');
const ctx = {}; vm.runInNewContext(widgets.match(/function townOnly\(n\) \{[^\n]*\}/)[0] + "; this.t = townOnly;", ctx);
assert.strictEqual(ctx.t('Ballarat, City of Ballarat, Victoria, Australia'), 'Ballarat');
assert.strictEqual(ctx.t(''), '');
assert((design.match(/h\("span", "wx-town", null, \[b\.place\]\)/g) || []).length === 3, 'design.js: the three weather styles draw the town in .wx-town');
assert(/info\("loc-now", t\("loc_now"\), WXCFG\.place/.test(app), 'Home settings, Location: the full name');

console.log('Weather header tests passed.');
