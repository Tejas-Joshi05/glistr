/* ══ Warp Grid ════════════════════════════════════════════════════════════
   A perspective grid rushing toward the viewer — floor, ceiling or both.
   Depth lines scroll on a logarithmic ladder so they bunch up at the horizon
   and open out toward the camera; lane lines converge on the vanishing point.

   Routing the bass onto Speed or Line Glow makes the whole field lunge on
   the kick.                                                                 */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name: 'gen-warp',
    title: 'Warp Grid',
    hint: 'Click to set the vanishing point',

    audioSuggest: [
      { key: 'beatPulse', value: 0.9 },
      { key: 'speed',     band: 'bass', amount: 0.45 },
      { key: 'glow',      band: 'beat', amount: 0.5  },
    ],
    defaults: {
      speed:      1.1,
      lanes:      16,
      depthLines: 22,
      horizon:    0.5,
      surface:    'both',
      fov:        0.62,
      lineWidth:  1.6,
      glow:       0.55,
      fog:        0.75,
      sun:        true,
      sunSize:    0.16,
      scanlines:  0.18,
      palette:    'violet',
      background: '#06030f',
      beatPulse:  0.5,
    },

    sections: [
      {
        title: 'MOTION',
        specs: [
          { key: 'speed', label: 'Travel Speed', type: 'slider',
            min: -4, max: 4, step: 0.05,
            fmt: v => Math.abs(v) < 0.03 ? 'Stopped'
                    : (v > 0 ? 'Forward ' : 'Reverse ') + Math.abs(v).toFixed(2) },
          { key: 'beatPulse', label: 'Beat Lunge', type: 'slider',
            min: 0, max: 2, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : v.toFixed(2),
            hint: 'Kicks push the grid forward — needs an audio source' },
        ],
      },
      {
        title: 'GEOMETRY',
        specs: [
          { key: 'surface', label: 'Surfaces', type: 'toggle',
            options: [
              { value: 'floor', label: 'Floor' },
              { value: 'both',  label: 'Both' },
              { value: 'roof',  label: 'Roof' },
            ] },
          { key: 'lanes', label: 'Lane Count', type: 'slider',
            min: 2, max: 60, step: 1, fmt: v => Math.round(v) },
          { key: 'depthLines', label: 'Depth Lines', type: 'slider',
            min: 4, max: 60, step: 1, fmt: v => Math.round(v) },
          { key: 'horizon', label: 'Horizon Height', type: 'slider',
            min: 0.15, max: 0.85, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'fov', label: 'Perspective', type: 'slider',
            min: 0.15, max: 1.6, step: 0.01, fmt: v => v.toFixed(2) },
        ],
      },
      {
        title: 'LOOK',
        specs: [
          { key: 'lineWidth', label: 'Line Weight', type: 'slider',
            min: 0.5, max: 6, step: 0.1, fmt: v => v.toFixed(1) + 'px' },
          { key: 'glow', label: 'Glow', type: 'slider',
            min: 0, max: 1, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
          { key: 'fog', label: 'Horizon Fog', type: 'slider',
            min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'sun', label: 'Sun Disc', type: 'toggle',
            options: [{ value: true, label: 'On' }, { value: false, label: 'Off' }] },
          { key: 'sunSize', label: 'Sun Size', type: 'slider',
            min: 0.04, max: 0.4, step: 0.01, fmt: v => Math.round(v * 100) + '%',
            showIf: s => s.sun },
          { key: 'scanlines', label: 'Scanlines', type: 'slider',
            min: 0, max: 0.7, step: 0.01,
            fmt: v => v < 0.02 ? 'Off' : Math.round(v * 100) + '%' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'background', label: 'Sky', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      env.scroll = env.scroll || 0;
      env.vpx    = 0.5;
      env.lunge  = 0;
    },

    pointer: function (env, x) {
      env.vpx = Math.max(0.05, Math.min(0.95, x / env.w));
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const w   = env.w, h = env.h;

      // Beat lunge — a decaying kick on top of the base speed
      if (env.audio && s.beatPulse > 0.02) {
        env.lunge = Math.max(env.lunge * Math.exp(-4 * dt), env.audio.beat * s.beatPulse * 3);
      } else {
        env.lunge = 0;
      }
      env.scroll += (s.speed + env.lunge) * dt;

      const horizonY = h * s.horizon;
      const vpX      = w * env.vpx;

      // ── Sky ────────────────────────────────────────────────────────────
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, w, h);

      const stops = G.PALETTES[s.palette] || G.PALETTES.violet;
      const near  = G.rampAt(stops, 0.95);
      const far   = G.rampAt(stops, 0.35);

      // ── Sun disc behind the grid ───────────────────────────────────────
      if (s.sun) {
        const r  = h * s.sunSize;
        const cy = horizonY - r * 0.15;
        const gr = ctx.createLinearGradient(0, cy - r, 0, cy + r);
        gr.addColorStop(0,   'rgb(' + near.join(',') + ')');
        gr.addColorStop(1,   'rgb(' + far.join(',')  + ')');
        ctx.save();
        ctx.beginPath();
        ctx.arc(vpX, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = gr;
        ctx.fillRect(vpX - r, cy - r, r * 2, r * 2);
        // Slice the disc with horizontal cuts, widening downward
        ctx.fillStyle = s.background;
        for (let i = 0; i < 9; i++) {
          const t  = i / 9;
          const yy = cy - r * 0.15 + t * r * 1.2;
          ctx.fillRect(vpX - r, yy, r * 2, r * 0.035 * (1 + t * 3));
        }
        ctx.restore();
      }

      // ── Grid ───────────────────────────────────────────────────────────
      const surfaces = s.surface === 'both' ? [1, -1] : (s.surface === 'roof' ? [-1] : [1]);
      const fov      = s.fov;
      const lanes    = Math.max(2, Math.round(s.lanes));
      const depthN   = Math.max(4, Math.round(s.depthLines));
      const scroll   = env.scroll;

      ctx.lineCap = 'round';
      if (s.glow > 0.02) {
        ctx.shadowColor = 'rgb(' + near.join(',') + ')';
        ctx.shadowBlur  = 18 * s.glow;
      } else {
        ctx.shadowBlur = 0;
      }

      for (const dir of surfaces) {
        const baseY = horizonY;
        const span  = dir > 0 ? (h - horizonY) : horizonY;

        // Depth lines: z on a scrolling ladder, projected as y = span / z
        for (let i = 0; i < depthN; i++) {
          // Fractional index keeps lines flowing smoothly instead of popping
          const f = (i + (scroll % 1)) / depthN;
          const z = fov / (f * f + 0.0012);
          const y = baseY + dir * (span / (1 + z * 0.5));
          if (y < -2 || y > h + 2) continue;

          const depth = 1 - f;                       // 1 = far, 0 = near
          const a = alphaFor(depth, s.fog);
          const c = G.rampAt(stops, 0.25 + (1 - depth) * 0.7);
          ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
          ctx.lineWidth   = s.lineWidth * (0.4 + (1 - depth) * 1.4);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Lane lines: straight from the vanishing point to the frame edge
        for (let i = 0; i <= lanes; i++) {
          const t  = i / lanes - 0.5;
          const x2 = vpX + t * w * (2.4 / fov) * 0.5;
          const c  = G.rampAt(stops, 0.55);
          ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' +
                            (0.55 * (1 - s.fog * 0.35)).toFixed(3) + ')';
          ctx.lineWidth = s.lineWidth;
          ctx.beginPath();
          ctx.moveTo(vpX, horizonY);
          ctx.lineTo(x2, dir > 0 ? h : 0);
          ctx.stroke();
        }
      }

      ctx.shadowBlur = 0;

      // ── Horizon fog band ───────────────────────────────────────────────
      if (s.fog > 0.02) {
        const band = h * 0.16 * s.fog;
        const gr = ctx.createLinearGradient(0, horizonY - band, 0, horizonY + band);
        const bg = G.hexToRgb(s.background);
        gr.addColorStop(0,   'rgba(' + bg.join(',') + ',0)');
        gr.addColorStop(0.5, 'rgba(' + bg.join(',') + ',' + (s.fog * 0.85).toFixed(2) + ')');
        gr.addColorStop(1,   'rgba(' + bg.join(',') + ',0)');
        ctx.fillStyle = gr;
        ctx.fillRect(0, horizonY - band, w, band * 2);
      }

      // ── Scanlines ──────────────────────────────────────────────────────
      if (s.scanlines > 0.02) {
        ctx.fillStyle = 'rgba(0,0,0,' + s.scanlines.toFixed(3) + ')';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      }
    },
  });

  function alphaFor(depth, fog) {
    const a = (1 - depth) * (1 - fog * 0.8) + 0.08;
    return a < 0.03 ? 0.03 : a > 1 ? 1 : a;
  }
})();
