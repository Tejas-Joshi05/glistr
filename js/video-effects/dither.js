window.DitherApp = window.DitherApp || {};

(function () {
  'use strict';

  let state = { ...DitherApp.defaultState };
  let controls = null;
  let _controlsEl = null;

  const eng = {
    frameCount:   0,
    noiseSeed:    Math.random() * 1000,
    lastRefresh:  -Infinity,
    dirty:        true,
    hasVideo:     false,
    exporting:    false,
    cancelExport: false,
  };

  const PREVIEW_MAX_H = 480;

  let displayCanvas, displayCtx;
  let previewCanvas, previewCtx;
  let testImageData;
  let _video;

  const previewPool = DitherApp.makePool();
  const exportPool  = DitherApp.makePool();

  // ── Sizing ─────────────────────────────────────────────────────────────────

  function previewSize(vw, vh) {
    const cap = VideoEffects.hiRes ? Infinity : 480;
    if (vh <= cap) return [vw, vh];
    const s = cap / vh;
    return [Math.round(vw * s), cap];
  }

  function setupCanvases(vw, vh) {
    const [pw, ph] = previewSize(vw, vh);
    previewCanvas.width  = pw;
    previewCanvas.height = ph;
    displayCanvas.width  = pw;
    displayCanvas.height = ph;
    previewPool.hasPrev  = false;
    const downscaled = pw < vw;
    VideoEffects.setVideoInfo(`${vw}×${vh}` + (downscaled ? `  ·  preview ${pw}×${ph}` : ''));
  }

  // ── Test pattern ───────────────────────────────────────────────────────────

  function buildTestPattern(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    const hg = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, `hsl(${i * 60},90%,55%)`);
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, w, h * 0.4);

    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, '#000');
    lg.addColorStop(1, '#fff');
    ctx.fillStyle = lg;
    ctx.fillRect(0, h * 0.4, w, h * 0.3);

    const sw = ['#e84040','#e87040','#e8c040','#40c840','#4080e8','#8040e8','#e840a0','#c0c0c0'];
    const cw = w / sw.length;
    sw.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(i * cw), h * 0.7, Math.ceil(cw), h * 0.3);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = `bold ${Math.round(h * 0.05)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('TEST PATTERN — load a video to start', w / 2, h * 0.55);
    return ctx.getImageData(0, 0, w, h);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function currentPreviewFrame() {
    if (eng.hasVideo && _video && _video.readyState >= 2) {
      previewCtx.drawImage(_video, 0, 0, previewCanvas.width, previewCanvas.height);
      return previewCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
    }
    return testImageData;
  }

  function onControlChange(key, val) {
    state = key === '__preset__'
      ? DitherApp.applyPreset(val)
      : { ...state, [key]: val, activePreset: null };
    controls.update(state);
    eng.dirty       = true;
    eng.lastRefresh = -Infinity;
    previewPool.hasPrev = false;
  }

  // ── Controls UI (with reset bar) ───────────────────────────────────────────

  function buildDitherUI(container) {
    controls = DitherApp.buildControlsPanel(container, state, onControlChange);

    // Prepend reset bar — buildControlsPanel cleared the container, so insert at top
    const resetBar = document.createElement('div');
    resetBar.className = 'controls-reset-bar';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', function () {
      state = { ...DitherApp.defaultState };
      buildDitherUI(container);
      eng.dirty       = true;
      eng.lastRefresh = -Infinity;
      previewPool.hasPrev = false;
    });
    resetBar.appendChild(resetBtn);
    container.insertBefore(resetBar, container.firstChild);
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function exportFrame() {
    const isImg = _video && _video.nodeName === 'CANVAS';
    if (isImg) {
      // Full-res render for photos
      const fw = _video.videoWidth, fh = _video.videoHeight;
      const expCanvas = document.createElement('canvas');
      expCanvas.width = fw; expCanvas.height = fh;
      const expCtx = expCanvas.getContext('2d');

      const srcC = document.createElement('canvas');
      srcC.width = fw; srcC.height = fh;
      const srcCtx = srcC.getContext('2d', { willReadFrequently: true });
      srcCtx.drawImage(_video, 0, 0, fw, fh);
      const imgData = srcCtx.getImageData(0, 0, fw, fh);

      // Temporarily swap display target so processFrame writes to expCanvas
      const origDC = displayCanvas, origDCtx = displayCtx;
      displayCanvas = expCanvas; displayCtx = expCtx;
      const expEng = { noiseSeed: eng.noiseSeed, frameCount: eng.frameCount };
      const result = DitherApp.processFrame(imgData, state, expEng, DitherApp.makePool());
      expCtx.putImageData(result, 0, 0);
      displayCanvas = origDC; displayCtx = origDCtx;

      const a = document.createElement('a');
      a.download = 'dither-frame.png';
      a.href = expCanvas.toDataURL('image/png');
      a.click();
      return;
    }

    const out = document.createElement('canvas');
    out.width  = displayCanvas.width;
    out.height = displayCanvas.height;
    out.getContext('2d').drawImage(displayCanvas, 0, 0);
    const a = document.createElement('a');
    a.download = 'dither-frame.png';
    a.href = out.toDataURL('image/png');
    a.click();
  }

  async function exportFullRes() {
    if (!eng.hasVideo || eng.exporting) return;
    const mime = [
      'video/mp4;codecs=avc1.640028','video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1','video/mp4',
      'video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm',
    ].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { alert('MediaRecorder not supported in this browser.'); return; }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    eng.exporting    = true;
    eng.cancelExport = false;

    const vw = _video.videoWidth, vh = _video.videoHeight;
    // Cap at preview resolution — dither algorithm is too slow for real-time at full res
    const [ew, eh] = previewSize(vw, vh);
    const expCanvas = document.createElement('canvas');
    expCanvas.width = ew; expCanvas.height = eh;
    const expCtx = expCanvas.getContext('2d', { willReadFrequently: true });

    const expEng  = { noiseSeed: eng.noiseSeed, frameCount: 0 };
    const expPool = DitherApp.makePool();

    await new Promise(resolve => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 800);
      _video.addEventListener('seeked', done, { once: true });
      _video.currentTime = 0;
    });

    const stream   = expCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    VideoEffects.setExportUI(true, 0);
    recorder.start();
    _video.play();

    await new Promise(resolve => {
      let prevTime = -1;
      function frame() {
        if (eng.cancelExport) { resolve(); return; }
        const ct = _video.currentTime;
        if (prevTime > 0.5 && ct < prevTime - 0.5) { resolve(); return; } // video looped
        if (ct >= _video.duration - 0.08)           { resolve(); return; } // near end
        prevTime = ct;

        expCtx.drawImage(_video, 0, 0, ew, eh);
        const imgData = expCtx.getImageData(0, 0, ew, eh);
        expEng.noiseSeed  += state.noiseSeedSpeed * (1 - state.temporalStability) / 60;
        expEng.frameCount += 1;
        const result = DitherApp.processFrame(imgData, state, expEng, expPool);
        expCtx.putImageData(result, 0, 0);

        VideoEffects.setExportUI(true, ct / _video.duration);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await sleep(200);
    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    if (!eng.cancelExport) {
      const blob = new Blob(chunks, { type: mime });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `dither-fullres.${ext}`;
      a.click();
    }

    eng.exporting = false;
    VideoEffects.setExportUI(false, 0);
    _video.pause();
    eng.dirty = true;
    document.getElementById('btn-play').textContent = 'Play';
  }

  function waitSeeked(v) {
    return new Promise(resolve => {
      v.addEventListener('seeked', () => setTimeout(resolve, 16), { once: true });
    });
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Registration ───────────────────────────────────────────────────────────

  VideoEffects.register('dither', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d');
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      previewCanvas = document.createElement('canvas');
      previewCanvas.width  = 854;
      previewCanvas.height = 480;
      previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });

      testImageData = buildTestPattern(854, 480);

      _controlsEl = controlsEl;
      buildDitherUI(controlsEl);
    },

    onVideoLoad: function (v, vw, vh) {
      _video       = v;
      eng.hasVideo = true;
      eng.dirty    = true;
      eng.lastRefresh = -Infinity;
      setupCanvases(vw, vh);
    },

    activate: function () { eng.dirty = true; },
    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (eng.exporting) return;

      eng.frameCount++;
      const isPlaying = hasVideo && v && !v.paused && v.readyState >= 2;
      const rate = state.refreshRate;
      const due  = rate === 0
        ? false
        : (eng.frameCount - eng.lastRefresh) >= rate;

      if (!eng.dirty && !(isPlaying && due)) return;

      eng.noiseSeed += state.noiseSeedSpeed * (1 - state.temporalStability) / 60;

      const frame  = currentPreviewFrame();
      const result = DitherApp.processFrame(frame, state, eng, previewPool);
      displayCtx.putImageData(result, 0, 0);

      eng.lastRefresh = eng.frameCount;
      eng.dirty       = false;
    },

    exportFrame:   exportFrame,
    exportFullRes: exportFullRes,
    cancelExport:  function () { eng.cancelExport = true; },

    onSeek: function () {
      eng.dirty       = true;
      eng.lastRefresh = -Infinity;
      previewPool.hasPrev = false;
    },

  });
})();
