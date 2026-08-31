/* ══ ASCII Stream ═════════════════════════════════════════════════════════
   Falling glyph streams. Each lane carries a head that runs along the grid
   leaving a decaying tail; glyphs churn in place at their own rate. Lanes
   can drift on a noise field so the streams bend instead of running
   perfectly straight.                                                       */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name: 'gen-stream',
    title: 'ASCII Stream',
    hint: 'Click to seed a new run of streams',
    resetKeys: ['cellSize', 'charset', 'seed', 'direction', 'density'],

    audioSuggest: [
      { key: 'speed', band: 'bass', amount: 0.6 },
      { key: 'churn', band: 'high', amount: 0.7 },
      { key: 'tail',  band: 'beat', amount: 0.4 },
    ],
    defaults: {
      direction:  'down',
      speed:      14,
      variance:   0.55,
      density:    0.8,
      tail:       16,
      churn:      6,
      drift:      0.35,
      headGlow:   true,
      charset:    'katakana',
      cellSize:   14,
      palette:    'toxic',
      background: '#05070a',
      persist:    0.35,
      seed:       4821,
    },

    sections: [
      {
        title: 'FLOW',
        specs: [
          { key: 'direction', label: 'Direction', type: 'select',
            options: [
              { value: 'down',  label: 'Down' },
              { value: 'up',    label: 'Up' },
              { value: 'right', label: 'Right' },
              { value: 'left',  label: 'Left' },
            ] },
          { key: 'speed', label: 'Speed', type: 'slider',
            min: 1, max: 60, step: 0.5, fmt: v => v.toFixed(1) + ' cells/s' },
          { key: 'variance', label: 'Speed Variance', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.05 ? 'Uniform' : Math.round(v * 100) + '%' },
          { key: 'density', label: 'Lane Density', type: 'slider',
            min: 0.1, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'drift', label: 'Lateral Drift', type: 'slider',
            min: 0, max: 1.5, step: 0.01,
            fmt: v => v < 0.03 ? 'Straight' : v.toFixed(2),
            hint: 'Bends streams along a slow noise field' },
        ],
      },
      {
        title: 'TAIL',
        specs: [
          { key: 'tail', label: 'Tail Length', type: 'slider',
            min: 2, max: 60, step: 1, fmt: v => v + ' cells' },
          { key: 'churn', label: 'Glyph Churn', type: 'slider',
            min: 0, max: 30, step: 0.5,
            fmt: v => v < 0.5 ? 'Frozen' : v.toFixed(1) + '/s' },
          { key: 'headGlow', label: 'Bright Head', type: 'toggle',
            options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
          { key: 'persist', label: 'Frame Persistence', type: 'slider',
            min: 0, max: 0.92, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'GLYPHS',
        specs: [
          { key: 'charset', label: 'Character Set', type: 'select',
            options: G.RAMP_OPTIONS },
          { key: 'cellSize', label: 'Cell Size', type: 'slider',
            min: 6, max: 30, step: 1, fmt: v => v + 'px' },
          { key: 'seed', label: 'Pattern Seed', type: 'seed' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
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
      env.cols = Math.max(1, Math.floor(env.w / cell));
      env.rows = Math.max(1, Math.floor(env.h / cell));
      env.offX = (env.w - env.cols * cell) / 2;
      env.offY = (env.h - env.rows * cell) / 2;

      const chars = G.RAMPS[s.charset] || G.RAMPS.katakana;
      // Skip the leading blank — streams want visible glyphs everywhere
      env.chars = chars.trim().length > 1 ? chars.trim() : chars;

      env.rng = G.prng(s.seed);
      seedLanes(env);
    },

    pointer: function (env) {
      env.rng = G.prng((Math.random() * 1e6) | 0);
      seedLanes(env);
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cell = env.cell;
      const vertical = s.direction === 'down' || s.direction === 'up';
      const forward  = s.direction === 'down' || s.direction === 'right';
      const laneLen  = vertical ? env.rows : env.cols;

      // ── Background / persistence ───────────────────────────────────────
      if (s.persist > 0.02) {
        ctx.globalAlpha = 1 - s.persist;
        ctx.fillStyle   = s.background;
        ctx.fillRect(0, 0, env.w, env.h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = s.background;
        ctx.fillRect(0, 0, env.w, env.h);
      }

      const stops  = G.PALETTES[s.palette] || G.PALETTES.toxic;
      const LEVELS = 10;
      const palKey = s.palette + ':' + LEVELS;
      if (env.palKey !== palKey) {
        env.palKey = palKey;
        env.colors = G.quantizePalette(s.palette, LEVELS);
      }
      const colors = env.colors;
      const head   = 'rgb(' + G.rampAt(stops, 1).join(',') + ')';

      ctx.font         = Math.round(cell * 1.02) + 'px ' +
                         '"JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const chars   = env.chars;
      const nChars  = chars.length;
      const tail    = Math.max(2, Math.round(s.tail));
      const halfC   = cell / 2;
      const churnP  = s.churn * dt;      // probability a glyph re-rolls this frame

      // Group cells by brightness level so each level is one fillStyle change
      if (!env.buckets || env.buckets.length !== LEVELS) {
        env.buckets = [];
        for (let i = 0; i < LEVELS; i++) env.buckets.push([]);
      }
      const buckets = env.buckets;
      for (let i = 0; i < LEVELS; i++) buckets[i].length = 0;
      const heads = [];

      for (let li = 0; li < env.lanes.length; li++) {
        const lane = env.lanes[li];
        if (!lane.active) continue;

        if (dt > 0) {
          lane.pos += lane.speed * s.speed * dt;
          if (lane.pos - tail > laneLen) {
            lane.pos   = -Math.random() * laneLen * 0.6;
            lane.speed = laneSpeed(env, s);
          }
        }

        // Lateral drift from a slow noise field
        let lateral = 0;
        if (s.drift > 0.03) {
          const n = G.noise2(li * 0.19, env.time * 0.28, env.state.seed);
          lateral = (n - 0.5) * 2 * s.drift * 6;
        }

        const headPos = lane.pos;
        for (let t = 0; t < tail; t++) {
          const along = forward ? headPos - t : laneLen - 1 - (headPos - t);
          const ai = Math.round(along);
          if (ai < 0 || ai >= laneLen) continue;

          let cx, cy;
          if (vertical) { cx = Math.round(lane.index + lateral); cy = ai; }
          else          { cx = ai; cy = Math.round(lane.index + lateral); }
          if (cx < 0 || cy < 0 || cx >= env.cols || cy >= env.rows) continue;

          const idx = cy * env.cols + cx;

          // Churn the glyph occasionally rather than every frame
          if (churnP > 0 && Math.random() < churnP) {
            env.glyphs[idx] = (Math.random() * nChars) | 0;
          }

          const x = env.offX + cx * cell + halfC;
          const y = env.offY + cy * cell + halfC;
          const ch = chars[env.glyphs[idx] % nChars];

          if (t === 0 && s.headGlow) { heads.push(ch, x, y); continue; }

          const fall = 1 - t / tail;
          let lv = (fall * fall * LEVELS) | 0;
          if (lv >= LEVELS) lv = LEVELS - 1;
          const b = buckets[lv];
          b.push(ch, x, y);
        }
      }

      for (let lv = 0; lv < LEVELS; lv++) {
        const b = buckets[lv];
        if (!b.length) continue;
        ctx.fillStyle = colors[lv];
        for (let k = 0; k < b.length; k += 3) ctx.fillText(b[k], b[k + 1], b[k + 2]);
      }

      if (heads.length) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = head;
        ctx.shadowBlur  = cell * 0.9;
        for (let k = 0; k < heads.length; k += 3) ctx.fillText(heads[k], heads[k + 1], heads[k + 2]);
        ctx.shadowBlur = 0;
      }

      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  function laneSpeed(env, s) {
    return 1 - s.variance * 0.85 + env.rng() * s.variance * 1.7;
  }

  function seedLanes(env) {
    const s        = env.state;
    const vertical = s.direction === 'down' || s.direction === 'up';
    const count    = vertical ? env.cols : env.rows;
    const laneLen  = vertical ? env.rows : env.cols;

    env.lanes = [];
    for (let i = 0; i < count; i++) {
      env.lanes.push({
        index:  i,
        active: env.rng() < s.density,
        pos:    env.rng() * (laneLen * 1.3) - laneLen * 0.3,
        speed:  laneSpeed(env, s),
      });
    }

    env.glyphs = new Uint16Array(env.cols * env.rows);
    for (let i = 0; i < env.glyphs.length; i++) env.glyphs[i] = (env.rng() * 65535) | 0;
  }
})();
