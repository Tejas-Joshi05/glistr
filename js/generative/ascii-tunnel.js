/* ══ ASCII Tunnel ═════════════════════════════════════════════════════════
   A demoscene tunnel drawn in glyphs: each cell is mapped to polar
   coordinates, depth is 1/r, and a procedural texture is sampled in that
   (angle, depth) space. Scrolling depth pulls the texture toward the viewer.

   Cost is one texture lookup per cell, so it stays cheap even at small cell
   sizes.                                                                    */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name: 'gen-tunnel',
    title: 'ASCII Tunnel',
    hint: 'Click to recentre the tunnel',
    resetKeys: ['cellSize'],

    audioSuggest: [
      { key: 'speed', band: 'bass', amount: 0.5  },
      { key: 'fov',   band: 'beat', amount: 0.4  },
      { key: 'twist', band: 'mid',  amount: 0.3  },
    ],
    defaults: {
      texture:    'checker',
      speed:      0.9,
      twist:      0.35,
      fov:        0.35,
      wobble:     0.4,
      rings:      8,
      spokes:     10,
      falloff:    1.15,
      cellSize:   12,
      ramp:       'ascii',
      palette:    'ice',
      background: '#04050a',
      seed:       77,
    },

    sections: [
      {
        title: 'TUNNEL',
        specs: [
          { key: 'texture', label: 'Wall Texture', type: 'select',
            options: [
              { value: 'checker', label: 'Checker' },
              { value: 'rings',   label: 'Rings' },
              { value: 'spokes',  label: 'Spokes' },
              { value: 'noise',   label: 'Organic Noise' },
              { value: 'grid',    label: 'Wire Grid' },
            ] },
          { key: 'speed', label: 'Travel Speed', type: 'slider',
            min: -3, max: 3, step: 0.05,
            fmt: v => Math.abs(v) < 0.03 ? 'Stopped'
                    : (v > 0 ? 'Forward ' : 'Reverse ') + Math.abs(v).toFixed(2) },
          { key: 'twist', label: 'Twist', type: 'slider',
            min: -2, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'fov', label: 'Field of View', type: 'slider',
            min: 0.08, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'wobble', label: 'Wobble', type: 'slider',
            min: 0, max: 1.5, step: 0.01,
            fmt: v => v < 0.03 ? 'Straight' : v.toFixed(2),
            hint: 'Sways the tunnel centre as you travel' },
        ],
      },
      {
        title: 'TEXTURE',
        specs: [
          { key: 'rings', label: 'Depth Frequency', type: 'slider',
            min: 1, max: 30, step: 1, fmt: v => v },
          { key: 'spokes', label: 'Angular Frequency', type: 'slider',
            min: 2, max: 40, step: 1, fmt: v => v },
          { key: 'falloff', label: 'Depth Falloff', type: 'slider',
            min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2),
            hint: 'How fast the far end fades to black' },
          { key: 'seed', label: 'Texture Seed', type: 'seed' },
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
      env.depth = env.depth || 0;
      env.center = { x: 0.5, y: 0.5 };
      env.buckets = null;
    },

    pointer: function (env, x, y) {
      env.center.x = x / env.w;
      env.center.y = y / env.h;
    },

    draw: function (env, dt) {
      const s    = env.state;
      const ctx  = env.ctx;
      const cell = env.cell;
      const cols = env.cols, rows = env.rows;

      env.depth += s.speed * dt;

      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, env.w, env.h);

      const ramp   = G.RAMPS[s.ramp] || G.RAMPS.ascii;
      const levels = ramp.length - 1;
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

      // Tunnel centre — optionally swaying
      let ccx = env.center.x, ccy = env.center.y;
      if (s.wobble > 0.03) {
        ccx += Math.sin(env.time * 0.7) * 0.09 * s.wobble;
        ccy += Math.cos(env.time * 0.53) * 0.09 * s.wobble;
      }

      const aspect  = cols / rows;
      const depth   = env.depth;
      const twist   = s.twist;
      const fov     = s.fov;
      const ringF   = s.rings;
      const spokeF  = s.spokes;
      const falloff = s.falloff;
      const seed    = s.seed | 0;
      const texture = s.texture;

      for (let cy = 0; cy < rows; cy++) {
        const py = (cy + 0.5) / rows - ccy;
        for (let cx = 0; cx < cols; cx++) {
          const px = ((cx + 0.5) / cols - ccx) * aspect;

          const r = Math.sqrt(px * px + py * py);
          if (r < 0.0025) continue;                  // vanishing point
          const a = Math.atan2(py, px) / (Math.PI * 2) + 0.5;

          const z = fov / r + depth;                 // depth coordinate
          const u = a + twist * z * 0.05;            // angular coordinate

          let v = texValue(texture, u, z, ringF, spokeF, seed);

          // Far end fades out; the mouth stays bright
          const shade = Math.pow(Math.min(1, r * 2.6), falloff);
          v *= shade;

          let lv = (v * levels) | 0;
          if (lv <= 0) continue;
          if (lv >= levels) lv = levels - 1;
          buckets[lv].push(cx, cy);
        }
      }

      ctx.font         = Math.round(cell * 1.05) + 'px ' +
                         '"JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const half = cell / 2;
      for (let lv = 0; lv < levels; lv++) {
        const b = buckets[lv];
        if (!b.length) continue;
        ctx.fillStyle = colors[lv];
        const ch = ramp[lv + 1];
        for (let k = 0; k < b.length; k += 2) {
          ctx.fillText(ch, env.offX + b[k] * cell + half,
                           env.offY + b[k + 1] * cell + half);
        }
      }

      ctx.textAlign    = 'left';
      ctx.textBaseline = 'alphabetic';
    },
  });

  // ── Wall textures — (u = angle 0..1, z = depth) → 0..1 ───────────────────

  function texValue(texture, u, z, ringF, spokeF, seed) {
    switch (texture) {

      case 'rings': {
        return 0.5 + 0.5 * Math.sin(z * ringF * 1.6);
      }

      case 'spokes': {
        return 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * spokeF);
      }

      case 'noise': {
        const n = G.noise2(u * spokeF, z * ringF * 0.4, seed);
        const m = G.noise2(u * spokeF * 2.3, z * ringF * 0.9, seed + 31);
        return n * 0.65 + m * 0.35;
      }

      case 'grid': {
        const gu = Math.abs(((u * spokeF) % 1) - 0.5) * 2;
        const gz = Math.abs(((z * ringF * 0.5) % 1) - 0.5) * 2;
        return Math.max(Math.pow(gu, 6), Math.pow(gz, 6));
      }

      default: { // checker
        const cu = Math.floor(u * spokeF);
        const cz = Math.floor(z * ringF * 0.5);
        const on = ((cu + cz) & 1) === 0;
        // Soften the edges a little so the ramp has midtones to work with
        const fu = Math.abs(((u * spokeF) % 1) - 0.5) * 2;
        return on ? 0.55 + fu * 0.45 : 0.12 + fu * 0.18;
      }
    }
  }
})();
