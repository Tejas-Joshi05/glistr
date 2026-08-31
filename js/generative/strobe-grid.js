/* ══ Strobe Grid ══════════════════════════════════════════════════════════
   A grid of cells that flips on a clock. Each cell gets an order index from
   the chosen fill pattern; on every step a window of indices lights up, so
   the grid sweeps, spirals or scatters in time with the beat.

   The clock is either free-running from a BPM control or slaved to detected
   kicks when audio reactivity is on.                                        */

(function () {
  'use strict';

  const G = window.Generative;

  const DIVISIONS = {
    '4':    4,     // one step every 4 beats
    '2':    2,
    '1':    1,
    '1/2':  0.5,
    '1/4':  0.25,
    '1/8':  0.125,
    '1/8t': 1 / 12,
    '1/16': 0.0625,
  };

  Generative.create({
    name: 'gen-strobe',
    title: 'Strobe Grid',
    hint: 'Click to re-roll the fill order',
    resetKeys: ['cellSize', 'gap', 'order', 'seed'],

    audioSuggest: [
      { key: 'syncBeat', value: true },
      { key: 'window',   band: 'bass', amount: 0.3 },
      { key: 'decay',    band: 'high', amount: 0.4 },
    ],
    defaults: {
      bpm:        128,
      division:   '1/4',
      syncBeat:   false,
      order:      'sweep-x',
      window:     0.22,
      duty:       0.55,
      decay:      12,
      cellSize:   44,
      gap:        4,
      shape:      'block',
      ramp:       'blocks',
      ink:        '#c9f24d',
      paper:      '#08090a',
      accent:     '#ff4d6d',
      accentRate: 0.12,
      invert:     false,
      seed:       991,
    },

    sections: [
      {
        title: 'CLOCK',
        specs: [
          { key: 'bpm', label: 'Tempo', type: 'slider',
            min: 60, max: 200, step: 1, fmt: v => Math.round(v) + ' BPM' },
          { key: 'division', label: 'Step Length', type: 'select',
            options: [
              { value: '4',    label: '4 bars' },
              { value: '2',    label: '2 beats' },
              { value: '1',    label: '1 beat' },
              { value: '1/2',  label: '1/2' },
              { value: '1/4',  label: '1/4' },
              { value: '1/8',  label: '1/8' },
              { value: '1/8t', label: '1/8 triplet' },
              { value: '1/16', label: '1/16' },
            ] },
          { key: 'syncBeat', label: 'Clock Source', type: 'toggle',
            options: [
              { value: false, label: 'Tempo' },
              { value: true,  label: 'Audio Beat' },
            ],
            hint: 'Audio Beat steps on each kick; falls back to tempo with no audio' },
        ],
      },
      {
        title: 'PATTERN',
        specs: [
          { key: 'order', label: 'Fill Order', type: 'select',
            options: [
              { value: 'sweep-x',  label: 'Sweep →' },
              { value: 'sweep-y',  label: 'Sweep ↓' },
              { value: 'diagonal', label: 'Diagonal' },
              { value: 'radial',   label: 'Radial' },
              { value: 'spiral',   label: 'Spiral' },
              { value: 'checker',  label: 'Checkerboard' },
              { value: 'random',   label: 'Scatter' },
            ] },
          { key: 'window', label: 'Lit Fraction', type: 'slider',
            min: 0.02, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            hint: 'How much of the grid is lit at once' },
          { key: 'duty', label: 'Gate Length', type: 'slider',
            min: 0.05, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            hint: 'Portion of each step the cells stay on' },
          { key: 'decay', label: 'Flash Decay', type: 'slider',
            min: 0.5, max: 20, step: 0.5,
            fmt: v => v > 15 ? 'Hard cut' : v.toFixed(1) },
          { key: 'seed', label: 'Order Seed', type: 'seed' },
        ],
      },
      {
        title: 'CELLS',
        specs: [
          { key: 'shape', label: 'Cell Shape', type: 'select',
            options: [
              { value: 'block',  label: 'Solid Block' },
              { value: 'bar',    label: 'Bar' },
              { value: 'dot',    label: 'Dot' },
              { value: 'glyph',  label: 'Glyph' },
              { value: 'outline', label: 'Outline' },
            ] },
          { key: 'ramp', label: 'Character Ramp', type: 'select',
            options: G.RAMP_OPTIONS, showIf: s => s.shape === 'glyph' },
          { key: 'cellSize', label: 'Cell Size', type: 'slider',
            min: 8, max: 160, step: 2, fmt: v => v + 'px' },
          { key: 'gap', label: 'Gap', type: 'slider',
            min: 0, max: 24, step: 1, fmt: v => v + 'px' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'ink',    label: 'Lit Color',   type: 'color' },
          { key: 'paper',  label: 'Background',  type: 'color' },
          { key: 'accent', label: 'Accent Color', type: 'color' },
          { key: 'accentRate', label: 'Accent Chance', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Never' : Math.round(v * 100) + '%' },
          { key: 'invert', label: 'Invert', type: 'toggle',
            options: [{ value: false, label: 'Off' }, { value: true, label: 'On' }] },
        ],
      },
    ],

    setup: function (env) {
      const s    = env.state;
      const cell = Math.max(6, s.cellSize);
      env.cell = cell;
      env.cols = Math.max(1, Math.floor(env.w / cell));
      env.rows = Math.max(1, Math.floor(env.h / cell));
      env.offX = (env.w - env.cols * cell) / 2;
      env.offY = (env.h - env.rows * cell) / 2;

      const n = env.cols * env.rows;
      env.orderVal = new Float32Array(n);   // 0..1 position in the fill order
      env.level    = new Float32Array(n);   // current brightness
      env.accent   = new Uint8Array(n);
      env.phase    = 0;                     // 0..1 within the current step
      env.stepIx   = 0;
      env.lastBeat = -1;

      buildOrder(env);
    },

    pointer: function (env) {
      env.state.seed = (Math.random() * 999998 + 1) | 0;
      buildOrder(env);
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cols = env.cols, rows = env.rows, cell = env.cell;

      // ── Advance the clock ──────────────────────────────────────────────
      // Beat sync needs a live audio source; without one, fall back to tempo
      // so the grid always has a pulse.
      const onBeatClock = s.syncBeat && env.audioActive;
      let stepped = false;

      if (onBeatClock) {
        if (env.beats !== env.lastBeat) {
          if (env.lastBeat !== -1) stepped = true;
          env.lastBeat = env.beats;
          env.phase = 0;
        } else if (dt > 0) {
          env.phase = Math.min(1, env.phase + dt * 2);
        }
      } else if (dt > 0) {
        env.lastBeat = -1;
        const stepSecs = (60 / s.bpm) * (DIVISIONS[s.division] || 0.25);
        env.phase += dt / stepSecs;
        while (env.phase >= 1) { env.phase -= 1; stepped = true; }
      }

      if (stepped) {
        env.stepIx++;
        const win   = s.window;
        const start = (env.stepIx * win) % 1;
        const order = env.orderVal;
        const level = env.level;
        const accent = env.accent;
        const rate  = s.accentRate;
        for (let i = 0; i < order.length; i++) {
          // Wrapped window test so the lit band cycles round the order
          let d = order[i] - start;
          if (d < 0) d += 1;
          if (d < win) {
            level[i]  = 1;
            accent[i] = Math.random() < rate ? 1 : 0;
          }
        }
      }

      // ── Gate and decay ─────────────────────────────────────────────────
      // Cells hold at full brightness while the gate is open, then fall away
      // once it closes — that hold is what makes the grid read as a strobe
      // rather than a smear.
      const level = env.level;
      if (dt > 0 && env.phase >= s.duty) {
        const k = Math.exp(-s.decay * dt);
        for (let i = 0; i < level.length; i++) {
          const v = level[i] * k;
          level[i] = v < 0.01 ? 0 : v;
        }
      }

      // ── Paint ──────────────────────────────────────────────────────────
      const paper = s.invert ? s.ink   : s.paper;
      const ink   = s.invert ? s.paper : s.ink;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, env.w, env.h);

      const gap  = Math.min(s.gap, cell * 0.4);
      const size = cell - gap;
      const ramp = G.RAMPS[s.ramp] || G.RAMPS.blocks;

      if (s.shape === 'glyph') {
        ctx.font = Math.round(cell * 0.92) + 'px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      }

      const inkRGB    = G.hexToRgb(ink);
      const accentRGB = G.hexToRgb(s.accent);

      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          const v = level[i];
          if (v <= 0.004) continue;

          const c = env.accent[i] ? accentRGB : inkRGB;
          const x = env.offX + cx * cell + gap / 2;
          const y = env.offY + cy * cell + gap / 2;

          ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + v.toFixed(3) + ')';

          switch (s.shape) {
            case 'bar':
              ctx.fillRect(x, y + size * 0.35, size, size * 0.3);
              break;
            case 'dot':
              ctx.beginPath();
              ctx.arc(x + size / 2, y + size / 2, size * 0.32 * (0.4 + v * 0.6), 0, Math.PI * 2);
              ctx.fill();
              break;
            case 'outline':
              ctx.strokeStyle = ctx.fillStyle;
              ctx.lineWidth   = Math.max(1, cell * 0.06);
              ctx.strokeRect(x, y, size, size);
              break;
            case 'glyph': {
              let li = ((1 - v) * (ramp.length - 1)) | 0;
              if (li >= ramp.length) li = ramp.length - 1;
              ctx.fillText(ramp[ramp.length - 1 - li], x + size / 2, y + size / 2);
              break;
            }
            default:
              ctx.fillRect(x, y, size, size);
          }
        }
      }

      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  // ── Fill orders — each cell gets a 0..1 position in the sequence ─────────

  function buildOrder(env) {
    const s    = env.state;
    const cols = env.cols, rows = env.rows;
    const out  = env.orderVal;
    const rng  = G.prng(s.seed);
    const cxm  = (cols - 1) / 2, cym = (rows - 1) / 2;
    const maxR = Math.sqrt(cxm * cxm + cym * cym) || 1;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        let v;
        switch (s.order) {
          case 'sweep-y':  v = cy / Math.max(1, rows - 1); break;
          case 'diagonal': v = (cx + cy) / Math.max(1, cols + rows - 2); break;
          case 'radial': {
            const dx = cx - cxm, dy = cy - cym;
            v = Math.sqrt(dx * dx + dy * dy) / maxR;
            break;
          }
          case 'spiral': {
            const dx = cx - cxm, dy = cy - cym;
            const r  = Math.sqrt(dx * dx + dy * dy) / maxR;
            const a  = (Math.atan2(dy, dx) / (Math.PI * 2)) + 0.5;
            v = (a + r * 2) % 1;
            break;
          }
          case 'checker': v = ((cx + cy) & 1) ? 0.5 + rng() * 0.5 : rng() * 0.5; break;
          case 'random':  v = rng(); break;
          default:        v = cx / Math.max(1, cols - 1);   // sweep-x
        }
        out[i] = v;
      }
    }
  }
})();
