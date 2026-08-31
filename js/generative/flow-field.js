/* ══ Particle Flow Field ══════════════════════════════════════════════════
   Thousands of particles advected through an evolving noise field. Trails
   come from painting the background at partial opacity each frame rather
   than clearing it, so nothing has to be stored per trail.

   Particles are held in flat Float32Arrays and drawn in colour buckets, so
   a few thousand of them still hold 60fps.                                  */

(function () {
  'use strict';

  const G = window.Generative;

  const COLOR_LEVELS = 12;

  Generative.create({
    name: 'gen-flow',
    title: 'Flow Field',
    hint: 'Click to blow the particles outward',
    resetKeys: ['count', 'seed'],

    audioSuggest: [
      { key: 'turbulence', value: 1.4 },
      { key: 'speed',      band: 'bass', amount: 0.5 },
      { key: 'curl',       band: 'mid',  amount: 0.35 },
    ],
    defaults: {
      count:      2600,
      speed:      64,
      fieldScale: 2.6,
      evolve:     0.22,
      curl:       0.55,
      inertia:    0.82,
      persist:    0.88,
      mode:       'line',
      size:       1.6,
      colorBy:    'speed',
      palette:    'ice',
      background: '#05060a',
      ramp:       'dots',
      respawn:    0.6,
      turbulence: 0.9,
      seed:       7331,
    },

    sections: [
      {
        title: 'FIELD',
        specs: [
          { key: 'speed', label: 'Flow Speed', type: 'slider',
            min: 5, max: 300, step: 1, fmt: v => Math.round(v) + ' px/s' },
          { key: 'fieldScale', label: 'Field Scale', type: 'slider',
            min: 0.3, max: 10, step: 0.1, fmt: v => v.toFixed(1),
            hint: 'Smaller = long sweeping currents' },
          { key: 'evolve', label: 'Field Drift', type: 'slider',
            min: 0, max: 2, step: 0.01,
            fmt: v => v < 0.02 ? 'Frozen' : v.toFixed(2) },
          { key: 'curl', label: 'Curl', type: 'slider',
            min: 0, max: 2, step: 0.01, fmt: v => v.toFixed(2),
            hint: 'Rotates the field into vortices' },
          { key: 'turbulence', label: 'Beat Turbulence', type: 'slider',
            min: 0, max: 4, step: 0.05,
            fmt: v => v < 0.03 ? 'Off' : v.toFixed(2),
            hint: 'Kicks scatter the flow — needs an audio source' },
          { key: 'seed', label: 'Field Seed', type: 'seed' },
        ],
      },
      {
        title: 'PARTICLES',
        specs: [
          { key: 'count', label: 'Particle Count', type: 'slider',
            min: 100, max: 12000, step: 100, fmt: v => Math.round(v) },
          { key: 'inertia', label: 'Inertia', type: 'slider',
            min: 0, max: 0.98, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'respawn', label: 'Respawn Rate', type: 'slider',
            min: 0, max: 3, step: 0.01,
            fmt: v => v < 0.02 ? 'Never' : v.toFixed(2) + '/s',
            hint: 'Recycles particles so the field keeps renewing' },
        ],
      },
      {
        title: 'RENDER',
        specs: [
          { key: 'mode', label: 'Mark', type: 'select',
            options: [
              { value: 'line',  label: 'Streak' },
              { value: 'dot',   label: 'Dot' },
              { value: 'glyph', label: 'Glyph' },
            ] },
          { key: 'ramp', label: 'Character Ramp', type: 'select',
            options: G.RAMP_OPTIONS, showIf: s => s.mode === 'glyph' },
          { key: 'size', label: 'Mark Size', type: 'slider',
            min: 0.4, max: 12, step: 0.1, fmt: v => v.toFixed(1) },
          { key: 'persist', label: 'Trail Persistence', type: 'slider',
            min: 0, max: 0.985, step: 0.005,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'colorBy', label: 'Color By', type: 'toggle',
            options: [
              { value: 'speed', label: 'Speed' },
              { value: 'angle', label: 'Direction' },
              { value: 'age',   label: 'Age' },
            ] },
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Background', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      const s = env.state;
      const n = Math.max(1, Math.round(s.count));
      const rng = G.prng(s.seed);

      env.n   = n;
      env.px  = new Float32Array(n);
      env.py  = new Float32Array(n);
      env.pvx = new Float32Array(n);
      env.pvy = new Float32Array(n);
      env.age = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        env.px[i]  = rng() * env.w;
        env.py[i]  = rng() * env.h;
        env.age[i] = rng();
      }

      env.buckets = null;
      env.kick    = 0;
    },

    pointer: function (env, x, y) {
      // Radial impulse from the click point
      const n = env.n;
      for (let i = 0; i < n; i++) {
        const dx = env.px[i] - x, dy = env.py[i] - y;
        const d  = Math.sqrt(dx * dx + dy * dy) + 1;
        const f  = Math.min(600, 26000 / d);
        env.pvx[i] += (dx / d) * f;
        env.pvy[i] += (dy / d) * f;
      }
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const w   = env.w, h = env.h;
      const n   = env.n;

      // ── Trails ─────────────────────────────────────────────────────────
      if (s.persist > 0.02) {
        ctx.globalAlpha = 1 - s.persist;
        ctx.fillStyle   = s.background;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = s.background;
        ctx.fillRect(0, 0, w, h);
      }

      // Beat turbulence — a decaying scatter added to the field
      if (env.audio && s.turbulence > 0.03) {
        env.kick = Math.max(env.kick * Math.exp(-5 * dt), env.audio.beat * s.turbulence);
      } else {
        env.kick = 0;
      }

      const palKey = s.palette + ':' + COLOR_LEVELS;
      if (env.palKey !== palKey) {
        env.palKey = palKey;
        env.colors = G.quantizePalette(s.palette, COLOR_LEVELS);
      }
      const colors = env.colors;

      if (!env.buckets || env.buckets.length !== COLOR_LEVELS) {
        env.buckets = [];
        for (let i = 0; i < COLOR_LEVELS; i++) env.buckets.push([]);
      }
      const buckets = env.buckets;
      for (let i = 0; i < COLOR_LEVELS; i++) buckets[i].length = 0;

      // ── Advect ─────────────────────────────────────────────────────────
      const px = env.px, py = env.py, pvx = env.pvx, pvy = env.pvy, age = env.age;
      const fs      = s.fieldScale / Math.max(w, h) * 6;
      const t       = env.time * s.evolve;
      const seed    = s.seed | 0;
      const speed   = s.speed * (1 + env.kick * 0.9);
      const inertia = Math.pow(s.inertia, dt * 60);
      const curl    = s.curl;
      const respawn = s.respawn * dt;
      const maxV    = 900;

      for (let i = 0; i < n; i++) {
        const x = px[i], y = py[i];

        // Angle from the noise field, rotated by curl
        const nz = G.noise2(x * fs + t, y * fs - t * 0.6, seed);
        let ang  = nz * Math.PI * 4 + curl * Math.PI * 0.5;
        if (env.kick > 0.01) ang += (G.noise2(x * fs * 4, y * fs * 4, seed + 5) - 0.5) * env.kick * 6;

        const tx = Math.cos(ang) * speed;
        const ty = Math.sin(ang) * speed;

        let vx = pvx[i] * inertia + tx * (1 - inertia);
        let vy = pvy[i] * inertia + ty * (1 - inertia);
        if (vx > maxV) vx = maxV; else if (vx < -maxV) vx = -maxV;
        if (vy > maxV) vy = maxV; else if (vy < -maxV) vy = -maxV;

        const nx = x + vx * dt;
        const ny = y + vy * dt;

        pvx[i] = vx; pvy[i] = vy;
        age[i] += dt * 0.35;

        // Wrap at the edges, and recycle a slice of the population
        let ox = nx, oy = ny, wrapped = false;
        if (nx < 0)      { ox = w; wrapped = true; }
        else if (nx > w) { ox = 0; wrapped = true; }
        if (ny < 0)      { oy = h; wrapped = true; }
        else if (ny > h) { oy = 0; wrapped = true; }

        if (!wrapped && respawn > 0 && Math.random() < respawn * 0.02) {
          ox = Math.random() * w; oy = Math.random() * h;
          pvx[i] = pvy[i] = 0; age[i] = 0;
          wrapped = true;
        }

        px[i] = ox; py[i] = oy;

        if (wrapped) continue;             // don't streak across the wrap seam

        // Colour level
        let k;
        if (s.colorBy === 'angle')    k = (ang / (Math.PI * 2)) % 1;
        else if (s.colorBy === 'age') k = age[i] % 1;
        else                          k = Math.min(1, Math.sqrt(vx * vx + vy * vy) / (speed * 1.6));
        if (k < 0) k += 1;
        let lv = (k * COLOR_LEVELS) | 0;
        if (lv >= COLOR_LEVELS) lv = COLOR_LEVELS - 1;

        const b = buckets[lv];
        b.push(x, y, nx, ny);
      }

      // ── Draw ───────────────────────────────────────────────────────────
      const mode = s.mode;
      const size = s.size;

      if (mode === 'glyph') {
        const ramp = G.RAMPS[s.ramp] || G.RAMPS.dots;
        ctx.font = Math.round(size * 5) + 'px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let lv = 0; lv < COLOR_LEVELS; lv++) {
          const b = buckets[lv];
          if (!b.length) continue;
          ctx.fillStyle = colors[lv];
          const ch = ramp[1 + (lv % (ramp.length - 1))];
          for (let k = 0; k < b.length; k += 4) ctx.fillText(ch, b[k + 2], b[k + 3]);
        }
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

      } else if (mode === 'dot') {
        for (let lv = 0; lv < COLOR_LEVELS; lv++) {
          const b = buckets[lv];
          if (!b.length) continue;
          ctx.fillStyle = colors[lv];
          for (let k = 0; k < b.length; k += 4) {
            ctx.fillRect(b[k + 2] - size / 2, b[k + 3] - size / 2, size, size);
          }
        }

      } else {  // streaks — one path per colour bucket
        ctx.lineCap   = 'round';
        ctx.lineWidth = size;
        for (let lv = 0; lv < COLOR_LEVELS; lv++) {
          const b = buckets[lv];
          if (!b.length) continue;
          ctx.strokeStyle = colors[lv];
          ctx.beginPath();
          for (let k = 0; k < b.length; k += 4) {
            ctx.moveTo(b[k], b[k + 1]);
            ctx.lineTo(b[k + 2], b[k + 3]);
          }
          ctx.stroke();
        }
      }
    },
  });
})();
