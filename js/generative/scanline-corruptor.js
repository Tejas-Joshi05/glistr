/* ══ Scanline Corruptor ═══════════════════════════════════════════════════
   Datamosh with no source footage: a procedural base image (bars, plasma or
   test pattern) is torn apart with block displacement, channel shear, sync
   roll and dropout — all gated by the beat.

   The base is drawn into a buffer once per frame, then presented as a stack
   of horizontal slices, each grabbed from a different offset.               */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name:  'gen-corrupt',
    title: 'Scanline Corruptor',
    hint:  'Click to force a corruption burst',

    audioSuggest: [
      { key: 'burst',      band: 'beat', amount: 0.8 },
      { key: 'shift',      band: 'bass', amount: 0.45 },
      { key: 'aberration', band: 'high', amount: 0.5 },
    ],

    defaults: {
      base:       'bars',
      baseScale:  7,
      baseSpeed:  0.35,
      slices:     26,
      shift:      0.22,
      burst:      0.35,
      churn:      3.2,
      aberration: 0.35,
      roll:       0.12,
      dropout:    0.08,
      scan:       0.2,
      palette:    'ice',
      background: '#04050a',
      seed:       8100,
    },

    sections: [
      {
        title: 'SIGNAL',
        specs: [
          { key: 'base', label: 'Base Image', type: 'select',
            options: [
              { value: 'bars',    label: 'Colour Bars' },
              { value: 'plasma',  label: 'Plasma' },
              { value: 'grid',    label: 'Grid' },
              { value: 'noise',   label: 'Static' },
            ] },
          { key: 'baseScale', label: 'Base Scale', type: 'slider',
            min: 1, max: 24, step: 1, fmt: v => Math.round(v) },
          { key: 'baseSpeed', label: 'Base Drift', type: 'slider',
            min: -2, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'seed', label: 'Seed', type: 'seed' },
        ],
      },
      {
        title: 'CORRUPTION',
        specs: [
          { key: 'slices', label: 'Slice Count', type: 'slider',
            min: 2, max: 90, step: 1, fmt: v => Math.round(v) },
          { key: 'shift', label: 'Slice Shift', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Clean' : Math.round(v * 100) + '%' },
          { key: 'burst', label: 'Beat Burst', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%',
            hint: 'Kicks tear the frame apart, then it settles' },
          { key: 'churn', label: 'Re-roll Rate', type: 'slider',
            min: 0.2, max: 20, step: 0.1, fmt: v => v.toFixed(1) + '/s' },
          { key: 'dropout', label: 'Dropout', type: 'slider',
            min: 0, max: 0.6, step: 0.01,
            fmt: v => v < 0.01 ? 'None' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'ARTEFACTS',
        specs: [
          { key: 'aberration', label: 'Channel Shear', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Off' : Math.round(v * 100) + '%' },
          { key: 'roll', label: 'Sync Roll', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.01 ? 'Locked' : v.toFixed(2) },
          { key: 'scan', label: 'Scanlines', type: 'slider',
            min: 0, max: 0.7, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
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
      env.buf = document.createElement('canvas');
      env.buf.width = env.w; env.buf.height = env.h;
      env.bufCtx = env.buf.getContext('2d');

      env.offsets = new Float32Array(128);
      env.drops   = new Uint8Array(128);
      env.acc     = 0;
      env.burst   = 0;
      env.rollPos = 0;
      env.lastBeat = -1;
      rollSlices(env);
    },

    pointer: function (env) { env.burst = 1; rollSlices(env); },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const w   = env.w, h = env.h;

      // ── Base image into the buffer ─────────────────────────────────────
      drawBase(env.bufCtx, env, s, w, h);

      // ── Corruption schedule ────────────────────────────────────────────
      if (env.beats !== undefined && env.beats !== env.lastBeat) {
        if (env.lastBeat !== -1 && env.audioActive) { env.burst = 1; rollSlices(env); }
        env.lastBeat = env.beats;
      }
      env.burst = Math.max(0, env.burst - dt * 2.4);

      env.acc += dt * s.churn;
      while (env.acc >= 1) { env.acc -= 1; rollSlices(env); }

      env.rollPos = (env.rollPos + s.roll * dt * h * 0.9) % h;

      // ── Present as displaced slices ────────────────────────────────────
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, w, h);

      const n      = Math.max(2, Math.round(s.slices));
      const sliceH = h / n;
      const amt    = (s.shift + env.burst * s.burst * 1.6) * w * 0.5;
      const roll   = s.roll > 0.005 ? env.rollPos : 0;

      for (let i = 0; i < n; i++) {
        if (s.dropout > 0.005 && env.drops[i % env.drops.length] &&
            Math.random() < s.dropout) continue;

        const sy  = i * sliceH;
        const src = (sy + roll) % h;
        const dx  = env.offsets[i % env.offsets.length] * amt;
        const hh  = Math.min(sliceH + 1, h - src);

        ctx.drawImage(env.buf, 0, src, w, hh, dx, sy, w, sliceH + 1);
        if (dx > 0)      ctx.drawImage(env.buf, 0, src, w, hh, dx - w, sy, w, sliceH + 1);
        else if (dx < 0) ctx.drawImage(env.buf, 0, src, w, hh, dx + w, sy, w, sliceH + 1);
      }

      // ── Channel shear ──────────────────────────────────────────────────
      if (s.aberration > 0.01) {
        const off = s.aberration * (6 + env.burst * 26);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.42;
        ctx.drawImage(ctx.canvas, off, 0);
        ctx.drawImage(ctx.canvas, -off, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── Scanlines ──────────────────────────────────────────────────────
      if (s.scan > 0.02) {
        ctx.fillStyle = 'rgba(0,0,0,' + s.scan.toFixed(3) + ')';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      }
    },
  });

  function rollSlices(env) {
    const off = env.offsets, drops = env.drops;
    for (let i = 0; i < off.length; i++) {
      // Most slices sit still; a few tear a long way
      const r = Math.random();
      off[i] = r < 0.68 ? 0 : (Math.random() - 0.5) * 2;
      drops[i] = Math.random() < 0.25 ? 1 : 0;
    }
  }

  function drawBase(c, env, s, w, h) {
    const stops = G.PALETTES[s.palette] || G.PALETTES.ice;
    const t     = env.time * s.baseSpeed;
    const n     = Math.max(1, Math.round(s.baseScale));

    switch (s.base) {

      case 'plasma': {
        const g = c.createLinearGradient(0, 0, w, h);
        for (let i = 0; i <= 4; i++) {
          const k = (i / 4 + t * 0.2) % 1;
          const col = G.rampAt(stops, k);
          g.addColorStop(i / 4, 'rgb(' + col.join(',') + ')');
        }
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.35;
        for (let i = 0; i < n; i++) {
          const y = ((i / n + t * 0.4) % 1) * h;
          const col = G.rampAt(stops, (i / n + 0.4) % 1);
          c.fillStyle = 'rgb(' + col.join(',') + ')';
          c.fillRect(0, y, w, h / (n * 2));
        }
        c.globalAlpha = 1;
        break;
      }

      case 'grid': {
        c.fillStyle = s.background;
        c.fillRect(0, 0, w, h);
        const step = Math.max(6, w / (n * 3));
        const col  = G.rampAt(stops, 0.8);
        c.strokeStyle = 'rgb(' + col.join(',') + ')';
        c.lineWidth = 1.5;
        const shift = (t * 40) % step;
        c.beginPath();
        for (let x = -step + shift; x < w + step; x += step) { c.moveTo(x, 0); c.lineTo(x, h); }
        for (let y = -step + shift; y < h + step; y += step) { c.moveTo(0, y); c.lineTo(w, y); }
        c.stroke();
        break;
      }

      case 'noise': {
        c.fillStyle = s.background;
        c.fillRect(0, 0, w, h);
        const block = Math.max(3, Math.round(w / (n * 8)));
        for (let y = 0; y < h; y += block) {
          for (let x = 0; x < w; x += block) {
            const v = G.noise2(x / block * 0.6, y / block * 0.6 + t * 6, s.seed | 0);
            const col = G.rampAt(stops, v);
            c.fillStyle = 'rgb(' + col.join(',') + ')';
            c.fillRect(x, y, block, block);
          }
        }
        break;
      }

      default: {  // colour bars
        const bw = w / n;
        for (let i = 0; i < n; i++) {
          const k = (i / n + t * 0.3) % 1;
          const col = G.rampAt(stops, k);
          c.fillStyle = 'rgb(' + col.join(',') + ')';
          c.fillRect(i * bw, 0, bw + 1, h);
        }
        // Pedestal strip along the bottom, like a real test card
        c.fillStyle = s.background;
        c.fillRect(0, h * 0.82, w, h * 0.18);
        const cols = 6;
        for (let i = 0; i < cols; i++) {
          const col = G.rampAt(stops, i / (cols - 1));
          c.fillStyle = 'rgb(' + col.join(',') + ')';
          c.fillRect(i * (w / cols), h * 0.86, w / cols - 4, h * 0.1);
        }
      }
    }
  }
})();
