(function () {
  'use strict';

  const DEFAULT_STATE = {
    density:     0.55,   // 0.1–1: stroke count / bristle count
    contrast:    0.60,   // 0–1:   saturation + contrast boost
    edgeSpread:  0.30,   // 0–1:   how far bristles extend beyond the stroke body
  };

  let _state = { ...DEFAULT_STATE };

  let displayCanvas, displayCtx;
  let workCanvas, workCtx;
  let _video    = null;
  let _hasVideo = false;
  let _isImage  = false;
  let dirty     = true;
  let _exporting = false, _cancelExport = false;

  const PREVIEW_MAX_H = 480;

  // ── Sizing ─────────────────────────────────────────────────────────────────

  function previewSize(vw, vh) {
    if (vh <= PREVIEW_MAX_H) return [vw, vh];
    const s = PREVIEW_MAX_H / vh;
    return [Math.round(vw * s), PREVIEW_MAX_H];
  }

  function setupCanvases(vw, vh) {
    const [pw, ph] = previewSize(vw, vh);
    displayCanvas.width  = pw; displayCanvas.height = ph;
    workCanvas.width     = pw; workCanvas.height    = ph;
    VideoEffects.setVideoInfo(`${vw}×${vh}` + (pw < vw ? `  ·  preview ${pw}×${ph}` : ''));
  }

  // ── Color contrast / saturation boost ─────────────────────────────────────

  function applyContrast(data, contrast) {
    const satMul = 1 + contrast * 1.7;
    const cFac   = 1 + contrast * 1.4;
    const mid    = 128;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * satMul;
      g = lum + (g - lum) * satMul;
      b = lum + (b - lum) * satMul;
      r = (r - mid) * cFac + mid;
      g = (g - mid) * cFac + mid;
      b = (b - mid) * cFac + mid;
      data[i]   = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i+1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i+2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  // ── Edge-following angle at a pixel (Sobel, perpendicular to gradient) ────

  function flowAngleAt(data, w, h, x, y) {
    const xi = Math.max(1, Math.min(w - 2, x | 0));
    const yi = Math.max(1, Math.min(h - 2, y | 0));
    const L  = (px, py) => {
      const i = (py * w + px) * 4;
      return 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    };
    const gx = -L(xi-1,yi-1) + L(xi+1,yi-1)
              - 2*L(xi-1,yi) + 2*L(xi+1,yi)
              - L(xi-1,yi+1) + L(xi+1,yi+1);
    const gy = -L(xi-1,yi-1) - 2*L(xi,yi-1) - L(xi+1,yi-1)
              +  L(xi-1,yi+1) + 2*L(xi,yi+1) + L(xi+1,yi+1);
    return Math.atan2(gx, -gy);
  }

  // ── Draw one brush stroke: filled body + ragged edge/end bristles ─────────
  //
  // Matches the reference: solid painted center, jagged top/bottom edges,
  // bristle fibers fanning out from sides and ends.

  function drawStroke(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    const cos  = Math.cos(angle);
    const sin  = Math.sin(angle);
    const px   = -sin;        // perpendicular
    const py   =  cos;
    const halfLen = length / 2;
    const halfW   = width  / 2;
    const N = 28;             // edge resolution

    // ── 1. Build ragged outline ────────────────────────────────────────────
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t     = i / N;
      const along = (t - 0.5) * length;
      // Slightly squarish taper so the body looks painted on
      const taper = Math.pow(Math.sin(t * Math.PI), 0.55);
      const noise = (Math.random() - 0.5) * halfW * 0.38;
      const hw    = halfW * taper + noise;
      const bx    = cx + cos * along;
      const by    = cy + sin * along;
      top.push({ x: bx + px * hw,  y: by + py * hw });
      bot.push({ x: bx - px * hw,  y: by - py * hw });
    }

    // ── 2. Fill solid body ─────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (const p of top) ctx.lineTo(p.x, p.y);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},0.84)`;
    ctx.fill();

    // ── 3. Side bristles (top & bottom edges) ─────────────────────────────
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    const numSide = 16 + Math.round(length / 5);
    for (let i = 0; i < numSide; i++) {
      const t     = Math.random();
      const along = (t - 0.5) * length;
      const taper = Math.pow(Math.sin(t * Math.PI), 0.55);
      const hw    = halfW * taper;
      const bx    = cx + cos * along;
      const by    = cy + sin * along;
      const side  = Math.random() > 0.5 ? 1 : -1;
      const bLen  = edgeSpread * (3 + Math.random() * halfW * 0.6);
      const skew  = (Math.random() - 0.5) * 7;
      const alpha = (0.2 + Math.random() * 0.55).toFixed(2);
      ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${alpha})`;
      ctx.lineWidth   = 0.6 + Math.random() * 2.0;
      ctx.beginPath();
      ctx.moveTo(bx + px * side * hw,            by + py * side * hw);
      ctx.lineTo(bx + px * side * (hw + bLen) + cos * skew,
                 by + py * side * (hw + bLen) + sin * skew);
      ctx.stroke();
    }

    // ── 4. End bristles (fan out from both tapered ends) ──────────────────
    for (let ei = 0; ei < 2; ei++) {
      const dir = ei === 0 ? -1 : 1;
      const ex  = cx + cos * halfLen * dir;
      const ey  = cy + sin * halfLen * dir;
      const numEnd = 12 + Math.round(halfW / 2.5);
      for (let i = 0; i < numEnd; i++) {
        const fan   = (Math.random() - 0.5) * width * 1.15;
        const bLen  = edgeSpread * (5 + Math.random() * halfW * 1.1);
        const skew  = (Math.random() - 0.5) * halfW * 0.28;
        const alpha = (0.18 + Math.random() * 0.62).toFixed(2);
        ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${alpha})`;
        ctx.lineWidth   = 0.5 + Math.random() * 1.8;
        ctx.beginPath();
        ctx.moveTo(ex + px * fan,                       ey + py * fan);
        ctx.lineTo(ex + px * (fan + skew) + cos * dir * bLen,
                   ey + py * (fan + skew) + sin * dir * bLen);
        ctx.stroke();
      }
    }
  }

  // ── Core renderer ──────────────────────────────────────────────────────────

  function renderCanvasStrokes(v, dCtx, dCanvas, wCanvas, wCtx) {
    const w = dCanvas.width, h = dCanvas.height;

    // 1. Draw source into work canvas
    wCtx.clearRect(0, 0, w, h);
    wCtx.drawImage(v, 0, 0, w, h);

    // 2. Contrast-boost the work canvas pixels for both sampling and base
    const imgData = wCtx.getImageData(0, 0, w, h);
    if (_state.contrast > 0.02) {
      applyContrast(imgData.data, _state.contrast);
      wCtx.putImageData(imgData, 0, 0);
    }
    const px = imgData.data;  // sample buffer (contrast-boosted)

    // 3. Full original image as base — strokes are drawn on top as overlay
    dCtx.clearRect(0, 0, w, h);
    dCtx.drawImage(v, 0, 0, w, h);

    // 4. Place brush strokes on a jittered grid
    dCtx.lineCap = 'round';

    const density   = _state.density;
    const gridStep  = Math.max(10, Math.round(32 - density * 18));  // 14–32 px
    const baseLen   = gridStep * 4.5;
    const baseWidth = gridStep * 1.9;

    for (let y = 0; y < h + gridStep; y += gridStep) {
      for (let x = 0; x < w + gridStep; x += gridStep) {
        // Jitter position within the grid cell
        const jx = Math.max(0, Math.min(w - 1, x + (Math.random() - 0.5) * gridStep * 0.75));
        const jy = Math.max(0, Math.min(h - 1, y + (Math.random() - 0.5) * gridStep * 0.75));

        // Sample color from the contrast-boosted frame
        const si = ((jy | 0) * w + (jx | 0)) * 4;
        const sr = px[si], sg = px[si+1], sb = px[si+2];

        // Slight per-stroke size variation
        const sLen = baseLen   * (0.72 + Math.random() * 0.56);
        const sWid = baseWidth * (0.68 + Math.random() * 0.64);

        // Stroke angle follows local edge direction + small random nudge
        const angle = flowAngleAt(px, w, h, jx | 0, jy | 0) + (Math.random() - 0.5) * 0.4;

        drawStroke(dCtx, jx, jy, angle, sLen, sWid, sr, sg, sb, _state.edgeSpread);
      }
    }
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  function drawEmptyState() {
    const w = displayCanvas.width, h = displayCanvas.height;
    displayCtx.fillStyle = '#0e0e0e';
    displayCtx.fillRect(0, 0, w, h);
    displayCtx.fillStyle    = 'rgba(190,165,120,0.4)';
    displayCtx.font         = '13px "JetBrains Mono", monospace';
    displayCtx.textBaseline = 'middle';
    displayCtx.textAlign    = 'center';
    displayCtx.fillText('Load a file to start', w / 2, h / 2);
    displayCtx.textAlign    = 'left';
    displayCtx.textBaseline = 'top';
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  const SECTIONS = [
    {
      title: 'BRUSH',
      specs: [
        {
          key: 'density', label: 'Brush Density', type: 'slider',
          min: 0.1, max: 1, step: 0.01,
          fmt: v => v < 0.3 ? 'Sparse' : v < 0.55 ? 'Medium' : v < 0.8 ? 'Dense' : 'Heavy',
        },
      ],
    },
    {
      title: 'EDGES',
      specs: [
        {
          key: 'edgeSpread', label: 'Edge Spread', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => v < 0.15 ? 'Tight' : v < 0.4 ? 'Subtle' : v < 0.7 ? 'Loose' : 'Wild',
        },
      ],
    },
    {
      title: 'COLOR',
      specs: [
        {
          key: 'contrast', label: 'Color Contrast', type: 'slider',
          min: 0, max: 1, step: 0.01,
          fmt: v => Math.round(v * 100) + '%',
        },
      ],
    },
  ];

  function buildControl(spec) {
    const wrap  = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;
    wrap.appendChild(label);

    const row   = document.createElement('div');
    row.className = 'control__row';

    const input = document.createElement('input');
    input.type      = 'range';
    input.min       = spec.min;
    input.max       = spec.max;
    input.step      = spec.step;
    input.value     = _state[spec.key];
    input.className = 'control__slider';

    const disp  = document.createElement('span');
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

  // ── Export ─────────────────────────────────────────────────────────────────

  function exportFrame() {
    const isImg = _video && _video.nodeName === 'CANVAS';
    if (isImg) {
      const fw = _video.videoWidth, fh = _video.videoHeight;
      const expC    = document.createElement('canvas');
      expC.width = fw; expC.height = fh;
      const expCtx  = expC.getContext('2d');
      const expW    = document.createElement('canvas');
      expW.width = fw; expW.height = fh;
      const expWCtx = expW.getContext('2d', { willReadFrequently: true });
      renderCanvasStrokes(_video, expCtx, expC, expW, expWCtx);
      const a = document.createElement('a');
      a.download = 'canvas-strokes.png';
      a.href = expC.toDataURL('image/png');
      a.click();
      return;
    }
    const a = document.createElement('a');
    a.download = 'canvas-strokes.png';
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
    const expC    = document.createElement('canvas');
    expC.width = ew; expC.height = eh;
    const expCtx  = expC.getContext('2d');
    const expW    = document.createElement('canvas');
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
        renderCanvasStrokes(_video, expCtx, expC, expW, expWCtx);
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
      a.download = `canvas-strokes.${ext}`;
      a.click();
    }

    _exporting = false;
    VideoEffects.setExportUI(false, 0);
    _video.pause();
    dirty = true;
    document.getElementById('btn-play').textContent = 'Play';
  }

  // ── Registration ───────────────────────────────────────────────────────────

  VideoEffects.register('canvas-strokes', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d', { willReadFrequently: true });
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      workCanvas = document.createElement('canvas');
      workCanvas.width  = 854;
      workCanvas.height = 480;
      workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

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

    activate:   function () { dirty = true; },
    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (_exporting) return;

      const isPlaying = hasVideo && v && !v.paused && v.readyState >= 2;
      if (!dirty && (!isPlaying || _isImage)) return;

      if (!hasVideo || !v || v.readyState < 2) {
        if (dirty) { drawEmptyState(); dirty = false; }
        return;
      }

      renderCanvasStrokes(v, displayCtx, displayCanvas, workCanvas, workCtx);
      dirty = false;
    },

    exportFrame:   exportFrame,
    exportFullRes: exportFullRes,
    cancelExport:  function () { _cancelExport = true; },

    onSeek: function () { dirty = true; },
  });
})();
