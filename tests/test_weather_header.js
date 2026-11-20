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

function render(language) {
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
    WXCFG: { place: 'Sâmburești, Olt, Romania' },
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
  romanian.date.innerHTML.includes('Sâmburești, Olt · 5° · Înnorat'),
  'Romanian weather line shows the configured locality, live temperature, and localized condition'
);
assert(romanian.classes.has('weather-lines'), 'Romanian date and weather render on separate lines');
assert.strictEqual(romanian.idleWx.textContent, 'Sâmburești, Olt · 5° · Înnorat');
assert(/^\d{2}:\d{2}$/.test(romanian.time.innerHTML), 'the time remains a separate live clock');

const english = render('en');
assert(english.date.innerHTML.includes('Sunday 15 November'), 'other locales keep their existing date punctuation');
assert(english.date.innerHTML.includes('Sâmburești, Olt, Romania'), 'other locales keep the full configured place');
assert(english.date.innerHTML.includes('Sunday 15 November<span class="wx"><span class="wx-place"> · Sâmburești, Olt, Romania · </span>'),
  'the one-line header puts the same middle dot between the date and the place as between the other parts');
assert(english.date.innerHTML.includes('<svg class="icon"></svg>'), 'other locales retain the existing weather icon');
assert(!english.classes.has('weather-lines'), 'the Romanian stacked layout is not applied to other locales');

console.log('Weather header tests passed.');
