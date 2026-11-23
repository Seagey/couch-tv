// Unit and integration test for AmbientWeather engine
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Mock DOM elements and canvas context
function createMockCanvas() {
  const operations = [];
  return {
    width: 0,
    height: 0,
    getContext: function (type) {
      assert.strictEqual(type, "2d");
      return {
        clearRect: function (x, y, w, h) { operations.push({ op: "clearRect", x, y, w, h }); },
        beginPath: function () { operations.push({ op: "beginPath" }); },
        moveTo: function (x, y) { operations.push({ op: "moveTo", x, y }); },
        lineTo: function (x, y) { operations.push({ op: "lineTo", x, y }); },
        arc: function (x, y, r) { operations.push({ op: "arc", x, y, r }); },
        ellipse: function (x, y, rx, ry) { operations.push({ op: "ellipse", x, y, rx, ry }); },
        stroke: function () { operations.push({ op: "stroke" }); },
        fill: function () { operations.push({ op: "fill" }); },
        fillRect: function (x, y, w, h) { operations.push({ op: "fillRect", x, y, w, h }); },
        createRadialGradient: function () {
          return { addColorStop: function () {} };
        }
      };
    },
    _ops: operations
  };
}

function createMockLighting() {
  const classes = new Set();
  return {
    style: { backgroundImage: "", opacity: "" },
    classList: {
      add: function (...names) { names.forEach(n => classes.add(n)); },
      remove: function (...names) { names.forEach(n => classes.delete(n)); },
      contains: function (n) { return classes.has(n); }
    },
    _classes: classes
  };
}

// Setup sandbox environment
const sandbox = {
  window: {},
  location: { search: "" },
  requestAnimationFrame: function (cb) { return 100; },
  cancelAnimationFrame: function (id) {},
  Date: Date,
  Math: Math,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.window = sandbox;

const code = fs.readFileSync(require("path").join(__dirname, "..", "tv-home", "web", "ambient-weather.js"), "utf8");
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const AmbientWeather = sandbox.AmbientWeather;
assert(AmbientWeather, "AmbientWeather should be exported");

// Test 1: Initialization
const canvas = createMockCanvas();
const lighting = createMockLighting();
AmbientWeather.init(canvas, lighting);
assert.strictEqual(canvas.width, 1920, "Canvas width should be initialized to 1920");
assert.strictEqual(canvas.height, 1080, "Canvas height should be initialized to 1080");

// Test 1b: off until the home switches it on (Home settings, Weather)
AmbientWeather.setWeather({ code: 63, temp: 18 }, { alt: 30, hourAngle: 0 });
assert(!lighting._classes.has("has-weather-tint"), "No weather tint while the effects are off");
assert.strictEqual(lighting.style.backgroundImage, "", "No sun grade while it is off");
// switching it on afterwards draws the weather already known, not only the next change
AmbientWeather.setEnabled(true);
assert(lighting._classes.has("wx-rain-tint"), "Switching the effects on applies the rain already reported");
AmbientWeather.setLighter(true);
assert(!lighting._classes.has("has-weather-tint"), "Lighter home removes the tint");
AmbientWeather.setLighter(false);
assert(lighting._classes.has("wx-rain-tint"), "Leaving Lighter home brings it back");
AmbientWeather.setEnabled(false);
assert(!lighting._classes.has("has-weather-tint"), "Switching off removes the tint");
AmbientWeather.setEnabled(true);
AmbientWeather.setSunGradeEnabled(true);
AmbientWeather.setWeather({ code: 0, temp: 18 }, null);

// Test 2: WMO Weather Code Mapping
// Rain codes: 61 (light rain), 63 (rain), 65 (heavy rain), 51 (drizzle)
AmbientWeather.setWeather({ code: 61, temp: 18 }, null);
assert.strictEqual(AmbientWeather.getType(), "rain", "WMO 61 should map to rain");
assert(lighting._classes.has("wx-rain-tint"), "Rain tint class should be set");

// Snow codes: 71 (light snow), 73, 75
AmbientWeather.setWeather({ code: 71, temp: -2 }, null);
assert.strictEqual(AmbientWeather.getType(), "snow", "WMO 71 should map to snow");
assert(lighting._classes.has("wx-snow-tint"), "Snow tint class should be set");

// Fog codes: 45, 48
AmbientWeather.setWeather({ code: 45, temp: 10 }, null);
assert.strictEqual(AmbientWeather.getType(), "fog", "WMO 45 should map to fog");
assert(lighting._classes.has("wx-fog-tint"), "Fog tint class should be set");

// Storm codes: 95, 96, 99
AmbientWeather.setWeather({ code: 95, temp: 22 }, null);
assert.strictEqual(AmbientWeather.getType(), "storm", "WMO 95 should map to storm");
assert(lighting._classes.has("wx-storm-tint"), "Storm tint class should be set");

// Clear codes: 0, 1, 2, 3
AmbientWeather.setWeather({ code: 0, temp: 24 }, null);
assert.strictEqual(AmbientWeather.getType(), "clear", "WMO 0 should map to clear");
assert(!lighting._classes.has("has-weather-tint"), "Weather tint should be removed on clear");

// Test 3: Solar Color Grading
// Midnight (alt < -12)
AmbientWeather.setSolarGrading({ alt: -20, hourAngle: 0 });
assert(lighting.style.backgroundImage.includes("rgba(8, 12, 24"), "Midnight gradient should match deep night");

// Dawn / Sunrise (alt between -4 and 2, morning hourAngle < 0)
AmbientWeather.setSolarGrading({ alt: -1, hourAngle: -90 });
assert(lighting.style.backgroundImage.includes("rgba(255, 130, 90"), "Dawn gradient should match morning rose glow");

// Sunset (alt between -4 and 2, evening hourAngle > 0)
AmbientWeather.setSolarGrading({ alt: -1, hourAngle: 90 });
assert(lighting.style.backgroundImage.includes("rgba(245, 100, 65"), "Sunset gradient should match evening glow");

// Golden Hour morning (alt between 2 and 12, hourAngle < 0)
AmbientWeather.setSolarGrading({ alt: 6, hourAngle: -75 });
assert(lighting.style.backgroundImage.includes("rgba(255, 180, 105"), "Golden hour morning should match warm peach");

// Golden Hour evening (alt between 2 and 12, hourAngle > 0)
AmbientWeather.setSolarGrading({ alt: 6, hourAngle: 75 });
assert(lighting.style.backgroundImage.includes("rgba(255, 150, 50"), "Golden hour evening should match honey amber");

// Midday (alt >= 12)
AmbientWeather.setSolarGrading({ alt: 55, hourAngle: 0 });
assert(lighting.style.backgroundImage.includes("rgba(255, 255, 255"), "Midday should be clear natural light");

// Test 4: Enable / Disable toggles
AmbientWeather.setWeather({ code: 61, temp: 18 }, null);
AmbientWeather.setEnabled(false);
AmbientWeather.setEnabled(true);
assert.strictEqual(AmbientWeather.getType(), "rain");

// Test 5: Lighter mode
AmbientWeather.setLighter(true);
AmbientWeather.setLighter(false);

console.log("All AmbientWeather tests passed successfully!");
