(function () {
  'use strict';

  let _state = {
    sensitivity:   25,
    minBlobSize:   1500,
    boxColor:      '#00ff46',
    boxThickness:  2,
    showVideo:     true,
    mergeRadius:   40,
    connectBoxes:  false,
  };

  let displayCanvas, displayCtx;
  let captureCanvas, captureCtx;
  let prevFrameData = null;
  let frameCount = 0;
  let dirty = true;

  // ── Control builder ────────────────────────────────────────────────────────

  function buildControls(container) {
    container.innerHTML = '';

    const SECTIONS = [
      {
        title: 'Detection',
        hint:  'How motion is identified',
        specs: [
          {
            key: 'sensitivity', label: 'Sensitivity', type: 'slider',
            min: 5, max: 100, step: 1,
            fmt: v => Math.round(v),
            hint: 'Lower = detect subtle movement',
          },
          {
            key: 'minBlobSize', label: 'Min Blob Size', type: 'slider',
            min: 200, max: 10000, step: 100,
            fmt: v => Math.round(v) + ' px²',
            hint: 'Ignore tiny movement regions',
          },
          {
            key: 'mergeRadius', label: 'Merge Distance', type: 'slider',
            min: 10, max: 100, step: 5,
            fmt: v => Math.round(v) + 'px',
            hint: 'Pull nearby boxes together',
          },
        ],
      },
      {
        title: 'Box Style',
        hint:  'Appearance of the tracking boxes',
        specs: [
          { key: 'boxColor',     label: 'Box Color',      type: 'color' },
          {
            key: 'boxThickness', label: 'Line Thickness',  type: 'slider',
            min: 1, max: 8, step: 1,
            fmt: v => Math.round(v) + 'px',
          },
          {
            key: 'showVideo', label: 'Background', type: 'toggle',
            options: [['true', 'Show Video'], ['false', 'Black']],
          },
          {
            key: 'connectBoxes', label: 'Connect Boxes', type: 'toggle',
            options: [['false', 'Off'], ['true', 'On']],
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
      disp.textContent = spec.fmt(_state[spec.key]);

      input.addEventListener('input', function () {
        const v = parseFloat(input.value);
        disp.textContent = spec.fmt(v);
        _state = { ..._state, [spec.key]: v };
        // Reset frame diff so sensitivity change takes effect immediately
        if (spec.key === 'sensitivity') prevFrameData = null;
      });

      row.appendChild(input);
      row.appendChild(disp);
      wrap.appendChild(row);

    } else if (spec.type === 'color') {
      const input = document.createElement('input');
      input.type  = 'color';
      input.value = _state[spec.key];
      input.className = 'control__color';
      input.addEventListener('input', function () {
        _state = { ..._state, [spec.key]: input.value };
      });
      wrap.appendChild(input);

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
        });
        grp.appendChild(btn);
      }
      wrap.appendChild(grp);
    }

    return wrap;
  }

  // ── Motion detection ───────────────────────────────────────────────────────

  function findBlobs(currData, prevData, w, h) {
    const threshold = _state.sensitivity;
    const cellSize  = Math.max(8, Math.round(_state.mergeRadius / 3));
    const gridW     = Math.ceil(w / cellSize);
    const gridH     = Math.ceil(h / cellSize);
    const active    = new Uint8Array(gridW * gridH);
    const minCount  = Math.max(1, Math.floor(cellSize * cellSize * 0.12));

    // Mark cells with enough motion pixels
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        let count = 0;
        for (let dy = 0; dy < cellSize; dy++) {
          const py = gy * cellSize + dy;
          if (py >= h) break;
          const rowBase = py * w * 4;
          for (let dx = 0; dx < cellSize; dx++) {
            const px = gx * cellSize + dx;
            if (px >= w) break;
            const j = rowBase + px * 4;
            const dr = Math.abs(currData[j]     - prevData[j]);
            const dg = Math.abs(currData[j + 1] - prevData[j + 1]);
            const db = Math.abs(currData[j + 2] - prevData[j + 2]);
            if ((dr + dg + db) / 3 > threshold) count++;
          }
        }
        if (count >= minCount) active[gy * gridW + gx] = 1;
      }
    }

    // BFS to find connected regions and their bounding boxes
    const visited = new Uint8Array(gridW * gridH);
    const boxes   = [];
    const DX = [-1, 1,  0, 0, -1, -1, 1,  1];
    const DY = [ 0, 0, -1, 1, -1,  1, -1, 1];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (!active[idx] || visited[idx]) continue;

        const queue = [idx];
        visited[idx] = 1;
        let minX = gx, maxX = gx, minY = gy, maxY = gy;
        let qi = 0;

        while (qi < queue.length) {
          const cur = queue[qi++];
          const cx  = cur % gridW;
          const cy  = (cur / gridW) | 0;

          for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d], ny = cy + DY[d];
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nidx = ny * gridW + nx;
            if (!active[nidx] || visited[nidx]) continue;
            visited[nidx] = 1;
            queue.push(nidx);
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
          }
        }

        const px1  = minX * cellSize;
        const py1  = minY * cellSize;
        const px2  = Math.min(w, (maxX + 1) * cellSize);
        const py2  = Math.min(h, (maxY + 1) * cellSize);
        const area = (px2 - px1) * (py2 - py1);

        if (area >= _state.minBlobSize) {
          boxes.push({ x: px1, y: py1, w: px2 - px1, h: py2 - py1 });
        }
      }
    }

    return boxes;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderFrame(v) {
    const dw = displayCanvas.width;
    const dh = displayCanvas.height;
    const cw = captureCanvas.width;
    const ch = captureCanvas.height;

    // Capture at reduced resolution for perf
    captureCtx.drawImage(v, 0, 0, cw, ch);
    const curr = captureCtx.getImageData(0, 0, cw, ch);

    // Draw background
    if (_state.showVideo) {
      displayCtx.drawImage(v, 0, 0, dw, dh);
    } else {
      displayCtx.fillStyle = '#000';
      displayCtx.fillRect(0, 0, dw, dh);
    }

    if (prevFrameData !== null) {
      const boxes = findBlobs(curr.data, prevFrameData, cw, ch);

      // Scale from capture space → display space
      const sx = dw / cw;
      const sy = dh / ch;

      displayCtx.strokeStyle = _state.boxColor;
      displayCtx.lineWidth   = _state.boxThickness;
      displayCtx.shadowColor = _state.boxColor;
      displayCtx.shadowBlur  = 8;

      for (const box of boxes) {
        displayCtx.strokeRect(
          box.x * sx,
          box.y * sy,
          box.w * sx,
          box.h * sy
        );
      }

      // Draw lines connecting box centers
      if (_state.connectBoxes && boxes.length > 1) {
        const centers = boxes.map(b => ({
          x: (b.x + b.w / 2) * sx,
          y: (b.y + b.h / 2) * sy,
        }));
        displayCtx.beginPath();
        displayCtx.setLineDash([5, 4]);
        displayCtx.lineWidth = Math.max(1, _state.boxThickness - 1);
        for (let i = 0; i < centers.length - 1; i++) {
          displayCtx.moveTo(centers[i].x, centers[i].y);
          displayCtx.lineTo(centers[i + 1].x, centers[i + 1].y);
        }
        displayCtx.stroke();
        displayCtx.setLineDash([]);
      }

      displayCtx.shadowBlur = 0;
    }

    prevFrameData = curr.data.slice(); // copy current frame for next diff
  }

  function drawEmptyState() {
    displayCtx.fillStyle = '#0a0a0a';
    displayCtx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);

    const m  = 40;
    const cw = displayCanvas.width;
    const ch = displayCanvas.height;

    displayCtx.strokeStyle = 'rgba(0,255,70,0.18)';
    displayCtx.lineWidth   = 1.5;
    displayCtx.strokeRect(m, m, cw - m * 2, ch - m * 2);

    displayCtx.fillStyle = 'rgba(0,255,70,0.35)';
    displayCtx.font = '13px "JetBrains Mono", monospace';
    displayCtx.textBaseline = 'middle';
    displayCtx.textAlign = 'center';
    displayCtx.fillText('Load a video to start tracking motion', cw / 2, ch / 2);
    displayCtx.textAlign = 'left';
    displayCtx.textBaseline = 'top';
  }

  // ── Registration ───────────────────────────────────────────────────────────

  VideoEffects.register('blob', {

    init: function (canvas, controlsEl) {
      displayCanvas = canvas;
      displayCtx    = canvas.getContext('2d');
      displayCanvas.width  = 854;
      displayCanvas.height = 480;

      // Capture at half resolution for performance
      captureCanvas = document.createElement('canvas');
      captureCanvas.width  = 427;
      captureCanvas.height = 240;
      captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

      drawEmptyState();
      buildControls(controlsEl);
    },

    onVideoLoad: function (v, vw, vh) {
      // Capture at most 240p for perf (scale down if larger)
      const MAXH = 240;
      let cw = vw, ch = vh;
      if (ch > MAXH) { const s = MAXH / ch; cw = Math.round(vw * s); ch = MAXH; }
      captureCanvas.width  = cw;
      captureCanvas.height = ch;

      displayCanvas.width  = vw;
      displayCanvas.height = vh;

      prevFrameData = null;
      dirty = true;
    },

    activate: function () {
      prevFrameData = null; // reset diff when switching to this tab
      dirty = true;
    },

    deactivate: function () {},

    tick: function (v, hasVideo) {
      if (!hasVideo || !v || v.readyState < 2) {
        if (dirty) { drawEmptyState(); dirty = false; }
        return;
      }
      if (v.paused) {
        // Show video frame after a seek while paused (no motion boxes — no prev frame)
        if (dirty) {
          displayCtx.drawImage(v, 0, 0, displayCanvas.width, displayCanvas.height);
          dirty = false;
        }
        return;
      }
      renderFrame(v);
    },

    exportFrame: function () {
      const a = document.createElement('a');
      a.download = 'blob-frame.png';
      a.href = displayCanvas.toDataURL('image/png');
      a.click();
    },

    onSeek: function () {
      prevFrameData = null; // can't diff against a frame from a different timestamp
      dirty = true;
    },

  });
})();
