/* ══ Audio reactor ════════════════════════════════════════════════════════
   One shared analyser for every generative effect. It exposes smoothed band
   energies plus a beat envelope, all normalised to 0..1:

     GenAudio.bands = { level, bass, mid, high, beat }

   `beat` is an envelope that snaps to 1 on a detected kick and decays, so it
   is usable both as a continuous modulator and — via GenAudio.beatCount — as
   a discrete event an effect can latch onto.

   The source is either the microphone or an audio file the user picks; the
   file plays through the speakers so you can score a clip while recording. */

window.GenAudio = window.GenAudio || {};

(function () {
  'use strict';

  const FFT = 2048;

  let ctxA      = null;      // AudioContext
  let analyser  = null;
  let freqData  = null;
  let sourceNode = null;
  let mediaEl   = null;      // <audio> when playing a file
  let stream    = null;      // MediaStream when using the mic

  // Rolling history of bass energy, for beat detection
  const HISTORY = 43;        // ~0.7s at 60fps
  const history = new Float32Array(HISTORY);
  let   hIndex  = 0, hFilled = 0;
  let   beatCooldown = 0;

  // Beat interval history, for the BPM readout
  const INTERVALS = 12;
  const intervals = [];
  let   lastBeatAt = 0;

  GenAudio.bpm       = 0;            // 0 until enough beats to be confident
  GenAudio.source    = 'off';        // 'off' | 'mic' | 'file'
  GenAudio.fileName  = '';
  GenAudio.gain      = 1.4;
  GenAudio.smoothing = 0.72;
  GenAudio.beatCount = 0;            // increments once per detected kick
  GenAudio.bands     = { level: 0, bass: 0, mid: 0, high: 0, beat: 0 };
  GenAudio.error     = '';

  GenAudio.isActive = function () { return GenAudio.source !== 'off' && !!analyser; };

  // ── Self-driving loop ────────────────────────────────────────────────────
  // The analyser runs on its own rAF rather than piggy-backing on an effect's
  // tick, so meters stay live on any tab and during a fixed-timestep render.

  let rafId = 0, lastLoop = 0;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const dt = lastLoop ? Math.min(0.1, (now - lastLoop) / 1000) : 1 / 60;
    lastLoop = now;
    GenAudio.update(dt);
    meterListeners.forEach(fn => { try { fn(GenAudio.bands); } catch (e) {} });
  }

  function startLoop() {
    if (!rafId) { lastLoop = 0; rafId = requestAnimationFrame(loop); }
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    GenAudio.update(0);
    meterListeners.forEach(fn => { try { fn(GenAudio.bands); } catch (e) {} });
  }

  const meterListeners = [];
  GenAudio.onFrame = function (fn) { meterListeners.push(fn); };

  // ── Source management ────────────────────────────────────────────────────

  function ensureContext() {
    if (!ctxA) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctxA = new AC();
      analyser = ctxA.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0.6;
      freqData = new Uint8Array(analyser.frequencyBinCount);
    }
    if (ctxA.state === 'suspended') ctxA.resume();
    return ctxA;
  }

  function disconnect() {
    if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (mediaEl) { mediaEl.pause(); mediaEl.src = ''; mediaEl = null; }
    GenAudio.bands.level = GenAudio.bands.bass = 0;
    GenAudio.bands.mid   = GenAudio.bands.high = GenAudio.bands.beat = 0;
  }

  GenAudio.stop = function () {
    disconnect();
    stopLoop();
    intervals.length = 0;
    GenAudio.bpm    = 0;
    GenAudio.source   = 'off';
    GenAudio.fileName = '';
    GenAudio.error    = '';
    notify();
  };

  GenAudio.useMic = async function () {
    GenAudio.error = '';
    try {
      ensureContext();
      disconnect();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      sourceNode = ctxA.createMediaStreamSource(stream);
      sourceNode.connect(analyser);          // mic is not routed to output
      GenAudio.source = 'mic';
      startLoop();
    } catch (e) {
      GenAudio.error  = 'Microphone blocked: ' + (e.message || e.name);
      GenAudio.source = 'off';
    }
    notify();
  };

  GenAudio.useFile = function (file) {
    GenAudio.error = '';
    try {
      ensureContext();
      disconnect();
      mediaEl = new Audio();
      mediaEl.src   = URL.createObjectURL(file);
      mediaEl.loop  = true;
      mediaEl.crossOrigin = 'anonymous';
      sourceNode = ctxA.createMediaElementSource(mediaEl);
      sourceNode.connect(analyser);
      analyser.connect(ctxA.destination);    // hear the track while it drives
      mediaEl.play();
      GenAudio.source   = 'file';
      GenAudio.fileName = file.name;
      startLoop();
    } catch (e) {
      GenAudio.error  = 'Could not play that file: ' + (e.message || e.name);
      GenAudio.source = 'off';
    }
    notify();
  };

  GenAudio.togglePlayback = function () {
    if (!mediaEl) return;
    if (mediaEl.paused) mediaEl.play(); else mediaEl.pause();
  };

  GenAudio.isPlaying = function () { return !!mediaEl && !mediaEl.paused; };

  // Listeners so control panels can redraw when the source changes
  const listeners = [];
  GenAudio.onChange = function (fn) { listeners.push(fn); };
  function notify() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }

  // ── Synthetic beat (used by bar-locked recording) ────────────────────────
  // Replaces the analyser's beat with a metronome at a known tempo so a
  // rendered clip lands on the grid and loops.

  let synth = null;

  GenAudio.beginSyntheticBeat = function (bpm) {
    synth = { interval: 60 / bpm, t: 0, first: true };
    return function () { synth = null; };
  };

  GenAudio.advanceSyntheticBeat = function (dt) {
    if (!synth) return;
    const b = GenAudio.bands;
    synth.t += dt;
    if (synth.first || synth.t >= synth.interval) {
      if (!synth.first) synth.t -= synth.interval;
      synth.first = false;
      GenAudio.beatCount++;
      b.beat = 1;
    } else {
      b.beat *= Math.exp(-7 * dt);
    }
  };

  GenAudio.isSynthetic = function () { return !!synth; };

  // ── Spectrum ─────────────────────────────────────────────────────────────
  // Log-spaced bins in 0..1, for effects that draw the spectrum itself.
  // With no source running it returns false so callers can fake something.

  GenAudio.getSpectrum = function (out, n) {
    if (!GenAudio.isActive()) return false;
    analyser.getByteFrequencyData(freqData);
    const lo = 30, hi = 14000;
    const binHz = ctxA.sampleRate / FFT;
    const ratio = Math.pow(hi / lo, 1 / n);
    let f0 = lo;
    for (let i = 0; i < n; i++) {
      const f1 = f0 * ratio;
      let a = Math.max(1, Math.round(f0 / binHz));
      let b = Math.min(freqData.length - 1, Math.max(a + 1, Math.round(f1 / binHz)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += freqData[j];
      // Tilt the top end up — music has far less energy up there
      const tilt = 1 + (i / n) * 1.4;
      out[i] = Math.min(1, (sum / ((b - a) * 255)) * GenAudio.gain * tilt);
      f0 = f1;
    }
    return true;
  };

  // ── Per-frame analysis ───────────────────────────────────────────────────

  function bandEnergy(from, to) {
    let sum = 0;
    for (let i = from; i < to; i++) sum += freqData[i];
    return sum / ((to - from) * 255);
  }

  GenAudio.update = function (dt) {
    const b = GenAudio.bands;

    if (!GenAudio.isActive()) {
      b.level = b.bass = b.mid = b.high = 0;
      b.beat  = b.beat > 0.001 ? b.beat * Math.exp(-6 * dt) : 0;
      return b;
    }

    analyser.getByteFrequencyData(freqData);

    // Bin index for a frequency: bin = f / (sampleRate / fftSize)
    const binHz = ctxA.sampleRate / FFT;
    const at    = f => Math.min(freqData.length - 1, Math.max(1, Math.round(f / binHz)));

    const gain = GenAudio.gain;
    const raw = {
      bass:  bandEnergy(at(25),   at(160))  * gain,
      mid:   bandEnergy(at(160),  at(2000)) * gain,
      high:  bandEnergy(at(2000), at(9000)) * gain * 1.6,
      level: bandEnergy(at(25),   at(9000)) * gain,
    };

    // Exponential smoothing, frame-rate independent
    const k = 1 - Math.pow(1 - (1 - GenAudio.smoothing), Math.min(1, dt * 60));
    for (const key in raw) {
      const v = Math.min(1, raw[key]);
      b[key] += (v - b[key]) * k;
    }

    // ── Beat detection: bass energy against its recent average ────────────
    const inst = raw.bass;
    let avg = 0;
    const n = hFilled || 1;
    for (let i = 0; i < n; i++) avg += history[i];
    avg /= n;

    beatCooldown -= dt;
    if (synth) {
      // A bar-locked render owns the beat; skip live detection this frame.
      history[hIndex] = inst;
      hIndex = (hIndex + 1) % HISTORY;
      if (hFilled < HISTORY) hFilled++;
      return b;
    }
    if (hFilled > 8 && inst > avg * 1.35 && inst > 0.12 && beatCooldown <= 0) {
      GenAudio.beatCount++;
      b.beat = 1;
      beatCooldown = 0.16;              // ~375 BPM ceiling

      // Tempo from the median gap between kicks — the median shrugs off the
      // occasional missed or doubled beat.
      const now = performance.now() / 1000;
      if (lastBeatAt) {
        const gap = now - lastBeatAt;
        if (gap > 0.2 && gap < 2) {
          intervals.push(gap);
          if (intervals.length > INTERVALS) intervals.shift();
          if (intervals.length >= 5) {
            const sorted = intervals.slice().sort((x, y) => x - y);
            const med    = sorted[sorted.length >> 1];
            let bpm = 60 / med;
            while (bpm < 90)  bpm *= 2;      // fold into a musical range
            while (bpm > 190) bpm /= 2;
            GenAudio.bpm = Math.round(bpm);
          }
        }
      }
      lastBeatAt = now;
    } else {
      b.beat *= Math.exp(-7 * dt);
    }

    history[hIndex] = inst;
    hIndex = (hIndex + 1) % HISTORY;
    if (hFilled < HISTORY) hFilled++;

    return b;
  };
})();
