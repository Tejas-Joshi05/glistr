(function () {
  'use strict';

  // ── Character sets ─────────────────────────────────────────────────────────
  // Ordered dark → light so index 0 = darkest, last = brightest.
  const CHAR_SETS = {
    simple:   ' .:-=+*#%@',
    detailed: " `.-':_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@",
    blocks:   ' ░▒▓█',  // ░ ▒ ▓ █
  };

  let _state = {
    fontSize:  10,
    charSet:   'simple',
    colorMode: 'classic',
    contrast:  1.2,
    invert:    false,
  };

  let displayCanvas, displayCtx;
  let sampleCanvas, sampleCtx;
  let frameCount = 0;
  let dirty = true;
  let _video = null, _hasVideo = false, _exporting = false, _cancelExport = false;

  // ── Control builder ────────────────────────────────────────────────────────

  function buildControls(container) {
    container.innerHTML = '';

    const SECTIONS = [
      {
        title: 'Characters',
        hint:  'What the art is made of',
        specs: [
          {
            key: 'charSet', label: 'Character Set', type: 'select',
            options: [
              ['simple',   'Simple  (10 chars)'],
              ['detailed', 'Detailed  (full ASCII)'],
              ['blocks',   'Blocks  (░▒▓█)'],
            ],
          },
          {
            key: 'fontSize', label: 'Cell Size', type: 'slider',
            min: 4, max: 20, step: 1,
            fmt: v => v + 'px',
            hint: 'Smaller = more detail',
          },
        ],
      },
      {
        title: 'Color & Style',
        hint:  'How each character is colored',
        specs: [
          {
            key: 'colorMode', label: 'Color Mode', type: 'select',
            options: [
              ['classic',  'White on Black'],
              ['matrix',   'Matrix Green'],
              ['color',    'Match Video Color'],
              ['inverted', 'Inverted'],
            ],
          },
          {
            key: 'contrast', label: 'Contrast', type: 'slider',
            min: 0.5, max: 3.0, step: 0.05,
            fmt: v => v.toFixed(2) + '×',
          },
          {
            key: 'invert', label: 'Brightness Mapping', type: 'toggle',
            options: [['false', 'Normal'], ['true', 'Inverted']],
          },
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
      disp.className = 'control__value';
      disp.textContent = spec.fmt(parseFloat(_state[spec.key]));

      input.addEventListener('input', function () {
        const v = parseFloat(input.value);
        disp.textContent = spec.fmt(v);
        _state = { ..._state, [spec.key]: v };
        dirty = true;
      });

      row.appendChild(input);
      row.appendChild(disp);
      wrap.appendChild(row);

    } else if (spec.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'control__select';
      for (const [v, txt] of spec.options) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = txt;
        if (String(v) === String(_state[spec.key])) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', function () {
        _state = { ..._state, [spec.key]: sel.value };
        dirty = true;
      });
      wrap.appendChild(sel);

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
          dirty = true;
        });
        grp.appendChild(btn);
      }
      wrap.appendChild(grp);
    }

    return wrap;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderASCII(imgData) {
    const dw = displayCanvas.width;
    const dh = displayCanvas.height;
    const sw = imgData.width;
    const sh = imgData.height;

    const chars  = CHAR_SETS[_state.charSet] || CHAR_SETS.simple;
    const fs     = Math.max(4, Math.round(_state.fontSize));
    const cellW  = Math.max(1, Math.round(fs * 0.55));
    const cellH  = fs;
    const ct     = _state.contrast;
    const invert = _state.invert;
    const mode   = _state.colorMode;

    // Background fill
    switch (mode) {
      case 'inverted': displayCtx.fillStyle = '#fff';    break;
      case 'matrix':   displayCtx.fillStyle = '#001800'; break;
      default:         displayCtx.fillStyle = '#000';
    }
    displayCtx.fillRect(0, 0, dw, dh);

    displayCtx.font = `${fs}px "JetBrains Mono", monospace`;
    displayCtx.textBaseline = 'top';

    // Scale sample → display
    const scaleX = sw / dw;
    const scaleY = sh / dh;

    for (let py = 0; py < dh; py += cellH) {
      for (let px = 0; px < dw; px += cellW) {
        // Map display cell → sample region
        const sx0 = Math.floor(px * scaleX);
        const sy0 = Math.floor(py * scaleY);
        const sx1 = Math.min(sw, Math.ceil((px + cellW) * scaleX));
        const sy1 = Math.min(sh, Math.ceil((py + cellH) * scaleY));

        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let sy = sy0; sy < sy1; sy++) {
          for (let sx = sx0; sx < sx1; sx++) {
            const j = (sy * sw + sx) * 4;
            sr += imgData.data[j];
            sg += imgData.data[j + 1];
            sb += imgData.data[j + 2];
            cnt++;
          }
        }
        if (cnt === 0) continue;
        sr /= cnt; sg /= cnt; sb /= cnt;

        let lum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
        lum = Math.min(255, Math.max(0, (lum - 128) * ct + 128));
        const effLum = invert ? 255 - lum : lum;

        const ci = Math.min(chars.length - 1, Math.floor((effLum / 256) * chars.length));

        switch (mode) {
          case 'color':
            displayCtx.fillStyle = `rgb(${sr | 0},${sg | 0},${sb | 0})`;
            break;
          case 'matrix':
            displayCtx.fillStyle = `rgba(0,255,70,${(0.15 + effLum / 255 * 0.85).toFixed(2)})`;
            break;
          case 'inverted':
            displayCtx.fillStyle = `rgb(${255 - (sr | 0)},${255 - (sg | 0)},${255 - (sb | 0)})`;
            break;
          default:
            displayCtx.fillStyle = `rgba(255,255,255,${(0.05 + effLum / 255 * 0.95).toFixed(2)})`;
        }

        displayCtx.fillText(chars[ci], px, py);
      }
    }
  }

  function drawEmptyState() {
    displayCtx.fillStyle = '#001800';
    displayCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);

    displayCtx.font = '14px "JetBrains Mono", monospace';
    displayCtx.textBaseline = 'middle';
    displayCtx.textAlign = 'center';
    displayCtx.fillStyle = 'rgba(0,255,70,0.35)';
    displayCtx.fillText('> load a video to see ASCII art', displayCanvas.width / 2, displayCanvas.height / 2);
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

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = vw; srcCanvas.height = vh;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

    const expCanvas = document.createElement('canvas');
    expCanvas.width = vw; expCanvas.height = vh;
    const expCtx = expCanvas.getContext('2d');

    const origDisplay = displayCanvas, origDisplayCtx = displayCtx;
    displayCanvas = expCanvas; displayCtx = expCtx;

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

        srcCtx.drawImage(_video, 0, 0, vw, vh);
        const imgData = srcCtx.getImageData(0, 0, vw, vh);
        renderASCII(imgData);

        VideoEffects.setExportUI(true, ct / _video.duration);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await sleep(200);
    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    displayCanvas = origDisplay; displayCtx = origDisplayCtx;

    if (!_cancelExport) {
      const blob = new Blob(chunks, { type: mime });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = 'ascii-fullres.' + ext;
      a.click();
    }

    _exporting = false;
    VideoEffects.setExportUI(false, 0);
    _video.pause();
    dirty = true;
    document.getElementById('btn-play').textContent = 'Play';
  }

  VideoEffects.register('ascii', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d');
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      // Off-screen capture at preview resolution (shared between frames)
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
      dirty = true;
    },

    activate: function () { dirty = true; },
    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (_exporting) return;
      frameCount++;
      const isPlaying = hasVideo && v && !v.paused && v.readyState >= 2;
      // ASCII is pixel-reading intensive — throttle to every 3 frames
      if (!dirty && !(isPlaying && frameCount % 3 === 0)) return;

      if (!hasVideo || !v || v.readyState < 2) {
        if (dirty) { drawEmptyState(); dirty = false; }
        return;
      }

      sampleCtx.drawImage(v, 0, 0, sampleCanvas.width, sampleCanvas.height);
      const imgData = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      renderASCII(imgData);
      dirty = false;
    },

    exportFrame: function () {
      const a = document.createElement('a');
      a.download = 'ascii-frame.png';
      a.href = displayCanvas.toDataURL('image/png');
      a.click();
    },

    onSeek:       function () { dirty = true; },
    exportFullRes: exportFullRes,
    cancelExport:  function () { _cancelExport = true; },

  });
})();
