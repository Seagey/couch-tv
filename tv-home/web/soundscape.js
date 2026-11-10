// Procedural Web Audio Soundscapes for couch-tv (ekagra-codes, #81)
// Pure client-side synthesis: Rain, Fireplace, Ocean Waves, and Brown Noise.
// Zero external files or streaming bandwidth needed.
(function (root) {
  "use strict";

  var AudioCtx = root.AudioContext || root.webkitAudioContext;
  var ctx = null;
  var masterGain = null;
  var currentType = "off";
  var currentVol = 0.5;
  var activeNodes = [];
  var crackleTimer = null;
  var flutterTimer = null;

  var TYPES = ["off", "rain", "fire", "waves", "brown"];

  function getCtx() {
    if (!ctx && AudioCtx) {
      try {
        ctx = new AudioCtx();
      } catch (e) {
        ctx = null;
      }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(function () {});
    }
    return ctx;
  }

  // Pre-generate a 4-second loop of high-quality stereo pink/brown noise
  var noiseBuf = null;
  function getNoiseBuffer(ac) {
    if (noiseBuf) return noiseBuf;
    var rate = ac.sampleRate || 44100;
    var len = rate * 4;
    noiseBuf = ac.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = noiseBuf.getChannelData(ch);
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        // Paul Kellet's refined pink noise filter algorithm
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
    return noiseBuf;
  }

  function cleanNodes() {
    if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }
    if (flutterTimer) { clearInterval(flutterTimer); flutterTimer = null; }
    activeNodes.forEach(function (n) {
      try {
        if (n.stop) n.stop();
        if (n.disconnect) n.disconnect();
      } catch (e) {}
    });
    activeNodes = [];
  }

  function ensureMaster(ac) {
    if (!masterGain) {
      masterGain = ac.createGain();
      masterGain.gain.setValueAtTime(currentVol, ac.currentTime);
      masterGain.connect(ac.destination);
    }
    return masterGain;
  }

  function play(type, vol) {
    if (TYPES.indexOf(type) < 0) type = "off";
    if (typeof vol === "number") currentVol = Math.max(0, Math.min(1, vol));

    var ac = getCtx();
    if (!ac) return;
    ensureMaster(ac);
    // a new sound starts at the chosen volume, not where the last fade left it
    masterGain.gain.cancelScheduledValues(ac.currentTime);
    masterGain.gain.setValueAtTime(currentVol, ac.currentTime);

    if (type === "off") {
      stop();
      return;
    }

    cleanNodes();
    currentType = type;

    var buf = getNoiseBuffer(ac);
    var src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    if (type === "brown") {
      // Deep, soothing brownian low-pass
      var lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;
      src.connect(lp);
      lp.connect(masterGain);
      activeNodes.push(src, lp);
      src.start();
    } else if (type === "rain") {
      // Rain: filtered noise bed + gentle droplet modulation
      var lpRain = ac.createBiquadFilter();
      lpRain.type = "lowpass";
      lpRain.frequency.value = 2400;

      var bpRain = ac.createBiquadFilter();
      bpRain.type = "bandpass";
      bpRain.frequency.value = 1100;
      bpRain.Q.value = 1.0;

      var rainGain = ac.createGain();
      rainGain.gain.value = 0.85;

      src.connect(lpRain);
      lpRain.connect(bpRain);
      bpRain.connect(rainGain);
      rainGain.connect(masterGain);
      activeNodes.push(src, lpRain, bpRain, rainGain);
      src.start();

      // Subtle dynamic intensity variation (gusts/downpours)
      flutterTimer = setInterval(function () {
        if (!ac || currentType !== "rain") return;
        var target = 0.75 + Math.random() * 0.35;
        rainGain.gain.setTargetAtTime(target, ac.currentTime, 1.2);
      }, 2500);
    } else if (type === "waves") {
      // Ocean waves: slow swell LFO modulating filter and amplitude
      var waveFilter = ac.createBiquadFilter();
      waveFilter.type = "lowpass";
      waveFilter.frequency.value = 350;

      var waveGain = ac.createGain();
      waveGain.gain.value = 0.6;

      // LFO for periodic wave rhythm (~0.08 Hz = 12.5s cycle)
      var lfo = ac.createOscillator();
      lfo.frequency.value = 0.08;
      var lfoGain = ac.createGain();
      lfoGain.gain.value = 250; // Cutoff sweeps ±250 Hz

      lfo.connect(lfoGain);
      lfoGain.connect(waveFilter.frequency);

      var lfoAmp = ac.createGain();
      lfoAmp.gain.value = 0.35; // Gain sweeps
      lfo.connect(lfoAmp);
      lfoAmp.connect(waveGain.gain);

      src.connect(waveFilter);
      waveFilter.connect(waveGain);
      waveGain.connect(masterGain);

      activeNodes.push(src, waveFilter, waveGain, lfo, lfoGain, lfoAmp);
      lfo.start();
      src.start();
    } else if (type === "fire") {
      // Fire: warm low-end rumble + intermittent crackles
      var fireLp = ac.createBiquadFilter();
      fireLp.type = "lowpass";
      fireLp.frequency.value = 320;

      var fireBedGain = ac.createGain();
      fireBedGain.gain.value = 0.7;

      src.connect(fireLp);
      fireLp.connect(fireBedGain);
      fireBedGain.connect(masterGain);
      activeNodes.push(src, fireLp, fireBedGain);
      src.start();

      // Periodic random crackle bursts
      function scheduleCrackle() {
        if (!ac || currentType !== "fire") return;
        var nextDelay = 120 + Math.random() * 380;
        crackleTimer = setTimeout(function () {
          if (!ac || currentType !== "fire") return;
          try {
            var cSrc = ac.createBufferSource();
            cSrc.buffer = buf;
            var cFilter = ac.createBiquadFilter();
            cFilter.type = "bandpass";
            cFilter.frequency.value = 1800 + Math.random() * 2200;
            cFilter.Q.value = 3.5;

            var cGain = ac.createGain();
            var now = ac.currentTime;
            var popVol = 0.4 + Math.random() * 0.55;
            cGain.gain.setValueAtTime(popVol, now);
            cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02 + Math.random() * 0.03);

            cSrc.connect(cFilter);
            cFilter.connect(cGain);
            cGain.connect(masterGain);

            cSrc.start(now);
            cSrc.stop(now + 0.06);
          } catch (e) {}
          scheduleCrackle();
        }, nextDelay);
      }
      scheduleCrackle();
    }
  }

  function stop() {
    currentType = "off";
    cleanNodes();
  }

  function setVolume(vol) {
    currentVol = Math.max(0, Math.min(1, vol));
    var ac = getCtx();
    if (ac && masterGain) {
      masterGain.gain.setTargetAtTime(currentVol, ac.currentTime, 0.08);
    }
  }

  function fade(targetVol, durationSec) {
    var ac = getCtx();
    if (!ac || !masterGain) return;
    targetVol = Math.max(0, Math.min(1, targetVol));
    durationSec = durationSec || 2;
    masterGain.gain.linearRampToValueAtTime(targetVol, ac.currentTime + durationSec);
  }

  // Wake AudioContext on first user action (browser autoplay policy)
  function initUserGesture() {
    function unlock() {
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(function () {});
      }
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("click", unlock);
    }
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("click", unlock);
  }
  initUserGesture();

  root.Soundscape = {
    TYPES: TYPES,
    play: play,
    stop: stop,
    setVolume: setVolume,
    fade: fade,
    current: function () { return currentType; },
    volume: function () { return currentVol; }
  };
})(typeof window !== "undefined" ? window : this);
