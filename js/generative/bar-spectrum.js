/* ══ Bar Spectrum ═════════════════════════════════════════════════════════
   The analyser drawn directly: log-spaced FFT bins as bars, mirrored bars or
   a radial ring, with peak-hold caps that fall back slowly.

   With no audio running it animates a synthetic spectrum so the effect is
   still worth looking at while you set it up.                               */

(function () {
  'use strict';

  const G = window.Generative;
  const MAX_BINS = 160;

  Generative.create({
    name:  'gen-spectrum',
    title: 'Bar Spectrum',
    hint:  'Start an audio source in the Audio bar to drive this',
    resetKeys: ['bins'],

    audioSuggest: [
      { key: 'glow',   band: 'beat', amount: 0.5 },
      { key: 'smooth', band: 'level', amount: -0.2 },
    ],

    defaults: {
      layout:     'mirror',
      bins:       64,
      gap:        0.25,
      smooth:     0.55,
      floorLevel: 0.02,
      peaks:      true,
      peakFall:   0.55,
      radius:     0.28,
      spin:       0.12,
      glyph:      false,
      ramp:       'blocks',
      glow:       0.35,
      palette:    'acid',
      colorBy:    'bin',
      background: '#06070a',
    },

    sections: [
      {
        title: 'LAYOUT',
        specs: [
          { key: 'layout', label: 'Arrangement', type: 'select',
            options: [
              { value: 'bars',   label: 'Bars' },
              { value: 'mirror', label: 'Mirrored' },
              { value: 'center', label: 'Centre Out' },
              { value: 'radial', label: 'Radial Ring' },
            ] },
          { key: 'bins', label: 'Band Count', type: 'slider',
            min: 8, max: MAX_BINS, step: 1, fmt: v => Math.round(v) },
          { key: 'gap', label: 'Bar Gap', type: 'slider',
            min: 0, max: 0.8, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'radius', label: 'Ring Radius', type: 'slider',
            min: 0.08, max: 0.45, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            showIf: s => s.layout === 'radial' },
          { key: 'spin', label: 'Ring Spin', type: 'slider',
            min: -1, max: 1, step: 0.01, fmt: v => v.toFixed(2),
            showIf: s => s.layout === 'radial' },
        ],
      },
      {
        title: 'RESPONSE',
        specs: [
          { key: 'smooth', label: 'Bar Smoothing', type: 'slider',
            min: 0, max: 0.95, step: 0.01,
            fmt: v => v < 0.02 ? 'Instant' : Math.round(v * 100) + '%' },
          { key: 'floorLevel', label: 'Noise Floor', type: 'slider',
            min: 0, max: 0.3, step: 0.005, fmt: v => Math.round(v * 100) + '%' },
          { key: 'peaks', label: 'Peak Hold', type: 'toggle',
            options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
          { key: 'peakFall', label: 'Peak Fall', type: 'slider',
            min: 0.05, max: 2, step: 0.01, fmt: v => v.toFixed(2),
            showIf: s => s.peaks },
        ],
      },
      {
        title: 'LOOK',
        specs: [
          { key: 'glyph', label: 'Draw With', type: 'toggle',
            options: [
              { value: false, label: 'Bars' },
              { value: true,  label: 'Glyphs' },
            ] },
          { key: 'ramp', label: 'Character Ramp', type: 'select',
            options: G.RAMP_OPTIONS, showIf: s => s.glyph },
          { key: 'glow', label: 'Glow', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'colorBy', label: 'Color By', type: 'toggle',
            options: [
              { value: 'bin',    label: 'Frequency' },
              { value: 'height', label: 'Level' },
            ] },
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Background', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      env.spec  = new Float32Array(MAX_BINS);
      env.level = new Float32Array(MAX_BINS);
      env.peak  = new Float32Array(MAX_BINS);
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const w   = env.w, h = env.h;
      const n   = Math.max(4, Math.round(s.bins));

      // ── Read the analyser, or fake it while audio is off ───────────────
      if (!GenAudio.getSpectrum(env.spec, n)) {
        const t = env.time;
        for (let i = 0; i < n; i++) {
          const f = i / n;
          env.spec[i] = Math.max(0,
            (0.75 - f * 0.55) *
            (0.45 + 0.55 * G.noise2(i * 0.35, t * 1.6, 7)) *
            (0.6 + 0.4 * Math.sin(t * 2.2 - f * 6)));
        }
      }

      const k = 1 - Math.pow(s.smooth, Math.max(0.001, dt * 60));
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, env.spec[i] - s.floorLevel) / (1 - s.floorLevel);
        env.level[i] += (v - env.level[i]) * (s.smooth > 0.01 ? k : 1);
        if (env.level[i] > env.peak[i]) env.peak[i] = env.level[i];
        else env.peak[i] = Math.max(env.level[i], env.peak[i] - s.peakFall * dt);
      }

      // ── Paint ──────────────────────────────────────────────────────────
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, w, h);

      const stops = G.PALETTES[s.palette] || G.PALETTES.acid;
      ctx.shadowBlur  = s.glow > 0.02 ? 22 * s.glow : 0;

      const ramp = G.RAMPS[s.ramp] || G.RAMPS.blocks;

      if (s.layout === 'radial') {
        drawRadial(ctx, env, s, w, h, n, stops, ramp);
      } else {
        drawBars(ctx, env, s, w, h, n, stops, ramp);
      }

      ctx.shadowBlur = 0;
    },
  });

  function colorFor(s, stops, binT, level) {
    const t = s.colorBy === 'height' ? level : binT;
    const c = G.rampAt(stops, 0.2 + t * 0.8);
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  function drawBars(ctx, env, s, w, h, n, stops, ramp) {
    const slot  = w / n;
    const bw    = slot * (1 - s.gap);
    const pad   = (slot - bw) / 2;
    const mir   = s.layout === 'mirror';
    const cen   = s.layout === 'center';
    const baseY = mir ? h / 2 : h;
    const maxH  = mir ? h / 2 : h * 0.92;

    if (s.glyph) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = Math.round(slot * 1.05) + 'px "JetBrains Mono", ui-monospace, monospace';
    }

    for (let i = 0; i < n; i++) {
      const v = Math.min(1, env.level[i]);
      const x = i * slot + pad;
      const col = colorFor(s, stops, i / n, v);
      ctx.fillStyle = col;
      ctx.shadowColor = col;

      const barH = v * maxH;

      if (s.glyph) {
        const cells = Math.max(1, Math.round(barH / slot));
        for (let c = 0; c < cells; c++) {
          const t  = cells === 1 ? 1 : c / (cells - 1);
          const ch = ramp[Math.max(1, Math.round(t * (ramp.length - 1)))];
          const y  = baseY - c * slot - slot / 2;
          ctx.fillText(ch, x + bw / 2, y);
          if (mir) ctx.fillText(ch, x + bw / 2, baseY + c * slot + slot / 2);
        }
      } else if (cen) {
        ctx.fillRect(x, h / 2 - barH / 2, bw, barH);
      } else {
        ctx.fillRect(x, baseY - barH, bw, barH);
        if (mir) ctx.fillRect(x, baseY, bw, barH);
      }

      if (s.peaks && !s.glyph) {
        const py = baseY - env.peak[i] * maxH;
        ctx.fillRect(x, py - 2, bw, 2);
        if (mir) ctx.fillRect(x, baseY + env.peak[i] * maxH, bw, 2);
      }
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawRadial(ctx, env, s, w, h, n, stops, ramp) {
    const cx = w / 2, cy = h / 2;
    const r0 = Math.min(w, h) * s.radius;
    const maxLen = Math.min(w, h) * 0.42 - r0 * 0.5;
    const step = (Math.PI * 2) / n;
    const spin = env.time * s.spin * Math.PI;
    const bw   = Math.max(1, (r0 * step) * (1 - s.gap));

    ctx.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const v  = Math.min(1, env.level[i]);
      const a  = i * step + spin;
      const ca = Math.cos(a), sa = Math.sin(a);
      const col = colorFor(s, stops, i / n, v);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.lineWidth   = bw;
      ctx.beginPath();
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * (r0 + v * maxLen), cy + sa * (r0 + v * maxLen));
      ctx.stroke();

      if (s.peaks) {
        const pr = r0 + env.peak[i] * maxLen;
        ctx.lineWidth = bw;
        ctx.beginPath();
        ctx.moveTo(cx + ca * pr, cy + sa * pr);
        ctx.lineTo(cx + ca * (pr + 3), cy + sa * (pr + 3));
        ctx.stroke();
      }
    }
  }
})();
