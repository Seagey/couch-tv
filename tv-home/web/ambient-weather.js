// Weather-Responsive Ambient Overlays & Solar Celestial Color Grading for couch-tv
// Pure client-side procedural 2D canvas particle physics + smooth astronomical lighting tints.
// Strict ES5 compatibility for legacy TV WebViews (Chrome 44+ on Android 6 / Fire OS 6).
(function (root) {
  "use strict";

  var canvas = null;
  var ctx = null;
  var lightingEl = null;

  var running = false;
  var rafId = null;
  var isPaused = false;
  var enabled = false;      // off until the home says so (Home settings, Weather)
  var sunGradeEnabled = false;
  var lighterMode = false;

  var currentType = "clear"; // "rain", "snow", "fog", "storm", "clear"
  var particles = [];
  var fogNodes = [];
  var MAX_RAIN = 65;
  var MAX_SNOW = 40;
  var MAX_FOG = 4;

  var W = 1920;
  var H = 1080;
  var lastTime = 0;

  // Thunderstorm lightning state
  var flashAlpha = 0;
  var nextFlashTime = 0;

  // WMO weather code categorization (Open-Meteo standard)
  var RAIN_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82];
  var SNOW_CODES = [71, 73, 75, 77, 85, 86];
  var FOG_CODES = [45, 48];
  var STORM_CODES = [95, 96, 99];

  function getQueryParam(name) {
    var m = (root.location && root.location.search) ? root.location.search.match(new RegExp("[?&]" + name + "=([^&]+)")) : null;
    return m ? decodeURIComponent(m[1]) : null;
  }

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Pre-allocate particles for zero-garbage-collection rendering at 60fps
  function initParticlePool() {
    particles = [];
    var i;
    for (i = 0; i < MAX_RAIN; i++) {
      particles.push({
        x: Math.random() * (W + 200) - 100,
        y: Math.random() * H,
        len: randomRange(25, 48),
        speed: randomRange(22, 34),
        alpha: randomRange(0.12, 0.32),
        width: randomRange(1.2, 1.8),
        splash: 0,
        splashMax: randomRange(6, 14),
        splashX: 0,
        splashY: 0
      });
    }

    fogNodes = [];
    for (i = 0; i < MAX_FOG; i++) {
      fogNodes.push({
        x: randomRange(0, W),
        y: randomRange(H * 0.35, H * 0.95),
        radius: randomRange(260, 480),
        speed: randomRange(0.12, 0.28) * (Math.random() < 0.5 ? 1 : -1),
        alpha: randomRange(0.04, 0.08)
      });
    }
  }

  function resetSnowParticle(p, startAnywhere) {
    p.x = Math.random() * (W + 100) - 50;
    p.y = startAnywhere ? Math.random() * H : -10;
    p.radius = randomRange(1.8, 3.8);
    p.speedY = randomRange(1.2, 2.8);
    p.speedX = randomRange(-0.4, 0.4);
    p.wobble = Math.random() * Math.PI * 2;
    p.wobbleSpeed = randomRange(0.015, 0.035);
    p.alpha = randomRange(0.25, 0.65);
  }

  function resetRainParticle(p, startAnywhere) {
    p.x = Math.random() * (W + 300) - 150;
    p.y = startAnywhere ? Math.random() * H : -p.len;
    p.len = randomRange(28, 52);
    p.speed = randomRange(24, 36);
    p.alpha = randomRange(0.12, 0.32);
    p.width = randomRange(1.2, 1.8);
    p.splash = 0;
  }

  // Draws (or clears) the current weather: called when the weather, or a setting that gates it, changes.
  function applyType() {
    stopLoop();
    if (ctx) ctx.clearRect(0, 0, W, H);
    if (lightingEl) lightingEl.classList.remove("has-weather-tint", "wx-rain-tint", "wx-snow-tint", "wx-fog-tint", "wx-storm-tint");
    if (!canvas || !ctx || currentType === "clear" || !enabled || lighterMode) return;

    // Re-initialize particles for the type
    var count = currentType === "snow" ? MAX_SNOW : MAX_RAIN;
    for (var i = 0; i < count; i++) {
      if (currentType === "snow") resetSnowParticle(particles[i], true);
      else resetRainParticle(particles[i], true);
    }

    if (lightingEl) lightingEl.classList.add("has-weather-tint", "wx-" + currentType + "-tint");

    if (currentType === "storm") {
      nextFlashTime = Date.now() + randomRange(8000, 18000);
      flashAlpha = 0;
    }

    startLoop();
  }

  function setWeatherType(type) {
    if (currentType === type) return;
    currentType = type;
    applyType();
  }

  function startLoop() {
    if (running || isPaused || currentType === "clear" || !enabled || lighterMode) return;
    running = true;
    lastTime = Date.now();
    rafId = root.requestAnimationFrame(renderLoop);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      root.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function renderLoop() {
    if (!running) return;

    var now = Date.now();
    // 30 frames a second is plenty for slow rain and snow, and half the work for a weak box
    if (now - lastTime < 32) {
      rafId = root.requestAnimationFrame(renderLoop);
      return;
    }
    var dt = (now - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1; // clamp delta during lag spikes
    lastTime = now;
    var k = dt * 60; // movement is per 60th of a second, so the speed is the same at any frame rate

    ctx.clearRect(0, 0, W, H);

    var windAngle = 0.16; // gentle diagonal tilt ~9 degrees

    if (currentType === "rain" || currentType === "storm") {
      var rainCount = MAX_RAIN;
      ctx.lineWidth = 1.4;

      for (var r = 0; r < rainCount; r++) {
        var rp = particles[r];
        if (rp.splash > 0) {
          // Render dying splash ring near bottom
          rp.splash += dt * 30;
          ctx.beginPath();
          ctx.ellipse(rp.splashX, rp.splashY, rp.splash * 1.5, rp.splash * 0.6, 0, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(220, 235, 255, " + (Math.max(0, (1 - rp.splash / rp.splashMax) * rp.alpha * 0.7)).toFixed(3) + ")";
          ctx.stroke();
          if (rp.splash >= rp.splashMax) {
            resetRainParticle(rp, false);
          }
        } else {
          rp.y += rp.speed * k;
          rp.x += rp.speed * k * windAngle;

          var bottomBound = H - randomRange(10, 80);
          if (rp.y >= bottomBound) {
            rp.splash = 1;
            rp.splashX = rp.x;
            rp.splashY = rp.y;
          } else {
            ctx.beginPath();
            ctx.moveTo(rp.x, rp.y);
            ctx.lineTo(rp.x - rp.len * windAngle, rp.y - rp.len);
            ctx.strokeStyle = "rgba(205, 225, 255, " + rp.alpha.toFixed(3) + ")";
            ctx.lineWidth = rp.width;
            ctx.stroke();
          }
        }
      }

      // Lightning flare in thunderstorms
      if (currentType === "storm") {
        if (now >= nextFlashTime && flashAlpha <= 0) {
          flashAlpha = randomRange(0.20, 0.35); // subtle ambient wash, never blinding white
          nextFlashTime = now + randomRange(14000, 32000);
        }
        if (flashAlpha > 0) {
          flashAlpha -= dt * 1.4;
          if (flashAlpha < 0) flashAlpha = 0;
          ctx.fillStyle = "rgba(225, 235, 255, " + flashAlpha.toFixed(3) + ")";
          ctx.fillRect(0, 0, W, H);
        }
      }
    } else if (currentType === "snow") {
      var snowCount = MAX_SNOW;
      for (var s = 0; s < snowCount; s++) {
        var sp = particles[s];
        sp.wobble += sp.wobbleSpeed * k;
        sp.y += sp.speedY * k;
        sp.x += (Math.sin(sp.wobble) * 0.75 + sp.speedX) * k;

        if (sp.y > H + 10 || sp.x < -20 || sp.x > W + 20) {
          resetSnowParticle(sp, false);
        }

        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(245, 250, 255, " + sp.alpha.toFixed(3) + ")";
        ctx.fill();
      }
    } else if (currentType === "fog") {
      for (var f = 0; f < fogNodes.length; f++) {
        var fn = fogNodes[f];
        fn.x += fn.speed * k;
        if (fn.speed > 0 && fn.x - fn.radius > W) fn.x = -fn.radius;
        if (fn.speed < 0 && fn.x + fn.radius < 0) fn.x = W + fn.radius;

        var grad = ctx.createRadialGradient(fn.x, fn.y, fn.radius * 0.1, fn.x, fn.y, fn.radius);
        grad.addColorStop(0, "rgba(220, 230, 240, " + fn.alpha.toFixed(3) + ")");
        grad.addColorStop(0.6, "rgba(220, 230, 240, " + (fn.alpha * 0.45).toFixed(3) + ")");
        grad.addColorStop(1, "rgba(220, 230, 240, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(fn.x - fn.radius, fn.y - fn.radius, fn.radius * 2, fn.radius * 2);
      }
    }

    rafId = root.requestAnimationFrame(renderLoop);
  }

  // Astronomical Solar Color Grading mapping
  function applySolarColorGrading(sunPos) {
    if (!lightingEl) return;
    if (!sunGradeEnabled) {
      lightingEl.style.backgroundImage = "";
      lightingEl.style.opacity = "";
      return;
    }

    var alt = sunPos ? sunPos.alt : 20;
    var isMorning = sunPos ? (sunPos.hourAngle < 0) : true;

    // Test override from URL parameter: ?test_alt=-5
    var testAlt = getQueryParam("test_alt");
    if (testAlt !== null && isFinite(Number(testAlt))) {
      alt = Number(testAlt);
    }

    var gradient = "";
    var opacity = 1.0;

    if (alt < -12) {
      // Midnight & Deep Astronomical Night: deep cool navy, calm dimming
      gradient = "linear-gradient(180deg, rgba(8, 12, 24, 0.32) 0%, rgba(5, 8, 18, 0.45) 100%)";
    } else if (alt < -4) {
      // Nautical Twilight / Blue Hour: deep violet-indigo
      gradient = isMorning
        ? "linear-gradient(175deg, rgba(24, 18, 48, 0.28) 0%, rgba(45, 26, 60, 0.22) 100%)"
        : "linear-gradient(175deg, rgba(35, 18, 55, 0.32) 0%, rgba(14, 18, 42, 0.38) 100%)";
    } else if (alt < 2) {
      // Civil Twilight / Sunrise & Sunset: delicate rose, peach and violet glow
      gradient = isMorning
        ? "linear-gradient(185deg, rgba(255, 130, 90, 0.18) 0%, rgba(200, 85, 130, 0.12) 65%, rgba(40, 20, 60, 0.22) 100%)"
        : "linear-gradient(185deg, rgba(245, 100, 65, 0.22) 0%, rgba(175, 60, 115, 0.18) 60%, rgba(30, 18, 55, 0.28) 100%)";
    } else if (alt < 12) {
      // Golden Hour: rich honey-amber warmth
      gradient = isMorning
        ? "linear-gradient(190deg, rgba(255, 180, 105, 0.15) 0%, rgba(255, 140, 70, 0.08) 70%, rgba(0, 0, 0, 0) 100%)"
        : "linear-gradient(190deg, rgba(255, 150, 50, 0.18) 0%, rgba(220, 100, 45, 0.12) 65%, rgba(0, 0, 0, 0) 100%)";
    } else {
      // Midday / Daylight: crisp natural light
      gradient = "linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(0, 0, 0, 0) 70%)";
      opacity = 0.5;
    }

    lightingEl.style.backgroundImage = gradient;
    lightingEl.style.opacity = opacity;
  }

  var API = {
    init: function (canvasElement, lightingElement) {
      canvas = canvasElement;
      lightingEl = lightingElement;
      if (canvas && canvas.getContext) {
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext("2d");
        initParticlePool();
      }
      applyType();   // the weather may have been set before the canvas was

      // Check test overrides
      var testWx = getQueryParam("test_wx");
      if (testWx !== null && isFinite(Number(testWx))) {
        API.setWeather({ code: Number(testWx), temp: 20 }, null);
      }
    },

    setWeather: function (weatherData, sunPos) {
      if (sunPos) applySolarColorGrading(sunPos);

      var testWx = getQueryParam("test_wx");
      var code = (testWx !== null && isFinite(Number(testWx))) ? Number(testWx) : (weatherData ? weatherData.code : null);

      if (code == null) {
        setWeatherType("clear");
        return;
      }

      if (STORM_CODES.indexOf(code) >= 0) {
        setWeatherType("storm");
      } else if (RAIN_CODES.indexOf(code) >= 0) {
        setWeatherType("rain");
      } else if (SNOW_CODES.indexOf(code) >= 0) {
        setWeatherType("snow");
      } else if (FOG_CODES.indexOf(code) >= 0) {
        setWeatherType("fog");
      } else {
        setWeatherType("clear");
      }
    },

    setSolarGrading: function (sunPos) {
      applySolarColorGrading(sunPos);
    },

    pause: function () {
      isPaused = true;
      stopLoop();
    },

    resume: function () {
      isPaused = false;
      if (currentType !== "clear" && enabled && !lighterMode) {
        startLoop();
      }
    },

    setEnabled: function (val) {
      val = !!val;
      if (val === enabled) return;
      enabled = val;
      applyType();
    },

    setSunGradeEnabled: function (val) {
      sunGradeEnabled = !!val;
      if (lightingEl && !sunGradeEnabled) {
        lightingEl.style.backgroundImage = "";
        lightingEl.style.opacity = "";
      }
    },

    setLighter: function (val) {
      val = !!val;
      if (val === lighterMode) return;
      lighterMode = val;
      applyType();
    },

    getType: function () {
      return currentType;
    }
  };

  root.AmbientWeather = API;
})(typeof window !== "undefined" ? window : this);
