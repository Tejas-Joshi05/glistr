/* ══ Glyph Automaton ══════════════════════════════════════════════════════
   Cellular automata rendered as characters. Three rule sets:

     cyclic  — a cell adopts the next state up if enough neighbours already
               hold it; produces spirals that never settle
     life    — Conway, with a trail so dead cells fade rather than vanish
     smooth  — a coarse SmoothLife-ish blur/threshold, for blobby drift

   Everything runs on two Uint8Arrays with a fixed step rate, so the look
   holds at any frame rate.                                                  */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name:  'gen-automaton',
    title: 'Glyph Automaton',
    hint:  'Click to seed fresh noise',
    resetKeys: ['cellSize', 'rule', 'states', 'seed'],

    audioSuggest: [
      { key: 'rate',    band: 'bass', amount: 0.5 },
      { key: 'inject',  band: 'beat', amount: 0.6 },
    ],

    defaults: {
      rule:       'cyclic',
      states:     12,
      threshold:  3,
      rate:       14,
      inject:     0,
      density:    0.5,
      trail:      0.55,
      cellSize:   10,
      ramp:       'blocks',
      palette:    'toxic',
      background: '#05070a',
      seed:       606,
    },

    sections: [
      {
        title: 'RULE',
        specs: [
          { key: 'rule', label: 'Rule Set', type: 'toggle',
            options: [
              { value: 'cyclic', label: 'Cyclic' },
              { value: 'life',   label: 'Life' },
              { value: 'smooth', label: 'Smooth' },
            ] },
          { key: 'states', label: 'State Count', type: 'slider',
            min: 3, max: 24, step: 1, fmt: v => Math.round(v),
            showIf: s => s.rule === 'cyclic' },
          { key: 'threshold', label: 'Neighbour Threshold', type: 'slider',
            min: 1, max: 6, step: 1, fmt: v => Math.round(v),
            showIf: s => s.rule === 'cyclic' },
          { key: 'density', label: 'Seed Density', type: 'slider',
            min: 0.05, max: 0.95, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'seed', label: 'Seed', type: 'seed' },
        ],
      },
      {
        title: 'TIME',
        specs: [
          { key: 'rate', label: 'Steps Per Second', type: 'slider',
            min: 1, max: 60, step: 1, fmt: v => Math.round(v) + '/s' },
          { key: 'inject', label: 'Noise Injection', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Off' : Math.round(v * 100) + '%',
            hint: 'Sprinkles live cells in — keeps Life from dying out' },
          { key: 'trail', label: 'Trail', type: 'slider',
            min: 0, max: 0.95, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'LOOK',
        specs: [
          { key: 'cellSize', label: 'Cell Size', type: 'slider',
            min: 4, max: 28, step: 1, fmt: v => v + 'px' },
          { key: 'ramp', label: 'Character Ramp', type: 'select',
            options: G.RAMP_OPTIONS },
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Background', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      const s    = env.state;
      const cell = Math.max(3, s.cellSize);
      env.cell = cell;
      env.cols = Math.max(3, Math.floor(env.w / cell));
      env.rows = Math.max(3, Math.floor(env.h / cell));
      env.offX = (env.w - env.cols * cell) / 2;
      env.offY = (env.h - env.rows * cell) / 2;

      const n = env.cols * env.rows;
      env.cur  = new Uint8Array(n);
      env.next = new Uint8Array(n);
      env.age  = new Float32Array(n);
      env.acc  = 0;
      seedGrid(env);
    },

    pointer: function (env) {
      env.state.seed = (Math.random() * 999998 + 1) | 0;
      seedGrid(env);
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cols = env.cols, rows = env.rows, cell = env.cell;

      // ── Step the automaton on its own clock ────────────────────────────
      env.acc += dt * s.rate;
      let steps = 0;
      while (env.acc >= 1 && steps < 4) { env.acc -= 1; stepRule(env); steps++; }
      if (steps) env.acc = Math.min(env.acc, 1);

      // ── Age each cell for the trail ────────────────────────────────────
      const cur = env.cur, age = env.age;
      const fade = s.trail > 0.02 ? Math.exp(-(1 - s.trail) * 9 * dt) : 0;
      for (let i = 0; i < cur.length; i++) {
        const alive = s.rule === 'cyclic' ? 1 : (cur[i] ? 1 : 0);
        age[i] = alive ? 1 : age[i] * fade;
      }

      // ── Paint ──────────────────────────────────────────────────────────
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, env.w, env.h);

      const ramp   = G.RAMPS[s.ramp] || G.RAMPS.blocks;
      const levels = ramp.length - 1;
      const states = Math.max(2, Math.round(s.states));
      const palKey = s.palette + ':' + levels;
      if (env.palKey !== palKey) {
        env.palKey = palKey;
        env.colors = G.quantizePalette(s.palette, levels);
      }
      const colors = env.colors;

      if (!env.buckets || env.buckets.length !== levels) {
        env.buckets = [];
        for (let i = 0; i < levels; i++) env.buckets.push([]);
      }
      const buckets = env.buckets;
      for (let i = 0; i < levels; i++) buckets[i].length = 0;

      const cyclic = s.rule === 'cyclic';
      for (let i = 0; i < cur.length; i++) {
        const a = age[i];
        if (a < 0.02) continue;
        const t = cyclic ? (cur[i] / states) : a;
        let lv = (t * levels) | 0;
        if (lv >= levels) lv = levels - 1;
        if (lv < 0) lv = 0;
        buckets[lv].push(i);
      }

      ctx.font = Math.round(cell * 1.05) + 'px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const half = cell / 2;
      for (let lv = 0; lv < levels; lv++) {
        const b = buckets[lv];
        if (!b.length) continue;
        ctx.fillStyle = colors[lv];
        const ch = ramp[lv + 1];
        for (let k = 0; k < b.length; k++) {
          const idx = b[k];
          const cx  = idx % cols;
          const cy  = (idx / cols) | 0;
          ctx.fillText(ch, env.offX + cx * cell + half, env.offY + cy * cell + half);
        }
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  function seedGrid(env) {
    const s   = env.state;
    const rng = G.prng(s.seed);
    const cur = env.cur;
    const states = Math.max(2, Math.round(s.states));
    for (let i = 0; i < cur.length; i++) {
      cur[i] = s.rule === 'cyclic'
        ? (rng() * states) | 0
        : (rng() < s.density ? 1 : 0);
    }
    env.age.fill(0);
  }

  function stepRule(env) {
    const s = env.state;
    if (s.rule === 'cyclic')      stepCyclic(env);
    else if (s.rule === 'smooth') stepSmooth(env);
    else                          stepLife(env);

    const t = env.cur; env.cur = env.next; env.next = t;

    // Live noise injection keeps Life and Smooth from stalling
    if (s.inject > 0.005) {
      const cur = env.cur;
      const hits = Math.round(cur.length * s.inject * 0.02);
      const states = Math.max(2, Math.round(s.states));
      for (let i = 0; i < hits; i++) {
        const j = (Math.random() * cur.length) | 0;
        cur[j] = s.rule === 'cyclic' ? (Math.random() * states) | 0 : 1;
      }
    }
  }

  function stepCyclic(env) {
    const cols = env.cols, rows = env.rows;
    const cur = env.cur, next = env.next;
    const states = Math.max(2, Math.round(env.state.states));
    const need   = Math.max(1, Math.round(env.state.threshold));

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i  = y * cols + x;
        const me = cur[i];
        const up = (me + 1) % states;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = (y + dy + rows) % rows;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + cols) % cols;
            if (cur[ny * cols + nx] === up) count++;
          }
        }
        next[i] = count >= need ? up : me;
      }
    }
  }

  function stepLife(env) {
    const cols = env.cols, rows = env.rows;
    const cur = env.cur, next = env.next;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = (y + dy + rows) % rows;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + cols) % cols;
            n += cur[ny * cols + nx] ? 1 : 0;
          }
        }
        const i = y * cols + x;
        next[i] = cur[i] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
  }

  // A coarse stand-in for SmoothLife: blur the neighbourhood, then threshold.
  function stepSmooth(env) {
    const cols = env.cols, rows = env.rows;
    const cur = env.cur, next = env.next;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let inner = 0, outer = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = (y + dy + rows) % rows;
          for (let dx = -2; dx <= 2; dx++) {
            if (!dx && !dy) continue;
            const nx = (x + dx + cols) % cols;
            const v  = cur[ny * cols + nx] ? 1 : 0;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) inner += v; else outer += v;
          }
        }
        const i = y * cols + x;
        const fi = inner / 8, fo = outer / 16;
        next[i] = (fi > 0.35 && fo < 0.6) || (fo > 0.28 && fo < 0.42) ? 1 : 0;
      }
    }
  }
})();
