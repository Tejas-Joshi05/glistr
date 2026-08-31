/* ══ Voronoi Shatter ══════════════════════════════════════════════════════
   Moving sites carve the frame into cells; each cell gets its own tone and
   its own dither pattern, and cell edges flash on the beat.

   The diagram is computed per block at a reduced resolution into an
   ImageData and scaled up, so cost tracks the block grid, not the canvas.  */

(function () {
  'use strict';

  const G = window.Generative;

  const BAYER4 = Float32Array.from(
    [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], v => (v + 0.5) / 16);

  Generative.create({
    name:  'gen-voronoi',
    title: 'Voronoi Shatter',
    hint:  'Click to scatter the sites',
    resetKeys: ['sites', 'blockSize', 'seed'],

    audioSuggest: [
      { key: 'edgeFlash', band: 'beat', amount: 0.7 },
      { key: 'drift',     band: 'bass', amount: 0.5 },
      { key: 'shatter',   band: 'mid',  amount: 0.3 },
    ],

    defaults: {
      sites:      26,
      drift:      0.35,
      swirl:      0.3,
      metric:     'euclid',
      shatter:    0,
      edges:      1.4,
      edgeFlash:  0.5,
      dither:     true,
      levels:     4,
      blockSize:  4,
      palette:    'ember',
      background: '#07060a',
      seed:       404,
    },

    sections: [
      {
        title: 'CELLS',
        specs: [
          { key: 'sites', label: 'Site Count', type: 'slider',
            min: 3, max: 120, step: 1, fmt: v => Math.round(v) },
          { key: 'metric', label: 'Distance', type: 'toggle',
            options: [
              { value: 'euclid', label: 'Round' },
              { value: 'manhat', label: 'Boxy' },
              { value: 'cheby',  label: 'Square' },
            ] },
          { key: 'drift', label: 'Drift Speed', type: 'slider',
            min: 0, max: 2, step: 0.01,
            fmt: v => v < 0.02 ? 'Still' : v.toFixed(2) },
          { key: 'swirl', label: 'Swirl', type: 'slider',
            min: 0, max: 1.5, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'shatter', label: 'Shatter Offset', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Aligned' : Math.round(v * 100) + '%',
            hint: 'Slides each cell off its true position' },
          { key: 'seed', label: 'Seed', type: 'seed' },
        ],
      },
      {
        title: 'EDGES',
        specs: [
          { key: 'edges', label: 'Edge Weight', type: 'slider',
            min: 0, max: 6, step: 0.1,
            fmt: v => v < 0.05 ? 'None' : v.toFixed(1) },
          { key: 'edgeFlash', label: 'Edge Flash', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%',
            hint: 'Lights the edges on each kick' },
        ],
      },
      {
        title: 'FILL',
        specs: [
          { key: 'dither', label: 'Cell Fill', type: 'toggle',
            options: [
              { value: true,  label: 'Dithered' },
              { value: false, label: 'Flat' },
            ] },
          { key: 'levels', label: 'Tone Levels', type: 'slider',
            min: 2, max: 8, step: 1, fmt: v => Math.round(v) + ' tones' },
          { key: 'blockSize', label: 'Pixel Size', type: 'slider',
            min: 2, max: 14, step: 1, fmt: v => v + 'px' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Edge Color', type: 'color' },
        ],
      },
    ],

    setup: setupVoronoi,

    pointer: function (env) {
      env.state.seed = (Math.random() * 999998 + 1) | 0;
      setupVoronoi(env);
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const gw  = env.gw, gh = env.gh;
      const t   = env.time;

      const n     = Math.min(env.sx.length, Math.max(3, Math.round(s.sites)));
      const sx = env.sx, sy = env.sy, tone = env.tone;
      const px = env.px, py = env.py;

      // ── Move the sites ─────────────────────────────────────────────────
      for (let i = 0; i < n; i++) {
        const a = t * s.drift * env.spd[i] + env.phase[i];
        const swirl = s.swirl * 0.22;
        px[i] = sx[i] + Math.cos(a) * swirl + Math.sin(a * 0.7) * swirl * 0.5;
        py[i] = sy[i] + Math.sin(a * 1.1) * swirl + Math.cos(a * 0.6) * swirl * 0.5;
      }

      // ── Rasterise the diagram ──────────────────────────────────────────
      const data   = env.imgData.data;
      const levels = Math.max(2, Math.round(s.levels));
      const key    = s.palette + ':' + levels;
      if (env.lutKey !== key) {
        env.lutKey = key;
        env.lut = new Uint8Array(levels * 3);
        const stops = G.PALETTES[s.palette] || G.PALETTES.ember;
        for (let i = 0; i < levels; i++) {
          const c = G.rampAt(stops, levels === 1 ? 1 : i / (levels - 1));
          env.lut[i*3] = c[0]; env.lut[i*3+1] = c[1]; env.lut[i*3+2] = c[2];
        }
      }
      const lut = env.lut;

      const edgeRGB = G.hexToRgb(s.background);
      const flash   = env.audio ? env.audio.beat * s.edgeFlash : 0;
      const eR = Math.min(255, edgeRGB[0] + flash * 220) | 0;
      const eG = Math.min(255, edgeRGB[1] + flash * 220) | 0;
      const eB = Math.min(255, edgeRGB[2] + flash * 220) | 0;

      const metric  = s.metric;
      const invW    = 1 / gw, invH = 1 / gh;
      const aspect  = gw / gh;
      const edgeW   = s.edges * 0.004;
      const shatter = s.shatter;
      const steps   = levels - 1;

      let o = 0;
      for (let gy = 0; gy < gh; gy++) {
        const v = gy * invH;
        for (let gx = 0; gx < gw; gx++) {
          let u = gx * invW;

          // Nearest and second-nearest site — their gap gives the edge
          let best = 1e9, second = 1e9, bi = 0;
          for (let i = 0; i < n; i++) {
            const dx = (u - px[i]) * aspect, dy = v - py[i];
            let d;
            if (metric === 'manhat')     d = Math.abs(dx) + Math.abs(dy);
            else if (metric === 'cheby') d = Math.max(Math.abs(dx), Math.abs(dy));
            else                         d = dx * dx + dy * dy;
            if (d < best) { second = best; best = d; bi = i; }
            else if (d < second) { second = d; }
          }

          const isEuclid = metric === 'euclid';
          const b = isEuclid ? Math.sqrt(best) : best;
          const c = isEuclid ? Math.sqrt(second) : second;

          if (edgeW > 0 && (c - b) < edgeW) {
            data[o] = eR; data[o+1] = eG; data[o+2] = eB; data[o+3] = 255;
            o += 4;
            continue;
          }

          // Cell tone, optionally shaded by distance and dithered
          let f = tone[bi];
          if (shatter > 0.01) f = (f + shatter * (px[bi] + py[bi])) % 1;
          f = f * 0.72 + (1 - Math.min(1, b * 3.4)) * 0.28;

          let q;
          if (s.dither) {
            const th = BAYER4[(gy & 3) * 4 + (gx & 3)];
            q = Math.round(f * steps + (th - 0.5));
          } else {
            q = Math.round(f * steps);
          }
          if (q < 0) q = 0; else if (q > steps) q = steps;

          const li = q * 3;
          data[o] = lut[li]; data[o+1] = lut[li+1]; data[o+2] = lut[li+2]; data[o+3] = 255;
          o += 4;
        }
      }

      env.bufCtx.putImageData(env.imgData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(env.buf, 0, 0, gw, gh, 0, 0, env.w, env.h);
    },
  });

  function setupVoronoi(env) {
    const s = env.state;
    const p = Math.max(2, Math.round(s.blockSize));
    env.gw = Math.max(8, Math.ceil(env.w / p));
    env.gh = Math.max(8, Math.ceil(env.h / p));

    env.buf = document.createElement('canvas');
    env.buf.width = env.gw; env.buf.height = env.gh;
    env.bufCtx  = env.buf.getContext('2d');
    env.imgData = env.bufCtx.createImageData(env.gw, env.gh);

    const max = 120;
    const rng = G.prng(s.seed);
    env.sx = new Float32Array(max); env.sy = new Float32Array(max);
    env.px = new Float32Array(max); env.py = new Float32Array(max);
    env.tone = new Float32Array(max);
    env.spd = new Float32Array(max); env.phase = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      env.sx[i] = rng(); env.sy[i] = rng();
      env.tone[i] = rng();
      env.spd[i] = 0.4 + rng() * 1.4;
      env.phase[i] = rng() * Math.PI * 2;
    }
  }
})();
