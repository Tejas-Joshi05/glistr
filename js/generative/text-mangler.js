/* ══ Text Mangler ═════════════════════════════════════════════════════════
   Your text, rasterised once into a coverage mask, then rebuilt as a glyph
   grid that can be eroded, scrambled, sheared and shaken apart — and snapped
   back together on the beat.

   The mask is only re-rendered when the text or the grid changes; every
   frame after that is a walk over the cell grid.                            */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name:  'gen-text',
    title: 'Text Mangler',
    hint:  'Click to re-roll the scramble',
    resetKeys: ['cellSize', 'text', 'weight', 'fit', 'lineGap'],

    audioSuggest: [
      { key: 'scramble', band: 'high', amount: -0.55 },
      { key: 'shake',    band: 'beat', amount: 0.6 },
      { key: 'erode',    band: 'bass', amount: 0.3 },
    ],

    defaults: {
      text:       'GLISTR',
      weight:     800,
      fit:        0.82,
      lineGap:    1.05,
      cellSize:   12,
      scramble:   0.35,
      erode:      0.1,
      shake:      0.25,
      shear:      0,
      reassemble: 2.4,
      ramp:       'ascii',
      fillGlyph:  '█',
      palette:    'acid',
      background: '#06070a',
      noiseField: 0.25,
    },

    sections: [
      {
        title: 'TEXT',
        specs: [
          { key: 'text', label: 'Message', type: 'text',
            placeholder: 'TYPE SOMETHING',
            hint: 'Use / for a line break' },
          { key: 'weight', label: 'Weight', type: 'slider',
            min: 100, max: 900, step: 100, fmt: v => Math.round(v) },
          { key: 'fit', label: 'Fill Width', type: 'slider',
            min: 0.2, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'lineGap', label: 'Line Spacing', type: 'slider',
            min: 0.7, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'cellSize', label: 'Cell Size', type: 'slider',
            min: 5, max: 30, step: 1, fmt: v => v + 'px' },
        ],
      },
      {
        title: 'MANGLE',
        specs: [
          { key: 'scramble', label: 'Scramble', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Clean' : Math.round(v * 100) + '%',
            hint: 'Replaces glyphs with junk — 0 leaves the text readable' },
          { key: 'erode', label: 'Erosion', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Solid' : Math.round(v * 100) + '%' },
          { key: 'shake', label: 'Displacement', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Locked' : Math.round(v * 100) + '%' },
          { key: 'shear', label: 'Row Shear', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Off' : Math.round(v * 100) + '%' },
          { key: 'reassemble', label: 'Reassemble Speed', type: 'slider',
            min: 0.2, max: 8, step: 0.1, fmt: v => v.toFixed(1),
            hint: 'How fast displaced cells snap home after a hit' },
          { key: 'noiseField', label: 'Field Drift', type: 'slider',
            min: 0, max: 1.5, step: 0.01, fmt: v => v.toFixed(2) },
        ],
      },
      {
        title: 'LOOK',
        specs: [
          { key: 'ramp', label: 'Scramble Ramp', type: 'select',
            options: G.RAMP_OPTIONS },
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Background', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      const s    = env.state;
      const cell = Math.max(4, s.cellSize);
      env.cell = cell;
      env.cols = Math.max(4, Math.floor(env.w / cell));
      env.rows = Math.max(4, Math.floor(env.h / cell));
      env.offX = (env.w - env.cols * cell) / 2;
      env.offY = (env.h - env.rows * cell) / 2;
      env.mask = buildMask(env);
      env.jitter = new Float32Array(env.cols * env.rows);
      env.hit = 0;
      env.lastBeat = -1;
    },

    pointer: function (env) {
      env.hit = 1;
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cols = env.cols, rows = env.rows, cell = env.cell;
      const mask = env.mask;

      // A kick knocks the letters apart; they walk back on their own
      if (env.beats !== undefined && env.beats !== env.lastBeat) {
        if (env.lastBeat !== -1 && env.audioActive) env.hit = 1;
        env.lastBeat = env.beats;
      }
      env.hit = Math.max(0, env.hit - dt * s.reassemble);

      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, env.w, env.h);

      const ramp   = G.RAMPS[s.ramp] || G.RAMPS.ascii;
      const junk   = ramp.trim();
      const levels = 5;
      const palKey = s.palette + ':' + levels;
      if (env.palKey !== palKey) {
        env.palKey = palKey;
        env.colors = G.quantizePalette(s.palette, levels);
      }
      const colors = env.colors;

      ctx.font = Math.round(cell * 1.08) + 'px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const t       = env.time;
      const drift   = s.noiseField;
      const shakeAmt = s.shake * (0.35 + env.hit * 2.2);
      const half    = cell / 2;
      const scramble = s.scramble;
      const erode    = s.erode;

      for (let cy = 0; cy < rows; cy++) {
        // Whole-row shear, strongest right after a hit
        const shearOff = s.shear > 0.01
          ? Math.round((G.noise2(cy * 0.7, t * 1.5, 11) - 0.5) * s.shear * cols * 0.5 * (0.3 + env.hit))
          : 0;

        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          const m = mask[i];
          if (m < 0.05) continue;

          // Erosion thins the letterform from a noise field
          if (erode > 0.01) {
            const nz = G.noise2(cx * 0.4, cy * 0.4 + t * drift, 3);
            if (nz < erode * 0.9) continue;
          }

          let ox = 0, oy = 0;
          if (shakeAmt > 0.01) {
            const n1 = G.noise2(cx * 0.3 + t * drift, cy * 0.3, 21) - 0.5;
            const n2 = G.noise2(cx * 0.3, cy * 0.3 - t * drift, 37) - 0.5;
            ox = n1 * shakeAmt * cell * 6;
            oy = n2 * shakeAmt * cell * 6;
          }

          const gx = cx + shearOff;
          const x  = env.offX + gx * cell + half + ox;
          const y  = env.offY + cy * cell + half + oy;
          if (x < -cell || x > env.w + cell) continue;

          // Glyph: the solid block when clean, junk when scrambled
          let ch = s.fillGlyph;
          if (scramble > 0.01) {
            const r = G.noise2(cx * 1.7 + Math.floor(t * 12) * 0.37, cy * 1.3, 5);
            if (r < scramble) ch = junk[(r * junk.length * 3 | 0) % junk.length];
          }

          let lv = ((m * 0.7 + (1 - Math.abs(ox) / (cell * 4 + 1)) * 0.3) * levels) | 0;
          if (lv >= levels) lv = levels - 1;
          if (lv < 0) lv = 0;
          ctx.fillStyle = colors[lv];
          ctx.fillText(ch, x, y);
        }
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  // Rasterise the text once and sample per cell — coverage becomes the mask.
  function buildMask(env) {
    const s    = env.state;
    const cols = env.cols, rows = env.rows;
    const mask = new Float32Array(cols * rows);

    const c   = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const cx  = c.getContext('2d', { willReadFrequently: true });

    const lines = String(s.text || '').split('/').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return mask;

    cx.fillStyle = '#000';
    cx.fillRect(0, 0, cols, rows);
    cx.fillStyle = '#fff';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';

    // Pick the size that fits the widest line into the requested width
    let size = rows / lines.length * s.lineGap * 0.8;
    for (let guard = 0; guard < 40; guard++) {
      cx.font = s.weight + ' ' + size.toFixed(2) + 'px Inter, system-ui, sans-serif';
      let widest = 0;
      for (const ln of lines) widest = Math.max(widest, cx.measureText(ln).width);
      if (widest <= cols * s.fit || size <= 2) break;
      size *= (cols * s.fit) / widest;
    }

    const lineH = size * s.lineGap;
    const top   = rows / 2 - (lines.length - 1) * lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      cx.fillText(lines[i], cols / 2, top + i * lineH);
    }

    const data = cx.getImageData(0, 0, cols, rows).data;
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4] / 255;
    return mask;
  }
})();
