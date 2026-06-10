(function () {
  'use strict';

  const DEFAULT_STATE = {
    strokeType:  'block',  // 'block' | 'flat' | 'rough' | 'liner'
    randomDir:   true,    // true = follow image edges, false = use fixed angle
    strokeAngle: 0,       // degrees 0–180 (used when randomDir is false)
    density:     0.55,
    contrast:    0.60,
    edgeSpread:  0.30,
    seed:        12345,
  };

  let _state = { ...DEFAULT_STATE };

  // Seeded PRNG (deterministic per render so the pattern is reproducible)
  function _makePrng(seed) {
    let s = (seed | 0) || 1;
    return function () {
      s = Math.imul(s ^ s >>> 15, s | 1) ^ Math.imul(s ^ s >>> 7, s | 61);
      return ((s ^ s >>> 14) >>> 0) / 4294967296;
    };
  }
  let _rng = Math.random;
  let _scale = 1;  // set per render: canvasHeight / 480

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

  // ── Shared: build outline edge arrays ─────────────────────────────────────

  function buildOutline(cx, cy, cos, sin, px, py, length, halfW, taperExp, noiseScale, N) {
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t     = i / N;
      const along = (t - 0.5) * length;
      const taper = Math.pow(Math.sin(t * Math.PI), taperExp);
      const noise = (_rng() - 0.5) * halfW * noiseScale;
      const hw    = halfW * taper + noise;
      const bx    = cx + cos * along;
      const by    = cy + sin * along;
      top.push({ x: bx + px * hw, y: by + py * hw });
      bot.push({ x: bx - px * hw, y: by - py * hw });
    }
    return { top, bot };
  }

  function fillOutline(ctx, top, bot, r, g, b, alpha) {
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (const p of top) ctx.lineTo(p.x, p.y);
    for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},${alpha})`;
    ctx.fill();
  }

  function drawSideBristles(ctx, cx, cy, cos, sin, px, py, length, halfW, taperExp, edgeSpread, maxLen, count, r, g, b) {
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const t    = _rng();
      const hw   = halfW * Math.pow(Math.sin(t * Math.PI), taperExp);
      const bx   = cx + cos * ((t - 0.5) * length);
      const by   = cy + sin * ((t - 0.5) * length);
      const side = _rng() > 0.5 ? 1 : -1;
      const bLen = edgeSpread * (2 + _rng() * maxLen);
      const skew = (_rng() - 0.5) * 8 * _scale;
      const a    = (0.18 + _rng() * 0.52).toFixed(2);
      ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${a})`;
      ctx.lineWidth   = (0.5 + _rng() * 2.0) * _scale;
      ctx.beginPath();
      ctx.moveTo(bx + px * side * hw,                  by + py * side * hw);
      ctx.lineTo(bx + px * side * (hw + bLen) + cos * skew,
                 by + py * side * (hw + bLen) + sin * skew);
      ctx.stroke();
    }
  }

  function drawEndBristles(ctx, cx, cy, cos, sin, px, py, halfLen, width, edgeSpread, maxLen, count, r, g, b) {
    ctx.lineCap = 'round';
    for (let ei = 0; ei < 2; ei++) {
      const dir = ei === 0 ? -1 : 1;
      const ex  = cx + cos * halfLen * dir;
      const ey  = cy + sin * halfLen * dir;
      for (let i = 0; i < count; i++) {
        const fan  = (_rng() - 0.5) * width * 1.1;
        const bLen = edgeSpread * (4 + _rng() * maxLen);
        const skew = (_rng() - 0.5) * width * 0.25;
        const a    = (0.18 + _rng() * 0.58).toFixed(2);
        ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${a})`;
        ctx.lineWidth   = 0.5 + _rng() * 1.8;
        ctx.beginPath();
        ctx.moveTo(ex + px * fan,                       ey + py * fan);
        ctx.lineTo(ex + px * (fan + skew) + cos * dir * bLen,
                   ey + py * (fan + skew) + sin * dir * bLen);
        ctx.stroke();
      }
    }
  }

  // ── Stroke type: Block ─────────────────────────────────────────────────────
  // Original style — jagged filled body, ragged side + end bristles.

  function drawStrokeBlock(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const px = -sin, py = cos;
    const halfLen = length / 2, halfW = width / 2;
    const { top, bot } = buildOutline(cx, cy, cos, sin, px, py, length, halfW, 0.55, 0.38, 28);
    fillOutline(ctx, top, bot, r, g, b, 0.84);
    drawSideBristles(ctx, cx, cy, cos, sin, px, py, length, halfW, 0.55, edgeSpread, halfW * 0.6,  16 + Math.round(length / 5), r, g, b);
    drawEndBristles (ctx, cx, cy, cos, sin, px, py, halfLen, width, edgeSpread, halfW * 1.1, 12 + Math.round(halfW / 2.5), r, g, b);
  }

  // ── Stroke type: Flat ──────────────────────────────────────────────────────
  // Smooth flat-brush feel — lighter parallel streaks inside body, soft edges.

  function drawStrokeFlat(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const px = -sin, py = cos;
    const halfLen = length / 2, halfW = width / 2;
    const { top, bot } = buildOutline(cx, cy, cos, sin, px, py, length, halfW, 0.65, 0.20, 24);
    fillOutline(ctx, top, bot, r, g, b, 0.78);

    // Internal parallel bristle streaks (lighter, low alpha)
    const lr = Math.min(255, r + 50) | 0;
    const lg = Math.min(255, g + 50) | 0;
    const lb = Math.min(255, b + 50) | 0;
    const numLines = 6 + Math.round(width / 3.5);
    ctx.setLineDash([]); ctx.lineCap = 'round';
    for (let i = 0; i < numLines; i++) {
      const tOff   = (i / (numLines - 1) - 0.5);
      const offset = tOff * width * 0.80;
      const a      = (0.07 + _rng() * 0.18).toFixed(2);
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${a})`;
      ctx.lineWidth   = 0.8 + _rng() * 2.8;
      const jitter = (_rng() - 0.5) * 3 * _scale;
      ctx.beginPath();
      ctx.moveTo(cx + px * (offset + jitter) + cos * (-halfLen + _rng() * length * 0.05),
                 cy + py * (offset + jitter) + sin * (-halfLen + _rng() * length * 0.05));
      ctx.lineTo(cx + px * (offset + jitter) + cos * ( halfLen - _rng() * length * 0.05),
                 cy + py * (offset + jitter) + sin * ( halfLen - _rng() * length * 0.05));
      ctx.stroke();
    }
    drawSideBristles(ctx, cx, cy, cos, sin, px, py, length, halfW, 0.65, edgeSpread, halfW * 0.45, 10 + Math.round(length / 7), r, g, b);
    drawEndBristles (ctx, cx, cy, cos, sin, px, py, halfLen, width, edgeSpread, halfW * 0.9,  8  + Math.round(halfW / 3),   r, g, b);
  }

  // ── Stroke type: Rough ─────────────────────────────────────────────────────
  // Wide, heavily textured dry brush — grain inside, very ragged edges.

  function drawStrokeRough(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const px = -sin, py = cos;
    const halfLen = length / 2;
    const halfW   = width / 2 * 1.40;   // wider body
    const { top, bot } = buildOutline(cx, cy, cos, sin, px, py, length, halfW, 0.38, 0.46, 32);
    fillOutline(ctx, top, bot, r, g, b, 0.80);

    // Internal grain — many short horizontal marks
    const grainCount = 50 + Math.round((length * halfW * 2) / 35);
    const lightness  = Math.min(255, (r + g + b) / 3 + 60) | 0;
    ctx.lineCap = 'butt';
    for (let i = 0; i < grainCount; i++) {
      const t      = _rng();
      const along  = (t - 0.5) * length * 0.92;
      const taper  = Math.pow(Math.sin(t * Math.PI), 0.38);
      const perpOff = (_rng() - 0.5) * halfW * taper * 1.85;
      const gx     = cx + cos * along + px * perpOff;
      const gy     = cy + sin * along + py * perpOff;
      const gLen   = (4 + _rng() * 28) * _scale;
      const a      = (0.04 + _rng() * 0.13).toFixed(2);
      ctx.strokeStyle = `rgba(${lightness},${lightness},${lightness},${a})`;
      ctx.lineWidth   = 0.4 + _rng() * 2.4;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + cos * gLen, gy + sin * gLen);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    drawSideBristles(ctx, cx, cy, cos, sin, px, py, length, halfW, 0.38, edgeSpread, halfW * 0.85, 22 + Math.round(length / 4), r, g, b);
    drawEndBristles (ctx, cx, cy, cos, sin, px, py, halfLen, halfW * 2, edgeSpread, halfW * 1.3, 20 + Math.round(halfW / 2), r, g, b);
  }

  // ── Stroke type: Liner ─────────────────────────────────────────────────────
  // Thin, sharply tapered calligraphy-like stroke, minimal edge spread.

  function drawStrokeLiner(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const px = -sin, py = cos;
    const halfLen = length / 2;
    const halfW   = width / 2 * 0.30;   // much narrower
    const { top, bot } = buildOutline(cx, cy, cos, sin, px, py, length, halfW, 2.0, 0.16, 20);
    fillOutline(ctx, top, bot, r, g, b, 0.92);
    drawSideBristles(ctx, cx, cy, cos, sin, px, py, length, halfW, 2.0, edgeSpread, halfW * 0.55, 4 + Math.round(length / 12), r, g, b);
    // No end fan — liner tapers to a clean point
  }

  // ── Dispatcher ─────────────────────────────────────────────────────────────

  function drawStroke(ctx, cx, cy, angle, length, width, r, g, b, edgeSpread) {
    switch (_state.strokeType) {
      case 'flat':  return drawStrokeFlat  (ctx, cx, cy, angle, length, width, r, g, b, edgeSpread);
      case 'rough': return drawStrokeRough (ctx, cx, cy, angle, length, width, r, g, b, edgeSpread);
      case 'liner': return drawStrokeLiner (ctx, cx, cy, angle, length, width, r, g, b, edgeSpread);
      default:      return drawStrokeBlock (ctx, cx, cy, angle, length, width, r, g, b, edgeSpread);
    }
  }

  // ── Core renderer ──────────────────────────────────────────────────────────

  function renderCanvasStrokes(v, dCtx, dCanvas, wCanvas, wCtx) {
    const w = dCanvas.width, h = dCanvas.height;
    _rng = _makePrng(_state.seed);  // reset so pattern is consistent per seed

    wCtx.clearRect(0, 0, w, h);
    wCtx.drawImage(v, 0, 0, w, h);

    const imgData = wCtx.getImageData(0, 0, w, h);
    if (_state.contrast > 0.02) {
      applyContrast(imgData.data, _state.contrast);
      wCtx.putImageData(imgData, 0, 0);
    }
    const px = imgData.data;

    dCtx.clearRect(0, 0, w, h);
    dCtx.drawImage(v, 0, 0, w, h);

    dCtx.lineCap = 'round';

    const density   = _state.density;
    _scale = h / 480;  // proportional scale so preview matches export
    const gridStep  = Math.round(Math.max(5, 32 - density * 22) * _scale);
    const baseLen   = gridStep * 4.5;
    const baseWidth = gridStep * 1.9;

    for (let y = 0; y < h + gridStep; y += gridStep) {
      for (let x = 0; x < w + gridStep; x += gridStep) {
        const jx = Math.max(0, Math.min(w - 1, x + (_rng() - 0.5) * gridStep * 0.75));
        const jy = Math.max(0, Math.min(h - 1, y + (_rng() - 0.5) * gridStep * 0.75));

        const si  = ((jy | 0) * w + (jx | 0)) * 4;
        const sr  = px[si], sg = px[si+1], sb = px[si+2];

        const sLen = baseLen   * (0.72 + _rng() * 0.56);
        const sWid = baseWidth * (0.68 + _rng() * 0.64);

        const baseAngle = _state.randomDir
          ? flowAngleAt(px, w, h, jx | 0, jy | 0)
          : (_state.strokeAngle * Math.PI / 180);
        const angle = baseAngle + (_rng() - 0.5) * 0.4;

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
      title: 'STYLE',
      specs: [
        {
          key: 'strokeType', label: 'Brush Type', type: 'toggle',
          options: [
            { value: 'block', label: 'Block' },
            { value: 'flat',  label: 'Flat'  },
            { value: 'rough', label: 'Rough' },
            { value: 'liner', label: 'Liner' },
          ],
        },
      ],
    },
    {
      title: 'DIRECTION',
      specs: [
        {
          key: 'randomDir', label: 'Follow Image Edges', type: 'toggle',
          options: [
            { value: true,  label: 'On'  },
            { value: false, label: 'Off' },
          ],
        },
        {
          key: 'strokeAngle', label: 'Stroke Angle', type: 'slider',
          min: 0, max: 180, step: 1,
          fmt: v => v + '°',
        },
      ],
    },
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
      title: 'SEED',
      specs: [
        { key: 'seed', label: 'Pattern Seed', type: 'seed' },
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
    const wrap = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;
    wrap.appendChild(label);

    if (spec.type === 'seed') {
      const row = document.createElement('div');
      row.className = 'control__row';
      const input = document.createElement('input');
      input.type      = 'number';
      input.min       = 1;
      input.max       = 9999999;
      input.value     = _state.seed;
      input.className = 'control__text';
      input.style.cssText = 'width:72px;flex:none;';
      input.addEventListener('change', function () {
        const v = Math.max(1, parseInt(input.value) || 1);
        input.value = v;
        _state = { ..._state, seed: v };
        dirty = true;
      });
      const btn = document.createElement('button');
      btn.className   = 'btn';
      btn.textContent = 'New';
      btn.addEventListener('click', function () {
        const v = Math.floor(Math.random() * 999998) + 1;
        _state = { ..._state, seed: v };
        input.value = v;
        dirty = true;
      });
      row.appendChild(input);
      row.appendChild(btn);
      wrap.appendChild(row);
      return wrap;
    }

    if (spec.type === 'toggle') {
      const row = document.createElement('div');
      row.className = 'control__toggle';
      for (const opt of spec.options) {
        const btn = document.createElement('button');
        btn.className = 'toggle-btn' + (_state[spec.key] === opt.value ? ' active' : '');
        btn.textContent = opt.label;
        btn.addEventListener('click', function () {
          _state = { ..._state, [spec.key]: opt.value };
          row.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          dirty = true;
        });
        row.appendChild(btn);
      }
      wrap.appendChild(row);
      return wrap;
    }

    const row  = document.createElement('div');
    row.className = 'control__row';

    const input = document.createElement('input');
    input.type      = 'range';
    input.min       = spec.min;
    input.max       = spec.max;
    input.step      = spec.step;
    input.value     = _state[spec.key];
    input.className = 'control__slider';

    const disp = document.createElement('span');
    disp.className   = 'control__value';
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
    resetBtn.className   = 'btn';
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
    // Video case — re-render at native resolution for full-quality frame
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
    const ew = vw, eh = vh;  // export at native resolution
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
