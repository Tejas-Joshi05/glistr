/* ══ Dither Field ═════════════════════════════════════════════════════════
   An animated scalar field (plasma, rings, metaballs, noise, moiré) pushed
   through an ordered Bayer dither and quantised to a handful of levels, then
   blown up with nearest-neighbour scaling for chunky duotone coverage.

   The field is computed at cell resolution into an ImageData and scaled up in
   one drawImage, so cost tracks the cell grid rather than the output size.  */

(function () {
  'use strict';

  const G = window.Generative;

  // ── Bayer threshold matrices, normalised to 0..1 ─────────────────────────

  const BAYER = {
    2: { size: 2, m: Float32Array.from([0, 2, 3, 1], v => (v + 0.5) / 4) },
    4: { size: 4, m: Float32Array.from(
           [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
           v => (v + 0.5) / 16) },
    8: { size: 8, m: Float32Array.from(
           [ 0, 32,  8, 40,  2, 34, 10, 42,
            48, 16, 56, 24, 50, 18, 58, 26,
            12, 44,  4, 36, 14, 46,  6, 38,
            60, 28, 52, 20, 62, 30, 54, 22,
             3, 35, 11, 43,  1, 33,  9, 41,
            51, 19, 59, 27, 49, 17, 57, 25,
            15, 47,  7, 39, 13, 45,  5, 37,
            63, 31, 55, 23, 61, 29, 53, 21],
           v => (v + 0.5) / 64) },
  };

  Generative.create({
    name: 'gen-dither',
    title: 'Dither Field',
    hint: 'Click to re-roll the field',
    resetKeys: ['pixelSize', 'seed'],

    audioSuggest: [
      { key: 'contrast', band: 'bass', amount: 0.5  },
      { key: 'scale',    band: 'mid',  amount: 0.25 },
      { key: 'bias',     band: 'beat', amount: 0.4  },
    ],
    defaults: {
      pattern:   'plasma',
      speed:     0.5,
      scale:     3.2,
      warp:      0.45,
      levels:    2,
      matrix:    '8',
      pixelSize: 5,
      contrast:  1.15,
      bias:      0,
      ink:       '#e8ff70',
      paper:     '#0a0b0d',
      duotone:   true,
      palette:   'violet',
      seed:      2024,
    },

    sections: [
      {
        title: 'FIELD',
        specs: [
          { key: 'pattern', label: 'Pattern', type: 'select',
            options: [
              { value: 'plasma',    label: 'Plasma' },
              { value: 'rings',     label: 'Rings' },
              { value: 'metaballs', label: 'Metaballs' },
              { value: 'noise',     label: 'Drifting Noise' },
              { value: 'moire',     label: 'Moiré' },
              { value: 'spiral',    label: 'Spiral' },
            ] },
          { key: 'speed', label: 'Animation Speed', type: 'slider',
            min: 0, max: 3, step: 0.01,
            fmt: v => v < 0.02 ? 'Still' : v.toFixed(2) + '×' },
          { key: 'scale', label: 'Scale', type: 'slider',
            min: 0.4, max: 12, step: 0.1, fmt: v => v.toFixed(1) },
          { key: 'warp', label: 'Turbulence', type: 'slider',
            min: 0, max: 1.5, step: 0.01,
            fmt: v => v < 0.03 ? 'Clean' : v.toFixed(2) },
          { key: 'seed', label: 'Field Seed', type: 'seed' },
        ],
      },
      {
        title: 'DITHER',
        specs: [
          { key: 'matrix', label: 'Bayer Matrix', type: 'toggle',
            options: [
              { value: '2', label: '2×2' },
              { value: '4', label: '4×4' },
              { value: '8', label: '8×8' },
              { value: 'off', label: 'Off' },
            ] },
          { key: 'levels', label: 'Tone Levels', type: 'slider',
            min: 2, max: 8, step: 1, fmt: v => v + ' tones' },
          { key: 'pixelSize', label: 'Pixel Size', type: 'slider',
            min: 1, max: 16, step: 1, fmt: v => v + 'px' },
          { key: 'contrast', label: 'Contrast', type: 'slider',
            min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) + '×' },
          { key: 'bias', label: 'Exposure', type: 'slider',
            min: -0.5, max: 0.5, step: 0.01,
            fmt: v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'duotone', label: 'Color Mode', type: 'toggle',
            options: [
              { value: true,  label: 'Duotone' },
              { value: false, label: 'Palette' },
            ] },
          { key: 'ink',   label: 'Ink',   type: 'color', showIf: s => s.duotone },
          { key: 'paper', label: 'Paper', type: 'color', showIf: s => s.duotone },
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS, showIf: s => !s.duotone },
        ],
      },
    ],

    setup: setupField,

    pointer: function (env) {
      env.state.seed = (Math.random() * 999998 + 1) | 0;
      setupField(env);
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const gw  = env.gw, gh = env.gh;
      const t   = env.time * s.speed;

      const data = env.imgData.data;
      const bay  = BAYER[s.matrix];
      const bm   = bay ? bay.m : null;
      const bs   = bay ? bay.size : 1;

      const levels = Math.max(2, Math.round(s.levels));
      const steps  = levels - 1;

      // Colour lookup for each output level
      const key = s.duotone
        ? 'd:' + s.ink + s.paper + levels
        : 'p:' + s.palette + levels;
      if (env.lutKey !== key) {
        env.lutKey = key;
        env.lut    = new Uint8Array(levels * 3);
        for (let i = 0; i < levels; i++) {
          const k = levels === 1 ? 1 : i / (levels - 1);
          let c;
          if (s.duotone) {
            const a = G.hexToRgb(s.paper), b = G.hexToRgb(s.ink);
            c = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          } else {
            c = G.rampAt(G.PALETTES[s.palette] || G.PALETTES.violet, k);
          }
          env.lut[i * 3]     = c[0];
          env.lut[i * 3 + 1] = c[1];
          env.lut[i * 3 + 2] = c[2];
        }
      }
      const lut = env.lut;

      const scale    = s.scale;
      const warp     = s.warp;
      const contrast = s.contrast;
      const bias     = s.bias;
      const seed     = s.seed | 0;
      const invW     = 1 / gw, invH = 1 / gh;
      const aspect   = gw / gh;

      // Metaball positions for this frame
      const balls = env.balls;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        b.cx = 0.5 + Math.sin(t * b.ax + b.px) * 0.34;
        b.cy = 0.5 + Math.cos(t * b.ay + b.py) * 0.34;
      }

      let o = 0;
      for (let gy = 0; gy < gh; gy++) {
        const v = gy * invH;
        for (let gx = 0; gx < gw; gx++) {
          const u = gx * invW;
          let f = fieldValue(s.pattern, u, v, t, scale, warp, seed, aspect, balls);

          // Contrast around mid grey, then exposure
          f = (f - 0.5) * contrast + 0.5 + bias;
          if (f < 0) f = 0; else if (f > 1) f = 1;

          // Ordered dither: nudge by the matrix, then quantise
          let q;
          if (bm) {
            const th = bm[(gy % bs) * bs + (gx % bs)];
            q = Math.round(f * steps + (th - 0.5));
          } else {
            q = Math.round(f * steps);
          }
          if (q < 0) q = 0; else if (q > steps) q = steps;

          const li = q * 3;
          data[o]     = lut[li];
          data[o + 1] = lut[li + 1];
          data[o + 2] = lut[li + 2];
          data[o + 3] = 255;
          o += 4;
        }
      }

      env.bufCtx.putImageData(env.imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(env.buf, 0, 0, gw, gh, 0, 0, env.w, env.h);
    },
  });

  // ── Setup ────────────────────────────────────────────────────────────────

  function setupField(env) {
    const s = env.state;
    const p = Math.max(1, Math.round(s.pixelSize));
    env.px = p;
    env.gw = Math.max(1, Math.ceil(env.w / p));
    env.gh = Math.max(1, Math.ceil(env.h / p));

    env.buf        = document.createElement('canvas');
    env.buf.width  = env.gw;
    env.buf.height = env.gh;
    env.bufCtx     = env.buf.getContext('2d');
    env.imgData    = env.bufCtx.createImageData(env.gw, env.gh);

    // Metaball centres — deterministic from the seed
    const rng = G.prng(s.seed);
    env.balls = [];
    for (let i = 0; i < 5; i++) {
      env.balls.push({
        ax: 0.15 + rng() * 0.55, ay: 0.15 + rng() * 0.55,
        px: rng() * Math.PI * 2, py: rng() * Math.PI * 2,
        r:  0.10 + rng() * 0.16,
        cx: 0.5, cy: 0.5,
      });
    }
  }

  // ── Field patterns — all return roughly 0..1 ─────────────────────────────

  function fieldValue(pattern, u, v, t, scale, warp, seed, aspect, balls) {
    const x = (u - 0.5) * aspect;
    const y = (v - 0.5);

    // Shared turbulence offset
    let wx = 0, wy = 0;
    if (warp > 0.03) {
      wx = (G.noise2(u * scale * 0.7 + t * 0.21, v * scale * 0.7, seed) - 0.5) * warp;
      wy = (G.noise2(u * scale * 0.7, v * scale * 0.7 - t * 0.19, seed + 77) - 0.5) * warp;
    }

    switch (pattern) {

      case 'rings': {
        const dx = x + wx, dy = y + wy;
        const r  = Math.sqrt(dx * dx + dy * dy);
        return 0.5 + 0.5 * Math.sin(r * scale * 9 - t * 3);
      }

      case 'metaballs': {
        let sum = 0;
        for (let i = 0; i < balls.length; i++) {
          const b  = balls[i];
          const dx = (u + wx) - b.cx, dy = (v + wy) - b.cy;
          const d2 = dx * dx + dy * dy + 0.0004;
          sum += (b.r * b.r) / d2;
        }
        return 1 - 1 / (1 + sum * 0.9);
      }

      case 'noise': {
        const n1 = G.noise2((u + wx) * scale * 2 + t * 0.5, (v + wy) * scale * 2, seed);
        const n2 = G.noise2((u + wx) * scale * 4 - t * 0.3, (v + wy) * scale * 4, seed + 13);
        const n3 = G.noise2((u + wx) * scale * 8, (v + wy) * scale * 8 + t * 0.7, seed + 29);
        return n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
      }

      case 'moire': {
        const dx = x + wx, dy = y + wy;
        const a = Math.sin((dx * scale * 14) + t * 1.7);
        const b = Math.sin((dy * scale * 14) - t * 1.3);
        const c = Math.sin((dx + dy) * scale * 10 + t);
        return 0.5 + (a * b * 0.35 + c * 0.15);
      }

      case 'spiral': {
        const dx = x + wx, dy = y + wy;
        const r  = Math.sqrt(dx * dx + dy * dy);
        const a  = Math.atan2(dy, dx);
        return 0.5 + 0.5 * Math.sin(a * 3 + r * scale * 12 - t * 2.4);
      }

      default: { // plasma
        const dx = (u + wx) * scale, dy = (v + wy) * scale;
        const s1 = Math.sin(dx * 3.1 + t * 1.1);
        const s2 = Math.sin(dy * 2.7 - t * 0.9);
        const s3 = Math.sin((dx + dy) * 2.2 + t * 1.7);
        const s4 = Math.sin(Math.sqrt((dx - scale * 0.5) * (dx - scale * 0.5) +
                                      (dy - scale * 0.5) * (dy - scale * 0.5)) * 4 - t * 2);
        return 0.5 + (s1 + s2 + s3 + s4) * 0.125;
      }
    }
  }
})();
