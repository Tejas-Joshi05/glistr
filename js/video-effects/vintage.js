(function () {
  'use strict';

  const DEFAULT_STATE = {
    saturation: 0.65,
    warmth:     0.30,
    softness:   1.8,
    glow:       0.38,
    grain:      0.32,
    vignette:   0.55,
  };

  let _state = { ...DEFAULT_STATE };
  let _controlsContainer = null;

  let displayCanvas, displayCtx;
  let workCanvas, workCtx;
  let _video    = null;
  let _hasVideo = false;
  let _isImage  = false;
  let dirty      = true;
  let frameCount = 0;
  let _exporting = false, _cancelExport = false;

  const PREVIEW_MAX_H = 480;

  // ── Sizing ──────────────────────────────────────────────────────────────────

  function previewSize(vw, vh) {
    if (vh <= PREVIEW_MAX_H) return [vw, vh];
    const s = PREVIEW_MAX_H / vh;
    return [Math.round(vw * s), PREVIEW_MAX_H];
  }

  function setupCanvases(vw, vh) {
    const [pw, ph] = previewSize(vw, vh);
    displayCanvas.width  = pw; displayCanvas.height = ph;
    workCanvas.width     = pw; workCanvas.height    = ph;
    const down = pw < vw;
    VideoEffects.setVideoInfo(`${vw}×${vh}` + (down ? `  ·  preview ${pw}×${ph}` : ''));
  }

  // ── Pixel processing ────────────────────────────────────────────────────────

  function processPixels(data, saturation, warmth) {
    const warmR = warmth * 28;
    const warmG = warmth * 12;
    const warmB = warmth * 22;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      // Desaturate/saturate around luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * saturation;
      g = lum + (g - lum) * saturation;
      b = lum + (b - lum) * saturation;
      // Warm orange-yellow shift
      r += warmR;
      g += warmG;
      b -= warmB;
      // Vintage fade — lift shadows, compress highlights (analog stock look)
      r = 12 + r * 0.915;
      g =  8 + g * 0.900;
      b =  6 + b * 0.890;
      data[i]   = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i+1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i+2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  // ── Core renderer ───────────────────────────────────────────────────────────
  //
  // Accepts explicit canvas/ctx arguments so the same pipeline handles both
  // preview (displayCanvas) and full-res photo export.

  function renderVintage(v, dCtx, dCanvas, wCanvas, wCtx) {
    const w = dCanvas.width, h = dCanvas.height;

    // 1. Draw source frame into work canvas
    wCtx.clearRect(0, 0, w, h);
    wCtx.drawImage(v, 0, 0, w, h);

    // 2. Colour-process pixels (saturation + warmth + vintage fade)
    const imgData = wCtx.getImageData(0, 0, w, h);
    processPixels(imgData.data, _state.saturation, _state.warmth);
    wCtx.putImageData(imgData, 0, 0);

    // 3. Softness — draw blurred colour-processed image as the main layer
    dCtx.clearRect(0, 0, w, h);
    const soft = _state.softness;
    if (soft > 0.05) dCtx.filter = `blur(${soft.toFixed(2)}px)`;
    dCtx.drawImage(wCanvas, 0, 0);
    dCtx.filter = 'none';

    // 4. Glow / halation — heavier blur in screen blend (bright areas bleed outward)
    if (_state.glow > 0.01) {
      const glowBlur = soft * 2.5 + 4;
      dCtx.globalCompositeOperation = 'screen';
      dCtx.globalAlpha = _state.glow * 0.45;
      dCtx.filter = `blur(${glowBlur.toFixed(2)}px)`;
      dCtx.drawImage(wCanvas, 0, 0);
      dCtx.filter = 'none';
      dCtx.globalAlpha = 1;
      dCtx.globalCompositeOperation = 'source-over';
    }

    // 5. Vignette — radial dark gradient over edges
    if (_state.vignette > 0.01) {
      const cx = w / 2, cy = h / 2;
      const r  = Math.sqrt(cx * cx + cy * cy);
      const vg = dCtx.createRadialGradient(cx, cy, r * 0.20, cx, cy, r * 1.10);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${(_state.vignette * 0.88).toFixed(3)})`);
      dCtx.fillStyle = vg;
      dCtx.fillRect(0, 0, w, h);
    }

    // 6. Film grain — per-pixel luminance noise
    if (_state.grain > 0.01) {
      const gd = dCtx.getImageData(0, 0, w, h);
      const px = gd.data;
      const s  = _state.grain * 55;
      for (let i = 0; i < px.length; i += 4) {
        const n  = (Math.random() - 0.5) * s;
        const nr = px[i]   + n;
        const ng = px[i+1] + n;
        const nb = px[i+2] + n;
        px[i]   = nr < 0 ? 0 : nr > 255 ? 255 : nr;
        px[i+1] = ng < 0 ? 0 : ng > 255 ? 255 : ng;
        px[i+2] = nb < 0 ? 0 : nb > 255 ? 255 : nb;
      }
      dCtx.putImageData(gd, 0, 0);
    }
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  function drawEmptyState() {
    const w = displayCanvas.width, h = displayCanvas.height;
    displayCtx.fillStyle = '#1a1410';
    displayCtx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r  = Math.sqrt(cx * cx + cy * cy);
    const vg = displayCtx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    displayCtx.fillStyle    = vg;
    displayCtx.fillRect(0, 0, w, h);
    displayCtx.fillStyle    = 'rgba(210,185,140,0.45)';
    displayCtx.font         = '13px "JetBrains Mono", monospace';
    displayCtx.textBaseline = 'middle';
    displayCtx.textAlign    = 'center';
    displayCtx.fillText('Load a file to start', cx, cy);
    displayCtx.textAlign    = 'left';
    displayCtx.textBaseline = 'top';
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  const SECTIONS = [
    {
      title: 'COLOR',
      specs: [
        {
          key: 'saturation', label: 'Saturation', type: 'slider',
          min: 0, max: 2, step: 0.05,
          fmt: v => v < 0.25 ? 'Monochrome' : v < 0.75 ? 'Muted' : v < 1.15 ? 'Natural' : v < 1.6 ? 'Rich' : 'Vivid',
        },
        {
          key: 'warmth', label: 'Warmth', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => Math.round(v * 100) + '%',
        },
      ],
    },
    {
      title: 'OPTICS',
      specs: [
        {
          key: 'softness', label: 'Softness / Fog', type: 'slider',
          min: 0, max: 6, step: 0.1,
          fmt: v => v.toFixed(1) + 'px',
        },
        {
          key: 'glow', label: 'Glow / Halation', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => Math.round(v * 100) + '%',
        },
      ],
    },
    {
      title: 'ATMOSPHERE',
      specs: [
        {
          key: 'grain', label: 'Film Grain', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => Math.round(v * 100) + '%',
        },
        {
          key: 'vignette', label: 'Vignette', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => Math.round(v * 100) + '%',
        },
      ],
    },
  ];

  function buildControl(spec) {
    const wrap = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'control__row';

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = spec.min;
    input.max   = spec.max;
    input.step  = spec.step;
    input.value = _state[spec.key];
    input.className = 'control__slider';

    const disp = document.createElement('span');
    disp.className = 'control__value';
    disp.textContent = spec.fmt(_state[spec.key]);

    input.addEventListener('input', function () {
      const v = parseFloat(input.value);
      _state = { ..._state, [spec.key]: v };
      disp.textContent = spec.fmt(v);
      dirty = true;
    });

    row.appendChild(input);
    row.appendChild(disp);
    wrap.appendChild(row);
    return wrap;
  }

  function buildControls(container) {
    container.innerHTML = '';

    const resetBar = document.createElement('div');
    resetBar.className = 'controls-reset-bar';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', function () {
      _state = { ...DEFAULT_STATE };
      buildControls(container);
      dirty = true;
    });
    resetBar.appendChild(resetBtn);
    container.appendChild(resetBar);

    for (const section of SECTIONS) {
      const details = document.createElement('details');
      details.open = true;
      details.className = 'controls-section';

      const summary = document.createElement('summary');
      summary.className = 'controls-section__header';
      summary.textContent = section.title;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'controls-section__body';

      for (const spec of section.specs) body.appendChild(buildControl(spec));

      details.appendChild(body);
      container.appendChild(details);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  function exportFrame() {
    const isImg = _video && _video.nodeName === 'CANVAS';
    if (isImg) {
      // Full-res render for photos — re-run the whole pipeline at native resolution
      const fw = _video.videoWidth, fh = _video.videoHeight;
      const expC = document.createElement('canvas');
      expC.width = fw; expC.height = fh;
      const expCtx = expC.getContext('2d');
      const expW = document.createElement('canvas');
      expW.width = fw; expW.height = fh;
      const expWCtx = expW.getContext('2d', { willReadFrequently: true });
      renderVintage(_video, expCtx, expC, expW, expWCtx);
      const a = document.createElement('a');
      a.download = 'vintage-frame.png';
      a.href = expC.toDataURL('image/png');
      a.click();
      return;
    }
    const a = document.createElement('a');
    a.download = 'vintage-frame.png';
    a.href = displayCanvas.toDataURL('image/png');
    a.click();
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function exportFullRes() {
    if (!_hasVideo || _exporting || _isImage) return;
    const mime = [
      'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { alert('MediaRecorder not supported in this browser.'); return; }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    _exporting = true; _cancelExport = false;

    const vw = _video.videoWidth, vh = _video.videoHeight;
    const [ew, eh] = previewSize(vw, vh);
    const expC = document.createElement('canvas');
    expC.width = ew; expC.height = eh;
    const expCtx = expC.getContext('2d');
    const expW = document.createElement('canvas');
    expW.width = ew; expW.height = eh;
    const expWCtx = expW.getContext('2d', { willReadFrequently: true });

    await new Promise(resolve => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 800);
      _video.addEventListener('seeked', done, { once: true });
      _video.currentTime = 0;
    });

    const stream   = expC.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    VideoEffects.setExportUI(true, 0);
    recorder.start();
    _video.play();

    await new Promise(resolve => {
      let prevTime = -1;
      function frame() {
        if (_cancelExport) { resolve(); return; }
        const ct = _video.currentTime;
        if (prevTime > 0.5 && ct < prevTime - 0.5) { resolve(); return; }
        if (ct >= _video.duration - 0.08)           { resolve(); return; }
        prevTime = ct;
        renderVintage(_video, expCtx, expC, expW, expWCtx);
        VideoEffects.setExportUI(true, ct / _video.duration);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await sleep(200);
    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    if (!_cancelExport) {
      const blob = new Blob(chunks, { type: mime });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `vintage-fullres.${ext}`;
      a.click();
    }

    _exporting = false;
    VideoEffects.setExportUI(false, 0);
    _video.pause();
    dirty = true;
    document.getElementById('btn-play').textContent = 'Play';
  }

  // ── Registration ────────────────────────────────────────────────────────────

  VideoEffects.register('vintage', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d', { willReadFrequently: true });
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      workCanvas = document.createElement('canvas');
      workCanvas.width  = 854;
      workCanvas.height = 480;
      workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

      _controlsContainer = controlsEl;
      buildControls(controlsEl);
      drawEmptyState();
    },

    onVideoLoad: function (v, vw, vh) {
      _video    = v;
      _hasVideo = true;
      _isImage  = v.nodeName === 'CANVAS';
      dirty     = true;
      setupCanvases(vw, vh);
    },

    activate: function () { dirty = true; },
    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (_exporting) return;

      const isPlaying = hasVideo && v && !v.paused && v.readyState >= 2;
      if (!dirty && (!isPlaying || _isImage)) return;

      if (!hasVideo || !v || v.readyState < 2) {
        if (dirty) { drawEmptyState(); dirty = false; }
        return;
      }

      frameCount++;
      renderVintage(v, displayCtx, displayCanvas, workCanvas, workCtx);
      dirty = false;
    },

    exportFrame:   exportFrame,
    exportFullRes: exportFullRes,
    cancelExport:  function () { _cancelExport = true; },

    onSeek: function () { dirty = true; },
  });
})();
