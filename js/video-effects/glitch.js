(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  let _state = {
    // Chromatic aberration
    chromaStrength: 12,
    chromaAxis:     'h',    // 'h' | 'v' | 'd' (horizontal / vertical / diagonal)
    chromaAnimate:  false,  // pulse the offset over time

    // Horizontal jitter (VHS-style row displacement)
    jitterAmount: 30,       // max px a row can shift
    jitterRate:   0.12,     // fraction of rows affected (0–0.5)

    // Block corruption (rectangular region horizontal shift)
    blockCount:  6,
    blockMaxH:   60,        // max height per block (px)
    blockShift:  50,        // max horizontal shift (px)

    // Scan lines
    scanOpacity: 0.22,      // 0–0.6
    scanGap:     4,         // px between darkened lines

    // Temporal
    echoBlend:   0.0,       // fraction of previous frame that bleeds through (0–0.7)
    stutterRate: 0.0,       // per-frame probability of a freeze (0–0.12)
  };

  // ── Canvas & frame buffers ─────────────────────────────────────────────────

  let displayCanvas, displayCtx;
  let sampleCanvas,  sampleCtx;   // off-screen capture at preview res

  let outBuf       = null;        // Uint8ClampedArray — reused each frame
  let echoBuf      = null;        // previous processed frame (for ghost blend)
  let stutterFrame = null;        // frozen frame when stutter fires
  let stutterCountdown = 0;

  let frameCount = 0;
  let dirty      = true;
  let _video = null, _hasVideo = false, _exporting = false, _cancelExport = false;

  // ── Deterministic hash (seeded by frame + position) ───────────────────────
  // Returns a value in [0, 1). Used instead of Math.random() so jitter/blocks
  // are stable within a frame but change across frames.
  function sh(x) {
    const v = Math.sin(x * 127.1 + 0.5) * 43758.5453;
    return v - Math.floor(v);
  }

  // ── Control builder ────────────────────────────────────────────────────────

  function buildControls(container) {
    container.innerHTML = '';

    const SECTIONS = [
      {
        title: 'Chromatic Aberration',
        hint:  'Splits the RGB channels apart',
        specs: [
          { key: 'chromaStrength', label: 'Strength', type: 'slider',
            min: 0, max: 60, step: 1, fmt: v => Math.round(v) + 'px' },
          { key: 'chromaAxis', label: 'Direction', type: 'toggle',
            options: [['h','Horizontal'], ['v','Vertical'], ['d','Diagonal']] },
          { key: 'chromaAnimate', label: 'Motion', type: 'toggle',
            options: [['false','Static'], ['true','Pulse']] },
        ],
      },
      {
        title: 'Glitch Bars',
        hint:  'Rows of pixels that slide sideways',
        specs: [
          { key: 'jitterAmount', label: 'Shift Amount', type: 'slider',
            min: 0, max: 120, step: 1, fmt: v => Math.round(v) + 'px' },
          { key: 'jitterRate', label: 'Coverage', type: 'slider',
            min: 0, max: 0.5, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            hint: 'How many rows are affected' },
        ],
      },
      {
        title: 'Block Corruption',
        hint:  'Rectangular chunks displaced horizontally',
        specs: [
          { key: 'blockCount',  label: 'Block Count',  type: 'slider',
            min: 0, max: 24, step: 1, fmt: v => Math.round(v) },
          { key: 'blockMaxH',   label: 'Max Height',   type: 'slider',
            min: 4, max: 140, step: 2, fmt: v => Math.round(v) + 'px' },
          { key: 'blockShift',  label: 'Shift Amount', type: 'slider',
            min: 0, max: 100, step: 1, fmt: v => Math.round(v) + 'px' },
        ],
      },
      {
        title: 'Scan Lines',
        hint:  'CRT-style horizontal darkening lines',
        specs: [
          { key: 'scanOpacity', label: 'Intensity', type: 'slider',
            min: 0, max: 0.65, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'scanGap', label: 'Spacing', type: 'slider',
            min: 2, max: 10, step: 1, fmt: v => Math.round(v) + 'px' },
        ],
      },
      {
        title: 'Temporal',
        hint:  'Time-based frame corruption',
        specs: [
          { key: 'echoBlend', label: 'Ghost Blend', type: 'slider',
            min: 0, max: 0.80, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            hint: 'How much the previous frame bleeds through' },
          { key: 'stutterRate', label: 'Stutter Rate', type: 'slider',
            min: 0, max: 0.12, step: 0.005, fmt: v => Math.round(v * 100) + '%',
            hint: 'Chance per frame of freezing the image' },
        ],
      },
    ];

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

      if (section.hint) {
        const p = document.createElement('p');
        p.className = 'controls-hint';
        p.textContent = section.hint;
        body.appendChild(p);
      }

      for (const spec of section.specs) body.appendChild(buildControl(spec));

      details.appendChild(body);
      container.appendChild(details);
    }
  }

  function buildControl(spec) {
    const wrap = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;
    wrap.appendChild(label);

    if (spec.hint) {
      const h = document.createElement('span');
      h.className = 'control__hint';
      h.textContent = spec.hint;
      wrap.appendChild(h);
    }

    if (spec.type === 'slider') {
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
      disp.className   = 'control__value';
      disp.textContent = spec.fmt(_state[spec.key]);

      input.addEventListener('input', function () {
        const v = parseFloat(input.value);
        disp.textContent = spec.fmt(v);
        _state = { ..._state, [spec.key]: v };
        if (spec.key === 'echoBlend' || spec.key === 'stutterRate') {
          echoBuf = null; stutterFrame = null; stutterCountdown = 0;
        }
        dirty = true;
      });

      row.appendChild(input);
      row.appendChild(disp);
      wrap.appendChild(row);

    } else if (spec.type === 'toggle') {
      const grp = document.createElement('div');
      grp.className = 'control__toggle';
      for (const [v, txt] of spec.options) {
        const btn = document.createElement('button');
        btn.className = 'toggle-btn' + (String(v) === String(_state[spec.key]) ? ' active' : '');
        btn.textContent = txt;
        btn.addEventListener('click', function () {
          grp.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const coerced = v === 'true' ? true : v === 'false' ? false : v;
          _state = { ..._state, [spec.key]: coerced };
          dirty  = true;
        });
        grp.appendChild(btn);
      }
      wrap.appendChild(grp);
    }

    return wrap;
  }

  // ── Rendering pipeline ─────────────────────────────────────────────────────

  function renderGlitch(v) {
    const SW = sampleCanvas.width;
    const SH = sampleCanvas.height;
    const DW = displayCanvas.width;
    const DH = displayCanvas.height;

    // Capture source frame
    sampleCtx.drawImage(v, 0, 0, SW, SH);
    const srcImgData = sampleCtx.getImageData(0, 0, SW, SH);
    const src = srcImgData.data;

    // Ensure output buffer is the right size
    const needed = SW * SH * 4;
    if (!outBuf || outBuf.length !== needed) {
      outBuf       = new Uint8ClampedArray(needed);
      echoBuf      = null;
      stutterFrame = null;
      stutterCountdown = 0;
    }

    // ── 1. Chromatic Aberration ──────────────────────────────────────────────
    // Red channel pulled one direction, blue the other, green stays.
    const str = _state.chromaStrength;
    let oxR, oyR, oxB, oyB;

    if (_state.chromaAnimate) {
      const t = frameCount * 0.04;
      oxR = Math.round(Math.sin(t * 1.7)        * str);
      oyR = Math.round(Math.sin(t * 2.3 + 1)    * str * 0.35);
      oxB = -oxR; oyB = -oyR;
    } else {
      switch (_state.chromaAxis) {
        case 'v': oxR =   0;    oyR = str;   oxB =  0;   oyB = -str;     break;
        case 'd': oxR = str;    oyR = str / 2; oxB = -str; oyB = -str / 2; break;
        default:  oxR = str;    oyR =   0;   oxB = -str; oyB =  0;       break; // 'h'
      }
    }

    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4;

        const rX = Math.max(0, Math.min(SW - 1, x + oxR));
        const rY = Math.max(0, Math.min(SH - 1, y + oyR));
        const bX = Math.max(0, Math.min(SW - 1, x + oxB));
        const bY = Math.max(0, Math.min(SH - 1, y + oyB));

        outBuf[i]     = src[(rY * SW + rX) * 4];       // R shifted
        outBuf[i + 1] = src[i + 1];                    // G unchanged
        outBuf[i + 2] = src[(bY * SW + bX) * 4 + 2];  // B shifted opposite
        outBuf[i + 3] = 255;
      }
    }

    // ── 2. Horizontal Jitter (row displacement) ──────────────────────────────
    // Rows slide left/right by a random amount. Pattern is seeded per-frame
    // (changes every 2 frames) so bars are stable within a frame.
    if (_state.jitterAmount > 0 && _state.jitterRate > 0) {
      const frameSeed = (frameCount >> 1) * 17239.1;
      const rowBuf    = new Uint8ClampedArray(SW * 4);

      for (let y = 0; y < SH; y++) {
        const h1 = sh(frameSeed + y * 0.7193);
        if (h1 > _state.jitterRate) continue;

        const h2    = sh(frameSeed + y * 0.7193 + 999.1);
        const shift = Math.round((h2 * 2 - 1) * _state.jitterAmount);
        if (shift === 0) continue;

        const rowBase = y * SW * 4;
        for (let x = 0; x < SW; x++) {
          const srcX = ((x - shift) % SW + SW) % SW;
          const si   = srcX * 4;
          const di   = x    * 4;
          rowBuf[di]     = outBuf[rowBase + si];
          rowBuf[di + 1] = outBuf[rowBase + si + 1];
          rowBuf[di + 2] = outBuf[rowBase + si + 2];
          rowBuf[di + 3] = 255;
        }
        outBuf.set(rowBuf, rowBase);
      }
    }

    // ── 3. Block Corruption (rectangular region displacement) ────────────────
    // Random-sized horizontal strips are shifted left/right like corrupted data.
    // Block parameters change every 4 frames so they persist visibly.
    if (_state.blockCount > 0 && _state.blockShift > 0) {
      const blockSeed = (frameCount >> 2) * 31337.7;

      for (let b = 0; b < _state.blockCount; b++) {
        const bs = blockSeed + b * 137.3;
        const byStart = Math.floor(sh(bs)       * SH);
        const bh      = Math.floor(sh(bs + 0.1) * _state.blockMaxH) + 4;
        const shift   = Math.round((sh(bs + 0.2) * 2 - 1) * _state.blockShift);
        if (Math.abs(shift) < 2) continue;

        const byEnd = Math.min(SH, byStart + bh);
        for (let y = byStart; y < byEnd; y++) {
          const rowBase = y * SW * 4;
          // Snapshot the row before in-place shift
          const rowSnap = outBuf.slice(rowBase, rowBase + SW * 4);
          for (let x = 0; x < SW; x++) {
            const srcX = ((x - shift) % SW + SW) % SW;
            const si   = srcX * 4;
            const di   = rowBase + x * 4;
            outBuf[di]     = rowSnap[si];
            outBuf[di + 1] = rowSnap[si + 1];
            outBuf[di + 2] = rowSnap[si + 2];
          }
        }
      }
    }

    // ── 4. Temporal Echo (ghost blend with previous processed frame) ──────────
    if (_state.echoBlend > 0 && echoBuf && echoBuf.length === needed) {
      const blend = _state.echoBlend;
      const inv   = 1 - blend;
      for (let i = 0; i < needed; i += 4) {
        outBuf[i]     = outBuf[i]     * inv + echoBuf[i]     * blend;
        outBuf[i + 1] = outBuf[i + 1] * inv + echoBuf[i + 1] * blend;
        outBuf[i + 2] = outBuf[i + 2] * inv + echoBuf[i + 2] * blend;
      }
    }

    // ── 5. Stutter (periodic frame freeze) ───────────────────────────────────
    if (_state.stutterRate > 0) {
      if (stutterCountdown > 0) {
        // Repeat frozen frame
        stutterCountdown--;
        outBuf.set(stutterFrame);
      } else if (Math.random() < _state.stutterRate) {
        // Freeze starts: save current outBuf and set countdown
        const duration = 2 + (Math.random() * 3 | 0); // 2–4 frames
        stutterCountdown = duration;
        if (!stutterFrame || stutterFrame.length !== needed) {
          stutterFrame = new Uint8ClampedArray(needed);
        }
        stutterFrame.set(outBuf);
      }
    } else {
      stutterCountdown = 0;
    }

    // Save for echo on next frame
    if (!echoBuf || echoBuf.length !== needed) echoBuf = new Uint8ClampedArray(needed);
    echoBuf.set(outBuf);

    // ── 6. Draw processed frame ───────────────────────────────────────────────
    displayCtx.putImageData(new ImageData(outBuf, SW, SH), 0, 0);

    // ── 7. Scan lines (canvas overlay — no ImageData allocation needed) ───────
    if (_state.scanOpacity > 0) {
      const gap = Math.max(2, Math.round(_state.scanGap));
      displayCtx.fillStyle = `rgba(0,0,0,${_state.scanOpacity.toFixed(3)})`;
      for (let y = 0; y < DH; y += gap) {
        displayCtx.fillRect(0, y, DW, 1);
      }
    }
  }

  function drawEmptyState() {
    displayCtx.fillStyle = '#0d0008';
    displayCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);

    // Fake glitchy text lines
    const cx = displayCanvas.width / 2;
    const cy = displayCanvas.height / 2;
    displayCtx.font = '13px "JetBrains Mono", monospace';
    displayCtx.textBaseline = 'middle';
    displayCtx.textAlign = 'center';
    displayCtx.fillStyle = 'rgba(255,0,80,0.5)';
    displayCtx.fillText('NO SIGNAL', cx + 3, cy - 1);
    displayCtx.fillStyle = 'rgba(0,255,200,0.5)';
    displayCtx.fillText('NO SIGNAL', cx - 3, cy + 1);
    displayCtx.fillStyle = 'rgba(255,255,255,0.85)';
    displayCtx.fillText('NO SIGNAL', cx, cy);

    displayCtx.fillStyle = 'rgba(255,255,255,0.25)';
    displayCtx.font = '11px "JetBrains Mono", monospace';
    displayCtx.fillText('load a video to start', cx, cy + 28);

    displayCtx.textAlign = 'left';
    displayCtx.textBaseline = 'top';
  }

  // ── Registration ───────────────────────────────────────────────────────────


  function waitSeeked(v) {
    return new Promise(resolve => {
      v.addEventListener('seeked', () => setTimeout(resolve, 16), { once: true });
    });
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function pickMime() {
    return [
      'video/mp4;codecs=avc1.640028',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find(t => MediaRecorder.isTypeSupported(t));
  }

  async function exportFullRes() {
    if (!_video || !_hasVideo || _exporting) return;
    const mime = pickMime();
    if (!mime) { alert('MediaRecorder not supported in this browser.'); return; }
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    _exporting = true; _cancelExport = false;

    const vw = _video.videoWidth, vh = _video.videoHeight;

    const expCanvas = document.createElement('canvas');
    expCanvas.width = vw; expCanvas.height = vh;
    const expCtx = expCanvas.getContext('2d');

    const expSampleCanvas = document.createElement('canvas');
    expSampleCanvas.width = vw; expSampleCanvas.height = vh;
    const expSampleCtx = expSampleCanvas.getContext('2d', { willReadFrequently: true });

    const origDisplay = displayCanvas,  origDisplayCtx  = displayCtx;
    const origSample  = sampleCanvas,   origSampleCtx   = sampleCtx;
    const origOut     = outBuf,         origEcho        = echoBuf;
    const origStutter = stutterFrame,   origCountdown   = stutterCountdown;
    const origFc      = frameCount;

    displayCanvas = expCanvas;       displayCtx = expCtx;
    sampleCanvas  = expSampleCanvas; sampleCtx  = expSampleCtx;
    outBuf = null; echoBuf = null; stutterFrame = null;
    stutterCountdown = 0; frameCount = 0;

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
        if (_cancelExport) { resolve(); return; }
        const ct = _video.currentTime;
        if (prevTime > 0.5 && ct < prevTime - 0.5) { resolve(); return; } // video looped
        if (ct >= _video.duration - 0.08)           { resolve(); return; } // near end
        prevTime = ct;

        frameCount++;
        renderGlitch(_video);

        VideoEffects.setExportUI(true, ct / _video.duration);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await sleep(200);
    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    displayCanvas = origDisplay;  displayCtx  = origDisplayCtx;
    sampleCanvas  = origSample;   sampleCtx   = origSampleCtx;
    outBuf        = origOut;      echoBuf     = origEcho;
    stutterFrame  = origStutter;  stutterCountdown = origCountdown;
    frameCount    = origFc;

    if (!_cancelExport) {
      const blob = new Blob(chunks, { type: mime });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'glitch-fullres.' + ext;
      a.click();
    }

    _exporting = false;
    VideoEffects.setExportUI(false, 0);
    _video.pause();
    dirty = true;
    document.getElementById('btn-play').textContent = 'Play';
  }

  VideoEffects.register('glitch', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d');
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      sampleCanvas = document.createElement('canvas');
      sampleCanvas.width  = 854;
      sampleCanvas.height = 480;
      sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

      drawEmptyState();
      buildControls(controlsEl);
    },

    onVideoLoad: function (v, vw, vh) {
      _video = v; _hasVideo = true;
      const MAXH = 480;
      let pw = vw, ph = vh;
      if (ph > MAXH) { const s = MAXH / ph; pw = Math.round(vw * s); ph = MAXH; }

      sampleCanvas.width  = pw;
      sampleCanvas.height = ph;
      displayCanvas.width  = pw;
      displayCanvas.height = ph;

      // Reset all temporal buffers so old frames don't contaminate the new video
      outBuf = null; echoBuf = null; stutterFrame = null; stutterCountdown = 0;
      dirty = true;
    },

    activate: function () {
      echoBuf = null; stutterFrame = null; stutterCountdown = 0;
      dirty = true;
    },

    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (_exporting) return;
      frameCount++;
      const isPlaying = hasVideo && v && !v.paused && v.readyState >= 2;
      if (!dirty && !isPlaying) return;

      if (!hasVideo || !v || v.readyState < 2) {
        if (dirty) { drawEmptyState(); dirty = false; }
        return;
      }

      renderGlitch(v);
      dirty = false;
    },

    onSeek: function () {
      echoBuf = null; stutterFrame = null; stutterCountdown = 0;
      dirty = true;
    },

    exportFrame:   function () {
      const a = document.createElement('a');
      a.download = 'glitch-frame.png';
      a.href = displayCanvas.toDataURL('image/png');
      a.click();
    },
    exportFullRes: exportFullRes,
    cancelExport:  function () { _cancelExport = true; },

  });
})();
