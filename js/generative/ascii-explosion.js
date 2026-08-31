/* ══ ASCII Explosion ══════════════════════════════════════════════════════
   Particles detonate outward and deposit heat into a character grid. The
   grid cools every frame, so the glyph ramp reads as a fading fireball with
   trailing embers. Click the canvas to detonate at that point.             */

(function () {
  'use strict';

  const G = window.Generative;

  // Ceiling on per-cell heat — the fireball core sits mid-ramp so the glyph
  // ladder stays readable instead of clipping to solid blocks.
  const HEAT_CEIL = 1.35;

  Generative.create({
    name: 'gen-explosion',
    title: 'ASCII Explosion',
    hint: 'Click the canvas to detonate',
    liveSetup: false,
    resetKeys: ['cellSize'],

    audioSuggest: [
      { key: 'force',     band: 'beat', amount: 0.65 },
      { key: 'bloom',     band: 'bass', amount: 0.5  },
      { key: 'particles', band: 'level', amount: 0.35 },
    ],
    defaults: {
      autoBurst:  true,
      interval:   1.6,
      particles:  260,
      force:      560,
      spread:     1,
      gravity:    120,
      drag:       1.7,
      shockwave:  true,
      decay:      2.2,
      bloom:      1.0,
      cellSize:   12,
      ramp:       'blocks',
      palette:    'heat',
      background: '#07080a',
      fade:       0.0,
    },

    sections: [
      {
        title: 'DETONATION',
        specs: [
          { key: 'autoBurst', label: 'Auto Burst', type: 'toggle',
            options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }],
            hint: 'Click the canvas for a burst at any time' },
          { key: 'interval', label: 'Burst Interval', type: 'slider',
            min: 0.2, max: 6, step: 0.1, fmt: v => v.toFixed(1) + 's',
            showIf: s => s.autoBurst },
          { key: 'particles', label: 'Particle Count', type: 'slider',
            min: 20, max: 1200, step: 10, fmt: v => v },
          { key: 'force', label: 'Blast Force', type: 'slider',
            min: 80, max: 1600, step: 10, fmt: v => Math.round(v / 16) + '%' },
          { key: 'spread', label: 'Spread', type: 'slider',
            min: 0.05, max: 1, step: 0.01,
            fmt: v => v < 0.2 ? 'Beam' : v < 0.5 ? 'Cone' : v < 0.85 ? 'Wide' : 'Sphere' },
          { key: 'shockwave', label: 'Shockwave Ring', type: 'toggle',
            options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
        ],
      },
      {
        title: 'PHYSICS',
        specs: [
          { key: 'gravity', label: 'Gravity', type: 'slider',
            min: -300, max: 600, step: 10,
            fmt: v => v === 0 ? 'None' : (v > 0 ? 'Down ' : 'Up ') + Math.abs(v) },
          { key: 'drag', label: 'Air Drag', type: 'slider',
            min: 0.1, max: 5, step: 0.05, fmt: v => v.toFixed(2) },
          { key: 'decay', label: 'Cooling Rate', type: 'slider',
            min: 0.3, max: 8, step: 0.1,
            fmt: v => v < 1 ? 'Long trail' : v < 3 ? 'Medium' : 'Snappy' },
          { key: 'bloom', label: 'Heat Bloom', type: 'slider',
            min: 0, max: 2.5, step: 0.05, fmt: v => v.toFixed(2) },
        ],
      },
      {
        title: 'GLYPHS',
        specs: [
          { key: 'ramp', label: 'Character Ramp', type: 'select',
            options: G.RAMP_OPTIONS },
          { key: 'cellSize', label: 'Cell Size', type: 'slider',
            min: 6, max: 28, step: 1, fmt: v => v + 'px' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Background', type: 'color' },
          { key: 'fade', label: 'Frame Persistence', type: 'slider',
            min: 0, max: 0.9, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%',
            hint: 'Leaves previous frames smeared behind the blast' },
        ],
      },
    ],

    setup: function (env) {
      const s    = env.state;
      const cell = Math.max(4, s.cellSize);
      env.cell   = cell;
      env.cols   = Math.max(1, Math.floor(env.w / cell));
      env.rows   = Math.max(1, Math.floor(env.h / cell));
      // Centre the grid in whatever space is left over
      env.offX   = (env.w - env.cols * cell) / 2;
      env.offY   = (env.h - env.rows * cell) / 2;
      env.heat   = new Float32Array(env.cols * env.rows);
      env.parts  = env.parts || [];
      env.parts.length = 0;
      env.waves  = [];
      env.nextBurst = 0.25;
      // Bucket lists — one per glyph level, reused every frame
      env.buckets = null;
    },

    pointer: function (env, x, y) {
      burst(env, x, y);
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cols = env.cols, rows = env.rows, cell = env.cell;
      const heat = env.heat;

      // ── Spawn ──────────────────────────────────────────────────────────
      if (dt > 0 && s.autoBurst) {
        env.nextBurst -= dt;
        if (env.nextBurst <= 0) {
          env.nextBurst = s.interval;
          burst(env,
            env.w * (0.25 + Math.random() * 0.5),
            env.h * (0.25 + Math.random() * 0.5));
        }
      }

      // ── Cool the grid ──────────────────────────────────────────────────
      const cool = Math.exp(-s.decay * dt);
      if (dt > 0) for (let i = 0; i < heat.length; i++) heat[i] *= cool;

      // ── Advance particles, depositing heat ─────────────────────────────
      const parts = env.parts;
      const grav  = s.gravity;
      const dragF = Math.exp(-s.drag * dt);
      const bloom = s.bloom;

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (dt > 0) {
          p.vx *= dragF;
          p.vy = p.vy * dragF + grav * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * p.decay;
        }
        if (p.life <= 0 || p.x < -cell || p.y < -cell || p.x > env.w + cell || p.y > env.h + cell) {
          parts[i] = parts[parts.length - 1];
          parts.pop();
          continue;
        }
        const cx = ((p.x - env.offX) / cell) | 0;
        const cy = ((p.y - env.offY) / cell) | 0;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;

        const amount = p.life * p.heat * dt * 9;
        const ci = cy * cols + cx;
        heat[ci] += amount;
        if (heat[ci] > HEAT_CEIL) heat[ci] = HEAT_CEIL;

        // Bloom spills a fraction into the 4-neighbourhood
        if (bloom > 0) {
          const b = amount * bloom * 0.28;
          if (cx > 0)        heat[ci - 1]    = Math.min(HEAT_CEIL, heat[ci - 1] + b);
          if (cx < cols - 1) heat[ci + 1]    = Math.min(HEAT_CEIL, heat[ci + 1] + b);
          if (cy > 0)        heat[ci - cols] = Math.min(HEAT_CEIL, heat[ci - cols] + b);
          if (cy < rows - 1) heat[ci + cols] = Math.min(HEAT_CEIL, heat[ci + cols] + b);
        }
      }

      // ── Shockwave rings ────────────────────────────────────────────────
      const waves = env.waves;
      for (let i = waves.length - 1; i >= 0; i--) {
        const wv = waves[i];
        if (dt > 0) { wv.r += wv.speed * dt; wv.life -= dt * 1.5; }
        if (wv.life <= 0) { waves.splice(i, 1); continue; }

        const rCells = wv.r / cell;
        const steps  = Math.max(12, Math.round(rCells * 7));
        const amp    = wv.life * 0.75;
        for (let k = 0; k < steps; k++) {
          const a  = (k / steps) * Math.PI * 2;
          const cx = ((wv.x + Math.cos(a) * wv.r - env.offX) / cell) | 0;
          const cy = ((wv.y + Math.sin(a) * wv.r - env.offY) / cell) | 0;
          if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
          const wi = cy * cols + cx;
          heat[wi] = Math.min(HEAT_CEIL, heat[wi] + amp * dt * 6);
        }
      }

      // ── Paint ──────────────────────────────────────────────────────────
      if (s.fade > 0.02) {
        ctx.globalAlpha = 1 - s.fade;
        ctx.fillStyle   = s.background;
        ctx.fillRect(0, 0, env.w, env.h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = s.background;
        ctx.fillRect(0, 0, env.w, env.h);
      }

      const ramp   = G.RAMPS[s.ramp] || G.RAMPS.blocks;
      const levels = ramp.length - 1;                   // level 0 = empty cell

      // Colors only change when the palette or ramp length does
      const palKey = s.palette + ':' + levels;
      if (env.palKey !== palKey) {
        env.palKey  = palKey;
        env.colors  = G.quantizePalette(s.palette, levels);
      }
      const colors = env.colors;

      if (!env.buckets || env.buckets.length !== levels) {
        env.buckets = [];
        for (let i = 0; i < levels; i++) env.buckets.push([]);
      }
      const buckets = env.buckets;
      for (let i = 0; i < levels; i++) buckets[i].length = 0;

      // Reinhard tone map: heat piles up fast near the core, so compress it
      // instead of clipping every central cell to the top glyph.
      // A little per-cell jitter breaks the saturated core into a moving
      // dithered texture instead of one flat slab of the brightest glyph.
      const exposure = 0.9;
      for (let i = 0; i < heat.length; i++) {
        const v = heat[i];
        if (v < 0.03) continue;
        const tm = 1 - Math.exp(-v * exposure) + (Math.random() - 0.5) * 0.22;
        let lv = (tm * levels) | 0;
        if (lv < 0) lv = 0;
        if (lv >= levels) lv = levels - 1;
        buckets[lv].push(i);
      }

      ctx.font         = Math.round(cell * 1.05) + 'px ' +
                         '"JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const halfCell = cell / 2;
      for (let lv = 0; lv < levels; lv++) {
        const list = buckets[lv];
        if (!list.length) continue;
        ctx.fillStyle = colors[lv];
        const ch = ramp[lv + 1];
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          const cx  = idx % cols;
          const cy  = (idx / cols) | 0;
          ctx.fillText(ch, env.offX + cx * cell + halfCell,
                           env.offY + cy * cell + halfCell);
        }
      }

      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  // ── Burst ────────────────────────────────────────────────────────────────

  function burst(env, x, y) {
    const s     = env.state;
    const count = Math.round(s.particles);
    const parts = env.parts;

    for (let i = 0; i < count; i++) {
      // Bias the angle toward a cone when spread is low
      const a = Math.random() * Math.PI * 2;
      const speed = s.force * (0.15 + Math.pow(Math.random(), 0.6) * 0.95);
      const squash = 1 - (1 - s.spread) * Math.abs(Math.sin(a));
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * speed * squash,
        vy: Math.sin(a) * speed,
        life:  0.6 + Math.random() * 0.9,
        decay: 0.5 + Math.random() * 0.8,
        heat:  0.5 + Math.random() * 0.9,
      });
    }

    if (s.shockwave) {
      env.waves.push({ x: x, y: y, r: env.cell, speed: s.force * 1.15, life: 1 });
    }

    // Cap the population so a mash of clicks can't grind the frame rate down
    const MAX = 6000;
    if (parts.length > MAX) parts.splice(0, parts.length - MAX);
  }
})();
